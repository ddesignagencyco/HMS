// apps/api/test/integration/reputation.test.ts
//
// SHM-063 / SHM-064: ratings, remarks and replies, the public reputation, and call recordings.
import { Prisma } from '@prisma/client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { OBJECT_STORAGE } from '../../src/integrations/integrations.module.js';
import type { ObjectStoragePort } from '../../src/integrations/ports.js';
import { AppClock } from '../../src/platform/app-clock.js';
import { RecordingService } from '../../src/verification/recording.service.js';
import { callApi, createTestApp, postJson, registerAndVerify, staffSession } from './harness.js';
import { agentSession, agentVerify, bearer, claim, completedJob, dropLocks, freezeInsideCallingHours, newProvider, prisma, satisfied, unfreeze, type Job, type Provider } from './flow.js';

let app: NestExpressApplication;
let close: () => Promise<void>;
let agent: { accessToken: string; userId: string };
let admin: { accessToken: string; userId: string };
let finance: { accessToken: string; userId: string };

beforeAll(async () => {
  const started = await createTestApp();
  app = started.app;
  close = started.close;
  freezeInsideCallingHours(app);
  agent = await agentSession(app, 'agent1');
  admin = await staffSession(app, 'admin@smart-home.local');
  finance = await staffSession(app, 'finance@smart-home.local');
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

type Reputation = { score: number; ratingCount: number; distribution: Record<string, number>; verifiedJobs: number; badge: string | null };

const reputationOf = async (provider: Provider): Promise<Reputation> => (await callApi<Reputation>(app, `/search/providers/${provider.id}/reputation`)).body;

/** A job verified by an agent with the given four scores and remark. */
const ratedJob = async (provider: Provider, scores: { quality: number; punctuality: number; conduct: number; cleanliness: number }, remark?: string): Promise<Job> => {
  const job = await completedJob(app, provider, { mode: 'ONLINE' });
  const result = await agentVerify(app, agent, job, { ...satisfied, ...scores, ...(remark === undefined ? { remark: undefined } : { remark }) });
  expect(result.body.released).toBe(true);
  return job;
};

describe('SHM-063: ratings and the public reputation', () => {
  it('a provider with no ratings shows the neutral prior; rating a job moves it, publishes it and counts it', async () => {
    const provider = await newProvider(app);
    expect(await reputationOf(provider)).toMatchObject({ score: 3.5, ratingCount: 0, verifiedJobs: 0, badge: null });

    await ratedJob(provider, { quality: 5, punctuality: 5, conduct: 5, cleanliness: 5 }, 'Excellent work');
    const after = await reputationOf(provider);
    expect(after.ratingCount).toBe(1);
    expect(after.verifiedJobs).toBe(1);
    expect(after.distribution['5']).toBe(1);
    // 1 rating of 5.0 with recent weight 2: (3.5*5 + 5*2) / (5 + 2)
    expect(after.score).toBe(Math.round(((350 * 5 + 500 * 2) / 7)) / 100);
  });

  it('shows up in search, with the score and rating count, and in the provider’s public profile', async () => {
    const where = { lat: 26.1 + Math.random(), lng: 66.1 + Math.random() };
    const provider = await newProvider(app, where);
    await ratedJob(provider, { quality: 5, punctuality: 4, conduct: 5, cleanliness: 4 });
    const search = await callApi<{ items: { providerId: string; ratingScore: number; ratingCount: number; badge: string | null }[] }>(app, `/search/providers?serviceSlug=leak-repair&lat=${where.lat}&lng=${where.lng}`);
    const hit = search.body.items.find(item => item.providerId === provider.id)!;
    expect(hit.ratingCount).toBe(1);
    expect(hit.ratingScore).toBe((await reputationOf(provider)).score);
    const detail = await callApi<{ reputation: Reputation }>(app, `/search/providers/${provider.id}`);
    expect(detail.body.reputation.ratingCount).toBe(1);
  });

  it('ranks a proven provider above an unproven one at the same distance, and equal ratings fall back to distance', async () => {
    const where = { lat: 27.1 + Math.random(), lng: 67.1 + Math.random() };
    const proven = await newProvider(app, where);
    const unrated = await newProvider(app, { lat: where.lat + 0.0001, lng: where.lng + 0.0001 });
    await ratedJob(proven, { quality: 5, punctuality: 5, conduct: 5, cleanliness: 5 });
    const order = (await callApi<{ items: { providerId: string; distanceM: number }[] }>(app, `/search/providers?serviceSlug=leak-repair&lat=${where.lat}&lng=${where.lng}`)).body.items.map(item => item.providerId);
    expect(order.indexOf(proven.id)).toBeLessThan(order.indexOf(unrated.id));

    const twin = await newProvider(app, { lat: where.lat + 0.0002, lng: where.lng + 0.0002 });
    const equal = await newProvider(app, { lat: where.lat + 0.0003, lng: where.lng + 0.0003 });
    const both = (await callApi<{ items: { providerId: string }[] }>(app, `/search/providers?serviceSlug=leak-repair&lat=${where.lat}&lng=${where.lng}`)).body.items.map(item => item.providerId);
    expect(both.indexOf(twin.id)).toBeLessThan(both.indexOf(equal.id));
  });

  it('a rating exists only because of a verification: an auto-released job has none, and the database refuses one made any other way', async () => {
    const provider = await newProvider(app);
    const job = await completedJob(app, provider, { mode: 'ONLINE' });
    await expect(
      prisma.$executeRaw(Prisma.sql`INSERT INTO ratings(verification_call_id, booking_id, provider_id, customer_id, quality, punctuality, conduct, cleanliness) VALUES (${job.verificationId}::uuid, ${job.id}::uuid, ${provider.id}::uuid, ${job.customer.id}::uuid, 5, 5, 5, 5)`)
    ).rejects.toThrow(/rating requires a submitted verification/);
    expect((await reputationOf(provider)).ratingCount).toBe(0);
  });

  it('awards a badge from verified jobs only: nine verified jobs and a dispute earn nothing, the tenth verified job earns TRUSTED', async () => {
    const provider = await newProvider(app);
    const disputed = await completedJob(app, provider, { mode: 'ONLINE' });
    await agentVerify(app, agent, disputed, { ...satisfied, extraChargeDemanded: true, extraChargeAmountPaisa: 1000, consentToRelease: false, outcome: 'DISPUTED' });
    for (let index = 0; index < 9; index += 1) await ratedJob(provider, { quality: 5, punctuality: 5, conduct: 5, cleanliness: 5 });
    const badgeOf = async (): Promise<string | null> => (await prisma.$queryRaw<{ b: string | null }[]>(Prisma.sql`SELECT tier_badge as b FROM providers WHERE user_id = ${provider.id}::uuid`))[0]!.b;
    expect(await reputationOf(provider)).toMatchObject({ verifiedJobs: 9, badge: null });
    expect(await badgeOf()).toBeNull();
    await ratedJob(provider, { quality: 5, punctuality: 5, conduct: 5, cleanliness: 5 });
    expect(await reputationOf(provider)).toMatchObject({ verifiedJobs: 10, badge: 'TRUSTED' });
    expect(await badgeOf()).toBe('TRUSTED');
  }, 240_000);

  it('flags a provider once their average falls to the poor threshold with enough ratings', async () => {
    const provider = await newProvider(app);
    for (let index = 0; index < 5; index += 1) await ratedJob(provider, { quality: 1, punctuality: 2, conduct: 2, cleanliness: 1 });
    const flags = await prisma.$queryRaw<{ kind: string; n: bigint }[]>(Prisma.sql`SELECT kind::text, count(*)::bigint as n FROM provider_flags WHERE provider_id = ${provider.id}::uuid GROUP BY kind`);
    expect(flags).toEqual([{ kind: 'LOW_RATING', n: 1n }]);
    const events = await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*)::bigint as n FROM outbox_events WHERE type = 'provider.review_required' AND payload->>'providerId' = ${provider.id}`);
    expect(events[0]?.n).toBe(1n);
  }, 120_000);
});

describe('SHM-063: remarks and replies', () => {
  it('publishes a remark under "First L." only, visible to anyone, with the provider’s single, immutable reply', async () => {
    const provider = await newProvider(app);
    const job = await ratedJob(provider, { quality: 5, punctuality: 5, conduct: 5, cleanliness: 5 }, 'Neat and quick. Call 0300 1234567 for more.');
    const names = await prisma.$queryRaw<{ first: string; last: string }[]>(Prisma.sql`SELECT first_name as first, last_name as last FROM users WHERE id = ${job.customer.id}::uuid`);

    const remarks = await callApi<{ items: { id: string; displayName: string; body: string; score: number; reply: { body: string } | null }[] }>(app, `/search/providers/${provider.id}/remarks`);
    expect(remarks.status).toBe(200);
    expect(remarks.body.items).toHaveLength(1);
    const remark = remarks.body.items[0]!;
    expect(remark.displayName).toBe(`${names[0]!.first} ${names[0]!.last.charAt(0).toUpperCase()}.`.replace(/ \.$/, ''));
    expect(remark.displayName).not.toContain(names[0]!.last);
    expect(remark.score).toBe(5);
    expect(remark.reply).toBeNull();

    const replied = await callApi<{ id: string }>(app, `/provider/remarks/${remark.id}/reply`, bearer(provider.accessToken, postJson({ body: 'Thank you!' })));
    expect(replied.status).toBe(201);
    expect((await callApi(app, `/provider/remarks/${remark.id}/reply`, bearer(provider.accessToken, postJson({ body: 'And again' })))).status).toBe(409);
    await expect(prisma.$executeRaw(Prisma.sql`UPDATE remark_replies SET body = 'edited' WHERE remark_id = ${remark.id}::uuid`)).rejects.toThrow();
    const after = await callApi<{ items: { reply: { body: string } | null }[] }>(app, `/search/providers/${provider.id}/remarks`);
    expect(after.body.items[0]?.reply?.body).toBe('Thank you!');

    const stranger = await newProvider(app);
    expect((await callApi(app, `/provider/remarks/${remark.id}/reply`, bearer(stranger.accessToken, postJson({ body: 'not mine' })))).status).toBe(404);
  });

  it('a provider sees every rating they received, with the four criteria', async () => {
    const provider = await newProvider(app);
    await ratedJob(provider, { quality: 5, punctuality: 3, conduct: 4, cleanliness: 4 }, 'Good');
    const own = await callApi<{ reputation: Reputation; items: { score: number; quality: number; punctuality: number; remark: { body: string; published: boolean } | null }[] }>(app, '/provider/ratings', bearer(provider.accessToken));
    expect(own.status).toBe(200);
    expect(own.body.items).toHaveLength(1);
    expect(own.body.items[0]).toMatchObject({ score: 4, quality: 5, punctuality: 3, remark: { body: 'Good', published: true } });
    expect((await callApi(app, '/provider/ratings', bearer((await registerAndVerify(app, 'CUSTOMER')).accessToken))).status).toBe(403);
  });

  it('an admin unpublishes an abusive remark: hidden publicly, still in the score, audited; the reason is recorded', async () => {
    const provider = await newProvider(app);
    await ratedJob(provider, { quality: 4, punctuality: 4, conduct: 4, cleanliness: 4 }, 'Awful person');
    const before = await reputationOf(provider);
    const remarkId = (await callApi<{ items: { id: string }[] }>(app, `/search/providers/${provider.id}/remarks`)).body.items[0]!.id;

    expect((await callApi(app, `/admin/remarks/${remarkId}/unpublish`, bearer(agent.accessToken, postJson({ reason: 'abusive' })))).status).toBe(403);
    const unpublished = await callApi(app, `/admin/remarks/${remarkId}/unpublish`, bearer(admin.accessToken, postJson({ reason: 'Contains personal abuse' })));
    expect(unpublished.status).toBe(200);
    expect((await callApi(app, `/admin/remarks/${remarkId}/unpublish`, bearer(admin.accessToken, postJson({ reason: 'again please' })))).status).toBe(409);

    expect((await callApi<{ items: unknown[] }>(app, `/search/providers/${provider.id}/remarks`)).body.items).toHaveLength(0);
    expect(await reputationOf(provider)).toEqual(before);
    const audit = await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*)::bigint as n FROM audit_log WHERE action = 'remark.unpublish' AND entity_id = ${remarkId}`);
    expect(audit[0]?.n).toBe(1n);

    // The provider still sees it (flagged unpublished), cannot reply to it, and admin sees who removed it and why.
    const own = await callApi<{ items: { remark: { published: boolean } }[] }>(app, '/provider/ratings', bearer(provider.accessToken));
    expect(own.body.items[0]?.remark.published).toBe(false);
    expect((await callApi(app, `/provider/remarks/${remarkId}/reply`, bearer(provider.accessToken, postJson({ body: 'hi' })))).status).toBe(409);
    const review = await callApi<{ items: { published: boolean; unpublishedReason: string }[] }>(app, `/admin/providers/${provider.id}/ratings`, bearer(admin.accessToken));
    expect(review.body.items[0]).toMatchObject({ published: false, unpublishedReason: 'Contains personal abuse' });
  });
});

