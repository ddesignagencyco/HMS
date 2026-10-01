// apps/api/test/integration/payments-cash.test.ts
//
// SHM-060: cash settlement, the commission-debt ceiling, and paying debt online.
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { commissionOnPaisa } from '@smart-home/domain';
import { NotificationService } from '../../src/notification/notification.service.js';
import { SettingsService } from '../../src/platform/settings.service.js';
import { adminSession, callApi, createTestApp, postJson, registerAndVerify } from './harness.js';
import { agentSession, agentVerify, bearer, completedJob, dropLocks, freezeInsideCallingHours, newProvider, prisma, unfreeze, walletOf, type Job, type Provider } from './flow.js';

let app: NestExpressApplication;
let close: () => Promise<void>;
let agent: { accessToken: string; userId: string };

beforeAll(async () => {
  const started = await createTestApp();
  app = started.app;
  close = started.close;
  freezeInsideCallingHours(app);
  agent = await agentSession(app, 'agent1');
});

afterEach(async () => {
  freezeInsideCallingHours(app);
  await dropLocks(agent.userId);
});

afterAll(async () => {
  unfreeze(app);
  await close();
  await prisma.$disconnect();
});

const cashReceived = (job: Job, token = job.provider.accessToken) => callApi<{ status: string; paymentStatus: string; code?: string }>(app, `/bookings/${job.id}/cash-received`, bearer(token, { method: 'POST' }));
const bookingFacts = async (id: string) => (await prisma.$queryRaw<{ final: bigint; discount: bigint; rate: number }[]>(Prisma.sql`SELECT final_amount_paisa as final, discount_paisa as discount, commission_rate_bp as rate FROM bookings WHERE id = ${id}::uuid`))[0]!;

describe('SHM-060: settling a cash job', () => {
  it('waits for verification, then debits the provider’s commission and releases the job', async () => {
    const provider = await newProvider(app);
    const job = await completedJob(app, provider, { mode: 'CASH' });
    expect((await cashReceived(job)).status).toBe(409);

    expect((await agentVerify(app, agent, job)).body).toMatchObject({ bookingStatus: 'VERIFIED', released: false });
    const walletBefore = await walletOf(provider.id);
    const settled = await cashReceived(job);
    expect(settled.status).toBe(200);
    expect(settled.body).toMatchObject({ status: 'PAYMENT_RELEASED', paymentStatus: 'CASH_SETTLED' });

    const facts = await bookingFacts(job.id);
    const commission = commissionOnPaisa(facts.final, BigInt(facts.rate));
    const lines = await prisma.$queryRaw<{ account: string; direction: string; amount: bigint }[]>(
      Prisma.sql`SELECT a.type::text as account, e.direction::text as direction, e.amount_paisa as amount FROM ledger_transactions t JOIN ledger_entries e ON e.transaction_id = t.id JOIN ledger_accounts a ON a.id = e.account_id
        WHERE t.idempotency_key = ${`cash-settlement:${job.id}`} ORDER BY e.id`
    );
    expect(lines).toEqual([
      { account: 'PROVIDER_WALLET', direction: 'DEBIT', amount: commission },
      { account: 'PLATFORM_COMMISSION', direction: 'CREDIT', amount: commission }
    ]);
    expect(walletBefore - (await walletOf(provider.id))).toBe(commission);

    // Once only, and only by the job's own provider, and never for an online job.
    expect((await cashReceived(job)).status).toBe(409);
    const other = await registerAndVerify(app, 'PROVIDER');
    const second = await completedJob(app, provider, { mode: 'CASH' });
    await agentVerify(app, agent, second);
    expect((await cashReceived(second, other.accessToken)).status).toBe(404);
    const online = await completedJob(app, provider, { mode: 'ONLINE' });
    await agentVerify(app, agent, online);
    expect((await cashReceived(online)).status).toBe(409);
  });

  it('a coupon on a cash job is credited back to the provider, so they are paid on the price before it', async () => {
    const code = `C${randomUUID().slice(0, 8)}`.toUpperCase();
    await prisma.$executeRaw(Prisma.sql`INSERT INTO coupons(code, kind, value, valid_from, valid_to) VALUES (${code}::citext, 'FIXED', 50000, now() - interval '1 day', now() + interval '1 day')`);
    const provider = await newProvider(app);
    const job = await completedJob(app, provider, { mode: 'CASH', couponCode: code });
    await agentVerify(app, agent, job);
    await cashReceived(job);
    const facts = await bookingFacts(job.id);
    expect(facts.discount).toBe(50_000n);
    const commission = commissionOnPaisa(facts.final + facts.discount, BigInt(facts.rate));
    expect(await walletOf(provider.id)).toBe(50_000n - commission);
    const promo = await prisma.$queryRaw<{ n: bigint }[]>(
      Prisma.sql`SELECT count(*)::bigint as n FROM ledger_transactions t JOIN ledger_entries e ON e.transaction_id = t.id JOIN ledger_accounts a ON a.id = e.account_id WHERE t.booking_id = ${job.id}::uuid AND a.type = 'PROMO_EXPENSE' AND e.direction = 'DEBIT'`
    );
    expect(promo[0]?.n).toBe(1n);
  });

  it('texts the customer a receipt with a link to report a problem', async () => {
    const provider = await newProvider(app);
    const job = await completedJob(app, provider, { mode: 'CASH' });
    await agentVerify(app, agent, job);
    await cashReceived(job);
    const events = await prisma.$queryRaw<{ id: bigint; type: string; payload: Record<string, unknown> }[]>(Prisma.sql`SELECT id, type, payload FROM outbox_events WHERE payload->>'bookingId' = ${job.id} ORDER BY id`);
    for (const event of events) await app.get(NotificationService).handle({ outboxId: event.id.toString(), eventType: event.type, payload: event.payload });
    const inbox = await callApi<{ items: { recipient: string; body: string }[] }>(app, '/dev/inbox?limit=200');
    const receipt = inbox.body.items.find(item => item.recipient === job.customer.phoneE164 && /Receipt/i.test(item.body));
    expect(receipt?.body).toContain(job.code);
    expect(receipt?.body).toMatch(/\/problem\/[A-Za-z0-9_-]+\.[0-9a-f]{24}/);
    expect(receipt?.body).toContain('PKR');
  });
});

