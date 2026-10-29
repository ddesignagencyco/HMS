// apps/api/test/integration/lists-admin.test.ts
//
// Phase 2 of apps/web/docs/backend_requirement.md: lists and admin.
//  - BE-007: one paging convention (tables: page/limit -> pagination; streams: limit/before -> nextCursor), additive to the old shapes;
//  - BE-008: the provider approval queue, and providerStatus on /admin/users;
//  - BE-009: platform-wide bookings for the admin;
//  - BE-018 / 019 / 020 / 021: confirmation read-back, own document links, minimum payout, names on booking rows;
//  - BE-023: audit `before` cursor;
//  - BE-025 / 030: `null` clears an address line/note and a provider's bio/qualification;
//  - BE-031: a removed service re-added at the same price keeps its approval.
import { Prisma } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { adminSession, callApi, createTestApp, deleteWith, patchJson, postJson, putJson, registerAndVerify, staffSession, type TestUser } from './harness.js';
import { bearer, completedJob, freezeInsideCallingHours, newProvider, prisma, unfreeze, type Job, type Provider } from './flow.js';

let app: NestExpressApplication;
let close: () => Promise<void>;
let admin: { accessToken: string; userId: string };
let finance: { accessToken: string; userId: string };
let provider: Provider;
let job: Job;
let secondJob: Job;

beforeAll(async () => {
  const started = await createTestApp();
  app = started.app;
  close = started.close;
  freezeInsideCallingHours(app);
  admin = await adminSession(app);
  finance = await staffSession(app, 'finance@smart-home.local');
  provider = await newProvider(app);
  // Two online jobs for one customer and provider: bookings, ledger entries and audit rows to page over.
  job = await completedJob(app, provider, { mode: 'ONLINE' });
  secondJob = await completedJob(app, provider, { mode: 'ONLINE', customer: job.customer });
});

afterAll(async () => {
  unfreeze(app);
  await close();
  await prisma.$disconnect();
});

type Page = { total: number; page: number; limit: number; hasMore: boolean };
type Paged<T = { id?: string }> = { items: T[]; pagination: Page; truncated: boolean };

const asAdmin = (init: RequestInit = {}): RequestInit => bearer(admin.accessToken, init);
const asFinance = (init: RequestInit = {}): RequestInit => bearer(finance.accessToken, init);

