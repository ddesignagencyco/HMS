// apps/api/test/integration/booking-start.test.ts
//
// FR-EX-02: the start OTP issued on accept, and the /start endpoint that
// consumes it. Its own file for the same reason as the other booking-*
// splits: a fresh app instance per file means a fresh in-memory rate limiter.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { callApi, createTestApp, postJson, readOtpFromInbox, readyBookableProvider, registerAndVerify } from './harness.js';
import { departProvider, prisma, startProvider } from './flow.js';

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
    await departProvider(app, booking.id, asCustomer(shared.providerAccessToken, { method: 'POST' }));
    return booking;
  };

  it('sends a start code to the customer on accept, and lets the provider start the job with it once EN_ROUTE', async () => {
    const booking = await enRouteBooking();
    const code = await readOtpFromInbox(app, booking.customerPhone);

    const response = await startProvider<{ status: string; startOtpVerifiedAt: string | null }>(app, booking.id, asCustomer(shared.providerAccessToken, postJson({ code })));
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('IN_PROGRESS');
    expect(response.body.startOtpVerifiedAt).not.toBeNull();
  });

  it('rejects a wrong code with 422 OTP_INVALID, reporting remaining attempts', async () => {
    const booking = await enRouteBooking();

    const response = await startProvider<{ code: string; detail: string }>(app, booking.id, asCustomer(shared.providerAccessToken, postJson({ code: '000000' })));
    expect(response.status).toBe(422);
    expect(response.body.code).toBe('OTP_INVALID');
    expect(response.body.detail).toContain('4 attempt');
  });

  it('locks after 5 wrong attempts, rejecting even the correct code with 423 OTP_LOCKED', async () => {
    const booking = await enRouteBooking();
    const correctCode = await readOtpFromInbox(app, booking.customerPhone);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await startProvider(app, booking.id, asCustomer(shared.providerAccessToken, postJson({ code: '000000' })));
    }

    const response = await startProvider<{ code: string }>(app, booking.id, asCustomer(shared.providerAccessToken, postJson({ code: correctCode })));
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

/**
 * The provider is standing at the customer's door. The customer has to have the code *in front of
 * them* to read it out — the only other channel was an SMS sent when the booking was accepted, which
 * may have been days earlier and is buried by then.
 */
describe('the start code on the customer’s own screen', () => {
  let shared: { providerId: string; providerAccessToken: string; serviceId: number; areaId: number };
  let nextSlotOffsetHours = 1440;

  beforeAll(async () => {
    const { provider, serviceId, areaId } = await readyBookableProvider(app);
    shared = { providerId: provider.id, providerAccessToken: provider.accessToken, serviceId, areaId };
  });

  const bookingFor = async (role: 'CUSTOMER' | 'PROVIDER'): Promise<{ id: string; accessToken: string; phone: string }> => {
    const customer = await registerAndVerify(app, 'CUSTOMER');
    const address = await callApi<{ id: string }>(app, '/customer/addresses', asCustomer(customer.accessToken, postJson({ label: 'Home', line1: 'House 1', areaId: shared.areaId, lat: 31.52, lng: 74.35, isDefault: true })));
    const slot = slotAt(nextSlotOffsetHours);
    nextSlotOffsetHours += 24;
    const created = await callApi<{ id: string }>(app, '/bookings', asCustomer(customer.accessToken, postJson({ providerId: shared.providerId, serviceId: shared.serviceId, addressId: address.body.id, ...slot })));
    await callApi(app, `/bookings/${created.body.id}/accept`, asCustomer(shared.providerAccessToken, { method: 'POST' }));
    return { id: created.body.id, accessToken: role === 'CUSTOMER' ? customer.accessToken : shared.providerAccessToken, phone: customer.phoneE164 };
  };

  it('returns a code the provider can actually start the job with', async () => {
    // The point of the feature, asserted end to end: the code shown on the customer's screen is the
    // same code that opens the job. A response that looked right but carried a code nothing verified
    // would pass a shape-only test and fail at the customer's front door.
    const booking = await bookingFor('CUSTOMER');
    await departProvider(app, booking.id, asCustomer(shared.providerAccessToken, { method: 'POST' }));

    const shown = await callApi<{ code: string; expiresInSeconds: number }>(app, `/bookings/${booking.id}/start-code`, asCustomer(booking.accessToken, { method: 'POST' }));
    expect(shown.status).toBe(200);
    expect(shown.body.code).toMatch(/^\d{6}$/);

    const started = await startProvider<{ status: string }>(app, booking.id, asCustomer(shared.providerAccessToken, postJson({ code: shown.body.code })));
    expect(started.status).toBe(200);
    expect(started.body.status).toBe('IN_PROGRESS');
  });

  it('still sends the SMS, unchanged, so the existing mechanism keeps working', async () => {
    const booking = await bookingFor('CUSTOMER');
    await departProvider(app, booking.id, asCustomer(shared.providerAccessToken, { method: 'POST' }));
    await callApi(app, `/bookings/${booking.id}/start-code`, asCustomer(booking.accessToken, { method: 'POST' }));

    const sms = await readOtpFromInbox(app, booking.phone);
    expect(sms).toMatch(/^\d{6}$/);
  });

  it('never stores the code in plaintext — the on-screen code is the only copy', async () => {
    // This is the property that makes the feature acceptable at all. The code is shown to the
    // customer, so "it is hashed at rest" stops being an assumption about a column nobody reads and
    // becomes the thing standing between a leaked database and jobs started in other people's houses.
    const booking = await bookingFor('CUSTOMER');
    await departProvider(app, booking.id, asCustomer(shared.providerAccessToken, { method: 'POST' }));
    const shown = await callApi<{ code: string }>(app, `/bookings/${booking.id}/start-code`, asCustomer(booking.accessToken, { method: 'POST' }));

    const stored = await prisma.$queryRaw<{ startOtpHash: string | null }[]>`
      SELECT start_otp_hash as "startOtpHash" FROM bookings WHERE id = ${booking.id}::uuid`;
    expect(stored[0]!.startOtpHash).not.toBeNull();
    expect(stored[0]!.startOtpHash).not.toContain(shown.body.code);
    expect(stored[0]!.startOtpHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses the provider, so the code stays something the customer alone can produce', async () => {
    // The entire control is that the *customer* authorises work to start. A provider who could fetch
    // this would start any job on any customer's house without the customer being there at all —
    // which is precisely the situation the code exists to prevent.
    //
    // 403, not 404, and the distinction is the point: the policy guard rejects on the caller's role
    // before the service ever looks up the booking, so the response is identical for a real booking
    // and a made-up id. That is asserted below — a 404 here would mean the service had been reached
    // and learned the booking existed first.
    const booking = await bookingFor('CUSTOMER');

    const response = await callApi<{ code: string }>(app, `/bookings/${booking.id}/start-code`, asCustomer(shared.providerAccessToken, { method: 'POST' }));
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('FORBIDDEN');

    const invented = await callApi<{ code: string }>(app, `/bookings/9f3a1c22-0000-4000-8000-000000009999/start-code`, asCustomer(shared.providerAccessToken, { method: 'POST' }));
    expect(invented.status).toBe(response.status);
    expect(invented.body.code).toBe(response.body.code);
  });

  it('refuses a customer who is not this booking’s, hiding that the booking exists', async () => {
    const booking = await bookingFor('CUSTOMER');
    const stranger = await registerAndVerify(app, 'CUSTOMER');

    const response = await callApi<{ code: string }>(app, `/bookings/${booking.id}/start-code`, asCustomer(stranger.accessToken, { method: 'POST' }));
    expect(response.status).toBe(404);
    expect(response.body.code).toBe('NOT_FOUND');
  });

  it('issues a new code each time and invalidates the previous one', async () => {
    // One booking has exactly one current start code. A stale code failing is therefore correct
    // behaviour, not a bug — but it is the footgun of this feature, so it is pinned by a test rather
    // than discovered by a provider standing at a door.
    const booking = await bookingFor('CUSTOMER');
    await departProvider(app, booking.id, asCustomer(shared.providerAccessToken, { method: 'POST' }));

    const first = await callApi<{ code: string }>(app, `/bookings/${booking.id}/start-code`, asCustomer(booking.accessToken, { method: 'POST' }));
    const second = await callApi<{ code: string }>(app, `/bookings/${booking.id}/start-code`, asCustomer(booking.accessToken, { method: 'POST' }));
    expect(second.body.code).not.toBe(first.body.code);

    const stale = await startProvider<{ code: string; detail: string }>(app, booking.id, asCustomer(shared.providerAccessToken, postJson({ code: first.body.code })));
    expect(stale.status).toBe(422);
    expect(stale.body.code).toBe('OTP_INVALID');

    // ...and the current one still works, so a refresh is recoverable rather than fatal.
    const fresh = await startProvider<{ status: string }>(app, booking.id, asCustomer(shared.providerAccessToken, postJson({ code: second.body.code })));
    expect(fresh.status).toBe(200);
  });

  it('refuses once the job has started, when there is nothing left to authorise', async () => {
    const booking = await bookingFor('CUSTOMER');
    await departProvider(app, booking.id, asCustomer(shared.providerAccessToken, { method: 'POST' }));
    const shown = await callApi<{ code: string }>(app, `/bookings/${booking.id}/start-code`, asCustomer(booking.accessToken, { method: 'POST' }));
    await startProvider(app, booking.id, asCustomer(shared.providerAccessToken, postJson({ code: shown.body.code })));

    const response = await callApi<{ code: string; detail: string }>(app, `/bookings/${booking.id}/start-code`, asCustomer(booking.accessToken, { method: 'POST' }));
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('CONFLICT');
    expect(response.body.detail).toContain('already been started');
  });
});
