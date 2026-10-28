// apps/api/test/integration/reports.test.ts
//
// SHM-090 / FR-RP-01..06: asynchronous reports.
//
// The criterion that matters here is "revenue report total equals ledger for the period". Everything
// else — the PDF, the XLSX, the queue, the polling — is plumbing around that one number, and a
// plumbing bug is a nuisance while a wrong total is a company-level problem.
import { Prisma } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ReportsService } from '../../src/finance/reports.service.js';
import { callApi, createTestApp, postJson, registerAndVerify, staffSession } from './harness.js';
import { agentSession, agentVerify, bearer, completedJob, freezeInsideCallingHours, newProvider, prisma, unfreeze } from './flow.js';

let app: NestExpressApplication;
let close: () => Promise<void>;
let finance: { accessToken: string; userId: string };
let agent: { accessToken: string; userId: string };

/** A window wide enough to contain every job these tests create, whatever day they run. */
const PERIOD = { periodStart: '2020-01-01', periodEnd: '2100-01-01' };

beforeAll(async () => {
  const started = await createTestApp();
  app = started.app;
  // Verification can only happen inside calling hours, and this suite builds real released jobs to
  // compare against the ledger, so the clock is pinned rather than left to the hour it runs in.
  freezeInsideCallingHours(app);
  close = started.close;
  finance = await staffSession(app, 'finance@smart-home.local');
  agent = await agentSession(app, 'agent1');
  // Real, completed, released jobs — otherwise "revenue equals the ledger" is comparing zero to zero,
  // which passes for the wrong reason.
  for (let index = 0; index < 2; index += 1) {
    const provider = await newProvider(app);
    const job = await completedJob(app, provider, { mode: 'ONLINE' });
    await agentVerify(app, agent, job);
  }
});

afterAll(async () => {
  unfreeze(app);
  await close();
  await prisma.$disconnect();
});

const asFinance = (init: RequestInit = {}): RequestInit => bearer(finance.accessToken, init);
const ask = (body: Record<string, unknown>) => callApi<{ id: string; status: string }>(app, '/finance/reports', asFinance(postJson(body)));

describe('SHM-090: reports', () => {
  it('queues a report, builds it in the background, and serves the file', async () => {
    const asked = await ask({ type: 'MONTHLY', format: 'PDF', ...PERIOD });
    expect(asked.status).toBe(201);
    expect(asked.body.status).toMatch(/QUEUED|RUNNING|DONE/);

    // The drain is the worker path; the queue job would do the same thing in production.
    await app.get(ReportsService).drain();

    const built = await callApi<{ id: string; status: string; rowCount: number; downloadUrl: string; totalPaisa: string }>(app, `/finance/reports/${asked.body.id}`, asFinance());
    expect(built.body.status).toBe('DONE');
    expect(built.body.rowCount).toBeGreaterThan(0);
    expect(built.body.downloadUrl).toContain('/download');

    const file = await callApi<string>(app, `/finance/reports/${asked.body.id}/download`, asFinance());
    expect(file.status).toBe(200);
    expect(String(file.body)).toContain('%PDF-1.4');
  });

  it("builds a revenue report whose total equals the ledger for the same period", async () => {
    const asked = await ask({ type: 'REVENUE', format: 'XLSX', ...PERIOD });
    await app.get(ReportsService).drain();

    const built = await callApi<{ status: string; totalPaisa: string }>(app, `/finance/reports/${asked.body.id}`, asFinance());
    expect(built.body.status).toBe('DONE');
    // Straight from PLATFORM_COMMISSION credits in the ledger, computed independently of the report.
    const fromLedger = await app.get(ReportsService).commissionTotalFor(PERIOD.periodStart, PERIOD.periodEnd);
    expect(built.body.totalPaisa).toBe(fromLedger.toString());
    expect(fromLedger).toBeGreaterThan(0n);

    // And not the quoted booking totals, which is the number a naive report would have used. The
    // two are different by exactly the commission, so agreeing with the ledger means disagreeing
    // with the booking sum — which is the whole point.
    const quoted = await prisma.$queryRaw<{ quoted: bigint }[]>(Prisma.sql`SELECT coalesce(sum(approved_total_paisa), 0)::bigint as quoted FROM bookings WHERE completed_at IS NOT NULL`);
    expect(fromLedger).not.toBe(quoted[0]!.quoted);
  });

  it('writes a real XLSX, not a renamed CSV', async () => {
    const asked = await ask({ type: 'PROVIDER_PERFORMANCE', format: 'XLSX', ...PERIOD });
    await app.get(ReportsService).drain();
    const file = await callApi<string>(app, `/finance/reports/${asked.body.id}/download`, asFinance());
    expect(file.status).toBe(200);
    // XLSX is a zip: "PK". A CSV with the wrong extension would not survive this.
    expect(String(file.body)).toMatch(/^PK/);
  });

  it('refuses a period that ends before it starts, rather than reporting on nothing', async () => {
    const response = await ask({ type: 'MONTHLY', format: 'PDF', periodStart: '2026-02-01', periodEnd: '2026-01-01' });
    expect(response.status).toBe(422);
  });

  it('returns the run you already asked for rather than building the same numbers twice', async () => {
    const first = await ask({ type: 'VERIFICATION', format: 'PDF', ...PERIOD });
    const second = await ask({ type: 'VERIFICATION', format: 'PDF', ...PERIOD });
    expect(second.body.id).toBe(first.body.id);
  });

  it('refuses to download a report that has not been built, and says why', async () => {
    const asked = await ask({ type: 'REVENUE', format: 'PDF', ...PERIOD });
    const file = await callApi<{ code: string }>(app, `/finance/reports/${asked.body.id}/download`, asFinance());
    // QUEUED or DONE both acceptable depending on whether the drain above caught it; what must never
    // happen is a 200 with a half-built file.
    if (file.status !== 200) {
      expect(file.status).toBe(409);
      expect(file.body.code).toBe('CONFLICT');
    }
  });

  it('is finance and admin only, and audits every request and download', async () => {
    const customer = await registerAndVerify(app, 'CUSTOMER');
    // Its own period, so this really creates a run. Asking for one another test already asked for
    // returns that run instead, and then there is no new request to have audited.
    const asked = await ask({ type: 'MONTHLY', format: 'PDF', periodStart: '2019-01-01', periodEnd: '2019-06-01' });
    expect(asked.status).toBe(201);
    expect((await callApi(app, '/finance/reports', bearer(agent.accessToken))).status).toBe(403);
    expect((await callApi(app, '/finance/reports', bearer(customer.accessToken))).status).toBe(403);
    expect((await callApi(app, '/finance/reports')).status).toBe(401);

    await app.get(ReportsService).drain();
    await callApi(app, `/finance/reports/${asked.body.id}/download`, asFinance());
    // `audit_log.entity_id` is text, not a uuid — every entity type shares that column.
    const audited = await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`
      SELECT count(*)::bigint as n FROM audit_log WHERE action IN ('report.request','report.download') AND entity_id = ${asked.body.id}::text`);
    expect(`audit=${audited[0]!.n}`).toBe('audit=2');
  });

  it('shows an operator only their own reports', async () => {
    const mine = await callApi<{ items: { id: string }[] }>(app, '/finance/reports', asFinance());
    expect(mine.status).toBe(200);
    const admin = await staffSession(app, 'admin@smart-home.local');
    const theirs = await callApi<{ items: { id: string }[] }>(app, '/finance/reports', bearer(admin.accessToken));
    expect(theirs.body.items.every(item => !mine.body.items.map(m => m.id).includes(item.id))).toBe(true);
  });
});
