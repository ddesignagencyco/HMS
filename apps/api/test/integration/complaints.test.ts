// apps/api/test/integration/complaints.test.ts
//
// SHM-075: complaints — raising, the timeline, the right of reply, the admin queue, state machine, and the outcomes a decision can carry.
import { Prisma } from '@prisma/client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { signReceiptToken } from '../../src/common/receipt-link.js';
import { EnvironmentService } from '../../src/config/environment.service.js';
import { NotificationService } from '../../src/notification/notification.service.js';
import { AppClock } from '../../src/platform/app-clock.js';
import { ComplaintsService } from '../../src/complaints/complaints.service.js';
import { callApi, createTestApp, postJson, registerAndVerify, staffSession } from './harness.js';
import { agentSession, agentVerify, bearer, claim, completedJob, dropLocks, freezeInsideCallingHours, JPEG, newProvider, prisma, unfreeze, type Job, type Provider } from './flow.js';

let app: NestExpressApplication;
let close: () => Promise<void>;
let agent: { accessToken: string; userId: string };
let admin: { accessToken: string; userId: string };
let provider: Provider;

beforeAll(async () => {
  const started = await createTestApp();
  app = started.app;
  close = started.close;
  freezeInsideCallingHours(app);
  agent = await agentSession(app, 'agent1');
  admin = await staffSession(app, 'admin@smart-home.local');
  provider = await newProvider(app);
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

const asAdmin = (init: RequestInit = {}): RequestInit => bearer(admin.accessToken, init);

type Complaint = { id: string; status: string; severity: string; category: string; slaRemainingMinutes: number; slaBreached: boolean; resolution: string | null; timeline: { type: string; body: string | null; toStatus: string | null }[]; youAre?: string; code?: string };

const raise = (who: { accessToken: string }, bookingId: string, category: string, extra: Record<string, unknown> = {}) =>
  callApi<Complaint>(app, '/complaints', bearer(who.accessToken, postJson({ bookingId, category, description: 'The problem is described here in enough words.', ...extra })));

/** A verified, released online job: the money has gone to the provider, so a complaint's outcomes are the only recourse. */
const releasedJob = async (mode: 'ONLINE' | 'CASH' = 'ONLINE'): Promise<Job> => {
  const job = await completedJob(app, provider, { mode });
  await agentVerify(app, agent, job);
  return job;
};

const move = (id: string, body: Record<string, unknown>) => callApi<Complaint>(app, `/admin/complaints/${id}/transition`, asAdmin(postJson(body)));

describe('SHM-075: raising a complaint', () => {
  it('a customer complains about their provider, linked to the booking, with the SLA that its severity earns', async () => {
    const job = await releasedJob();
    const response = await raise(job.customer, job.id, 'QUALITY');
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ status: 'OPEN', severity: 'NORMAL', category: 'QUALITY', youAre: 'COMPLAINANT' });
    expect(response.body.slaRemainingMinutes).toBeGreaterThan(71 * 60);
    expect(response.body.timeline.map(event => event.type)).toEqual(['CREATED']);
    const stored = await prisma.$queryRaw<{ against: string; source: string; booking: string }[]>(Prisma.sql`SELECT against_user_id as against, source::text, booking_id as booking FROM complaints WHERE id = ${response.body.id}::uuid`);
    expect(stored[0]).toEqual({ against: provider.id, source: 'POST_RELEASE', booking: job.id });
  });

  it('severity follows the category: safety one hour, conduct and money a day, the rest three days', async () => {
    const job = await releasedJob();
    const safety = await raise(job.customer, job.id, 'SAFETY');
    expect(safety.body.severity).toBe('SAFETY');
    expect(safety.body.slaRemainingMinutes).toBeLessThanOrEqual(60);
    const high = await raise(job.customer, job.id, 'OVERCHARGE');
    expect(high.body.severity).toBe('HIGH');
    expect(high.body.slaRemainingMinutes).toBeGreaterThan(23 * 60);
    expect(high.body.slaRemainingMinutes).toBeLessThanOrEqual(24 * 60);
  });

  it('a provider can complain about a customer, in the provider categories only', async () => {
    const job = await releasedJob('CASH');
    const ok = await raise({ accessToken: provider.accessToken }, job.id, 'NON_PAYMENT');
    expect(ok.status).toBe(201);
    expect(ok.body.severity).toBe('HIGH');
    const stored = await prisma.$queryRaw<{ against: string; source: string }[]>(Prisma.sql`SELECT against_user_id as against, source::text FROM complaints WHERE id = ${ok.body.id}::uuid`);
    expect(stored[0]).toEqual({ against: job.customer.id, source: 'PROVIDER' });
    expect((await raise({ accessToken: provider.accessToken }, job.id, 'QUALITY')).status).toBe(422);
    expect((await raise(job.customer, job.id, 'NON_PAYMENT')).status).toBe(422);
  });

  it('only a party to the booking can complain, and only about that booking', async () => {
    const job = await releasedJob();
    const stranger = await registerAndVerify(app, 'CUSTOMER');
    expect((await raise(stranger, job.id, 'QUALITY')).status).toBe(404);
    const otherProvider = await registerAndVerify(app, 'PROVIDER');
    expect((await raise(otherProvider, job.id, 'OTHER')).status).toBe(404);
    expect((await callApi(app, '/complaints', bearer(job.customer.accessToken, postJson({ bookingId: job.id, category: 'QUALITY', description: 'short' })))).status).toBe(422);
  });

  it('takes up to five photos, refuses a sixth, and shows each on the timeline', async () => {
    const job = await releasedJob();
    const photo = { contentType: 'image/jpeg', contentBase64: JPEG };
    const created = await raise(job.customer, job.id, 'QUALITY', { photos: [photo, photo, photo, photo] });
    expect(created.status).toBe(201);
    expect(created.body.timeline.filter(event => event.type === 'EVIDENCE_ADDED')).toHaveLength(4);
    expect((await callApi(app, `/complaints/${created.body.id}/evidence`, bearer(job.customer.accessToken, postJson(photo)))).status).toBe(201);
    expect((await callApi(app, `/complaints/${created.body.id}/evidence`, bearer(job.customer.accessToken, postJson(photo)))).status).toBe(422);
    expect((await raise(job.customer, job.id, 'QUALITY', { photos: [photo, photo, photo, photo, photo, photo] })).status).toBe(422);
  });

  it('a completed job can be complained about only inside the post-release window', async () => {
    const job = await releasedJob();
    expect((await raise(job.customer, job.id, 'QUALITY')).status).toBe(201);
    app.get(AppClock).advanceMinutes(8 * 24 * 60);
    const late = await raise(job.customer, job.id, 'QUALITY');
    expect(late.status).toBe(409);
  });

  it('a customer can report a problem from the link on a cash receipt without signing in, and a forged link is refused', async () => {
    const job = await releasedJob('CASH');
    const pepper = app.get(EnvironmentService).values.OTP_PEPPER;
    const token = signReceiptToken(pepper, job.id);
    const created = await callApi<{ id: string; severity: string }>(app, '/complaints/from-receipt', postJson({ token, category: 'OVERCHARGE', description: 'I was asked for extra money on top of the invoice.' }));
    expect(created.status).toBe(201);
    const row = await prisma.$queryRaw<{ source: string; raisedBy: string | null; against: string }[]>(Prisma.sql`SELECT source::text, raised_by_user_id as "raisedBy", against_user_id as against FROM complaints WHERE id = ${created.body.id}::uuid`);
    expect(row[0]).toEqual({ source: 'RECEIPT_LINK', raisedBy: job.customer.id, against: provider.id });
    const forged = `${token.split('.')[0]}.${'0'.repeat(24)}`;
    expect((await callApi(app, '/complaints/from-receipt', postJson({ token: forged, category: 'OVERCHARGE', description: 'Trying to complain with a forged link.' }))).status).toBe(404);
    const other = signReceiptToken(pepper, '00000000-0000-4000-8000-000000000000');
    expect((await callApi(app, '/complaints/from-receipt', postJson({ token: other, category: 'OVERCHARGE', description: 'A well-formed token for a booking that is not there.' }))).status).toBe(404);
  });
});

