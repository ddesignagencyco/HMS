// apps/api/test/integration/conduct.test.ts
//
// M15 / FR-PN-06 / FR-PN-07 / FR-PN-02: the conduct record as a thing that moves money and rights. A penalty is only ever proposed,
// the provider answers or the window lapses before it is applied, the fine leaves the wallet and the points are awarded, an appeal's
// REVERSED decision returns every pai sa and (when the penalty caused one) a suspension, and the daily job spends each point of an
// award once it is 180 days old or one point per 30 clean days. All driven through the real API, the demerit ledger read directly.
import { Prisma } from '@prisma/client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { callApi, adminSession, createTestApp, postJson } from './harness.js';
import { bearer, freezeInsideCallingHours, newProvider, prisma, unfreeze, walletOf, type Provider } from './flow.js';
import { ConductJobsService } from '../../src/conduct/conduct-jobs.service.js';

let app: NestExpressApplication;
let close: () => Promise<void>;
let admin: { accessToken: string; userId: string };

beforeAll(async () => {
  const started = await createTestApp();
  app = started.app;
  close = started.close;
  freezeInsideCallingHours(app);
  admin = await adminSession(app);
});

afterEach(() => freezeInsideCallingHours(app));

afterAll(async () => {
  unfreeze(app);
  await close();
  await prisma.$disconnect();
});

/** Sum of what is still live on the record: awarded, not voided, not yet spent or expired. */
const activePoints = async (providerId: string): Promise<number> => {
  const rows = await prisma.$queryRaw<{ points: bigint }[]>(
    Prisma.sql`SELECT coalesce(sum(points_remaining), 0)::bigint as points FROM demerit_awards WHERE provider_id = ${providerId}::uuid AND voided_at IS NULL AND points_remaining > 0 AND expires_at > now()`
  );
  return Number(rows[0]?.points ?? 0n);
};

const penaltyStatus = async (penaltyId: string): Promise<string> =>
  (await prisma.$queryRaw<{ status: string }[]>(Prisma.sql`SELECT status::text as status FROM penalties WHERE id = ${penaltyId}::uuid`))[0]!.status;

const appealStatus = async (appealId: string): Promise<string> =>
  (await prisma.$queryRaw<{ status: string }[]>(Prisma.sql`SELECT status::text as status FROM appeals WHERE id = ${appealId}::uuid`))[0]!.status;

const providerStatus = async (providerId: string): Promise<string> =>
  (await prisma.$queryRaw<{ status: string }[]>(Prisma.sql`SELECT status::text as status FROM providers WHERE user_id = ${providerId}::uuid`))[0]!.status;

/** FR-PN-06 lets a ruling happen on the provider's reply or after the window; tests back-date it as if it elapsed. */
const expireReplyWindow = (penaltyId: string) =>
  prisma.$executeRaw(Prisma.sql`UPDATE penalties SET reply_due_at = now() - make_interval(hours => 49) WHERE id = ${penaltyId}::uuid`);

const propose = (providerId: string, body: Record<string, unknown>) =>
  callApi<{ id: string; breachCode: string; points: number; finePaisa: number; status: string }>(app, '/admin/penalties', bearer(admin.accessToken, postJson({ providerId, ...body })));

const apply = (penaltyId: string) =>
  callApi<{ penaltyId: string; status: string; pointsBefore: number; pointsAfter: number; consequence: string; finePaisa: number }>(app, `/admin/penalties/${penaltyId}/apply`, bearer(admin.accessToken, { method: 'POST' }));

const providerReply = (provider: Provider, penaltyId: string, text: string) =>
  callApi(app, `/provider/penalties/${penaltyId}/reply`, bearer(provider.accessToken, postJson({ reply: text })));

const appeal = (provider: Provider, penaltyId: string, grounds: string) =>
  callApi<{ id: string; penaltyId: string; status: string }>(app, `/provider/penalties/${penaltyId}/appeal`, bearer(provider.accessToken, postJson({ grounds })));

const decide = (appealId: string, body: Record<string, unknown>) =>
  callApi<{ id: string; penaltyId: string; decision: string }>(app, `/admin/appeals/${appealId}/decide`, bearer(admin.accessToken, postJson(body)));

/** Apply a proposed penalty after the reply window has passed, and return its outcome. */
const sieve = async (provider: Provider, body: Record<string, unknown>): Promise<{ penaltyId: string; proposal: Awaited<ReturnType<typeof propose>>['body']; outcome: Awaited<ReturnType<typeof apply>>['body'] }> => {
  const proposal = await propose(provider.id, body);
  if (proposal.status !== 201) throw new Error(`propose failed: ${proposal.status} ${JSON.stringify(proposal.body)}`);
  await expireReplyWindow(proposal.body.id);
  const outcome = await apply(proposal.body.id);
  if (outcome.status !== 200) throw new Error(`apply failed: ${outcome.status} ${JSON.stringify(outcome.body)}`);
  return { penaltyId: proposal.body.id, proposal: proposal.body, outcome: outcome.body };
};

