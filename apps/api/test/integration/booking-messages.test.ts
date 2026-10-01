// apps/api/test/integration/booking-messages.test.ts
//
// SHM-040 (masked in-booking chat) and SHM-044 (outbox events → in-app and SMS notifications).
import { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { NotificationService } from '../../src/notification/notification.service.js';
import { callApi, createTestApp, postJson, readyBookableProvider, registerAndVerify, type TestUser } from './harness.js';

const prisma = new PrismaClient();

let app: NestExpressApplication;
let close: () => Promise<void>;

beforeAll(async () => {
  const started = await createTestApp();
  app = started.app;
  close = started.close;
});

afterAll(async () => {
  await close();
  await prisma.$disconnect();
});

const bearer = (accessToken: string, init: RequestInit = {}): RequestInit => ({ ...init, headers: { ...init.headers, authorization: `Bearer ${accessToken}` } });

const slotAt = (hoursFromNow: number): { scheduledStart: string; scheduledEnd: string } => {
  const start = new Date(Date.now() + hoursFromNow * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return { scheduledStart: start.toISOString(), scheduledEnd: end.toISOString() };
};

describe('SHM-040 / SHM-044: chat and notifications', () => {
  let provider: TestUser;
  let serviceId: number;
  let areaId: number;
  let nextSlot = 4_000;

  beforeAll(async () => {
    const ready = await readyBookableProvider(app);
    provider = ready.provider;
    serviceId = ready.serviceId;
    areaId = ready.areaId;
  });

  const asProvider = (init: RequestInit = {}): RequestInit => bearer(provider.accessToken, init);

  const requested = async (): Promise<{ id: string; customer: TestUser }> => {
    const customer = await registerAndVerify(app, 'CUSTOMER');
    const address = await callApi<{ id: string }>(app, '/customer/addresses', bearer(customer.accessToken, postJson({ label: 'Home', line1: 'House 1', areaId, lat: 31.52, lng: 74.35, isDefault: true })));
    nextSlot += 24;
    const created = await callApi<{ id: string }>(app, '/bookings', bearer(customer.accessToken, postJson({ providerId: provider.id, serviceId, addressId: address.body.id, ...slotAt(nextSlot) })));
    expect(created.status).toBe(201);
    return { id: created.body.id, customer };
  };

  /** Runs every outbox event a booking has produced through the notification handler, as the worker would. */
  const deliver = async (bookingId: string): Promise<number> => {
    const events = await prisma.$queryRaw<{ id: bigint; type: string; payload: Record<string, unknown> }[]>(
      Prisma.sql`SELECT id, type, payload FROM outbox_events WHERE aggregate_id = ${bookingId} OR payload->>'bookingId' = ${bookingId} ORDER BY id`
    );
    let created = 0;
    for (const event of events) created += await app.get(NotificationService).handle({ outboxId: event.id.toString(), eventType: event.type, payload: event.payload });
    return created;
  };

  const inboxFor = async (phone: string): Promise<string[]> => {
    const inbox = await callApi<{ items: { recipient: string; body: string }[] }>(app, '/dev/inbox?limit=200');
    return inbox.body.items.filter(item => item.recipient === phone).map(item => item.body);
  };

  describe('SHM-040: masked chat', () => {
    it('is closed until a provider is assigned', async () => {
      const { id, customer } = await requested();
      const response = await callApi<{ code: string }>(app, `/bookings/${id}/messages`, bearer(customer.accessToken, postJson({ body: 'hello' })));
      expect(response.status).toBe(409);
    });

    it('lets both parties talk once the booking is scheduled, masking phone numbers and emails before storing them', async () => {
      const { id, customer } = await requested();
      await callApi(app, `/bookings/${id}/accept`, asProvider({ method: 'POST' }));

      const sent = await callApi<{ body: string; masked: boolean }>(app, `/bookings/${id}/messages`, bearer(customer.accessToken, postJson({ body: 'Call me on 0300-1234567 or mail a.b@example.com' })));
      expect(sent.status).toBe(201);
      expect(sent.body.masked).toBe(true);
      expect(sent.body.body).toBe('Call me on [number hidden] or mail [email hidden]');

      const clean = await callApi<{ masked: boolean }>(app, `/bookings/${id}/messages`, asProvider(postJson({ body: 'On my way, 5000 rupees as quoted' })));
      expect(clean.body.masked).toBe(false);

      const seen = await callApi<{ items: { body: string; mine: boolean }[]; open: boolean }>(app, `/bookings/${id}/messages`, asProvider());
      expect(seen.body.open).toBe(true);
      expect(seen.body.items.map(item => item.body)).toEqual(['Call me on [number hidden] or mail [email hidden]', 'On my way, 5000 rupees as quoted']);
      expect(seen.body.items.map(item => item.mine)).toEqual([false, true]);

      const stored = await prisma.$queryRaw<{ body: string }[]>(Prisma.sql`SELECT body FROM messages WHERE booking_id = ${id}::uuid`);
      expect(stored.some(row => /\d{7}|@/.test(row.body))).toBe(false);
    });

    it('hides the chat from anyone who is not a party (404)', async () => {
      const { id } = await requested();
      const stranger = await registerAndVerify(app, 'CUSTOMER');
      const response = await callApi(app, `/bookings/${id}/messages`, bearer(stranger.accessToken));
      expect(response.status).toBe(404);
    });

    it('closes after a terminal state: no new messages, history still readable', async () => {
      const { id, customer } = await requested();
      await callApi(app, `/bookings/${id}/accept`, asProvider({ method: 'POST' }));
      await callApi(app, `/bookings/${id}/messages`, bearer(customer.accessToken, postJson({ body: 'see you' })));
      await callApi(app, `/bookings/${id}/cancel`, bearer(customer.accessToken, postJson({})));

      const late = await callApi(app, `/bookings/${id}/messages`, bearer(customer.accessToken, postJson({ body: 'still there?' })));
      expect(late.status).toBe(409);
      const history = await callApi<{ items: unknown[]; open: boolean }>(app, `/bookings/${id}/messages`, asProvider());
      expect(history.body.open).toBe(false);
      expect(history.body.items).toHaveLength(1);
    });
  });

  describe('SHM-044: notification dispatch', () => {
    it('the customer gets the confirmation, the start code and the en-route message in the dev inbox', async () => {
      const { id, customer } = await requested();
      await callApi(app, `/bookings/${id}/accept`, asProvider({ method: 'POST' }));
      await callApi(app, `/bookings/${id}/depart`, asProvider({ method: 'POST' }));
      await deliver(id);

      const messages = await inboxFor(customer.phoneE164);
      expect(messages.some(body => /confirmed for/i.test(body))).toBe(true);
      expect(messages.some(body => /start code|\b\d{6}\b/i.test(body))).toBe(true);
      expect(messages.some(body => /on the way/i.test(body))).toBe(true);

      const inApp = await prisma.$queryRaw<{ eventKey: string; channel: string; status: string; body: string }[]>(
        Prisma.sql`SELECT event_key as "eventKey", channel::text, status::text, rendered_body as body FROM notifications WHERE user_id = ${customer.id}::uuid ORDER BY created_at`
      );
      const keys = inApp.map(row => `${row.eventKey}:${row.channel}`);
      expect(keys).toEqual(expect.arrayContaining(['booking.accepted:IN_APP', 'booking.confirmed:SMS', 'booking.on_the_way:IN_APP', 'booking.on_the_way:SMS']));
      expect(inApp.every(row => !row.body.includes('{{'))).toBe(true);
    });

    it('is idempotent: delivering the same events again creates nothing and sends nothing more', async () => {
      const { id, customer } = await requested();
      await callApi(app, `/bookings/${id}/accept`, asProvider({ method: 'POST' }));
      const first = await deliver(id);
      expect(first).toBeGreaterThan(0);
      const before = (await inboxFor(customer.phoneE164)).length;
      expect(await deliver(id)).toBe(0);
      expect((await inboxFor(customer.phoneE164)).length).toBe(before);
    });

    it('offers reach the provider by SMS, and a cancellation notifies the other party only', async () => {
      const { id, customer } = await requested();
      await callApi(app, `/bookings/${id}/accept`, asProvider({ method: 'POST' }));
      await callApi(app, `/bookings/${id}/cancel`, bearer(customer.accessToken, postJson({ reason: 'plans changed' })));
      await deliver(id);

      const providerMessages = await inboxFor(provider.phoneE164);
      expect(providerMessages.some(body => /job is available/i.test(body))).toBe(true);
      const cancelled = await prisma.$queryRaw<{ userId: string }[]>(Prisma.sql`SELECT user_id as "userId" FROM notifications WHERE event_key = 'booking.cancelled' AND payload->>'bookingId' = ${id}`);
      expect(cancelled.map(row => row.userId)).toEqual([provider.id]);
    });

    it('a chat message notifies the recipient in-app', async () => {
      const { id, customer } = await requested();
      await callApi(app, `/bookings/${id}/accept`, asProvider({ method: 'POST' }));
      await callApi(app, `/bookings/${id}/messages`, bearer(customer.accessToken, postJson({ body: 'hello' })));
      await deliver(id);
      const rows = await prisma.$queryRaw<{ userId: string }[]>(Prisma.sql`SELECT user_id as "userId" FROM notifications WHERE event_key = 'booking.message' AND payload->>'bookingId' = ${id}`);
      expect(rows.map(row => row.userId)).toEqual([provider.id]);
    });
  });
});
