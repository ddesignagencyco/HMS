// apps/api/test/integration/admin-management.test.ts
//
// SHM-024: the admin management surfaces — users (block/unblock/deactivate,
// send-reset), roles, staff-conflict declarations, the audit-log query, customer
// management and the provider block/unblock/deactivate buttons. All soft, all
// ADMIN + TOTP gated. Its own file for the same per-file rate-limiter reason as
// the other integration splits.
import { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { adminSession, callApi, createTestApp, loginAs, postJson, readOtpFromInbox, readyBookableProvider, registerAndVerify } from './harness.js';

const prisma = new PrismaClient();

let app: NestExpressApplication;
let close: () => Promise<void>;

beforeAll(async () => {
  const started = await createTestApp();
  app = started.app;
  close = started.close;
});

afterAll(async () => {
  await close();
  await prisma.$disconnect();
});

const bearer = (accessToken: string, init: RequestInit = {}): RequestInit => ({ ...init, headers: { ...init.headers, authorization: `Bearer ${accessToken}` } });

const activeSessions = async (userId: string): Promise<number> => {
  const rows = await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*)::bigint as n FROM sessions WHERE user_id = ${userId}::uuid AND revoked_at IS NULL`);
  return Number(rows[0]?.n);
};

describe('SHM-024: admin user management', () => {
  it('lists users with role and search filters, and refuses non-admins', async () => {
    const admin = await adminSession(app);
    const provider = await registerAndVerify(app, 'PROVIDER');

    const filtered = await callApi<{ items: { id: string; roles: string[] }[] }>(app, '/admin/users?role=PROVIDER&q=Test', bearer(admin.accessToken));
    expect(filtered.status).toBe(200);
    expect(filtered.body.items.some(item => item.id === provider.id && item.roles.includes('PROVIDER'))).toBe(true);

    expect((await callApi(app, '/admin/users')).status).toBe(401);
    expect((await callApi(app, '/admin/users', bearer(provider.accessToken))).status).toBe(403);
  });

  it('blocks and unblocks a user, revoking sessions and stopping sign-in while blocked', async () => {
    const admin = await adminSession(app);
    const customer = await registerAndVerify(app, 'CUSTOMER');
    expect(await activeSessions(customer.id)).toBeGreaterThan(0);

    const blocked = await callApi<{ status: string }>(app, `/admin/users/${customer.id}/block`, bearer(admin.accessToken, { method: 'POST' }));
    expect(blocked.status).toBe(200);
    expect(blocked.body.status).toBe('LOCKED');
    expect(await activeSessions(customer.id)).toBe(0);
    expect((await loginAs(app, customer.phoneE164, 'CorrectHorse9Battery')).status).toBe(403);
    expect((await callApi(app, `/admin/users/${customer.id}/block`, bearer(admin.accessToken, { method: 'POST' }))).status).toBe(409);

    const unblocked = await callApi<{ status: string }>(app, `/admin/users/${customer.id}/unblock`, bearer(admin.accessToken, { method: 'POST' }));
    expect(unblocked.body.status).toBe('ACTIVE');
    expect((await loginAs(app, customer.phoneE164, 'CorrectHorse9Battery')).status).toBe(201);
  });

  it('deactivates a user without deleting the row', async () => {
    const admin = await adminSession(app);
    const customer = await registerAndVerify(app, 'CUSTOMER');

    const deactivated = await callApi<{ status: string }>(app, `/admin/users/${customer.id}/deactivate`, bearer(admin.accessToken, { method: 'POST' }));
    expect(deactivated.body.status).toBe('DEACTIVATED');
    expect((await loginAs(app, customer.phoneE164, 'CorrectHorse9Battery')).status).toBe(403);

    const rows = await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*)::bigint as n FROM users WHERE id = ${customer.id}::uuid`);
    expect(Number(rows[0]?.n)).toBe(1);
  });

  it('sends a password reset to the account owner and audits it, never touching a password', async () => {
    const admin = await adminSession(app);
    const customer = await registerAndVerify(app, 'CUSTOMER');

    const sent = await callApi<{ sent: boolean }>(app, `/admin/users/${customer.id}/send-reset`, bearer(admin.accessToken, { method: 'POST' }));
    expect(sent.status).toBe(200);
    expect(sent.body.sent).toBe(true);
    await expect(readOtpFromInbox(app, customer.phoneE164)).resolves.toMatch(/^\d{6}$/);

    const audit = await prisma.$queryRaw<{ n: bigint }[]>(
      Prisma.sql`SELECT count(*)::bigint as n FROM audit_log WHERE action = 'admin.user.send_reset' AND entity_id = ${customer.id}`
    );
    expect(Number(audit[0]?.n)).toBe(1);
  });
});