describe('FR-PN-06: proposed, answered, then applied', () => {
  it('refuses a premature application, lets the provider\'s reply open the door, and charges fine, points and the warning together', async () => {
    const provider = await newProvider(app);
    const proposed = await propose(provider.id, { breachCode: 'OVERCHARGE', excessPaisa: 200_000, evidence: { note: 'Customer confirmed on the verification call' } });
    expect(proposed.status).toBe(201);
    const penaltyId = proposed.body.id;
    expect(proposed.body.points).toBe(10);
    expect(proposed.body.finePaisa).toBe(200_000);
    expect(proposed.body.status).toBe('PROPOSED');

    const refused = await apply(penaltyId);
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: 'CONFLICT' });

    const replied = await providerReply(provider, penaltyId, 'The customer asked for a longer visit on the day and paid the difference in cash.');
    expect(replied.status).toBe(200);

    const before = await walletOf(provider.id);
    const applied = await apply(penaltyId);
    expect(applied.status).toBe(200);
    expect(applied.body.status).toBe('APPLIED');
    expect(applied.body.pointsBefore).toBe(0);
    expect(applied.body.pointsAfter).toBe(10);
    expect(applied.body.consequence).toBe('WARNING');
    expect(applied.body.finePaisa).toBe(200_000);
    expect(await walletOf(provider.id)).toBe(before - 200_000n);
    expect(await activePoints(provider.id)).toBe(10);
    expect(await penaltyStatus(penaltyId)).toBe('APPLIED');

    const warned = await prisma.$queryRaw<{ n: bigint }[]>(
      Prisma.sql`SELECT count(*)::bigint as n FROM outbox_events WHERE aggregate = 'provider' AND aggregate_id = ${provider.id}::text AND type = 'provider.warned'`
    );
    expect(Number(warned[0]!.n)).toBe(1);
  });

  it('a lapsed reply window is as good as a reply', async () => {
    const provider = await newProvider(app);
    const proposed = await propose(provider.id, { breachCode: 'NO_SHOW' });
    expect(proposed.body.finePaisa).toBe(100_000);
    await expireReplyWindow(proposed.body.id);

    const before = await walletOf(provider.id);
    const applied = await apply(proposed.body.id);
    expect(applied.status).toBe(200);
    expect(applied.body.pointsAfter).toBe(8);
    expect(applied.body.consequence).toBe('NONE');
    expect(await walletOf(provider.id)).toBe(before - 100_000n);
    expect(await activePoints(provider.id)).toBe(8);
  });
});

describe('FR-PN-07: an appellant can only appeal an applied penalty, and an admin decides it', () => {
  it('REVERSED gives back exactly what the penalty took', async () => {
    const provider = await newProvider(app);
    const initial = await walletOf(provider.id);
    const { penaltyId } = await sieve(provider, { breachCode: 'LATE_CANCEL' });
    expect(await activePoints(provider.id)).toBe(3);
    expect(await walletOf(provider.id)).toBe(initial - 50_000n);

    const filed = await appeal(provider, penaltyId, 'I cancelled hours before the slot and the customer accepted on the chat.');
    expect(filed.status).toBe(201);
    expect(filed.body.status).toBe('OPEN');
    expect(await penaltyStatus(penaltyId)).toBe('APPEALED');
    expect(await appealStatus(filed.body.id)).toBe('OPEN');

    const decided = await decide(filed.body.id, { decision: 'REVERSED', note: 'The chat shows the customer agreed to the cancellation.' });
    expect(decided.status).toBe(200);
    expect(decided.body.decision).toBe('REVERSED');
    expect(await walletOf(provider.id)).toBe(initial);
    expect(await activePoints(provider.id)).toBe(0);
    expect(await penaltyStatus(penaltyId)).toBe('REVERSED');
    expect(await appealStatus(filed.body.id)).toBe('REVERSED');
    const award = await prisma.$queryRaw<{ voidedAt: Date | null }[]>(
      Prisma.sql`SELECT voided_at as "voidedAt" FROM demerit_awards WHERE penalty_id = ${penaltyId}::uuid`
    );
    expect(award[0]!.voidedAt).not.toBeNull();
  });

  it('UPHELD changes nothing, and a decided appeal cannot be decided again', async () => {
    const provider = await newProvider(app);
    const initial = await walletOf(provider.id);
    const { penaltyId } = await sieve(provider, { breachCode: 'LATE_CANCEL' });
    expect(await walletOf(provider.id)).toBe(initial - 50_000n);
    const filed = await appeal(provider, penaltyId, 'The customer accepted the cancellation on the chat and asked me to rebook.');

    const decided = await decide(filed.body.id, { decision: 'UPHELD', note: 'The reply deadline and the follow-up messages confirm the penalty.' });
    expect(decided.status).toBe(200);
    expect(await walletOf(provider.id)).toBe(initial - 50_000n);
    expect(await activePoints(provider.id)).toBe(3);
    expect(await penaltyStatus(penaltyId)).toBe('UPHELD');
    expect(await appealStatus(filed.body.id)).toBe('UPHELD');

    const again = await decide(filed.body.id, { decision: 'REVERSED', note: 'Trying a second decision.' });
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ code: 'CONFLICT' });
  });

  it('PARTIAL returns the stated fine and keeps the points', async () => {
    const provider = await newProvider(app);
    const initial = await walletOf(provider.id);
    const { penaltyId } = await sieve(provider, { breachCode: 'LATE_CANCEL' });
    expect(await walletOf(provider.id)).toBe(initial - 50_000n);
    const filed = await appeal(provider, penaltyId, 'Half the delay was the customer\'s own rescheduling this week.');

    const decided = await decide(filed.body.id, { decision: 'PARTIAL', note: 'The customer was partly at fault.', refundFinePaisa: 20_000 });
    expect(decided.status).toBe(200);
    expect(decided.body.decision).toBe('PARTIAL');
    expect(await walletOf(provider.id)).toBe(initial - 30_000n);
    expect(await activePoints(provider.id)).toBe(3);
    expect(await penaltyStatus(penaltyId)).toBe('UPHELD');
    expect(await appealStatus(filed.body.id)).toBe('PARTIAL');
  });

  it('REVERSED lifts the suspension the penalty caused', async () => {
    const provider = await newProvider(app);
    expect(await providerStatus(provider.id)).toBe('APPROVED');
    const { penaltyId } = await sieve(provider, { breachCode: 'UNSAFE_WORK' });
    const effects = await prisma.$queryRaw<{ consequence: string }[]>(
      Prisma.sql`SELECT consequence FROM threshold_events WHERE triggered_by_penalty_id = ${penaltyId}::uuid`
    );
    expect(effects.map(row => row.consequence)).toContain('SUSPENSION_14D');
    expect(await providerStatus(provider.id)).toBe('SUSPENDED');

    const filed = await appeal(provider, penaltyId, 'The ladder Isolate label was in place; the photo shows the harness too.');
    const decided = await decide(filed.body.id, { decision: 'REVERSED', note: 'The evidence shows the site was protected.' });
    expect(decided.status).toBe(200);
    expect(await providerStatus(provider.id)).toBe('APPROVED');
    expect(await activePoints(provider.id)).toBe(0);
    expect(await penaltyStatus(penaltyId)).toBe('REVERSED');
  });
});

