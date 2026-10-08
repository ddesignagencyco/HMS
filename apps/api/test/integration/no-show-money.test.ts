// apps/api/test/integration/no-show-money.test.ts
//
// A no-show must refund the customer (SRS §7.4: "Full refund + fixed penalty").
//
// This file exists because it did not. `NO_SHOW` appeared exactly once in the whole
// codebase — as a destination in the transition table — with no outbound edge, and the
// money path handled only `decline` and `cancel`. So for an ONLINE booking:
//
//   capture -> escrow holds the money -> noShow -> status NO_SHOW (terminal)
//
// left the entire amount in escrow with no transition, endpoint or sweep able to move
// it. The nightly reconciliation did not notice either, because the check that flags
// escrow on finished bookings did not include NO_SHOW in its list of finished
// statuses — the one job whose entire purpose is to notice exactly this was not
// looking at that status.
//
// Also covers BR-04: `booking.no_show_grace_min` was seeded and read by nothing, so
// either party could report a no-show the instant the provider tapped *depart*, and a
// provider-only report auto-proposes a penalty worth demerit points and a fine.
import { Prisma } from '@prisma/client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService } from '../../src/database/prisma.service.js';
import { AppClock } from '../../src/platform/app-clock.js';
import { callApi, createTestApp, postJson, readyBookableProvider, registerAndVerify, type TestUser } from './harness.js';

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

// Each test travels the application clock, so it must be put back or the next one
// inherits a future "now" and its booking window moves with it.
afterEach(() => {
  app.get(AppClock).reset();
});

const bearer = (accessToken: string, init: RequestInit = {}): RequestInit => ({ ...init, headers: { ...init.headers, authorization: `Bearer ${accessToken}` } });

type Provider = { id: string; accessToken: string; serviceId: number; areaId: number };

/** Slots well apart, so two bookings never collide on the provider's no-overlap constraint. */
let slotOffsetHours = 240;
const nextSlot = (): { scheduledStart: string; scheduledEnd: string } => {
  const start = new Date(Date.now() + slotOffsetHours * 3_600_000);
  slotOffsetHours += 24;
  return { scheduledStart: start.toISOString(), scheduledEnd: new Date(start.getTime() + 3_600_000).toISOString() };
};

/** An ONLINE booking, captured at the mock gateway, accepted, and departed — so EN_ROUTE. */
const onlineBookingEnRoute = async (provider: Provider): Promise<{ id: string; customer: TestUser; scheduledStart: Date; totalPaisa: number }> => {
  const customer = await registerAndVerify(app, 'CUSTOMER');
  const address = await callApi<{ id: string }>(app, '/customer/addresses', bearer(customer.accessToken, postJson({ label: 'Home', line1: 'House 1', areaId: provider.areaId, lat: 31.52, lng: 74.35, isDefault: true })));
  const slot = nextSlot();
  const created = await callApi<{ id: string; approvedTotalPaisa: number; payment?: { paymentId: string } }>(
    app,
    '/bookings',
    bearer(customer.accessToken, postJson({ providerId: provider.id, serviceId: provider.serviceId, addressId: address.body.id, ...slot, paymentMode: 'ONLINE' }))
  );
  if (created.status !== 201) throw new Error(`booking failed: ${created.status} ${JSON.stringify(created.body)}`);
  if (created.body.payment !== undefined) {
    const captured = await callApi(app, `/dev/payments/${created.body.payment.paymentId}/complete?outcome=captured`, { method: 'POST' });
    expect(captured.status).toBeLessThan(300);
  }
  await callApi(app, `/bookings/${created.body.id}/accept`, bearer(provider.accessToken, { method: 'POST' }));
  await callApi(app, `/bookings/${created.body.id}/depart`, bearer(provider.accessToken, { method: 'POST' }));
  return { id: created.body.id, customer, scheduledStart: new Date(slot.scheduledStart), totalPaisa: created.body.approvedTotalPaisa };
};

