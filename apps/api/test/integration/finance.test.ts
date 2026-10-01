// apps/api/test/integration/finance.test.ts
//
// SHM-061 / SHM-062: the finance API, payouts, and the ledger reconciliation.
import { Prisma } from '@prisma/client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { SettingsService } from '../../src/platform/settings.service.js';
import { callApi, createTestApp, postJson, registerAndVerify, staffSession } from './harness.js';
import { agentSession, agentVerify, bearer, completedJob, dropLocks, freezeInsideCallingHours, newProvider, prisma, satisfied, unfreeze, walletOf, type Job, type Provider } from './flow.js';

let app: NestExpressApplication;
let close: () => Promise<void>;
let agent: { accessToken: string; userId: string };
let finance: { accessToken: string; userId: string };
let admin: { accessToken: string; userId: string };
let originalMinPayout: number | null;

beforeAll(async () => {
  const started = await createTestApp();
  app = started.app;
  close = started.close;
  freezeInsideCallingHours(app);
  agent = await agentSession(app, 'agent1');
  finance = await staffSession(app, 'finance@smart-home.local');
  admin = await staffSession(app, 'admin@smart-home.local');
  // A small job pays a provider well under the default minimum payout; lower it for these tests and put it back after.
  originalMinPayout = await app.get(SettingsService).get<number>('payout.min_amount_paisa');
  await app.get(SettingsService).set('payout.min_amount_paisa', 10_000, admin.userId);
});

afterEach(async () => {
  freezeInsideCallingHours(app);
  await dropLocks(agent.userId);
});

afterAll(async () => {
  if (originalMinPayout !== null) await app.get(SettingsService).set('payout.min_amount_paisa', originalMinPayout, admin.userId);
  unfreeze(app);
  await close();
  await prisma.$disconnect();
});

const asFinance = (init: RequestInit = {}): RequestInit => bearer(finance.accessToken, init);

/** A provider with money in their wallet: one online job, verified and released. */
const earningProvider = async (): Promise<{ provider: Provider; job: Job; wallet: bigint }> => {
  const provider = await newProvider(app);
  const job = await completedJob(app, provider, { mode: 'ONLINE' });
  await agentVerify(app, agent, job);
  return { provider, job, wallet: await walletOf(provider.id) };
};

const addAccount = (provider: Provider, number = '01234567890123') =>
  callApi<{ id: string; accountLast4: string; isDefault: boolean; accountNumber?: string }>(app, '/provider/payout-accounts', bearer(provider.accessToken, postJson({ kind: 'BANK', accountTitle: 'Bilal Ahmed', institution: 'HBL', accountNumber: number })));

const requestPayout = (provider: Provider, accountId: string, amountPaisa: number) =>
  callApi<{ id: string; status: string; code?: string }>(app, '/provider/payouts', bearer(provider.accessToken, postJson({ amountPaisa, payoutAccountId: accountId })));