describe('FR-PN-02: the daily decay and expiry of the record', () => {
  it('one point comes off the oldest active award per full 30 clean days, and running twice changes nothing', async () => {
    const provider = await newProvider(app);
    const initial = await walletOf(provider.id);
    const a = await propose(provider.id, { breachCode: 'LATE_CANCEL' });
    const b = await propose(provider.id, { breachCode: 'LATE_15' });
    await expireReplyWindow(a.body.id);
    await expireReplyWindow(b.body.id);
    await apply(a.body.id);
    await apply(b.body.id);
    expect(await activePoints(provider.id)).toBe(4);
    expect(await walletOf(provider.id)).toBe(initial - 50_000n);

    // 61 days back: two whole 30-day clean periods have passed since the last breach.
    await prisma.$executeRaw(Prisma.sql`UPDATE demerit_awards SET awarded_at = now() - make_interval(days => 61) WHERE provider_id = ${provider.id}::uuid`);

    const jobs = app.get(ConductJobsService);
    const first = await jobs.runDaily();
    expect(first.decayed).toBe(2);
    expect(await activePoints(provider.id)).toBe(2);

    const again = await jobs.runDaily();
    expect(again.decayed).toBe(0);
    expect(await activePoints(provider.id)).toBe(2);

    const record = await callApi<{ activePoints: number; awards: { pointsRemaining: number; active: boolean }[] }>(app, '/provider/conduct', bearer(provider.accessToken));
    expect(record.status).toBe(200);
    expect(record.body.activePoints).toBe(2);
    expect(record.body.awards.reduce((sum, award) => sum + award.pointsRemaining, 0)).toBe(2);
  });

  it('an award stops counting the moment its 180 days are up', async () => {
    const provider = await newProvider(app);
    const { penaltyId } = await sieve(provider, { breachCode: 'LATE_15' });
    expect(await activePoints(provider.id)).toBe(1);

    await prisma.$executeRaw(Prisma.sql`UPDATE demerit_awards SET expires_at = now() - make_interval(days => 10) WHERE penalty_id = ${penaltyId}::uuid`);

    const result = await app.get(ConductJobsService).runDaily();
    expect(result.expired).toBe(1);
    expect(await activePoints(provider.id)).toBe(0);

    const record = await callApi<{ activePoints: number; awards: { pointsRemaining: number; active: boolean }[] }>(app, '/provider/conduct', bearer(provider.accessToken));
    expect(record.body.activePoints).toBe(0);
    expect(record.body.awards[0]!.pointsRemaining).toBe(0);
    expect(record.body.awards[0]!.active).toBe(false);
  });
});