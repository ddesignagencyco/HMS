// apps/api/test/integration/money-safety.test.ts
//
// SHM-045: whole-database invariants that must hold however the rest of the suite
// (and every earlier run of it) has exercised bookings, payments and refunds.
// The concurrency and replay cases live next to the flows they attack: 50 concurrent checkouts,
// webhook ×10 and refund-once are in booking-checkout.test.ts, final > approved in booking-completion.test.ts.
import { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';

const prisma = new PrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

describe('SHM-045: money and state invariants across the whole database', () => {
  it('every booking’s status is the destination of its latest history row (no transition without a record; rows the invariant suite inserts directly, with no history at all, are out of scope)', async () => {
    const drift = await prisma.$queryRaw<{ id: string; status: string; last: string | null }[]>(
      Prisma.sql`SELECT b.id, b.status::text, (SELECT h.to_status::text FROM booking_status_history h WHERE h.booking_id = b.id ORDER BY h.id DESC LIMIT 1) as last
        FROM bookings b WHERE EXISTS (SELECT 1 FROM booking_status_history h WHERE h.booking_id = b.id) AND b.status::text IS DISTINCT FROM (SELECT h.to_status::text FROM booking_status_history h WHERE h.booking_id = b.id ORDER BY h.id DESC LIMIT 1)`
    );
    expect(drift).toEqual([]);
  });

  it('history is a connected chain: each row starts where the previous one ended', async () => {
    const broken = await prisma.$queryRaw<{ bookingId: string; id: bigint }[]>(
      Prisma.sql`SELECT booking_id as "bookingId", id FROM (
          SELECT id, booking_id, from_status, lag(to_status) OVER (PARTITION BY booking_id ORDER BY id) as previous FROM booking_status_history
        ) chain WHERE previous IS NOT NULL AND from_status IS DISTINCT FROM previous AND from_status IS NOT NULL`
    );
    expect(broken).toEqual([]);
  });

  it('every ledger transaction balances: debits equal credits, with at least two lines', async () => {
    const unbalanced = await prisma.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT t.id FROM ledger_transactions t JOIN ledger_entries e ON e.transaction_id = t.id
        GROUP BY t.id HAVING sum(CASE WHEN e.direction = 'DEBIT' THEN e.amount_paisa ELSE 0 END) <> sum(CASE WHEN e.direction = 'CREDIT' THEN e.amount_paisa ELSE 0 END) OR count(*) < 2`
    );
    expect(unbalanced).toEqual([]);
  });

  it('no booking’s escrow is ever overdrawn', async () => {
    const overdrawn = await prisma.$queryRaw<{ bookingId: string; balance: bigint }[]>(
      Prisma.sql`SELECT a.booking_id as "bookingId", b.balance FROM ledger_accounts a JOIN account_balances b ON b.account_id = a.id WHERE a.type = 'ESCROW' AND b.balance < 0`
    );
    expect(overdrawn).toEqual([]);
  });

  it('the derived account balances equal the sum of their entries', async () => {
    const mismatched = await prisma.$queryRaw<{ accountId: string }[]>(
      Prisma.sql`SELECT b.account_id as "accountId" FROM account_balances b LEFT JOIN (
          SELECT account_id, sum(CASE WHEN direction = 'DEBIT' THEN amount_paisa ELSE 0 END) as d, sum(CASE WHEN direction = 'CREDIT' THEN amount_paisa ELSE 0 END) as c FROM ledger_entries GROUP BY account_id
        ) e ON e.account_id = b.account_id WHERE b.debit_total <> coalesce(e.d, 0) OR b.credit_total <> coalesce(e.c, 0)`
    );
    expect(mismatched).toEqual([]);
  });

  it('a payment is captured at most once, and refunds never exceed what was captured', async () => {
    const duplicated = await prisma.$queryRaw<{ paymentKey: string }[]>(
      Prisma.sql`SELECT idempotency_key as "paymentKey" FROM ledger_transactions WHERE type = 'CAPTURE' GROUP BY idempotency_key HAVING count(*) > 1`
    );
    expect(duplicated).toEqual([]);
    const overRefunded = await prisma.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT p.id FROM payments p WHERE p.refunded_paisa > p.amount_paisa OR p.refunded_paisa <> coalesce((SELECT sum(r.amount_paisa) FROM refunds r WHERE r.payment_id = p.id), 0)`
    );
    expect(overRefunded).toEqual([]);
  });

  it('every captured payment has exactly one CAPTURE ledger transaction, and every CAPTURE has a captured payment', async () => {
    const missing = await prisma.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT p.id FROM payments p WHERE p.status IN ('CAPTURED','PARTIALLY_REFUNDED','REFUNDED') AND NOT EXISTS (SELECT 1 FROM ledger_transactions t WHERE t.idempotency_key = 'capture:' || p.id::text)`
    );
    expect(missing).toEqual([]);
    const orphaned = await prisma.$queryRaw<{ key: string }[]>(
      Prisma.sql`SELECT t.idempotency_key as key FROM ledger_transactions t WHERE t.type = 'CAPTURE' AND NOT EXISTS (SELECT 1 FROM payments p WHERE 'capture:' || p.id::text = t.idempotency_key AND p.status <> 'INITIATED')`
    );
    expect(orphaned).toEqual([]);
  });

  it('a booking never ends up with two live invoices, or a final amount above its approved total', async () => {
    const bad = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM bookings WHERE final_amount_paisa > approved_total_paisa`);
    expect(bad).toEqual([]);
    const mismatched = await prisma.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT i.id FROM invoices i JOIN bookings b ON b.id = i.booking_id WHERE i.total_paisa <> b.final_amount_paisa OR i.total_paisa <> i.subtotal_paisa + i.surcharge_paisa - i.discount_paisa`
    );
    expect(mismatched).toEqual([]);
  });

  it('every completed job was handed to verification exactly once', async () => {
    const unqueued = await prisma.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT b.id FROM bookings b WHERE b.status = 'AWAITING_VERIFICATION' AND (SELECT count(*) FROM verification_calls v WHERE v.booking_id = b.id) <> 1`
    );
    expect(unqueued).toEqual([]);
  });
});
