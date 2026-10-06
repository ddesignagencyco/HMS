// apps/api/test/integration/same-day-booking.test.ts
//
// Same-day and short-notice booking: "can I book a provider for the next hour?"
//
// The feature is two rules and a resolver. The rules are the minimum notice
// (booking.min_notice_min) and how far a window may cross local midnight
// (booking.max_day_span); both must be enforced by the slot listing and by checkout
// alike, because a listing that offers a start time checkout refuses has told the
// customer a lie. The resolver answers "when is this provider next free?" for a
// customer who has no date in mind.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { callApi, createTestApp, postJson, putJson, readyBookableProvider, registerAndVerify, type TestUser } from './harness.js';
import { nextLocalTime, travelToLocal, unfreeze } from './flow.js';

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

const MIN_NOTICE_MIN = 30;

/**
 * Half-hour aligned, `minutes` from now — the step the resolver offers. Rounded up,
 * so a test asking for "20 minutes from now" gets a start that is genuinely inside
 * the notice period rather than one that rounding pushed back out to 30.
 */
const inMinutes = (minutes: number): Date => new Date(Math.ceil((Date.now() + minutes * 60_000) / (30 * 60_000)) * 30 * 60_000);

const localDate = (daysAhead: number): string => new Date(Date.now() + daysAhead * 86_400_000 + 5 * 3_600_000).toISOString().slice(0, 10);

type Slots = { date: string; durationMin: number; items: { start: string; end: string }[] };
type NextSlots = { durationMin: number; items: { start: string; end: string }[] };

type Booking = { code: string; detail?: string };

describe('same-day booking: the minimum notice', () => {
  let provider: TestUser;
  let serviceId: number;
  let areaId: number;
  let customer: TestUser;
  let addressId: string;

  beforeAll(async () => {
    const ready = await readyBookableProvider(app);
    provider = ready.provider;
    serviceId = ready.serviceId;
    areaId = ready.areaId;
    customer = await registerAndVerify(app, 'CUSTOMER');
    const address = await callApi<{ id: string }>(app, '/customer/addresses', bearer(customer.accessToken, postJson({ label: 'Home', line1: 'House 1', areaId, lat: 31.52, lng: 74.35, isDefault: true })));
    addressId = address.body.id;
  });

  const book = (start: Date, durationMin = 90) =>
    callApi<Booking>(
      app,
      '/bookings',
      bearer(customer.accessToken, postJson({ providerId: provider.id, serviceId, addressId, scheduledStart: start.toISOString(), scheduledEnd: new Date(start.getTime() + durationMin * 60_000).toISOString() }))
    );

  it('refuses a start inside the notice period, and names how much notice it needs', async () => {
    // Not rounded to a slot boundary: the point is a start 15 minutes out, which is
    // inside the notice however the slots happen to be aligned.
    const response = await book(new Date(Date.now() + 15 * 60_000));
    expect(response.status).toBe(400);
    expect(response.body.detail).toContain(`${MIN_NOTICE_MIN} minutes`);
  });

  it('refuses a start in the past', async () => {
    expect((await book(new Date(Date.now() - 60 * 60_000))).status).toBe(400);
  });

  it('accepts a booking for inside the hour — the thing the client asked for', async () => {
    // 45 minutes out: inside the next hour, and past the 30-minute notice.
    const response = await book(inMinutes(45));
    expect(response.status).toBe(201);
  });

  it('accepts a start exactly on the notice boundary', async () => {
    const response = await book(inMinutes(MIN_NOTICE_MIN + 240));
    expect(response.status).toBe(201);
  });

  it('agrees with the slot listing about what is bookable, rather than each having its own rule', async () => {
    // The listing used to hardcode 60 minutes while checkout accepted anything in the
    // future, so a customer could be offered a time checkout then refused, and could
    // also book a time the listing said was unavailable. Both now read booking.min_notice_min.
    const today = localDate(0);
    const listed = await callApi<Slots>(app, `/search/providers/${provider.id}/slots?serviceId=${serviceId}&date=${today}`);
    expect(listed.status).toBe(200);
    for (const slot of listed.body.items) {
      expect(new Date(slot.start).getTime()).toBeGreaterThanOrEqual(Date.now() + MIN_NOTICE_MIN * 60_000 - 60_000);
    }
  });
});