const escrowOf = async (bookingId: string): Promise<number> => {
  const rows = await app.get(PrismaService).$queryRaw<{ balance: bigint }[]>(
    Prisma.sql`SELECT b.balance FROM ledger_accounts a JOIN account_balances b ON b.account_id = a.id WHERE a.type = 'ESCROW' AND a.booking_id = ${bookingId}::uuid`
  );
  return Number(rows[0]?.balance ?? 0n);
};

const refundsOf = async (bookingId: string): Promise<{ reasonCode: string; amountPaisa: bigint; status: string }[]> =>
  app.get(PrismaService).$queryRaw<{ reasonCode: string; amountPaisa: bigint; status: string }[]>(
    Prisma.sql`SELECT reason_code as "reasonCode", amount_paisa as "amountPaisa", status::text as status FROM refunds WHERE booking_id = ${bookingId}::uuid ORDER BY created_at`
  );

describe('FR-BK-06 / SRS §7.4: a no-show refunds the customer', () => {
  let provider: Provider;

  beforeAll(async () => {
    const ready = await readyBookableProvider(app);
    provider = { id: ready.provider.id, accessToken: ready.provider.accessToken, serviceId: ready.serviceId, areaId: ready.areaId };
  });

  it('refunds the whole captured amount out of escrow when the provider fails to show', async () => {
    const booking = await onlineBookingEnRoute(provider);
    // The capture really did put the money in escrow, or this test proves nothing.
    const heldBefore = await escrowOf(booking.id);
    expect(heldBefore).toBe(booking.totalPaisa);
    expect(heldBefore).toBeGreaterThan(0);

    // Past the BR-04 grace window relative to the slot start.
    app.get(AppClock).travelTo(new Date(booking.scheduledStart.getTime() + 40 * 60_000));

    const reported = await callApi<{ status: string; noShowParty: string }>(
      app,
      `/bookings/${booking.id}/no-show`,
      bearer(booking.customer.accessToken, postJson({ party: 'PROVIDER' }))
    );
    expect(reported.status).toBe(200);
    expect(reported.body.status).toBe('NO_SHOW');
    expect(reported.body.noShowParty).toBe('PROVIDER');

    // The bug: escrow held the money and nothing could ever move it.
    expect(await escrowOf(booking.id)).toBe(0);
    const refunds = await refundsOf(booking.id);
    expect(refunds.length).toBe(1);
    expect(Number(refunds[0]!.amountPaisa)).toBe(booking.totalPaisa);
    expect(refunds[0]!.reasonCode).toBe('NO_SHOW');
  });

  it('refunds in full whichever party reported, because the customer got no service', async () => {
    const booking = await onlineBookingEnRoute(provider);
    app.get(AppClock).travelTo(new Date(booking.scheduledStart.getTime() + 40 * 60_000));

    const reported = await callApi<{ status: string }>(app, `/bookings/${booking.id}/no-show`, bearer(booking.customer.accessToken, postJson({ party: 'CUSTOMER' })));
    expect(reported.status).toBe(200);
    expect(await escrowOf(booking.id)).toBe(0);
    expect(Number((await refundsOf(booking.id))[0]!.amountPaisa)).toBe(booking.totalPaisa);
  });

  it('refunds exactly once even if the refund is retried', async () => {
    const booking = await onlineBookingEnRoute(provider);
    app.get(AppClock).travelTo(new Date(booking.scheduledStart.getTime() + 40 * 60_000));
    await callApi(app, `/bookings/${booking.id}/no-show`, bearer(booking.customer.accessToken, postJson({ party: 'PROVIDER' })));

    // The refund is keyed `booking:<id>:no-show`, so a second run cannot double-refund.
    const second = await callApi(app, `/bookings/${booking.id}/no-show`, bearer(booking.customer.accessToken, postJson({ party: 'PROVIDER' })));
    expect(second.status).toBe(409);
    expect((await refundsOf(booking.id)).length).toBe(1);
    expect(await escrowOf(booking.id)).toBe(0);
  });

  it('books no money against a cash booking, which has nothing captured', async () => {
    const customer = await registerAndVerify(app, 'CUSTOMER');
    const address = await callApi<{ id: string }>(app, '/customer/addresses', bearer(customer.accessToken, postJson({ label: 'Home', line1: 'House 1', areaId: provider.areaId, lat: 31.52, lng: 74.35, isDefault: true })));
    const slot = nextSlot();
    const created = await callApi<{ id: string }>(
      app,
      '/bookings',
      bearer(customer.accessToken, postJson({ providerId: provider.id, serviceId: provider.serviceId, addressId: address.body.id, ...slot, paymentMode: 'CASH' }))
    );
    expect(created.status).toBe(201);
    await callApi(app, `/bookings/${created.body.id}/accept`, bearer(provider.accessToken, { method: 'POST' }));
    await callApi(app, `/bookings/${created.body.id}/depart`, bearer(provider.accessToken, { method: 'POST' }));

    app.get(AppClock).travelTo(new Date(new Date(slot.scheduledStart).getTime() + 40 * 60_000));
    const reported = await callApi<{ status: string }>(app, `/bookings/${created.body.id}/no-show`, bearer(customer.accessToken, postJson({ party: 'PROVIDER' })));
    expect(reported.status).toBe(200);
    expect(await escrowOf(created.body.id)).toBe(0);
    expect(await refundsOf(created.body.id)).toEqual([]);
  });
});

