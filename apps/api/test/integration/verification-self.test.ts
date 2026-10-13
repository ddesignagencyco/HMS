// apps/api/test/integration/verification-self.test.ts
//
// SHM-095 / FR-VC-16: the customer confirms and rates the job themselves.
//
// The gap this closes: a Tier A job whose verification agent never called had no customer-side exit at
// all. The link is only sent for Tier B jobs or after three unanswered calls, and the 72-hour sweep
// released the money without ever asking the customer ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â so the job was settled and their opinion of the
// work was thrown away. Every test below is that specific failure being impossible.
import { Prisma } from '@prisma/client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppClock } from '../../src/platform/app-clock.js';
import { TierRandom } from '../../src/booking/tier-routing.service.js';
import { SettingsService } from '../../src/platform/settings.service.js';
import { VerificationLinkService } from '../../src/verification/verification-link.service.js';
import { VerificationSweepsService } from '../../src/verification/verification-sweeps.service.js';
import { adminSession, callApi, createTestApp, postJson } from './harness.js';
import { agentSession, answeredCall, bearer, claim, completedJob, dropLocks, freezeInsideCallingHours, newProvider, prisma, travelToLocal, unfreeze, walletOf, type Job, type Provider } from './flow.js';

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

const happy = { workCompleted: 'FULL', quality: 5, punctuality: 5, conduct: 4, cleanliness: 5, extraChargeDemanded: false, consentToRelease: true, outcome: 'SATISFIED', remark: 'Sorted it first time, very tidy.' } as const;

const form = (job: Job, body: Record<string, unknown> = happy) =>
  callApi<SelfVerifyBody>(app, `/bookings/${job.id}/verification/confirmation`, bearer(job.customer.accessToken, postJson(body)));

type SelfVerifyBody = { outcome: string; bookingStatus: string; message: string; booking: { status: string; canSelfVerify: boolean; canConfirmCashReceived: boolean } };
type ProblemBody = { detail: string; errors?: { path: string; message: string }[] };

/** The same POST, typed for the error responses, so a `422`/`409` body can be asserted on directly. */
const problem = (job: Job, body: Record<string, unknown>) => callApi<ProblemBody>(app, `/bookings/${job.id}/verification/confirmation`, bearer(job.customer.accessToken, postJson(body)));

const openForm = (job: Job) => callApi<{ canSubmit: boolean; blockedReason: string | null; questions: unknown[]; providerFirstName: string | null; amountPaisa: number | null }>(app, `/bookings/${job.id}/verification/confirmation`, bearer(job.customer.accessToken));

const verificationRow = async (id: string) =>
  (await prisma.$queryRaw<{ status: string; outcome: string | null; confirmedVia: string | null; tier: string; priority: number; reasons: string[]; remark: string | null }[]>(
    Prisma.sql`SELECT status::text, outcome::text, confirmed_via::text as "confirmedVia", tier::text, priority, routing_reasons as reasons, remark_text as remark FROM verification_calls WHERE id = ${id}::uuid`
  ))[0]!;

const bookingStatus = async (id: string): Promise<string> => (await prisma.$queryRaw<{ s: string }[]>(Prisma.sql`SELECT status::text as s FROM bookings WHERE id = ${id}::uuid`))[0]!.s;