const balanceOf = async (type: string): Promise<bigint> => (await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT coalesce(sum(b.balance), 0)::bigint as n FROM ledger_accounts a JOIN account_balances b ON b.account_id = a.id WHERE a.type = ${type}::account_type`))[0]!.n;

describe('SHM-061: who can see the books', () => {
  it('finance and admin can; agents, customers, providers and the anonymous cannot', async () => {
    const customer = await registerAndVerify(app, 'CUSTOMER');
    for (const path of ['/finance/escrow', '/finance/refunds', '/finance/payouts', '/finance/payout-batches', '/finance/cash-reconciliation', '/finance/debts', '/finance/ledger']) {
      expect((await callApi(app, path, asFinance())).status, path).toBe(200);
      expect((await callApi(app, path, bearer(admin.accessToken))).status, path).toBe(200);
      expect((await callApi(app, path, bearer(agent.accessToken))).status, path).toBe(403);
      expect((await callApi(app, path, bearer(customer.accessToken))).status, path).toBe(403);
      expect((await callApi(app, path)).status, path).toBe(401);
    }
  });
});

describe('SHM-061: escrow and refunds', () => {
  it('shows the money held for a job awaiting verification, and stops showing it once released', async () => {
    const provider = await newProvider(app);
    const job = await completedJob(app, provider, { mode: 'ONLINE' });
    const final = (await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT final_amount_paisa as n FROM bookings WHERE id = ${job.id}::uuid`))[0]!.n;

    const held = await callApi<{ totalHeldPaisa: number; items: { bookingId: string; heldPaisa: number; status: string }[] }>(app, '/finance/escrow', asFinance());
    expect(held.body.items.find(item => item.bookingId === job.id)).toMatchObject({ heldPaisa: Number(final), status: 'AWAITING_VERIFICATION' });
    expect(held.body.totalHeldPaisa).toBeGreaterThanOrEqual(Number(final));

    await agentVerify(app, agent, job);
    const after = await callApi<{ items: { bookingId: string }[] }>(app, '/finance/escrow', asFinance());
    expect(after.body.items.map(item => item.bookingId)).not.toContain(job.id);
  });

  it('refunds a disputed booking by hand to the original method, with the reason stored; refuses anything else', async () => {
    const provider = await newProvider(app);
    const job = await completedJob(app, provider, { mode: 'ONLINE' });
    const refundBody = (amount: number) => postJson({ bookingId: job.id, amountPaisa: amount, reasonCode: 'DISPUTE_PARTIAL', reasonText: 'Half the work was not done' }, finance.accessToken);

    // Not disputed yet: the ordinary flows own this money.
    expect((await callApi(app, '/finance/refunds', refundBody(10_000))).status).toBe(409);

    await agentVerify(app, agent, job, { ...satisfied, extraChargeDemanded: true, extraChargeAmountPaisa: 5_000, consentToRelease: false, outcome: 'DISPUTED' });
    const escrowBefore = await balanceOfBooking(job.id);
    expect((await callApi(app, '/finance/refunds', refundBody(Number(escrowBefore) + 1))).status).toBe(400);

    const refunded = await callApi<{ refundIds: string[] }>(app, '/finance/refunds', refundBody(30_000));
    expect(refunded.status).toBe(201);
    expect(refunded.body.refundIds).toHaveLength(1);
    expect(await balanceOfBooking(job.id)).toBe(escrowBefore - 30_000n);

    const list = await callApi<{ items: { id: string; bookingCode: string; amountPaisa: number; reasonCode: string; reasonText: string; status: string; gateway: string }[] }>(app, '/finance/refunds?status=SUCCEEDED', asFinance());
    expect(list.body.items.find(item => item.id === refunded.body.refundIds[0])).toMatchObject({ bookingCode: job.code, amountPaisa: 30_000, reasonCode: 'DISPUTE_PARTIAL', reasonText: 'Half the work was not done', status: 'SUCCEEDED', gateway: 'mock' });
    const audit = await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*)::bigint as n FROM audit_log WHERE action = 'refund.manual' AND entity_id = ${job.id}`);
    expect(audit[0]?.n).toBe(1n);
  });
});

const balanceOfBooking = async (bookingId: string): Promise<bigint> =>
  (await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT coalesce(b.balance, 0)::bigint as n FROM ledger_accounts a LEFT JOIN account_balances b ON b.account_id = a.id WHERE a.type = 'ESCROW' AND a.booking_id = ${bookingId}::uuid`))[0]?.n ?? 0n;

