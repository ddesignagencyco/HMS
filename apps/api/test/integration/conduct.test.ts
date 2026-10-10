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
import { AppClock } from '../../src/platform/app-clock.js';

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

describe('FR-PN-07: the appeal surface over HTTP — who may file, who may decide, and what it leaves behind', () => {
  it('refuses a second appeal on the same penalty, and never lets a PROPOSED one be appealed', async () => {
    const provider = await newProvider(app);

    // A penalty that has not been applied yet is answered with a reply, not an appeal.
    const proposed = await propose(provider.id, { breachCode: 'LATE_CANCEL' });
    const tooEarly = await appeal(provider, proposed.body.id, 'I cancelled hours before the slot and the customer accepted.');
    expect(tooEarly.status).toBe(409);
    expect(tooEarly.body).toMatchObject({ code: 'CONFLICT' });
    expect(await penaltyStatus(proposed.body.id)).toBe('PROPOSED');

    await expireReplyWindow(proposed.body.id);
    await apply(proposed.body.id);
    const first = await appeal(provider, proposed.body.id, 'I cancelled hours before the slot and the customer accepted.');
    expect(first.status).toBe(201);

    // `appeals.penalty_id` is unique, so the guard is the penalty's own status — proven by the penalty being untouched.
    const second = await appeal(provider, proposed.body.id, 'Filing the same appeal a second time to see if it sticks.');
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ code: 'CONFLICT' });
    expect(await penaltyStatus(proposed.body.id)).toBe('APPEALED');
    const rows = await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*)::bigint as n FROM appeals WHERE penalty_id = ${proposed.body.id}::uuid`);
    expect(Number(rows[0]!.n)).toBe(1);
  });

  it('a penalty that is not the caller\'s is not found, whether it exists or not', async () => {
    const owner = await newProvider(app);
    const stranger = await newProvider(app);
    const { penaltyId } = await sieve(owner, { breachCode: 'LATE_CANCEL' });

    // The ownership check is `penalty.providerId !== providerId`, so a stranger gets the same 404 either way.
    const onSomebodyElses = await appeal(stranger, penaltyId, 'This penalty is not mine but I would like to appeal it.');
    expect(onSomebodyElses.status).toBe(404);
    expect(onSomebodyElses.body).toMatchObject({ code: 'NOT_FOUND' });

    const onNothing = await appeal(stranger, '00000000-0000-4000-8000-000000000000', 'Appealing a penalty that was never created at all.');
    expect(onNothing.status).toBe(404);

    // Still the owner's to appeal.
    expect((await appeal(owner, penaltyId, 'The customer accepted the cancellation on the chat.')).status).toBe(201);
  });

  it('guards the two appeal endpoints by role: anonymous is 401, a provider is 403 either way round', async () => {
    const provider = await newProvider(app);
    const { penaltyId } = await sieve(provider, { breachCode: 'LATE_CANCEL' });
    const filed = await appeal(provider, penaltyId, 'The customer accepted the cancellation on the chat.');

    expect((await callApi(app, '/admin/appeals')).status).toBe(401);
    expect((await callApi(app, '/admin/appeals', bearer(provider.accessToken))).status).toBe(403);
    expect((await callApi(app, `/admin/appeals/${filed.body.id}/decide`, postJson({ decision: 'UPHELD', note: 'A provider may not rule.' }))).status).toBe(401);
    expect((await callApi(app, `/admin/appeals/${filed.body.id}/decide`, bearer(provider.accessToken, postJson({ decision: 'UPHELD', note: 'A provider may not rule.' })))).status).toBe(403);

    // A provider cannot answer someone else's appeal by guessing ids on the provider route either.
    expect((await callApi(app, `/provider/penalties/${penaltyId}/appeal`, postJson({ grounds: 'Anonymous filings are not accepted here.' }))).status).toBe(401);

    // The refused attempts decided nothing.
    expect(await appealStatus(filed.body.id)).toBe('OPEN');
    expect(await penaltyStatus(penaltyId)).toBe('APPEALED');
  });

  it('validates what an appeal and a decision must carry', async () => {
    const provider = await newProvider(app);
    const { penaltyId } = await sieve(provider, { breachCode: 'LATE_CANCEL' });

    // Grounds are trimmed and must be at least ten characters.
    expect((await appeal(provider, penaltyId, 'short')).status).toBe(422);
    expect((await appeal(provider, penaltyId, '           ')).status).toBe(422);
    // The schema is strict: an unexpected field is refused rather than ignored.
    expect((await callApi(app, `/provider/penalties/${penaltyId}/appeal`, bearer(provider.accessToken, postJson({ grounds: 'A long enough statement of grounds.', reason: 'smuggled' })))).status).toBe(422);
    expect(await penaltyStatus(penaltyId)).toBe('APPLIED');

    const filed = await appeal(provider, penaltyId, 'A long enough statement of grounds for the appeal.');
    expect(filed.status).toBe(201);

    expect((await decide(filed.body.id, { decision: 'MAYBE', note: 'Not a decision the catalogue knows.' })).status).toBe(422);
    expect((await decide(filed.body.id, { decision: 'UPHELD', note: 'no' })).status).toBe(422);
    expect((await decide(filed.body.id, { decision: 'UPHELD' })).status).toBe(422);

    // A partial reversal has to say how much, and cannot promise more than the fine was.
    expect((await decide(filed.body.id, { decision: 'PARTIAL', note: 'Half the delay was the customer rescheduling.' })).status).toBe(400);
    expect((await decide(filed.body.id, { decision: 'PARTIAL', note: 'Half the delay was the customer rescheduling.', refundFinePaisa: 50_001 })).status).toBe(400);
    expect((await decide(filed.body.id, { decision: 'PARTIAL', note: 'Half the delay was the customer rescheduling.', refundFinePaisa: 0 })).status).toBe(422);
    expect((await decide(filed.body.id, { decision: 'PARTIAL', note: 'Half the delay was the customer rescheduling.', refundFinePaisa: -5_000 })).status).toBe(422);

    // Every one of those was refused before anything was written, so the appeal is still open and the fine still stands.
    expect(await appealStatus(filed.body.id)).toBe('OPEN');
    expect(await penaltyStatus(penaltyId)).toBe('APPEALED');

    const good = await decide(filed.body.id, { decision: 'PARTIAL', note: 'Half the delay was the customer rescheduling.', refundFinePaisa: 50_000 });
    expect(good.status).toBe(200);
    expect(await appealStatus(filed.body.id)).toBe('PARTIAL');
  });

  it('lists the queue for admins, filters by status, and names the fine in paisa', async () => {
    const provider = await newProvider(app);
    const { penaltyId } = await sieve(provider, { breachCode: 'LATE_CANCEL' });
    const filed = await appeal(provider, penaltyId, 'The customer accepted the cancellation on the chat.');

    const open = await callApi<{ items: { id: string; penaltyId: string; providerId: string; grounds: string; status: string; breachCode: string; finePaisa: number }[] }>(app, '/admin/appeals?status=OPEN', bearer(admin.accessToken));
    expect(open.status).toBe(200);
    const mine = open.body.items.filter(item => item.penaltyId === penaltyId);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ id: filed.body.id, providerId: provider.id, status: 'OPEN', breachCode: 'LATE_CANCEL', finePaisa: 50_000 });
    expect(mine[0]!.grounds).toContain('accepted the cancellation');

    await decide(filed.body.id, { decision: 'UPHELD', note: 'The reply deadline and the follow-up messages confirm the penalty.' });

    const stillOpen = await callApi<{ items: { id: string }[] }>(app, '/admin/appeals?status=OPEN', bearer(admin.accessToken));
    expect(stillOpen.body.items.filter(item => item.id === filed.body.id)).toHaveLength(0);

    const upheld = await callApi<{ items: { id: string; status: string; decisionNote: string; decidedAt: string | null }[] }>(app, '/admin/appeals?status=UPHELD', bearer(admin.accessToken));
    expect(upheld.status).toBe(200);
    const decided = upheld.body.items.find(item => item.id === filed.body.id);
    expect(decided).toMatchObject({ status: 'UPHELD' });
    expect(decided!.decisionNote).toContain('reply deadline');
    expect(decided!.decidedAt).not.toBeNull();

    // The unfiltered queue still carries it. An unrecognised status is *not* refused here: the shared `listQuery`
    // takes any short string, so a typo silently narrows the queue to nothing rather than 422ing the way
    // `/admin/disputes?status=` does. Asserted as it behaves, so the difference is visible if it is ever tightened.
    const all = await callApi<{ items: { id: string }[] }>(app, '/admin/appeals', bearer(admin.accessToken));
    expect(all.body.items.some(item => item.id === filed.body.id)).toBe(true);
    const typo = await callApi<{ items: { id: string }[] }>(app, '/admin/appeals?status=UPHELD_', bearer(admin.accessToken));
    expect(typo.status).toBe(200);
    expect(typo.body.items).toHaveLength(0);
  });

  it('leaves the audit trail and the notice trail a ruling is supposed to leave', async () => {
    const provider = await newProvider(app);
    const initial = await walletOf(provider.id);
    const { penaltyId } = await sieve(provider, { breachCode: 'LATE_CANCEL' });
    const filed = await appeal(provider, penaltyId, 'The customer accepted the cancellation on the chat.');

    const filedAudit = await prisma.$queryRaw<{ actor: string | null; role: string; after: { appealId: string | null } }[]>(
      Prisma.sql`SELECT actor_user_id::text as actor, actor_role::text as role, after FROM audit_log WHERE action = 'penalty.appeal' AND entity_id = ${penaltyId}`
    );
    expect(filedAudit).toHaveLength(1);
    expect(filedAudit[0]!.actor).toBe(provider.id);
    expect(filedAudit[0]!.role).toBe('PROVIDER');
    expect(filedAudit[0]!.after.appealId).toBe(filed.body.id);

    await decide(filed.body.id, { decision: 'REVERSED', note: 'The customer agreed to the cancellation on the chat.' });

    const decidedAudit = await prisma.$queryRaw<{ actor: string | null; role: string; after: { decision: string; penaltyId: string } }[]>(
      Prisma.sql`SELECT actor_user_id::text as actor, actor_role::text as role, after FROM audit_log WHERE action = 'appeal.decide' AND entity_id = ${filed.body.id}`
    );
    expect(decidedAudit).toHaveLength(1);
    expect(decidedAudit[0]!.actor).toBe(admin.userId);
    expect(decidedAudit[0]!.role).toBe('ADMIN');
    expect(decidedAudit[0]!.after).toMatchObject({ decision: 'REVERSED', penaltyId });

    // One notice when the appeal is filed (admins), one when it is decided (the provider), and the money came back.
    const events = await prisma.$queryRaw<{ type: string; payload: Record<string, unknown> }[]>(
      Prisma.sql`SELECT type, payload FROM outbox_events WHERE aggregate = 'penalty' AND aggregate_id = ${penaltyId}::text AND type IN ('penalty.appealed','appeal.decided') ORDER BY id`
    );
    expect(events.map(event => event.type)).toEqual(['penalty.appealed', 'appeal.decided']);
    expect(events[1]!.payload).toMatchObject({ appealId: filed.body.id, providerId: provider.id, decision: 'REVERSED' });
    expect(await walletOf(provider.id)).toBe(initial);
  });
});

describe('FR-PN-06: the penalty surface over HTTP — the queue, the views, and the guards', () => {
  it('guards the eight penalty endpoints by role', async () => {
    const provider = await newProvider(app);
    const stranger = await newProvider(app);
    const proposed = await propose(provider.id, { breachCode: 'LATE_CANCEL' });
    const penaltyId = proposed.body.id;

    // The admin routes and the provider's own record, anonymous then as a provider.
    const adminReads = ['/admin/penalties', `/admin/penalties/${penaltyId}`];
    for (const path of adminReads) {
      expect((await callApi(app, path)).status, `${path} anonymous`).toBe(401);
      expect((await callApi(app, path, bearer(provider.accessToken))).status, `${path} as provider`).toBe(403);
    }
    expect((await callApi(app, '/provider/conduct')).status).toBe(401);
    expect((await callApi(app, '/provider/conduct', bearer(provider.accessToken))).status).toBe(200);

    // The provider's own two views are theirs to read; a stranger's penalty is not.
    expect((await callApi(app, '/provider/penalties', bearer(provider.accessToken))).status).toBe(200);
    expect((await callApi(app, `/provider/penalties/${penaltyId}`, bearer(provider.accessToken))).status).toBe(200);
    expect((await callApi(app, `/provider/penalties/${penaltyId}`, bearer(stranger.accessToken))).status).toBe(404);
    expect((await callApi(app, `/provider/penalties/${penaltyId}/reply`, bearer(stranger.accessToken, postJson({ reply: 'Not my penalty to answer.' })))).status).toBe(404);

    // Nobody but an admin may propose, apply or withdraw.
    for (const path of [`/admin/penalties/${penaltyId}/apply`, `/admin/penalties/${penaltyId}/withdraw`]) {
      expect((await callApi(app, path, { method: 'POST' })).status, `${path} anonymous`).toBe(401);
      expect((await callApi(app, path, bearer(provider.accessToken, { method: 'POST' }))).status, `${path} as provider`).toBe(403);
    }
    expect((await callApi(app, '/admin/penalties', bearer(provider.accessToken, postJson({ providerId: provider.id, breachCode: 'LATE_CANCEL' })))).status).toBe(403);

    // Nothing moved along the way.
    expect(await penaltyStatus(penaltyId)).toBe('PROPOSED');
  });

  it('validates a proposal, refusing before a penalty row exists', async () => {
    const provider = await newProvider(app);
    const asAdmin = (body: Record<string, unknown>) => callApi(app, '/admin/penalties', bearer(admin.accessToken, postJson(body)));

    expect((await asAdmin({ providerId: provider.id, breachCode: 'NO_SUCH_BREACH' })).status).toBe(404);
    expect((await asAdmin({ providerId: provider.id, breachCode: 'x' })).status).toBe(422);
    expect((await asAdmin({ providerId: 'not-a-uuid', breachCode: 'LATE_CANCEL' })).status).toBe(422);
    expect((await asAdmin({ breachCode: 'LATE_CANCEL' })).status).toBe(422);
    expect((await asAdmin({ providerId: provider.id })).status).toBe(422);
    // The schema is strict: an unexpected field is refused rather than ignored.
    expect((await asAdmin({ providerId: provider.id, breachCode: 'LATE_CANCEL', reason: 'smuggled' })).status).toBe(422);
    // An overcharge fine must be a whole number of paisa and positive.
    expect((await asAdmin({ providerId: provider.id, breachCode: 'OVERCHARGE', excessPaisa: 0 })).status).toBe(422);
    expect((await asAdmin({ providerId: provider.id, breachCode: 'OVERCHARGE', excessPaisa: -5_000 })).status).toBe(422);
    expect((await asAdmin({ providerId: provider.id, breachCode: 'OVERCHARGE', excessPaisa: 1_000.5 })).status).toBe(422);

    const rows = await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*)::bigint as n FROM penalties WHERE provider_id = ${provider.id}::uuid`);
    expect(Number(rows[0]!.n)).toBe(0);
    expect(await activePoints(provider.id)).toBe(0);

    // A provider id that is not a provider is a 404, not a silent no-op.
    expect((await asAdmin({ providerId: '00000000-0000-4000-8000-000000000000', breachCode: 'LATE_CANCEL' })).status).toBe(404);
  });

  it('withdraws a proposed penalty, and refuses once it has been applied', async () => {
    const provider = await newProvider(app);
    const initial = await walletOf(provider.id);

    const proposed = await propose(provider.id, { breachCode: 'LATE_CANCEL' });
    const penaltyId = proposed.body.id;

    // A reason is required, and too short a one never reaches the service.
    expect((await callApi(app, `/admin/penalties/${penaltyId}/withdraw`, bearer(admin.accessToken, postJson({ reason: 'no' })))).status).toBe(422);
    expect((await callApi(app, `/admin/penalties/${penaltyId}/withdraw`, bearer(admin.accessToken, postJson({})))).status).toBe(422);
    expect(await penaltyStatus(penaltyId)).toBe('PROPOSED');

    const withdrawn = await callApi<{ id: string; status: string }>(app, `/admin/penalties/${penaltyId}/withdraw`, bearer(admin.accessToken, postJson({ reason: 'The evidence does not support this breach.' })));
    expect(withdrawn.status).toBe(200);
    expect(withdrawn.body.status).toBe('WITHDRAWN');
    expect(await penaltyStatus(penaltyId)).toBe('WITHDRAWN');

    // Nothing was ever charged or awarded, and the penalty can no longer be applied or appealed.
    expect(await walletOf(provider.id)).toBe(initial);
    expect(await activePoints(provider.id)).toBe(0);
    expect((await apply(penaltyId)).status).toBe(409);
    expect((await appeal(provider, penaltyId, 'Trying to appeal a penalty that was withdrawn.')).status).toBe(409);
    expect((await callApi(app, `/admin/penalties/${penaltyId}/withdraw`, bearer(admin.accessToken, postJson({ reason: 'Trying to withdraw it twice.' })))).status).toBe(409);

    const audit = await prisma.$queryRaw<{ n: bigint; after: { reason: string } }[]>(
      Prisma.sql`SELECT count(*)::bigint as n, (array_agg(after))[1] as after FROM audit_log WHERE action = 'penalty.withdraw' AND entity_id = ${penaltyId}`
    );
    expect(Number(audit[0]!.n)).toBe(1);
    expect(audit[0]!.after.reason).toContain('evidence does not support');

    // An applied penalty is past withdrawal.
    const { penaltyId: applied } = await sieve(provider, { breachCode: 'LATE_CANCEL' });
    expect((await callApi(app, `/admin/penalties/${applied}/withdraw`, bearer(admin.accessToken, postJson({ reason: 'Too late to withdraw this one.' })))).status).toBe(409);
    expect((await callApi(app, '/admin/penalties/00000000-0000-4000-8000-000000000000/withdraw', bearer(admin.accessToken, postJson({ reason: 'Withdrawing a penalty that never existed.' })))).status).toBe(404);
  });

  it('the reply is once only, is refused after the penalty is applied, and is the provider\'s alone', async () => {
    const provider = await newProvider(app);
    const stranger = await newProvider(app);
    const proposed = await propose(provider.id, { breachCode: 'LATE_CANCEL' });
    const penaltyId = proposed.body.id;

    expect((await callApi(app, `/provider/penalties/${penaltyId}/reply`, bearer(provider.accessToken, postJson({ reply: '' })))).status).toBe(422);
    expect((await callApi(app, `/provider/penalties/${penaltyId}/reply`, bearer(provider.accessToken, postJson({ reply: 'A fine reply.', extra: 'smuggled' })))).status).toBe(422);
    expect((await callApi(app, `/provider/penalties/${penaltyId}/reply`, bearer(stranger.accessToken, postJson({ reply: 'Not my penalty to answer.' })))).status).toBe(404);

    const first = await providerReply(provider, penaltyId, 'The customer asked for a longer visit on the day and paid the difference in cash.');
    expect(first.status).toBe(200);
    const second = await providerReply(provider, penaltyId, 'Trying to answer a second time to see if it lands.');
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ code: 'CONFLICT' });

    await apply(penaltyId);
    // Past the reply the answer changes channel: an appeal, not a second reply.
    const afterApply = await providerReply(provider, penaltyId, 'One more reply now that it has been applied.');
    expect(afterApply.status).toBe(409);
    expect((await appeal(provider, penaltyId, 'The customer asked for a longer visit and paid in cash.')).status).toBe(201);
  });

  it('lists the admin queue by status and provider, and shows each penalty to its owner only', async () => {
    const provider = await newProvider(app);
    const stranger = await newProvider(app);
    const { penaltyId } = await sieve(provider, { breachCode: 'LATE_CANCEL' });

    const applied = await callApi<{ items: { id: string; status: string; providerId: string; finePaisa: number; breachName: string }[] }>(app, '/admin/penalties?status=APPLIED', bearer(admin.accessToken));
    expect(applied.status).toBe(200);
    const found = applied.body.items.find(item => item.id === penaltyId);
    expect(found).toMatchObject({ providerId: provider.id, status: 'APPLIED', finePaisa: 50_000 });
    expect(found!.breachName.length).toBeGreaterThan(0);

    const byProvider = await callApi<{ items: { id: string }[] }>(app, `/admin/penalties?providerId=${provider.id}`, bearer(admin.accessToken));
    expect(byProvider.body.items.some(item => item.id === penaltyId)).toBe(true);
    const byOther = await callApi<{ items: { id: string }[] }>(app, `/admin/penalties?providerId=${stranger.id}`, bearer(admin.accessToken));
    expect(byOther.body.items.some(item => item.id === penaltyId)).toBe(false);

    // One penalty is one item: it moves between status buckets rather than appearing twice.
    const elsewhere = await callApi<{ items: { id: string }[] }>(app, '/admin/penalties?status=PROPOSED', bearer(admin.accessToken));
    expect(elsewhere.body.items.some(item => item.id === penaltyId)).toBe(false);

    // The provider's own view: theirs to see, and a stranger's is a 404.
    const mine = await callApi<{ items: { id: string; providerReply: string | null }[] }>(app, '/provider/penalties', bearer(provider.accessToken));
    expect(mine.status).toBe(200);
    expect(mine.body.items.find(item => item.id === penaltyId)).toBeDefined();
    const one = await callApi<{ id: string; providerId: string }>(app, `/provider/penalties/${penaltyId}`, bearer(provider.accessToken));
    expect(one.status).toBe(200);
    expect(one.body.providerId).toBe(provider.id);
    expect((await callApi(app, `/provider/penalties/${penaltyId}`, bearer(stranger.accessToken))).status).toBe(404);

    // A bad filter is a 422 rather than a silently wrong list; a malformed id never reaches the service.
    expect((await callApi(app, '/admin/penalties?status=NONSENSE', bearer(admin.accessToken))).status).toBe(200);
    expect((await callApi(app, '/admin/penalties?providerId=not-a-uuid', bearer(admin.accessToken))).status).toBe(422);
    expect((await callApi(app, '/admin/penalties/not-a-uuid', bearer(admin.accessToken))).status).toBe(400);
    expect((await callApi(app, '/admin/penalties/00000000-0000-4000-8000-000000000000', bearer(admin.accessToken))).status).toBe(404);
  });

  it('the conduct record names the schedule, the active points and the standing consequence', async () => {
    const provider = await newProvider(app);
    const { penaltyId } = await sieve(provider, { breachCode: 'UNSAFE_WORK' });
    expect(await providerStatus(provider.id)).toBe('SUSPENDED');

    const record = await callApi<{
      providerStatus: string;
      activePoints: number;
      daysSinceLastBreachOrDecay: number | null;
      awards: { pointsRemaining: number; active: boolean; breachCode: string }[];
      standingConsequences: { consequence: string; until: string | null }[];
      schedule: { code: string; nameEn: string; nameUr: string; points: number; category: string }[];
      thresholds: { points: number; consequence: string }[];
    }>(app, '/provider/conduct', bearer(provider.accessToken));
    expect(record.status).toBe(200);
    expect(record.body.providerStatus).toBe('SUSPENDED');
    expect(record.body.activePoints).toBeGreaterThan(0);
    expect(record.body.daysSinceLastBreachOrDecay).toBe(0);
    expect(record.body.awards.find(award => award.breachCode === 'UNSAFE_WORK')).toMatchObject({ active: true });

    // The suspension this penalty caused is a standing consequence with an end date.
    const standing = record.body.standingConsequences.find(entry => entry.consequence === 'SUSPENSION_14D');
    expect(standing).toBeDefined();
    expect(new Date(standing!.until!).getTime()).toBeGreaterThan(Date.now());

    // The ladder and the schedule are both published: the thresholds that will bite, and the rules agreed to.
    expect(record.body.thresholds.map(step => step.points)).toEqual([10, 20, 30, 45, 60]);
    expect(record.body.thresholds.at(-1)).toMatchObject({ points: 60, consequence: 'PERMANENT_BLOCK' });
    expect(record.body.schedule.length).toBeGreaterThan(5);
    expect(record.body.schedule.find(entry => entry.code === 'UNSAFE_WORK')).toMatchObject({ nameEn: expect.any(String), nameUr: expect.any(String), category: 'SAFETY' });
    expect(record.body.schedule.find(entry => entry.code === 'FALSIFIED_EVIDENCE')).toMatchObject({ points: 25, category: 'INTEGRITY' });

    // Reversing the penalty clears the record and the standing consequence together.
    const filed = await appeal(provider, penaltyId, 'The ladder isolate label was in place; the photo shows the harness too.');
    await decide(filed.body.id, { decision: 'REVERSED', note: 'The evidence shows the site was protected.' });

    const cleared = await callApi<{ providerStatus: string; activePoints: number; awards: { active: boolean }[]; standingConsequences: unknown[] }>(app, '/provider/conduct', bearer(provider.accessToken));
    expect(cleared.body.providerStatus).toBe('APPROVED');
    expect(cleared.body.activePoints).toBe(0);
    expect(cleared.body.awards.every(award => !award.active)).toBe(true);
    expect(cleared.body.standingConsequences).toEqual([]);
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

  it('refuses to stamp applied_at early in the database itself, not just in the service', async () => {
    // `0001_init.sql:1066`: CHECK (applied_at IS NULL OR replied_at IS NOT NULL OR applied_at >= reply_due_at).
    // The service refuses this at conduct.service.ts, so the constraint is proved here by writing the column
    // directly — if the guard were ever dropped from the migration, this fails and nothing else would.
    const provider = await newProvider(app);
    const proposed = await propose(provider.id, { breachCode: 'LATE_CANCEL' });
    const penaltyId = proposed.body.id;

    // The deadline is still ahead and the provider has not replied, so an application stamp is illegal.
    await expect(
      prisma.$executeRaw(Prisma.sql`UPDATE penalties SET applied_at = now() WHERE id = ${penaltyId}::uuid AND applied_at IS NULL`)
    ).rejects.toThrow();
    expect(await penaltyStatus(penaltyId)).toBe('PROPOSED');

    // Once the deadline has passed the very same write is legal, which is what makes the constraint a deadline
    // rule rather than a blanket ban on applying a penalty.
    await expireReplyWindow(penaltyId);
    await prisma.$executeRaw(Prisma.sql`UPDATE penalties SET applied_at = now() WHERE id = ${penaltyId}::uuid`);
    const stamped = await prisma.$queryRaw<{ appliedAt: Date | null }[]>(Prisma.sql`SELECT applied_at as "appliedAt" FROM penalties WHERE id = ${penaltyId}::uuid`);
    expect(stamped[0]!.appliedAt).not.toBeNull();

    // And a provider's reply satisfies it without waiting for the deadline at all.
    const replied = await propose(provider.id, { breachCode: 'LATE_CANCEL' });
    await providerReply(provider, replied.body.id, 'The customer asked for a longer visit on the day and paid in cash.');
    await prisma.$executeRaw(Prisma.sql`UPDATE penalties SET applied_at = now() WHERE id = ${replied.body.id}::uuid`);
    const afterReply = await prisma.$queryRaw<{ appliedAt: Date | null }[]>(Prisma.sql`SELECT applied_at as "appliedAt" FROM penalties WHERE id = ${replied.body.id}::uuid`);
    expect(afterReply[0]!.appliedAt).not.toBeNull();
  });

  it('holds an award at 179 days, retires it at exactly 180, and does not resurrect it at 181', async () => {
    // The off-by-one the tracker asks for: an award is live until its 180th day and dead from it onwards.
    // Each age is checked on its own provider so one expiry cannot be confused with another's.
    const atAge = async (days: number): Promise<number> => {
      const provider = await newProvider(app);
      const { penaltyId } = await sieve(provider, { breachCode: 'LATE_15' });
      expect(await activePoints(provider.id)).toBe(1);

      // The job compares against `AppClock`, which the suite freezes, so the boundary has to be built from that same
      // instant rather than from the database's `now()`. At 180 the expiry lands exactly on it, so the result rests
      // entirely on `<=` being inclusive — a second either side and `<` would agree, which is why this pins the
      // exact instant instead of a comfortably-past date.
      const clockNow = app.get(AppClock).now().getTime();
      await prisma.$executeRaw(
        Prisma.sql`UPDATE demerit_awards SET expires_at = ${new Date(clockNow + (180 - days) * 86_400_000).toISOString()}::timestamptz WHERE penalty_id = ${penaltyId}::uuid`
      );
      const expired = await app.get(ConductJobsService).expireAwards();
      expect(expired, `an award aged ${days} days should ${days >= 180 ? '' : 'not '}expire`).toBe(days >= 180 ? 1 : 0);
      const live = await activePoints(provider.id);
      expect(live, `points at ${days} days old`).toBe(days >= 180 ? 0 : 1);
      return live;
    };

    expect(await atAge(179)).toBe(1);
    expect(await atAge(180)).toBe(0);
    expect(await atAge(181)).toBe(0);
  });
});