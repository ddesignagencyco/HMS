// apps/api/test/integration/verification-submit.test.ts
//
// SHM-056 (guards) / SHM-057: submitting a verification, and what it does to the job, the money and the ratings.
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { commissionOnPaisa } from '@smart-home/domain';
import { callApi, createTestApp, postJson, adminSession } from './harness.js';
import { agentSession, answeredCall, bearer, claim, completedJob, dropLocks, freezeInsideCallingHours, newProvider, prisma, satisfied, unfreeze, type Job, type Provider } from './flow.js';

let app: NestExpressApplication;
let close: () => Promise<void>;
let provider: Provider;
let agent: { accessToken: string; userId: string };

beforeAll(async () => {
  const started = await createTestApp();
  app = started.app;
  close = started.close;
  freezeInsideCallingHours(app);
  provider = await newProvider(app);
  agent = await agentSession(app, 'agent1');
});

afterEach(async () => {
  await dropLocks(agent.userId);
});

afterAll(async () => {
  unfreeze(app);
  await close();
  await prisma.$disconnect();
});

type Booking = { status: string; paymentStatus: string; finalAmountPaisa: number; approvedTotalPaisa: number };

const submit = (job: Job, body: Record<string, unknown>) => callApi<{ outcome?: string; bookingStatus?: string; released?: boolean; reworkStarted?: boolean; disputeOpened?: boolean; code?: string; errors?: { path: string }[] }>(app, `/agent/verifications/${job.verificationId}/submit`, bearer(agent.accessToken, postJson(body)));

/** Claims the call, logs an answered attempt, ready to submit. */
const readyToSubmit = async (job: Job): Promise<void> => {
  const claimed = await claim(app, agent.accessToken, job.verificationId);
  expect(claimed.status).toBe(200);
  const logged = await answeredCall(app, agent.accessToken, job.verificationId);
  expect(logged.status).toBe(201);
};

const bookingOf = async (job: Job): Promise<Booking> => (await callApi<Booking>(app, `/bookings/${job.id}`, bearer(job.customer.accessToken))).body;

const balance = async (type: string, where: { bookingId?: string; ownerId?: string }): Promise<bigint> => {
  const rows = await prisma.$queryRaw<{ balance: bigint }[]>(
    Prisma.sql`SELECT coalesce(sum(b.balance), 0)::bigint as balance FROM ledger_accounts a JOIN account_balances b ON b.account_id = a.id
      WHERE a.type = ${type}::account_type AND (${where.bookingId ?? null}::uuid IS NULL OR a.booking_id = ${where.bookingId ?? null}::uuid) AND (${where.ownerId ?? null}::uuid IS NULL OR a.owner_user_id = ${where.ownerId ?? null}::uuid)`
  );
  return rows[0]?.balance ?? 0n;
};