describe('SHM-075: the right of reply', () => {
  it('the respondent sees the complaint and replies; a stranger cannot see it', async () => {
    const job = await releasedJob();
    const created = await raise(job.customer, job.id, 'QUALITY');
    const asProvider = await callApi<Complaint>(app, `/complaints/${created.body.id}`, bearer(provider.accessToken));
    expect(asProvider.status).toBe(200);
    expect(asProvider.body.youAre).toBe('RESPONDENT');
    expect((await callApi(app, `/complaints/${created.body.id}`, bearer((await registerAndVerify(app, 'CUSTOMER')).accessToken))).status).toBe(404);

    const replied = await callApi(app, `/complaints/${created.body.id}/reply`, bearer(provider.accessToken, postJson({ body: 'The customer signed off in the chat.' })));
    expect(replied.status).toBe(200);
    const seen = await callApi<Complaint>(app, `/complaints/${created.body.id}`, bearer(job.customer.accessToken));
    expect(seen.body.timeline.map(event => event.type)).toEqual(['CREATED', 'PARTY_REPLY']);

    const mine = await callApi<{ items: { id: string }[] }>(app, '/complaints', bearer(provider.accessToken));
    expect(mine.body.items.map(item => item.id)).toContain(created.body.id);
  });

  it('a reply to an AWAITING_RESPONSE complaint puts it back under review', async () => {
    const job = await releasedJob();
    const created = await raise(job.customer, job.id, 'QUALITY');
    await move(created.body.id, { to: 'UNDER_REVIEW' });
    await move(created.body.id, { to: 'AWAITING_RESPONSE', note: 'Please respond' });
    await callApi(app, `/complaints/${created.body.id}/reply`, bearer(provider.accessToken, postJson({ body: 'Here is my side of it.' })));
    const after = await callApi<Complaint>(app, `/complaints/${created.body.id}`, bearer(provider.accessToken));
    expect(after.body.status).toBe('UNDER_REVIEW');
  });
});

