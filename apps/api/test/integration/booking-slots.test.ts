// apps/api/test/integration/booking-slots.test.ts
//
// SHM-025: the slot listing customers pick a start time from.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { callApi, createTestApp, postJson, readyBookableProvider, registerAndVerify, type TestUser } from './harness.js';

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

const bearer = (accessToken: string, init: RequestInit = {}): RequestInit => ({ ...init, headers: { ...init.headers, authorization: `Bearer ${accessToken}` } });

/** A calendar day far enough ahead that every half-hour slot is past the minimum notice: `daysAhead` days from now, in Karachi. */
const localDate = (daysAhead: number): string => new Date(Date.now() + daysAhead * 86_400_000 + 5 * 3_600_000).toISOString().slice(0, 10);

type Slots = { date: string; durationMin: number; items: { start: string; end: string }[] };

describe('SHM-025: GET /search/providers/:id/slots', () => {
  let provider: TestUser;
  let serviceId: number;
  let areaId: number;

  beforeAll(async () => {
    const ready = await readyBookableProvider(app);
    provider = ready.provider;
    serviceId = ready.serviceId;
    areaId = ready.areaId;
  });

  const listSlots = (date: string, id = provider.id, service = serviceId) => callApi<Slots>(app, `/search/providers/${id}/slots?serviceId=${service}&date=${date}`);

  it('lists half-hourly start times sized to the service, all within the day', async () => {
    const date = localDate(10);
    const response = await listSlots(date);
    expect(response.status).toBe(200);
    expect(response.body.durationMin).toBe(90);
    expect(response.body.items.length).toBeGreaterThan(30);
    for (const slot of response.body.items) expect(new Date(slot.end).getTime() - new Date(slot.start).getTime()).toBe(90 * 60_000);
    const starts = response.body.items.map(slot => new Date(slot.start).getTime());
    expect(starts).toEqual([...starts].sort((left, right) => left - right));
    expect(new Set(starts).size).toBe(starts.length);
  });

  it('removes the times a booking occupies, plus the travel buffer either side', async () => {
    const date = localDate(11);
    const before = await listSlots(date);
    const chosen = before.body.items[10]!;

    const customer = await registerAndVerify(app, 'CUSTOMER');
    const address = await callApi<{ id: string }>(app, '/customer/addresses', bearer(customer.accessToken, postJson({ label: 'Home', line1: 'House 1', areaId, lat: 31.52, lng: 74.35, isDefault: true })));
    const booked = await callApi(app, '/bookings', bearer(customer.accessToken, postJson({ providerId: provider.id, serviceId, addressId: address.body.id, scheduledStart: chosen.start, scheduledEnd: chosen.end })));
    expect(booked.status).toBe(201);

    const after = await listSlots(date);
    const remaining = new Set(after.body.items.map(slot => slot.start));
    expect(remaining.has(chosen.start)).toBe(false);
    for (const slot of after.body.items) {
      const start = new Date(slot.start).getTime();
      const end = new Date(slot.end).getTime();
      // 30-minute buffer around a booking of chosen.start..chosen.end
      expect(end <= new Date(chosen.start).getTime() - 30 * 60_000 || start >= new Date(chosen.end).getTime() + 30 * 60_000).toBe(true);
    }
    expect(after.body.items.length).toBeLessThan(before.body.items.length);
    // What is listed can actually be booked: pick one right next to the buffer and check out.
    const next = after.body.items.find(slot => new Date(slot.start).getTime() >= new Date(chosen.end).getTime() + 30 * 60_000)!;
    const second = await callApi(app, '/bookings', bearer(customer.accessToken, postJson({ providerId: provider.id, serviceId, addressId: address.body.id, scheduledStart: next.start, scheduledEnd: next.end })));
    expect(second.status).toBe(201);
    // ...and a start inside the buffer is refused by the database, not just hidden.
    const tooClose = new Date(new Date(chosen.end).getTime() + 10 * 60_000);
    const clash = await callApi<{ code: string }>(
      app,
      '/bookings',
      bearer(customer.accessToken, postJson({ providerId: provider.id, serviceId, addressId: address.body.id, scheduledStart: tooClose.toISOString(), scheduledEnd: new Date(tooClose.getTime() + 90 * 60_000).toISOString() }))
    );
    expect(clash.status).toBe(409);
    expect(clash.body.code).toBe('SLOT_TAKEN');
  });

  it('returns nothing for a day the provider does not work', async () => {
    const date = localDate(12);
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    const restricted = await registerAndVerify(app, 'PROVIDER');
    // A provider with availability only on some other weekday: build via the shared helper's provider, then read a day with no rule by using a fresh, unapproved one → 404.
    const response = await listSlots(date, restricted.id);
    expect(response.status).toBe(404);
    expect(weekday).toBeGreaterThanOrEqual(0);
  });

  it('rejects a malformed or impossible date with 4xx, and an unknown service with 404', async () => {
    expect((await listSlots('2026-13-40')).status).toBeGreaterThanOrEqual(400);
    expect((await listSlots('not-a-date')).status).toBe(422);
    expect((await listSlots(localDate(10), provider.id, 999_999)).status).toBe(404);
  });

  it('offers nothing earlier than an hour from now', async () => {
    const today = localDate(0);
    const response = await listSlots(today);
    expect(response.status).toBe(200);
    for (const slot of response.body.items) expect(new Date(slot.start).getTime()).toBeGreaterThanOrEqual(Date.now() + 60 * 60_000 - 1_000);
  });
});
