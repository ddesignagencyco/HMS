// apps/api/src/payment/finance.service.ts
import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { paisaToNumber } from '@smart-home/domain';
import { DomainError, badRequest, notFound } from '../common/domain-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { AuditService } from '../platform/audit.service.js';
import { PaymentsService } from './payments.service.js';

const money = (value: bigint | null): number | null => (value === null ? null : paisaToNumber(value));

/** Statuses in which a booking's money is being held with nothing about to release it automatically — the only place a manual refund makes sense. */
const MANUAL_REFUND_STATUSES = new Set(['DISPUTED']);

/** FR-PY-06..08: finance's read views over the ledger, and the manual refund. Every figure comes from the ledger; nothing here keeps its own total. */
@Injectable()
export class FinanceService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PaymentsService) private readonly payments: PaymentsService,
    @Inject(AuditService) private readonly audit: AuditService
  ) {}

  /** Customer money currently held per booking, and what state that booking is in. */
  async escrow() {
    const rows = await this.prisma.$queryRaw<{ bookingId: string; code: string; status: string; paymentMode: string; providerId: string | null; heldPaisa: bigint; finalPaisa: bigint | null }[]>(
      Prisma.sql`SELECT a.booking_id as "bookingId", bk.code, bk.status::text, bk.payment_mode::text as "paymentMode", bk.provider_id as "providerId", b.balance as "heldPaisa", bk.final_amount_paisa as "finalPaisa"
        FROM ledger_accounts a JOIN account_balances b ON b.account_id = a.id JOIN bookings bk ON bk.id = a.booking_id WHERE a.type = 'ESCROW' AND b.balance > 0 ORDER BY b.updated_at DESC LIMIT 500`
    );
    const total = rows.reduce((sum, row) => sum + row.heldPaisa, 0n);
    return { totalHeldPaisa: paisaToNumber(total), items: rows.map(row => ({ ...row, heldPaisa: paisaToNumber(row.heldPaisa), finalPaisa: money(row.finalPaisa) })) };
  }

  async refunds(status: string | undefined) {
    const rows = await this.prisma.$queryRaw<{ id: string; bookingCode: string | null; amountPaisa: bigint; reasonCode: string; reasonText: string | null; status: string; gateway: string; gatewayRef: string | null; createdAt: Date; completedAt: Date | null }[]>(
      Prisma.sql`SELECT r.id, b.code as "bookingCode", r.amount_paisa as "amountPaisa", r.reason_code as "reasonCode", r.reason_text as "reasonText", r.status::text, p.gateway, p.gateway_ref as "gatewayRef", r.created_at as "createdAt", r.completed_at as "completedAt"
        FROM refunds r JOIN payments p ON p.id = r.payment_id LEFT JOIN bookings b ON b.id = r.booking_id WHERE (${status ?? null}::text IS NULL OR r.status::text = ${status ?? null}) ORDER BY r.created_at DESC LIMIT 200`
    );
    return { items: rows.map(row => ({ ...row, amountPaisa: paisaToNumber(row.amountPaisa) })) };
  }

  /**
   * A refund finance decides on. It comes out of the booking's escrow and goes back to the card that paid, with the reason stored
   * (FR-PY-07). Only for a disputed booking, whose money is frozen and not about to release — anywhere else the ordinary flows own the money.
   */
  async refund(financeUserId: string, input: { bookingId: string; amountPaisa: number; reasonCode: string; reasonText?: string | undefined }) {
    const refundIds = await this.prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<{ status: string }[]>(Prisma.sql`SELECT status::text FROM bookings WHERE id = ${input.bookingId}::uuid FOR UPDATE`);
      if (rows[0] === undefined) throw notFound('Booking');
      if (!MANUAL_REFUND_STATUSES.has(rows[0].status)) throw new DomainError('CONFLICT', `A refund can only be issued by hand for a disputed booking (this one is ${rows[0].status})`);
      const escrow = await tx.$queryRaw<{ balance: bigint }[]>(
        Prisma.sql`SELECT coalesce(b.balance, 0)::bigint as balance FROM ledger_accounts a LEFT JOIN account_balances b ON b.account_id = a.id WHERE a.type = 'ESCROW' AND a.booking_id = ${input.bookingId}::uuid`
      );
      const held = escrow[0]?.balance ?? 0n;
      if (BigInt(input.amountPaisa) > held) throw badRequest(`Only ${paisaToNumber(held)} paisa is held for this booking`);
      const ids = await this.payments.queueRefund(tx, { bookingId: input.bookingId, amountPaisa: BigInt(input.amountPaisa), reasonCode: input.reasonCode, idempotencyKey: `finance:${randomUUID()}`, requestedBy: financeUserId });
      if (ids.length === 0) throw badRequest('There is no captured payment to refund on this booking');
      await tx.$executeRaw(Prisma.sql`UPDATE refunds SET reason_text = ${input.reasonText ?? null} WHERE id IN (${Prisma.join(ids.map(id => Prisma.sql`${id}::uuid`))})`);
      await this.audit.append({ actorUserId: financeUserId, actorRole: 'FINANCE', action: 'refund.manual', entityType: 'booking', entityId: input.bookingId, after: { amountPaisa: input.amountPaisa, reasonCode: input.reasonCode } }, tx);
      return ids;
    });
    for (const id of refundIds) await this.payments.settleRefund(id).catch(() => undefined);
    return { refundIds };
  }

  /**
   * Cash jobs, provider by provider: how many were settled, the commission that produced, what is still authorised-but-unconfirmed (the provider
   * may be holding the customer's cash), and the provider's current debt. The reconciliation finance does against what providers say they collected.
   */
  async cashReconciliation() {
    const rows = await this.prisma.$queryRaw<
      { providerId: string; providerName: string; settledJobs: bigint; collectedPaisa: bigint; commissionPaisa: bigint; awaitingJobs: bigint; awaitingPaisa: bigint; oldestAwaiting: Date | null; walletPaisa: bigint }[]
    >(
      Prisma.sql`SELECT b.provider_id as "providerId", trim(u.first_name || ' ' || u.last_name) as "providerName",
          count(*) FILTER (WHERE b.payment_status = 'CASH_SETTLED')::bigint as "settledJobs",
          coalesce(sum(b.final_amount_paisa) FILTER (WHERE b.payment_status = 'CASH_SETTLED'), 0)::bigint as "collectedPaisa",
          coalesce(sum((b.final_amount_paisa + b.discount_paisa) * b.commission_rate_bp / 10000) FILTER (WHERE b.payment_status = 'CASH_SETTLED'), 0)::bigint as "commissionPaisa",
          count(*) FILTER (WHERE b.status IN ('VERIFIED','AUTO_RELEASED') AND b.payment_status = 'CASH_DUE')::bigint as "awaitingJobs",
          coalesce(sum(b.final_amount_paisa) FILTER (WHERE b.status IN ('VERIFIED','AUTO_RELEASED') AND b.payment_status = 'CASH_DUE'), 0)::bigint as "awaitingPaisa",
          min(b.updated_at) FILTER (WHERE b.status IN ('VERIFIED','AUTO_RELEASED') AND b.payment_status = 'CASH_DUE') as "oldestAwaiting",
          coalesce((SELECT sum(ab.balance) FROM ledger_accounts la JOIN account_balances ab ON ab.account_id = la.id WHERE la.type = 'PROVIDER_WALLET' AND la.owner_user_id = b.provider_id), 0)::bigint as "walletPaisa"
        FROM bookings b JOIN users u ON u.id = b.provider_id WHERE b.payment_mode = 'CASH' AND b.provider_id IS NOT NULL AND b.payment_status IN ('CASH_SETTLED','CASH_DUE')
        GROUP BY b.provider_id, u.first_name, u.last_name HAVING count(*) FILTER (WHERE b.payment_status = 'CASH_SETTLED' OR b.status IN ('VERIFIED','AUTO_RELEASED')) > 0 ORDER BY "awaitingPaisa" DESC, "collectedPaisa" DESC LIMIT 500`
    );
    return {
      items: rows.map(row => ({
        providerId: row.providerId, providerName: row.providerName, settledJobs: Number(row.settledJobs), collectedPaisa: paisaToNumber(row.collectedPaisa), commissionPaisa: paisaToNumber(row.commissionPaisa),
        awaitingConfirmationJobs: Number(row.awaitingJobs), awaitingConfirmationPaisa: paisaToNumber(row.awaitingPaisa), oldestAwaitingSince: row.oldestAwaiting, walletPaisa: paisaToNumber(row.walletPaisa)
      }))
    };
  }

  /** Providers whose wallet is negative: what they owe the platform in commission, and whether that has stopped their offers. */
  async debts() {
    const rows = await this.prisma.$queryRaw<{ providerId: string; providerName: string; balance: bigint; reason: string | null }[]>(
      Prisma.sql`SELECT a.owner_user_id as "providerId", trim(u.first_name || ' ' || u.last_name) as "providerName", sum(b.balance)::bigint as balance, p.offer_blocked_reason as reason
        FROM ledger_accounts a JOIN account_balances b ON b.account_id = a.id JOIN users u ON u.id = a.owner_user_id JOIN providers p ON p.user_id = a.owner_user_id
        WHERE a.type = 'PROVIDER_WALLET' GROUP BY a.owner_user_id, u.first_name, u.last_name, p.offer_blocked_reason HAVING sum(b.balance) < 0 ORDER BY sum(b.balance)`
    );
    return { totalDebtPaisa: paisaToNumber(-rows.reduce((sum, row) => sum + row.balance, 0n)), items: rows.map(row => ({ providerId: row.providerId, providerName: row.providerName, debtPaisa: paisaToNumber(-row.balance), offersBlocked: row.reason !== null, offerBlockedReason: row.reason })) };
  }

  /** The ledger explorer: entries for one account, booking or account type, newest first, paged by entry id. */
  async ledger(filter: { accountType?: string | undefined; ownerId?: string | undefined; bookingId?: string | undefined; before?: number | undefined; limit: number }) {
    const rows = await this.prisma.$queryRaw<{ entryId: bigint; transactionId: string; type: string; memo: string | null; bookingCode: string | null; account: string; ownerId: string | null; direction: string; amountPaisa: bigint; createdAt: Date }[]>(
      Prisma.sql`SELECT e.id as "entryId", t.id as "transactionId", t.type::text, t.memo, bk.code as "bookingCode", a.type::text as account, a.owner_user_id as "ownerId", e.direction::text, e.amount_paisa as "amountPaisa", e.created_at as "createdAt"
        FROM ledger_entries e JOIN ledger_transactions t ON t.id = e.transaction_id JOIN ledger_accounts a ON a.id = e.account_id LEFT JOIN bookings bk ON bk.id = t.booking_id
        WHERE (${filter.accountType ?? null}::text IS NULL OR a.type::text = ${filter.accountType ?? null})
          AND (${filter.ownerId ?? null}::uuid IS NULL OR a.owner_user_id = ${filter.ownerId ?? null}::uuid)
          AND (${filter.bookingId ?? null}::uuid IS NULL OR t.booking_id = ${filter.bookingId ?? null}::uuid)
          AND (${filter.before ?? null}::bigint IS NULL OR e.id < ${filter.before ?? null}::bigint)
        ORDER BY e.id DESC LIMIT ${filter.limit}`
    );
    const items = rows.map(row => ({ ...row, entryId: Number(row.entryId), amountPaisa: paisaToNumber(row.amountPaisa) }));
    return { items, nextBefore: items.length === filter.limit ? items[items.length - 1]?.entryId ?? null : null };
  }
}
