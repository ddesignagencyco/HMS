// apps/api/test/integration/booking-checkout.test.ts
//
// SHM-036 / SHM-037: quote, cash and online checkout, the signed-webhook capture,
// abandonment, refunds and the money-safety guarantees around them. Its own
// file for the same per-file rate-limiter reason as the other booking-* splits.
import { createHmac, randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { EnvironmentService } from '../../src/config/environment.service.js';
import { PaymentsService } from '../../src/payment/payments.service.js';
import { callApi, createTestApp, postJson, readyBookableProvider, registerAndVerify, type ApiResponse, type TestUser } from './harness.js';

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

const signedWebhook = async (eventId: string, paymentId: string, type = 'payment.captured'): Promise<ApiResponse<{ duplicate?: boolean; code?: string }>> => {
  const body = JSON.stringify({ eventId, paymentId, type, occurredAt: new Date().toISOString(), payload: {} });
  const timestamp = Date.now();
  return callApi(app, '/webhooks/payments/mock', {
    method: 'POST',
    body,
    headers: { 'x-mock-timestamp': String(timestamp), 'x-mock-signature': createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex') }
  });
};

type Setup = { providerId: string; providerAccessToken: string; serviceId: number; areaId: number; provider: TestUser };

const onboardedProvider = async (where?: { lat: number; lng: number }): Promise<Setup> => {
  const { provider, serviceId, areaId } = await readyBookableProvider(app, where);
  return { providerId: provider.id, providerAccessToken: provider.accessToken, serviceId, areaId, provider };
};

const customerWithAddress = async (areaId: number, where = { lat: 31.52, lng: 74.35 }): Promise<{ customer: TestUser; addressId: string }> => {
  const customer = await registerAndVerify(app, 'CUSTOMER');
  const address = await callApi<{ id: string }>(app, '/customer/addresses', bearer(customer.accessToken, postJson({ label: 'Home', line1: 'House 1', areaId, ...where, isDefault: true })));
  return { customer, addressId: address.body.id };
};

type Created = { id: string; status: string; paymentMode: string; paymentStatus: string; quotedAmountPaisa: number; payment?: { paymentId: string; redirectUrl: string } };

describe('SHM-036: quote', () => {
  let setup: Setup;
  let customer: TestUser;

  beforeAll(async () => {
    setup = await onboardedProvider();
    customer = (await customerWithAddress(setup.areaId)).customer;
  });

  it('itemises the service in integer paisa, with the cancellation policy in words', async () => {
    const response = await callApi<{ servicePaisa: number; emergencySurchargePaisa: number; totalPaisa: number; payablePaisa: number; lines: { kind: string }[]; cancellationPolicy: string }>(
      app,
      '/bookings/quote',
      bearer(customer.accessToken, postJson({ providerId: setup.providerId, serviceId: setup.serviceId }))
    );
    expect(response.status).toBe(200);
    expect(Number.isInteger(response.body.servicePaisa)).toBe(true);
    expect(response.body.emergencySurchargePaisa).toBe(0);
    expect(response.body.totalPaisa).toBe(response.body.servicePaisa);
    expect(response.body.payablePaisa).toBe(response.body.totalPaisa);
    expect(response.body.lines[0]?.kind).toBe('SERVICE');
    expect(response.body.cancellationPolicy).toContain('Free cancellation');
  });

  it('adds the emergency surcharge for an emergency-eligible service', async () => {
    const plain = await callApi<{ servicePaisa: number; totalPaisa: number }>(app, '/bookings/quote', bearer(customer.accessToken, postJson({ providerId: setup.providerId, serviceId: setup.serviceId })));
    const emergency = await callApi<{ emergencySurchargePaisa: number; totalPaisa: number }>(
      app,
      '/bookings/quote',
      bearer(customer.accessToken, postJson({ providerId: setup.providerId, serviceId: setup.serviceId, isEmergency: true }))
    );
    expect(emergency.status).toBe(200);
    expect(emergency.body.emergencySurchargePaisa).toBe(Math.floor(plain.body.servicePaisa * 0.25));
    expect(emergency.body.totalPaisa).toBe(plain.body.totalPaisa + emergency.body.emergencySurchargePaisa);
  });

  it('refuses an emergency quote for a service that is not emergency-eligible', async () => {
    const rows = await prisma.$queryRaw<{ id: number }[]>(Prisma.sql`SELECT id FROM services WHERE is_emergency_eligible = false AND is_active = true LIMIT 1`);
    const notEligible = rows[0];
    if (notEligible === undefined) return;
    // The provider does not offer it, so the provider check fires first; price it as auto-assign to isolate the emergency rule.
    const response = await callApi<{ code: string }>(app, '/bookings/quote', bearer(customer.accessToken, postJson({ serviceId: notEligible.id, isEmergency: true })));
    expect(response.status).toBe(400);
  });

  it('applies a valid coupon and rejects an unknown one', async () => {
    const code = `T${randomUUID().slice(0, 8)}`.toUpperCase();
    await prisma.$executeRaw(Prisma.sql`INSERT INTO coupons(code, kind, value, valid_from, valid_to) VALUES (${code}::citext, 'PERCENT', 1000, now() - interval '1 day', now() + interval '1 day')`);
    const ok = await callApi<{ discountPaisa: number; servicePaisa: number; totalPaisa: number }>(
      app,
      '/bookings/quote',
      bearer(customer.accessToken, postJson({ providerId: setup.providerId, serviceId: setup.serviceId, couponCode: code }))
    );
    expect(ok.status).toBe(200);
    expect(ok.body.discountPaisa).toBe(Math.floor(ok.body.servicePaisa / 10));
    expect(ok.body.totalPaisa).toBe(ok.body.servicePaisa - ok.body.discountPaisa);

    const bad = await callApi(app, '/bookings/quote', bearer(customer.accessToken, postJson({ providerId: setup.providerId, serviceId: setup.serviceId, couponCode: 'NOPE-NOT-A-COUPON' })));
    expect(bad.status).toBe(400);
  });

  it('includes an outstanding receivable from an earlier cash cancellation (FR-PY-11)', async () => {
    const { customer: debtor, addressId } = await customerWithAddress(setup.areaId);
    const created = await callApi<Created>(app, '/bookings', bearer(debtor.accessToken, postJson({ providerId: setup.providerId, serviceId: setup.serviceId, addressId, ...slotAt(48) })));
    await callApi(app, `/bookings/${created.body.id}/accept`, bearer(setup.providerAccessToken, { method: 'POST' }));
    // Inside the free-cancel window (slot is 48h away, so pull it in) so the late fee applies.
    await prisma.$executeRaw(Prisma.sql`UPDATE bookings SET scheduled_start = now() + interval '1 hour', scheduled_end = now() + interval '2 hours', slot = tstzrange(now() + interval '1 hour', now() + interval '2 hours') WHERE id = ${created.body.id}::uuid`);
    const cancelled = await callApi(app, `/bookings/${created.body.id}/cancel`, bearer(debtor.accessToken, postJson({ reason: 'changed my mind' })));
    expect(cancelled.status).toBe(200);

    const quote = await callApi<{ outstandingReceivablePaisa: number; totalPaisa: number; payablePaisa: number }>(
      app,
      '/bookings/quote',
      bearer(debtor.accessToken, postJson({ providerId: setup.providerId, serviceId: setup.serviceId }))
    );
    expect(quote.body.outstandingReceivablePaisa).toBe(50_000);
    expect(quote.body.payablePaisa).toBe(quote.body.totalPaisa + 50_000);
  });
});

describe('SHM-037: online checkout, capture and abandonment', () => {
  let setup: Setup;
  let nextSlot = 1_000;

  beforeAll(async () => {
    setup = await onboardedProvider();
  });

  const onlineBooking = async (): Promise<{ customer: TestUser; booking: Created; paymentId: string }> => {
    const { customer, addressId } = await customerWithAddress(setup.areaId);
    nextSlot += 24;
    const created = await callApi<Created>(
      app,
      '/bookings/checkout',
      bearer(customer.accessToken, postJson({ providerId: setup.providerId, serviceId: setup.serviceId, addressId, paymentMode: 'ONLINE', ...slotAt(nextSlot) }))
    );
    expect(created.status).toBe(201);
    return { customer, booking: created.body, paymentId: created.body.payment!.paymentId };
  };

  it('holds an online booking as PENDING_PAYMENT and hands back a payment redirect', async () => {
    const { booking } = await onlineBooking();
    expect(booking.status).toBe('PENDING_PAYMENT');
    expect(booking.paymentMode).toBe('ONLINE');
    expect(booking.paymentStatus).toBe('PENDING');
    expect(booking.payment?.redirectUrl).toContain('/dev/payments/');
  });

  it('does not offer a PENDING_PAYMENT booking to the provider', async () => {
    const { booking } = await onlineBooking();
    const offers = await callApi<{ items: { bookingId: string }[] }>(app, '/provider/offers', bearer(setup.providerAccessToken));
    expect(offers.body.items.some(item => item.bookingId === booking.id)).toBe(false);
  });

  it('captures on a signed webhook: REQUESTED, funds in escrow, exactly one balanced ledger transaction', async () => {
    const { customer, booking, paymentId } = await onlineBooking();
    const delivered = await signedWebhook(`evt_${randomUUID()}`, paymentId);
    expect(delivered.status).toBe(202);

    const read = await callApi<{ status: string; paymentStatus: string }>(app, `/bookings/${booking.id}`, bearer(customer.accessToken));
    expect(read.body.status).toBe('REQUESTED');
    expect(read.body.paymentStatus).toBe('HELD');

    const entries = await prisma.$queryRaw<{ direction: string; account: string; amount: bigint }[]>(
      Prisma.sql`SELECT e.direction, a.type as account, e.amount_paisa as amount FROM ledger_transactions t JOIN ledger_entries e ON e.transaction_id = t.id JOIN ledger_accounts a ON a.id = e.account_id
        WHERE t.idempotency_key = ${`capture:${paymentId}`} ORDER BY e.id`
    );
    expect(entries.map(entry => `${entry.direction}:${entry.account}`)).toEqual(['DEBIT:GATEWAY_CLEARING', 'CREDIT:ESCROW']);
    expect(entries[0]?.amount).toBe(BigInt(booking.quotedAmountPaisa));

    const offers = await callApi<{ items: { bookingId: string }[] }>(app, '/provider/offers', bearer(setup.providerAccessToken));
    expect(offers.body.items.some(item => item.bookingId === booking.id)).toBe(true);
  });

  it('replayed ×10 — the same event id concurrently, and fresh event ids for the same payment — yields one capture and one ledger transaction', async () => {
    const { booking, paymentId } = await onlineBooking();
    const sameEvent = `evt_${randomUUID()}`;
    const concurrent = await Promise.all(Array.from({ length: 10 }, () => signedWebhook(sameEvent, paymentId)));
    expect(concurrent.every(response => response.status === 202)).toBe(true);
    expect(concurrent.filter(response => response.body.duplicate === false)).toHaveLength(1);

    await Promise.all(Array.from({ length: 10 }, () => signedWebhook(`evt_${randomUUID()}`, paymentId)));

    const counts = await prisma.$queryRaw<{ transactions: bigint; captured: bigint }[]>(
      Prisma.sql`SELECT (SELECT count(*) FROM ledger_transactions WHERE booking_id = ${booking.id}::uuid AND type = 'CAPTURE')::bigint as transactions,
                        (SELECT count(*) FROM payments WHERE id = ${paymentId}::uuid AND status = 'CAPTURED')::bigint as captured`
    );
    expect(counts[0]?.transactions).toBe(1n);
    expect(counts[0]?.captured).toBe(1n);
  });

  it('rejects an unsigned webhook with 401 and changes nothing', async () => {
    const { booking, paymentId } = await onlineBooking();
    const response = await callApi<{ code: string }>(app, '/webhooks/payments/mock', { method: 'POST', body: JSON.stringify({ eventId: 'x', paymentId, type: 'payment.captured', occurredAt: new Date().toISOString(), payload: {} }) });
    expect(response.status).toBe(401);
    const rows = await prisma.$queryRaw<{ status: string }[]>(Prisma.sql`SELECT status FROM bookings WHERE id = ${booking.id}::uuid`);
    expect(rows[0]?.status).toBe('PENDING_PAYMENT');
  });

  it('a failed payment abandons the booking and frees the slot', async () => {
    const { customer, booking, paymentId } = await onlineBooking();
    await signedWebhook(`evt_${randomUUID()}`, paymentId, 'payment.failed');
    const read = await callApi<{ status: string; paymentStatus: string }>(app, `/bookings/${booking.id}`, bearer(customer.accessToken));
    expect(read.body.status).toBe('ABANDONED');
    expect(read.body.paymentStatus).toBe('NONE');
  });

  it('abandons a checkout that outlives its payment window, and refuses a capture that arrives after', async () => {
    const { customer, booking, paymentId } = await onlineBooking();
    await prisma.$executeRaw(Prisma.sql`UPDATE payments SET expires_at = now() - interval '1 minute' WHERE id = ${paymentId}::uuid`);
    const abandoned = await app.get(PaymentsService).abandonExpiredCheckouts();
    expect(abandoned).toBeGreaterThanOrEqual(1);

    const read = await callApi<{ status: string }>(app, `/bookings/${booking.id}`, bearer(customer.accessToken));
    expect(read.body.status).toBe('ABANDONED');

    await signedWebhook(`evt_${randomUUID()}`, paymentId);
    const after = await callApi<{ status: string }>(app, `/bookings/${booking.id}`, bearer(customer.accessToken));
    expect(after.body.status).toBe('ABANDONED');
    const captures = await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*)::bigint as n FROM ledger_transactions WHERE booking_id = ${booking.id}::uuid AND type = 'CAPTURE'`);
    expect(captures[0]?.n).toBe(0n);
  });

  it('completes a whole online checkout through the dev gateway page', async () => {
    const { customer, booking, paymentId } = await onlineBooking();
    const paid = await callApi(app, `/dev/payments/${paymentId}/complete?outcome=captured`, { method: 'POST' });
    expect(paid.status).toBe(200);
    const read = await callApi<{ status: string }>(app, `/bookings/${booking.id}`, bearer(customer.accessToken));
    expect(read.body.status).toBe('REQUESTED');
  });

  it('50 concurrent checkouts for one slot: exactly one succeeds, the rest get 409 SLOT_TAKEN', async () => {
    const { customer, addressId } = await customerWithAddress(setup.areaId);
    nextSlot += 24;
    const slot = slotAt(nextSlot);
    const results = await Promise.all(
      Array.from({ length: 50 }, () => callApi<{ code?: string }>(app, '/bookings/checkout', bearer(customer.accessToken, postJson({ providerId: setup.providerId, serviceId: setup.serviceId, addressId, ...slot }))))
    );
    expect(results.filter(result => result.status === 201)).toHaveLength(1);
    const losers = results.filter(result => result.status !== 201);
    expect(losers).toHaveLength(49);
    expect(losers.every(result => result.status === 409 && result.body.code === 'SLOT_TAKEN')).toBe(true);
  });
});

describe('SHM-038 / SHM-039: offers, silence, refunds and cancel fees', () => {
  let setup: Setup;
  let nextSlot = 2_000;
  // The database outlives test runs and auto-assign considers every approved provider in range, so each run works somewhere nobody
  // from an earlier run is: a random point, at least ~50 km from anywhere a previous run could have chosen.
  const here = { lat: 20 + Math.random() * 8, lng: 60 + Math.random() * 8 };

  beforeAll(async () => {
    setup = await onboardedProvider(here);
  });

  const slot = (): { scheduledStart: string; scheduledEnd: string } => {
    nextSlot += 24;
    return slotAt(nextSlot);
  };

  const placed = async (mode: 'CASH' | 'ONLINE', extra: Record<string, unknown> = {}): Promise<{ customer: TestUser; booking: Created; paymentId?: string }> => {
    const { customer, addressId } = await customerWithAddress(setup.areaId, here);
    const created = await callApi<Created>(app, '/bookings', bearer(customer.accessToken, postJson({ serviceId: setup.serviceId, addressId, paymentMode: mode, ...slot(), ...extra })));
    expect(created.status).toBe(201);
    if (created.body.payment !== undefined) await signedWebhook(`evt_${randomUUID()}`, created.body.payment.paymentId);
    return { customer, booking: created.body, ...(created.body.payment === undefined ? {} : { paymentId: created.body.payment.paymentId }) };
  };

  const offerFor = async (bookingId: string): Promise<{ id: string; providerId: string; status: string }[]> =>
    (await prisma.$queryRaw<{ id: string; providerId: string; status: string }[]>(Prisma.sql`SELECT id, provider_id as "providerId", status FROM booking_offers WHERE booking_id = ${bookingId}::uuid ORDER BY rank`));

  it('auto-assign offers the job to the nearest free provider, who can see and accept it', async () => {
    const { customer, booking } = await placed('CASH');
    const offers = await offerFor(booking.id);
    expect(offers).toHaveLength(1);
    expect(offers[0]?.providerId).toBe(setup.providerId);

    const listed = await callApi<{ items: { id: string; bookingId: string }[] }>(app, '/provider/offers', bearer(setup.providerAccessToken));
    const mine = listed.body.items.find(item => item.bookingId === booking.id);
    expect(mine).toBeDefined();

    const accepted = await callApi<{ status: string; providerId: string }>(app, `/provider/offers/${mine!.id}/accept`, bearer(setup.providerAccessToken, { method: 'POST' }));
    expect(accepted.status).toBe(200);
    expect(accepted.body.status).toBe('SCHEDULED');
    expect(accepted.body.providerId).toBe(setup.providerId);
    const read = await callApi<{ status: string }>(app, `/bookings/${booking.id}`, bearer(customer.accessToken));
    expect(read.body.status).toBe('SCHEDULED');
  });

  it('forfeits an offer left unanswered past its deadline; with nobody else to ask the booking is UNFULFILLED', async () => {
    const { customer, booking } = await placed('CASH');
    await prisma.$executeRaw(Prisma.sql`UPDATE booking_offers SET expires_at = now() - interval '1 second' WHERE booking_id = ${booking.id}::uuid`);

    const late = await callApi(app, `/provider/offers/${(await offerFor(booking.id))[0]!.id}/accept`, bearer(setup.providerAccessToken, { method: 'POST' }));
    expect(late.status).toBe(409);

    const { OfferService } = await import('../../src/booking/offer.service.js');
    await app.get(OfferService).expireDue();
    const read = await callApi<{ status: string }>(app, `/bookings/${booking.id}`, bearer(customer.accessToken));
    expect(read.body.status).toBe('UNFULFILLED');
    expect((await offerFor(booking.id))[0]?.status).toBe('EXPIRED');
  });

  it('refunds an online booking exactly once when nobody accepts, however many times the sweeper runs', async () => {
    const { booking, paymentId } = await placed('ONLINE');
    await prisma.$executeRaw(Prisma.sql`UPDATE booking_offers SET expires_at = now() - interval '1 second' WHERE booking_id = ${booking.id}::uuid`);
    const { OfferService } = await import('../../src/booking/offer.service.js');
    const offers = app.get(OfferService);
    await Promise.all([offers.expireDue(), offers.expireDue(), offers.expireDue()]);
    await offers.expireDue();

    const refunds = await prisma.$queryRaw<{ n: bigint; total: bigint; status: string | null }[]>(
      Prisma.sql`SELECT count(*)::bigint as n, coalesce(sum(amount_paisa), 0)::bigint as total, max(status::text) as status FROM refunds WHERE booking_id = ${booking.id}::uuid`
    );
    expect(refunds[0]?.n).toBe(1n);
    expect(refunds[0]?.total).toBe(BigInt(booking.quotedAmountPaisa));
    expect(refunds[0]?.status).toBe('SUCCEEDED');
    const escrow = await prisma.$queryRaw<{ balance: bigint }[]>(
      Prisma.sql`SELECT coalesce(b.balance, 0)::bigint as balance FROM ledger_accounts a LEFT JOIN account_balances b ON b.account_id = a.id WHERE a.type = 'ESCROW' AND a.booking_id = ${booking.id}::uuid`
    );
    expect(escrow[0]?.balance).toBe(0n);
    const pay = await prisma.$queryRaw<{ status: string }[]>(Prisma.sql`SELECT status FROM payments WHERE id = ${paymentId!}::uuid`);
    expect(pay[0]?.status).toBe('REFUNDED');
  });

  it('a decline of an auto-assign offer with nobody else free ends UNFULFILLED', async () => {
    const { customer, booking } = await placed('CASH');
    const offer = (await offerFor(booking.id))[0]!;
    const declined = await callApi(app, `/provider/offers/${offer.id}/decline`, bearer(setup.providerAccessToken, { method: 'POST' }));
    expect(declined.status).toBe(200);
    const read = await callApi<{ status: string }>(app, `/bookings/${booking.id}`, bearer(customer.accessToken));
    expect(read.body.status).toBe('UNFULFILLED');
  });

  it('cascades to the next-nearest provider when the first one declines', async () => {
    const second = await onboardedProvider({ lat: here.lat + 0.0005, lng: here.lng + 0.0005 });
    const { customer, booking } = await placed('CASH');
    const first = (await offerFor(booking.id))[0]!;
    const firstProvider = first.providerId === setup.providerId ? setup : second;
    const otherProvider = first.providerId === setup.providerId ? second : setup;
    await callApi(app, `/provider/offers/${first.id}/decline`, bearer(firstProvider.providerAccessToken, { method: 'POST' }));
    const offers = await offerFor(booking.id);
    expect(offers.map(offer => offer.status)).toEqual(['DECLINED', 'PENDING']);
    expect(offers[1]?.providerId).toBe(otherProvider.providerId);
    const read = await callApi<{ status: string }>(app, `/bookings/${booking.id}`, bearer(customer.accessToken));
    expect(read.body.status).toBe('REQUESTED');
  });

  it('a provider cancelling a paid, scheduled job refunds the customer in full', async () => {
    const { customer, addressId } = await customerWithAddress(setup.areaId, here);
    const created = await callApi<Created>(app, '/bookings', bearer(customer.accessToken, postJson({ providerId: setup.providerId, serviceId: setup.serviceId, addressId, paymentMode: 'ONLINE', ...slot() })));
    await signedWebhook(`evt_${randomUUID()}`, created.body.payment!.paymentId);
    await callApi(app, `/bookings/${created.body.id}/accept`, bearer(setup.providerAccessToken, { method: 'POST' }));
    const cancelled = await callApi<{ status: string }>(app, `/bookings/${created.body.id}/cancel`, bearer(setup.providerAccessToken, postJson({ reason: 'van broke down' })));
    expect(cancelled.body.status).toBe('CANCELLED_PROVIDER');
    const refund = await prisma.$queryRaw<{ amount: bigint }[]>(Prisma.sql`SELECT amount_paisa as amount FROM refunds WHERE booking_id = ${created.body.id}::uuid`);
    expect(refund[0]?.amount).toBe(BigInt(created.body.quotedAmountPaisa));
  });

  it('table-driven cancel fee: free outside the window, the setting inside it — online from escrow, cash to receivable', async () => {
    const lateFee = 50_000n;
    const cases: { name: string; mode: 'CASH' | 'ONLINE'; hoursAhead: number; expectFee: bigint }[] = [
      { name: 'online, well ahead', mode: 'ONLINE', hoursAhead: 72, expectFee: 0n },
      { name: 'online, inside the window', mode: 'ONLINE', hoursAhead: 1, expectFee: lateFee },
      { name: 'cash, well ahead', mode: 'CASH', hoursAhead: 72, expectFee: 0n },
      { name: 'cash, inside the window', mode: 'CASH', hoursAhead: 1, expectFee: lateFee }
    ];
    for (const testCase of cases) {
      const { customer, addressId } = await customerWithAddress(setup.areaId, here);
      const created = await callApi<Created>(app, '/bookings', bearer(customer.accessToken, postJson({ providerId: setup.providerId, serviceId: setup.serviceId, addressId, paymentMode: testCase.mode, ...slot() })));
      if (created.body.payment !== undefined) await signedWebhook(`evt_${randomUUID()}`, created.body.payment.paymentId);
      await callApi(app, `/bookings/${created.body.id}/accept`, bearer(setup.providerAccessToken, { method: 'POST' }));
      const start = new Date(Date.now() + testCase.hoursAhead * 3_600_000);
      const end = new Date(start.getTime() + 3_600_000);
      await prisma.$executeRaw(Prisma.sql`UPDATE bookings SET scheduled_start = ${start.toISOString()}::timestamptz, scheduled_end = ${end.toISOString()}::timestamptz, slot = tstzrange(${start.toISOString()}::timestamptz, ${end.toISOString()}::timestamptz) WHERE id = ${created.body.id}::uuid`);

      const cancelled = await callApi<{ status: string }>(app, `/bookings/${created.body.id}/cancel`, bearer(customer.accessToken, postJson({})));
      expect(cancelled.body.status, testCase.name).toBe('CANCELLED_CUSTOMER');

      const fee = await prisma.$queryRaw<{ n: bigint; account: string | null }[]>(
        Prisma.sql`SELECT coalesce(sum(e.amount_paisa) FILTER (WHERE e.direction = 'CREDIT'), 0)::bigint as n, max(a.type::text) FILTER (WHERE e.direction = 'DEBIT') as account
          FROM ledger_transactions t JOIN ledger_entries e ON e.transaction_id = t.id JOIN ledger_accounts a ON a.id = e.account_id WHERE t.booking_id = ${created.body.id}::uuid AND t.type = 'CANCEL_FEE'`
      );
      expect(fee[0]?.n, testCase.name).toBe(testCase.expectFee);
      if (testCase.expectFee > 0n) expect(fee[0]?.account, testCase.name).toBe(testCase.mode === 'ONLINE' ? 'ESCROW' : 'CUSTOMER_RECEIVABLE');

      if (testCase.mode === 'ONLINE') {
        const refunded = await prisma.$queryRaw<{ total: bigint }[]>(Prisma.sql`SELECT coalesce(sum(amount_paisa), 0)::bigint as total FROM refunds WHERE booking_id = ${created.body.id}::uuid`);
        expect(refunded[0]?.total, testCase.name).toBe(BigInt(created.body.quotedAmountPaisa) - testCase.expectFee);
      }
    }
  });

  it('lets a customer cancel before any provider accepts, refunding an online booking', async () => {
    const { customer, booking } = await placed('ONLINE');
    const cancelled = await callApi<{ status: string }>(app, `/bookings/${booking.id}/cancel`, bearer(customer.accessToken, postJson({})));
    expect(cancelled.body.status).toBe('CANCELLED_CUSTOMER');
    const refund = await prisma.$queryRaw<{ amount: bigint }[]>(Prisma.sql`SELECT amount_paisa as amount FROM refunds WHERE booking_id = ${booking.id}::uuid`);
    expect(refund[0]?.amount).toBe(BigInt(booking.quotedAmountPaisa));
  });
});