describe('SHM-061: payouts', () => {
  it('stores the account number encrypted and shows only its last four digits', async () => {
    const provider = await newProvider(app);
    const account = await addAccount(provider, '0000-1111-2222-9876');
    expect(account.status).toBe(201);
    expect(account.body).toMatchObject({ accountLast4: '9876', isDefault: true });
    expect(JSON.stringify(account.body)).not.toContain('1111');
    const listed = await callApi<{ items: { accountLast4: string }[] }>(app, '/provider/payout-accounts', bearer(provider.accessToken));
    expect(listed.body.items.map(item => item.accountLast4)).toEqual(['9876']);
    const stored = await prisma.$queryRaw<{ enc: Buffer }[]>(Prisma.sql`SELECT account_number_enc as enc FROM provider_payout_accounts WHERE id = ${account.body.id}::uuid`);
    expect(Buffer.from(stored[0]!.enc).toString('utf8')).not.toContain('9876');
  });

  it('a provider can request at most what the wallet holds, and two simultaneous requests cannot spend it twice', async () => {
    const { provider, wallet } = await earningProvider();
    const account = await addAccount(provider);
    expect((await requestPayout(provider, account.body.id, 5_000)).status).toBe(400); // under the minimum
    expect((await requestPayout(provider, account.body.id, Number(wallet) + 1)).status).toBe(409);
    const stranger = await newProvider(app);
    expect((await requestPayout(stranger, account.body.id, 20_000)).status).toBe(404); // someone else's account

    const most = Math.floor(Number(wallet) * 0.6);
    const results = await Promise.all([requestPayout(provider, account.body.id, most), requestPayout(provider, account.body.id, most)]);
    expect(results.map(result => result.status).sort()).toEqual([201, 409]);
    const earnings = await callApi<{ releasablePaisa: number }>(app, '/provider/earnings', bearer(provider.accessToken));
    expect(earnings.body.releasablePaisa).toBe(Number(wallet) - most);
  });

  it('runs a payout end to end: request, approve, batch, bank file, paid — and a failed payout goes back to the wallet exactly', async () => {
    const good = await earningProvider();
    const bad = await earningProvider();
    const goodAccount = await addAccount(good.provider, '5555666677778888');
    const badAccount = await addAccount(bad.provider, '1111222233334444');
    const goodAmount = Number(good.wallet);
    const badAmount = Number(bad.wallet);
    const goodRequest = await requestPayout(good.provider, goodAccount.body.id, goodAmount);
    const badRequest = await requestPayout(bad.provider, badAccount.body.id, badAmount);
    expect(goodRequest.status).toBe(201);

    const clearingBefore = await balanceOf('PAYOUT_CLEARING');
    // Approve: the wallet is debited into payout clearing, once.
    expect((await callApi(app, `/finance/payouts/${goodRequest.body.id}/approve`, asFinance({ method: 'POST' }))).status).toBe(200);
    expect((await callApi(app, `/finance/payouts/${goodRequest.body.id}/approve`, asFinance({ method: 'POST' }))).status).toBe(409);
    expect((await callApi(app, `/finance/payouts/${badRequest.body.id}/approve`, asFinance({ method: 'POST' }))).status).toBe(200);
    expect(await walletOf(good.provider.id)).toBe(0n);
    expect(await balanceOf('PAYOUT_CLEARING')).toBe(clearingBefore + BigInt(goodAmount + badAmount));

    const batch = await callApi<{ id: string; status: string; payouts: number; totalPaisa: number }>(app, '/finance/payout-batches', asFinance(postJson({ periodStart: '2026-10-05', periodEnd: '2026-10-11' })));
    expect(batch.status).toBe(201);
    expect(batch.body.payouts).toBeGreaterThanOrEqual(2);
    expect(batch.body.totalPaisa).toBeGreaterThanOrEqual(goodAmount + badAmount);

    // The bank file has the real account numbers; the download is audited.
    const csv = await callApi<string>(app, `/finance/payout-batches/${batch.body.id}/export.csv`, asFinance());
    expect(csv.status).toBe(200);
    expect(String(csv.body)).toContain('5555666677778888');
    expect(String(csv.body)).toContain('1111222233334444');
    const audited = await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*)::bigint as n FROM audit_log WHERE action = 'payout.batch.export' AND entity_id = ${batch.body.id}`);
    expect(audited[0]?.n).toBe(1n);
    const statement = await callApi<unknown>(app, `/finance/payout-batches/${batch.body.id}/statements/${good.provider.id}`, asFinance());
    expect(statement.status).toBe(200);
    expect(String(statement.body)).toContain('%PDF-1.4');

    // Nothing left to batch, and a payout cannot be approved into a second batch.
    expect((await callApi(app, '/finance/payout-batches', asFinance(postJson({ periodStart: '2026-10-05', periodEnd: '2026-10-11' })))).status).toBe(409);

    // The bank pays one and rejects the other.
    const marked = await callApi<{ status: string; paid: number; failed: number }>(app, `/finance/payout-batches/${batch.body.id}/mark-paid`, asFinance(postJson({
      results: [{ payoutId: goodRequest.body.id, status: 'PAID' }, { payoutId: badRequest.body.id, status: 'FAILED', failureReason: 'Account closed' }]
    })));
    expect(marked.body).toMatchObject({ status: 'PARTIALLY_FAILED', paid: 2 - 1, failed: 1 });
    expect(await walletOf(bad.provider.id)).toBe(BigInt(badAmount));
    expect(await walletOf(good.provider.id)).toBe(0n);
    expect(await balanceOf('PAYOUT_CLEARING')).toBe(clearingBefore);

    const mine = await callApi<{ items: { id: string; status: string; failureReason: string | null; accountLast4: string }[] }>(app, '/provider/payouts', bearer(bad.provider.accessToken));
    expect(mine.body.items.find(item => item.id === badRequest.body.id)).toMatchObject({ status: 'FAILED', failureReason: 'Account closed', accountLast4: '4444' });
    const earnings = await callApi<{ paidPaisa: number; releasablePaisa: number }>(app, '/provider/earnings', bearer(good.provider.accessToken));
    expect(earnings.body).toMatchObject({ paidPaisa: goodAmount, releasablePaisa: 0 });
    const badEarnings = await callApi<{ paidPaisa: number; releasablePaisa: number }>(app, '/provider/earnings', bearer(bad.provider.accessToken));
    expect(badEarnings.body).toMatchObject({ paidPaisa: 0, releasablePaisa: badAmount });

    // Repeating the bank's answer changes nothing.
    const again = await callApi<{ paid: number; failed: number }>(app, `/finance/payout-batches/${batch.body.id}/mark-paid`, asFinance(postJson({})));
    expect(again.body).toMatchObject({ paid: 0, failed: 0 });
    expect(await balanceOf('PAYOUT_CLEARING')).toBe(clearingBefore);

    // The provider can ask again after a failure.
    expect((await requestPayout(bad.provider, badAccount.body.id, badAmount)).status).toBe(201);
  });

  it('a provider’s earnings show held, releasable, paid, commission and the weekly and monthly totals', async () => {
    const provider = await newProvider(app);
    const held = await completedJob(app, provider, { mode: 'ONLINE' });
    const released = await completedJob(app, provider, { mode: 'ONLINE' });
    await agentVerify(app, agent, released);
    const earnings = await callApi<{ heldPaisa: number; releasablePaisa: number; paidPaisa: number; commissionPaisa: number; weekly: { period: string; releasedPaisa: number }[]; monthly: { releasedPaisa: number }[] }>(app, '/provider/earnings', bearer(provider.accessToken));
    const finalHeld = Number((await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT final_amount_paisa as n FROM bookings WHERE id = ${held.id}::uuid`))[0]!.n);
    const wallet = Number(await walletOf(provider.id));
    expect(earnings.body.releasablePaisa).toBe(wallet);
    expect(earnings.body.heldPaisa).toBeGreaterThan(0);
    expect(earnings.body.heldPaisa).toBeLessThan(finalHeld);
    expect(earnings.body.paidPaisa).toBe(0);
    expect(earnings.body.commissionPaisa).toBeGreaterThan(0);
    expect(earnings.body.weekly[0]?.releasedPaisa).toBe(wallet);
    expect(earnings.body.monthly[0]?.releasedPaisa).toBe(wallet);
  });
});

