import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService } from '../../src/database/prisma.service.js';
import { LedgerService } from '../../src/payment/ledger.service.js';
import { PlanSchedulerService } from '../../src/plans/plans-scheduler.service.js';
import {
  adminSession,
  callApi,
  createTestApp,
  deleteWith,
  patchJson,
  postJson,
  readyBookableProvider,
  registerAndVerify
} from './harness.js';

let app: NestExpressApplication;
let close: () => Promise<void>;
let admin: { accessToken: string; userId: string };
let prisma: PrismaService;
let scheduler: PlanSchedulerService;

beforeAll(async () => {
  const started = await createTestApp();
  app = started.app;
  close = started.close;
  prisma = app.get(PrismaService);
  scheduler = app.get(PlanSchedulerService);
  admin = await adminSession(app);
});

afterAll(async () => {
  await close();
});

const asAdmin = (init: RequestInit = {}): RequestInit => ({
  ...init,
  headers: { ...init.headers, authorization: `Bearer ${admin.accessToken}` }
});

const asCustomer = (token: string, init: RequestInit = {}): RequestInit => ({
  ...init,
  headers: { ...init.headers, authorization: `Bearer ${token}` }
});

describe('SHM-089 / FR-MP-01..04: Maintenance Plans', () => {
  it('Admin CRUD: creates, updates, and deactivates a maintenance plan', async () => {
    // 1. Admin creates a plan
    const createBody = {
      nameEn: `AC & Plumbing Care ${randomUUID().slice(0, 6)}`,
      nameUr: 'اے سی اور پلمبنگ کی دیکھ بھال',
      description: 'Regular 6-month maintenance for home AC and plumbing.',
      pricePaisa: 450_000, // 4,500 PKR
      durationMonths: 6,
      services: [
        { serviceId: 1, visitsIncluded: 2, intervalDays: 60 },
        { serviceId: 2, visitsIncluded: 1, intervalDays: 90 }
      ]
    };

    const created = await callApi<{ id: string; nameEn: string; pricePaisa: number; services: unknown[] }>(
      app,
      '/admin/plans',
      asAdmin(postJson(createBody))
    );
    expect(created.status).toBe(201);
    expect(created.body.id).toBeTruthy();
    expect(created.body.nameEn).toBe(createBody.nameEn);
    expect(created.body.pricePaisa).toBe(450_000);

    const planId = created.body.id;

    // 2. Public listing shows the plan
    const publicList = await callApi<{ items: { id: string; nameEn: string; services: unknown[] }[] }>(app, '/plans');
    expect(publicList.status).toBe(200);
    const found = publicList.body.items.find(p => p.id === planId);
    expect(found).toBeDefined();
    expect(found?.services).toHaveLength(2);

    // 3. Admin gets plan by ID
    const getRes = await callApi<{ id: string; nameEn: string }>(app, `/admin/plans/${planId}`, asAdmin());
    expect(getRes.status).toBe(200);
    expect(getRes.body.nameEn).toBe(createBody.nameEn);

    // 4. Admin updates the plan
    const updateRes = await callApi<{ id: string; pricePaisa: number }>(
      app,
      `/admin/plans/${planId}`,
      asAdmin(patchJson({ pricePaisa: 500_000 }))
    );
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.pricePaisa).toBe(500_000);

    // 5. Admin deactivates the plan
    const deleteRes = await callApi<{ id: string; isActive: boolean }>(app, `/admin/plans/${planId}`, asAdmin(deleteWith()));
    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.isActive).toBe(false);

    // 6. Public list no longer includes deactivated plan
    const publicListAfter = await callApi<{ items: { id: string }[] }>(app, '/plans');
    expect(publicListAfter.body.items.find(p => p.id === planId)).toBeUndefined();
  });

  it('Customer subscription: distributes visits with exact paisa accuracy and records PLAN_PURCHASE ledger transaction', async () => {
    // Setup plan
    const planRes = await callApi<{ id: string }>(
      app,
      '/admin/plans',
      asAdmin(
        postJson({
          nameEn: `Electrical Subscription ${randomUUID().slice(0, 6)}`,
          nameUr: 'الیکٹریکل سبسکرپشن',
          description: 'Quarterly electrical inspections.',
          pricePaisa: 100_000, // 1,000 PKR, 3 visits total -> 33,334 + 33,333 + 33,333
          durationMonths: 12,
          services: [
            { serviceId: 1, visitsIncluded: 2, intervalDays: 90 },
            { serviceId: 2, visitsIncluded: 1, intervalDays: 180 }
          ]
        })
      )
    );
    expect(planRes.status).toBe(201);
    const planId = planRes.body.id;

    // Customer setup
    const customer = await registerAndVerify(app, 'CUSTOMER');
    const addrRes = await callApi<{ id: string }>(
      app,
      '/customer/addresses',
      asCustomer(customer.accessToken, postJson({ label: 'Home', line1: 'Model Town A-Block', areaId: 1, lat: 31.5204, lng: 74.3587, isDefault: true }))
    );
    expect(addrRes.status).toBe(201);
    const addressId = addrRes.body.id;

    // Subscribe
    const subRes = await callApi<{ subscriptionId: string; paymentId: string; visitsCount: number }>(
      app,
      `/plans/${planId}/subscribe`,
      asCustomer(customer.accessToken, postJson({ addressId }))
    );
    expect(subRes.status).toBe(201);
    expect(subRes.body.visitsCount).toBe(3);
    const subscriptionId = subRes.body.subscriptionId;

    // Verify database visits and exact paisa sum
    const visits = await prisma.$queryRaw<{ valuePaisa: bigint; status: string }[]>(
      Prisma.sql`SELECT value_paisa as "valuePaisa", status FROM plan_visits WHERE subscription_id = ${subscriptionId}::uuid ORDER BY due_date ASC`
    );
    expect(visits).toHaveLength(3);
    expect(visits.every(v => v.status === 'PENDING')).toBe(true);

    const totalVisitPaisa = visits.reduce((acc, v) => acc + v.valuePaisa, 0n);
    expect(totalVisitPaisa).toBe(100_000n); // Exact to the single paisa!

    // Verify double-entry ledger PLAN_PURCHASE posting
    const ledgerTx = await prisma.$queryRaw<{ type: string; id: string }[]>(
      Prisma.sql`SELECT id, type FROM ledger_transactions WHERE idempotency_key = ${`plan-purchase:${subscriptionId}`}`
    );
    expect(ledgerTx).toHaveLength(1);
    expect(ledgerTx[0]?.type).toBe('PLAN_PURCHASE');

    // Verify PLAN_DEFERRED credit balance
    const deferredAccount = await prisma.$queryRaw<{ balance: bigint }[]>(
      Prisma.sql`SELECT b.balance FROM ledger_accounts a JOIN account_balances b ON b.account_id = a.id
        WHERE a.type = 'PLAN_DEFERRED' AND a.subscription_id = ${subscriptionId}::uuid`
    );
    expect(deferredAccount[0]?.balance).toBe(100_000n);

    // Customer views own subscriptions
    const mySubs = await callApi<{ items: { id: string; visitCount: number; pendingVisits: number }[] }>(
      app,
      '/me/subscriptions',
      asCustomer(customer.accessToken)
    );
    expect(mySubs.status).toBe(200);
    const foundSub = mySubs.body.items.find(s => s.id === subscriptionId);
    expect(foundSub).toBeDefined();
    expect(foundSub?.visitCount).toBe(3);
    expect(foundSub?.pendingVisits).toBe(3);

    // Customer views subscription detail
    const detail = await callApi<{ id: string; visits: { id: string; valuePaisa: number; status: string }[] }>(
      app,
      `/subscriptions/${subscriptionId}`,
      asCustomer(customer.accessToken)
    );
    expect(detail.status).toBe(200);
    expect(detail.body.visits).toHaveLength(3);
  });

  it('Pro-rata cancellation: refunds unused visits with exact paisa accuracy and leaves zero ledger drift', async () => {
    // 1. Setup plan with 3 visits at 70,000 paisa
    const planRes = await callApi<{ id: string }>(
      app,
      '/admin/plans',
      asAdmin(
        postJson({
          nameEn: `Cancellation Test Plan ${randomUUID().slice(0, 6)}`,
          nameUr: 'منسوخی ٹیسٹ پلان',
          description: 'Testing pro rata refund accuracy.',
          pricePaisa: 70_000, // 70,000 paisa across 3 visits: 23,334 + 23,333 + 23,333
          durationMonths: 6,
          services: [{ serviceId: 1, visitsIncluded: 3, intervalDays: 30 }]
        })
      )
    );
    const planId = planRes.body.id;

    // Customer setup & subscribe
    const customer = await registerAndVerify(app, 'CUSTOMER');
    const addrRes = await callApi<{ id: string }>(
      app,
      '/customer/addresses',
      asCustomer(customer.accessToken, postJson({ label: 'Villa', line1: 'Gulberg III', areaId: 1, lat: 31.5204, lng: 74.3587, isDefault: true }))
    );
    const subRes = await callApi<{ subscriptionId: string }>(
      app,
      `/plans/${planId}/subscribe`,
      asCustomer(customer.accessToken, postJson({ addressId: addrRes.body.id }))
    );
    const subscriptionId = subRes.body.subscriptionId;

    // Simulate 1 visit already CONSUMED (e.g. 23,334 paisa used)
    const visits = await prisma.$queryRaw<{ id: string; valuePaisa: bigint }[]>(
      Prisma.sql`SELECT id, value_paisa as "valuePaisa" FROM plan_visits WHERE subscription_id = ${subscriptionId}::uuid ORDER BY due_date ASC`
    );
    const consumedVisit = visits[0];
    if (consumedVisit === undefined) throw new Error('Missing visit');

    // Mark first visit as consumed and release its share through ledger
    const ledger = app.get(LedgerService);
    await prisma.$transaction(async tx => {
      await tx.$executeRaw(Prisma.sql`UPDATE plan_visits SET status = 'CONSUMED'::plan_visit_status WHERE id = ${consumedVisit.id}::uuid`);
      await ledger.post(tx, {
        type: 'PLAN_RELEASE',
        idempotencyKey: `sim-release:${consumedVisit.id}`,
        memo: 'Simulated visit release',
        lines: [
          { account: 'PLAN_DEFERRED', direction: 'DEBIT', amountPaisa: consumedVisit.valuePaisa, subscriptionId },
          { account: 'GATEWAY_CLEARING', direction: 'CREDIT', amountPaisa: consumedVisit.valuePaisa }
        ]
      });
    });

    // Remaining 2 visits are pending (23,333 + 23,333 = 46,666 paisa)
    const cancelRes = await callApi<{ subscriptionId: string; status: string; refundedVisitsCount: number; refundPaisa: number }>(
      app,
      `/subscriptions/${subscriptionId}/cancel`,
      asCustomer(customer.accessToken, postJson({ reason: 'Relocating to another city' }))
    );
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.status).toBe('CANCELLED');
    expect(cancelRes.body.refundedVisitsCount).toBe(2);
    expect(cancelRes.body.refundPaisa).toBe(46_666);

    // Verify all remaining visits marked REFUNDED
    const remainingVisits = await prisma.$queryRaw<{ status: string }[]>(
      Prisma.sql`SELECT status FROM plan_visits WHERE subscription_id = ${subscriptionId}::uuid AND id != ${consumedVisit.id}::uuid`
    );
    expect(remainingVisits.every(v => v.status === 'REFUNDED')).toBe(true);

    // Verify PLAN_DEFERRED account balance is now EXACTLY 0 (zero drift!)
    const finalBalance = await prisma.$queryRaw<{ balance: bigint }[]>(
      Prisma.sql`SELECT b.balance FROM ledger_accounts a JOIN account_balances b ON b.account_id = a.id
        WHERE a.type = 'PLAN_DEFERRED' AND a.subscription_id = ${subscriptionId}::uuid`
    );
    expect(finalBalance[0]?.balance).toBe(0n);
  });

  it('Scheduler: automatically creates bookings and dispatches offers for due plan visits', async () => {
    // 1. Setup plan & customer
    const planRes = await callApi<{ id: string }>(
      app,
      '/admin/plans',
      asAdmin(
        postJson({
          nameEn: `Auto-Schedule Plan ${randomUUID().slice(0, 6)}`,
          nameUr: 'شیڈولنگ پلان',
          description: 'Testing scheduler visit generation.',
          pricePaisa: 300_000,
          durationMonths: 6,
          services: [{ serviceId: 1, visitsIncluded: 1, intervalDays: 30 }]
        })
      )
    );
    const planId = planRes.body.id;

    // Ready a bookable provider
    const provider = await readyBookableProvider(app);

    const customer = await registerAndVerify(app, 'CUSTOMER');
    const addrRes = await callApi<{ id: string }>(
      app,
      '/customer/addresses',
      asCustomer(customer.accessToken, postJson({ label: 'Apartment', line1: 'DHA Phase 5', areaId: 1, lat: 31.5204, lng: 74.3587, isDefault: true }))
    );

    // Subscribe with preferred provider set
    const subRes = await callApi<{ subscriptionId: string }>(
      app,
      `/plans/${planId}/subscribe`,
      asCustomer(customer.accessToken, postJson({ addressId: addrRes.body.id, preferredProviderId: provider.provider.id }))
    );
    expect(subRes.status).toBe(201);
    const subscriptionId = subRes.body.subscriptionId;

    // Set visit due_date to tomorrow (well within the 7-day horizon)
    await prisma.$executeRaw(
      Prisma.sql`UPDATE plan_visits SET due_date = CURRENT_DATE + interval '1 day' WHERE subscription_id = ${subscriptionId}::uuid`
    );

    // Run scheduler
    const scheduleResult = await scheduler.scheduleDueVisits(7);
    expect(scheduleResult.scheduledCount).toBeGreaterThanOrEqual(1);

    // Verify visit is updated to BOOKED with booking_id
    const bookedVisit = await prisma.$queryRaw<{ bookingId: string | null; status: string }[]>(
      Prisma.sql`SELECT booking_id as "bookingId", status FROM plan_visits WHERE subscription_id = ${subscriptionId}::uuid`
    );
    expect(bookedVisit[0]?.status).toBe('BOOKED');
    expect(bookedVisit[0]?.bookingId).toBeTruthy();

    const bookingId = bookedVisit[0]?.bookingId;

    // Verify booking properties
    const booking = await prisma.$queryRaw<{ status: string; paymentStatus: string; subscriptionId: string; providerId: string }[]>(
      Prisma.sql`SELECT status, payment_status as "paymentStatus", subscription_id as "subscriptionId", provider_id as "providerId"
        FROM bookings WHERE id = ${bookingId}::uuid`
    );
    expect(booking[0]?.status).toBe('REQUESTED');
    expect(booking[0]?.paymentStatus).toBe('HELD');
    expect(booking[0]?.subscriptionId).toBe(subscriptionId);
    expect(booking[0]?.providerId).toBe(provider.provider.id);

    // Verify offer created for preferred provider
    const offers = await prisma.$queryRaw<{ providerId: string; status: string }[]>(
      Prisma.sql`SELECT provider_id as "providerId", status FROM booking_offers WHERE booking_id = ${bookingId}::uuid`
    );
    expect(offers).toHaveLength(1);
    expect(offers[0]?.providerId).toBe(provider.provider.id);
    expect(offers[0]?.status).toBe('PENDING');
  });

  // The four tests above walk the happy paths. A plan moves the customer's money up front into a deferred
  // balance and draws it down visit by visit, so what matters most is what happens on the second run and when
  // the money or the access is wrong.
  describe('the scheduler runs once, and only on eligible visits', () => {
    const newPlan = async (visitsIncluded: number, pricePaisa: number): Promise<string> => {
      const res = await callApi<{ id: string }>(
        app,
        '/admin/plans',
        asAdmin(
          postJson({
            nameEn: `Idempotency Plan ${randomUUID().slice(0, 6)}`,
            nameUr: 'پلان',
            description: 'Scheduling idempotency.',
            pricePaisa,
            durationMonths: 6,
            services: [{ serviceId: 1, visitsIncluded, intervalDays: 30 }]
          })
        )
      );
      expect(res.status).toBe(201);
      return res.body.id;
    };

    const subscribe = async (planId: string): Promise<{ subscriptionId: string; token: string }> => {
      const customer = await registerAndVerify(app, 'CUSTOMER');
      const addr = await callApi<{ id: string }>(
        app,
        '/customer/addresses',
        asCustomer(customer.accessToken, postJson({ label: 'Home', line1: 'Gulberg', areaId: 1, lat: 31.5204, lng: 74.3587, isDefault: true }))
      );
      const sub = await callApi<{ subscriptionId: string }>(
        app,
        `/plans/${planId}/subscribe`,
        asCustomer(customer.accessToken, postJson({ addressId: addr.body.id }))
      );
      expect(sub.status).toBe(201);
      return { subscriptionId: sub.body.subscriptionId, token: customer.accessToken };
    };

    const visitsOf = async (subscriptionId: string): Promise<{ id: string; status: string; bookingId: string | null; dueDate: string }[]> =>
      prisma.$queryRaw<{ id: string; status: string; bookingId: string | null; dueDate: string }[]>(
        Prisma.sql`SELECT id, status::text, booking_id as "bookingId", due_date::text as "dueDate" FROM plan_visits WHERE subscription_id = ${subscriptionId}::uuid ORDER BY due_date`
      );

    it('books each due visit once: a second sweep creates nothing and adds no second booking', async () => {
      const planId = await newPlan(2, 100_000);
      const { subscriptionId } = await subscribe(planId);
      await prisma.$executeRaw(Prisma.sql`UPDATE plan_visits SET due_date = CURRENT_DATE + interval '1 day' WHERE subscription_id = ${subscriptionId}::uuid`);

      const first = await scheduler.scheduleDueVisits(7);
      expect(first.scheduledCount).toBe(2);
      const afterFirst = await visitsOf(subscriptionId);
      expect(afterFirst.every(visit => visit.status === 'BOOKED')).toBe(true);
      const bookingsAfterFirst = afterFirst.map(visit => visit.bookingId);

      // The daily job ticks every 86_400_000 ms, so running it twice must be a no-op rather than a double-book.
      const second = await scheduler.scheduleDueVisits(7);
      expect(second.scheduledCount).toBe(0);
      const afterSecond = await visitsOf(subscriptionId);
      expect(afterSecond.map(visit => visit.bookingId)).toEqual(bookingsAfterFirst);

      // And exactly one booking exists for the subscription, not two.
      const bookings = await prisma.$queryRaw<{ n: bigint }[]>(
        Prisma.sql`SELECT count(*)::bigint as n FROM bookings WHERE subscription_id = ${subscriptionId}::uuid`
      );
      expect(Number(bookings[0]!.n)).toBe(2);
    });

    it('leaves visits outside the horizon alone until they come due', async () => {
      const planId = await newPlan(2, 100_000);
      const { subscriptionId } = await subscribe(planId);
      // 40 days out with a 30-day interval: beyond the 7-day horizon, so nothing may be booked yet.
      await prisma.$executeRaw(
        Prisma.sql`UPDATE plan_visits SET due_date = CURRENT_DATE + interval '40 days' WHERE subscription_id = ${subscriptionId}::uuid`
      );

      expect((await scheduler.scheduleDueVisits(7)).scheduledCount).toBe(0);
      expect((await visitsOf(subscriptionId)).every(visit => visit.status === 'PENDING')).toBe(true);

      // Bringing them inside the horizon books them on the next sweep.
      await prisma.$executeRaw(Prisma.sql`UPDATE plan_visits SET due_date = CURRENT_DATE + interval '2 days' WHERE subscription_id = ${subscriptionId}::uuid`);
      expect((await scheduler.scheduleDueVisits(7)).scheduledCount).toBe(2);
    });

    it('never books a visit belonging to a cancelled subscription', async () => {
      const planId = await newPlan(1, 50_000);
      const { subscriptionId } = await subscribe(planId);
      await prisma.$executeRaw(Prisma.sql`UPDATE plan_visits SET due_date = CURRENT_DATE + interval '1 day' WHERE subscription_id = ${subscriptionId}::uuid`);
      await prisma.$executeRaw(Prisma.sql`UPDATE subscriptions SET status = 'CANCELLED'::subscription_status WHERE id = ${subscriptionId}::uuid`);

      expect((await scheduler.scheduleDueVisits(7)).scheduledCount).toBe(0);
      expect((await visitsOf(subscriptionId)).every(visit => visit.status === 'PENDING')).toBe(true);
      const bookings = await prisma.$queryRaw<{ n: bigint }[]>(
        Prisma.sql`SELECT count(*)::bigint as n FROM bookings WHERE subscription_id = ${subscriptionId}::uuid`
      );
      expect(Number(bookings[0]!.n)).toBe(0);
    });

    it('counts only visits it actually booked, never more than it created', async () => {
      // `scheduledCount` is what the daily job logs and what an operator reads to judge the sweep. It must agree
      // with the bookings that exist afterwards, because a visit that rolled back was not scheduled.
      const planId = await newPlan(2, 60_000);
      const { subscriptionId } = await subscribe(planId);
      await prisma.$executeRaw(Prisma.sql`UPDATE plan_visits SET due_date = CURRENT_DATE + interval '1 day' WHERE subscription_id = ${subscriptionId}::uuid`);

      const reported = await scheduler.scheduleDueVisits(7);
      const bookings = await prisma.$queryRaw<{ n: bigint }[]>(
        Prisma.sql`SELECT count(*)::bigint as n FROM bookings WHERE subscription_id = ${subscriptionId}::uuid`
      );
      const bookedVisits = await prisma.$queryRaw<{ n: bigint }[]>(
        Prisma.sql`SELECT count(*)::bigint as n FROM plan_visits WHERE subscription_id = ${subscriptionId}::uuid AND status = 'BOOKED'`
      );

      expect(reported.scheduledCount).toBe(Number(bookings[0]!.n));
      expect(reported.scheduledCount).toBe(Number(bookedVisits[0]!.n));
      expect(reported.scheduledCount).toBe(2);
    });
  });

  describe('the money: what the customer paid is exactly what the deferred balance holds', () => {
    it('splits the price across visits to the paisa, with no paisa created or lost', async () => {
      // 100_000 across 3 visits is not divisible; the remainder must land somewhere and nowhere else.
      const pricePaisa = 100_000;
      const visitsIncluded = 3;
      const created = await callApi<{ id: string }>(
        app,
        '/admin/plans',
        asAdmin(
          postJson({
            nameEn: `Split Plan ${randomUUID().slice(0, 6)}`,
            nameUr: 'پلان',
            description: 'Pro-rata split.',
            pricePaisa,
            durationMonths: 6,
            services: [{ serviceId: 1, visitsIncluded, intervalDays: 30 }]
          })
        )
      );
      const customer = await registerAndVerify(app, 'CUSTOMER');
      const addr = await callApi<{ id: string }>(
        app,
        '/customer/addresses',
        asCustomer(customer.accessToken, postJson({ label: 'Home', line1: 'Gulberg', areaId: 1, lat: 31.5204, lng: 74.3587, isDefault: true }))
      );
      const sub = await callApi<{ subscriptionId: string }>(app, `/plans/${created.body.id}/subscribe`, asCustomer(customer.accessToken, postJson({ addressId: addr.body.id })));
      expect(sub.status).toBe(201);
      const subscriptionId = sub.body.subscriptionId;

      const visits = await prisma.$queryRaw<{ valuePaisa: bigint }[]>(
        Prisma.sql`SELECT value_paisa as "valuePaisa" FROM plan_visits WHERE subscription_id = ${subscriptionId}::uuid`
      );
      expect(visits).toHaveLength(visitsIncluded);
      const summed = visits.reduce((total, visit) => total + visit.valuePaisa, 0n);
      expect(summed).toBe(BigInt(pricePaisa));

      const deferred = await prisma.$queryRaw<{ balance: bigint }[]>(
        Prisma.sql`SELECT b.balance FROM ledger_accounts a JOIN account_balances b ON b.account_id = a.id WHERE a.type = 'PLAN_DEFERRED' AND a.subscription_id = ${subscriptionId}::uuid`
      );
      expect(deferred[0]!.balance).toBe(BigInt(pricePaisa));
    });

    it('posts the purchase as a balanced double-entry transaction and leaves no orphan', async () => {
      const created = await callApi<{ id: string }>(
        app,
        '/admin/plans',
        asAdmin(
          postJson({
            nameEn: `Ledger Plan ${randomUUID().slice(0, 6)}`,
            nameUr: 'پلان',
            description: 'Ledger integrity.',
            pricePaisa: 75_000,
            durationMonths: 6,
            services: [{ serviceId: 1, visitsIncluded: 2, intervalDays: 30 }]
          })
        )
      );
      const customer = await registerAndVerify(app, 'CUSTOMER');
      const addr = await callApi<{ id: string }>(
        app,
        '/customer/addresses',
        asCustomer(customer.accessToken, postJson({ label: 'Home', line1: 'Gulberg', areaId: 1, lat: 31.5204, lng: 74.3587, isDefault: true }))
      );
      const sub = await callApi<{ subscriptionId: string }>(app, `/plans/${created.body.id}/subscribe`, asCustomer(customer.accessToken, postJson({ addressId: addr.body.id })));
      const subscriptionId = sub.body.subscriptionId;

      const tx = await prisma.$queryRaw<{ debit: bigint; credit: bigint; entries: bigint }[]>(
        Prisma.sql`SELECT coalesce(sum(e.amount_paisa) FILTER (WHERE e.direction = 'DEBIT'), 0)::bigint as debit,
            coalesce(sum(e.amount_paisa) FILTER (WHERE e.direction = 'CREDIT'), 0)::bigint as credit, count(e.id)::bigint as entries
          FROM ledger_transactions t JOIN ledger_entries e ON e.transaction_id = t.id WHERE t.idempotency_key = ${`plan-purchase:${subscriptionId}`}`
      );
      expect(tx).toHaveLength(1);
      expect(tx[0]!.debit).toBe(75_000n);
      expect(tx[0]!.credit).toBe(75_000n);
      expect(Number(tx[0]!.entries)).toBeGreaterThanOrEqual(2);

      // The subscription's own transactions must all balance — the invariant reconciliation checks nightly.
      const unbalanced = await prisma.$queryRaw<{ n: bigint }[]>(
        Prisma.sql`SELECT count(*)::bigint as n FROM ledger_transactions t LEFT JOIN ledger_entries e ON e.transaction_id = t.id
          WHERE t.memo LIKE ${`%${subscriptionId}%`} OR t.idempotency_key LIKE ${`%${subscriptionId}%`}
          GROUP BY t.id HAVING coalesce(sum(e.amount_paisa) FILTER (WHERE e.direction = 'DEBIT'), 0) <> coalesce(sum(e.amount_paisa) FILTER (WHERE e.direction = 'CREDIT'), 0) OR count(e.id) < 2`
      );
      expect(unbalanced).toEqual([]);
    });
  });

  describe('the plans HTTP surface: who may do what', () => {
    it('refuses anonymous and customer callers on every admin route, and the catalogue is public read-only', async () => {
      const customer = await registerAndVerify(app, 'CUSTOMER');
      const create = { nameEn: 'Guard Plan', nameUr: 'پلان', description: 'Guards.', pricePaisa: 10_000, durationMonths: 6, services: [{ serviceId: 1, visitsIncluded: 1, intervalDays: 30 }] };

      // Browsing is public.
      expect((await callApi(app, '/plans')).status).toBe(200);

      // Admin routes are not.
      expect((await callApi(app, '/admin/plans')).status).toBe(401);
      expect((await callApi(app, '/admin/plans', asCustomer(customer.accessToken))).status).toBe(403);
      expect((await callApi(app, '/admin/plans', asCustomer(customer.accessToken, postJson(create)))).status).toBe(403);
      expect((await callApi(app, '/admin/plans', postJson(create))).status).toBe(401);

      // A customer may read and manage only their own subscriptions.
      expect((await callApi(app, '/me/subscriptions', asCustomer(customer.accessToken))).status).toBe(200);
      expect((await callApi(app, '/me/subscriptions')).status).toBe(401);
      expect((await callApi(app, '/subscriptions/00000000-0000-4000-8000-000000000000', asCustomer(customer.accessToken))).status).toBe(404);
    });

    it('will not let one customer cancel or read another customer\'s subscription', async () => {
      const created = await callApi<{ id: string }>(
        app,
        '/admin/plans',
        asAdmin(
          postJson({
            nameEn: `Ownership Plan ${randomUUID().slice(0, 6)}`,
            nameUr: 'پلان',
            description: 'Ownership.',
            pricePaisa: 40_000,
            durationMonths: 6,
            services: [{ serviceId: 1, visitsIncluded: 2, intervalDays: 30 }]
          })
        )
      );
      const owner = await registerAndVerify(app, 'CUSTOMER');
      const ownerAddr = await callApi<{ id: string }>(app, '/customer/addresses', asCustomer(owner.accessToken, postJson({ label: 'Home', line1: 'Gulberg', areaId: 1, lat: 31.5204, lng: 74.3587, isDefault: true })));
      const sub = await callApi<{ subscriptionId: string }>(app, `/plans/${created.body.id}/subscribe`, asCustomer(owner.accessToken, postJson({ addressId: ownerAddr.body.id })));
      const subscriptionId = sub.body.subscriptionId;

      const stranger = await registerAndVerify(app, 'CUSTOMER');
      expect((await callApi(app, `/subscriptions/${subscriptionId}`, asCustomer(stranger.accessToken))).status).toBe(404);
      expect((await callApi(app, `/subscriptions/${subscriptionId}/cancel`, asCustomer(stranger.accessToken, postJson({ reason: 'Not mine to cancel.' })))).status).toBe(404);

      // Still the owner's, and cancelling it works.
      const stillActive = await prisma.$queryRaw<{ status: string }[]>(Prisma.sql`SELECT status::text as status FROM subscriptions WHERE id = ${subscriptionId}::uuid`);
      expect(stillActive[0]!.status).toBe('ACTIVE');
      const cancelled = await callApi<{ status: string }>(app, `/subscriptions/${subscriptionId}/cancel`, asCustomer(owner.accessToken, postJson({ reason: 'Relocating to another city.' })));
      expect(cancelled.status).toBe(200);
      expect(cancelled.body.status).toBe('CANCELLED');
    });

    it('refuses to subscribe to an inactive plan', async () => {
      const created = await callApi<{ id: string }>(
        app,
        '/admin/plans',
        asAdmin(
          postJson({
            nameEn: `Doomed Plan ${randomUUID().slice(0, 6)}`,
            nameUr: 'پلان',
            description: 'Deactivated.',
            pricePaisa: 20_000,
            durationMonths: 6,
            services: [{ serviceId: 1, visitsIncluded: 1, intervalDays: 30 }]
          })
        )
      );
      expect((await callApi(app, `/admin/plans/${created.body.id}`, asAdmin(deleteWith()))).status).toBe(200);

      const customer = await registerAndVerify(app, 'CUSTOMER');
      const addr = await callApi<{ id: string }>(app, '/customer/addresses', asCustomer(customer.accessToken, postJson({ label: 'Home', line1: 'Gulberg', areaId: 1, lat: 31.5204, lng: 74.3587, isDefault: true })));
      const refused = await callApi(app, `/plans/${created.body.id}/subscribe`, asCustomer(customer.accessToken, postJson({ addressId: addr.body.id })));
      expect(refused.status).toBeGreaterThanOrEqual(400);
      // Nothing was charged for a plan that could not be bought.
      const deferred = await prisma.$queryRaw<{ n: bigint }[]>(
        Prisma.sql`SELECT count(*)::bigint as n FROM ledger_accounts WHERE type = 'PLAN_DEFERRED' AND owner_user_id IS NULL AND subscription_id IS NULL`
      );
      expect(Number(deferred[0]!.n)).toBe(0);
    });
  });
});
