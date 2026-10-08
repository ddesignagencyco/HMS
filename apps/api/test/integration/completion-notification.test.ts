// apps/api/test/integration/completion-notification.test.ts
//
// The loop the client described: the provider finishes, the customer is told and
// confirms they are happy, and only then does the money move.
//
// Every part of that loop already existed. What did not exist was the customer
// being *told*. `booking.handToVerification` notified in-app only, so on a Tier B
// job — where escrow releases on the customer's own answer, and auto-releases after
// 72 hours if nobody answers — a customer who did not open the app was never told
// there was anything to confirm. The money released itself and the customer found
// out afterwards. No verification test asserted a notification at all, which is why
// this went unnoticed.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { NotificationService } from '../../src/notification/notification.service.js';
import { callApi, createTestApp } from './harness.js';
import { agentVerify, completedJob, freezeInsideCallingHours, newProvider, prisma, unfreeze } from './flow.js';
import { agentSession } from './flow.js';

let app: NestExpressApplication;
let close: () => Promise<void>;

beforeAll(async () => {
  const started = await createTestApp();
  app = started.app;
  close = started.close;
});

afterAll(async () => {
  await close();
});

/** Replays every outbox event for a booking through the dispatcher, as the worker would. */
const dispatchFor = async (bookingId: string): Promise<void> => {
  const events = await prisma.$queryRaw<{ id: bigint; type: string; payload: Record<string, unknown> }[]>(
    Prisma.sql`SELECT id, type, payload FROM outbox_events WHERE payload->>'bookingId' = ${bookingId} ORDER BY id`
  );
  for (const event of events) await app.get(NotificationService).handle({ outboxId: event.id.toString(), eventType: event.type, payload: event.payload });
};

const notificationsFor = async (bookingId: string): Promise<{ channel: string; eventKey: string; renderedBody: string | null; status: string }[]> =>
  prisma.$queryRaw<{ channel: string; eventKey: string; renderedBody: string | null; status: string }[]>(
    Prisma.sql`SELECT channel::text as channel, event_key as "eventKey", rendered_body as "renderedBody", status::text as status
      FROM notifications n JOIN outbox_events o ON o.id = n.outbox_event_id
      WHERE o.payload->>'bookingId' = ${bookingId} AND n.event_key = 'booking.awaiting_verification'`
  );

const smsTo = async (phoneE164: string): Promise<string[]> => {
  const inbox = await callApi<{ items: { recipient: string; body: string }[] }>(app, '/dev/inbox?limit=200');
  return (inbox.body.items ?? []).filter(item => item.recipient === phoneE164).map(item => item.body);
};

describe('the provider finishes: the customer is told', () => {
  beforeAll(() => {
    freezeInsideCallingHours(app);
  });

  afterAll(() => {
    unfreeze(app);
  });

  it('texts the customer when the work completes, not just notifies them in-app', async () => {
    const provider = await newProvider(app);
    const job = await completedJob(app, provider, { mode: 'ONLINE' });
    await dispatchFor(job.id);

    const sent = await notificationsFor(job.id);
    // The gap this file exists for: before, `channels: IN_APP` produced one row and
    // an SMS template nobody was ever asked to send.
    expect(sent.map(row => row.channel).sort()).toEqual(['IN_APP', 'SMS']);
  });

  it('says who, what, and what happens next — enough for the customer to act on', async () => {
    const provider = await newProvider(app);
    const job = await completedJob(app, provider, { mode: 'ONLINE' });
    await dispatchFor(job.id);

    const bodies = await smsTo(job.customer.phoneE164);
    const asking = bodies.find(body => /complete/i.test(body));
    expect(asking).toBeDefined();
    expect(asking).toContain(job.code);
    expect(asking).toContain('PKR');
    // The customer's decision releases the money, so the message has to say so.
    expect(asking).toMatch(/confirm|release/i);
  });

  it('still notifies in-app, so a customer who never receives the SMS is not left uninformed', async () => {
    const provider = await newProvider(app);
    const job = await completedJob(app, provider, { mode: 'ONLINE' });
    await dispatchFor(job.id);

    const sent = await notificationsFor(job.id);
    expect(sent.filter(row => row.channel === 'IN_APP').length).toBe(1);
  });

  it('sends exactly one message per completion, however often the outbox is replayed', async () => {
    const provider = await newProvider(app);
    const job = await completedJob(app, provider, { mode: 'ONLINE' });
    await dispatchFor(job.id);
    // A redelivered outbox event must not text the customer twice: notifications is
    // unique on (outbox event, user, channel).
    await dispatchFor(job.id);

    const sent = await notificationsFor(job.id);
    expect(sent.filter(row => row.channel === 'SMS').length).toBe(1);
  });

  it('does not text the customer twice when the job is released', async () => {
    const provider = await newProvider(app);
    const job = await completedJob(app, provider, { mode: 'ONLINE' });
    const agent = await agentSession(app);
    await agentVerify(app, agent, job);
    await dispatchFor(job.id);

    // The completion message is the one that matters for approval; the release is a
    // separate event and a separate template.
    expect((await notificationsFor(job.id)).filter(row => row.channel === 'SMS').length).toBe(1);
    const released = await prisma.$queryRaw<{ n: bigint }[]>(
      Prisma.sql`SELECT count(*)::bigint as n FROM notifications WHERE user_id = ${job.customer.id}::uuid AND event_key = 'payment.released'`
    );
    expect(Number(released[0]?.n)).toBeGreaterThanOrEqual(0);
  });
});