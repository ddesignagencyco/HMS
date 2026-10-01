// apps/api/test/integration/verification-unreachable.test.ts
//
// SHM-059: call attempts across time bands, the one-tap verification link, the 72-hour auto-release, and Tier B.
import { Prisma } from '@prisma/client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppClock } from '../../src/platform/app-clock.js';
import { TierRandom } from '../../src/booking/tier-routing.service.js';
import { SettingsService } from '../../src/platform/settings.service.js';
import { VerificationLinkService } from '../../src/verification/verification-link.service.js';
import { VerificationSweepsService } from '../../src/verification/verification-sweeps.service.js';
import { adminSession, callApi, createTestApp, postJson } from './harness.js';
import { agentSession, bearer, claim, completedJob, dropLocks, freezeInsideCallingHours, newProvider, prisma, travelToLocal, unfreeze, type Job, type Provider } from './flow.js';

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
  app.get(TierRandom).pin(null);
  freezeInsideCallingHours(app);
  await dropLocks(agent.userId);
});

afterAll(async () => {
  unfreeze(app);
  await close();
  await prisma.$disconnect();
});

const attempt = (job: Job, body: Record<string, unknown>) => callApi<{ attemptNo: number; band: string; nextAttemptAt: string | null; linkSent: boolean; code?: string }>(app, `/agent/verifications/${job.verificationId}/attempts`, bearer(agent.accessToken, postJson(body)));

const inboxFor = async (phone: string): Promise<{ channel: string; body: string }[]> => {
  const inbox = await callApi<{ items: { channel: string; recipient: string; body: string }[] }>(app, '/dev/inbox?limit=200');
  return inbox.body.items.filter(item => item.recipient === phone);
};

