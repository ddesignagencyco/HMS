// apps/api/test/integration/verification-rework.test.ts
//
// SHM-058: rework visits, warranty claims, the rework window, and closing finished jobs.
import { Prisma } from '@prisma/client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppClock } from '../../src/platform/app-clock.js';
import { VerificationSweepsService } from '../../src/verification/verification-sweeps.service.js';
import { callApi, createTestApp, postJson, registerAndVerify } from './harness.js';
import { agentSession, answeredCall, bearer, claim, completedJob, doWorkAndComplete, dropLocks, freezeInsideCallingHours, newProvider, prisma, satisfied, startVisit, unfreeze, type Job, type Provider } from './flow.js';

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
  freezeInsideCallingHours(app);
  await dropLocks(agent.userId);
});

afterAll(async () => {
  unfreeze(app);
  await close();
  await prisma.$disconnect();
});

const verify = async (job: Job, body: Record<string, unknown>) => {
  await dropLocks(agent.userId);
  const claimed = await claim(app, agent.accessToken, job.verificationId);
  expect(claimed.status).toBe(200);
  await answeredCall(app, agent.accessToken, job.verificationId);
  return callApi<{ bookingStatus: string; reworkStarted?: boolean; disputeOpened?: boolean; released: boolean }>(app, `/agent/verifications/${job.verificationId}/submit`, bearer(agent.accessToken, postJson(body)));
};