describe('BR-04: a no-show can only be reported after the grace window', () => {
  let provider: Provider;

  beforeAll(async () => {
    const ready = await readyBookableProvider(app);
    provider = { id: ready.provider.id, accessToken: ready.provider.accessToken, serviceId: ready.serviceId, areaId: ready.areaId };
  });

  it('refuses a report inside the grace period and names the wait', async () => {
    const booking = await onlineBookingEnRoute(provider);
    // One minute before the slot: the provider has not even had the chance to arrive.
    app.get(AppClock).travelTo(new Date(booking.scheduledStart.getTime() - 60_000));

    const refused = await callApi<{ code: string; detail: string }>(
      app,
      `/bookings/${booking.id}/no-show`,
      bearer(booking.customer.accessToken, postJson({ party: 'PROVIDER' }))
    );
    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe('BAD_REQUEST');
    expect(refused.body.detail).toContain('30 minutes');

    // And it left no trace: still EN_ROUTE, nothing refunded, no history row.
    const current = await callApi<{ status: string }>(app, `/bookings/${booking.id}`, bearer(booking.customer.accessToken));
    expect(current.body.status).toBe('EN_ROUTE');
    expect(await refundsOf(booking.id)).toEqual([]);
    const history = await app.get(PrismaService).$queryRaw<{ n: bigint }[]>(
      Prisma.sql`SELECT count(*)::bigint as n FROM booking_status_history WHERE booking_id = ${booking.id}::uuid AND event = 'noShow'`
    );
    expect(Number(history[0]!.n)).toBe(0);
  });

  it('allows the report exactly on the grace boundary', async () => {
    const booking = await onlineBookingEnRoute(provider);
    app.get(AppClock).travelTo(new Date(booking.scheduledStart.getTime() + 30 * 60_000));

    const reported = await callApi<{ status: string }>(app, `/bookings/${booking.id}/no-show`, bearer(booking.customer.accessToken, postJson({ party: 'PROVIDER' })));
    expect(reported.status).toBe(200);
    expect(reported.body.status).toBe('NO_SHOW');
  });

  it('allows a report from SCHEDULED, for a provider who never taps depart', async () => {
    // SRS T13 lists SCHEDULED as well as EN_ROUTE: a provider who simply does not turn
    // up has still failed the visit, and without this the customer could not close it.
    const customer = await registerAndVerify(app, 'CUSTOMER');
    const address = await callApi<{ id: string }>(app, '/customer/addresses', bearer(customer.accessToken, postJson({ label: 'Home', line1: 'House 1', areaId: provider.areaId, lat: 31.52, lng: 74.35, isDefault: true })));
    const slot = nextSlot();
    const created = await callApi<{ id: string; status: string }>(
      app,
      '/bookings',
      bearer(customer.accessToken, postJson({ providerId: provider.id, serviceId: provider.serviceId, addressId: address.body.id, ...slot }))
    );
    expect(created.body.status).toBe('REQUESTED');
    await callApi(app, `/bookings/${created.body.id}/accept`, bearer(provider.accessToken, { method: 'POST' }));

    const scheduled = await callApi<{ status: string }>(app, `/bookings/${created.body.id}`, bearer(customer.accessToken));
    expect(scheduled.body.status).toBe('SCHEDULED');

    app.get(AppClock).travelTo(new Date(new Date(slot.scheduledStart).getTime() + 40 * 60_000));
    const reported = await callApi<{ status: string }>(app, `/bookings/${created.body.id}/no-show`, bearer(customer.accessToken, postJson({ party: 'PROVIDER' })));
    expect(reported.status).toBe(200);
    expect(reported.body.status).toBe('NO_SHOW');
  });

  it('auto-proposes the reliability penalty when the provider is the one who failed to show', async () => {
    const booking = await onlineBookingEnRoute(provider);
    app.get(AppClock).travelTo(new Date(booking.scheduledStart.getTime() + 40 * 60_000));
    await callApi(app, `/bookings/${booking.id}/no-show`, bearer(booking.customer.accessToken, postJson({ party: 'PROVIDER' })));

    const penalties = await app.get(PrismaService).$queryRaw<{ breachCode: string; status: string }[]>(
      Prisma.sql`SELECT breach_code as "breachCode", status::text as status FROM penalties WHERE provider_id = ${provider.id}::uuid AND booking_id = ${booking.id}::uuid`
    );
    // Proposed, never applied: applying a penalty is a human decision.
    expect(penalties.length).toBe(1);
    expect(penalties[0]!.breachCode).toBe('NO_SHOW');
    expect(penalties[0]!.status).toBe('PROPOSED');
  });
});

