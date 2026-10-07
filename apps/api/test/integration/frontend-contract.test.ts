// apps/api/test/integration/frontend-contract.test.ts
//
// The gaps the web app reported against the live API, pinned so they cannot
// silently reopen. One file because these are small and independent of each
// other; its own app instance means its own in-memory rate limiter.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { BOOKING_STATUS_VALUES } from '@smart-home/domain';
import { callApi, createTestApp, postJson, readOtpFromInbox, readyBookableProvider, refreshCookieOf, registerAndVerify, uniquePhone, type TestUser } from './harness.js';

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

const slotAt = (hoursFromNow: number): { scheduledStart: string; scheduledEnd: string } => {
  const start = new Date(Date.now() + hoursFromNow * 60 * 60 * 1000);
  return { scheduledStart: start.toISOString(), scheduledEnd: new Date(start.getTime() + 60 * 60 * 1000).toISOString() };
};

describe('identity: an OTP sent to an email address actually goes by email', () => {
  it('sends to an email address over the email channel, not the SMS one', async () => {
    const target = `otp-${randomUUID()}@smart-home.local`;
    const requested = await callApi<{ sent: boolean; purpose: string }>(app, '/auth/otp/request', postJson({ target, purpose: 'REGISTER' }));
    // Used to be a 500: the branch tested `startsWith('@')`, which is never true
    // for a real address, so every email fell into the SMS sender and was
    // refused as a malformed E.164 recipient.
    expect(requested.status).toBe(202);
    expect(requested.body.sent).toBe(true);

    const inbox = await callApi<{ items: { recipient: string; channel: string; body: string }[] }>(app, '/dev/inbox?limit=10');
    const message = inbox.body.items.find((item) => item.recipient === target);
    expect(message?.channel).toBe('EMAIL');
    expect(message?.body).toMatch(/\b\d{6}\b/);
  });

  it('sends to a phone number over the SMS channel, unchanged', async () => {
    const target = uniquePhone();
    const requested = await callApi<{ sent: boolean }>(app, '/auth/otp/request', postJson({ target, purpose: 'REGISTER' }));
    expect(requested.status).toBe(202);

    const inbox = await callApi<{ items: { recipient: string; channel: string }[] }>(app, '/dev/inbox?limit=10');
    expect(inbox.body.items.find((item) => item.recipient === target)?.channel).toBe('SMS');
  });

  it('a password reset for a real account is delivered', async () => {
    const phone = uniquePhone();
    await callApi(app, '/auth/register', postJson({ role: 'CUSTOMER', phoneE164: phone, password: 'CorrectHorse9Battery', firstName: 'Ayesha', lastName: 'Khan' }));

    expect((await callApi(app, '/auth/password/forgot', postJson({ identifier: phone }))).status).toBe(202);
    const code = await readOtpFromInbox(app, phone);
    const reset = await callApi<{ code?: string }>(app, '/auth/password/reset', postJson({ identifier: phone, code, newPassword: 'BrandNewPass9' }));
    expect(reset.status).toBe(201);
  });
});

describe('identity: /auth/me publishes the provider approval status it promises', () => {
  it('reports PENDING_APPROVAL, not null, for a provider who has not been approved', async () => {
    const provider = await registerAndVerify(app, 'PROVIDER');
    const me = await callApi<{ user: { providerStatus: string | null; roles: string[] } }>(app, '/auth/me', bearer(provider.accessToken));
    expect(me.status).toBe(200);
    expect(me.body.user.roles).toContain('PROVIDER');
    expect(me.body.user.providerStatus).toBe('PENDING_APPROVAL');
  });

  it('is null for a customer, who has no provider row', async () => {
    const customer = await registerAndVerify(app, 'CUSTOMER');
    const me = await callApi<{ user: { providerStatus: string | null } }>(app, '/auth/me', bearer(customer.accessToken));
    expect(me.body.user.providerStatus).toBeNull();
  });
});

