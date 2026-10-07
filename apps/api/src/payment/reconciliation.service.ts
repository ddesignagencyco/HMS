// apps/api/src/payment/reconciliation.service.ts
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { AuditService, appendOutboxEvent } from '../platform/audit.service.js';
import { QueueRegistry } from '../queues/queue.registry.js';

export type Drift = { check: string; subject: string; expected: string; actual: string };

export type ReconciliationReport = { ranAt: string; checks: number; drift: Drift[] };

/**
 * FR-PY-06 / TRD §13: every night, prove the books still add up. The ledger entries are the truth; everything else — the derived
 * account balances, the payments table, the escrow of each booking — is checked against them. A single mismatch is a drift: it is
 * logged, written to the audit log and raised as an event, because unexplained money movement is never something to smooth over.
 */
@Injectable()
export class ReconciliationService implements OnModuleInit {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(QueueRegistry) private readonly queues: QueueRegistry
  ) {}

  onModuleInit(): void {
    this.queues.registerScheduled('ledger.reconcile', async () => void (await this.run(null)));
  }

  async run(triggeredBy: string | null): Promise<ReconciliationReport> {
    const drift: Drift[] = [];

    // 1. Derived balances equal the sum of their entries.
    const balances = await this.prisma.$queryRaw<{ id: string; type: string; debit: bigint; credit: bigint; d: bigint; c: bigint }[]>(
      Prisma.sql`SELECT b.account_id as id, a.type::text as type, b.debit_total as debit, b.credit_total as credit, coalesce(e.d, 0)::bigint as d, coalesce(e.c, 0)::bigint as c
        FROM account_balances b JOIN ledger_accounts a ON a.id = b.account_id LEFT JOIN (
          SELECT account_id, sum(amount_paisa) FILTER (WHERE direction = 'DEBIT') as d, sum(amount_paisa) FILTER (WHERE direction = 'CREDIT') as c FROM ledger_entries GROUP BY account_id
        ) e ON e.account_id = b.account_id WHERE b.debit_total <> coalesce(e.d, 0) OR b.credit_total <> coalesce(e.c, 0)`
    );
    for (const row of balances) drift.push({ check: 'account_balance', subject: `${row.type} ${row.id}`, expected: `debit ${row.d} credit ${row.c}`, actual: `debit ${row.debit} credit ${row.credit}` });

    // 2. Every ledger transaction balances.
    const unbalanced = await this.prisma.$queryRaw<{ id: string; d: bigint; c: bigint }[]>(
      Prisma.sql`SELECT t.id, coalesce(sum(e.amount_paisa) FILTER (WHERE e.direction = 'DEBIT'), 0)::bigint as d, coalesce(sum(e.amount_paisa) FILTER (WHERE e.direction = 'CREDIT'), 0)::bigint as c
        FROM ledger_transactions t LEFT JOIN ledger_entries e ON e.transaction_id = t.id GROUP BY t.id HAVING coalesce(sum(e.amount_paisa) FILTER (WHERE e.direction = 'DEBIT'), 0) <> coalesce(sum(e.amount_paisa) FILTER (WHERE e.direction = 'CREDIT'), 0) OR count(e.id) < 2`
    );
    for (const row of unbalanced) drift.push({ check: 'unbalanced_transaction', subject: row.id, expected: 'debit = credit', actual: `debit ${row.d} credit ${row.c}` });

    // 3. Gateway records (payments) against the ledger: what the gateway says it captured/refunded is what GATEWAY_CLEARING was told.
    const captures = await this.prisma.$queryRaw<{ id: string; amount: bigint; posted: bigint }[]>(
      Prisma.sql`SELECT p.id, p.amount_paisa as amount, coalesce((SELECT sum(e.amount_paisa) FROM ledger_transactions t JOIN ledger_entries e ON e.transaction_id = t.id JOIN ledger_accounts a ON a.id = e.account_id
            WHERE t.idempotency_key = 'capture:' || p.id::text AND a.type = 'GATEWAY_CLEARING' AND e.direction = 'DEBIT'), 0)::bigint as posted
        FROM payments p WHERE p.status IN ('CAPTURED','PARTIALLY_REFUNDED','REFUNDED')`
    );
    for (const row of captures) if (row.amount !== row.posted) drift.push({ check: 'payment_capture', subject: row.id, expected: `${row.amount}`, actual: `${row.posted}` });
    const refunds = await this.prisma.$queryRaw<{ id: string; amount: bigint; posted: bigint }[]>(
      Prisma.sql`SELECT r.id, r.amount_paisa as amount, coalesce((SELECT sum(e.amount_paisa) FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id WHERE e.transaction_id = r.ledger_transaction_id AND a.type = 'GATEWAY_CLEARING' AND e.direction = 'CREDIT'), 0)::bigint as posted
        FROM refunds r WHERE r.status <> 'FAILED'`
    );
    for (const row of refunds) if (row.amount !== row.posted) drift.push({ check: 'refund_posting', subject: row.id, expected: `${row.amount}`, actual: `${row.posted}` });
    const refundTotals = await this.prisma.$queryRaw<{ id: string; recorded: bigint; summed: bigint }[]>(
      Prisma.sql`SELECT p.id, p.refunded_paisa as recorded, coalesce((SELECT sum(r.amount_paisa) FROM refunds r WHERE r.payment_id = p.id AND r.status <> 'FAILED'), 0)::bigint as summed FROM payments p WHERE p.refunded_paisa <> coalesce((SELECT sum(r.amount_paisa) FROM refunds r WHERE r.payment_id = p.id AND r.status <> 'FAILED'), 0)`
    );
    for (const row of refundTotals) drift.push({ check: 'payment_refunded_total', subject: row.id, expected: `${row.summed}`, actual: `${row.recorded}` });

    // 4. Escrow is never overdrawn, and a finished booking holds nothing.
    //
    // `NO_SHOW` belongs in this list because a no-show refunds the customer in full,
    // so escrow must be empty afterwards. It was missing, which is why an online
    // no-show could strand the captured amount indefinitely: the status is terminal,
    // so nothing else would ever move the money, and the one job whose job is to
    // notice exactly this was not looking at that status.
    const escrow = await this.prisma.$queryRaw<{ bookingId: string; balance: bigint }[]>(
      Prisma.sql`SELECT a.booking_id as "bookingId", b.balance FROM ledger_accounts a JOIN account_balances b ON b.account_id = a.id WHERE a.type = 'ESCROW' AND (b.balance < 0 OR (b.balance > 0 AND EXISTS (SELECT 1 FROM bookings bk WHERE bk.id = a.booking_id AND bk.status IN ('PAYMENT_RELEASED','CLOSED','CANCELLED_CUSTOMER','CANCELLED_PROVIDER','UNFULFILLED','ABANDONED','NO_SHOW'))))`
    );
    for (const row of escrow) drift.push({ check: 'escrow', subject: row.bookingId, expected: '0 once a booking is finished, never negative', actual: `${row.balance}` });

    const report: ReconciliationReport = { ranAt: new Date().toISOString(), checks: 6, drift };
    await this.prisma.$transaction(async tx => {
      await this.audit.append({ actorUserId: triggeredBy, actorRole: triggeredBy === null ? 'SYSTEM' : 'FINANCE', action: 'ledger.reconcile', entityType: 'ledger', entityId: 'all', after: { checks: report.checks, drift: drift.length } }, tx);
      if (drift.length > 0) await appendOutboxEvent(tx, { aggregate: 'ledger', aggregateId: 'all', type: 'ledger.drift_detected', payload: { drift: drift.slice(0, 50) } });
    });
    if (drift.length > 0) this.logger.error(`Ledger reconciliation found ${drift.length} drift(s): ${JSON.stringify(drift.slice(0, 5))}`);
    return report;
  }
}