describe('reconciliation would have caught the stranded escrow', () => {
  let provider: Provider;

  beforeAll(async () => {
    const ready = await readyBookableProvider(app);
    provider = { id: ready.provider.id, accessToken: ready.provider.accessToken, serviceId: ready.serviceId, areaId: ready.areaId };
  });

  it('reports escrow left on a NO_SHOW booking as drift', async () => {
    // Construct the exact broken state the bug produced -- a captured, terminal
    // NO_SHOW booking with the money still sitting in escrow -- and prove the
    // nightly check now flags it. Without NO_SHOW in the finished-status list this
    // returned nothing, so the drift was invisible.
    const booking = await onlineBookingEnRoute(provider);
    app.get(AppClock).travelTo(new Date(booking.scheduledStart.getTime() + 40 * 60_000));
    await callApi(app, `/bookings/${booking.id}/no-show`, bearer(booking.customer.accessToken, postJson({ party: 'PROVIDER' })));

    // Put the money back to recreate the stranded state. `balance` is generated as
    // credit_total - debit_total, so crediting once raises it by exactly the amount.
    // The whole-database invariant suites (money-safety, finance's zero-drift check) run
    // against the same shared database, so it must be taken back out when the test leaves
    // (the incident it recreates is evidence for this one assertion, not data to keep).
    const prisma = app.get(PrismaService);
    await prisma.$executeRaw(
      Prisma.sql`UPDATE account_balances SET credit_total = credit_total + ${booking.totalPaisa} WHERE account_id = (SELECT id FROM ledger_accounts WHERE type = 'ESCROW' AND booking_id = ${booking.id}::uuid)`
    );
    expect(await escrowOf(booking.id)).toBe(booking.totalPaisa);

    try {
      const { ReconciliationService } = await import('../../src/payment/reconciliation.service.js');
      const report = await app.get(ReconciliationService).run(null);
      const escrowDrift = report.drift.filter(entry => entry.check === 'escrow' && entry.subject === booking.id);
      expect(escrowDrift.length).toBe(1);
      expect(escrowDrift[0]!.expected).toContain('0 once a booking is finished');
    } finally {
      await prisma.$executeRaw(
        Prisma.sql`UPDATE account_balances SET credit_total = credit_total - ${booking.totalPaisa} WHERE account_id = (SELECT id FROM ledger_accounts WHERE type = 'ESCROW' AND booking_id = ${booking.id}::uuid)`
      );
    }
    expect(await escrowOf(booking.id)).toBe(0);
  });
});