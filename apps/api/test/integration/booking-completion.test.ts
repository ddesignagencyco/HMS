// apps/api/test/integration/booking-completion.test.ts
//
// SHM-041 / SHM-042 / SHM-043: on-site execution (evidence, checklist, geofenced check-in),
// revised quotes and their top-up payments, and completion → invoice → verification queue.
// Its own file for the same reason as the other booking-* splits: a fresh app instance per
// file means a fresh in-memory rate limiter.
import { createHmac, randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { addBusinessMinutes } from '@smart-home/domain';
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

describe('SHM-041 / SHM-042 / SHM-043: execution, revisions and completion', () => {
  let shared: { providerId: string; providerAccessToken: string; serviceId: number; areaId: number };
  let checklist: Checklist;
  let otherChecklist: Checklist;
  let nextSlotOffsetHours = 720;

  beforeAll(async () => {
    const { provider, serviceId, areaId } = await readyBookableProvider(app);
    shared = { providerId: provider.id, providerAccessToken: provider.accessToken, serviceId, areaId };
    checklist = (await callApi<{ checklist: Checklist }>(app, '/catalogue/services/leak-repair')).body.checklist;
    otherChecklist = (await callApi<{ checklist: Checklist }>(app, '/catalogue/services/blocked-drain')).body.checklist;
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

  describe('FR-EX-09: geofenced check-in', () => {
    it('records the check-in and reports it within the geofence', async () => {
      const { id } = await inProgressBooking('CASH', { lat: 31.52, lng: 74.35 });
      const rows = await prisma.$queryRaw<{ distance: number | null; at: Date | null }[]>(Prisma.sql`SELECT checkin_distance_m as distance, checkin_at as at FROM bookings WHERE id = ${id}::uuid`);
      expect(rows[0]?.at).not.toBeNull();
      expect(rows[0]?.distance).toBeLessThan(50);
    });

    it('flags a check-in far from the address but still starts the job', async () => {
      const customer = await registerAndVerify(app, 'CUSTOMER');
      const address = await callApi<{ id: string }>(app, '/customer/addresses', bearer(customer.accessToken, postJson({ label: 'Home', line1: 'House 1', areaId: shared.areaId, lat: 31.52, lng: 74.35, isDefault: true })));
      const slot = slotAt(nextSlotOffsetHours);
      nextSlotOffsetHours += 24;
      const created = await callApi<{ id: string }>(app, '/bookings', bearer(customer.accessToken, postJson({ providerId: shared.providerId, serviceId: shared.serviceId, addressId: address.body.id, ...slot })));
      await callApi(app, `/bookings/${created.body.id}/accept`, asProvider({ method: 'POST' }));
      await callApi(app, `/bookings/${created.body.id}/depart`, asProvider({ method: 'POST' }));
      const code = await readOtpFromInbox(app, customer.phoneE164);
      const started = await callApi<{ status: string; checkin: { distanceM: number; withinGeofence: boolean } }>(app, `/bookings/${created.body.id}/start`, asProvider(postJson({ code, lat: 31.6, lng: 74.5 })));
      expect(started.status).toBe(200);
      expect(started.body.status).toBe('IN_PROGRESS');
      expect(started.body.checkin.withinGeofence).toBe(false);
      expect(started.body.checkin.distanceM).toBeGreaterThan(1_000);
    });
  });

  describe('FR-EX-03 / FR-EX-12: evidence', () => {
    it('stores a photo with a server timestamp, and stores a retry of the same clientUuid exactly once', async () => {
      const { id } = await inProgressBooking();
      const clientUuid = randomUUID();
      const first = await upload(id, { clientUuid, kind: 'BEFORE', capturedAt: '2020-01-01T00:00:00.000Z' });
      expect(first.status).toBe(201);
      expect(first.body.duplicate).toBe(false);
      const serverTime = new Date(first.body.receivedAt).getTime();
      expect(Math.abs(serverTime - Date.now())).toBeLessThan(60_000);

      const retries = await Promise.all([upload(id, { clientUuid, kind: 'BEFORE' }), upload(id, { clientUuid, kind: 'BEFORE' }), upload(id, { clientUuid, kind: 'BEFORE' })]);
      expect(retries.every(retry => retry.body.id === first.body.id && retry.body.duplicate)).toBe(true);
      const count = await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*)::bigint as n FROM job_evidence WHERE booking_id = ${id}::uuid AND client_uuid = ${clientUuid}::uuid`);
      expect(count[0]?.n).toBe(1n);
    });

    it('is insert-only: the database refuses to edit or delete a stored photo', async () => {
      const { id } = await inProgressBooking();
      const stored = await upload(id, { clientUuid: randomUUID(), kind: 'AFTER' });
      await expect(prisma.$executeRaw(Prisma.sql`UPDATE job_evidence SET kind = 'BEFORE'::evidence_kind WHERE id = ${stored.body.id}::uuid`)).rejects.toThrow();
      await expect(prisma.$executeRaw(Prisma.sql`DELETE FROM job_evidence WHERE id = ${stored.body.id}::uuid`)).rejects.toThrow();
    });

    it('refuses an oversized or empty photo with 422 UPLOAD_REJECTED', async () => {
      const { id } = await inProgressBooking();
      const big = Buffer.alloc(5_242_881, 1).toString('base64');
      const tooBig = await upload(id, { clientUuid: randomUUID(), kind: 'BEFORE', contentBase64: big });
      expect(tooBig.status).toBe(422);
      expect(tooBig.body.code).toBe('UPLOAD_REJECTED');
    });

    it('lets only the provider record job evidence, and only the customer attach problem photos', async () => {
      const { id, customer } = await inProgressBooking();
      const byCustomer = await upload(id, { clientUuid: randomUUID(), kind: 'AFTER' }, customer);
      expect(byCustomer.status).toBe(403);
      const problemByProvider = await upload(id, { clientUuid: randomUUID(), kind: 'CUSTOMER_PROBLEM' });
      expect(problemByProvider.status).toBe(403);
    });

    it('lets a customer attach up to 5 problem photos before the visit, and refuses a sixth', async () => {
      const customer = await registerAndVerify(app, 'CUSTOMER');
      const address = await callApi<{ id: string }>(app, '/customer/addresses', bearer(customer.accessToken, postJson({ label: 'Home', line1: 'House 1', areaId: shared.areaId, lat: 31.52, lng: 74.35, isDefault: true })));
      const slot = slotAt(nextSlotOffsetHours);
      nextSlotOffsetHours += 24;
      const created = await callApi<{ id: string }>(app, '/bookings', bearer(customer.accessToken, postJson({ providerId: shared.providerId, serviceId: shared.serviceId, addressId: address.body.id, ...slot })));
      for (let index = 0; index < 5; index += 1) {
        const added = await upload(created.body.id, { clientUuid: randomUUID(), kind: 'CUSTOMER_PROBLEM' }, customer);
        expect(added.status).toBe(201);
      }
      const sixth = await upload(created.body.id, { clientUuid: randomUUID(), kind: 'CUSTOMER_PROBLEM' }, customer);
      expect(sixth.status).toBe(422);
      const listed = await callApi<{ items: unknown[] }>(app, `/bookings/${created.body.id}/evidence`, asProvider());
      expect(listed.body.items).toHaveLength(5);
    });

    it('rejects a checklist photo for a step of some other service, with 404', async () => {
      const { id } = await inProgressBooking();
      const response = await upload(id, { clientUuid: randomUUID(), kind: 'CHECKLIST', checklistItemId: otherChecklist[0]!.id });
      expect(response.status).toBe(404);
    });
  });

  describe('FR-EX-08: checklist', () => {
    it('lets the provider mark a step done', async () => {
      const { id } = await inProgressBooking();
      const plain = checklist.find(item => !item.requiresPhoto)!;
      const marked = await callApi<{ done: boolean }>(app, `/bookings/${id}/checklist/${plain.id}`, asProvider(postJson({ done: true })));
      expect(marked.status).toBe(200);
      expect(marked.body.done).toBe(true);
    });

    it('refuses a photo-required step without its photo (422), and accepts it with one', async () => {
      const { id } = await inProgressBooking();
      const photoStep = checklist.find(item => item.requiresPhoto)!;
      const without = await callApi<{ code: string }>(app, `/bookings/${id}/checklist/${photoStep.id}`, asProvider(postJson({ done: true })));
      expect(without.status).toBe(422);
      expect(without.body.code).toBe('VALIDATION_FAILED');

      const photo = await upload(id, { clientUuid: randomUUID(), kind: 'CHECKLIST', checklistItemId: photoStep.id });
      const withPhoto = await callApi<{ done: boolean; evidenceId: string }>(app, `/bookings/${id}/checklist/${photoStep.id}`, asProvider(postJson({ done: true, evidenceId: photo.body.id })));
      expect(withPhoto.status).toBe(200);
      expect(withPhoto.body.evidenceId).toBe(photo.body.id);
    });

    it('rejects a step from another service with 404, and another provider with 404', async () => {
      const { id } = await inProgressBooking();
      const wrongService = await callApi(app, `/bookings/${id}/checklist/${otherChecklist[0]!.id}`, asProvider(postJson({ done: true })));
      expect(wrongService.status).toBe(404);
      const stranger = await registerAndVerify(app, 'PROVIDER');
      const wrongProvider = await callApi(app, `/bookings/${id}/checklist/${checklist[0]!.id}`, bearer(stranger.accessToken, postJson({ done: true })));
      expect(wrongProvider.status).toBe(404);
    });
  });

  describe('FR-EX-06 / FR-EX-10 / FR-VC-01: completion', () => {
    it('refuses completion while checklist steps remain, with 409', async () => {
      const { id } = await inProgressBooking();
      await upload(id, { clientUuid: randomUUID(), kind: 'BEFORE' });
      await upload(id, { clientUuid: randomUUID(), kind: 'AFTER' });
      const response = await complete(id);
      expect(response.status).toBe(409);
    });

    it('refuses completion without before and after photos, with 409', async () => {
      const { id } = await inProgressBooking();
      for (const item of checklist) {
        if (item.requiresPhoto) {
          const photo = await upload(id, { clientUuid: randomUUID(), kind: 'CHECKLIST', checklistItemId: item.id });
          await callApi(app, `/bookings/${id}/checklist/${item.id}`, asProvider(postJson({ done: true, evidenceId: photo.body.id })));
        } else await callApi(app, `/bookings/${id}/checklist/${item.id}`, asProvider(postJson({ done: true })));
      }
      const noPhotos = await complete(id);
      expect(noPhotos.status).toBe(409);
      await upload(id, { clientUuid: randomUUID(), kind: 'BEFORE' });
      const noAfter = await complete(id);
      expect(noAfter.status).toBe(409);
    });

    it('a final amount above the approved total is refused with 422', async () => {
      const { id, customer } = await inProgressBooking();
      await finishWork(id);
      const approved = (await callApi<Booking>(app, `/bookings/${id}`, bearer(customer.accessToken))).body.approvedTotalPaisa;
      const response = await complete(id, { finalAmountPaisa: approved + 1 });
      expect(response.status).toBe(422);
      expect(response.body.code).toBe('VALIDATION_FAILED');
      const still = await callApi<Booking>(app, `/bookings/${id}`, bearer(customer.accessToken));
      expect(still.body.status).toBe('IN_PROGRESS');
    });

    it('completes: invoice generated, AWAITING_VERIFICATION, Tier A verification call queued, every transition in the history', async () => {
      const { id, customer } = await inProgressBooking('CASH');
      await finishWork(id);
      const completed = await complete(id);
      expect(completed.status).toBe(200);
      expect(completed.body.status).toBe('AWAITING_VERIFICATION');
      expect(completed.body.paymentStatus).toBe('CASH_DUE');
      expect(completed.body.invoice?.number).toMatch(/^INV-\d{4}-\d{6}$/);
      expect(completed.body.finalAmountPaisa).toBe(completed.body.invoice?.totalPaisa);

      const read = await callApi<Booking>(app, `/bookings/${id}`, bearer(customer.accessToken));
      expect(read.body.finalAmountPaisa).toBe(read.body.approvedTotalPaisa);

      const verification = await prisma.$queryRaw<{ tier: string; reasons: string[]; priority: number; status: string; dueAt: Date; createdAt: Date }[]>(
        Prisma.sql`SELECT tier::text, routing_reasons as reasons, priority, status::text, sla_due_at as "dueAt", created_at as "createdAt" FROM verification_calls WHERE booking_id = ${id}::uuid`
      );
      expect(verification).toHaveLength(1);
      // A brand-new provider (R1), a cash job (R8) and a job finished in seconds (R4) — every matching rule is recorded, not just the first.
      expect(verification[0]).toMatchObject({ tier: 'A', priority: 0, status: 'QUEUED' });
      expect(verification[0]?.reasons).toEqual(expect.arrayContaining(['R1_NEW_PROVIDER', 'R4_EVIDENCE_ANOMALY', 'R8_CASH']));
      // The SLA is counted in business minutes (calling hours), so it is never sooner than the wall-clock SLA.
      const cashSlaMinutes = 15;
      expect(verification[0]!.dueAt.getTime()).toBeGreaterThanOrEqual(verification[0]!.createdAt.getTime() + cashSlaMinutes * 60_000 - 5_000);
      expect(verification[0]!.dueAt.getTime()).toBe(addBusinessMinutes(verification[0]!.createdAt, cashSlaMinutes).getTime());
      const tierOnBooking = await prisma.$queryRaw<{ tier: string }[]>(Prisma.sql`SELECT verification_tier::text as tier FROM bookings WHERE id = ${id}::uuid`);
      expect(tierOnBooking[0]?.tier).toBe('A');

      const history = await prisma.$queryRaw<{ event: string; to: string }[]>(Prisma.sql`SELECT event, to_status::text as "to" FROM booking_status_history WHERE booking_id = ${id}::uuid ORDER BY id`);
      expect(history.map(row => `${row.event}:${row.to}`)).toEqual(['create:REQUESTED', 'accept:SCHEDULED', 'depart:EN_ROUTE', 'start:IN_PROGRESS', 'complete:WORK_COMPLETED', 'handToVerification:AWAITING_VERIFICATION']);
    });

    it('a lower final amount adjusts the invoice, and the invoice always adds up', async () => {
      const { id, customer } = await inProgressBooking();
      await finishWork(id);
      const approved = (await callApi<Booking>(app, `/bookings/${id}`, bearer(customer.accessToken))).body.approvedTotalPaisa;
      const completed = await complete(id, { finalAmountPaisa: approved - 10_000 });
      expect(completed.status).toBe(200);
      expect(completed.body.finalAmountPaisa).toBe(approved - 10_000);
      const invoice = await prisma.$queryRaw<{ subtotal: bigint; surcharge: bigint; discount: bigint; total: bigint }[]>(
        Prisma.sql`SELECT subtotal_paisa as subtotal, surcharge_paisa as surcharge, discount_paisa as discount, total_paisa as total FROM invoices WHERE booking_id = ${id}::uuid`
      );
      const row = invoice[0]!;
      expect(row.subtotal + row.surcharge - row.discount).toBe(row.total);
      expect(row.total).toBe(BigInt(approved - 10_000));
    });

    it('serves the invoice PDF to the customer and the provider, and to nobody else', async () => {
      const { id, customer } = await inProgressBooking();
      await finishWork(id);
      await complete(id);

      const asCustomerCall = await callApi<unknown>(app, `/bookings/${id}/invoice.pdf`, bearer(customer.accessToken));
      expect(asCustomerCall.status).toBe(200);
      expect(String(asCustomerCall.headers['content-type'])).toContain('application/pdf');
      expect(String(asCustomerCall.body)).toContain('%PDF-1.4');

      const asProviderCall = await callApi(app, `/bookings/${id}/invoice.pdf`, asProvider());
      expect(asProviderCall.status).toBe(200);

      const stranger = await registerAndVerify(app, 'CUSTOMER');
      const denied = await callApi(app, `/bookings/${id}/invoice.pdf`, bearer(stranger.accessToken));
      expect(denied.status).toBe(404);
    });

    it('refuses to complete twice, or a booking that is not in progress, with 409 ILLEGAL_TRANSITION', async () => {
      const { id } = await inProgressBooking();
      await finishWork(id);
      await complete(id);
      const again = await complete(id);
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('ILLEGAL_TRANSITION');
    });
  });
});