describe('SHM-075: the admin queue and the state machine', () => {
  it('needs an admin: agent, customer and provider are refused', async () => {
    const job = await releasedJob();
    expect((await callApi(app, '/admin/complaints', bearer(agent.accessToken))).status).toBe(403);
    expect((await callApi(app, '/admin/complaints', bearer(job.customer.accessToken))).status).toBe(403);
    expect((await callApi(app, '/admin/complaints', bearer(provider.accessToken))).status).toBe(403);
    expect((await callApi(app, '/admin/complaints', asAdmin())).status).toBe(200);
  });

  it('lists open complaints with safety at the very top, however old the others are, and marks breached SLAs', async () => {
    const job = await releasedJob();
    const normal = await raise(job.customer, job.id, 'QUALITY');
    const high = await raise(job.customer, job.id, 'OVERCHARGE');
    const safety = await raise(job.customer, job.id, 'SAFETY');
    const queue = await callApi<{ items: { id: string; severity: string; status: string }[] }>(app, '/admin/complaints?open=true', asAdmin());
    const ids = queue.body.items.map(item => item.id);
    expect(ids.indexOf(safety.body.id)).toBeLessThan(ids.indexOf(high.body.id));
    expect(ids.indexOf(high.body.id)).toBeLessThan(ids.indexOf(normal.body.id));
    const firstNonSafety = queue.body.items.findIndex(item => item.severity !== 'SAFETY');
    expect(queue.body.items.slice(0, firstNonSafety).every(item => item.severity === 'SAFETY')).toBe(true);
    const onlySafety = await callApi<{ items: { severity: string }[] }>(app, '/admin/complaints?severity=SAFETY', asAdmin());
    expect(onlySafety.body.items.every(item => item.severity === 'SAFETY')).toBe(true);

    app.get(AppClock).advanceMinutes(2 * 60);
    const later = await callApi<{ items: { id: string; slaBreached: boolean; slaRemainingMinutes: number }[] }>(app, '/admin/complaints?open=true', asAdmin());
    expect(later.body.items.find(item => item.id === safety.body.id)).toMatchObject({ slaBreached: true });
    expect(later.body.items.find(item => item.id === normal.body.id)?.slaBreached).toBe(false);
  });

  it('a safety complaint alerts the admins straight away, and an SLA breach is flagged once with an alert', async () => {
    const job = await releasedJob();
    const safety = await raise(job.customer, job.id, 'SAFETY');
    const events = await prisma.$queryRaw<{ id: bigint; type: string; payload: Record<string, unknown> }[]>(Prisma.sql`SELECT id, type, payload FROM outbox_events WHERE payload->>'complaintId' = ${safety.body.id} ORDER BY id`);
    expect(events.map(event => event.type)).toContain('complaint.safety_raised');
    for (const event of events) await app.get(NotificationService).handle({ outboxId: event.id.toString(), eventType: event.type, payload: event.payload });
    const alerts = await prisma.$queryRaw<{ userId: string; channel: string }[]>(Prisma.sql`SELECT user_id as "userId", channel::text FROM notifications WHERE event_key = 'admin.safety_complaint' AND payload->>'complaintId' = ${safety.body.id}`);
    expect(alerts.length).toBeGreaterThanOrEqual(1);
    expect(alerts.map(alert => alert.userId)).toContain(admin.userId);

    app.get(AppClock).advanceMinutes(90);
    const service = app.get(ComplaintsService);
    expect(await service.flagSlaBreaches()).toBeGreaterThanOrEqual(1);
    const again = await service.flagSlaBreaches();
    expect(again).toBe(0);
    const marks = await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*)::bigint as n FROM complaint_events WHERE complaint_id = ${safety.body.id}::uuid AND body = 'SLA breached'`);
    expect(marks[0]?.n).toBe(1n);
  });

  it('only the documented moves are allowed, closing needs a note, and RESOLVED needs an outcome', async () => {
    const job = await releasedJob();
    const created = await raise(job.customer, job.id, 'QUALITY');
    const id = created.body.id;
    expect((await move(id, { to: 'RESOLVED', note: 'skipping review', resolution: 'NO_ACTION' })).status).toBe(409);
    expect((await move(id, { to: 'AWAITING_RESPONSE' })).status).toBe(409);
    expect((await move(id, { to: 'UNDER_REVIEW' })).status).toBe(200);
    expect((await move(id, { to: 'RESOLVED', resolution: 'NO_ACTION' })).status).toBe(422); // no note
    expect((await move(id, { to: 'RESOLVED', note: 'Nothing to answer' })).status).toBe(422); // no resolution
    expect((await move(id, { to: 'REJECTED', note: 'Not upheld', resolution: 'NO_ACTION' })).status).toBe(422); // rejected has none
    expect((await move(id, { to: 'AWAITING_RESPONSE', note: 'Please respond' })).status).toBe(200);
    expect((await move(id, { to: 'UNDER_REVIEW' })).status).toBe(200);
    const done = await move(id, { to: 'RESOLVED', note: 'Nothing further needed', resolution: 'NO_ACTION' });
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ status: 'RESOLVED', resolution: 'NO_ACTION' });
    for (const to of ['UNDER_REVIEW', 'AWAITING_RESPONSE', 'RESOLVED', 'REJECTED']) expect((await move(id, { to, note: 'again', resolution: 'NO_ACTION' })).status).toBe(409);
    const stored = await prisma.$queryRaw<{ resolvedAt: Date | null }[]>(Prisma.sql`SELECT resolved_at as "resolvedAt" FROM complaints WHERE id = ${id}::uuid`);
    expect(stored[0]?.resolvedAt).not.toBeNull();
    const audit = await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*)::bigint as n FROM audit_log WHERE action = 'complaint.transition' AND entity_id = ${id}`);
    expect(audit[0]?.n).toBe(4n);
  });

  it('can be assigned to the admin or an agent, but not to a customer', async () => {
    const job = await releasedJob();
    const created = await raise(job.customer, job.id, 'QUALITY');
    expect((await callApi(app, `/admin/complaints/${created.body.id}/assign`, asAdmin(postJson({})))).status).toBe(200);
    expect((await callApi(app, `/admin/complaints/${created.body.id}/assign`, asAdmin(postJson({ assigneeId: agent.userId })))).status).toBe(200);
    expect((await callApi(app, `/admin/complaints/${created.body.id}/assign`, asAdmin(postJson({ assigneeId: job.customer.id })))).status).toBe(400);
    const mine = await callApi<{ items: { id: string }[] }>(app, `/admin/complaints?assignedTo=${agent.userId}`, asAdmin());
    expect(mine.body.items.map(item => item.id)).toContain(created.body.id);
  });

  it('is visible in the verification agent’s console for that booking', async () => {
    const provider2 = await newProvider(app);
    const job = await completedJob(app, provider2, { mode: 'ONLINE' });
    const created = await raise(job.customer, job.id, 'QUALITY');
    await claim(app, agent.accessToken, job.verificationId);
    const consolePayload = await callApi<{ openComplaints: { id: string; category: string }[] }>(app, `/agent/verifications/${job.verificationId}`, bearer(agent.accessToken));
    expect(consolePayload.body.openComplaints.map(item => item.id)).toContain(created.body.id);
  });
});