describe('identity: the login throttle covers identifiers that do not exist', () => {
  it('locks an unknown identifier after the configured failures, not only a real one', async () => {
    const identifier = `ghost-${randomUUID()}@smart-home.local`;
    // Every one of these used to return straight away: the counter was asserted
    // and incremented only after the user lookup found somebody.
    const attempts: number[] = [];
    for (let attempt = 0; attempt < 8; attempt += 1) {
      attempts.push((await callApi<{ code?: string }>(app, '/auth/login', postJson({ identifier, password: `Wrong${attempt}Pass9` }))).status);
    }
    expect(attempts.filter((status) => status === 429).length).toBeGreaterThan(0);
    // …and it is still the generic message, so probing reveals nothing.
    const locked = await callApi<{ detail: string }>(app, '/auth/login', postJson({ identifier, password: 'WrongAgain9' }));
    expect(locked.status).toBe(429);
  });
});

describe('identity: GET /auth/session answers "am I signed in" without failing', () => {
  it('says no for an anonymous caller, with a 200 rather than a 401', async () => {
    const response = await callApi<{ authenticated: boolean; user: unknown }>(app, '/auth/session');
    expect(response.status).toBe(200);
    expect(response.body.authenticated).toBe(false);
    expect(response.body.user).toBeNull();
  });

  it('says yes from the refresh cookie alone, which is all a reload leaves behind', async () => {
    const customer = await registerAndVerify(app, 'CUSTOMER');
    const cookie = customer.refreshCookie as string;

    const response = await callApi<{ authenticated: boolean; user: { id: string; roles: string[] } | null }>(app, '/auth/session', { headers: { cookie } });
    expect(response.status).toBe(200);
    expect(response.body.authenticated).toBe(true);
    expect(response.body.user?.id).toBe(customer.id);
  });

  it('does not consume the cookie: the token still refreshes afterwards', async () => {
    const customer = await registerAndVerify(app, 'CUSTOMER');
    const cookie = customer.refreshCookie as string;

    await callApi(app, '/auth/session', { headers: { cookie } });
    const refreshed = await callApi<{ user: { id: string } }>(app, '/auth/refresh', { method: 'POST', headers: { cookie } });
    // If this read had rotated the token, the real refresh would answer 401
    // REFRESH_REUSE_DETECTED and sign the session out.
    expect(refreshed.status).toBe(201);
    expect(refreshed.body.user.id).toBe(customer.id);
  });

  it('says no for a signed-out session, without disclosing why', async () => {
    await callApi(app, '/auth/refresh', { method: 'POST', headers: { cookie: 'shm_rt=' + 'x'.repeat(43) } });
    const response = await callApi<{ authenticated: boolean }>(app, '/auth/session', { headers: { cookie: 'shm_rt=' + 'x'.repeat(43) } });
    expect(response.status).toBe(200);
    expect(response.body.authenticated).toBe(false);
  });
});

describe('identity: refresh and logout accept the token in the body for clients that cannot hold a cookie', () => {
  it('refreshes from a body token, and still sets the cookie for a browser', async () => {
    const customer = await registerAndVerify(app, 'CUSTOMER');
    const token = decodeURIComponent((customer.refreshCookie as string).split('=')[1] as string);

    const response = await callApi<{ user: { id: string } }>(app, '/auth/refresh', postJson({ refreshToken: token }));
    expect(response.status).toBe(201);
    expect(response.body.user.id).toBe(customer.id);
    expect(refreshCookieOf(response)).toBeDefined();
  });

  it('logs out from a body token', async () => {
    const customer = await registerAndVerify(app, 'CUSTOMER');
    const token = decodeURIComponent((customer.refreshCookie as string).split('=')[1] as string);

    expect((await callApi(app, '/auth/logout', postJson({ refreshToken: token }))).status).toBe(204);
    expect((await callApi<{ code: string }>(app, '/auth/refresh', postJson({ refreshToken: token }))).status).toBe(401);
  });

  it('still accepts a browser refresh that sends no body at all', async () => {
    const customer = await registerAndVerify(app, 'CUSTOMER');
    const response = await callApi<{ user: { id: string } }>(app, '/auth/refresh', { method: 'POST', headers: { cookie: customer.refreshCookie as string } });
    expect(response.status).toBe(201);
    expect(response.body.user.id).toBe(customer.id);
  });
});

