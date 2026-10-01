// apps/api/test/integration/phase3-money.test.ts
//
// SHM-065: the phase 3 guarantees that cut across verification and money — commission rounding on real jobs, SLA edges around calling hours,
// a verdict submitted twice at once, and the whole-database money invariants after everything phase 3 has done.
import { Prisma } from '@prisma/client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { commissionOnPaisa } from '@smart-home/domain';
import { callApi, createTestApp, putJson } from './harness.js';
import { agentSession, agentVerify, answeredCall, bearer, claim, completedJob, dropLocks, freezeInsideCallingHours, newProvider, prisma, satisfied, travelToLocal, unfreeze, walletOf } from './flow.js';

let app: NestExpressApplication;
let close: () => Promise<void>;
let agent: { accessToken: string; userId: string };

beforeAll(async () => {
  const started = await createTestApp();
  app = started.app;
  close = started.close;
  freezeInsideCallingHours(app);
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

describe('SHM-065: commission rounds half up, on real jobs', () => {
  // Leak repair allows 100 000–500 000 paisa; the provider names their own price, so odd prices are legitimate. The default commission is 15 %.
  it.each([
    [100_003, 15_000], // 15 000.45 → down
    [100_005, 15_001], // 15 000.75 → up
    [100_010, 15_002], // 15 001.50 → half rounds up
    [333_333, 50_000] // 49 999.95 → up to 50 000
  ] as const)('a %i paisa job pays the platform %i and the provider the rest, to the paisa', async (price, expectedCommission) => {
    const provider = await newProvider(app);
    const service = await callApi<{ id: number }>(app, '/catalogue/services/leak-repair');
    const priced = await callApi(app, `/provider/services/${service.body.id}`, putJson({ pricePaisa: price }, provider.accessToken));
    expect(priced.status).toBeLessThan(300);
    // A changed price needs re-approval before it can be booked.
    const admin = await (await import('./harness.js')).adminSession(app);
    await callApi(app, `/admin/provider-services/${provider.id}/${service.body.id}/approve`, { method: 'POST', headers: { authorization: `Bearer ${admin.accessToken}` } });

    const job = await completedJob(app, provider, { mode: 'ONLINE' });
    const rate = (await prisma.$queryRaw<{ bp: number; final: bigint }[]>(Prisma.sql`SELECT commission_rate_bp as bp, final_amount_paisa as final FROM bookings WHERE id = ${job.id}::uuid`))[0]!;
    expect(rate.final).toBe(BigInt(price));
    await agentVerify(app, agent, job);

    const expectedFromDomain = commissionOnPaisa(BigInt(price), BigInt(rate.bp));
    expect(rate.bp).toBe(1500);
    expect(expectedFromDomain).toBe(BigInt(expectedCommission));
    const commission = await prisma.$queryRaw<{ amount: bigint }[]>(
      Prisma.sql`SELECT e.amount_paisa as amount FROM ledger_transactions t JOIN ledger_entries e ON e.transaction_id = t.id JOIN ledger_accounts a ON a.id = e.account_id WHERE t.idempotency_key = ${`release:${job.id}`} AND a.type = 'PLATFORM_COMMISSION'`
    );
    expect(commission[0]?.amount).toBe(BigInt(expectedCommission));
    expect(await walletOf(provider.id)).toBe(BigInt(price - expectedCommission));
  });
});

describe('SHM-065: SLA time is counted only inside calling hours', () => {
  const slaFor = async (hour: number, minute: number): Promise<{ createdAt: Date; dueAt: Date }> => {
    const provider = await newProvider(app);
    travelToLocal(app, hour, minute);
    const job = await completedJob(app, provider, { mode: 'CASH' });
    const row = (await prisma.$queryRaw<{ createdAt: Date; dueAt: Date }[]>(Prisma.sql`SELECT created_at as "createdAt", sla_due_at as "dueAt" FROM verification_calls WHERE id = ${job.verificationId}::uuid`))[0]!;
    return row;
  };
  const local = (date: Date): string => new Date(date.getTime() + 5 * 3_600_000).toISOString().slice(11, 16);

  it('a cash job finished mid-morning is due 15 minutes later', async () => {
    const { dueAt } = await slaFor(10, 0);
    expect(local(dueAt)).toBe('10:15');
  });

  it('one finished ten minutes before closing carries its last five minutes over to the next morning', async () => {
    const { dueAt } = await slaFor(21, 50);
    expect(local(dueAt)).toBe('08:05');
  });

  it('one finished in the small hours starts counting when calling opens', async () => {
    const { dueAt } = await slaFor(3, 0);
    expect(local(dueAt)).toBe('08:15');
  });

  it('one finished exactly at closing time waits for the morning', async () => {
    const { dueAt } = await slaFor(22, 0);
    expect(local(dueAt)).toBe('08:15');
  });
});

describe('SHM-065: a verdict cannot be applied twice', () => {
  it('two simultaneous submissions of the same verification release the money exactly once', async () => {
    const provider = await newProvider(app);
    const job = await completedJob(app, provider, { mode: 'ONLINE' });
    await claim(app, agent.accessToken, job.verificationId);
    await answeredCall(app, agent.accessToken, job.verificationId);
    const submit = () => callApi<{ released?: boolean }>(app, `/agent/verifications/${job.verificationId}/submit`, bearer(agent.accessToken, { method: 'POST', body: JSON.stringify(satisfied), headers: { 'content-type': 'application/json' } }));
    const results = await Promise.all([submit(), submit(), submit()]);
    expect(results.filter(result => result.status === 200)).toHaveLength(1);
    expect(results.filter(result => result.status !== 200).every(result => result.status === 404 || result.status === 409)).toBe(true);
    const releases = await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*)::bigint as n FROM ledger_transactions WHERE booking_id = ${job.id}::uuid AND type = 'RELEASE'`);
    expect(releases[0]?.n).toBe(1n);
    const ratings = await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*)::bigint as n FROM ratings WHERE booking_id = ${job.id}::uuid`);
    expect(ratings[0]?.n).toBe(1n);
  });
});