describe('BE-007: one paging convention on every truncated list', () => {
  const adminTables = ['/admin/complaints', '/admin/disputes', '/admin/penalties', '/admin/appeals', '/admin/templates', '/admin/users', '/admin/customers', '/admin/providers', '/admin/bookings'];
  const financeTables = ['/finance/escrow', '/finance/refunds', '/finance/payouts', '/finance/payout-batches', '/finance/debts'];

  const expectEnvelope = (body: Paged, limit: number | null) => {
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.pagination).toEqual({ total: expect.any(Number), page: 1, limit: limit ?? expect.any(Number), hasMore: expect.any(Boolean) });
    expect(typeof body.truncated).toBe('boolean');
  };

  it.each(adminTables)('%s keeps `items`, adds `pagination`, honours page/limit and refuses a limit over 100', async path => {
    const legacy = await callApi<Paged>(app, path, asAdmin());
    expect(legacy.status).toBe(200);
    expect(Array.isArray(legacy.body.items)).toBe(true);
    expect(legacy.body.pagination.total).toBeGreaterThanOrEqual(legacy.body.items.length);
    expect(legacy.body.truncated).toBe(legacy.body.pagination.hasMore);

    const first = await callApi<Paged>(app, `${path}?page=1&limit=1`, asAdmin());
    expect(first.status).toBe(200);
    expectEnvelope(first.body, 1);
    expect(first.body.items.length).toBeLessThanOrEqual(1);
    expect(first.body.pagination.hasMore).toBe(first.body.pagination.total > 1);

    expect((await callApi(app, `${path}?limit=101`, asAdmin())).status).toBe(path === '/admin/users' || path === '/admin/customers' ? 200 : 422);
    expect((await callApi(app, `${path}?page=0`, asAdmin())).status).toBe(422);
  });

  it.each(financeTables)('%s keeps its fields, adds `pagination` and pages', async path => {
    const legacy = await callApi<Paged & Record<string, unknown>>(app, path, asFinance());
    expect(legacy.status).toBe(200);
    expect(legacy.body.pagination.total).toBeGreaterThanOrEqual(legacy.body.items.length);
    const first = await callApi<Paged>(app, `${path}?page=1&limit=1`, asFinance());
    expectEnvelope(first.body, 1);
    expect((await callApi(app, `${path}?limit=101`, asFinance())).status).toBe(422);
  });

  it('the totals the finance views already carried still cover every row, not just the page', async () => {
    const all = await callApi<{ totalHeldPaisa: number; pagination: Page }>(app, '/finance/escrow', asFinance());
    const one = await callApi<{ totalHeldPaisa: number; pagination: Page }>(app, '/finance/escrow?page=1&limit=1', asFinance());
    expect(one.body.totalHeldPaisa).toBe(all.body.totalHeldPaisa);
    expect(one.body.pagination.total).toBe(all.body.pagination.total);
    const debts = await callApi<{ totalDebtPaisa: number }>(app, '/finance/debts', asFinance());
    const debtsPaged = await callApi<{ totalDebtPaisa: number }>(app, '/finance/debts?page=1&limit=1', asFinance());
    expect(debtsPaged.body.totalDebtPaisa).toBe(debts.body.totalDebtPaisa);
  });

  it('pages walk a list without gaps or repeats, and a page past the end is empty with hasMore false', async () => {
    const all = await callApi<Paged<{ id: string }>>(app, '/admin/templates?page=1&limit=100', asAdmin());
    expect(all.body.pagination.total).toBeGreaterThan(4);
    const ids: string[] = [];
    for (let page = 1; page <= 6; page += 1) {
      const slice = await callApi<Paged<{ id: string }>>(app, `/admin/templates?page=${page}&limit=2`, asAdmin());
      expect(slice.body.pagination).toMatchObject({ page, limit: 2, total: all.body.pagination.total, hasMore: page * 2 < all.body.pagination.total });
      ids.push(...slice.body.items.map(item => item.id));
    }
    expect(ids).toEqual(all.body.items.slice(0, 12).map(item => item.id));
    const beyond = await callApi<Paged>(app, `/admin/templates?page=${all.body.pagination.total + 5}&limit=2`, asAdmin());
    expect(beyond.body.items).toEqual([]);
    expect(beyond.body.pagination.hasMore).toBe(false);
    // The variable list the editor needs still rides along.
    expect(Array.isArray((all.body as unknown as { variables: string[] }).variables)).toBe(true);
  });

  it('with no paging parameters a list keeps the window it always had, and says how many rows there really are', async () => {
    const users = await callApi<Paged>(app, '/admin/users', asAdmin());
    expect(users.body.pagination.limit).toBe(50);
    expect(users.body.items.length).toBeLessThanOrEqual(50);
    const explicit = await callApi<Paged>(app, '/admin/users?limit=3', asAdmin());
    expect(explicit.body.items.length).toBeLessThanOrEqual(3);
    expect(explicit.body.pagination).toMatchObject({ page: 1, limit: 3 });
    // /bookings was never capped: no parameters still means the whole history.
    const mine = await callApi<Paged>(app, '/bookings', bearer(job.customer.accessToken));
    expect(mine.body.items.length).toBe(2);
    expect(mine.body).toMatchObject({ truncated: false, pagination: { total: 2, hasMore: false } });
  });

  it('/admin/complaints pages along the same severity ordering the unpaged queue uses', async () => {
    for (const category of ['QUALITY', 'SAFETY', 'OVERCHARGE']) {
      const raised = await callApi(app, '/complaints', bearer(job.customer.accessToken, postJson({ bookingId: job.id, category, description: 'The problem is described here in enough words.' })));
      expect([201, 409]).toContain(raised.status);
    }
    const all = await callApi<Paged<{ id: string; severity: string; status: string }>>(app, '/admin/complaints?open=true&page=1&limit=100', asAdmin());
    const walked = [
      ...(await callApi<Paged<{ id: string }>>(app, '/admin/complaints?open=true&page=1&limit=50', asAdmin())).body.items,
      ...(await callApi<Paged<{ id: string }>>(app, '/admin/complaints?open=true&page=2&limit=50', asAdmin())).body.items
    ];
    expect(walked.map(item => item.id)).toEqual(all.body.items.map(item => item.id));
    const rank = (severity: string) => (severity === 'SAFETY' ? 0 : severity === 'HIGH' ? 1 : 2);
    const ranks = all.body.items.map(item => rank(item.severity));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it("each party's own lists carry the envelope too", async () => {
    const complaints = await callApi<Paged>(app, '/complaints', bearer(job.customer.accessToken));
    expect(complaints.body.pagination.total).toBeGreaterThanOrEqual(1);
    const onePerPage = await callApi<Paged>(app, '/complaints?page=1&limit=1', bearer(job.customer.accessToken));
    expectEnvelope(onePerPage.body, 1);
    for (const path of ['/provider/disputes', '/provider/penalties', '/provider/ratings']) {
      const response = await callApi<Paged>(app, `${path}?page=1&limit=5`, bearer(provider.accessToken));
      expect(response.status).toBe(200);
      expectEnvelope(response.body, 5);
    }
    const ratings = await callApi<{ reputation: unknown; items: unknown[] }>(app, '/provider/ratings', bearer(provider.accessToken));
    expect(ratings.body.reputation).toBeDefined();
  });

  describe('streams page by cursor', () => {
    it('/admin/audit: before=<nextCursor> returns the older rows, never a repeat, and a bad cursor is a 400', async () => {
      const first = await callApi<{ items: { id: string }[]; nextCursor: string | null }>(app, '/admin/audit?limit=2', asAdmin());
      expect(first.status).toBe(200);
      expect(first.body.items).toHaveLength(2);
      expect(first.body.nextCursor).toBe(first.body.items[1]!.id);
      const second = await callApi<{ items: { id: string }[]; nextCursor: string | null }>(app, `/admin/audit?limit=2&before=${first.body.nextCursor}`, asAdmin());
      expect(second.body.items).toHaveLength(2);
      const seen = new Set(first.body.items.map(item => item.id));
      for (const item of second.body.items) {
        expect(seen.has(item.id)).toBe(false);
        expect(BigInt(item.id)).toBeLessThan(BigInt(first.body.nextCursor!));
      }
      expect((await callApi(app, '/admin/audit?before=not-a-cursor', asAdmin())).status).toBe(400);
      const total = Number((await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*)::bigint as n FROM audit_log`))[0]!.n);
      const everything = await callApi<{ items: unknown[]; nextCursor: string | null }>(app, '/admin/audit?limit=200', asAdmin());
      expect(everything.body.nextCursor === null).toBe(total <= 200);
    });

    it('/finance/ledger: nextCursor is exact, and nextBefore is still there for existing clients', async () => {
      const first = await callApi<{ items: { entryId: number }[]; nextCursor: string | null; nextBefore: number | null }>(app, '/finance/ledger?limit=2', asFinance());
      expect(first.body.items).toHaveLength(2);
      expect(first.body.nextCursor).toBe(String(first.body.items[1]!.entryId));
      expect(first.body.nextBefore).toBe(first.body.items[1]!.entryId);
      const second = await callApi<{ items: { entryId: number }[] }>(app, `/finance/ledger?limit=2&before=${first.body.nextCursor}`, asFinance());
      expect(second.body.items[0]!.entryId).toBeLessThan(first.body.items[1]!.entryId);
    });

    it('/notifications: pages by (created_at, id), so rows sharing a timestamp are neither skipped nor repeated', async () => {
      const user: TestUser = await registerAndVerify(app, 'CUSTOMER');
      const same = '2026-01-01T10:00:00.123456Z';
      const stamps = [same, same, same, '2026-01-01T09:00:00Z', '2026-01-01T08:00:00Z'];
      for (const [index, stamp] of stamps.entries()) {
        await prisma.$executeRaw(
          Prisma.sql`INSERT INTO notifications(user_id, event_key, channel, rendered_body, created_at) VALUES (${user.id}::uuid, 'test.paging', 'IN_APP'::notification_channel, ${`n${index}`}, ${stamp}::timestamptz)`
        );
      }
      const seen: string[] = [];
      let cursor: string | null = null;
      for (let guard = 0; guard < 10; guard += 1) {
        const response: { status: number; body: { items: { id: string }[]; nextCursor: string | null; unreadCount: number } } = await callApi(app, `/notifications?limit=2${cursor === null ? '' : `&before=${cursor}`}`, bearer(user.accessToken));
        expect(response.status).toBe(200);
        seen.push(...response.body.items.map(item => item.id));
        cursor = response.body.nextCursor;
        if (cursor === null) break;
      }
      expect(seen).toHaveLength(5);
      expect(new Set(seen).size).toBe(5);
      expect((await callApi(app, '/notifications?before=garbage', bearer(user.accessToken))).status).toBe(400);
      const log = await callApi<{ items: { id: string }[]; nextCursor: string | null }>(app, '/admin/notifications?limit=2', asAdmin());
      expect(log.body.items).toHaveLength(2);
      expect(log.body.nextCursor).not.toBeNull();
    });
  });
});

describe('BE-008: the provider approval queue', () => {
  it('lists who is waiting, with a masked phone and the number of unreviewed documents', async () => {
    const waiting = await registerAndVerify(app, 'PROVIDER');
    await prisma.$executeRaw(Prisma.sql`UPDATE providers SET submitted_at = now(), city_id = (SELECT id FROM cities WHERE name = 'Lahore') WHERE user_id = ${waiting.id}::uuid`);
    const uploaded = await callApi(app, '/provider/documents', postJson({ docType: 'TRADE_CERT', contentType: 'application/pdf', contentBase64: Buffer.from('%PDF-1.4 certificate').toString('base64') }, waiting.accessToken));
    expect(uploaded.status).toBe(201);

    const queue = await callApi<Paged<{ providerId: string; name: string; phoneMasked: string; city: string | null; providerStatus: string; submittedAt: string | null; pendingDocumentsCount: number }>>(
      app,
      '/admin/providers?status=PENDING_APPROVAL&limit=100',
      asAdmin()
    );
    expect(queue.status).toBe(200);
    const row = queue.body.items.find(item => item.providerId === waiting.id);
    expect(row).toMatchObject({ name: 'Test User', city: 'Lahore', providerStatus: 'PENDING_APPROVAL', pendingDocumentsCount: 1 });
    expect(row!.submittedAt).not.toBeNull();
    expect(row!.phoneMasked).not.toBe(waiting.phoneE164);
    expect(row!.phoneMasked.endsWith(waiting.phoneE164.slice(-3))).toBe(true);
    expect(JSON.stringify(row)).not.toContain(waiting.phoneE164);
    expect(queue.body.items.every(item => item.providerStatus === 'PENDING_APPROVAL')).toBe(true);
    // The queue is worked oldest first.
    const times = queue.body.items.filter(item => item.submittedAt !== null).map(item => Date.parse(item.submittedAt!));
    expect(times).toEqual([...times].sort((a, b) => a - b));

    const approved = await callApi<Paged<{ providerId: string }>>(app, '/admin/providers?status=APPROVED&limit=100', asAdmin());
    expect(approved.body.items.some(item => item.providerId === provider.id)).toBe(true);
    expect(approved.body.items.some(item => item.providerId === waiting.id)).toBe(false);
    const byName = await callApi<Paged<{ providerId: string }>>(app, `/admin/providers?q=${encodeURIComponent(waiting.phoneE164.slice(-8))}`, asAdmin());
    expect(byName.body.items.map(item => item.providerId)).toEqual([waiting.id]);
    expect((await callApi(app, '/admin/providers?status=NOPE', asAdmin())).status).toBe(422);
  });

  it('is admin-only: 401 without a token, 403 for a provider, an agent and finance', async () => {
    expect((await callApi(app, '/admin/providers')).status).toBe(401);
    expect((await callApi(app, '/admin/providers', bearer(provider.accessToken))).status).toBe(403);
    expect((await callApi(app, '/admin/providers', asFinance())).status).toBe(403);
    const agent = await staffSession(app, 'agent1@smart-home.local');
    expect((await callApi(app, '/admin/providers', bearer(agent.accessToken))).status).toBe(403);
  });

  it('/admin/users rows carry providerStatus (null for someone who is not a provider)', async () => {
    const customer = await registerAndVerify(app, 'CUSTOMER');
    const users = await callApi<Paged<{ id: string; providerStatus: string | null }>>(app, `/admin/users?q=${encodeURIComponent(provider.user.phoneE164.slice(-8))}`, asAdmin());
    expect(users.body.items.find(item => item.id === provider.id)?.providerStatus).toBe('APPROVED');
    const customers = await callApi<Paged<{ id: string; providerStatus: string | null }>>(app, `/admin/users?role=CUSTOMER&q=${encodeURIComponent(customer.phoneE164.slice(-8))}`, asAdmin());
    expect(customers.body.items.find(item => item.id === customer.id)?.providerStatus).toBeNull();
  });
});

describe('BE-009: platform-wide bookings for the admin', () => {
  type Row = { id: string; code: string; status: string; customerId: string; providerId: string; isEmergency: boolean; serviceName: string; serviceNameUr: string; customerName: string; providerName: string; cityId: number };
  const list = (query: string) => callApi<Paged<Row>>(app, `/admin/bookings?${query}`, asAdmin());

  it('filters by customer, provider, status, code, emergency flag, date range and city; newest first; paged', async () => {
    const byCustomer = await list(`customerId=${job.customer.id}`);
    expect(byCustomer.status).toBe(200);
    expect(byCustomer.body.items.map(item => item.id)).toEqual([secondJob.id, job.id]);
    expect(byCustomer.body.items[0]).toMatchObject({ code: secondJob.code, providerId: provider.id, customerName: 'Test User', providerName: 'Test User', isEmergency: false });
    expect(byCustomer.body.items[0]!.serviceName).toEqual(expect.any(String));
    expect(byCustomer.body.items[0]!.serviceNameUr).toEqual(expect.any(String));

    const page = await list(`customerId=${job.customer.id}&page=2&limit=1`);
    expect(page.body.items.map(item => item.id)).toEqual([job.id]);
    expect(page.body.pagination).toEqual({ total: 2, page: 2, limit: 1, hasMore: false });

    expect((await list(`providerId=${provider.id}&limit=100`)).body.items.map(item => item.id)).toEqual(expect.arrayContaining([job.id, secondJob.id]));
    expect((await list(`customerId=${job.customer.id}&status=AWAITING_VERIFICATION`)).body.pagination.total).toBe(2);
    expect((await list(`customerId=${job.customer.id}&status=CANCELLED_CUSTOMER`)).body.items).toEqual([]);

    expect((await list(`q=${job.code.toLowerCase()}`)).body.items.map(item => item.id)).toEqual([job.id]);
    expect((await list(`q=${job.code.slice(0, -2)}&customerId=${job.customer.id}`)).body.items.length).toBeGreaterThanOrEqual(1);
    expect((await list('q=%25')).body.items).toEqual([]);

    expect((await list(`customerId=${job.customer.id}&isEmergency=true`)).body.items).toEqual([]);
    expect((await list(`customerId=${job.customer.id}&isEmergency=false`)).body.pagination.total).toBe(2);
    expect((await list('isEmergency=maybe')).status).toBe(422);

    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    expect((await list(`customerId=${job.customer.id}&from=${encodeURIComponent(tomorrow)}`)).body.items).toEqual([]);
    expect((await list(`customerId=${job.customer.id}&to=${encodeURIComponent(tomorrow)}`)).body.pagination.total).toBe(2);

    const city = (await prisma.$queryRaw<{ cityId: number }[]>(Prisma.sql`SELECT city_id as "cityId" FROM areas WHERE id = ${provider.areaId}`))[0]!.cityId;
    expect(byCustomer.body.items[0]!.cityId).toBe(city);
    expect((await list(`customerId=${job.customer.id}&cityId=${city}`)).body.pagination.total).toBe(2);
    expect((await list(`customerId=${job.customer.id}&cityId=${city + 999}`)).body.items).toEqual([]);
  });

  it('is admin-only and TOTP-gated like the rest of the admin surface', async () => {
    expect((await callApi(app, '/admin/bookings')).status).toBe(401);
    expect((await callApi(app, '/admin/bookings', bearer(job.customer.accessToken))).status).toBe(403);
    expect((await callApi(app, '/admin/bookings', bearer(provider.accessToken))).status).toBe(403);
    expect((await callApi(app, '/admin/bookings', asFinance())).status).toBe(403);
  });
});

describe('BE-021: booking list rows carry names (already true; kept honest here)', () => {
  it('GET /bookings rows have serviceName and serviceNameUr', async () => {
    const mine = await callApi<{ items: { id: string; serviceName: string; serviceNameUr: string }[] }>(app, '/bookings', bearer(job.customer.accessToken));
    expect(mine.body.items.length).toBeGreaterThan(0);
    for (const item of mine.body.items) {
      expect(item.serviceName).toEqual(expect.any(String));
      expect(item.serviceNameUr).toEqual(expect.any(String));
    }
    const paged = await callApi<Paged<{ serviceName: string }>>(app, '/bookings?page=1&limit=1', bearer(provider.accessToken));
    expect(paged.body.items[0]!.serviceName).toEqual(expect.any(String));
  });
});

describe('BE-018: the confirmation reads back what the customer submitted', () => {
  it('submission is null before, and the ratings and remark after', async () => {
    const fresh = await completedJob(app, provider, { mode: 'ONLINE' });
    const before = await callApi<{ canSubmit: boolean; submission: unknown }>(app, `/bookings/${fresh.id}/verification/confirmation`, bearer(fresh.customer.accessToken));
    expect(before.body.canSubmit).toBe(true);
    expect(before.body.submission).toBeNull();

    const submitted = await callApi(
      app,
      `/bookings/${fresh.id}/verification/confirmation`,
      bearer(fresh.customer.accessToken, postJson({ workCompleted: 'FULL', quality: 5, punctuality: 4, conduct: 3, cleanliness: 2, extraChargeDemanded: false, consentToRelease: true, outcome: 'SATISFIED', remark: 'Tidy and quick.' }))
    );
    expect(submitted.status).toBe(200);

    const after = await callApi<{ canSubmit: boolean; blockedReason: string | null; submission: Record<string, unknown> | null }>(app, `/bookings/${fresh.id}/verification/confirmation`, bearer(fresh.customer.accessToken));
    expect(after.body.canSubmit).toBe(false);
    expect(after.body.submission).toMatchObject({ outcome: 'LINK_CONFIRMED', workCompleted: 'FULL', quality: 5, punctuality: 4, conduct: 3, cleanliness: 2, extraChargeDemanded: false, remark: 'Tidy and quick.' });
    expect(Date.parse(after.body.submission!.submittedAt as string)).not.toBeNaN();
    // Someone else's booking is still a 404, and the read-back is not an exception to that.
    expect((await callApi(app, `/bookings/${fresh.id}/verification/confirmation`, bearer(job.customer.accessToken))).status).toBe(404);
  });
});

describe('BE-019: a provider can open their own non-CNIC documents', () => {
  it('returns a signed link for their certificate, refuses the CNIC, hides other providers documents, and is provider-only', async () => {
    const owner = await registerAndVerify(app, 'PROVIDER');
    const certificate = await callApi<{ id: string }>(app, '/provider/documents', postJson({ docType: 'TRADE_CERT', contentType: 'application/pdf', contentBase64: Buffer.from('%PDF-1.4 mine').toString('base64') }, owner.accessToken));
    const cnic = await callApi<{ id: string }>(
      app,
      '/provider/documents',
      postJson({ docType: 'CNIC_BACK', contentType: 'image/png', contentBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' }, owner.accessToken)
    );
    expect(certificate.status).toBe(201);

    const link = await callApi<{ url: string; expiresAt: string }>(app, `/provider/documents/${certificate.body.id}/url`, bearer(owner.accessToken));
    expect(link.status).toBe(200);
    expect(link.body.url).toEqual(expect.any(String));
    expect(Date.parse(link.body.expiresAt)).toBeGreaterThan(Date.now());
    const viewed = await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*)::bigint as n FROM audit_log WHERE action = 'provider_document.view_own' AND entity_id = ${certificate.body.id}`);
    expect(Number(viewed[0]!.n)).toBe(1);

    expect((await callApi(app, `/provider/documents/${cnic.body.id}/url`, bearer(owner.accessToken))).status).toBe(403);
    expect((await callApi(app, `/provider/documents/${certificate.body.id}/url`, bearer(provider.accessToken))).status).toBe(404);
    expect((await callApi(app, `/provider/documents/${certificate.body.id}/url`, bearer(job.customer.accessToken))).status).toBe(403);
    expect((await callApi(app, `/provider/documents/${certificate.body.id}/url`)).status).toBe(401);
    expect((await callApi(app, '/provider/documents/not-a-uuid/url', bearer(owner.accessToken))).status).toBe(400);
  });
});

describe('BE-020: the minimum payout is readable by providers', () => {
  it('is on the wallet and the payout list, and matches the admin setting', async () => {
    const setting = await prisma.$queryRaw<{ value: unknown }[]>(Prisma.sql`SELECT value FROM settings WHERE key = 'payout.min_amount_paisa'`);
    const wallet = await callApi<{ minPayoutPaisa: number }>(app, '/provider/wallet', bearer(provider.accessToken));
    expect(wallet.status).toBe(200);
    expect(wallet.body.minPayoutPaisa).toBe(Number(setting[0]!.value));
    const payouts = await callApi<{ items: unknown[]; minPayoutPaisa: number }>(app, '/provider/payouts', bearer(provider.accessToken));
    expect(payouts.body.minPayoutPaisa).toBe(wallet.body.minPayoutPaisa);
    expect((await callApi(app, '/provider/wallet', bearer(job.customer.accessToken))).status).toBe(403);
  });
});

describe('BE-025: an address line and note can be cleared', () => {
  it('null clears line2 and notes; leaving them out keeps them; a string replaces them', async () => {
    const customer = await registerAndVerify(app, 'CUSTOMER');
    const areaId = provider.areaId;
    const created = await callApi<{ id: string; line2: string | null; notes: string | null }>(
      app,
      '/customer/addresses',
      postJson({ label: 'Home', line1: 'House 1', line2: 'Second floor', notes: 'Ring twice', areaId, lat: 31.52, lng: 74.35 }, customer.accessToken)
    );
    expect(created.body).toMatchObject({ line2: 'Second floor', notes: 'Ring twice' });

    const relabelled = await callApi<{ label: string; line2: string | null; notes: string | null }>(app, `/customer/addresses/${created.body.id}`, patchJson({ label: 'Flat' }, customer.accessToken));
    expect(relabelled.body).toMatchObject({ label: 'Flat', line2: 'Second floor', notes: 'Ring twice' });

    const replaced = await callApi<{ line2: string | null; notes: string | null }>(app, `/customer/addresses/${created.body.id}`, patchJson({ line2: 'Third floor' }, customer.accessToken));
    expect(replaced.body).toMatchObject({ line2: 'Third floor', notes: 'Ring twice' });

    const cleared = await callApi<{ line1: string; line2: string | null; notes: string | null }>(app, `/customer/addresses/${created.body.id}`, patchJson({ line2: null, notes: null }, customer.accessToken));
    expect(cleared.status).toBe(200);
    expect(cleared.body).toMatchObject({ line1: 'House 1', line2: null, notes: null });
    const listed = await callApi<{ items: { id: string; line2: string | null; notes: string | null }[] }>(app, '/customer/addresses', bearer(customer.accessToken));
    expect(listed.body.items.find(item => item.id === created.body.id)).toMatchObject({ line2: null, notes: null });
    // line1 is mandatory, so null is not a way to blank it.
    expect((await callApi(app, `/customer/addresses/${created.body.id}`, patchJson({ line1: null }, customer.accessToken))).status).toBe(422);
  });
});

describe('BE-030: a provider can clear their bio and qualification', () => {
  it('null clears; omitted keeps', async () => {
    const someone = await registerAndVerify(app, 'PROVIDER');
    const set = await callApi<{ bio: string | null; qualification: string | null }>(app, '/provider/profile', patchJson({ bio: 'Plumber', qualification: 'Diploma' }, someone.accessToken));
    expect(set.body).toMatchObject({ bio: 'Plumber', qualification: 'Diploma' });
    const other = await callApi<{ bio: string | null; qualification: string | null }>(app, '/provider/profile', patchJson({ experienceYears: 4 }, someone.accessToken));
    expect(other.body).toMatchObject({ bio: 'Plumber', qualification: 'Diploma' });
    const cleared = await callApi<{ bio: string | null; qualification: string | null; experienceYears: number }>(app, '/provider/profile', patchJson({ bio: null, qualification: null }, someone.accessToken));
    expect(cleared.status).toBe(200);
    expect(cleared.body).toMatchObject({ bio: null, qualification: null, experienceYears: 4 });
    const read = await callApi<{ bio: string | null }>(app, '/provider/profile', bearer(someone.accessToken));
    expect(read.body.bio).toBeNull();
  });
});

describe('BE-031: re-adding a removed service at the same price keeps its approval', () => {
  const statusOf = async (providerId: string, serviceId: number) =>
    (await prisma.$queryRaw<{ status: string }[]>(Prisma.sql`SELECT status::text as status FROM provider_services WHERE provider_id = ${providerId}::uuid AND service_id = ${serviceId}`))[0]?.status ?? null;

  it('same price: still APPROVED. A different price, or a service that was never approved: PENDING.', async () => {
    const fresh = await newProvider(app);
    const service = (await prisma.$queryRaw<{ min: bigint; max: bigint }[]>(Prisma.sql`SELECT min_price_paisa as min, max_price_paisa as max FROM services WHERE id = ${fresh.serviceId}`))[0]!;
    const price = Number(service.min);
    expect(await statusOf(fresh.id, fresh.serviceId)).toBe('APPROVED');

    expect((await callApi(app, `/provider/services/${fresh.serviceId}`, deleteWith(fresh.accessToken))).status).toBe(204);
    expect(await statusOf(fresh.id, fresh.serviceId)).toBeNull();
    const readded = await callApi<{ status: string; pricePaisa: number }>(app, `/provider/services/${fresh.serviceId}`, putJson({ pricePaisa: price }, fresh.accessToken));
    expect(readded.body).toMatchObject({ status: 'APPROVED', pricePaisa: price });

    // Removed again, but this time re-added at a different price: it has to be looked at again.
    await callApi(app, `/provider/services/${fresh.serviceId}`, deleteWith(fresh.accessToken));
    const other = price + 100 <= Number(service.max) ? price + 100 : price - 100;
    const changed = await callApi<{ status: string }>(app, `/provider/services/${fresh.serviceId}`, putJson({ pricePaisa: other }, fresh.accessToken));
    expect(changed.body.status).toBe('PENDING');

    // That removal was of a PENDING binding, so adding it back never earns an approval it did not have.
    await callApi(app, `/provider/services/${fresh.serviceId}`, deleteWith(fresh.accessToken));
    const again = await callApi<{ status: string }>(app, `/provider/services/${fresh.serviceId}`, putJson({ pricePaisa: other }, fresh.accessToken));
    expect(again.body.status).toBe('PENDING');

    // A service this provider never offered starts PENDING as always.
    const never = (await prisma.$queryRaw<{ id: number; min: bigint }[]>(Prisma.sql`SELECT id, min_price_paisa as min FROM services WHERE is_active = true AND id <> ${fresh.serviceId} ORDER BY id LIMIT 1`))[0];
    if (never !== undefined) {
      const added = await callApi<{ status: string }>(app, `/provider/services/${never.id}`, putJson({ pricePaisa: Number(never.min) }, fresh.accessToken));
      expect(added.body.status).toBe('PENDING');
    }
  });

  it('an approval an admin has since withdrawn is not resurrected by a re-add', async () => {
    const fresh = await newProvider(app);
    const price = Number((await prisma.$queryRaw<{ min: bigint }[]>(Prisma.sql`SELECT min_price_paisa as min FROM services WHERE id = ${fresh.serviceId}`))[0]!.min);
    // Reject first (admin decision), then the provider removes and re-adds: the last thing known about the binding is REJECTED.
    await callApi(app, `/admin/provider-services/${fresh.id}/${fresh.serviceId}/reject`, asAdmin({ method: 'POST' }));
    expect(await statusOf(fresh.id, fresh.serviceId)).toBe('REJECTED');
    await callApi(app, `/provider/services/${fresh.serviceId}`, deleteWith(fresh.accessToken));
    const readded = await callApi<{ status: string }>(app, `/provider/services/${fresh.serviceId}`, putJson({ pricePaisa: price }, fresh.accessToken));
    expect(readded.body.status).toBe('PENDING');
  });
});
