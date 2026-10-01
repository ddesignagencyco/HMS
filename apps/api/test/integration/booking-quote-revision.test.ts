// apps/api/test/integration/booking-quote-revision.test.ts
//
// FR-EX-05: raise/approve/reject a revised quote. Its own file for the same
// reason as the other booking-* splits: a fresh app instance per file means
// a fresh in-memory rate limiter, and reaching IN_PROGRESS needs the full
// create -> accept -> depart -> start chain, which isn't cheap.
import { Prisma } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService } from '../../src/database/prisma.service.js';
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

describe('FR-EX-05 / SHM-042: raise, approve and reject a quote revision', () => {
  // One provider for the whole file; offsets stay multiples of 24h so none
  // can cross midnight in Asia/Karachi (see booking-transitions.test.ts).
  let shared: { providerId: string; providerAccessToken: string; serviceId: number; areaId: number };
  let nextSlotOffsetHours = 720;

  beforeAll(async () => {
    const { provider, serviceId, areaId } = await readyBookableProvider(app);
    shared = { providerId: provider.id, providerAccessToken: provider.accessToken, serviceId, areaId };
  });

  /** A fresh customer with a booking taken all the way to IN_PROGRESS. */
  const inProgressBooking = async (): Promise<{ id: string; customerAccessToken: string; quotedAmountPaisa: number }> => {
    const customer = await registerAndVerify(app, 'CUSTOMER');
    const address = await callApi<{ id: string }>(app, '/customer/addresses', asCustomer(customer.accessToken, postJson({ label: 'Home', line1: 'House 1', areaId: shared.areaId, lat: 31.52, lng: 74.35, isDefault: true })));
    const slot = slotAt(nextSlotOffsetHours);
    nextSlotOffsetHours += 24;
    const created = await callApi<{ id: string; quotedAmountPaisa: number }>(app, '/bookings', asCustomer(customer.accessToken, postJson({ providerId: shared.providerId, serviceId: shared.serviceId, addressId: address.body.id, ...slot })));
    await callApi(app, `/bookings/${created.body.id}/accept`, asCustomer(shared.providerAccessToken, { method: 'POST' }));
    await callApi(app, `/bookings/${created.body.id}/depart`, asCustomer(shared.providerAccessToken, { method: 'POST' }));
    const code = await readOtpFromInbox(app, customer.phoneE164);
    await callApi(app, `/bookings/${created.body.id}/start`, asCustomer(shared.providerAccessToken, postJson({ code })));
    return { id: created.body.id, customerAccessToken: customer.accessToken, quotedAmountPaisa: created.body.quotedAmountPaisa };
  };

  it('lets the provider raise a revision, moving IN_PROGRESS to QUOTE_REVISION', async () => {
    const booking = await inProgressBooking();

    const response = await callApi<{ status: string }>(app, `/bookings/${booking.id}/revisions`, asCustomer(shared.providerAccessToken, postJson({ deltaPaisa: 50000, reason: 'Extra pipe section' })));
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('QUOTE_REVISION');

    const prisma = app.get(PrismaService);
    const rows = await prisma.$queryRaw<{ status: string; deltaPaisa: bigint; reason: string }[]>(
      Prisma.sql`SELECT status, delta_paisa as "deltaPaisa", reason FROM quote_revisions WHERE booking_id = ${booking.id}::uuid`
    );
    expect(rows[0]).toEqual({ status: 'PENDING', deltaPaisa: 50000n, reason: 'Extra pipe section' });
  });

  it('lets the customer approve the revision, adding the delta to approved_total_paisa and returning to IN_PROGRESS', async () => {
    const booking = await inProgressBooking();
    await callApi(app, `/bookings/${booking.id}/revisions`, asCustomer(shared.providerAccessToken, postJson({ deltaPaisa: 75000, reason: 'Extra parts' })));

    const response = await callApi<{ status: string; approvedTotalPaisa: number }>(app, `/bookings/${booking.id}/revisions/approve`, asCustomer(booking.customerAccessToken, { method: 'POST' }));
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('IN_PROGRESS');
    expect(response.body.approvedTotalPaisa).toBe(booking.quotedAmountPaisa + 75000);

    const prisma = app.get(PrismaService);
    const items = await prisma.$queryRaw<{ kind: string; amountPaisa: bigint }[]>(
      Prisma.sql`SELECT kind, amount_paisa as "amountPaisa" FROM booking_items WHERE booking_id = ${booking.id}::uuid AND kind = 'EXTRA'::item_kind`
    );
    expect(items[0]).toEqual({ kind: 'EXTRA', amountPaisa: 75000n });
  });

  it('lets the customer reject the revision at no charge, returning to IN_PROGRESS with approved_total_paisa unchanged', async () => {
    const booking = await inProgressBooking();
    await callApi(app, `/bookings/${booking.id}/revisions`, asCustomer(shared.providerAccessToken, postJson({ deltaPaisa: 90000, reason: 'Optional upgrade' })));

    const response = await callApi<{ status: string; approvedTotalPaisa: number }>(app, `/bookings/${booking.id}/revisions/reject`, asCustomer(booking.customerAccessToken, { method: 'POST' }));
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('IN_PROGRESS');
    expect(response.body.approvedTotalPaisa).toBe(booking.quotedAmountPaisa);
  });

  it('rejects raising a revision on a booking that has not reached IN_PROGRESS yet, with 409 ILLEGAL_TRANSITION', async () => {
    const customer = await registerAndVerify(app, 'CUSTOMER');
    const address = await callApi<{ id: string }>(app, '/customer/addresses', asCustomer(customer.accessToken, postJson({ label: 'Home', line1: 'House 1', areaId: shared.areaId, lat: 31.52, lng: 74.35, isDefault: true })));
    const slot = slotAt(nextSlotOffsetHours);
    nextSlotOffsetHours += 24;
    const created = await callApi<{ id: string }>(app, '/bookings', asCustomer(customer.accessToken, postJson({ providerId: shared.providerId, serviceId: shared.serviceId, addressId: address.body.id, ...slot })));
    await callApi(app, `/bookings/${created.body.id}/accept`, asCustomer(shared.providerAccessToken, { method: 'POST' }));

    const response = await callApi<{ code: string }>(app, `/bookings/${created.body.id}/revisions`, asCustomer(shared.providerAccessToken, postJson({ deltaPaisa: 1000, reason: 'Too early' })));
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('ILLEGAL_TRANSITION');
  });

  it('rejects an approve when no revision is pending, with 409 ILLEGAL_TRANSITION', async () => {
    const booking = await inProgressBooking();

    const response = await callApi<{ code: string }>(app, `/bookings/${booking.id}/revisions/approve`, asCustomer(booking.customerAccessToken, { method: 'POST' }));
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('ILLEGAL_TRANSITION');
  });

  it('rejects a raise from a provider this booking was not requested from, hiding whether it exists', async () => {
    const booking = await inProgressBooking();
    const otherProvider = await registerAndVerify(app, 'PROVIDER');

    const response = await callApi<{ code: string }>(app, `/bookings/${booking.id}/revisions`, asCustomer(otherProvider.accessToken, postJson({ deltaPaisa: 1000, reason: 'Not mine' })));
    expect(response.status).toBe(404);
    expect(response.body.code).toBe('NOT_FOUND');
  });

  it('rejects a raise attempted by the customer, never reaching the service layer', async () => {
    const booking = await inProgressBooking();

    const response = await callApi<{ code: string }>(app, `/bookings/${booking.id}/revisions`, asCustomer(booking.customerAccessToken, postJson({ deltaPaisa: 1000, reason: 'Wrong role' })));
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('FORBIDDEN');
  });
});