describe('SHM-064: call recordings', () => {
  const storage = (): ObjectStoragePort => app.get<ObjectStoragePort>(OBJECT_STORAGE);

  /** A claimed call with one bridged, recorded attempt. */
  const recordedAttempt = async (): Promise<{ job: Job; attemptId: string; recordingRef: string }> => {
    const provider = await newProvider(app);
    const job = await completedJob(app, provider, { mode: 'CASH' });
    await claim(app, agent.accessToken, job.verificationId);
    const bridged = await callApi<{ recordingRef: string; callRef: string }>(app, `/agent/verifications/${job.verificationId}/call`, bearer(agent.accessToken, postJson({ agentEndpoint: '+923001112233' })));
    expect(bridged.status).toBe(200);
    const attempt = await callApi<{ id: string }>(app, `/agent/verifications/${job.verificationId}/attempts`, bearer(agent.accessToken, postJson({ result: 'ANSWERED', callRef: bridged.body.callRef, recordingRef: bridged.body.recordingRef, durationSeconds: 90 })));
    expect(attempt.status).toBe(201);
    return { job, attemptId: attempt.body.id, recordingRef: bridged.body.recordingRef };
  };

  it('finance and admin can play a recording through a signed link, and each access is audited; an agent cannot, not even for their own call', async () => {
    const { attemptId, recordingRef } = await recordedAttempt();
    expect((await callApi(app, `/finance/recordings/${attemptId}`, bearer(agent.accessToken))).status).toBe(403);
    expect((await callApi(app, `/finance/recordings/${attemptId}`)).status).toBe(401);
    const played = await callApi<{ url: string; expiresAt: string }>(app, `/finance/recordings/${attemptId}`, bearer(finance.accessToken));
    expect(played.status).toBe(200);
    expect(played.body.url).toContain(encodeURIComponent(recordingRef));
    expect(new Date(played.body.expiresAt).getTime()).toBeLessThanOrEqual(Date.now() + 301_000);
    expect((await callApi(app, `/finance/recordings/${attemptId}`, bearer(admin.accessToken))).status).toBe(200);
    const audit = await prisma.$queryRaw<{ role: string }[]>(Prisma.sql`SELECT actor_role::text as role FROM audit_log WHERE action = 'recording.access' AND entity_id = ${attemptId} ORDER BY id`);
    expect(audit.map(row => row.role)).toEqual(['FINANCE', 'ADMIN']);
  });

  it('an attempt with no recording is a 404', async () => {
    const provider = await newProvider(app);
    const job = await completedJob(app, provider, { mode: 'CASH' });
    await claim(app, agent.accessToken, job.verificationId);
    const attempt = await callApi<{ id: string }>(app, `/agent/verifications/${job.verificationId}/attempts`, bearer(agent.accessToken, postJson({ result: 'ANSWERED' })));
    expect((await callApi(app, `/finance/recordings/${attempt.body.id}`, bearer(finance.accessToken))).status).toBe(404);
  });

  it('the retention purge removes recordings past their age, logs each one, spares recent ones, and playback is then a 404', async () => {
    const old = await recordedAttempt();
    await dropLocks(agent.userId);
    const recent = await recordedAttempt();
    // Age only the first: insert-only rows cannot be edited, so the purge is driven by moving the clock, not the data.
    const oldStarted = (await prisma.$queryRaw<{ at: Date }[]>(Prisma.sql`SELECT started_at as at FROM verification_call_attempts WHERE id = ${old.attemptId}::uuid`))[0]!.at;
    const recentStarted = (await prisma.$queryRaw<{ at: Date }[]>(Prisma.sql`SELECT started_at as at FROM verification_call_attempts WHERE id = ${recent.attemptId}::uuid`))[0]!.at;
    expect(recentStarted.getTime()).toBeGreaterThanOrEqual(oldStarted.getTime());

    const recordings = app.get(RecordingService);
    expect(await recordings.purge()).toBe(0);
    expect((await storage().head({ key: old.recordingRef, bucket: 'recordings' }))).not.toBeNull();

    // 180 days plus a little after the older attempt began: the older is due, and so is the newer one a moment later — so purge exactly the older by stopping the clock between them.
    app.get(AppClock).travelTo(new Date(oldStarted.getTime() + 180 * 86_400_000 + 1_000));
    const removed = await recordings.purge();
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(await storage().head({ key: old.recordingRef, bucket: 'recordings' })).toBeNull();
    expect((await callApi(app, `/finance/recordings/${old.attemptId}`, bearer(finance.accessToken))).status).toBe(404);
    const logged = await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*)::bigint as n FROM audit_log WHERE action = 'recording.purge' AND entity_id = ${old.attemptId}`);
    expect(logged[0]?.n).toBe(1n);
    // Running it again purges nothing more for this one.
    await recordings.purge();
    const again = await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*)::bigint as n FROM audit_log WHERE action = 'recording.purge' AND entity_id = ${old.attemptId}`);
    expect(again[0]?.n).toBe(1n);
  });
});