describe('SHM-060: the commission-debt ceiling', () => {
  /** A ceiling low enough that one cash job's commission crosses it. Restored afterwards. */
  const withCeiling = async <T>(paisa: number, run: () => Promise<T>): Promise<T> => {
    const settings = app.get(SettingsService);
    const admin = await adminSession(app);
    const original = await settings.get<number>('cash.debt_ceiling_paisa');
    await settings.set('cash.debt_ceiling_paisa', paisa, admin.userId);
    try {
      return await run();
    } finally {
      if (original !== null) await settings.set('cash.debt_ceiling_paisa', original, admin.userId);
    }
  };

  const blockedReason = async (id: string): Promise<string | null> => (await prisma.$queryRaw<{ reason: string | null }[]>(Prisma.sql`SELECT offer_blocked_reason as reason FROM providers WHERE user_id = ${id}::uuid`))[0]!.reason;

  const settledCashJob = async (provider: Provider): Promise<Job> => {
    const job = await completedJob(app, provider, { mode: 'CASH' });
    await agentVerify(app, agent, job);
    expect((await cashReceived(job)).status).toBe(200);
    return job;
  };

  const wallet = (provider: Provider) => callApi<{ balancePaisa: number; debtPaisa: number; debtCeilingPaisa: number; offersBlocked: boolean; offerBlockedReason: string | null }>(app, '/provider/wallet', bearer(provider.accessToken));

  it('commission debt over the ceiling blocks offers: no direct booking, no auto-assign, nothing on their offer list, not in search', async () => {
    await withCeiling(10_000, async () => {
      const provider = await newProvider(app, { lat: 21.1 + Math.random(), lng: 61.1 + Math.random() });
      const first = await settledCashJob(provider);
      const state = await wallet(provider);
      expect(state.body).toMatchObject({ offersBlocked: true, offerBlockedReason: 'DEBT', debtCeilingPaisa: 10_000 });
      expect(state.body.debtPaisa).toBeGreaterThan(10_000);
      expect(state.body.balancePaisa).toBe(-state.body.debtPaisa);
      expect(await blockedReason(provider.id)).toBe('DEBT');

      const customer = await registerAndVerify(app, 'CUSTOMER');
      const address = await callApi<{ id: string }>(app, '/customer/addresses', bearer(customer.accessToken, postJson({ label: 'Home', line1: 'House 1', areaId: provider.areaId, lat: 31.52, lng: 74.35, isDefault: true })));
      const start = new Date(Date.now() + 9_000 * 3_600_000);
      const slot = { scheduledStart: start.toISOString(), scheduledEnd: new Date(start.getTime() + 3_600_000).toISOString() };
      const direct = await callApi<{ code: string }>(app, '/bookings', bearer(customer.accessToken, postJson({ providerId: provider.id, serviceId: provider.serviceId, addressId: address.body.id, ...slot })));
      expect(direct.status).toBe(409);
      expect(direct.body.code).toBe('DEBT_BLOCKED');

      // An auto-assign job near this provider is never offered to them.
      const near = await callApi<{ items: { providerId: string }[] }>(app, `/search/providers?serviceSlug=leak-repair&lat=31.5204&lng=74.3587`);
      expect(near.body.items.map(item => item.providerId)).not.toContain(provider.id);
      expect(first.provider.id).toBe(provider.id);
    });
  });

  it('paying the debt online lifts the block the moment the payment is confirmed — and a part-payment that is still over the ceiling does not', async () => {
    await withCeiling(10_000, async () => {
      const provider = await newProvider(app, { lat: 22.1 + Math.random(), lng: 62.1 + Math.random() });
      await settledCashJob(provider);
      const debt = (await wallet(provider)).body.debtPaisa;
      expect(await blockedReason(provider.id)).toBe('DEBT');

      const overpay = await callApi(app, '/provider/debt/pay', bearer(provider.accessToken, postJson({ amountPaisa: debt + 1 })));
      expect(overpay.status).toBe(400);

      const partial = await callApi<{ paymentId: string; redirectUrl: string; amountPaisa: number }>(app, '/provider/debt/pay', bearer(provider.accessToken, postJson({ amountPaisa: 1_000 })));
      expect(partial.status).toBe(200);
      expect(partial.body.redirectUrl).toContain('/dev/payments/');
      // Nothing changes until the gateway says so.
      expect((await wallet(provider)).body.debtPaisa).toBe(debt);
      await callApi(app, `/dev/payments/${partial.body.paymentId}/complete?outcome=captured`, { method: 'POST' });
      await callApi(app, `/dev/payments/${partial.body.paymentId}/complete?outcome=captured`, { method: 'POST' });
      const afterPartial = await wallet(provider);
      expect(afterPartial.body.debtPaisa).toBe(debt - 1_000);
      expect(afterPartial.body.offersBlocked).toBe(true);

      const rest = await callApi<{ paymentId: string }>(app, '/provider/debt/pay', bearer(provider.accessToken, postJson({})));
      await callApi(app, `/dev/payments/${rest.body.paymentId}/complete?outcome=captured`, { method: 'POST' });
      const cleared = await wallet(provider);
      expect(cleared.body).toMatchObject({ balancePaisa: 0, debtPaisa: 0, offersBlocked: false, offerBlockedReason: null });
      expect(await blockedReason(provider.id)).toBeNull();

      // Each payment is one ledger transaction, and debt payments are payments like any other (money-safety invariants still hold).
      const txs = await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*)::bigint as n FROM ledger_transactions WHERE type = 'DEBT_PAYMENT' AND idempotency_key IN (${`capture:${partial.body.paymentId}`}, ${`capture:${rest.body.paymentId}`})`);
      expect(txs[0]?.n).toBe(2n);
      const nothing = await callApi(app, '/provider/debt/pay', bearer(provider.accessToken, postJson({})));
      expect(nothing.status).toBe(400);
    });
  });

  it('an online job released to the provider pays down the debt and unblocks them without any payment', async () => {
    await withCeiling(10_000, async () => {
      const provider = await newProvider(app, { lat: 23.1 + Math.random(), lng: 63.1 + Math.random() });
      // The online job is already done and waiting to be verified when the cash debt blocks the provider.
      const online = await completedJob(app, provider, { mode: 'ONLINE' });
      await settledCashJob(provider);
      expect(await blockedReason(provider.id)).toBe('DEBT');
      await agentVerify(app, agent, online);
      expect(await blockedReason(provider.id)).toBeNull();
      expect((await wallet(provider)).body.balancePaisa).toBeGreaterThan(0);
    });
  });

  it('a provider blocked for another reason stays blocked when their debt clears', async () => {
    await withCeiling(10_000, async () => {
      const provider = await newProvider(app, { lat: 24.1 + Math.random(), lng: 64.1 + Math.random() });
      await prisma.$executeRaw(Prisma.sql`UPDATE providers SET offer_blocked_reason = 'SUSPENDED' WHERE user_id = ${provider.id}::uuid`);
      await settledCashJob(provider);
      expect(await blockedReason(provider.id)).toBe('SUSPENDED');
    });
  });
});