const currentVerification = async (bookingId: string): Promise<string> =>
  (await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM verification_calls WHERE booking_id = ${bookingId}::uuid ORDER BY visit_no DESC LIMIT 1`))[0]!.id;

const facts = async (bookingId: string) =>
  (await prisma.$queryRaw<{ status: string; visitNo: number; failed: number; released: Date | null }[]>(Prisma.sql`SELECT status::text, visit_no as "visitNo", failed_rework_count as failed, released_at as released FROM bookings WHERE id = ${bookingId}::uuid`))[0]!;

const escrowOf = async (bookingId: string): Promise<bigint> =>
  (await prisma.$queryRaw<{ balance: bigint }[]>(Prisma.sql`SELECT coalesce(b.balance, 0)::bigint as balance FROM ledger_accounts a LEFT JOIN account_balances b ON b.account_id = a.id WHERE a.type = 'ESCROW' AND a.booking_id = ${bookingId}::uuid`))[0]?.balance ?? 0n;

describe('SHM-058: a failed first visit', () => {
  it('sends the provider back for a second visit; the second verification is its own immutable record, and passing it releases the money', async () => {
    const job = await completedJob(app, provider, { mode: 'ONLINE' });
    const first = await verify(job, { ...satisfied, workCompleted: 'PARTIAL', outcome: 'REWORK_REQUIRED' });
    expect(first.body).toMatchObject({ bookingStatus: 'REWORK_REQUIRED', reworkStarted: true });
    expect(await escrowOf(job.id)).toBeGreaterThan(0n);

    // The rework visit needs the fresh code: the old one is not the customer's current one.
    await callApi(app, `/bookings/${job.id}/depart`, bearer(provider.accessToken, { method: 'POST' })); // illegal from REWORK_REQUIRED, must not move it
    expect((await facts(job.id)).status).toBe('REWORK_REQUIRED');
    await startVisit(app, provider, job.customer, job.id, 60);
    const started = await facts(job.id);
    expect(started).toMatchObject({ status: 'IN_PROGRESS', visitNo: 2 });

    // Visit 2's checklist and photos are its own: completing straight away, on visit 1's paperwork, is refused.
    const early = await callApi(app, `/bookings/${job.id}/complete`, bearer(provider.accessToken, postJson({})));
    expect(early.status).toBe(409);
    await doWorkAndComplete(app, provider, job.customer, job.id);

    const secondVerificationId = await currentVerification(job.id);
    expect(secondVerificationId).not.toBe(job.verificationId);
    const rows = await prisma.$queryRaw<{ visit: number; outcome: string | null; submitted: Date | null }[]>(
      Prisma.sql`SELECT visit_no as visit, outcome::text, submitted_at as submitted FROM verification_calls WHERE booking_id = ${job.id}::uuid ORDER BY visit_no`
    );
    expect(rows.map(row => [row.visit, row.outcome])).toEqual([[1, 'REWORK_REQUIRED'], [2, null]]);
    await expect(prisma.$executeRaw(Prisma.sql`UPDATE verification_calls SET quality = 1 WHERE id = ${job.verificationId}::uuid`)).rejects.toThrow(/immutable/);

    const second = await verify({ ...job, verificationId: secondVerificationId }, satisfied);
    expect(second.body).toMatchObject({ bookingStatus: 'PAYMENT_RELEASED', released: true });
    expect(await escrowOf(job.id)).toBe(0n);
    const ratings = await prisma.$queryRaw<{ verification: string }[]>(Prisma.sql`SELECT verification_call_id as verification FROM ratings WHERE booking_id = ${job.id}::uuid`);
    expect(ratings.map(row => row.verification)).toEqual([secondVerificationId]);
  });

  it('a second failed verification is a dispute — exactly one — and the money stays frozen', async () => {
    const job = await completedJob(app, provider, { mode: 'ONLINE' });
    await verify(job, { ...satisfied, workCompleted: 'PARTIAL', outcome: 'REWORK_REQUIRED' });
    await startVisit(app, provider, job.customer, job.id, 60);
    await doWorkAndComplete(app, provider, job.customer, job.id);
    const second = { ...job, verificationId: await currentVerification(job.id) };
    const result = await verify(second, { ...satisfied, workCompleted: 'PARTIAL', outcome: 'REWORK_REQUIRED' });
    expect(result.body).toMatchObject({ bookingStatus: 'DISPUTED', disputeOpened: true });
    const disputes = await prisma.$queryRaw<{ origin: string; status: string }[]>(Prisma.sql`SELECT origin::text, status::text FROM disputes WHERE booking_id = ${job.id}::uuid`);
    expect(disputes).toEqual([{ origin: 'REWORK_FAILED', status: 'OPEN' }]);
    expect(await escrowOf(job.id)).toBeGreaterThan(0n);
    expect((await facts(job.id)).failed).toBe(1);
  });

  it('an unused rework window expires into a dispute, once, however often the sweep runs', async () => {
    const job = await completedJob(app, provider, { mode: 'ONLINE' });
    await verify(job, { ...satisfied, workCompleted: 'PARTIAL', outcome: 'REWORK_REQUIRED' });
    const sweeps = app.get(VerificationSweepsService);
    expect(await sweeps.expireRework()).toBe(0);
    expect((await facts(job.id)).status).toBe('REWORK_REQUIRED');

    app.get(AppClock).advanceMinutes(49 * 60);
    await Promise.all([sweeps.expireRework(), sweeps.expireRework()]);
    await sweeps.expireRework();
    expect((await facts(job.id)).status).toBe('DISPUTED');
    const disputes = await prisma.$queryRaw<{ origin: string }[]>(Prisma.sql`SELECT origin::text FROM disputes WHERE booking_id = ${job.id}::uuid`);
    expect(disputes).toEqual([{ origin: 'REWORK_EXPIRED' }]);
  });
});

describe('SHM-058: warranty claims', () => {
  const releasedJob = async (mode: 'ONLINE' | 'CASH' = 'ONLINE'): Promise<Job> => {
    const job = await completedJob(app, provider, { mode });
    const result = await verify(job, satisfied);
    if (mode === 'CASH') return job;
    expect(result.body.released).toBe(true);
    return job;
  };

  it('reopens a released job as rework, the same booking; the fix is re-verified without paying or rating twice', async () => {
    const job = await releasedJob();
    const releasedAt = (await facts(job.id)).released;
    expect(releasedAt).not.toBeNull();

    const claimed = await callApi<{ status: string }>(app, `/bookings/${job.id}/warranty-claim`, bearer(job.customer.accessToken, postJson({ reason: 'The joint is leaking again' })));
    expect(claimed.status).toBe(200);
    expect(claimed.body.status).toBe('REWORK_REQUIRED');
    expect((await facts(job.id)).failed).toBe(1);

    const twice = await callApi(app, `/bookings/${job.id}/warranty-claim`, bearer(job.customer.accessToken, postJson({ reason: 'again' })));
    expect(twice.status).toBe(409);

    await startVisit(app, provider, job.customer, job.id, 60);
    await doWorkAndComplete(app, provider, job.customer, job.id);
    const recheck = { ...job, verificationId: await currentVerification(job.id) };
    const result = await verify(recheck, satisfied);
    expect(result.body.bookingStatus).toBe('PAYMENT_RELEASED');

    const releases = await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*)::bigint as n FROM ledger_transactions WHERE booking_id = ${job.id}::uuid AND type = 'RELEASE'`);
    expect(releases[0]?.n).toBe(1n);
    const ratings = await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*)::bigint as n FROM ratings WHERE booking_id = ${job.id}::uuid`);
    expect(ratings[0]?.n).toBe(1n);
    expect((await facts(job.id)).visitNo).toBe(2);
  });

  it('is refused once the warranty has expired, for anyone but the booking’s customer, and before release', async () => {
    const job = await releasedJob();
    await prisma.$executeRaw(Prisma.sql`UPDATE bookings SET warranty_until = now() - interval '1 day' WHERE id = ${job.id}::uuid`);
    const expired = await callApi<{ code: string }>(app, `/bookings/${job.id}/warranty-claim`, bearer(job.customer.accessToken, postJson({ reason: 'late' })));
    expect(expired.status).toBe(409);

    const stranger = await registerAndVerify(app, 'CUSTOMER');
    expect((await callApi(app, `/bookings/${job.id}/warranty-claim`, bearer(stranger.accessToken, postJson({ reason: 'x' })))).status).toBe(404);

    const unreleased = await completedJob(app, provider, { mode: 'ONLINE' });
    expect((await callApi(app, `/bookings/${unreleased.id}/warranty-claim`, bearer(unreleased.customer.accessToken, postJson({ reason: 'x' })))).status).toBe(409);
  });

  it('a claim that fails verification a second time is a dispute', async () => {
    const job = await releasedJob();
    await callApi(app, `/bookings/${job.id}/warranty-claim`, bearer(job.customer.accessToken, postJson({ reason: 'leaking' })));
    await startVisit(app, provider, job.customer, job.id, 60);
    await doWorkAndComplete(app, provider, job.customer, job.id);
    const recheck = { ...job, verificationId: await currentVerification(job.id) };
    const result = await verify(recheck, { ...satisfied, workCompleted: 'PARTIAL', outcome: 'REWORK_REQUIRED' });
    expect(result.body).toMatchObject({ bookingStatus: 'DISPUTED', disputeOpened: true });
  });

  it('closes a job once its warranty and the complaint window have both elapsed — and not before', async () => {
    const job = await releasedJob();
    const sweeps = app.get(VerificationSweepsService);
    await sweeps.closeElapsed();
    expect((await facts(job.id)).status).toBe('PAYMENT_RELEASED');
    app.get(AppClock).advanceMinutes(31 * 24 * 60);
    await Promise.all([sweeps.closeElapsed(), sweeps.closeElapsed()]);
    expect((await facts(job.id)).status).toBe('CLOSED');
    const closes = await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*)::bigint as n FROM booking_status_history WHERE booking_id = ${job.id}::uuid AND event = 'close'`);
    expect(closes[0]?.n).toBe(1n);
  });
});
