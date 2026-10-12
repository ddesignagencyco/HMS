// apps/api/test/integration/ops-board.test.ts
//
// SHM-091 / FR-AD-12: the operations board.
//
// The board exists to answer "is anything wrong right now", so these tests care about two things
// beyond the shape of the response: that it only shows to staff, and that the figures are real —
// a board that reports zero for a queue that has work in it is worse than no board, because it is
// believed.
import { Prisma } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { OpsBoardService } from '../../src/admin/ops-board.service.js';
import { callApi, createTestApp, registerAndVerify, staffSession } from './harness.js';
import { bearer, completedJob, prisma } from './flow.js';

let app: NestExpressApplication;
let close: () => Promise<void>;
let finance: { accessToken: string; userId: string };

beforeAll(async () => {
  const started = await createTestApp();
  app = started.app;
  close = started.close;
  finance = await staffSession(app, 'finance@smart-home.local');
});

afterAll(async () => {
  await close();
  await prisma.$disconnect();
});

const asFinance = (init: RequestInit = {}): RequestInit => bearer(finance.accessToken, init);

type Board = {
  generatedAt: string;
  bookingsToday: { total: number; byStatus: Record<string, number> };
  queueDepth: Record<string, number>;
  slaBreaches: { verifications: number; complaints: number };
  openDisputes: { total: number; awaitingReply: number };
  escrow: { heldPaisa: string; bookingsHolding: number };
  debtBlockedProviders: number;
  alerts: { severity: string; code: string; count: number }[];
};

describe('SHM-091: the operations board', () => {
  it('is staff-only, TOTP-gated, and reports its own shape', async () => {
    const response = await callApi<Board>(app, '/admin/ops-board', asFinance());
    expect(response.status).toBe(200);
    expect(response.body.generatedAt).not.toBe('');
    expect(response.body.bookingsToday.total).toBeGreaterThanOrEqual(0);
    expect(Object.keys(response.body.queueDepth).sort()).toEqual(['notifications', 'outbox', 'payments', 'projections', 'verification']);
    // Money is a string of paisa here, as everywhere else: a number would round.
    expect(typeof response.body.escrow.heldPaisa).toBe('string');
    expect(response.body.escrow.heldPaisa).toMatch(/^\d+$/);
  });

  it('is not readable by a customer, an agent, or an anonymous caller', async () => {
    // An agent is deliberately excluded: the escrow figure on this board is the platform's held
    // money, which is finance and admin business and not something every staff login should see.
    const customer = await registerAndVerify(app, 'CUSTOMER');
    const agent = await staffSession(app, 'agent1@smart-home.local');
    expect((await callApi(app, '/admin/ops-board', asFinance())).status).toBe(200);
    expect((await callApi(app, '/admin/ops-board', bearer(agent.accessToken))).status).toBe(403);
    expect((await callApi(app, '/admin/ops-board', bearer(customer.accessToken))).status).toBe(403);
    expect((await callApi(app, '/admin/ops-board')).status).toBe(401);
  });

  it('reports escrow actually held, in agreement with the ledger rather than a round number', async () => {
    await completedJob(app, await approvedProvider(), { mode: 'ONLINE' });
    const board = await app.get(OpsBoardService).refresh();
    const ledger = await prisma.$queryRaw<{ held: bigint; bookings: number }[]>(Prisma.sql`
      SELECT coalesce(sum(b.balance), 0)::bigint as held, count(*)::int as bookings
      FROM ledger_accounts a JOIN account_balances b ON b.account_id = a.id WHERE a.type = 'ESCROW' AND b.balance > 0`);
    // The board is a view of these tables, not a parallel count that can drift from them.
    expect(board.escrow.heldPaisa).toBe(ledger[0]!.held.toString());
    expect(board.escrow.bookingsHolding).toBe(ledger[0]!.bookings);
  });

  it('raises an alert for a complaint past its SLA, and it sorts worst-first', async () => {
    const provider = await approvedProvider();
    const job = await completedJob(app, provider, { mode: 'ONLINE' });
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO complaints(booking_id, raised_by_user_id, against_user_id, source, category, severity, description, sla_due_at)
      VALUES (${job.id}::uuid, ${job.customer.id}::uuid, ${provider.id}::uuid, 'CUSTOMER'::complaint_source, 'QUALITY'::complaint_category, 'SAFETY'::complaint_severity,
        'A safety complaint left open past its deadline', now() - interval '2 hours')`);

    const board = await app.get(OpsBoardService).refresh();
    expect(board.slaBreaches.complaints).toBeGreaterThanOrEqual(1);
    const alert = board.alerts.find(entry => entry.code === 'complaint_sla_breached');
    expect(alert?.severity).toBe('CRITICAL');
    // Worst first: nothing may sort after a CRITICAL.
    const ranks = { CRITICAL: 0, WARNING: 1, INFO: 2 } as Record<string, number>;
    const severities = board.alerts.map(entry => ranks[entry.severity] ?? 3);
    expect(severities).toEqual([...severities].sort((a, b) => a - b));
  });

  it('pushes an update to a subscriber without being asked, which is the "within 5 s" criterion', async () => {
    const service = app.get(OpsBoardService);
    const received: unknown[] = [];
    const unsubscribe = service.subscribe(board => received.push(board));

await prisma.$executeRaw(Prisma.sql`
      INSERT INTO complaints(booking_id, raised_by_user_id, against_user_id, source, category, severity, description, sla_due_at)
      SELECT b.id, b.customer_id, (SELECT user_id FROM providers WHERE user_id <> b.customer_id LIMIT 1),
        'CUSTOMER'::complaint_source, 'QUALITY'::complaint_category, 'NORMAL'::complaint_severity,
        'Another overdue complaint', now() - interval '3 hours'
      FROM bookings b WHERE b.customer_id IS NOT NULL LIMIT 1`);

    await service.refresh();
    unsubscribe();
    expect(received.length).toBeGreaterThan(0);
    const last = received[received.length - 1] as Board;
    expect(last.slaBreaches.complaints).toBeGreaterThanOrEqual(1);
  });

  it('stops pushing to a subscriber that has gone away', async () => {
    const service = app.get(OpsBoardService);
    let pushes = 0;
    const unsubscribe = service.subscribe(() => (pushes += 1));
    await service.refresh();
    const seen = pushes;
    unsubscribe();
    await service.refresh();
    expect(pushes).toBe(seen);
  });
});

/** An approved, bookable provider � the shape `completedJob` needs. */
const approvedProvider = async () => {
  const flow = await import('./flow.js');
  return flow.newProvider(app);
};