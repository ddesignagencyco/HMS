// apps/api/test/integration/booking-reschedule.test.ts
//
// Split into its own file for the same reason as booking-transitions.test.ts:
// each test file gets a fresh app instance and therefore a fresh in-memory
// rate limiter (300 req/60s) — reschedule's setup (register, address, book,
// accept, then reschedule) is expensive enough per test that bundling it
// into an already-busy file would trip that limiter.
import { Prisma } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService } from '../../src/database/prisma.service.js';
import { callApi, createTestApp, postJson, readyBookableProvider, registerAndVerify } from './harness.js';

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

const asCustomer = (accessToken: string, init: RequestInit = {}): RequestInit => ({ ...init, headers: { ...init.headers, authorization: `Bearer ${accessToken}` } });

const slotAt = (hoursFromNow: number): { scheduledStart: string; scheduledEnd: string } => {
  const start = new Date(Date.now() + hoursFromNow * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return { scheduledStart: start.toISOString(), scheduledEnd: end.toISOString() };
};

describe('FR-BK-05 / SHM-039: reschedule a booking', () => {
  // One provider for the whole file; every offset below is a multiple of 24h
  // so none can cross midnight in Asia/Karachi (see the note in
  // booking-transitions.test.ts) and each booking still gets its own slot.
  let shared: { providerId: string; providerAccessToken: string; serviceId: number; areaId: number };
  let nextSlotOffsetHours = 240;

  beforeAll(async () => {
    const { provider, serviceId, areaId } = await readyBookableProvider(app);
    shared = { providerId: provider.id, providerAccessToken: provider.accessToken, serviceId, areaId };
  });

  /** A fresh customer with a SCHEDULED booking against the shared provider, `hoursFromNow` out. */
  const scheduledBooking = async (hoursFromNow: number): Promise<{ id: string; customerAccessToken: string; originalStart: string }> => {
    const customer = await registerAndVerify(app, 'CUSTOMER');
    const address = await callApi<{ id: string }>(app, '/customer/addresses', asCustomer(customer.accessToken, postJson({ label: 'Home', line1: 'House 1', areaId: shared.areaId, lat: 31.52, lng: 74.35, isDefault: true })));
    const slot = slotAt(hoursFromNow);
    const created = await callApi<{ id: string }>(app, '/bookings', asCustomer(customer.accessToken, postJson({ providerId: shared.providerId, serviceId: shared.serviceId, addressId: address.body.id, ...slot })));
    await callApi(app, `/bookings/${created.body.id}/accept`, asCustomer(shared.providerAccessToken, { method: 'POST' }));
    return { id: created.body.id, customerAccessToken: customer.accessToken, originalStart: slot.scheduledStart };
  };

  const nextTwoSlotsApart = (): [number, number] => {
    const first = nextSlotOffsetHours;
    nextSlotOffsetHours += 48;
    return [first, first + 24];
  };

  it('lets the customer move a SCHEDULED booking to a new time at least 4 hours out, incrementing reschedule_count', async () => {
    const [bookingHours, newHours] = nextTwoSlotsApart();
    const booking = await scheduledBooking(bookingHours);
    const newSlot = slotAt(newHours);

    const response = await callApi<{ status: string; scheduledStart: string; rescheduleCount: number }>(app, `/bookings/${booking.id}/reschedule`, asCustomer(booking.customerAccessToken, postJson(newSlot)));
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('SCHEDULED');
    expect(response.body.rescheduleCount).toBe(1);
    expect(new Date(response.body.scheduledStart).toISOString()).toBe(newSlot.scheduledStart);

    const prisma = app.get(PrismaService);
    const history = await prisma.$queryRaw<{ event: string; fromStatus: string; toStatus: string }[]>(
      Prisma.sql`SELECT event, from_status as "fromStatus", to_status as "toStatus" FROM booking_status_history WHERE booking_id = ${booking.id}::uuid ORDER BY id DESC LIMIT 1`
    );
    expect(history[0]).toEqual({ event: 'reschedule', fromStatus: 'SCHEDULED', toStatus: 'SCHEDULED' });
  });

  it('rejects a second reschedule on the same booking with 400', async () => {
    const [bookingHours, firstNewHours] = nextTwoSlotsApart();
    const booking = await scheduledBooking(bookingHours);
    await callApi(app, `/bookings/${booking.id}/reschedule`, asCustomer(booking.customerAccessToken, postJson(slotAt(firstNewHours))));

    nextSlotOffsetHours += 24;
    const response = await callApi<{ code: string }>(app, `/bookings/${booking.id}/reschedule`, asCustomer(booking.customerAccessToken, postJson(slotAt(nextSlotOffsetHours))));
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('BAD_REQUEST');
  });

  it('rejects a reschedule made less than 4 hours before the current slot', async () => {
    // 2 hours out, so "now" is already inside the 4-hour notice window.
    const booking = await scheduledBooking(2);
    const [, newHours] = nextTwoSlotsApart();

    const response = await callApi<{ code: string }>(app, `/bookings/${booking.id}/reschedule`, asCustomer(booking.customerAccessToken, postJson(slotAt(newHours))));
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('BAD_REQUEST');
  });

  it('rejects a reschedule onto a slot already taken by another of the same provider’s bookings, with 409 CONFLICT', async () => {
    const [firstHours, secondHours] = nextTwoSlotsApart();
    await scheduledBooking(firstHours);
    const second = await scheduledBooking(secondHours);

    const response = await callApi<{ code: string }>(app, `/bookings/${second.id}/reschedule`, asCustomer(second.customerAccessToken, postJson(slotAt(firstHours))));
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('CONFLICT');
  });

  it('rejects a reschedule from someone who is not the booking’s customer, hiding whether it exists', async () => {
    const [bookingHours, newHours] = nextTwoSlotsApart();
    const booking = await scheduledBooking(bookingHours);
    const stranger = await registerAndVerify(app, 'CUSTOMER');

    const response = await callApi<{ code: string }>(app, `/bookings/${booking.id}/reschedule`, asCustomer(stranger.accessToken, postJson(slotAt(newHours))));
    expect(response.status).toBe(404);
    expect(response.body.code).toBe('NOT_FOUND');
  });

  it('rejects a reschedule attempted by the provider, never reaching the service layer', async () => {
    const [bookingHours, newHours] = nextTwoSlotsApart();
    const booking = await scheduledBooking(bookingHours);

    const response = await callApi<{ code: string }>(app, `/bookings/${booking.id}/reschedule`, asCustomer(shared.providerAccessToken, postJson(slotAt(newHours))));
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('FORBIDDEN');
  });

  it('rejects a reschedule on a booking still REQUESTED (never accepted) with 409 ILLEGAL_TRANSITION', async () => {
    const customer = await registerAndVerify(app, 'CUSTOMER');
    const address = await callApi<{ id: string }>(app, '/customer/addresses', asCustomer(customer.accessToken, postJson({ label: 'Home', line1: 'House 1', areaId: shared.areaId, lat: 31.52, lng: 74.35, isDefault: true })));
    const [bookingHours, newHours] = nextTwoSlotsApart();
    const created = await callApi<{ id: string }>(app, '/bookings', asCustomer(customer.accessToken, postJson({ providerId: shared.providerId, serviceId: shared.serviceId, addressId: address.body.id, ...slotAt(bookingHours) })));

    const response = await callApi<{ code: string }>(app, `/bookings/${created.body.id}/reschedule`, asCustomer(customer.accessToken, postJson(slotAt(newHours))));
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('ILLEGAL_TRANSITION');
  });
});