describe('SHM-024: roles', () => {
  it('lists the RBAC matrix and grants and revokes a role', async () => {
    const admin = await adminSession(app);
    const roles = await callApi<{ items: { code: string; permissions: string[] }[] }>(app, '/admin/roles', bearer(admin.accessToken));
    expect(roles.status).toBe(200);
    expect(roles.body.items.map(r => r.code)).toEqual(expect.arrayContaining(['CUSTOMER', 'PROVIDER', 'AGENT', 'FINANCE', 'ADMIN']));

    const provider = await registerAndVerify(app, 'PROVIDER');
    expect((await callApi(app, `/admin/users/${provider.id}/roles/ADMIN`, bearer(admin.accessToken, { method: 'POST' }))).status).toBe(200);

    const withAdmin = await callApi<{ items: { id: string; roles: string[] }[] }>(app, '/admin/users?role=ADMIN', bearer(admin.accessToken));
    expect(withAdmin.body.items.some(item => item.id === provider.id)).toBe(true);

    expect((await callApi(app, `/admin/users/${provider.id}/roles/ADMIN`, bearer(admin.accessToken, { method: 'DELETE' }))).status).toBe(200);
    expect((await callApi(app, `/admin/users/${provider.id}/roles/ADMIN`, bearer(admin.accessToken, { method: 'DELETE' }))).status).toBe(409);
    expect((await callApi(app, `/admin/users/${provider.id}/roles/SUPERHERO`, bearer(admin.accessToken, { method: 'POST' }))).status).toBe(422);
  });
});

describe('SHM-024: staff conflict declarations', () => {
  it('declares, lists, updates and withdraws a conflict', async () => {
    const admin = await adminSession(app);
    const first = await registerAndVerify(app, 'CUSTOMER');
    const second = await registerAndVerify(app, 'CUSTOMER');

    const created = await callApi<{ id: string }>(app, '/admin/staff-conflicts', bearer(admin.accessToken, postJson({ staffUserId: first.id, otherUserId: second.id, reason: 'Immediate family member' })));
    expect(created.status).toBe(201);

    const listed = await callApi<{ items: { id: string }[] }>(app, '/admin/staff-conflicts', bearer(admin.accessToken));
    expect(listed.body.items.some(item => item.id === created.body.id)).toBe(true);

    // Re-declaring the same pair updates the reason rather than adding a row.
    expect((await callApi(app, '/admin/staff-conflicts', bearer(admin.accessToken, postJson({ staffUserId: first.id, otherUserId: second.id, reason: 'Business partner' })))).status).toBe(201);
    const twice = await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*)::bigint as n FROM staff_conflicts WHERE staff_user_id = ${first.id}::uuid AND other_user_id = ${second.id}::uuid`);
    expect(Number(twice[0]?.n)).toBe(1);

    expect((await callApi(app, '/admin/staff-conflicts', bearer(admin.accessToken, postJson({ staffUserId: first.id, otherUserId: first.id, reason: 'Self' })))).status).toBe(422);
    expect((await callApi(app, '/admin/staff-conflicts', bearer(admin.accessToken, postJson({ staffUserId: first.id, otherUserId: '00000000-0000-0000-0000-000000000000', reason: 'Ghost' })))).status).toBe(404);

    expect((await callApi(app, `/admin/staff-conflicts/${created.body.id}`, bearer(admin.accessToken, { method: 'DELETE' }))).status).toBe(204);
    expect((await callApi(app, `/admin/staff-conflicts/${created.body.id}`, bearer(admin.accessToken, { method: 'DELETE' }))).status).toBe(404);
  });
});

describe('SHM-024: audit log query', () => {
  it('filters the append-only log by action, actor and entity', async () => {
    const admin = await adminSession(app);
    const customer = await registerAndVerify(app, 'CUSTOMER');
    await callApi(app, `/admin/users/${customer.id}/block`, bearer(admin.accessToken, { method: 'POST' }));

    const found = await callApi<{ items: { action: string; entityId: string; actorUserId: string | null }[] }>(
      app,
      `/admin/audit?action=admin.user.block&entityType=user&entityId=${customer.id}`,
      bearer(admin.accessToken)
    );
    expect(found.status).toBe(200);
    expect(found.body.items).toHaveLength(1);
    expect(found.body.items[0]?.actorUserId).toBe(admin.userId);

    expect((await callApi(app, '/admin/audit', bearer(customer.accessToken))).status).toBe(403);
  });
});

describe('SHM-024: customers and provider status', () => {
  it('lists customers and deactivates one softly', async () => {
    const admin = await adminSession(app);
    const customer = await registerAndVerify(app, 'CUSTOMER');

    const listed = await callApi<{ items: { userId: string }[] }>(app, `/admin/customers?q=${customer.phoneE164}`, bearer(admin.accessToken));
    expect(listed.status).toBe(200);
    expect(listed.body.items.some(item => item.userId === customer.id)).toBe(true);

    expect((await callApi(app, `/admin/customers/${customer.id}/deactivate`, bearer(admin.accessToken, { method: 'POST' }))).status).toBe(200);
  });

  it('blocks, unblocks and deactivates a provider', async () => {
    const admin = await adminSession(app);
    const { provider } = await readyBookableProvider(app);

    const blocked = await callApi<{ status: string }>(app, `/admin/providers/${provider.id}/block`, bearer(admin.accessToken, { method: 'POST' }));
    expect(blocked.body.status).toBe('BLOCKED');
    expect((await callApi(app, `/admin/providers/${provider.id}/block`, bearer(admin.accessToken, { method: 'POST' }))).status).toBe(409);

    const unblocked = await callApi<{ status: string }>(app, `/admin/providers/${provider.id}/unblock`, bearer(admin.accessToken, { method: 'POST' }));
    expect(unblocked.body.status).toBe('APPROVED');

    expect((await callApi(app, `/admin/providers/${provider.id}/deactivate`, bearer(admin.accessToken, { method: 'POST' }))).status).toBe(200);
    expect((await callApi(app, `/admin/providers/${provider.id}/block`, bearer(provider.accessToken, { method: 'POST' }))).status).toBe(403);
  });
});