describe('SHM-056: outcome guards', () => {
  it('will not submit before a call has been answered and logged (409)', async () => {
    const job = await completedJob(app, provider);
    await claim(app, agent.accessToken, job.verificationId);
    const response = await submit(job, satisfied);
    expect(response.status).toBe(409);
  });

  it('refuses a submission without the recording consent line read: 422 naming the field', async () => {
    const job = await completedJob(app, provider);
    await readyToSubmit(job);
    const response = await submit(job, { ...satisfied, consentLineRead: false });
    expect(response.status).toBe(422);
    expect(response.body.errors?.map(error => error.path)).toContain('consentLineRead');
    expect((await bookingOf(job)).status).toBe('AWAITING_VERIFICATION');
  });

  it('allows only DISPUTED when an extra charge was demanded, or no work was done', async () => {
    const job = await completedJob(app, provider);
    await readyToSubmit(job);
    const demanded = await submit(job, { ...satisfied, extraChargeDemanded: true, extraChargeAmountPaisa: 200_000 });
    expect(demanded.status).toBe(422);
    expect(demanded.body.errors?.map(error => error.path)).toContain('outcome');
    const none = await submit(job, { ...satisfied, workCompleted: 'NONE', outcome: 'REWORK_REQUIRED' });
    expect(none.status).toBe(422);
    const noAmount = await submit(job, { ...satisfied, extraChargeDemanded: true, outcome: 'DISPUTED' });
    expect(noAmount.status).toBe(422);
    expect(noAmount.body.errors?.map(error => error.path)).toContain('extraChargeAmountPaisa');
  });

  it('will not release without the customer’s spoken consent to release', async () => {
    const job = await completedJob(app, provider);
    await readyToSubmit(job);
    const response = await submit(job, { ...satisfied, consentToRelease: false });
    expect(response.status).toBe(422);
    expect(response.body.errors?.map(error => error.path)).toContain('consentToRelease');
  });

  it('is refused with 403 if the agent became linked to the job after claiming it', async () => {
    const job = await completedJob(app, provider);
    await readyToSubmit(job);
    const admin = await adminSession(app);
    await prisma.$executeRaw(Prisma.sql`INSERT INTO staff_conflicts(staff_user_id, other_user_id, reason, created_by) VALUES (${agent.userId}::uuid, ${provider.id}::uuid, 'declared late', ${admin.userId}::uuid) ON CONFLICT DO NOTHING`);
    try {
      const response = await submit(job, satisfied);
      expect(response.status).toBe(403);
      expect(response.body.code).toBe('CONFLICT_OF_INTEREST');
    } finally {
      await prisma.$executeRaw(Prisma.sql`DELETE FROM staff_conflicts WHERE staff_user_id = ${agent.userId}::uuid AND other_user_id = ${provider.id}::uuid`).catch(() => undefined);
    }
  });
});