describe('same-day booking: a job that ends after local midnight', () => {
  let provider: TestUser;
  let serviceId: number;
  let customer: TestUser;
  let addressId: string;
  /** The next local midnight (Asia/Karachi) after the application's clock is set to 22:00. */
  let localMidnight: Date;

  beforeAll(async () => {
    const ready = await readyBookableProvider(app);
    provider = ready.provider;
    serviceId = ready.serviceId;
    customer = await registerAndVerify(app, 'CUSTOMER');
    const address = await callApi<{ id: string }>(app, '/customer/addresses', bearer(customer.accessToken, postJson({ label: 'Home', line1: 'House 1', areaId: ready.areaId, lat: 31.52, lng: 74.35, isDefault: true })));
    addressId = address.body.id;

    // Pinned to 22:00 local rather than depending on when the suite happens to run:
    // "23:00 to 00:30" is only a cross-midnight booking if the clock says it is.
    travelToLocal(app, 22, 0);
    localMidnight = nextLocalTime(0, 0);
  });

  afterAll(() => {
    unfreeze(app);
  });

  const book = (start: Date, end: Date) =>
    callApi<Booking>(
      app,
      '/bookings',
      bearer(customer.accessToken, postJson({ providerId: provider.id, serviceId, addressId, scheduledStart: start.toISOString(), scheduledEnd: end.toISOString() }))
    );

  it('books a late-evening job that finishes after midnight', async () => {
    // 23:00-00:30 local. The old rule refused this outright ("must start and end on
    // the same calendar day"), which made an ordinary evening job unbookable.
    const start = new Date(localMidnight.getTime() - 60 * 60_000);
    const end = new Date(localMidnight.getTime() + 30 * 60_000);
    const response = await book(start, end);
    expect(response.status).toBe(201);
  });

  it('still refuses a window sprawling across more than one night', async () => {
    // A different provider, so this is about the rule and not a slot clash with the
    // booking above.
    const other = await readyBookableProvider(app);
    const start = new Date(localMidnight.getTime() - 60 * 60_000);
    const end = new Date(localMidnight.getTime() + 26 * 3_600_000);
    const response = await callApi<Booking>(
      app,
      '/bookings',
      bearer(customer.accessToken, postJson({ providerId: other.provider.id, serviceId: other.serviceId, addressId, scheduledStart: start.toISOString(), scheduledEnd: end.toISOString() }))
    );
    expect(response.status).toBe(400);
    expect(response.body.detail).toContain('more than one night');
  });

  it('finds the provider as a candidate for a cross-midnight job, rather than exhausting the cascade', async () => {
    // The auto-assign candidate query matches availability one local day at a time.
    // Before that split it required a single availability row to span the whole
    // window, which no provider can satisfy across midnight -- so a next-hour booking
    // ending at 00:30 would find nobody and fall straight to UNFULFILLED.
    travelToLocal(app, 22, 0);
    const auto = await callApi<{ id: string; status: string }>(
      app,
      '/bookings',
      bearer(customer.accessToken, postJson({ serviceId, addressId, scheduledStart: new Date(localMidnight.getTime() - 60 * 60_000).toISOString(), scheduledEnd: new Date(localMidnight.getTime() + 30 * 60_000).toISOString() }))
    );
    expect(auto.status).toBe(201);
    expect(auto.body.status).not.toBe('UNFULFILLED');
  });
});

