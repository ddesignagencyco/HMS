// apps/api/src/payment/payouts.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { formatPaisa, paisaToNumber } from '@smart-home/domain';
import { DomainError, badRequest, notFound } from '../common/domain-error.js';
import { EnvironmentService } from '../config/environment.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { decryptTotpSecret, encryptTotpSecret } from '../identity/totp-vault.js';
import { OBJECT_STORAGE } from '../integrations/integrations.module.js';
import type { ObjectStoragePort } from '../integrations/ports.js';
import { AuditService, appendOutboxEvent } from '../platform/audit.service.js';
import { SettingsService } from '../platform/settings.service.js';
import { DebtService } from './debt.service.js';
import { LedgerService } from './ledger.service.js';
import { renderTextPdf } from './text-pdf.js';

export type PayoutAccountInput = { kind: 'BANK' | 'WALLET'; accountTitle: string; institution: string; accountNumber: string; isDefault?: boolean | undefined };

type PayoutRow = { id: string; providerId: string; amountPaisa: bigint; status: string; requestedAt: Date; paidAt: Date | null; failureReason: string | null; batchId: string | null; accountTitle: string; institution: string; accountLast4: string };

const present = (row: PayoutRow) => ({ ...row, amountPaisa: paisaToNumber(row.amountPaisa) });