describe('booking: the status filter accepts every status the database knows', () => {
  it('does not 422 on a status outside the old hand-written list of ten', async () => {
    const customer = await registerAndVerify(app, 'CUSTOMER');
    // VERIFIED is a real `booking_status` and `GET /bookings/{id}` returns one,
    // but the filter used to enumerate only ten of the twenty-two, so asking for
    // this was a 422 VALIDATION_FAILED.
    for (const status of ['VERIFIED', 'REFUNDED', 'AWAITING_VERIFICATION', 'PAYMENT_RELEASED', 'CLOSED', 'ABANDONED', 'ACCEPTED'] as const) {
      expect(BOOKING_STATUS_VALUES).toContain(status);
      const response = await callApi<{ code?: string }>(app, `/bookings?status=${status}`, bearer(customer.accessToken));
      expect(response.status, `status=${status}`).toBe(200);
    }
  });

  it('covers exactly the database enum, so the filter cannot fall behind it again', () => {
    // Every value the migration declares, in order. If a value is added to the
    // database this list has to change with it, or `?status=` silently 422s.
    expect([...BOOKING_STATUS_VALUES]).toEqual([
      'PENDING_PAYMENT',
      'ABANDONED',
      'REQUESTED',
      'UNFULFILLED',
      'ACCEPTED',
      'SCHEDULED',
      'EN_ROUTE',
      'IN_PROGRESS',
      'QUOTE_REVISION',
      'WORK_COMPLETED',
      'AWAITING_VERIFICATION',
      'REWORK_REQUIRED',
      'VERIFIED',
      'AUTO_RELEASED',
      'DISPUTED',
      'PAYMENT_RELEASED',
      'PARTIALLY_REFUNDED',
      'REFUNDED',
      'CANCELLED_CUSTOMER',
      'CANCELLED_PROVIDER',
      'NO_SHOW',
      'CLOSED'
    ]);
  });

  it('still refuses a status that is not a status at all', async () => {
    const customer = await registerAndVerify(app, 'CUSTOMER');
    expect((await callApi<{ code: string }>(app, '/bookings?status=NOT_A_STATUS', bearer(customer.accessToken))).status).toBe(422);
  });
});