describe('SHM-061: cash, debts and the ledger explorer', () => {
  it('the cash reconciliation shows a verified cash job awaiting confirmation, then settled with its commission', async () => {
    const provider = await newProvider(app);
    const job = await completedJob(app, provider, { mode: 'CASH' });
    await agentVerify(app, agent, job);
    type Row = { providerId: string; awaitingConfirmationJobs: number; awaitingConfirmationPaisa: number; settledJobs: number; collectedPaisa: number; commissionPaisa: number };
    const before = (await callApi<{ items: Row[] }>(app, '/finance/cash-reconciliation', asFinance())).body.items.find(row => row.providerId === provider.id)!;
    expect(before).toMatchObject({ awaitingConfirmationJobs: 1, settledJobs: 0 });
    expect(before.awaitingConfirmationPaisa).toBeGreaterThan(0);

    await callApi(app, `/bookings/${job.id}/cash-received`, bearer(provider.accessToken, { method: 'POST' }));
    const after = (await callApi<{ items: Row[] }>(app, '/finance/cash-reconciliation', asFinance())).body.items.find(row => row.providerId === provider.id)!;
    expect(after).toMatchObject({ awaitingConfirmationJobs: 0, settledJobs: 1 });
    expect(after.collectedPaisa).toBe(before.awaitingConfirmationPaisa);
    expect(after.commissionPaisa).toBe(Math.floor(after.collectedPaisa * 0.15 + 0.5));
  });

  it('lists providers whose wallet is negative, with their debt', async () => {
    const provider = await newProvider(app);
    const job = await completedJob(app, provider, { mode: 'CASH' });
    await agentVerify(app, agent, job);
    await callApi(app, `/bookings/${job.id}/cash-received`, bearer(provider.accessToken, { method: 'POST' }));
    const debts = await callApi<{ totalDebtPaisa: number; items: { providerId: string; debtPaisa: number }[] }>(app, '/finance/debts', asFinance());
    const mine = debts.body.items.find(item => item.providerId === provider.id)!;
    expect(mine.debtPaisa).toBe(-Number(await walletOf(provider.id)));
    expect(debts.body.totalDebtPaisa).toBeGreaterThanOrEqual(mine.debtPaisa);
  });

  it('the ledger explorer filters by booking and pages by entry id; every transaction shown balances', async () => {
    const provider = await newProvider(app);
    const job = await completedJob(app, provider, { mode: 'ONLINE' });
    await agentVerify(app, agent, job);
    type Entry = { entryId: number; transactionId: string; type: string; direction: string; amountPaisa: number; account: string };
    const all = await callApi<{ items: Entry[]; nextBefore: number | null }>(app, `/finance/ledger?bookingId=${job.id}&limit=200`, asFinance());
    expect(all.status).toBe(200);
    expect([...new Set(all.body.items.map(entry => entry.type))].sort()).toEqual(['CAPTURE', 'RELEASE']);
    const debit = all.body.items.filter(entry => entry.direction === 'DEBIT').reduce((sum, entry) => sum + entry.amountPaisa, 0);
    const credit = all.body.items.filter(entry => entry.direction === 'CREDIT').reduce((sum, entry) => sum + entry.amountPaisa, 0);
    expect(debit).toBe(credit);

    const first = await callApi<{ items: Entry[]; nextBefore: number | null }>(app, `/finance/ledger?bookingId=${job.id}&limit=2`, asFinance());
    expect(first.body.items).toHaveLength(2);
    expect(first.body.nextBefore).toBe(first.body.items[1]!.entryId);
    const second = await callApi<{ items: Entry[] }>(app, `/finance/ledger?bookingId=${job.id}&limit=200&before=${first.body.nextBefore}`, asFinance());
    expect([...first.body.items, ...second.body.items].map(entry => entry.entryId)).toEqual(all.body.items.map(entry => entry.entryId));

    const wallets = await callApi<{ items: Entry[] }>(app, `/finance/ledger?accountType=PROVIDER_WALLET&ownerId=${provider.id}`, asFinance());
    expect(wallets.body.items.every(entry => entry.account === 'PROVIDER_WALLET')).toBe(true);
  });
});

