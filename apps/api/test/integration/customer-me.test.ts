// apps/api/test/integration/customer-me.test.ts
//
// SHM-020: the account-owner surface — profile read/update, password change that
// signs out other sessions, favourites, and deactivation that anonymises the PII
// while leaving the financial records behind. Its own file for the same per-file
// rate-limiter reason as the other integration splits.
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { callApi, createTestApp, deleteWith, loginAs, patchJson, postJson, readyBookableProvider, registerAndVerify } from './harness.js';

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

const PASSWORD = 'CorrectHorse9Battery';

const slotAt = (hoursFromNow: number): { scheduledStart: string; scheduledEnd: string } => {
  const start = new Date(Date.now() + hoursFromNow * 60 * 60 * 1000);
  return { scheduledStart: start.toISOString(), scheduledEnd: new Date(start.getTime() + 60 * 60 * 1000).toISOString() };
};

type MeUser = { id: string; firstName: string; lastName: string; locale: string; email: string | null; phoneE164: string | null; status: string; roles: string[] };

describe('SHM-020: customer profile', () => {
  it('returns the signed-in user with their roles and updates the fields the user owns', async () => {
    const customer = await registerAndVerify(app, 'CUSTOMER');

    const before = await callApi<{ user: MeUser }>(app, '/me', bearer(customer.accessToken));
    expect(before.status).toBe(200);
    expect(before.body.user.firstName).toBe('Test');
    expect(before.body.user.roles).toContain('CUSTOMER');

    const updated = await callApi<{ user: MeUser }>(app, '/me', bearer(customer.accessToken, patchJson({ firstName: 'Ayesha', lastName: 'Khan', locale: 'ur' })));
    expect(updated.status).toBe(200);
    expect(updated.body.user.firstName).toBe('Ayesha');
    expect(updated.body.user.lastName).toBe('Khan');
    expect(updated.body.user.locale).toBe('ur');

    const reread = await callApi<{ user: MeUser }>(app, '/me', bearer(customer.accessToken));
    expect(reread.body.user.firstName).toBe('Ayesha');
    expect(reread.body.user.locale).toBe('ur');
  });

  it('rejects an empty or unknown-field profile update', async () => {
    const customer = await registerAndVerify(app, 'CUSTOMER');
    expect((await callApi(app, '/me', bearer(customer.accessToken, patchJson({})))).status).toBe(422);
    expect((await callApi(app, '/me', bearer(customer.accessToken, patchJson({ phoneE164: '+923001111111' })))).status).toBe(422);
  });

  it('changes the password with the current one and revokes every other session but this one', async () => {
    const customer = await registerAndVerify(app, 'CUSTOMER');
    // A second live session, as if the account were signed in on another device.
    const second = await loginAs(app, customer.phoneE164, PASSWORD);
    expect(second.status).toBe(201);

    const wrong = await callApi(app, '/me/password', bearer(customer.accessToken, patchJson({ currentPassword: 'NotMyPassword1', newPassword: 'BrandNewPass9' })));
    expect(wrong.status).toBe(401);

    const changed = await callApi<{ changed: boolean; otherSessionsRevoked: number }>(app, '/me/password', bearer(customer.accessToken, patchJson({ currentPassword: PASSWORD, newPassword: 'BrandNewPass9' })));
    expect(changed.status).toBe(200);
    expect(changed.body.changed).toBe(true);
    expect(changed.body.otherSessionsRevoked).toBeGreaterThanOrEqual(1);

    // The caller keeps their session; the other device does not.
    expect((await callApi(app, '/me', bearer(customer.accessToken))).status).toBe(200);
    const live = await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*)::bigint as n FROM sessions WHERE user_id = ${customer.id}::uuid AND revoked_at IS NULL`);
    expect(Number(live[0]?.n)).toBe(1);

    // The old password no longer works, the new one does.
    expect((await loginAs(app, customer.phoneE164, PASSWORD)).status).toBe(401);
    expect((await loginAs(app, customer.phoneE164, 'BrandNewPass9')).status).toBe(201);
  });

  it('refuses a weak new password at the edge', async () => {
    const customer = await registerAndVerify(app, 'CUSTOMER');
    const response = await callApi(app, '/me/password', bearer(customer.accessToken, patchJson({ currentPassword: PASSWORD, newPassword: 'short' })));
    expect(response.status).toBe(422);
  });
});

describe('SHM-020: favourites', () => {
  it('adds, lists idempotently and removes approved providers', async () => {
    const customer = await registerAndVerify(app, 'CUSTOMER');
    const { provider } = await readyBookableProvider(app);

    const added = await callApi<{ favourited: boolean }>(app, `/me/favourites/${provider.id}`, bearer(customer.accessToken, { method: 'POST' }));
    expect(added.status).toBe(200);
    expect(added.body.favourited).toBe(true);

    // Adding the same provider again is a no-op, not a duplicate row.
    expect((await callApi(app, `/me/favourites/${provider.id}`, bearer(customer.accessToken, { method: 'POST' }))).status).toBe(200);
    const list = await callApi<{ items: { providerId: string }[] }>(app, '/me/favourites', bearer(customer.accessToken));
    expect(list.body.items.filter(item => item.providerId === provider.id)).toHaveLength(1);

    expect((await callApi(app, `/me/favourites/${provider.id}`, bearer(customer.accessToken, deleteWith()))).status).toBe(204);
    expect((await callApi(app, `/me/favourites/${provider.id}`, bearer(customer.accessToken, deleteWith()))).status).toBe(400);
  });

  it('will not favourite a provider that is not approved, and keeps the surface customer-only', async () => {
    const customer = await registerAndVerify(app, 'CUSTOMER');
    const pending = await registerAndVerify(app, 'PROVIDER');

    expect((await callApi(app, `/me/favourites/${pending.id}`, bearer(customer.accessToken, { method: 'POST' }))).status).toBe(404);

    const { provider } = await readyBookableProvider(app);
    expect((await callApi(app, `/me/favourites/${provider.id}`, { method: 'POST' })).status).toBe(401);
    expect((await callApi(app, '/me/favourites', { method: 'GET' })).status).toBe(401);
  });
});

describe('SHM-020: deactivate', () => {
  it('anonymises name, phone and email and revokes sessions while keeping bookings and the ledger', async () => {
    const { provider, serviceId, areaId } = await readyBookableProvider(app);
    const customer = await registerAndVerify(app, 'CUSTOMER');
    const address = await callApi<{ id: string }>(app, '/customer/addresses', bearer(customer.accessToken, postJson({ label: 'Home', line1: 'House 7', areaId, lat: 31.52, lng: 74.35, isDefault: true })));
    const booking = await callApi<{ id: string }>(app, '/bookings', bearer(customer.accessToken, postJson({ providerId: provider.id, serviceId, addressId: address.body.id, paymentMode: 'CASH', ...slotAt(4000) })));
    expect(booking.status).toBe(201);

    // A ledger account owned by this customer, with one balanced transaction, to prove the money tables are untouched.
    const [account] = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`INSERT INTO ledger_accounts(type, owner_user_id) VALUES ('PROVIDER_WALLET', ${customer.id}::uuid) RETURNING id`);
    await prisma.$transaction(async tx => {
      const [txn] = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`INSERT INTO ledger_transactions(type, idempotency_key) VALUES ('ADJUSTMENT', ${`shm020-${randomUUID()}`}) RETURNING id`);
      await tx.$executeRaw(Prisma.sql`INSERT INTO ledger_entries(transaction_id, account_id, direction, amount_paisa) VALUES (${txn!.id}::uuid, ${account!.id}::uuid, 'DEBIT', 100)`);
      await tx.$executeRaw(Prisma.sql`INSERT INTO ledger_entries(transaction_id, account_id, direction, amount_paisa) VALUES (${txn!.id}::uuid, ${account!.id}::uuid, 'CREDIT', 100)`);
    });

    const deactivated = await callApi<{ status: string }>(app, '/me/deactivate', bearer(customer.accessToken, { method: 'POST' }));
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.status).toBe('DEACTIVATED');

    const [user] = await prisma.$queryRaw<{ first_name: string; last_name: string; email: string | null; phone_e164: string | null; status: string; anonymised_at: Date | null }[]>(
      Prisma.sql`SELECT first_name, last_name, email, phone_e164, status, anonymised_at FROM users WHERE id = ${customer.id}::uuid`
    );
    expect(user?.first_name).toBe('Deleted');
    expect(user?.last_name).toBe('');
    expect(user?.phone_e164).toBeNull();
    expect(user?.email).toContain('anonymised.invalid');
    expect(user?.status).toBe('DEACTIVATED');
    expect(user?.anonymised_at).not.toBeNull();

    const [kept] = await prisma.$queryRaw<{ customer_id: string }[]>(Prisma.sql`SELECT customer_id FROM bookings WHERE id = ${booking.body.id}::uuid`);
    expect(kept?.customer_id).toBe(customer.id);
    const ledger = await prisma.$queryRaw<{ accounts: bigint; entries: bigint }[]>(
      Prisma.sql`SELECT (SELECT count(*) FROM ledger_accounts WHERE owner_user_id = ${customer.id}::uuid)::bigint as accounts,
          (SELECT count(*) FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id WHERE a.owner_user_id = ${customer.id}::uuid)::bigint as entries`
    );
    expect(Number(ledger[0]?.accounts)).toBe(1);
    expect(Number(ledger[0]?.entries)).toBe(2);

    const live = await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*)::bigint as n FROM sessions WHERE user_id = ${customer.id}::uuid AND revoked_at IS NULL`);
    expect(Number(live[0]?.n)).toBe(0);

    // Deactivating twice is a conflict rather than a second anonymisation.
    expect((await callApi(app, '/me/deactivate', bearer(customer.accessToken, { method: 'POST' }))).status).toBe(409);

    // FR-CU-09: the old credentials no longer sign the account in.
    expect((await loginAs(app, customer.phoneE164, PASSWORD)).status).toBe(401);
  });
});