describe('SHM-075: outcomes that carry a consequence', () => {
  const balanceOf = async (type: string, bookingId: string): Promise<bigint> =>
    (await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT coalesce(sum(b.balance), 0)::bigint as n FROM ledger_accounts a JOIN account_balances b ON b.account_id = a.id WHERE a.type = ${type}::account_type AND a.booking_id = ${bookingId}::uuid`))[0]!.n;
  const compensationEntries = async (bookingId: string) =>
    prisma.$queryRaw<{ account: string; direction: string; amount: bigint }[]>(
      Prisma.sql`SELECT a.type::text as account, e.direction::text as direction, e.amount_paisa as amount FROM ledger_transactions t JOIN ledger_entries e ON e.transaction_id = t.id JOIN ledger_accounts a ON a.id = e.account_id
        WHERE t.booking_id = ${bookingId}::uuid AND t.type = 'REFUND' AND a.type IN ('CUSTOMER_COMPENSATION','GATEWAY_CLEARING') ORDER BY e.id`
    );

  it('a partial refund after release is borne by the platform: gateway refund, compensation expense, escrow untouched', async () => {
    const job = await releasedJob('ONLINE');
    const created = await raise(job.customer, job.id, 'QUALITY');
    await move(created.body.id, { to: 'UNDER_REVIEW' });
    expect((await move(created.body.id, { to: 'RESOLVED', note: 'Half the work was redone by the customer', resolution: 'PARTIAL_REFUND' })).status).toBe(422); // needs an amount
    const resolved = await move(created.body.id, { to: 'RESOLVED', note: 'Half the work was not done', resolution: 'PARTIAL_REFUND', refundPaisa: 40_000 });
    expect(resolved.status).toBe(200);
    expect(resolved.body.resolution).toBe('PARTIAL_REFUND');
    expect(await compensationEntries(job.id)).toEqual([
      { account: 'CUSTOMER_COMPENSATION', direction: 'DEBIT', amount: 40_000n },
      { account: 'GATEWAY_CLEARING', direction: 'CREDIT', amount: 40_000n }
    ]);
    const refund = await prisma.$queryRaw<{ amount: bigint; reason: string; status: string; text: string | null }[]>(Prisma.sql`SELECT amount_paisa as amount, reason_code as reason, status::text, reason_text as text FROM refunds WHERE booking_id = ${job.id}::uuid`);
    expect(refund[0]).toEqual({ amount: 40_000n, reason: 'COMPLAINT_PARTIAL_REFUND', status: 'SUCCEEDED', text: 'Half the work was not done' });
    expect(await balanceOf('ESCROW', job.id)).toBe(0n);
    const payment = await prisma.$queryRaw<{ refunded: bigint; status: string }[]>(Prisma.sql`SELECT refunded_paisa as refunded, status::text FROM payments WHERE booking_id = ${job.id}::uuid AND purpose = 'BOOKING'`);
    expect(payment[0]).toEqual({ refunded: 40_000n, status: 'PARTIALLY_REFUNDED' });
  });

  it('a full refund returns the whole job; a cash job cannot be refunded online; a refund cannot exceed what was paid', async () => {
    const job = await releasedJob('ONLINE');
    const final = (await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT final_amount_paisa as n FROM bookings WHERE id = ${job.id}::uuid`))[0]!.n;
    const tooMuch = await raise(job.customer, job.id, 'QUALITY');
    await move(tooMuch.body.id, { to: 'UNDER_REVIEW' });
    expect((await move(tooMuch.body.id, { to: 'RESOLVED', note: 'More than was paid', resolution: 'PARTIAL_REFUND', refundPaisa: Number(final) + 1 })).status).toBe(409);
    expect((await move(tooMuch.body.id, { to: 'RESOLVED', note: 'The whole job', resolution: 'FULL_REFUND' })).status).toBe(200);
    const refunded = await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT coalesce(sum(amount_paisa), 0)::bigint as n FROM refunds WHERE booking_id = ${job.id}::uuid`);
    expect(refunded[0]?.n).toBe(final);

    const cash = await releasedJob('CASH');
    const cashComplaint = await raise(cash.customer, cash.id, 'QUALITY');
    await move(cashComplaint.body.id, { to: 'UNDER_REVIEW' });
    expect((await move(cashComplaint.body.id, { to: 'RESOLVED', note: 'Refund a cash job', resolution: 'FULL_REFUND' })).status).toBe(409);
  });

  it('PROVIDER_PENALTY only proposes: the provider keeps their right of reply and nothing is charged', async () => {
    const job = await releasedJob('ONLINE');
    const created = await raise(job.customer, job.id, 'MISBEHAVIOUR');
    await move(created.body.id, { to: 'UNDER_REVIEW' });
    expect((await move(created.body.id, { to: 'RESOLVED', note: 'Needs a breach', resolution: 'PROVIDER_PENALTY' })).status).toBe(422);
    const walletBefore = (await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT coalesce(sum(b.balance), 0)::bigint as n FROM ledger_accounts a JOIN account_balances b ON b.account_id = a.id WHERE a.type = 'PROVIDER_WALLET' AND a.owner_user_id = ${provider.id}::uuid`))[0]!.n;
    const resolved = await move(created.body.id, { to: 'RESOLVED', note: 'Verified misbehaviour', resolution: 'PROVIDER_PENALTY', breachCode: 'HARASSMENT' });
    expect(resolved.status).toBe(200);
    const penalties = await prisma.$queryRaw<{ status: string; breach: string; complaint: string; due: Date }[]>(Prisma.sql`SELECT status::text, breach_code as breach, complaint_id as complaint, reply_due_at as due FROM penalties WHERE complaint_id = ${created.body.id}::uuid`);
    expect(penalties).toHaveLength(1);
    expect(penalties[0]).toMatchObject({ status: 'PROPOSED', breach: 'HARASSMENT', complaint: created.body.id });
    const walletAfter = (await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT coalesce(sum(b.balance), 0)::bigint as n FROM ledger_accounts a JOIN account_balances b ON b.account_id = a.id WHERE a.type = 'PROVIDER_WALLET' AND a.owner_user_id = ${provider.id}::uuid`))[0]!.n;
    expect(walletAfter).toBe(walletBefore);
  });

  it('a suspension takes the provider out of search at once; a block is permanent; both are audited', async () => {
    const where = { lat: 28.1 + Math.random(), lng: 68.1 + Math.random() };
    const target = await newProvider(app, where);
    const job = await completedJob(app, target, { mode: 'ONLINE' });
    await agentVerify(app, agent, job);
    const findable = async (): Promise<boolean> => (await callApi<{ items: { providerId: string }[] }>(app, `/search/providers?serviceSlug=leak-repair&lat=${where.lat}&lng=${where.lng}`)).body.items.some(item => item.providerId === target.id);
    expect(await findable()).toBe(true);

    const first = await raise(job.customer, job.id, 'MISBEHAVIOUR');
    await move(first.body.id, { to: 'UNDER_REVIEW' });
    expect((await move(first.body.id, { to: 'RESOLVED', note: 'Serious misconduct', resolution: 'TEMPORARY_SUSPENSION', suspensionDays: 7 })).status).toBe(200);
    expect(await findable()).toBe(false);
    const suspended = await prisma.$queryRaw<{ status: string; reason: string | null }[]>(Prisma.sql`SELECT status::text, offer_blocked_reason as reason FROM providers WHERE user_id = ${target.id}::uuid`);
    expect(suspended[0]).toEqual({ status: 'SUSPENDED', reason: 'SUSPENDED' });

    const second = await raise(job.customer, job.id, 'ABUSE'.replace('ABUSE', 'MISBEHAVIOUR'));
    await move(second.body.id, { to: 'UNDER_REVIEW' });
    expect((await move(second.body.id, { to: 'RESOLVED', note: 'Repeated misconduct', resolution: 'PERMANENT_BLOCK' })).status).toBe(200);
    expect((await prisma.$queryRaw<{ status: string }[]>(Prisma.sql`SELECT status::text FROM providers WHERE user_id = ${target.id}::uuid`))[0]?.status).toBe('BLOCKED');
    const audit = await prisma.$queryRaw<{ action: string }[]>(Prisma.sql`SELECT action FROM audit_log WHERE entity_id = ${target.id} AND action IN ('provider.suspend','provider.block') ORDER BY id`);
    expect(audit.map(row => row.action)).toEqual(['provider.suspend', 'provider.block']);
  });

  it('a complaint about a customer can only be closed with no action or a warning', async () => {
    const job = await releasedJob('CASH');
    const created = await raise({ accessToken: provider.accessToken }, job.id, 'ABUSE');
    await move(created.body.id, { to: 'UNDER_REVIEW' });
    expect((await move(created.body.id, { to: 'RESOLVED', note: 'Suspend the customer', resolution: 'TEMPORARY_SUSPENSION' })).status).toBe(422);
    expect((await move(created.body.id, { to: 'RESOLVED', note: 'Customer warned', resolution: 'WARNING' })).status).toBe(200);
    const events = await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*)::bigint as n FROM outbox_events WHERE type = 'complaint.warning' AND payload->>'complaintId' = ${created.body.id}`);
    expect(events[0]?.n).toBe(1n);
  });

  it('opening a dispute from a complaint about a job still awaiting verification freezes it, and takes it out of the agents’ queue', async () => {
    const provider3 = await newProvider(app);
    const job = await completedJob(app, provider3, { mode: 'ONLINE' });
    const created = await raise(job.customer, job.id, 'OVERCHARGE');
    const opened = await callApi<{ disputeId: string }>(app, `/admin/complaints/${created.body.id}/open-dispute`, asAdmin({ method: 'POST' }));
    expect(opened.status).toBe(200);
    const booking = await prisma.$queryRaw<{ status: string }[]>(Prisma.sql`SELECT status::text FROM bookings WHERE id = ${job.id}::uuid`);
    expect(booking[0]?.status).toBe('DISPUTED');
    const dispute = await prisma.$queryRaw<{ origin: string; complaint: string }[]>(Prisma.sql`SELECT origin::text, complaint_id as complaint FROM disputes WHERE id = ${opened.body.disputeId}::uuid`);
    expect(dispute[0]).toEqual({ origin: 'COMPLAINT', complaint: created.body.id });
    const queue = await callApi<{ items: { id: string }[] }>(app, '/agent/queue', bearer(agent.accessToken));
    expect(queue.body.items.map(item => item.id)).not.toContain(job.verificationId);
    // Not for a job that has already been released.
    const released = await releasedJob('ONLINE');
    const late = await raise(released.customer, released.id, 'QUALITY');
    expect((await callApi(app, `/admin/complaints/${late.body.id}/open-dispute`, asAdmin({ method: 'POST' }))).status).toBe(409);
  });
});