describe('SHM-057: a verified online job releases its money', () => {
  it('posts the release exactly as TRD §6.3 says, and the whole job sums to zero in the ledger', async () => {
    const job = await completedJob(app, provider, { mode: 'ONLINE' });
    const before = await bookingOf(job);
    await readyToSubmit(job);
    const walletBefore = await balance('PROVIDER_WALLET', { ownerId: provider.id });

    const response = await submit(job, satisfied);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ outcome: 'VERIFIED_SATISFIED', bookingStatus: 'PAYMENT_RELEASED', released: true });

    const after = await bookingOf(job);
    expect(after.status).toBe('PAYMENT_RELEASED');
    expect(after.paymentStatus).toBe('RELEASED');

    const rate = (await prisma.$queryRaw<{ bp: number }[]>(Prisma.sql`SELECT commission_rate_bp as bp FROM bookings WHERE id = ${job.id}::uuid`))[0]!.bp;
    const final = BigInt(before.finalAmountPaisa ?? before.approvedTotalPaisa);
    const commission = commissionOnPaisa(final, BigInt(rate));

    const lines = await prisma.$queryRaw<{ account: string; direction: string; amount: bigint }[]>(
      Prisma.sql`SELECT a.type::text as account, e.direction::text as direction, e.amount_paisa as amount FROM ledger_transactions t JOIN ledger_entries e ON e.transaction_id = t.id JOIN ledger_accounts a ON a.id = e.account_id
        WHERE t.idempotency_key = ${`release:${job.id}`} ORDER BY e.id`
    );
    expect(lines).toEqual([
      { account: 'ESCROW', direction: 'DEBIT', amount: final },
      { account: 'PROVIDER_WALLET', direction: 'CREDIT', amount: final - commission },
      { account: 'PLATFORM_COMMISSION', direction: 'CREDIT', amount: commission }
    ]);

    expect(await balance('ESCROW', { bookingId: job.id })).toBe(0n);
    expect((await balance('PROVIDER_WALLET', { ownerId: provider.id })) - walletBefore).toBe(final - commission);

    // Zero-sum across the job: every ledger transaction for it balances, and what the customer paid equals what the provider and the platform hold.
    const sums = await prisma.$queryRaw<{ debit: bigint; credit: bigint; clearing: bigint }[]>(
      Prisma.sql`SELECT coalesce(sum(e.amount_paisa) FILTER (WHERE e.direction = 'DEBIT'), 0)::bigint as debit, coalesce(sum(e.amount_paisa) FILTER (WHERE e.direction = 'CREDIT'), 0)::bigint as credit,
          coalesce(sum(e.amount_paisa) FILTER (WHERE e.direction = 'DEBIT' AND a.type = 'GATEWAY_CLEARING'), 0)::bigint as clearing
        FROM ledger_transactions t JOIN ledger_entries e ON e.transaction_id = t.id JOIN ledger_accounts a ON a.id = e.account_id WHERE t.booking_id = ${job.id}::uuid`
    );
    expect(sums[0]?.debit).toBe(sums[0]?.credit);
    expect(sums[0]?.clearing).toBe(final);

    const history = await prisma.$queryRaw<{ event: string; to: string; role: string; actor: string | null }[]>(
      Prisma.sql`SELECT event, to_status::text as "to", actor_role::text as role, actor_user_id as actor FROM booking_status_history WHERE booking_id = ${job.id}::uuid ORDER BY id DESC LIMIT 2`
    );
    expect(history.map(row => `${row.event}:${row.to}:${row.role}`)).toEqual(['release:PAYMENT_RELEASED:SYSTEM', 'verified:VERIFIED:AGENT']);
    expect(history[1]?.actor).toBe(agent.userId);
  });

  it('publishes the rating and the remark as "First L." — and no other way in', async () => {
    const job = await completedJob(app, provider, { mode: 'ONLINE' });
    await readyToSubmit(job);
    await submit(job, satisfied);
    const rating = await prisma.$queryRaw<{ score: string; quality: number; verificationId: string; name: string; body: string }[]>(
      Prisma.sql`SELECT r.score::text, r.quality, r.verification_call_id as "verificationId", m.display_name as name, m.body FROM ratings r JOIN remarks m ON m.rating_id = r.id WHERE r.booking_id = ${job.id}::uuid`
    );
    expect(rating).toHaveLength(1);
    expect(Number(rating[0]?.score)).toBe(4.5);
    expect(rating[0]?.verificationId).toBe(job.verificationId);
    expect(rating[0]?.body).toBe('Fixed the leak, tidy work.');
    expect(rating[0]?.name).toMatch(/^\S+( [A-Z]\.)?$/);
    expect(rating[0]?.name).not.toContain('Customer ');

    // Rating insert without a rating-producing verification is refused by the database itself.
    const other = await completedJob(app, provider, { mode: 'CASH' });
    await expect(
      prisma.$executeRaw(
        Prisma.sql`INSERT INTO ratings(verification_call_id, booking_id, provider_id, customer_id, quality, punctuality, conduct, cleanliness) VALUES (${other.verificationId}::uuid, ${other.id}::uuid, ${provider.id}::uuid, ${other.customer.id}::uuid, 5, 5, 5, 5)`
      )
    ).rejects.toThrow(/rating requires a submitted verification/);
  });

  it('makes the verification record immutable the moment it is submitted', async () => {
    const job = await completedJob(app, provider, { mode: 'ONLINE' });
    await readyToSubmit(job);
    await submit(job, satisfied);
    await expect(prisma.$executeRaw(Prisma.sql`UPDATE verification_calls SET quality = 1 WHERE id = ${job.verificationId}::uuid`)).rejects.toThrow(/immutable once submitted/);
    await expect(prisma.$executeRaw(Prisma.sql`DELETE FROM verification_calls WHERE id = ${job.verificationId}::uuid`)).rejects.toThrow(/cannot be deleted/);
  });

  it('the database refuses PAYMENT_RELEASED for a booking with no release-permitting verification', async () => {
    const job = await completedJob(app, provider, { mode: 'ONLINE' });
    await expect(
      prisma.$transaction(async tx => {
        await tx.$executeRaw(Prisma.sql`SET LOCAL app.transition_ctx = 'on'`);
        await tx.$executeRaw(Prisma.sql`UPDATE bookings SET status = 'PAYMENT_RELEASED'::booking_status WHERE id = ${job.id}::uuid`);
      })
    ).rejects.toThrow(/cannot be released without a release-permitting verification/);
    expect((await bookingOf(job)).status).toBe('AWAITING_VERIFICATION');
  });

  it('refunds the excess escrow when the provider charged less than was approved, and the provider is paid on what was charged', async () => {
    const job = await completedJob(app, provider, { mode: 'ONLINE', finalReduction: 20_000 });
    const booking = await bookingOf(job);
    await readyToSubmit(job);
    await submit(job, satisfied);

    const refunds = await prisma.$queryRaw<{ amount: bigint; reason: string; status: string }[]>(Prisma.sql`SELECT amount_paisa as amount, reason_code as reason, status::text FROM refunds WHERE booking_id = ${job.id}::uuid`);
    expect(refunds).toEqual([{ amount: 20_000n, reason: 'EXCESS_ESCROW', status: 'SUCCEEDED' }]);
    expect(await balance('ESCROW', { bookingId: job.id })).toBe(0n);
    const released = await prisma.$queryRaw<{ amount: bigint }[]>(
      Prisma.sql`SELECT e.amount_paisa as amount FROM ledger_transactions t JOIN ledger_entries e ON e.transaction_id = t.id JOIN ledger_accounts a ON a.id = e.account_id WHERE t.idempotency_key = ${`release:${job.id}`} AND a.type = 'ESCROW'`
    );
    expect(released[0]?.amount).toBe(BigInt(booking.finalAmountPaisa));
  });

  it('a coupon is absorbed by the platform: the provider is paid on the price before it', async () => {
    const code = `V${randomUUID().slice(0, 8)}`.toUpperCase();
    await prisma.$executeRaw(Prisma.sql`INSERT INTO coupons(code, kind, value, valid_from, valid_to) VALUES (${code}::citext, 'FIXED', 50000, now() - interval '1 day', now() + interval '1 day')`);
    const job = await completedJob(app, provider, { mode: 'ONLINE', couponCode: code });
    const booking = await bookingOf(job);
    const facts = (await prisma.$queryRaw<{ discount: bigint; rate: number }[]>(Prisma.sql`SELECT discount_paisa as discount, commission_rate_bp as rate FROM bookings WHERE id = ${job.id}::uuid`))[0]!;
    expect(facts.discount).toBe(50_000n);
    await readyToSubmit(job);
    await submit(job, satisfied);

    const gross = BigInt(booking.finalAmountPaisa) + facts.discount;
    const commission = commissionOnPaisa(gross, BigInt(facts.rate));
    const lines = await prisma.$queryRaw<{ account: string; direction: string; amount: bigint }[]>(
      Prisma.sql`SELECT a.type::text as account, e.direction::text as direction, e.amount_paisa as amount FROM ledger_transactions t JOIN ledger_entries e ON e.transaction_id = t.id JOIN ledger_accounts a ON a.id = e.account_id
        WHERE t.idempotency_key = ${`release:${job.id}`} ORDER BY e.id`
    );
    expect(lines).toEqual([
      { account: 'ESCROW', direction: 'DEBIT', amount: BigInt(booking.finalAmountPaisa) },
      { account: 'PROMO_EXPENSE', direction: 'DEBIT', amount: 50_000n },
      { account: 'PROVIDER_WALLET', direction: 'CREDIT', amount: gross - commission },
      { account: 'PLATFORM_COMMISSION', direction: 'CREDIT', amount: commission }
    ]);
  });

  it('VERIFIED_WITH_ISSUE still releases, but opens a complaint against the provider and flags them', async () => {
    const job = await completedJob(app, provider, { mode: 'ONLINE' });
    await readyToSubmit(job);
    const response = await submit(job, { ...satisfied, outcome: 'VERIFIED_WITH_ISSUE', remark: 'Left a mess' });
    expect(response.body.released).toBe(true);
    const complaint = await prisma.$queryRaw<{ source: string; against: string; status: string; category: string }[]>(
      Prisma.sql`SELECT source::text, against_user_id as against, status::text, category::text FROM complaints WHERE booking_id = ${job.id}::uuid`
    );
    expect(complaint).toEqual([{ source: 'VERIFICATION_AUTO', against: provider.id, status: 'OPEN', category: 'QUALITY' }]);
    const flags = await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*)::bigint as n FROM provider_flags WHERE booking_id = ${job.id}::uuid AND kind = 'VERIFIED_WITH_ISSUE'`);
    expect(flags[0]?.n).toBe(1n);
    const rating = await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*)::bigint as n FROM ratings WHERE booking_id = ${job.id}::uuid`);
    expect(rating[0]?.n).toBe(1n);
  });
});