describe('SHM-062: the nightly reconciliation', () => {
  it('finds zero drift across everything the suite has done, and writes an audit row each time it runs', async () => {
    const before = (await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*)::bigint as n FROM audit_log WHERE action = 'ledger.reconcile'`))[0]!.n;
    const report = await callApi<{ checks: number; drift: { check: string; subject: string; expected: string; actual: string }[] }>(app, '/finance/reconciliation/run', asFinance({ method: 'POST' }));
    expect(report.status).toBe(200);
    expect(report.body.drift).toEqual([]);
    expect(report.body.checks).toBeGreaterThanOrEqual(5);
    const after = (await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*)::bigint as n FROM audit_log WHERE action = 'ledger.reconcile'`))[0]!.n;
    expect(after).toBe(before + 1n);
  });

  it('an injected drift is detected, reported, audited and raised as an event — and clears when the books are put right', async () => {
    const provider = await newProvider(app);
    const job = await completedJob(app, provider, { mode: 'ONLINE' });
    const account = (await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM ledger_accounts WHERE type = 'ESCROW' AND booking_id = ${job.id}::uuid`))[0]!.id;
    await prisma.$executeRaw(Prisma.sql`UPDATE account_balances SET credit_total = credit_total + 7 WHERE account_id = ${account}::uuid`);
    try {
      const events = (await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*)::bigint as n FROM outbox_events WHERE type = 'ledger.drift_detected'`))[0]!.n;
      const report = await callApi<{ drift: { check: string; subject: string }[] }>(app, '/finance/reconciliation/run', asFinance({ method: 'POST' }));
      expect(report.body.drift.map(entry => entry.check)).toContain('account_balance');
      expect(report.body.drift.find(entry => entry.check === 'account_balance')?.subject).toContain(account);
      const raised = (await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*)::bigint as n FROM outbox_events WHERE type = 'ledger.drift_detected'`))[0]!.n;
      expect(raised).toBe(events + 1n);
      const audited = await prisma.$queryRaw<{ drift: number }[]>(Prisma.sql`SELECT (after->>'drift')::int as drift FROM audit_log WHERE action = 'ledger.reconcile' ORDER BY id DESC LIMIT 1`);
      expect(audited[0]?.drift).toBeGreaterThanOrEqual(1);
    } finally {
      await prisma.$executeRaw(Prisma.sql`UPDATE account_balances SET credit_total = credit_total - 7 WHERE account_id = ${account}::uuid`);
    }
    const clean = await callApi<{ drift: unknown[] }>(app, '/finance/reconciliation/run', asFinance({ method: 'POST' }));
    expect(clean.body.drift).toEqual([]);
  });

  it('catches a payment the ledger never heard about', async () => {
    const provider = await newProvider(app);
    const job = await completedJob(app, provider, { mode: 'ONLINE' });
    const payment = (await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM payments WHERE booking_id = ${job.id}::uuid AND purpose = 'BOOKING'`))[0]!.id;
    // A gateway record that claims a bigger capture than the ledger holds: exactly what a lost or mis-keyed webhook would leave.
    await prisma.$executeRaw(Prisma.sql`ALTER TABLE payments DISABLE TRIGGER USER`);
    try {
      await prisma.$executeRaw(Prisma.sql`UPDATE payments SET amount_paisa = amount_paisa + 1 WHERE id = ${payment}::uuid`);
      const report = await callApi<{ drift: { check: string; subject: string }[] }>(app, '/finance/reconciliation/run', asFinance({ method: 'POST' }));
      expect(report.body.drift.find(entry => entry.check === 'payment_capture')?.subject).toBe(payment);
    } finally {
      await prisma.$executeRaw(Prisma.sql`UPDATE payments SET amount_paisa = amount_paisa - 1 WHERE id = ${payment}::uuid`);
      await prisma.$executeRaw(Prisma.sql`ALTER TABLE payments ENABLE TRIGGER USER`);
    }
    expect((await callApi<{ drift: unknown[] }>(app, '/finance/reconciliation/run', asFinance({ method: 'POST' }))).body.drift).toEqual([]);
  });
});