/** The link and code the customer was texted, read back out of the dev inbox the way a person reads their phone. */
const linkFrom = async (phone: string): Promise<{ token: string; otp: string }> => {
  const message = (await inboxFor(phone)).find(entry => entry.channel === 'SMS' && /\/v\//.test(entry.body));
  if (message === undefined) throw new Error('No verification link was texted');
  const token = /\/v\/([A-Za-z0-9_-]+)/.exec(message.body)?.[1];
  const otp = /\b(\d{6})\b/.exec(message.body.replace(/\/v\/[A-Za-z0-9_-]+/, ''))?.[1];
  if (token === undefined || otp === undefined) throw new Error(`Could not read link and code from: ${message.body}`);
  return { token, otp };
};

const positive = { workCompleted: 'FULL', quality: 5, punctuality: 5, conduct: 4, cleanliness: 5, extraChargeDemanded: false, consentToRelease: true } as const;

const verificationRow = async (id: string) =>
  (await prisma.$queryRaw<{ status: string; tier: string; outcome: string | null; reasons: string[]; priority: number; next: Date; due: Date }[]>(
    Prisma.sql`SELECT status::text, tier::text, outcome::text, routing_reasons as reasons, priority, next_attempt_at as next, sla_due_at as due FROM verification_calls WHERE id = ${id}::uuid`
  ))[0]!;

const bookingStatus = async (id: string): Promise<string> => (await prisma.$queryRaw<{ s: string }[]>(Prisma.sql`SELECT status::text as s FROM bookings WHERE id = ${id}::uuid`))[0]!.s;

describe('SHM-059: call attempts and the unreachable customer', () => {
  it('an unanswered attempt goes back to the queue for a different time band, and the same band is refused', async () => {
    const job = await completedJob(app, provider, { mode: 'CASH' });
    travelToLocal(app, 10, 30);
    await claim(app, agent.accessToken, job.verificationId);
    const first = await attempt(job, { result: 'NO_ANSWER', durationSeconds: 30 });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ attemptNo: 1, band: 'MORNING', linkSent: false });
    expect(new Date(first.body.nextAttemptAt!).toISOString().slice(11, 16)).toBe('07:00'); // 12:00 in Pakistan

    const row = await verificationRow(job.verificationId);
    expect(row.status).toBe('QUEUED');
    // Not offered again before its next band opens…
    expect((await claim(app, agent.accessToken, job.verificationId)).status).toBe(409);
    // …and once the afternoon band opens, it is.
    travelToLocal(app, 12, 5);
    expect((await claim(app, agent.accessToken, job.verificationId)).status).toBe(200);
    const second = await attempt(job, { result: 'BUSY' });
    expect(second.body).toMatchObject({ attemptNo: 2, band: 'AFTERNOON', linkSent: false });

    // A band that has already been tried for this call is not tried again.
    travelToLocal(app, 12, 30);
    await prisma.$executeRaw(Prisma.sql`UPDATE verification_calls SET next_attempt_at = now() - interval '1 minute' WHERE id = ${job.verificationId}::uuid`);
    await claim(app, agent.accessToken, job.verificationId);
    const repeat = await attempt(job, { result: 'NO_ANSWER' });
    expect(repeat.status).toBe(409);
  });

  it('refuses to log a call outside calling hours', async () => {
    const job = await completedJob(app, provider, { mode: 'CASH' });
    await claim(app, agent.accessToken, job.verificationId);
    travelToLocal(app, 23, 0);
    const late = await attempt(job, { result: 'NO_ANSWER' });
    expect(late.status).toBe(423);
  });

  it('after three unanswered attempts in three bands the customer is texted a one-tap link (SMS and WhatsApp), and the call waits', async () => {
    const job = await completedJob(app, provider, { mode: 'CASH' });
    for (const [hour, result] of [[10, 'NO_ANSWER'], [13, 'BUSY'], [18, 'SWITCHED_OFF']] as const) {
      travelToLocal(app, hour, 0);
      await prisma.$executeRaw(Prisma.sql`UPDATE verification_calls SET next_attempt_at = now() - interval '1 minute' WHERE id = ${job.verificationId}::uuid`);
      expect((await claim(app, agent.accessToken, job.verificationId)).status).toBe(200);
      const logged = await attempt(job, { result });
      expect(logged.status).toBe(201);
      expect(logged.body.linkSent).toBe(hour === 18);
    }
    const messages = await inboxFor(job.customer.phoneE164);
    expect(messages.filter(entry => /\/v\//.test(entry.body)).map(entry => entry.channel).sort()).toEqual(['SMS', 'WHATSAPP']);
    const row = await verificationRow(job.verificationId);
    expect(row.status).toBe('QUEUED');
    expect(row.next.getTime()).toBeGreaterThan(Date.now() + 60 * 3_600_000);
    const attempts = await prisma.$queryRaw<{ n: bigint; bands: bigint }[]>(Prisma.sql`SELECT count(*)::bigint as n, count(DISTINCT band)::bigint as bands FROM verification_call_attempts WHERE verification_call_id = ${job.verificationId}::uuid`);
    expect(attempts[0]).toEqual({ n: 3n, bands: 3n });
    await expect(prisma.$executeRaw(Prisma.sql`UPDATE verification_call_attempts SET result = 'ANSWERED'::attempt_result WHERE verification_call_id = ${job.verificationId}::uuid`)).rejects.toThrow();
  });
});

describe('SHM-059: the verification link', () => {
  const unreachable = async (mode: 'ONLINE' | 'CASH' = 'ONLINE'): Promise<{ job: Job; token: string; otp: string }> => {
    const job = await completedJob(app, provider, { mode });
    const issued = await app.get(VerificationLinkService).issue(job.id, job.verificationId, 'UNREACHABLE');
    expect(issued.issued).toBe(true);
    return { job, ...(await linkFrom(job.customer.phoneE164)) };
  };

  it('shows the customer enough to recognise the job, and nothing more, without logging in', async () => {
    const { job, token } = await unreachable();
    const page = await callApi<{ bookingCode: string; serviceName: string; providerFirstName: string; questions: unknown[] }>(app, `/v/${token}`);
    expect(page.status).toBe(200);
    expect(page.body.bookingCode).toBe(job.code);
    expect(page.body.questions).toHaveLength(4);
    expect(JSON.stringify(page.body)).not.toContain(job.customer.phoneE164);
    expect((await callApi(app, '/v/not-a-real-token-at-all-0000000')).status).toBe(404);
  });

  it('a clean, consenting answer confirms the job (LINK_CONFIRMED), releases the money and publishes the rating without a remark', async () => {
    const { job, token, otp } = await unreachable('ONLINE');
    const answered = await callApi<{ status: string }>(app, `/v/${token}`, postJson({ otp, ...positive }));
    expect(answered.status).toBe(200);
    expect(answered.body.status).toBe('CONFIRMED');
    expect(await bookingStatus(job.id)).toBe('PAYMENT_RELEASED');
    const row = await verificationRow(job.verificationId);
    expect(row.outcome).toBe('LINK_CONFIRMED');
    const rating = await prisma.$queryRaw<{ score: string; remarks: bigint }[]>(Prisma.sql`SELECT r.score::text, (SELECT count(*) FROM remarks m WHERE m.rating_id = r.id)::bigint as remarks FROM ratings r WHERE r.booking_id = ${job.id}::uuid`);
    expect(Number(rating[0]?.score)).toBe(4.75);
    expect(rating[0]?.remarks).toBe(0n);
  });

  it('a used or expired link is 410 Gone', async () => {
    const { token, otp } = await unreachable('CASH');
    await callApi(app, `/v/${token}`, postJson({ otp, ...positive }));
    expect((await callApi(app, `/v/${token}`)).status).toBe(410);
    expect((await callApi(app, `/v/${token}`, postJson({ otp, ...positive }))).status).toBe(410);

    const second = await unreachable('CASH');
    await prisma.$executeRaw(Prisma.sql`UPDATE verification_links SET expires_at = now() - interval '1 minute' WHERE verification_call_id = ${second.job.verificationId}::uuid`);
    expect((await callApi(app, `/v/${second.token}`)).status).toBe(410);
  });

  it('a wrong code is 422 with the attempts left; the fifth locks the link with 423, even for the right code', async () => {
    const { job, token, otp } = await unreachable();
    const first = await callApi<{ code: string; detail: string }>(app, `/v/${token}`, postJson({ otp: otp === '000000' ? '111111' : '000000', ...positive }));
    expect(first.status).toBe(422);
    expect(first.body.detail).toContain('4 attempt');
    for (let index = 0; index < 3; index += 1) await callApi(app, `/v/${token}`, postJson({ otp: '999999' === otp ? '888888' : '999999', ...positive }));
    const fifth = await callApi(app, `/v/${token}`, postJson({ otp: otp === '999999' ? '888888' : '999999', ...positive }));
    expect(fifth.status).toBe(423);
    const locked = await callApi(app, `/v/${token}`, postJson({ otp, ...positive }));
    expect(locked.status).toBe(423);
    expect(await bookingStatus(job.id)).toBe('AWAITING_VERIFICATION');
  });

  it('any sign of a problem releases nothing and puts the case back with a person, at the front of the queue', async () => {
    const { job, token, otp } = await unreachable('ONLINE');
    const answered = await callApi<{ status: string }>(app, `/v/${token}`, postJson({ otp, ...positive, extraChargeDemanded: true }));
    expect(answered.status).toBe(200);
    expect(answered.body.status).toBe('ESCALATED');
    expect(await bookingStatus(job.id)).toBe('AWAITING_VERIFICATION');
    const row = await verificationRow(job.verificationId);
    expect(row).toMatchObject({ status: 'QUEUED', tier: 'A', outcome: null, priority: 0 });
    expect(row.reasons).toContain('LINK_NEGATIVE');
    const ratings = await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*)::bigint as n FROM ratings WHERE booking_id = ${job.id}::uuid`);
    expect(ratings[0]?.n).toBe(0n);
  });

  it('asking for a link twice while one is open sends only one', async () => {
    const job = await completedJob(app, provider, { mode: 'CASH' });
    const links = app.get(VerificationLinkService);
    expect((await links.issue(job.id, job.verificationId, 'UNREACHABLE')).issued).toBe(true);
    expect((await links.issue(job.id, job.verificationId, 'UNREACHABLE')).issued).toBe(false);
    expect((await inboxFor(job.customer.phoneE164)).filter(entry => /\/v\//.test(entry.body) && entry.channel === 'SMS')).toHaveLength(1);
  });
});

describe('SHM-059: auto-release after 72 hours', () => {
  const completedAt = async (id: string): Promise<Date> => (await prisma.$queryRaw<{ at: Date }[]>(Prisma.sql`SELECT completed_at as at FROM bookings WHERE id = ${id}::uuid`))[0]!.at;

  it('releases an unverified online job at 72 hours — not before — with no rating and the outcome AUTO_RELEASED', async () => {
    const job = await completedJob(app, provider, { mode: 'ONLINE' });
    const done = await completedAt(job.id);
    const sweeps = app.get(VerificationSweepsService);

    app.get(AppClock).travelTo(new Date(done.getTime() + 71 * 3_600_000));
    await sweeps.autoRelease();
    expect(await bookingStatus(job.id)).toBe('AWAITING_VERIFICATION');

    app.get(AppClock).travelTo(new Date(done.getTime() + 73 * 3_600_000));
    await Promise.all([sweeps.autoRelease(), sweeps.autoRelease()]);
    await sweeps.autoRelease();
    expect(await bookingStatus(job.id)).toBe('PAYMENT_RELEASED');
    expect((await verificationRow(job.verificationId)).outcome).toBe('AUTO_RELEASED');
    const ratings = await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*)::bigint as n FROM ratings WHERE booking_id = ${job.id}::uuid`);
    expect(ratings[0]?.n).toBe(0n);
    const releases = await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*)::bigint as n FROM ledger_transactions WHERE booking_id = ${job.id}::uuid AND type = 'RELEASE'`);
    expect(releases[0]?.n).toBe(1n);
  });

  it('for a cash job it authorises the provider to collect (AUTO_RELEASED) and releases nothing itself', async () => {
    const job = await completedJob(app, provider, { mode: 'CASH' });
    app.get(AppClock).travelTo(new Date((await completedAt(job.id)).getTime() + 73 * 3_600_000));
    await app.get(VerificationSweepsService).autoRelease();
    expect(await bookingStatus(job.id)).toBe('AUTO_RELEASED');
    const events = await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*)::bigint as n FROM outbox_events WHERE type = 'booking.cash_authorised' AND payload->>'bookingId' = ${job.id}`);
    expect(events[0]?.n).toBe(1n);
  });

  it('never releases a job an agent has already decided', async () => {
    const job = await completedJob(app, provider, { mode: 'ONLINE' });
    await claim(app, agent.accessToken, job.verificationId);
    await callApi(app, `/agent/verifications/${job.verificationId}/attempts`, bearer(agent.accessToken, postJson({ result: 'ANSWERED' })));
    await callApi(app, `/agent/verifications/${job.verificationId}/submit`, bearer(agent.accessToken, postJson({ workCompleted: 'FULL', quality: 5, punctuality: 5, conduct: 5, cleanliness: 5, extraChargeDemanded: true, extraChargeAmountPaisa: 1000, uniformWorn: true, ownTools: true, consentLineRead: true, consentToRelease: false, outcome: 'DISPUTED' })));
    app.get(AppClock).travelTo(new Date((await completedAt(job.id)).getTime() + 100 * 3_600_000));
    await app.get(VerificationSweepsService).autoRelease();
    expect(await bookingStatus(job.id)).toBe('DISPUTED');
  });
});