describe('booking: a booking publishes the names behind its ids, its line items and its cancellation rule', () => {
  let shared: { providerId: string; providerAccessToken: string; serviceId: number; areaId: number };
  let nextSlotOffsetHours = 960;

  beforeAll(async () => {
    const { provider, serviceId, areaId } = await readyBookableProvider(app);
    shared = { providerId: provider.id, providerAccessToken: provider.accessToken, serviceId, areaId };
  });

  const created = async (): Promise<{ id: string; customer: TestUser }> => {
    const customer = await registerAndVerify(app, 'CUSTOMER');
    const address = await callApi<{ id: string }>(
      app,
      '/customer/addresses',
      bearer(customer.accessToken, postJson({ label: 'Home', line1: 'House 1, Street 2', areaId: shared.areaId, lat: 31.52, lng: 74.35, isDefault: true }))
    );
    const slot = slotAt(nextSlotOffsetHours);
    nextSlotOffsetHours += 24;
    const response = await callApi<{ id: string }>(
      app,
      '/bookings',
      bearer(customer.accessToken, postJson({ providerId: shared.providerId, serviceId: shared.serviceId, addressId: address.body.id, ...slot }))
    );
    expect(response.status).toBe(201);
    return { id: response.body.id, customer };
  };

  it('carries the service name and the address on the detail row', async () => {
    const { id, customer } = await created();
    const detail = await callApi<Record<string, unknown>>(app, `/bookings/${id}`, bearer(customer.accessToken));
    expect(detail.status).toBe(200);
    // Every one of these was a bare id or absent, so a booking list could only
    // show a serviceId and the detail page could show no address at all.
    expect(detail.body.serviceName).toBe('Leak Repair');
    expect(detail.body.serviceSlug).toBe('leak-repair');
    expect(typeof detail.body.serviceNameUr).toBe('string');
    expect(detail.body.addressLine1).toBe('House 1, Street 2');
    expect(detail.body.areaName).toBe('Gulberg');
  });

  it('carries the same names on the list rows, so no catalogue fan-out is needed', async () => {
    const { customer } = await created();
    const list = await callApi<{ items: Record<string, unknown>[] }>(app, '/bookings', bearer(customer.accessToken));
    expect(list.status).toBe(200);
    expect(list.body.items.length).toBeGreaterThan(0);
    for (const item of list.body.items) expect(item.serviceName).toBe('Leak Repair');
  });

  it('returns the line items it was priced for', async () => {
    const { id, customer } = await created();
    const detail = await callApi<{ items: { kind: string; amountPaisa: number }[] }>(app, `/bookings/${id}`, bearer(customer.accessToken));
    expect(detail.body.items.length).toBeGreaterThan(0);
    expect(detail.body.items[0]?.kind).toBe('SERVICE');
    // The rows existed all along (create() writes them from the quote); no route
    // read them back, so the four totals had no explanation on screen.
    expect(detail.body.items[0]?.amountPaisa).toBeGreaterThan(0);
  });

  it('states the cancellation rule for this booking, and agrees with what cancelling charges', async () => {
    const { id, customer } = await created();
    const detail = await callApi<{ cancellationPolicy: string; cancellation: { freeCancelHours: number; lateCancelFeePaisa: number; isLate: boolean; feeDuePaisa: number } }>(
      app,
      `/bookings/${id}`,
      bearer(customer.accessToken)
    );
    expect(detail.body.cancellationPolicy).toMatch(/free cancellation/i);
    expect(detail.body.cancellation.freeCancelHours).toBeGreaterThan(0);
    expect(detail.body.cancellation.lateCancelFeePaisa).toBeGreaterThan(0);
    // Scheduled far in the future and not yet accepted: cancelling is free, and
    // the published figure says so rather than quoting a fee that is not charged.
    expect(detail.body.cancellation.isLate).toBe(false);
    expect(detail.body.cancellation.feeDuePaisa).toBe(0);
  });
});

describe('booking: a provider can find the address they are travelling to', () => {
  let shared: { providerId: string; providerAccessToken: string; serviceId: number; areaId: number };
  let nextSlotOffsetHours = 1200;

  beforeAll(async () => {
    const { provider, serviceId, areaId } = await readyBookableProvider(app);
    shared = { providerId: provider.id, providerAccessToken: provider.accessToken, serviceId, areaId };
  });

  const booked = async (): Promise<{ id: string; customer: TestUser; otherCustomer: TestUser }> => {
    const customer = await registerAndVerify(app, 'CUSTOMER');
    const address = await callApi<{ id: string }>(
      app,
      '/customer/addresses',
      bearer(customer.accessToken, postJson({ label: 'Office', line1: 'Flat 9, Canal Road', areaId: shared.areaId, lat: 31.53, lng: 74.36, isDefault: true }))
    );
    const slot = slotAt(nextSlotOffsetHours);
    nextSlotOffsetHours += 24;
    const response = await callApi<{ id: string }>(
      app,
      '/bookings',
      bearer(customer.accessToken, postJson({ providerId: shared.providerId, serviceId: shared.serviceId, addressId: address.body.id, ...slot }))
    );
    return { id: response.body.id, customer, otherCustomer: await registerAndVerify(app, 'CUSTOMER') };
  };

  it('is refused while the booking is still REQUESTED, before the provider commits', async () => {
    const { id } = await booked();
    const response = await callApi<{ code: string }>(app, `/bookings/${id}/service-address`, bearer(shared.providerAccessToken));
    // The offer list is provider-facing, so an address available before accept
    // would let a provider harvest addresses for jobs they may still decline.
    expect(response.status).toBe(404);
  });

  it('is revealed to the assigned provider once they have accepted', async () => {
    const { id } = await booked();
    await callApi(app, `/bookings/${id}/accept`, bearer(shared.providerAccessToken, { method: 'POST' }));

    const response = await callApi<{ label: string; line1: string; areaName: string; lat: number; lng: number; revealed: boolean }>(
      app,
      `/bookings/${id}/service-address`,
      bearer(shared.providerAccessToken)
    );
    expect(response.status).toBe(200);
    expect(response.body.line1).toBe('Flat 9, Canal Road');
    expect(response.body.areaName).toBe('Gulberg');
    expect(response.body.revealed).toBe(true);
    // Coordinates are what POST /bookings/{id}/start measures the check-in
    // against, so an address without them is not usable.
    expect(response.body.lat).toBeCloseTo(31.53, 3);
    expect(response.body.lng).toBeCloseTo(74.36, 3);
  });

  it('is still refused to a provider the booking was not requested from', async () => {
    const { id } = await booked();
    await callApi(app, `/bookings/${id}/accept`, bearer(shared.providerAccessToken, { method: 'POST' }));
    const other = await registerAndVerify(app, 'PROVIDER');
    expect((await callApi<{ code: string }>(app, `/bookings/${id}/service-address`, bearer(other.accessToken))).status).toBe(404);
  });

  it('is refused to a customer who is not this booking’s own', async () => {
    const { id, otherCustomer } = await booked();
    await callApi(app, `/bookings/${id}/accept`, bearer(shared.providerAccessToken, { method: 'POST' }));
    expect((await callApi<{ code: string }>(app, `/bookings/${id}/service-address`, bearer(otherCustomer.accessToken))).status).toBe(404);
  });

  it('is available to the customer who booked it', async () => {
    const { id, customer } = await booked();
    const response = await callApi<{ line1: string }>(app, `/bookings/${id}/service-address`, bearer(customer.accessToken));
    expect(response.status).toBe(200);
    expect(response.body.line1).toBe('Flat 9, Canal Road');
  });
});