describe('SHM-057: the other outcomes', () => {
  it('a verified cash job authorises the provider to collect but releases nothing yet', async () => {
    const job = await completedJob(app, provider, { mode: 'CASH' });
    await readyToSubmit(job);
    const response = await submit(job, satisfied);
    expect(response.body).toMatchObject({ bookingStatus: 'VERIFIED', released: false });
    const walletBefore = await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*)::bigint as n FROM ledger_transactions WHERE booking_id = ${job.id}::uuid AND type = 'RELEASE'`);
    expect(walletBefore[0]?.n).toBe(0n);
    const events = await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*)::bigint as n FROM outbox_events WHERE type = 'booking.cash_authorised' AND payload->>'bookingId' = ${job.id}`);
    expect(events[0]?.n).toBe(1n);
  });

  it('DISPUTED freezes the funds, opens exactly one dispute, and publishes no rating', async () => {
    const job = await completedJob(app, provider, { mode: 'ONLINE' });
    const booking = await bookingOf(job);
    await readyToSubmit(job);
    const response = await submit(job, { ...satisfied, extraChargeDemanded: true, extraChargeAmountPaisa: 300_000, consentToRelease: false, outcome: 'DISPUTED' });
    expect(response.body).toMatchObject({ bookingStatus: 'DISPUTED', disputeOpened: true, released: false });
    expect(await balance('ESCROW', { bookingId: job.id })).toBe(BigInt(booking.finalAmountPaisa));
    const disputes = await prisma.$queryRaw<{ origin: string; status: string }[]>(Prisma.sql`SELECT origin::text, status::text FROM disputes WHERE booking_id = ${job.id}::uuid`);
    expect(disputes).toEqual([{ origin: 'VERIFICATION', status: 'OPEN' }]);
    const ratings = await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*)::bigint as n FROM ratings WHERE booking_id = ${job.id}::uuid`);
    expect(ratings[0]?.n).toBe(0n);
  });

  it('REWORK_REQUIRED holds the funds, sends the provider back and gives the customer a fresh start code', async () => {
    const job = await completedJob(app, provider, { mode: 'ONLINE' });
    await readyToSubmit(job);
    const inboxBefore = (await callApi<{ items: unknown[] }>(app, '/dev/inbox?limit=200')).body.items.length;
    const response = await submit(job, { ...satisfied, workCompleted: 'PARTIAL', outcome: 'REWORK_REQUIRED' });
    expect(response.body).toMatchObject({ bookingStatus: 'REWORK_REQUIRED', reworkStarted: true, released: false });
    const facts = await prisma.$queryRaw<{ failed: number; hash: string | null }[]>(Prisma.sql`SELECT failed_rework_count as failed, start_otp_hash as hash FROM bookings WHERE id = ${job.id}::uuid`);
    expect(facts[0]?.failed).toBe(1);
    expect(facts[0]?.hash).not.toBeNull();
    expect((await callApi<{ items: unknown[] }>(app, '/dev/inbox?limit=200')).body.items.length).toBeGreaterThanOrEqual(inboxBefore);
    expect(await balance('ESCROW', { bookingId: job.id })).toBeGreaterThan(0n);
  });

  it('a call cannot be submitted twice: the second attempt finds nothing to submit', async () => {
    const job = await completedJob(app, provider, { mode: 'ONLINE' });
    await readyToSubmit(job);
    expect((await submit(job, satisfied)).status).toBe(200);
    expect((await submit(job, satisfied)).status).toBe(404);
  });
});