const countRatings = async (id: string): Promise<bigint> => (await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*)::bigint as n FROM ratings WHERE booking_id = ${id}::uuid`))[0]!.n;

describe('FR-VC-16: a customer can confirm and rate a job from the app', () => {
  it('the form opens, and it offers itself from the moment the job completes rather than waiting for a call', async () => {
    const job = await completedJob(app, provider, { mode: 'ONLINE' });
    // A Tier A job with an SLA running and nobody called: the exact case this feature exists for.
    expect(await bookingStatus(job.id)).toBe('AWAITING_VERIFICATION');

    const opened = await openForm(job);
    expect(opened.status).toBe(200);
    expect(opened.body.canSubmit).toBe(true);
    expect(opened.body.blockedReason).toBeNull();
    expect(opened.body.questions.length).toBeGreaterThan(0);
    expect(opened.body.amountPaisa).toBeGreaterThan(0);

    // And the booking row says so itself, so a client never has to infer it from the status string.
    const row = await callApi<{ canSelfVerify: boolean }>(app, `/bookings/${job.id}`, bearer(job.customer.accessToken));
    expect(row.body.canSelfVerify).toBe(true);
  });

  it('"everything was fine" releases an online payment and publishes the rating and the remark', async () => {
    const job = await completedJob(app, provider, { mode: 'ONLINE' });
    const before = await walletOf(provider.user.id);

    const answered = await form(job);
    expect(answered.status).toBe(200);
    expect(answered.body.outcome).toBe('CONFIRMED');
    expect(answered.body.bookingStatus).toBe('PAYMENT_RELEASED');
    expect(answered.body.message).toContain('released');
    expect(answered.body.booking.canSelfVerify).toBe(false);

    expect(await bookingStatus(job.id)).toBe('PAYMENT_RELEASED');
    expect(await walletOf(provider.user.id)).toBeGreaterThan(before);

    expect(await verificationRow(job.verificationId)).toMatchObject({ status: 'SUBMITTED', outcome: 'LINK_CONFIRMED', confirmedVia: 'IN_APP' });

    const rating = await prisma.$queryRaw<{ score: string; body: string; displayName: string; firstName: string; lastName: string }[]>(
      Prisma.sql`SELECT r.score::text, m.body, m.display_name as "displayName", u.first_name as "firstName", u.last_name as "lastName"
        FROM ratings r JOIN remarks m ON m.rating_id = r.id JOIN users u ON u.id = r.customer_id WHERE r.booking_id = ${job.id}::uuid`
    );
    expect(Number(rating[0]?.score)).toBe(4.75);
    expect(rating[0]?.body).toBe('Sorted it first time, very tidy.');
    // FR-RT-06: only a first name and an initial next to a remark, never the full name.
    expect(rating[0]?.displayName).toBe(`${rating[0]?.firstName} ${rating[0]?.lastName.charAt(0).toUpperCase()}.`);
    expect(rating[0]?.displayName).not.toContain(rating[0]?.lastName);
  });

  it('for a cash job it authorises the handover and the provider then confirms they were paid', async () => {
    const job = await completedJob(app, provider, { mode: 'CASH' });
    const answered = await form(job);
    expect(answered.body.outcome).toBe('CONFIRMED');
    // Cash never reaches PAYMENT_RELEASED from the form ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â the provider's confirmation does that, and
    // the button they use is `canConfirmCashReceived`, not `paymentStatus`.
    expect(answered.body.bookingStatus).toBe('VERIFIED');
    expect(answered.body.booking.canConfirmCashReceived).toBe(true);
    expect(answered.body.message).toContain('collect the payment');
    expect(await countRatings(job.id)).toBe(1n);

    const authorised = await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*)::bigint as n FROM outbox_events WHERE type = 'booking.cash_authorised' AND payload->>'bookingId' = ${job.id}`);
    expect(authorised[0]?.n).toBe(1n);

    const settled = await callApi(app, `/bookings/${job.id}/cash-received`, bearer(provider.accessToken, { method: 'POST' }));
    expect(settled.status).toBe(200);
    expect(await bookingStatus(job.id)).toBe('PAYMENT_RELEASED');
  });

  it('"done, but there was a problem" still releases the money and raises a quality complaint against the provider', async () => {
    const job = await completedJob(app, provider, { mode: 'ONLINE' });
    const answered = await form(job, { ...happy, outcome: 'WITH_ISSUE', quality: 2, remark: 'It works, but the wall is a mess.' });

    expect(answered.body.outcome).toBe('CONFIRMED_WITH_ISSUE');
    expect(answered.body.bookingStatus).toBe('PAYMENT_RELEASED');
    // The customer's money is theirs: the payment still moves, and the complaint is what follows.
    expect(answered.body.message).toContain('told about the problem');

    const complaints = await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*)::bigint as n FROM complaints WHERE booking_id = ${job.id}::uuid AND category = 'QUALITY'`);
    expect(complaints[0]?.n).toBe(1n);
    const flags = await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*)::bigint as n FROM provider_flags WHERE booking_id = ${job.id}::uuid AND kind = 'VERIFIED_WITH_ISSUE'`);
    expect(flags[0]?.n).toBe(1n);
    expect(await countRatings(job.id)).toBe(1n);
  });

  it('"not acceptable" releases nothing and puts the case in front of a person at the top of the queue', async () => {
    const job = await completedJob(app, provider, { mode: 'ONLINE' });
    const before = await walletOf(provider.user.id);

    const answered = await form(job, { ...happy, outcome: 'NOT_ACCEPTABLE', remark: 'Nothing was actually fixed.' });
    expect(answered.status).toBe(200);
    expect(answered.body.outcome).toBe('ESCALATED');
    expect(answered.body.message).toContain('Nothing has been released');

    // The money has not moved, and the job is still open rather than settled against the customer.
    expect(answered.body.bookingStatus).toBe('AWAITING_VERIFICATION');
    expect(await walletOf(provider.user.id)).toBe(before);
    expect(await countRatings(job.id)).toBe(0n);

    // A person, not a form, decides what happens next.
    expect(await verificationRow(job.verificationId)).toMatchObject({ status: 'QUEUED', outcome: null, tier: 'A', priority: 0 });
    const row = await verificationRow(job.verificationId);
    expect(row.reasons).toContain('CUSTOMER_NOT_ACCEPTED');
    // The answers they typed are already on the record, so the agent does not ring to ask what happened.
    expect(row.remark).toBe('Nothing was actually fixed.');
  });

  it('no work done escalates on integrity grounds even when the customer pressed "everything was fine"', async () => {
    const job = await completedJob(app, provider, { mode: 'ONLINE' });
    // The contradiction is refused outright rather than resolved in the customer's favour, and the
    // field that contradicts is named back to them.
    const contradictory = await problem(job, { ...happy, workCompleted: 'NONE' });
    expect(contradictory.status).toBe(422);
    expect(contradictory.body.errors?.map(error => error.path)).toContain('workCompleted');
    expect(await bookingStatus(job.id)).toBe('AWAITING_VERIFICATION');

    // Answering it honestly instead escalates, and a complaint path is still available to them.
    const honest = await form(job, { ...happy, workCompleted: 'NONE', outcome: 'NOT_ACCEPTABLE' });
    expect(honest.body.outcome).toBe('ESCALATED');
    expect((await verificationRow(job.verificationId)).reasons).toContain('CUSTOMER_INTEGRITY_FLAG');
  });

  it('an extra charge demanded escalates, and no demerit is proposed against the provider on an unverified claim', async () => {
    const job = await completedJob(app, provider, { mode: 'ONLINE' });
    const refused = await problem(job, { ...happy, extraChargeDemanded: true });
    expect(refused.status).toBe(422);

    const answered = await form(job, { ...happy, extraChargeDemanded: true, outcome: 'NOT_ACCEPTABLE' });
    expect(answered.body.outcome).toBe('ESCALATED');
    expect((await verificationRow(job.verificationId)).reasons).toContain('CUSTOMER_INTEGRITY_FLAG');

    // The escalation exists so a person checks the claim. Proposing a demerit here would put an
    // accusation against the provider on the strength of an unchecked form; the agent proposes it if
    // the call confirms it.
    const proposed = await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*)::bigint as n FROM penalties WHERE provider_id = ${provider.id}::uuid AND breach_code = 'OVERCHARGE'`);
    expect(proposed[0]?.n).toBe(0n);
  });

  it('refuses a release the customer has not agreed to', async () => {
    const job = await completedJob(app, provider, { mode: 'ONLINE' });
    const refused = await problem(job, { ...happy, consentToRelease: false });
    expect(refused.status).toBe(422);
    expect(await bookingStatus(job.id)).toBe('AWAITING_VERIFICATION');
    expect(await countRatings(job.id)).toBe(0n);
  });
});

describe('FR-VC-16: what the form refuses, and why', () => {
  it('is 409 with the reason, not a silent no-op, once an agent is on the phone', async () => {
    const job = await completedJob(app, provider, { mode: 'ONLINE' });
    travelToLocal(app, 10, 30);
    expect((await claim(app, agent.accessToken, job.verificationId)).status).toBe(200);

    // The form says so rather than offering a button that would be rejected.
    const opened = await openForm(job);
    expect(opened.status).toBe(200);
    expect(opened.body.canSubmit).toBe(false);
    expect(opened.body.blockedReason).toContain('calling you');

    const refused = await problem(job, happy);
    expect(refused.status).toBe(409);
    expect(refused.body.detail).toContain('calling you');
    expect(await bookingStatus(job.id)).toBe('AWAITING_VERIFICATION');

    // And once the agent puts the call back, the customer's own route opens again.
    await dropLocks(agent.userId);
    expect((await openForm(job)).body.canSubmit).toBe(true);
    expect((await form(job)).body.outcome).toBe('CONFIRMED');
  });

  it('will not let one job be confirmed twice, and closes the texted link so the other door is shut too', async () => {
    const job = await completedJob(app, provider, { mode: 'ONLINE' });
    // A Tier B-style link was texted for this same call; the customer opens the app instead.
    const links = app.get(VerificationLinkService);
    await links.issue(job.id, job.verificationId, 'TIER_B');
    const linkRows = await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*)::bigint as n FROM verification_links WHERE verification_call_id = ${job.verificationId}::uuid`);
    expect(linkRows[0]?.n).toBe(1n);

    expect((await form(job)).body.outcome).toBe('CONFIRMED');

    // Answering through the link afterwards is 410, not a second release and a second rating.
    const token = await prisma.$queryRaw<{ t: string }[]>(Prisma.sql`SELECT token_hash::text as t FROM verification_links WHERE verification_call_id = ${job.verificationId}::uuid`);
    expect(token).toHaveLength(1);
    const closed = await prisma.$queryRaw<{ respondedAt: Date | null; answers: Record<string, unknown> }[]>(
      Prisma.sql`SELECT responded_at as "respondedAt", answers FROM verification_links WHERE verification_call_id = ${job.verificationId}::uuid`
    );
    expect(closed[0]?.respondedAt).not.toBeNull();
    expect(closed[0]?.answers).toMatchObject({ source: 'IN_APP', via: 'SUBMITTED' });

    const releases = await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*)::bigint as n FROM ledger_transactions WHERE booking_id = ${job.id}::uuid AND type = 'RELEASE'`);
    expect(releases[0]?.n).toBe(1n);
    expect(await countRatings(job.id)).toBe(1n);
  });

  it('is closed on a job somebody else booked ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â 404, because another booking is not this customerÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢s business', async () => {
    const job = await completedJob(app, provider, { mode: 'ONLINE' });
    const other = await completedJob(app, provider, { mode: 'ONLINE' });
    expect((await callApi(app, `/bookings/${job.id}/verification/confirmation`, bearer(other.customer.accessToken))).status).toBe(404);
    expect((await callApi(app, `/bookings/${job.id}/verification/confirmation`, bearer(other.customer.accessToken, postJson(happy)))).status).toBe(404);
    expect((await callApi(app, `/bookings/${job.id}/verification/confirmation`)).status).toBe(401);
    expect(await bookingStatus(job.id)).toBe('AWAITING_VERIFICATION');
  });

  it('is closed once the job is settled, and says why rather than 404ing', async () => {
    const job = await completedJob(app, provider, { mode: 'ONLINE' });
    expect((await form(job)).body.outcome).toBe('CONFIRMED');

    const again = await openForm(job);
    expect(again.status).toBe(200);
    expect(again.body.canSubmit).toBe(false);
    // The online release stamps `released_at`, so this is the more useful of the two messages: what the
    // customer actually wants to know about a settled job is that the money has gone, not that a
    // question was already answered.
    expect(again.body.blockedReason).toBe('This job has already been paid for.');
    expect((await form(job)).status).toBe(409);
  });

  it('is closed on a return visit that has already been paid for, rather than promising money that moved weeks ago', async () => {
    const job = await completedJob(app, provider, { mode: 'ONLINE' });
    await form(job);

    // A warranty re-check puts the booking back through AWAITING_VERIFICATION on a new visit, with the
    // money long gone. Reaching that through the real claim-and-return-visit path would need a second
    // full visit on site, and what is under test here is only the *form's* answer to the state — so the
    // status is set directly and put back afterwards, because `money-safety.test.ts` scans every booking
    // in the database and a status with no history row behind it would fail its invariant. The visit-2
    // verification is left in place: it is what a real return visit would have left, and it is the same
    // row the form declines to act on.
    try {
      await prisma.$transaction(async tx => {
        await tx.$executeRaw(Prisma.sql`SET LOCAL app.transition_ctx = 'on'`);
        await tx.$executeRaw(Prisma.sql`UPDATE bookings SET status = 'WORK_COMPLETED'::booking_status WHERE id = ${job.id}::uuid`);
      });
      await prisma.$executeRaw(Prisma.sql`INSERT INTO verification_calls(booking_id, visit_no, tier, routing_reasons, priority, sla_due_at) VALUES (${job.id}::uuid, 2, 'A'::verification_tier, ARRAY['R5_WARRANTY']::text[], 1, now())`);

      const opened = await openForm(job);
      expect(opened.body.canSubmit).toBe(false);
      expect(opened.body.blockedReason).toBe('This job has already been paid for.');
      expect((await problem(job, happy)).status).toBe(409);

      // And the derived flag agrees, so a client that renders off `canSelfVerify` alone cannot get it wrong.
      const row = await callApi<{ canSelfVerify: boolean }>(app, `/bookings/${job.id}`, bearer(job.customer.accessToken));
      expect(row.body.canSelfVerify).toBe(false);
    } finally {
      await prisma.$transaction(async tx => {
        await tx.$executeRaw(Prisma.sql`SET LOCAL app.transition_ctx = 'on'`);
        await tx.$executeRaw(Prisma.sql`UPDATE bookings SET status = 'PAYMENT_RELEASED'::booking_status WHERE id = ${job.id}::uuid`);
      });
    }
  });

  it('an ops switch turns the whole thing off without a deploy', async () => {
    const settings = app.get(SettingsService);
    const admin = await adminSession(app);
    const job = await completedJob(app, provider, { mode: 'ONLINE' });
    try {
      await settings.set('verification.self_verify_enabled', false, admin.userId);
      const opened = await openForm(job);
      expect(opened.body.canSubmit).toBe(false);
      expect(opened.body.blockedReason).toContain('switched off');
      expect((await form(job)).status).toBe(409);
      expect(await bookingStatus(job.id)).toBe('AWAITING_VERIFICATION');
    } finally {
      await settings.set('verification.self_verify_enabled', true, admin.userId);
    }
  });
});

describe('FR-VC-16: the 72-hour sweep and the customer form do not both decide', () => {
  const releases = async (id: string): Promise<bigint> => (await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*)::bigint as n FROM ledger_transactions WHERE booking_id = ${id}::uuid AND type = 'RELEASE'`))[0]!.n;

  it('once the customer has confirmed, the auto-release finds nothing left to release on that job', async () => {
    const job = await completedJob(app, provider, { mode: 'ONLINE' });
    const completedAt = (await prisma.$queryRaw<{ at: Date }[]>(Prisma.sql`SELECT completed_at as at FROM bookings WHERE id = ${job.id}::uuid`))[0]!.at;

    // Confirmed long before the sweep would have fired, which is the whole point.
    expect((await form(job)).body.outcome).toBe('CONFIRMED');

    app.get(AppClock).travelTo(new Date(completedAt.getTime() + 100 * 3_600_000));
    await app.get(VerificationSweepsService).autoRelease();

    // One rating and one release, not two ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â the customer's answer stands and the sweep leaves it alone.
    expect(await bookingStatus(job.id)).toBe('PAYMENT_RELEASED');
    expect(await countRatings(job.id)).toBe(1n);
    expect(await releases(job.id)).toBe(1n);
  });

  it('a job the customer rejected is never auto-released, however long ago it finished', async () => {
    const job = await completedJob(app, provider, { mode: 'ONLINE' });
    const completedAt = (await prisma.$queryRaw<{ at: Date }[]>(Prisma.sql`SELECT completed_at as at FROM bookings WHERE id = ${job.id}::uuid`))[0]!.at;

    expect((await form(job, { ...happy, outcome: 'NOT_ACCEPTABLE' })).body.outcome).toBe('ESCALATED');

    // The sweep exists for a customer who never answers. This one did answer ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â they answered "no" ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â so
    // releasing on a timer would settle the job against them without anyone ever looking at it. Well
    // past the 72-hour mark, and well past the escalation's own 30-minute SLA, which must not be mistaken
    // for permission.
    app.get(AppClock).travelTo(new Date(completedAt.getTime() + 100 * 3_600_000));
    await app.get(VerificationSweepsService).autoRelease();
    expect(await bookingStatus(job.id)).toBe('AWAITING_VERIFICATION');
    expect(await releases(job.id)).toBe(0n);
    expect(await verificationRow(job.verificationId)).toMatchObject({ status: 'QUEUED', outcome: null });

    app.get(AppClock).travelTo(new Date(completedAt.getTime() + 900 * 3_600_000));
    await app.get(VerificationSweepsService).autoRelease();
    expect(await bookingStatus(job.id)).toBe('AWAITING_VERIFICATION');
    expect(await releases(job.id)).toBe(0n);

    // What makes the case findable instead: it is in the queue, and its SLA is flagged as breached.
    await app.get(VerificationSweepsService).escalateTierB();
    const queue = await callApi<{ items: { id: string; slaBreached: boolean }[] }>(app, '/agent/queue', bearer(agent.accessToken));
    const listed = queue.body.items.find(item => item.id === job.verificationId);
    expect(listed?.slaBreached).toBe(true);
  });

  it('the agent can still take over after the customer declined, and their answer is already on the record', async () => {
    const job = await completedJob(app, provider, { mode: 'ONLINE' });
    expect((await form(job, { ...happy, outcome: 'NOT_ACCEPTABLE', remark: 'Still leaking.' })).body.outcome).toBe('ESCALATED');

    const queue = await callApi<{ items: { id: string }[] }>(app, '/agent/queue', bearer(agent.accessToken));
    expect(queue.body.items.map(item => item.id)).toContain(job.verificationId);

    travelToLocal(app, 10, 30);
    await prisma.$executeRaw(Prisma.sql`UPDATE verification_calls SET next_attempt_at = now() - interval '1 minute' WHERE id = ${job.verificationId}::uuid`);
    expect((await claim(app, agent.accessToken, job.verificationId)).status).toBe(200);
    expect((await answeredCall(app, agent.accessToken, job.verificationId)).status).toBe(201);

    const verified = await callApi<{ bookingStatus: string; released: boolean }>(app, `/agent/verifications/${job.verificationId}/submit`, bearer(agent.accessToken, postJson({
      workCompleted: 'FULL', quality: 5, punctuality: 5, conduct: 5, cleanliness: 5, extraChargeDemanded: false, uniformWorn: true, ownTools: true, consentLineRead: true, consentToRelease: true, outcome: 'VERIFIED_SATISFIED'
    })));
    expect(verified.status).toBe(200);
    expect(verified.body.bookingStatus).toBe('PAYMENT_RELEASED');

    // The agent's verdict, not the customer's, is what is recorded ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â and with no transport tag, because
    // nobody confirmed this one through a form. The handover replaced a customer's "no", it did not
    // quietly complete it.
    expect(await verificationRow(job.verificationId)).toMatchObject({ outcome: 'VERIFIED_SATISFIED', confirmedVia: null });
    expect(await releases(job.id)).toBe(1n);
  });
});
