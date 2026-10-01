// apps/api/test/integration/booking-revisions.test.ts
//
// SHM-042: revised quotes and their top-up payments, and the inspection-first special case.
// Its own file for the same reason as the other booking-* splits: a fresh app instance per
// file means a fresh in-memory rate limiter.
import { createHmac, randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { EnvironmentService } from '../../src/config/environment.service.js';
import { callApi, createTestApp, postJson, readOtpFromInbox, readyBookableProvider, registerAndVerify, type TestUser } from './harness.js';

const prisma = new PrismaClient();

let app: NestExpressApplication;
let close: () => Promise<void>;
let secret: string;

beforeAll(async () => {
  const started = await createTestApp();
  app = started.app;
  close = started.close;
  secret = app.get(EnvironmentService).values.MOCK_PAYMENT_WEBHOOK_SECRET;
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

const JPEG = Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex').toString('base64');

const capture = async (paymentId: string): Promise<void> => {
  const body = JSON.stringify({ eventId: `evt_${randomUUID()}`, paymentId, type: 'payment.captured', occurredAt: new Date().toISOString(), payload: {} });
  const timestamp = Date.now();
  await callApi(app, '/webhooks/payments/mock', { method: 'POST', body, headers: { 'x-mock-timestamp': String(timestamp), 'x-mock-signature': createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex') } });
};

type Checklist = { id: number; requiresPhoto: boolean }[];
type Booking = { id: string; status: string; finalAmountPaisa: number | null; approvedTotalPaisa: number; paymentStatus: string };

describe('SHM-042: revised quotes and top-up', () => {
  let shared: { providerId: string; providerAccessToken: string; serviceId: number; areaId: number };
  let checklist: Checklist;
  let nextSlotOffsetHours = 720;

  beforeAll(async () => {
    const { provider, serviceId, areaId } = await readyBookableProvider(app);
    shared = { providerId: provider.id, providerAccessToken: provider.accessToken, serviceId, areaId };
    checklist = (await callApi<{ checklist: Checklist }>(app, '/catalogue/services/leak-repair')).body.checklist;
  });

  const asProvider = (init: RequestInit = {}): RequestInit => bearer(shared.providerAccessToken, init);

  type Job = { id: string; customer: TestUser; customerPhone: string };

  const inProgressBooking = async (mode: 'CASH' | 'ONLINE' = 'CASH', start?: { lat: number; lng: number }): Promise<Job> => {
    const customer = await registerAndVerify(app, 'CUSTOMER');
    const address = await callApi<{ id: string }>(app, '/customer/addresses', bearer(customer.accessToken, postJson({ label: 'Home', line1: 'House 1', areaId: shared.areaId, lat: 31.52, lng: 74.35, isDefault: true })));
    const slot = slotAt(nextSlotOffsetHours);
    nextSlotOffsetHours += 24;
    const created = await callApi<{ id: string; payment?: { paymentId: string } }>(
      app,
      '/bookings',
      bearer(customer.accessToken, postJson({ providerId: shared.providerId, serviceId: shared.serviceId, addressId: address.body.id, paymentMode: mode, ...slot }))
    );
    const id = created.body.id;
    if (created.body.payment !== undefined) await capture(created.body.payment.paymentId);
    await callApi(app, `/bookings/${id}/accept`, asProvider({ method: 'POST' }));
    await callApi(app, `/bookings/${id}/depart`, asProvider({ method: 'POST' }));
    const code = await readOtpFromInbox(app, customer.phoneE164);
    const started = await callApi(app, `/bookings/${id}/start`, asProvider(postJson({ code, ...(start ?? {}) })));
    expect(started.status).toBe(200);
    return { id, customer, customerPhone: customer.phoneE164 };
  };

  const upload = (bookingId: string, body: Record<string, unknown>, as: 'provider' | TestUser = 'provider') =>
    callApi<{ id: string; duplicate: boolean; code?: string; receivedAt: string }>(
      app,
      `/bookings/${bookingId}/evidence`,
      as === 'provider' ? asProvider(postJson({ contentType: 'image/jpeg', contentBase64: JPEG, ...body })) : bearer(as.accessToken, postJson({ contentType: 'image/jpeg', contentBase64: JPEG, ...body }))
    );

  /** Every step done — photographing the ones that need it — plus before/after photos: a job that may legitimately be completed. */
  const finishWork = async (bookingId: string): Promise<void> => {
    await upload(bookingId, { clientUuid: randomUUID(), kind: 'BEFORE' });
    for (const item of checklist) {
      let evidenceId: string | undefined;
      if (item.requiresPhoto) evidenceId = (await upload(bookingId, { clientUuid: randomUUID(), kind: 'CHECKLIST', checklistItemId: item.id })).body.id;
      const marked = await callApi(app, `/bookings/${bookingId}/checklist/${item.id}`, asProvider(postJson({ done: true, ...(evidenceId === undefined ? {} : { evidenceId }) })));
      expect(marked.status).toBe(200);
    }
    await upload(bookingId, { clientUuid: randomUUID(), kind: 'AFTER' });
  };

  const complete = (bookingId: string, body: Record<string, unknown> = {}) => callApi<Booking & { code?: string; invoice?: { number: string; totalPaisa: number } }>(app, `/bookings/${bookingId}/complete`, asProvider(postJson(body)));

  describe('FR-EX-05 / FR-EX-04 / FR-PY-12: revised quotes and top-up', () => {
    it('a cash job: an approved revision raises the total and lands on the invoice as an extra line', async () => {
      const { id, customer } = await inProgressBooking('CASH');
      const before = (await callApi<Booking>(app, `/bookings/${id}`, bearer(customer.accessToken))).body.approvedTotalPaisa;
      await callApi(app, `/bookings/${id}/revisions`, asProvider(postJson({ deltaPaisa: 500_000, reason: 'Extra pipe' })));
      const approved = await callApi<Booking>(app, `/bookings/${id}/revisions/approve`, bearer(customer.accessToken, { method: 'POST' }));
      expect(approved.body.status).toBe('IN_PROGRESS');
      expect(approved.body.approvedTotalPaisa).toBe(before + 500_000);
      await finishWork(id);
      const completed = await complete(id);
      expect(completed.body.finalAmountPaisa).toBe(before + 500_000);
    });

    it('an online job: approval waits for the top-up to be paid, and the payment approves it', async () => {
      const { id, customer } = await inProgressBooking('ONLINE');
      const before = (await callApi<Booking>(app, `/bookings/${id}`, bearer(customer.accessToken))).body.approvedTotalPaisa;
      await callApi(app, `/bookings/${id}/revisions`, asProvider(postJson({ deltaPaisa: 300_000, reason: 'Replace valve' })));

      const approving = await callApi<Booking & { payment: { paymentId: string; redirectUrl: string } }>(app, `/bookings/${id}/revisions/approve`, bearer(customer.accessToken, { method: 'POST' }));
      expect(approving.status).toBe(200);
      expect(approving.body.status).toBe('QUOTE_REVISION');
      expect(approving.body.approvedTotalPaisa).toBe(before);
      expect(approving.body.payment.redirectUrl).toContain('/dev/payments/');

      // The provider cannot resume work while the top-up is unpaid.
      const blocked = await callApi(app, `/bookings/${id}/complete`, asProvider(postJson({})));
      expect(blocked.status).toBe(409);

      // Asking again reuses the same pending top-up rather than creating a second.
      const again = await callApi<{ payment: { paymentId: string } }>(app, `/bookings/${id}/revisions/approve`, bearer(customer.accessToken, { method: 'POST' }));
      expect(again.body.payment.paymentId).toBe(approving.body.payment.paymentId);

      await capture(approving.body.payment.paymentId);
      const after = await callApi<Booking>(app, `/bookings/${id}`, bearer(customer.accessToken));
      expect(after.body.status).toBe('IN_PROGRESS');
      expect(after.body.approvedTotalPaisa).toBe(before + 300_000);

      const escrow = await prisma.$queryRaw<{ balance: bigint }[]>(
        Prisma.sql`SELECT b.balance::bigint as balance FROM ledger_accounts a JOIN account_balances b ON b.account_id = a.id WHERE a.type = 'ESCROW' AND a.booking_id = ${id}::uuid`
      );
      expect(escrow[0]?.balance).toBe(BigInt(before + 300_000));
    });

    it('an online top-up that is never paid cannot approve the revision; the customer can still reject it', async () => {
      const { id, customer } = await inProgressBooking('ONLINE');
      await callApi(app, `/bookings/${id}/revisions`, asProvider(postJson({ deltaPaisa: 100_000, reason: 'Extra' })));
      await callApi(app, `/bookings/${id}/revisions/approve`, bearer(customer.accessToken, { method: 'POST' }));
      const rejected = await callApi<Booking>(app, `/bookings/${id}/revisions/reject`, bearer(customer.accessToken, { method: 'POST' }));
      expect(rejected.body.status).toBe('IN_PROGRESS');
      const payments = await prisma.$queryRaw<{ status: string }[]>(Prisma.sql`SELECT status::text FROM payments WHERE booking_id = ${id}::uuid AND purpose = 'TOPUP'`);
      expect(payments.map(row => row.status)).toEqual(['EXPIRED']);
    });
  });
});

describe('FR-EX-11: an inspection-first job whose extra work is rejected', () => {
  it('completes for the visit fee only, straight into verification, skipping the checklist', async () => {
    const { provider, serviceId, areaId } = await readyBookableProvider(app, undefined, 'waterproofing-treatment');
    const customer = await registerAndVerify(app, 'CUSTOMER');
    const address = await callApi<{ id: string }>(app, '/customer/addresses', bearer(customer.accessToken, postJson({ label: 'Home', line1: 'House 1', areaId, lat: 31.52, lng: 74.35, isDefault: true })));
    const slot = slotAt(3_000);
    const created = await callApi<{ id: string; quotedAmountPaisa: number }>(app, '/bookings', bearer(customer.accessToken, postJson({ providerId: provider.id, serviceId, addressId: address.body.id, ...slot })));
    expect(created.status).toBe(201);
    const id = created.body.id;
    const visitFee = (await prisma.$queryRaw<{ fee: bigint }[]>(Prisma.sql`SELECT visit_fee_paisa as fee FROM services WHERE id = ${serviceId}`))[0]!.fee;
    expect(BigInt(created.body.quotedAmountPaisa)).toBe(visitFee);

    await callApi(app, `/bookings/${id}/accept`, bearer(provider.accessToken, { method: 'POST' }));
    await callApi(app, `/bookings/${id}/depart`, bearer(provider.accessToken, { method: 'POST' }));
    const code = await readOtpFromInbox(app, customer.phoneE164);
    await callApi(app, `/bookings/${id}/start`, bearer(provider.accessToken, postJson({ code })));
    await callApi(app, `/bookings/${id}/revisions`, bearer(provider.accessToken, postJson({ deltaPaisa: 2_000_000, reason: 'Full membrane treatment needed' })));

    const rejected = await callApi<Booking>(app, `/bookings/${id}/revisions/reject`, bearer(customer.accessToken, { method: 'POST' }));
    expect(rejected.status).toBe(200);
    expect(rejected.body.status).toBe('AWAITING_VERIFICATION');
    expect(BigInt(rejected.body.finalAmountPaisa ?? -1)).toBe(visitFee);

    const invoice = await prisma.$queryRaw<{ total: bigint }[]>(Prisma.sql`SELECT total_paisa as total FROM invoices WHERE booking_id = ${id}::uuid`);
    expect(invoice[0]?.total).toBe(visitFee);
    const queued = await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*)::bigint as n FROM verification_calls WHERE booking_id = ${id}::uuid`);
    expect(queued[0]?.n).toBe(1n);
  });
});