describe('booking: a checklist is readable, so itemId is discoverable and the 409 is actionable', () => {
  let shared: { providerId: string; providerAccessToken: string; serviceId: number; areaId: number };
  let nextSlotOffsetHours = 1440;

  beforeAll(async () => {
    const { provider, serviceId, areaId } = await readyBookableProvider(app);
    shared = { providerId: provider.id, providerAccessToken: provider.accessToken, serviceId, areaId };
  });

  const inProgress = async (): Promise<{ id: string; customer: TestUser; checklist: { id: number; requiresPhoto: boolean }[] }> => {
    const customer = await registerAndVerify(app, 'CUSTOMER');
    const address = await callApi<{ id: string }>(
      app,
      '/customer/addresses',
      bearer(customer.accessToken, postJson({ label: 'Home', line1: 'House 1', areaId: shared.areaId, lat: 31.52, lng: 74.35, isDefault: true }))
    );
    const slot = slotAt(nextSlotOffsetHours);
    nextSlotOffsetHours += 24;
    const created = await callApi<{ id: string }>(
      app,
      '/bookings',
      bearer(customer.accessToken, postJson({ providerId: shared.providerId, serviceId: shared.serviceId, addressId: address.body.id, ...slot }))
    );
    await callApi(app, `/bookings/${created.body.id}/accept`, bearer(shared.providerAccessToken, { method: 'POST' }));
    await callApi(app, `/bookings/${created.body.id}/depart`, bearer(shared.providerAccessToken, { method: 'POST' }));
    const code = await readOtpFromInbox(app, customer.phoneE164);
    await callApi(app, `/bookings/${created.body.id}/start`, bearer(shared.providerAccessToken, postJson({ code })));
    const checklist = (await callApi<{ checklist: { id: number; requiresPhoto: boolean }[] }>(app, '/catalogue/services/leak-repair')).body.checklist;
    return { id: created.body.id, customer, checklist };
  };

  it('lists the steps with the integer itemId the POST route expects, in both languages', async () => {
    const { id } = await inProgress();
    const response = await callApi<{ items: { itemId: number; position: number; labelEn: string; labelUr: string; requiresPhoto: boolean; done: boolean }[]; outstanding: number }>(
      app,
      `/bookings/${id}/checklist`,
      bearer(shared.providerAccessToken)
    );
    expect(response.status).toBe(200);
    expect(response.body.items.length).toBeGreaterThan(0);
    for (const item of response.body.items) {
      expect(Number.isInteger(item.itemId)).toBe(true);
      expect(item.labelEn.length).toBeGreaterThan(0);
      expect(item.labelUr.length).toBeGreaterThan(0);
    }
    // Positions are what the screen orders by, and every step starts undone.
    expect(response.body.items.map((item) => item.position)).toEqual(response.body.items.map((_item, index) => index + 1));
    expect(response.body.outstanding).toBe(response.body.items.length);
  });

  it('reflects a step marked done, and counts down the outstanding total', async () => {
    const { id, checklist } = await inProgress();
    const plain = checklist.find((item) => !item.requiresPhoto)!;
    await callApi(app, `/bookings/${id}/checklist/${plain.id}`, bearer(shared.providerAccessToken, postJson({ done: true })));

    const response = await callApi<{ items: { itemId: number; done: boolean; doneAt: string | null }[]; outstanding: number }>(app, `/bookings/${id}/checklist`, bearer(shared.providerAccessToken));
    const marked = response.body.items.find((item) => item.itemId === plain.id)!;
    expect(marked.done).toBe(true);
    expect(marked.doneAt).not.toBeNull();
    expect(response.body.outstanding).toBe(response.body.items.length - 1);
  });

  it('is readable by the customer too', async () => {
    const { id, customer } = await inProgress();
    expect((await callApi(app, `/bookings/${id}/checklist`, bearer(customer.accessToken))).status).toBe(200);
  });

  it('is 404 for somebody who is neither party', async () => {
    const { id } = await inProgress();
    const stranger = await registerAndVerify(app, 'CUSTOMER');
    expect((await callApi<{ code: string }>(app, `/bookings/${id}/checklist`, bearer(stranger.accessToken))).status).toBe(404);
  });
});

