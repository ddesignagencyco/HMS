// apps/api/test/integration/booking-start.test.ts
//
// FR-EX-02: the start OTP issued on accept, and the /start endpoint that
// consumes it. Its own file for the same reason as the other booking-*
// splits: a fresh app instance per file means a fresh in-memory rate limiter.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { callApi, createTestApp, postJson, readOtpFromInbox, readyBookableProvider, registerAndVerify } from './harness.js';

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

describe('FR-EX-02 / SHM-041: start OTP', () => {
  // One provider for the whole file; offsets stay multiples of 24h so none
  // can cross midnight in Asia/Karachi (see booking-transitions.test.ts).
  let shared: { providerId: string; providerAccessToken: string; serviceId: number; areaId: number };
  let nextSlotOffsetHours = 480;

  beforeAll(async () => {
    const { provider, serviceId, areaId } = await readyBookableProvider(app);
    shared = { providerId: provider.id, providerAccessToken: provider.accessToken, serviceId, areaId };
  });

  /** A fresh customer with an accepted (SCHEDULED) booking, plus their phone for reading the start code back out of the dev inbox. */
  const acceptedBooking = async (): Promise<{ id: string; customerPhone: string }> => {
    const customer = await registerAndVerify(app, 'CUSTOMER');
    const address = await callApi<{ id: string }>(app, '/customer/addresses', asCustomer(customer.accessToken, postJson({ label: 'Home', line1: 'House 1', areaId: shared.areaId, lat: 31.52, lng: 74.35, isDefault: true })));
    const slot = slotAt(nextSlotOffsetHours);
    nextSlotOffsetHours += 24;
    const created = await callApi<{ id: string }>(app, '/bookings', asCustomer(customer.accessToken, postJson({ providerId: shared.providerId, serviceId: shared.serviceId, addressId: address.body.id, ...slot })));
    await callApi(app, `/bookings/${created.body.id}/accept`, asCustomer(shared.providerAccessToken, { method: 'POST' }));
    return { id: created.body.id, customerPhone: customer.phoneE164 };
  };

  const enRouteBooking = async (): Promise<{ id: string; customerPhone: string }> => {
    const booking = await acceptedBooking();
    await callApi(app, `/bookings/${booking.id}/depart`, asCustomer(shared.providerAccessToken, { method: 'POST' }));
    return booking;
  };

  it('sends a start code to the customer on accept, and lets the provider start the job with it once EN_ROUTE', async () => {
    const booking = await enRouteBooking();
    const code = await readOtpFromInbox(app, booking.customerPhone);

    const response = await callApi<{ status: string; startOtpVerifiedAt: string | null }>(app, `/bookings/${booking.id}/start`, asCustomer(shared.providerAccessToken, postJson({ code })));
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('IN_PROGRESS');
    expect(response.body.startOtpVerifiedAt).not.toBeNull();
  });

  it('rejects a wrong code with 422 OTP_INVALID, reporting remaining attempts', async () => {
    const booking = await enRouteBooking();

    const response = await callApi<{ code: string; detail: string }>(app, `/bookings/${booking.id}/start`, asCustomer(shared.providerAccessToken, postJson({ code: '000000' })));
    expect(response.status).toBe(422);
    expect(response.body.code).toBe('OTP_INVALID');
    expect(response.body.detail).toContain('4 attempt');
  });

  it('locks after 5 wrong attempts, rejecting even the correct code with 423 OTP_LOCKED', async () => {
    const booking = await enRouteBooking();
    const correctCode = await readOtpFromInbox(app, booking.customerPhone);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await callApi(app, `/bookings/${booking.id}/start`, asCustomer(shared.providerAccessToken, postJson({ code: '000000' })));
    }

    const response = await callApi<{ code: string }>(app, `/bookings/${booking.id}/start`, asCustomer(shared.providerAccessToken, postJson({ code: correctCode })));
    expect(response.status).toBe(423);
    expect(response.body.code).toBe('OTP_LOCKED');
  });

  it('rejects a start attempted while still SCHEDULED (before depart) with 409 ILLEGAL_TRANSITION', async () => {
    const booking = await acceptedBooking();
    const code = await readOtpFromInbox(app, booking.customerPhone);

    const response = await callApi<{ code: string }>(app, `/bookings/${booking.id}/start`, asCustomer(shared.providerAccessToken, postJson({ code })));
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('ILLEGAL_TRANSITION');
  });

  it('rejects a start from a provider this booking was not requested from, hiding whether it exists', async () => {
    const booking = await enRouteBooking();
    const otherProvider = await registerAndVerify(app, 'PROVIDER');
    const code = await readOtpFromInbox(app, booking.customerPhone);

    const response = await callApi<{ code: string }>(app, `/bookings/${booking.id}/start`, asCustomer(otherProvider.accessToken, postJson({ code })));
    expect(response.status).toBe(404);
    expect(response.body.code).toBe('NOT_FOUND');
  });

  it('rejects a start attempted by the customer, never reaching the service layer', async () => {
    const customer = await registerAndVerify(app, 'CUSTOMER');
    const address = await callApi<{ id: string }>(app, '/customer/addresses', asCustomer(customer.accessToken, postJson({ label: 'Home', line1: 'House 1', areaId: shared.areaId, lat: 31.52, lng: 74.35, isDefault: true })));
    const slot = slotAt(nextSlotOffsetHours);
    nextSlotOffsetHours += 24;
    const created = await callApi<{ id: string }>(app, '/bookings', asCustomer(customer.accessToken, postJson({ providerId: shared.providerId, serviceId: shared.serviceId, addressId: address.body.id, ...slot })));

    const response = await callApi<{ code: string }>(app, `/bookings/${created.body.id}/start`, asCustomer(customer.accessToken, postJson({ code: '123456' })));
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('FORBIDDEN');
  });
});