const csvCell = (value: string): string => (/[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value);

/**
 * FR-PY-08 / FR-SP-11: how a provider's wallet becomes money in their bank. A provider registers a payout account, asks for a payout
 * of what the platform owes them, finance approves it (the wallet moves to PAYOUT_CLEARING), a batch exports the approved ones for the
 * bank, and marking the batch paid (or failed, per payout) settles it. Every step is a ledger posting, so a failed payout puts the
 * money back in the wallet exactly — the ledger never has to be "fixed" afterwards.
 */
@Injectable()
export class PayoutsService {
  private readonly key: Buffer;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EnvironmentService) environment: EnvironmentService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(LedgerService) private readonly ledger: LedgerService,
    @Inject(DebtService) private readonly debt: DebtService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort
  ) {
    this.key = Buffer.from(environment.values.TOTP_ENCRYPTION_KEY, 'base64');
  }

  // ------------------------------------------------------------- payout accounts

  /** The full account number is stored encrypted; only its last four digits are ever shown back. */
  async addAccount(providerId: string, input: PayoutAccountInput) {
    const digits = input.accountNumber.replace(/[\s-]/g, '');
    if (digits.length < 6) throw badRequest('The account number looks too short');
    return this.prisma.$transaction(async tx => {
      const existing = await tx.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*)::bigint as n FROM provider_payout_accounts WHERE provider_id = ${providerId}::uuid`);
      const makeDefault = input.isDefault === true || (existing[0]?.n ?? 0n) === 0n;
      if (makeDefault) await tx.$executeRaw(Prisma.sql`UPDATE provider_payout_accounts SET is_default = false WHERE provider_id = ${providerId}::uuid`);
      const rows = await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`INSERT INTO provider_payout_accounts(provider_id, kind, account_title, institution, account_number_enc, account_last4, is_default)
          VALUES (${providerId}::uuid, ${input.kind}::payout_account_kind, ${input.accountTitle}, ${input.institution}, ${encryptTotpSecret(this.key, digits)}, ${digits.slice(-4)}, ${makeDefault}) RETURNING id`
      );
      return { id: rows[0]?.id, kind: input.kind, accountTitle: input.accountTitle, institution: input.institution, accountLast4: digits.slice(-4), isDefault: makeDefault };
    });
  }

  async listAccounts(providerId: string) {
    return this.prisma.$queryRaw<{ id: string; kind: string; accountTitle: string; institution: string; accountLast4: string; isDefault: boolean }[]>(
      Prisma.sql`SELECT id, kind::text, account_title as "accountTitle", institution, account_last4 as "accountLast4", is_default as "isDefault" FROM provider_payout_accounts WHERE provider_id = ${providerId}::uuid ORDER BY created_at`
    );
  }

  // ------------------------------------------------------------- provider side

  /** What can still be asked for: the wallet, less payouts already requested or on their way out. */
  async available(providerId: string): Promise<bigint> {
    const balance = await this.debt.walletBalance(this.prisma, providerId);
    const pending = await this.prisma.$queryRaw<{ total: bigint }[]>(
      Prisma.sql`SELECT coalesce(sum(amount_paisa), 0)::bigint as total FROM payouts WHERE provider_id = ${providerId}::uuid AND status = 'REQUESTED'`
    );
    const available = balance - (pending[0]?.total ?? 0n);
    return available > 0n ? available : 0n;
  }

  async request(providerId: string, amountPaisa: number, accountId: string) {
    const amount = BigInt(amountPaisa);
    const minimum = BigInt(await this.settings.getNumber('payout.min_amount_paisa'));
    if (amount < minimum) throw badRequest(`The smallest payout is ${paisaToNumber(minimum)} paisa`);
    const accounts = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM provider_payout_accounts WHERE id = ${accountId}::uuid AND provider_id = ${providerId}::uuid`);
    if (accounts[0] === undefined) throw notFound('Payout account');
    return this.prisma.$transaction(async tx => {
      // Serialised per provider so two requests cannot both spend the same wallet balance.
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`payout:${providerId}`}))`);
      const balance = await this.debt.walletBalance(tx, providerId);
      const pending = await tx.$queryRaw<{ total: bigint }[]>(Prisma.sql`SELECT coalesce(sum(amount_paisa), 0)::bigint as total FROM payouts WHERE provider_id = ${providerId}::uuid AND status = 'REQUESTED'`);
      const available = balance - (pending[0]?.total ?? 0n);
      if (amount > available) throw new DomainError('CONFLICT', `You can request at most ${paisaToNumber(available > 0n ? available : 0n)} paisa right now`);
      const rows = await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`INSERT INTO payouts(provider_id, payout_account_id, amount_paisa) VALUES (${providerId}::uuid, ${accountId}::uuid, ${amount}) RETURNING id`
      );
      const id = rows[0]?.id;
      await appendOutboxEvent(tx, { aggregate: 'payout', aggregateId: id ?? '', type: 'payout.requested', payload: { payoutId: id ?? '', providerId, amountPaisa: amount.toString() } });
      return { id, amountPaisa, status: 'REQUESTED' };
    });
  }

  async listForProvider(providerId: string) {
    const rows = await this.prisma.$queryRaw<PayoutRow[]>(
      Prisma.sql`SELECT p.id, p.provider_id as "providerId", p.amount_paisa as "amountPaisa", p.status::text, p.requested_at as "requestedAt", p.paid_at as "paidAt", p.failure_reason as "failureReason", p.batch_id as "batchId",
          a.account_title as "accountTitle", a.institution, a.account_last4 as "accountLast4"
        FROM payouts p JOIN provider_payout_accounts a ON a.id = p.payout_account_id WHERE p.provider_id = ${providerId}::uuid ORDER BY p.requested_at DESC`
    );
    return rows.map(present);
  }

  /**
   * FR-SP-10: held (the provider's share of jobs whose money is still in escrow), releasable (the wallet, less what is already requested),
   * paid out to date, commission taken on released jobs, and what was released each week and month.
   */
  async earnings(providerId: string) {
    const held = await this.prisma.$queryRaw<{ held: bigint }[]>(
      Prisma.sql`SELECT coalesce(sum(b.balance - ((b.balance * bk.commission_rate_bp + 5000) / 10000)), 0)::bigint as held
        FROM ledger_accounts a JOIN account_balances b ON b.account_id = a.id JOIN bookings bk ON bk.id = a.booking_id
        WHERE a.type = 'ESCROW' AND bk.provider_id = ${providerId}::uuid AND b.balance > 0`
    );
    const paid = await this.prisma.$queryRaw<{ paid: bigint }[]>(Prisma.sql`SELECT coalesce(sum(amount_paisa), 0)::bigint as paid FROM payouts WHERE provider_id = ${providerId}::uuid AND status = 'PAID'`);
    const commission = await this.prisma.$queryRaw<{ total: bigint }[]>(
      Prisma.sql`SELECT coalesce(sum(e.amount_paisa), 0)::bigint as total FROM ledger_transactions t JOIN ledger_entries e ON e.transaction_id = t.id JOIN ledger_accounts a ON a.id = e.account_id JOIN bookings b ON b.id = t.booking_id
        WHERE t.type IN ('RELEASE','CASH_SETTLEMENT') AND a.type = 'PLATFORM_COMMISSION' AND e.direction = 'CREDIT' AND b.provider_id = ${providerId}::uuid`
    );
    const weekly = await this.prisma.$queryRaw<{ period: string; total: bigint }[]>(
      Prisma.sql`SELECT to_char(date_trunc('week', t.created_at), 'YYYY-MM-DD') as period, sum(e.amount_paisa)::bigint as total FROM ledger_transactions t JOIN ledger_entries e ON e.transaction_id = t.id JOIN ledger_accounts a ON a.id = e.account_id
        WHERE t.type = 'RELEASE' AND a.type = 'PROVIDER_WALLET' AND e.direction = 'CREDIT' AND a.owner_user_id = ${providerId}::uuid AND t.created_at > now() - interval '12 weeks' GROUP BY 1 ORDER BY 1 DESC`
    );
    const monthly = await this.prisma.$queryRaw<{ period: string; total: bigint }[]>(
      Prisma.sql`SELECT to_char(date_trunc('month', t.created_at), 'YYYY-MM') as period, sum(e.amount_paisa)::bigint as total FROM ledger_transactions t JOIN ledger_entries e ON e.transaction_id = t.id JOIN ledger_accounts a ON a.id = e.account_id
        WHERE t.type = 'RELEASE' AND a.type = 'PROVIDER_WALLET' AND e.direction = 'CREDIT' AND a.owner_user_id = ${providerId}::uuid AND t.created_at > now() - interval '12 months' GROUP BY 1 ORDER BY 1 DESC`
    );
    return {
      heldPaisa: paisaToNumber(held[0]?.held ?? 0n),
      releasablePaisa: paisaToNumber(await this.available(providerId)),
      paidPaisa: paisaToNumber(paid[0]?.paid ?? 0n),
      commissionPaisa: paisaToNumber(commission[0]?.total ?? 0n),
      weekly: weekly.map(row => ({ period: row.period, releasedPaisa: paisaToNumber(row.total) })),
      monthly: monthly.map(row => ({ period: row.period, releasedPaisa: paisaToNumber(row.total) }))
    };
  }

  // ------------------------------------------------------------- finance side

  async list(status: string | undefined) {
    const rows = await this.prisma.$queryRaw<(PayoutRow & { providerName: string })[]>(
      Prisma.sql`SELECT p.id, p.provider_id as "providerId", trim(u.first_name || ' ' || u.last_name) as "providerName", p.amount_paisa as "amountPaisa", p.status::text, p.requested_at as "requestedAt", p.paid_at as "paidAt",
          p.failure_reason as "failureReason", p.batch_id as "batchId", a.account_title as "accountTitle", a.institution, a.account_last4 as "accountLast4"
        FROM payouts p JOIN provider_payout_accounts a ON a.id = p.payout_account_id JOIN users u ON u.id = p.provider_id
        WHERE (${status ?? null}::text IS NULL OR p.status::text = ${status ?? null}) ORDER BY p.requested_at DESC LIMIT 200`
    );
    return rows.map(present);
  }

  /** D PROVIDER_WALLET / C PAYOUT_CLEARING: the money leaves the provider's wallet for the bank's queue. Once only. */
  async approve(payoutId: string, financeUserId: string) {
    return this.prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<{ providerId: string; amountPaisa: bigint; status: string }[]>(
        Prisma.sql`SELECT provider_id as "providerId", amount_paisa as "amountPaisa", status::text FROM payouts WHERE id = ${payoutId}::uuid FOR UPDATE`
      );
      const payout = rows[0];
      if (payout === undefined) throw notFound('Payout');
      if (payout.status !== 'REQUESTED') throw new DomainError('CONFLICT', `This payout is already ${payout.status.toLowerCase()}`);
      const balance = await this.debt.walletBalance(tx, payout.providerId);
      if (balance < payout.amountPaisa) throw new DomainError('CONFLICT', 'The provider’s wallet no longer covers this payout');
      const transactionId = await this.ledger.post(tx, {
        type: 'PAYOUT', idempotencyKey: `payout:${payoutId}`, memo: 'Payout approved', createdBy: financeUserId,
        lines: [
          { account: 'PROVIDER_WALLET', direction: 'DEBIT', amountPaisa: payout.amountPaisa, ownerUserId: payout.providerId },
          { account: 'PAYOUT_CLEARING', direction: 'CREDIT', amountPaisa: payout.amountPaisa }
        ]
      });
      await tx.$executeRaw(Prisma.sql`UPDATE payouts SET status = 'APPROVED'::payout_status, ledger_transaction_id = ${transactionId}::uuid WHERE id = ${payoutId}::uuid`);
      await this.audit.append({ actorUserId: financeUserId, actorRole: 'FINANCE', action: 'payout.approve', entityType: 'payout', entityId: payoutId, after: { amountPaisa: payout.amountPaisa.toString() } }, tx);
      await this.debt.refreshBlock(tx, payout.providerId);
      return { id: payoutId, status: 'APPROVED', amountPaisa: paisaToNumber(payout.amountPaisa) };
    });
  }

  /** Gathers every approved payout not yet in a batch into one bank file (CSV, in the reports bucket). */
  async createBatch(financeUserId: string, periodStart: string, periodEnd: string) {
    return this.prisma.$transaction(async tx => {
      const payouts = await tx.$queryRaw<{ id: string; providerId: string; amountPaisa: bigint; accountId: string }[]>(
        Prisma.sql`SELECT id, provider_id as "providerId", amount_paisa as "amountPaisa", payout_account_id as "accountId" FROM payouts WHERE status = 'APPROVED' AND batch_id IS NULL ORDER BY requested_at FOR UPDATE`
      );
      if (payouts.length === 0) throw new DomainError('CONFLICT', 'There are no approved payouts waiting for a batch');
      const total = payouts.reduce((sum, payout) => sum + payout.amountPaisa, 0n);
      const batches = await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`INSERT INTO payout_batches(period_start, period_end, status, total_paisa, created_by, exported_at) VALUES (${periodStart}::date, ${periodEnd}::date, 'EXPORTED'::payout_batch_status, ${total}, ${financeUserId}::uuid, now()) RETURNING id`
      );
      const batchId = batches[0]?.id;
      if (batchId === undefined) throw new Error('Batch insert did not return a row');
      await tx.$executeRaw(Prisma.sql`UPDATE payouts SET batch_id = ${batchId}::uuid, status = 'IN_BATCH'::payout_status WHERE id IN (${Prisma.join(payouts.map(payout => Prisma.sql`${payout.id}::uuid`))})`);
      const csv = await this.csvFor(tx, batchId);
      const fileKey = `payout-batches/${batchId}.csv`;
      await this.storage.put({ key: fileKey, bucket: 'reports', content: Buffer.from(csv, 'utf8'), contentType: 'text/csv' });
      await tx.$executeRaw(Prisma.sql`UPDATE payout_batches SET file_key = ${fileKey} WHERE id = ${batchId}::uuid`);
      await this.audit.append({ actorUserId: financeUserId, actorRole: 'FINANCE', action: 'payout.batch.create', entityType: 'payout_batch', entityId: batchId, after: { payouts: payouts.length, totalPaisa: total.toString() } }, tx);
      return { id: batchId, status: 'EXPORTED', payouts: payouts.length, totalPaisa: paisaToNumber(total), fileKey };
    });
  }

  private async csvFor(tx: Prisma.TransactionClient | PrismaService, batchId: string): Promise<string> {
    const rows = await tx.$queryRaw<{ id: string; title: string; institution: string; kind: string; enc: Buffer; amount: bigint; name: string }[]>(
      Prisma.sql`SELECT p.id, a.account_title as title, a.institution, a.kind::text as kind, a.account_number_enc as enc, p.amount_paisa as amount, trim(u.first_name || ' ' || u.last_name) as name
        FROM payouts p JOIN provider_payout_accounts a ON a.id = p.payout_account_id JOIN users u ON u.id = p.provider_id WHERE p.batch_id = ${batchId}::uuid ORDER BY p.requested_at`
    );
    const lines = ['payout_id,provider,account_kind,account_title,institution,account_number,amount_pkr'];
    for (const row of rows) {
      lines.push([row.id, row.name, row.kind, row.title, row.institution, decryptTotpSecret(this.key, Buffer.from(row.enc)), formatPaisa(row.amount)].map(csvCell).join(','));
    }
    return `${lines.join('\n')}\n`;
  }

  async listBatches() {
    const rows = await this.prisma.$queryRaw<{ id: string; periodStart: Date; periodEnd: Date; status: string; totalPaisa: bigint; payouts: bigint; createdAt: Date; paidAt: Date | null }[]>(
      Prisma.sql`SELECT b.id, b.period_start as "periodStart", b.period_end as "periodEnd", b.status::text, b.total_paisa as "totalPaisa", (SELECT count(*) FROM payouts p WHERE p.batch_id = b.id)::bigint as payouts, b.created_at as "createdAt", b.paid_at as "paidAt"
        FROM payout_batches b ORDER BY b.created_at DESC LIMIT 100`
    );
    return rows.map(row => ({ ...row, totalPaisa: paisaToNumber(row.totalPaisa), payouts: Number(row.payouts) }));
  }

  /** The bank file. The account numbers in it are decrypted for this one purpose, and the download is audited. */
  async exportCsv(batchId: string, financeUserId: string): Promise<string> {
    const found = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM payout_batches WHERE id = ${batchId}::uuid`);
    if (found[0] === undefined) throw notFound('Payout batch');
    await this.audit.append({ actorUserId: financeUserId, actorRole: 'FINANCE', action: 'payout.batch.export', entityType: 'payout_batch', entityId: batchId });
    return this.csvFor(this.prisma, batchId);
  }

  /** A provider's statement for one batch, as a PDF. */
  async statementPdf(batchId: string, providerId: string): Promise<Buffer> {
    const rows = await this.prisma.$queryRaw<{ amount: bigint; status: string; title: string; institution: string; last4: string; requestedAt: Date }[]>(
      Prisma.sql`SELECT p.amount_paisa as amount, p.status::text as status, a.account_title as title, a.institution, a.account_last4 as last4, p.requested_at as "requestedAt"
        FROM payouts p JOIN provider_payout_accounts a ON a.id = p.payout_account_id WHERE p.batch_id = ${batchId}::uuid AND p.provider_id = ${providerId}::uuid ORDER BY p.requested_at`
    );
    if (rows.length === 0) throw notFound('Statement');
    const names = await this.prisma.$queryRaw<{ name: string }[]>(Prisma.sql`SELECT trim(first_name || ' ' || last_name) as name FROM users WHERE id = ${providerId}::uuid`);
    const total = rows.reduce((sum, row) => sum + row.amount, 0n);
    return renderTextPdf(`Payout statement - ${names[0]?.name ?? 'Provider'}`, [
      `Batch ${batchId}`,
      '',
      ...rows.map(row => `${row.requestedAt.toISOString().slice(0, 10)}  PKR ${formatPaisa(row.amount)}  ${row.status}  ${row.institution} ****${row.last4}`),
      '',
      `Total: PKR ${formatPaisa(total)}`
    ]);
  }

  /**
   * The bank's answer, per payout. PAID: D PAYOUT_CLEARING / C GATEWAY_CLEARING. FAILED: the money goes straight back —
   * D PAYOUT_CLEARING / C PROVIDER_WALLET (a REVERSAL) — with the reason stored, so the provider can request again. Idempotent per payout.
   */
  async markBatch(batchId: string, financeUserId: string, results: readonly { payoutId: string; status: 'PAID' | 'FAILED'; failureReason?: string | undefined }[] | undefined) {
    return this.prisma.$transaction(async tx => {
      const batch = await tx.$queryRaw<{ status: string }[]>(Prisma.sql`SELECT status::text FROM payout_batches WHERE id = ${batchId}::uuid FOR UPDATE`);
      if (batch[0] === undefined) throw notFound('Payout batch');
      const inBatch = await tx.$queryRaw<{ id: string; providerId: string; amountPaisa: bigint; status: string }[]>(
        Prisma.sql`SELECT id, provider_id as "providerId", amount_paisa as "amountPaisa", status::text FROM payouts WHERE batch_id = ${batchId}::uuid FOR UPDATE`
      );
      const decided = new Map((results ?? inBatch.map(payout => ({ payoutId: payout.id, status: 'PAID' as const, failureReason: undefined }))).map(entry => [entry.payoutId, entry]));
      for (const id of decided.keys()) if (!inBatch.some(payout => payout.id === id)) throw badRequest(`Payout ${id} is not in this batch`);
      let paid = 0;
      let failed = 0;
      for (const payout of inBatch) {
        const result = decided.get(payout.id);
        if (result === undefined || payout.status !== 'IN_BATCH') continue;
        if (result.status === 'PAID') {
          await this.ledger.post(tx, {
            type: 'PAYOUT_CONFIRM', idempotencyKey: `payout-confirm:${payout.id}`, memo: 'Payout paid by the bank', createdBy: financeUserId,
            lines: [
              { account: 'PAYOUT_CLEARING', direction: 'DEBIT', amountPaisa: payout.amountPaisa },
              { account: 'GATEWAY_CLEARING', direction: 'CREDIT', amountPaisa: payout.amountPaisa }
            ]
          });
          await tx.$executeRaw(Prisma.sql`UPDATE payouts SET status = 'PAID'::payout_status, paid_at = now() WHERE id = ${payout.id}::uuid`);
          await appendOutboxEvent(tx, { aggregate: 'payout', aggregateId: payout.id, type: 'payout.paid', payload: { payoutId: payout.id, providerId: payout.providerId, amountPaisa: payout.amountPaisa.toString() } });
          paid += 1;
        } else {
          await this.ledger.post(tx, {
            type: 'REVERSAL', idempotencyKey: `payout-reversal:${payout.id}`, memo: result.failureReason ?? 'Payout failed', createdBy: financeUserId,
            lines: [
              { account: 'PAYOUT_CLEARING', direction: 'DEBIT', amountPaisa: payout.amountPaisa },
              { account: 'PROVIDER_WALLET', direction: 'CREDIT', amountPaisa: payout.amountPaisa, ownerUserId: payout.providerId }
            ]
          });
          await tx.$executeRaw(Prisma.sql`UPDATE payouts SET status = 'FAILED'::payout_status, failure_reason = ${result.failureReason ?? 'Rejected by the bank'} WHERE id = ${payout.id}::uuid`);
          await this.debt.refreshBlock(tx, payout.providerId);
          failed += 1;
        }
      }
      const remaining = await tx.$queryRaw<{ pending: bigint; failed: bigint }[]>(
        Prisma.sql`SELECT count(*) FILTER (WHERE status = 'IN_BATCH')::bigint as pending, count(*) FILTER (WHERE status = 'FAILED')::bigint as failed FROM payouts WHERE batch_id = ${batchId}::uuid`
      );
      const pending = remaining[0]?.pending ?? 0n;
      const status = pending > 0n ? 'EXPORTED' : (remaining[0]?.failed ?? 0n) > 0n ? 'PARTIALLY_FAILED' : 'PAID';
      await tx.$executeRaw(Prisma.sql`UPDATE payout_batches SET status = ${status}::payout_batch_status, paid_at = CASE WHEN ${status} = 'EXPORTED' THEN NULL ELSE now() END WHERE id = ${batchId}::uuid`);
      await this.audit.append({ actorUserId: financeUserId, actorRole: 'FINANCE', action: 'payout.batch.settle', entityType: 'payout_batch', entityId: batchId, after: { paid, failed, status } }, tx);
      return { id: batchId, status, paid, failed };
    });
  }
}