describe('GET /search/providers/:id/next-slots', () => {
  let provider: TestUser;
  let serviceId: number;
  let areaId: number;

  beforeAll(async () => {
    const ready = await readyBookableProvider(app);
    provider = ready.provider;
    serviceId = ready.serviceId;
    areaId = ready.areaId;
  });

  const nextSlots = (id = provider.id, service = serviceId, limit = 5) =>
    callApi<NextSlots>(app, `/search/providers/${id}/next-slots?serviceId=${service}&limit=${limit}`);

  it('answers "when is this provider next free?" with the soonest start times', async () => {
    const response = await nextSlots();
    expect(response.status).toBe(200);
    expect(response.body.durationMin).toBe(90);
    expect(response.body.items.length).toBeGreaterThan(0);
    expect(response.body.items.length).toBeLessThanOrEqual(5);

    const starts = response.body.items.map(slot => new Date(slot.start).getTime());
    // The whole point of the endpoint: the first item is the earliest they can start.
    expect(starts).toEqual([...starts].sort((left, right) => left - right));
    for (const slot of response.body.items) {
      expect(new Date(slot.end).getTime() - new Date(slot.start).getTime()).toBe(90 * 60_000);
      expect(new Date(slot.start).getTime()).toBeGreaterThanOrEqual(Date.now() + MIN_NOTICE_MIN * 60_000 - 60_000);
    }
  });

  it('honours the limit, and accepts a limit of one', async () => {
    const one = await nextSlots(provider.id, serviceId, 1);
    expect(one.status).toBe(200);
    expect(one.body.items).toHaveLength(1);
    const three = await nextSlots(provider.id, serviceId, 3);
    expect(three.body.items).toHaveLength(3);
  });

  it('refuses a limit outside 1..20 with 422', async () => {
    expect((await callApi(app, `/search/providers/${provider.id}/next-slots?serviceId=${serviceId}&limit=0`)).status).toBe(422);
    expect((await callApi(app, `/search/providers/${provider.id}/next-slots?serviceId=${serviceId}&limit=99`)).status).toBe(422);
  });

  it('offers the soonest slot first, and that slot can actually be booked', async () => {
    // An offer is only useful if checkout accepts it — this is the assertion the
    // listing/checkout agreement rests on.
    const resolved = await nextSlots(provider.id, serviceId, 1);
    const soonest = resolved.body.items[0]!;

    const customer = await registerAndVerify(app, 'CUSTOMER');
    const address = await callApi<{ id: string }>(app, '/customer/addresses', bearer(customer.accessToken, postJson({ label: 'Home', line1: 'House 1', areaId, lat: 31.52, lng: 74.35, isDefault: true })));

    const booked = await callApi(
      app,
      '/bookings',
      bearer(customer.accessToken, postJson({ providerId: provider.id, serviceId, addressId: address.body.id, scheduledStart: soonest.start, scheduledEnd: soonest.end }))
    );
    expect(booked.status).toBe(201);
  });

  it('skips a provider who does not offer the service, and one who is not approved', async () => {
    const stranger = await registerAndVerify(app, 'PROVIDER');
    expect((await nextSlots(stranger.id, serviceId, 3)).status).toBe(404);
  });

  it('returns an empty list rather than an error when the provider has nothing free soon', async () => {
    // An approved provider whose only declared working day falls outside the
    // resolver's horizon (booking.next_slot_days, seeded at 3). Picking the weekday
    // this way keeps the test honest on any day it runs.
    const horizonDays = 3;
    const reachable = new Set<number>();
    for (let offset = 0; offset < horizonDays; offset += 1) {
      reachable.add(new Date(Date.now() + offset * 86_400_000).getUTCDay());
    }
    const unreachableWeekday = [0, 1, 2, 3, 4, 5, 6].find(weekday => !reachable.has(weekday));
    expect(unreachableWeekday).toBeDefined();

    const idle = await readyBookableProvider(app);
    await callApi(app, '/provider/availability', bearer(idle.provider.accessToken, putJson({ items: [{ weekday: unreachableWeekday, startTime: '09:00', endTime: '10:00' }] })));

    const response = await nextSlots(idle.provider.id, idle.serviceId, 3);
    expect(response.status).toBe(200);
    expect(response.body.items).toEqual([]);
  });
});