// apps/api/test/integration/booking-transitions.test.ts
//
// Split out of booking.test.ts: BookingService.apply() covers every booking
// state transition (accept/decline/depart/cancel/no-show and, eventually,
// reschedule/start/quote-revision/complete), and each test file gets its own
// fresh app instance and therefore its own fresh in-memory rate limiter
// (300 req/60s) — packing these alongside booking.test.ts's own create/read
// tests tripped that limiter well before either file was this size.
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

const aFutureSlot = (hoursFromNow = 72): { scheduledStart: string; scheduledEnd: string } => {
  const start = new Date(Date.now() + hoursFromNow * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return { scheduledStart: start.toISOString(), scheduledEnd: end.toISOString() };
};

describe('FR-SP-09 / SHM-034: accept and decline a booking request', () => {
  // One provider onboarded for the whole block: onboarding a provider is the
  // expensive part of setup (~15 requests), and this suite's own in-memory
  // rate limiter (300 req/60s, fresh per test file) is otherwise tripped by
  // repeating it per test. Each `it` still creates its own fresh customer and
  // booking, so bookings themselves are never shared across assertions.
  let shared: { providerId: string; providerAccessToken: string; serviceId: number; areaId: number };

  beforeAll(async () => {
    const { provider, serviceId, areaId } = await readyBookableProvider(app);
    shared = { providerId: provider.id, providerAccessToken: provider.accessToken, serviceId, areaId };
  });

  // All bookings in this block target the one shared provider, so each needs a
  // slot at least an hour apart from every other — otherwise two bookings
  // created seconds apart both land near "72 hours from now" and collide on
  // the provider's no-overlap exclusion constraint.
  let nextSlotOffsetHours = 72; // multiple of 24h: same, safe wall-clock time as "now", just N days later

  const freshBookingForSharedProvider = async (): Promise<{ id: string; status: string }> => {
    const customer = await registerAndVerify(app, 'CUSTOMER');
    const address = await callApi<{ id: string }>(app, '/customer/addresses', asCustomer(customer.accessToken, postJson({ label: 'Home', line1: 'House 1', areaId: shared.areaId, lat: 31.52, lng: 74.35, isDefault: true })));
    const slot = aFutureSlot(nextSlotOffsetHours);
    nextSlotOffsetHours += 24; // stay a multiple of 24h so no increment can cross midnight
    const created = await callApi<{ id: string; status: string }>(
      app,
      '/bookings',
      asCustomer(customer.accessToken, postJson({ providerId: shared.providerId, serviceId: shared.serviceId, addressId: address.body.id, ...slot }))
    );
    return created.body;
  };

  it("lets the assigned provider accept a REQUESTED booking, moving it to SCHEDULED and recording the transition", async () => {
    const booking = await freshBookingForSharedProvider();

    const accepted = await callApi<{ id: string; status: string }>(app, `/bookings/${booking.id}/accept`, asCustomer(shared.providerAccessToken, { method: 'POST' }));
    expect(accepted.status).toBe(200);
    expect(accepted.body.status).toBe('SCHEDULED');

    const prisma = app.get(PrismaService);
    const history = await prisma.$queryRaw<{ fromStatus: string; toStatus: string; event: string; actorRole: string }[]>(
      Prisma.sql`SELECT from_status as "fromStatus", to_status as "toStatus", event, actor_role as "actorRole" FROM booking_status_history WHERE booking_id = ${booking.id}::uuid ORDER BY id DESC LIMIT 1`
    );
    expect(history[0]).toEqual({ fromStatus: 'REQUESTED', toStatus: 'SCHEDULED', event: 'accept', actorRole: 'PROVIDER' });
  });

  it('lets the assigned provider decline a REQUESTED booking, moving it to UNFULFILLED', async () => {
    const booking = await freshBookingForSharedProvider();

    const declined = await callApi<{ id: string; status: string }>(app, `/bookings/${booking.id}/decline`, asCustomer(shared.providerAccessToken, { method: 'POST' }));
    expect(declined.status).toBe(200);
    expect(declined.body.status).toBe('UNFULFILLED');
  });

  it('rejects an accept from a provider this booking was not requested from, hiding whether it exists', async () => {
    const booking = await freshBookingForSharedProvider();
    const otherProvider = await registerAndVerify(app, 'PROVIDER');

    const response = await callApi<{ code: string }>(app, `/bookings/${booking.id}/accept`, asCustomer(otherProvider.accessToken, { method: 'POST' }));
    expect(response.status).toBe(404);
    expect(response.body.code).toBe('NOT_FOUND');
  });

  it('rejects an accept from the customer, never reaching the service layer', async () => {
    const booking = await freshBookingForSharedProvider();
    const customerToken = (await registerAndVerify(app, 'CUSTOMER')).accessToken;

    const response = await callApi<{ code: string }>(app, `/bookings/${booking.id}/accept`, asCustomer(customerToken, { method: 'POST' }));
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('FORBIDDEN');
  });

  it('rejects a second accept on an already-SCHEDULED booking with 409 ILLEGAL_TRANSITION', async () => {
    const booking = await freshBookingForSharedProvider();
    await callApi(app, `/bookings/${booking.id}/accept`, asCustomer(shared.providerAccessToken, { method: 'POST' }));

    const response = await callApi<{ code: string }>(app, `/bookings/${booking.id}/accept`, asCustomer(shared.providerAccessToken, { method: 'POST' }));
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('ILLEGAL_TRANSITION');
  });

  it('rejects accepting a booking that was already declined', async () => {
    const booking = await freshBookingForSharedProvider();
    await callApi(app, `/bookings/${booking.id}/decline`, asCustomer(shared.providerAccessToken, { method: 'POST' }));

    const response = await callApi<{ code: string }>(app, `/bookings/${booking.id}/accept`, asCustomer(shared.providerAccessToken, { method: 'POST' }));
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('ILLEGAL_TRANSITION');
  });
});

describe('FR-EX-01 / FR-BK-06 / SHM-034: depart, cancel and no-show', () => {
  // Same shared-provider approach as the accept/decline block above, and the
  // same reason it's needed: this suite's rate limiter is fresh per test file,
  // and re-onboarding a provider per test would trip it.
  let shared: { providerId: string; providerAccessToken: string; serviceId: number; areaId: number };
  let nextSlotOffsetHours = 216; // multiple of 24h, see the comment in the block above

  beforeAll(async () => {
    const { provider, serviceId, areaId } = await readyBookableProvider(app);
    shared = { providerId: provider.id, providerAccessToken: provider.accessToken, serviceId, areaId };
  });

  /** Registers a fresh customer, books the shared provider, and accepts it — returns both tokens plus the now-SCHEDULED booking. */
  const scheduledBooking = async (): Promise<{ id: string; customerAccessToken: string }> => {
    const customer = await registerAndVerify(app, 'CUSTOMER');
    const address = await callApi<{ id: string }>(app, '/customer/addresses', asCustomer(customer.accessToken, postJson({ label: 'Home', line1: 'House 1', areaId: shared.areaId, lat: 31.52, lng: 74.35, isDefault: true })));
    const slot = aFutureSlot(nextSlotOffsetHours);
    nextSlotOffsetHours += 24;
    const created = await callApi<{ id: string }>(app, '/bookings', asCustomer(customer.accessToken, postJson({ providerId: shared.providerId, serviceId: shared.serviceId, addressId: address.body.id, ...slot })));
    await callApi(app, `/bookings/${created.body.id}/accept`, asCustomer(shared.providerAccessToken, { method: 'POST' }));
    return { id: created.body.id, customerAccessToken: customer.accessToken };
  };

  /** A `scheduledBooking()` moved on to EN_ROUTE, for the no-show tests. */
  const enRouteBooking = async (): Promise<{ id: string; customerAccessToken: string }> => {
    const booking = await scheduledBooking();
    await callApi(app, `/bookings/${booking.id}/depart`, asCustomer(shared.providerAccessToken, { method: 'POST' }));
    return booking;
  };

  it('lets the provider mark themselves en route on a SCHEDULED booking', async () => {
    const booking = await scheduledBooking();

    const response = await callApi<{ status: string }>(app, `/bookings/${booking.id}/depart`, asCustomer(shared.providerAccessToken, { method: 'POST' }));
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('EN_ROUTE');
  });

  it('rejects a depart from a booking still in REQUESTED with 409 ILLEGAL_TRANSITION', async () => {
    const customer = await registerAndVerify(app, 'CUSTOMER');
    const address = await callApi<{ id: string }>(app, '/customer/addresses', asCustomer(customer.accessToken, postJson({ label: 'Home', line1: 'House 1', areaId: shared.areaId, lat: 31.52, lng: 74.35, isDefault: true })));
    const slot = aFutureSlot(nextSlotOffsetHours);
    nextSlotOffsetHours += 24;
    const created = await callApi<{ id: string }>(app, '/bookings', asCustomer(customer.accessToken, postJson({ providerId: shared.providerId, serviceId: shared.serviceId, addressId: address.body.id, ...slot })));

    const response = await callApi<{ code: string }>(app, `/bookings/${created.body.id}/depart`, asCustomer(shared.providerAccessToken, { method: 'POST' }));
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('ILLEGAL_TRANSITION');
  });

  it('lets the customer cancel a SCHEDULED booking with a reason, recorded on the booking and its history', async () => {
    const booking = await scheduledBooking();

    const cancelled = await callApi<{ status: string }>(app, `/bookings/${booking.id}/cancel`, asCustomer(booking.customerAccessToken, postJson({ reason: 'Found a closer provider' })));
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe('CANCELLED_CUSTOMER');

    const prisma = app.get(PrismaService);
    const rows = await prisma.$queryRaw<{ cancelReason: string | null }[]>(Prisma.sql`SELECT cancel_reason as "cancelReason" FROM bookings WHERE id = ${booking.id}::uuid`);
    expect(rows[0]?.cancelReason).toBe('Found a closer provider');
    const history = await prisma.$queryRaw<{ reason: string | null; actorRole: string }[]>(
      Prisma.sql`SELECT reason, actor_role as "actorRole" FROM booking_status_history WHERE booking_id = ${booking.id}::uuid ORDER BY id DESC LIMIT 1`
    );
    expect(history[0]).toEqual({ reason: 'Found a closer provider', actorRole: 'CUSTOMER' });
  });

  it('lets the provider cancel a SCHEDULED booking without a reason, landing on CANCELLED_PROVIDER', async () => {
    const booking = await scheduledBooking();

    const cancelled = await callApi<{ status: string }>(app, `/bookings/${booking.id}/cancel`, asCustomer(shared.providerAccessToken, postJson({})));
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe('CANCELLED_PROVIDER');
  });

  it('rejects a cancel from someone who is neither the customer nor the provider, hiding whether the booking exists', async () => {
    const booking = await scheduledBooking();
    const stranger = await registerAndVerify(app, 'CUSTOMER');

    const response = await callApi<{ code: string }>(app, `/bookings/${booking.id}/cancel`, asCustomer(stranger.accessToken, postJson({})));
    expect(response.status).toBe(404);
    expect(response.body.code).toBe('NOT_FOUND');
  });

  it('lets either party report a no-show on an EN_ROUTE booking, recording which side failed to show', async () => {
    const booking = await enRouteBooking();

    const response = await callApi<{ status: string }>(app, `/bookings/${booking.id}/no-show`, asCustomer(shared.providerAccessToken, postJson({ party: 'CUSTOMER' })));
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('NO_SHOW');

    const prisma = app.get(PrismaService);
    const rows = await prisma.$queryRaw<{ noShowParty: string | null }[]>(Prisma.sql`SELECT no_show_party as "noShowParty" FROM bookings WHERE id = ${booking.id}::uuid`);
    expect(rows[0]?.noShowParty).toBe('CUSTOMER');
  });

  it('rejects a no-show reported on a booking still SCHEDULED (not yet EN_ROUTE) with 409 ILLEGAL_TRANSITION', async () => {
    const booking = await scheduledBooking();

    const response = await callApi<{ code: string }>(app, `/bookings/${booking.id}/no-show`, asCustomer(shared.providerAccessToken, postJson({ party: 'CUSTOMER' })));
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('ILLEGAL_TRANSITION');
  });

  it('rejects a no-show body naming neither CUSTOMER nor PROVIDER', async () => {
    const booking = await enRouteBooking();

    const response = await callApi<{ code: string }>(app, `/bookings/${booking.id}/no-show`, asCustomer(shared.providerAccessToken, postJson({ party: 'NOBODY' })));
    expect(response.status).toBe(422);
    expect(response.body.code).toBe('VALIDATION_FAILED');
  });
});