describe('development: the mock storage honours the PUT URL it hands out', () => {
  it('stores what is PUT to the presigned URL and serves it back from the GET', async () => {
    const key = `presign-test-${randomUUID()}`;
    const bytes = Buffer.from('pretend these are a photo', 'utf8');

    const uploaded = await callApi<{ key: string; sizeBytes: number }>(app, `/dev/storage/evidence/${encodeURIComponent(key)}?contentType=image%2Fjpeg&maxBytes=1024`, {
      method: 'PUT',
      body: bytes.toString('binary'),
      headers: { 'content-type': 'image/jpeg' }
    });
    // Before this route existed, presignPut handed the browser a URL for a verb
    // nothing routed, so every presigned upload was a guaranteed 404.
    expect(uploaded.status).toBe(200);
    expect(uploaded.body.sizeBytes).toBe(bytes.byteLength);

    const fetched = await callApi<{ contentBase64: string; contentType: string }>(app, `/dev/storage/evidence/${encodeURIComponent(key)}`);
    expect(fetched.status).toBe(200);
    expect(Buffer.from(fetched.body.contentBase64, 'base64').toString('utf8')).toBe('pretend these are a photo');
    expect(fetched.body.contentType).toBe('image/jpeg');
  });

  it('refuses an upload larger than the presigned policy allows', async () => {
    const key = `presign-oversize-${randomUUID()}`;
    const response = await callApi<{ code: string }>(app, `/dev/storage/evidence/${encodeURIComponent(key)}?contentType=image%2Fjpeg&maxBytes=4`, {
      method: 'PUT',
      body: Buffer.from('far too many bytes for this policy').toString('binary'),
      headers: { 'content-type': 'image/jpeg' }
    });
    expect(response.status).toBe(400);
  });
});

describe('identity: the throttle does not depend on the account existing', () => {
  it('an account whose identifier is a phone number is still throttled the same way', async () => {
    const phone = uniquePhone();
    const attempts: number[] = [];
    for (let attempt = 0; attempt < 8; attempt += 1) {
      attempts.push((await callApi<{ code?: string }>(app, '/auth/login', postJson({ identifier: phone, password: `Wrong${attempt}Pass9` }))).status);
    }
    expect(attempts.filter((status) => status === 401).length).toBeGreaterThan(0);
    expect(attempts.filter((status) => status === 429).length).toBeGreaterThan(0);
  });
});