describe('SHM-054 / SHM-059: Tier B', () => {
  /** Makes a routine online job Tier B: no new-provider rule, no quick-job rule, no random sample. Settings are restored afterwards. */
  const asTierB = async <T>(run: () => Promise<T>): Promise<T> => {
    const settings = app.get(SettingsService);
    const admin = await adminSession(app);
    const keys = ['tier.first_jobs', 'tier.min_time_ratio', 'tier.sample_rate'] as const;
    const originals = await Promise.all(keys.map(async key => [key, await settings.get<number>(key)] as const));
    try {
      await settings.set('tier.first_jobs', 0, admin.userId);
      await settings.set('tier.min_time_ratio', 0, admin.userId);
      await settings.set('tier.sample_rate', 0, admin.userId);
      app.get(TierRandom).pin(() => 0.99);
      return await run();
    } finally {
      for (const [key, value] of originals) if (value !== null) await settings.set(key, value, admin.userId);
    }
  };

  it('a routine online job is Tier B with no reasons: no agent call, a link instead, and a 24-hour escalation deadline', async () => {
    const job = await asTierB(() => completedJob(app, provider, { mode: 'ONLINE', minutesOnSite: 60 }));
    const row = await verificationRow(job.verificationId);
    expect(row).toMatchObject({ tier: 'B', status: 'QUEUED', reasons: [] });
    expect(row.due.getTime() - app.get(AppClock).now().getTime()).toBeGreaterThan(23 * 3_600_000);
    const events = await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*)::bigint as n FROM outbox_events WHERE type = 'verification.link_requested' AND payload->>'verificationId' = ${job.verificationId}`);
    expect(events[0]?.n).toBe(1n);
    // It never shows up in the agents' queue.
    const list = await callApi<{ items: { id: string }[] }>(app, '/agent/queue', bearer(agent.accessToken));
    expect(list.body.items.map(item => item.id)).not.toContain(job.verificationId);
    // The worker delivers the link; the customer answers; the job releases.
    await app.get(VerificationLinkService).issue(job.id, job.verificationId, 'TIER_B');
    const { token, otp } = await linkFrom(job.customer.phoneE164);
    const answered = await callApi<{ status: string }>(app, `/v/${token}`, postJson({ otp, ...positive }));
    expect(answered.body.status).toBe('CONFIRMED');
    expect(await bookingStatus(job.id)).toBe('PAYMENT_RELEASED');
  });

  it('a cash job is Tier A whatever else is true (R8)', async () => {
    const job = await asTierB(() => completedJob(app, provider, { mode: 'CASH', minutesOnSite: 60 }));
    const row = await verificationRow(job.verificationId);
    expect(row.tier).toBe('A');
    expect(row.reasons).toEqual(['R8_CASH']);
  });

  it('a Tier B job the customer never answers escalates to Tier A after 24 hours, with the reason recorded', async () => {
    const job = await asTierB(() => completedJob(app, provider, { mode: 'ONLINE', minutesOnSite: 60 }));
    const sweeps = app.get(VerificationSweepsService);
    await sweeps.escalateTierB();
    expect((await verificationRow(job.verificationId)).tier).toBe('B');

    app.get(AppClock).advanceMinutes(25 * 60);
    await Promise.all([sweeps.escalateTierB(), sweeps.escalateTierB()]);
    const row = await verificationRow(job.verificationId);
    expect(row.tier).toBe('A');
    expect(row.reasons).toEqual(['B_NO_RESPONSE']);
    expect((await prisma.$queryRaw<{ tier: string }[]>(Prisma.sql`SELECT verification_tier::text as tier FROM bookings WHERE id = ${job.id}::uuid`))[0]?.tier).toBe('A');
    const list = await callApi<{ items: { id: string }[] }>(app, '/agent/queue', bearer(agent.accessToken));
    expect(list.body.items.map(item => item.id)).toContain(job.verificationId);
  });

  it('R9: the random sample sends an otherwise routine job to Tier A when the draw says so', async () => {
    const settings = app.get(SettingsService);
    const admin = await adminSession(app);
    const original = await settings.get<number>('tier.first_jobs');
    try {
      await settings.set('tier.first_jobs', 0, admin.userId);
      await settings.set('tier.min_time_ratio', 0, admin.userId);
      app.get(TierRandom).pin(() => 0);
      const job = await completedJob(app, provider, { mode: 'ONLINE', minutesOnSite: 60 });
      expect((await verificationRow(job.verificationId)).reasons).toEqual(['R9_RANDOM_SAMPLE']);
    } finally {
      if (original !== null) await settings.set('tier.first_jobs', original, admin.userId);
      await settings.set('tier.min_time_ratio', 0.4, admin.userId);
    }
  });
});
