// apps/api/test/integration/phase3-backend.test.ts
//
// Phase 3 (search, i18n, hardening) - the backend items that need the whole app:
//   BE-010 search without a service, sort, minRating, paging
//   BE-011 / BE-029 Accept-Language: ur for the verification confirmation, payout and price sentences
//   BE-013 / BE-006 inline document body limit and presigned-confirm size/MIME enforcement
//   BE-026 time-off offsets
//   BE-022 photos on booking create
//   BE-027 refresh-token reuse grace window
//   BE-017 concurrency (nothing may answer 500 under modest parallel load)
//   BE-028 seeded area centroids
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DomainError } from '../../src/common/domain-error.js';
import { hashRefreshToken } from '../../src/identity/tokens.js';
import { SessionService } from '../../src/identity/session.service.js';
import { OBJECT_STORAGE } from '../../src/integrations/integrations.module.js';
import type { ObjectStoragePort } from '../../src/integrations/ports.js';
import { callApi, createTestApp, headerOf, loginAs, patchJson, postJson, putJson, registerAndVerify, type TestUser } from './harness.js';
import { agentSession, agentVerify, bearer, completedJob, freezeInsideCallingHours, JPEG, newProvider, prisma, unfreeze, type Provider } from './flow.js';

let app: NestExpressApplication;
let close: () => Promise<void>;
beforeAll(async () => {
  const started = await createTestApp();
  app = started.app;
  close = started.close;
});

afterAll(async () => {
  unfreeze(app);
  await close();
  await prisma.$disconnect();
});

const URDU = /[؀-ۿ]/;
const PASSWORD = 'CorrectHorse9Battery';

// ------------------------------------------------------------------------ BE-010: search

describe('BE-010: provider search without a service, with sort, minRating and paging', () => {
  type Item = { providerId: string; pricePaisa: number; distanceM: number; ratingScore: number | null; ratingCount: number };
  type Result = { items: Item[]; pagination: { total: number; page: number; limit: number; hasMore: boolean }; truncated: boolean };

  let near: Provider;
  let middle: Provider;
  let far: Provider;
  let minPrice: number;
  let lat: number;
  let lng: number;

  beforeAll(async () => {
    freezeInsideCallingHours(app);
    // A remote, per-run centre so the providers below are (nearly) alone in range; assertions still filter to their own ids.
    lat = 21.1 + Math.random();
    lng = 61.1 + Math.random();
    near = await newProvider(app, { lat, lng });
    middle = await newProvider(app, { lat: lat + 0.005, lng });
    far = await newProvider(app, { lat: lat + 0.01, lng });
    const service = (await callApi<{ minPricePaisa: number }>(app, '/catalogue/services/leak-repair')).body;
    minPrice = service.minPricePaisa;
    // price: middle cheapest, far next, near dearest; experience: middle most, far next, near least; rating: only `far` gets one.
    const setup: [Provider, number, number][] = [
      [near, minPrice + 200, 3],
      [middle, minPrice, 10],
      [far, minPrice + 100, 5]
    ];
    for (const [provider, price, years] of setup) {
      expect((await callApi(app, `/provider/services/${provider.serviceId}`, putJson({ pricePaisa: price }, provider.accessToken))).status).toBe(200);
      expect((await callApi(app, '/provider/profile', bearer(provider.accessToken, patchJson({ experienceYears: years })))).status).toBe(200);
    }
    const job = await completedJob(app, far, { mode: 'CASH' });
    const agent = await agentSession(app, 'agent1');
    expect((await agentVerify(app, agent, job)).status).toBe(200);
  }, 120_000);

  afterAll(() => unfreeze(app));

  const mine = (): string[] => [near.id, middle.id, far.id];
  const search = (query: string) => callApi<Result>(app, `/search/providers?lat=${lat}&lng=${lng}&limit=100${query}`);
  const ordered = async (query: string): Promise<string[]> => (await search(query)).body.items.map(item => item.providerId).filter(id => mine().includes(id));

  it('works without a serviceSlug: every provider in range once, at their price, with the paging envelope', async () => {
    const response = await search('');
    expect(response.status).toBe(200);
    const ids = response.body.items.map(item => item.providerId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of mine()) expect(ids).toContain(id);
    const middleRow = response.body.items.find(item => item.providerId === middle.id)!;
    expect(middleRow.pricePaisa).toBe(minPrice);
    expect(response.body.pagination.total).toBeGreaterThanOrEqual(3);
    expect(response.body.pagination.page).toBe(1);
  });

  it('a search with a serviceSlug and no paging parameters still returns the whole list, now with pagination.total', async () => {
    const response = await callApi<Result>(app, `/search/providers?serviceSlug=leak-repair&lat=${lat}&lng=${lng}`);
    expect(response.status).toBe(200);
    expect(response.body.pagination.total).toBe(response.body.items.length);
    expect(response.body.truncated).toBe(false);
    expect(response.body.items.map(item => item.providerId)).toEqual(expect.arrayContaining(mine()));
  });

  it('still answers 404 for an unknown service and 422 for a bad sort', async () => {
    expect((await search('&serviceSlug=no-such-service')).status).toBe(404);
    expect((await search('&sort=cheapest')).status).toBe(422);
  });

  it('sorts by distance, rating, price and experience', async () => {
    expect(await ordered('&sort=distance')).toEqual([near.id, middle.id, far.id]);
    expect((await ordered('&sort=rating'))[0]).toBe(far.id);
    expect(await ordered('&sort=price_asc')).toEqual([middle.id, far.id, near.id]);
    expect(await ordered('&sort=price_desc')).toEqual([near.id, far.id, middle.id]);
    expect(await ordered('&sort=experience')).toEqual([middle.id, far.id, near.id]);
    // The same through a service, not only without one.
    expect(await ordered('&serviceSlug=leak-repair&sort=price_asc')).toEqual([middle.id, far.id, near.id]);
  });

  it('minRating keeps only providers whose published rating reaches it; unrated providers are excluded', async () => {
    const rated = (await search('&minRating=1')).body.items.map(item => item.providerId);
    expect(rated).toContain(far.id);
    expect(rated).not.toContain(near.id);
    expect(rated).not.toContain(middle.id);
    const none = (await search('&minRating=5')).body.items.map(item => item.providerId);
    expect(none).not.toContain(far.id); // one 5/4/5/4 review pulled toward the prior is not a 5.0
    // 0 is no filter at all.
    const all = (await search('&minRating=0')).body.items.map(item => item.providerId);
    for (const id of mine()) expect(all).toContain(id);
    expect((await search('&minRating=6')).status).toBe(422);
  });

  it('pages the ranked list: limit/page, hasMore, and pages that do not overlap', async () => {
    const first = await callApi<Result>(app, `/search/providers?lat=${lat}&lng=${lng}&sort=distance&limit=1&page=1`);
    const second = await callApi<Result>(app, `/search/providers?lat=${lat}&lng=${lng}&sort=distance&limit=1&page=2`);
    expect(first.body.items).toHaveLength(1);
    expect(second.body.items).toHaveLength(1);
    expect(first.body.pagination).toMatchObject({ page: 1, limit: 1, hasMore: true });
    expect(first.body.pagination.total).toBeGreaterThanOrEqual(3);
    expect(first.body.truncated).toBe(true);
    expect(second.body.items[0]!.providerId).not.toBe(first.body.items[0]!.providerId);
    expect((await callApi(app, `/search/providers?lat=${lat}&lng=${lng}&limit=101`)).status).toBe(422);
  });
});

// ------------------------------------------------------------------------ BE-011 / BE-029: Accept-Language

describe('BE-011: the verification confirmation speaks Urdu on request', () => {
  let provider: Provider;
  let nameEn: string;
  let nameUr: string;
  const ur = (token: string, init: RequestInit = {}): RequestInit => ({ ...init, headers: { ...init.headers, authorization: `Bearer ${token}`, 'accept-language': 'ur-PK,ur;q=0.9' } });
  const happy = { workCompleted: 'FULL', quality: 5, punctuality: 5, conduct: 4, cleanliness: 5, extraChargeDemanded: false, consentToRelease: true, outcome: 'SATISFIED', remark: 'Sorted it first time, very tidy.' };

  type Form = { serviceName: string; canSubmit: boolean; blockedReason: string | null; questions: { key: string; label: string }[] };

  beforeAll(async () => {
    freezeInsideCallingHours(app);
    provider = await newProvider(app);
    const service = (await callApi<{ nameEn: string; nameUr: string }>(app, '/catalogue/services/leak-repair')).body;
    nameEn = service.nameEn;
    nameUr = service.nameUr;
  }, 60_000);

  afterAll(() => unfreeze(app));

  it('returns the Urdu service name and question labels, and keeps English as the default', async () => {
    const job = await completedJob(app, provider, { mode: 'ONLINE' });
    const english = await callApi<Form>(app, `/bookings/${job.id}/verification/confirmation`, bearer(job.customer.accessToken));
    expect(english.body.serviceName).toBe(nameEn);
    expect(english.body.questions[0]!.label).toBe('Was the work completed?');

    const urdu = await callApi<Form>(app, `/bookings/${job.id}/verification/confirmation`, ur(job.customer.accessToken));
    expect(urdu.status).toBe(200);
    expect(urdu.body.serviceName).toBe(nameUr);
    expect(urdu.body.canSubmit).toBe(true);
    for (const question of urdu.body.questions) expect(question.label).toMatch(URDU);
  });

  it('writes the thank-you message and the blocked reason in Urdu', async () => {
    const job = await completedJob(app, provider, { mode: 'ONLINE' });
    const done = await callApi<{ outcome: string; message: string }>(app, `/bookings/${job.id}/verification/confirmation`, ur(job.customer.accessToken, postJson(happy)));
    expect(done.status).toBe(200);
    expect(done.body.message).toMatch(URDU);
    expect(done.body.message).not.toMatch(/Thank you/);

    const after = await callApi<Form>(app, `/bookings/${job.id}/verification/confirmation`, ur(job.customer.accessToken));
    expect(after.body.canSubmit).toBe(false);
    expect(after.body.blockedReason).toMatch(URDU);
    const afterEnglish = await callApi<Form>(app, `/bookings/${job.id}/verification/confirmation`, bearer(job.customer.accessToken));
    expect(afterEnglish.body.blockedReason).toMatch(/^[\x20-\x7E]+$/);
  });

  it('writes the escalation message and the already-escalated reason in Urdu', async () => {
    const job = await completedJob(app, provider, { mode: 'ONLINE' });
    const escalated = await callApi<{ outcome: string; message: string }>(app, `/bookings/${job.id}/verification/confirmation`, ur(job.customer.accessToken, postJson({ ...happy, outcome: 'NOT_ACCEPTABLE', remark: 'Nothing was fixed.' })));
    expect(escalated.body.outcome).toBe('ESCALATED');
    expect(escalated.body.message).toMatch(URDU);
    const reread = await callApi<Form>(app, `/bookings/${job.id}/verification/confirmation`, ur(job.customer.accessToken));
    expect(reread.body.canSubmit).toBe(false);
    expect(reread.body.blockedReason).toMatch(URDU);
    // A second attempt is a 409 whose detail is the Urdu reason.
    const again = await callApi<{ detail: string }>(app, `/bookings/${job.id}/verification/confirmation`, ur(job.customer.accessToken, postJson(happy)));
    expect(again.status).toBe(409);
    expect(again.body.detail).toMatch(URDU);
  });
});

describe('BE-029: payout and price sentences are in rupees and honour Accept-Language', () => {
  const ur = (token: string, init: RequestInit = {}): RequestInit => ({ ...init, headers: { ...init.headers, authorization: `Bearer ${token}`, 'accept-language': 'ur' } });
  let provider: TestUser;
  let accountId: string;

  beforeAll(async () => {
    provider = await registerAndVerify(app, 'PROVIDER');
    const account = await callApi<{ id: string }>(app, '/provider/payout-accounts', bearer(provider.accessToken, postJson({ kind: 'BANK', accountTitle: 'Test Provider', institution: 'HBL', accountNumber: '01234567890123' })));
    expect(account.status).toBe(201);
    accountId = account.body.id;
  });

  it('the smallest-payout sentence names rupees, not paisa, in English and Urdu', async () => {
    const english = await callApi<{ detail: string }>(app, '/provider/payouts', bearer(provider.accessToken, postJson({ amountPaisa: 1, payoutAccountId: accountId })));
    expect(english.status).toBe(400);
    expect(english.body.detail).toMatch(/^The smallest payout is Rs [\d,.]+$/);
    expect(english.body.detail).not.toMatch(/paisa/i);

    const urdu = await callApi<{ detail: string }>(app, '/provider/payouts', ur(provider.accessToken, postJson({ amountPaisa: 1, payoutAccountId: accountId })));
    expect(urdu.status).toBe(400);
    expect(urdu.body.detail).toMatch(URDU);
    expect(urdu.body.detail).toMatch(/\d/);
    expect(urdu.body.detail).not.toMatch(/paisa/i);
  });

  it('the "at most" sentence names rupees, in both languages', async () => {
    const english = await callApi<{ detail: string }>(app, '/provider/payouts', bearer(provider.accessToken, postJson({ amountPaisa: 1_000_000_000, payoutAccountId: accountId })));
    expect(english.status).toBe(409);
    expect(english.body.detail).toMatch(/^You can request at most Rs [\d,.]+ right now$/);
    const urdu = await callApi<{ detail: string }>(app, '/provider/payouts', ur(provider.accessToken, postJson({ amountPaisa: 1_000_000_000, payoutAccountId: accountId })));
    expect(urdu.body.detail).toMatch(URDU);
    expect(urdu.body.detail).not.toMatch(/paisa/i);
  });

  it('the out-of-band price sentence names rupees, in both languages', async () => {
    const service = (await callApi<{ id: number; maxPricePaisa: number }>(app, '/catalogue/services/leak-repair')).body;
    const tooHigh = { pricePaisa: service.maxPricePaisa + 100_000 };
    const english = await callApi<{ errors: { message: string }[] }>(app, `/provider/services/${service.id}`, putJson(tooHigh, provider.accessToken));
    expect(english.status).toBe(422);
    expect(english.body.errors[0]!.message).toMatch(/^The price must be between Rs [\d,.]+ and Rs [\d,.]+ for this service$/);
    const urdu = await callApi<{ errors: { message: string }[] }>(app, `/provider/services/${service.id}`, ur(provider.accessToken, putJson(tooHigh)));
    expect(urdu.body.errors[0]!.message).toMatch(URDU);
    expect(urdu.body.errors[0]!.message).not.toMatch(/paisa/i);
  });
});

// ------------------------------------------------------------------------ BE-013 / BE-006: documents

describe('BE-013: the inline document route takes a normal phone photo', () => {
  it('accepts a 3 MB inline image (it used to 413 at the global 1 MB limit)', async () => {
    const provider = await registerAndVerify(app, 'PROVIDER');
    const contentBase64 = Buffer.alloc(3 * 1024 * 1024, 7).toString('base64');
    expect(contentBase64.length).toBeGreaterThan(1_048_576);
    const response = await callApi<{ id: string; docType: string }>(app, '/provider/documents', postJson({ docType: 'CNIC_FRONT', contentType: 'image/jpeg', contentBase64 }, provider.accessToken));
    expect(response.status).toBe(201);
    expect(response.body.docType).toBe('CNIC_FRONT');
  });

  it('a body past the 8 MB ceiling is a clear 413 problem+json, and other routes keep the 1 MB limit', async () => {
    const provider = await registerAndVerify(app, 'PROVIDER');
    const huge = await callApi<{ code: string; status: number }>(app, '/provider/documents', postJson({ docType: 'CNIC_FRONT', contentType: 'image/jpeg', contentBase64: 'A'.repeat(9_000_000) }, provider.accessToken));
    expect(huge.status).toBe(413);
    expect(huge.body).toMatchObject({ code: 'PAYLOAD_TOO_LARGE', status: 413 });
    expect(headerOf(huge as never, 'content-type')).toContain('application/problem+json');

    const elsewhere = await callApi(app, '/provider/profile', patchJson({ bio: 'x'.repeat(2_000_000) }, provider.accessToken));
    expect(elsewhere.status).toBe(413);
  });
});

describe('BE-006: confirming a presigned document checks the stored size and type', () => {
  const storage = (): ObjectStoragePort => app.get<ObjectStoragePort>(OBJECT_STORAGE);
  const confirm = (provider: TestUser, storageKey: string) => callApi<{ code: string; detail: string }>(app, '/provider/documents', postJson({ docType: 'CNIC_FRONT', storageKey }, provider.accessToken));
  const land = async (provider: TestUser, bytes: number, contentType: string): Promise<string> => {
    const key = `${provider.id}/CNIC_FRONT/${randomUUID()}`;
    await storage().put({ key, bucket: 'documents', content: Buffer.alloc(bytes, 1), contentType });
    return key;
  };

  it('accepts an upload within its limits', async () => {
    const provider = await registerAndVerify(app, 'PROVIDER');
    expect((await confirm(provider, await land(provider, 200_000, 'image/jpeg'))).status).toBe(201);
  });

  it('refuses an oversize image (and removes the object), a disallowed type, and an empty file', async () => {
    const provider = await registerAndVerify(app, 'PROVIDER');

    const bigKey = await land(provider, 5_242_881, 'image/png');
    const big = await confirm(provider, bigKey);
    expect(big.status).toBe(422);
    expect(big.body.code).toBe('UPLOAD_REJECTED');
    expect(big.body.detail).toMatch(/larger than/);
    expect(await storage().head({ key: bigKey, bucket: 'documents' })).toBeNull();

    const wrongKey = await land(provider, 1_000, 'application/x-msdownload');
    const wrong = await confirm(provider, wrongKey);
    expect(wrong.status).toBe(422);
    expect(wrong.body.code).toBe('UPLOAD_REJECTED');
    expect(wrong.body.detail).toMatch(/must be one of/);

    const emptyKey = await land(provider, 0, 'image/jpeg');
    expect((await confirm(provider, emptyKey)).status).toBe(422);

    const rows = await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*)::bigint as n FROM provider_documents WHERE provider_id = ${provider.id}::uuid`);
    expect(rows[0]?.n).toBe(0n);
  });

  it('lets a video use the larger ceiling', async () => {
    const provider = await registerAndVerify(app, 'PROVIDER');
    expect((await confirm(provider, await land(provider, 6_000_000, 'video/mp4'))).status).toBe(201);
  });
});

// ------------------------------------------------------------------------ BE-026: time-off offsets

describe('BE-026: time-off accepts datetimes with an offset', () => {
  it('stores 2031-12-25T00:00:00+05:00 as the instant it is', async () => {
    const provider = await registerAndVerify(app, 'PROVIDER');
    const created = await callApi<{ start: string; end: string }>(app, '/provider/time-off', postJson({ start: '2031-12-25T00:00:00+05:00', end: '2031-12-26T00:00:00+05:00', reason: 'Holiday' }, provider.accessToken));
    expect(created.status).toBe(201);
    expect(created.body.start).toBe('2031-12-24T19:00:00.000Z');
    expect(created.body.end).toBe('2031-12-25T19:00:00.000Z');
    // The plain UTC form keeps working, and a non-date is still refused.
    expect((await callApi(app, '/provider/time-off', postJson({ start: '2031-12-27T00:00:00Z', end: '2031-12-28T00:00:00Z' }, provider.accessToken))).status).toBe(201);
    expect((await callApi(app, '/provider/time-off', postJson({ start: 'tomorrow', end: '2031-12-28T00:00:00Z' }, provider.accessToken))).status).toBe(422);
  });
});

// ------------------------------------------------------------------------ BE-022: photos on create

describe('BE-022: photos can travel with POST /bookings', () => {
  let provider: Provider;
  let slot = 6_000;

  beforeAll(async () => {
    provider = await newProvider(app);
  }, 60_000);

  const place = async (customer: TestUser, photos?: unknown[]) => {
    const address = await callApi<{ id: string }>(app, '/customer/addresses', bearer(customer.accessToken, postJson({ label: 'Home', line1: 'House 1', areaId: provider.areaId, lat: 31.52, lng: 74.35, isDefault: true })));
    slot += 24;
    const start = new Date(Date.now() + slot * 3_600_000);
    return callApi<{ id: string; code: string }>(
      app,
      '/bookings',
      bearer(customer.accessToken, postJson({ providerId: provider.id, serviceId: provider.serviceId, addressId: address.body.id, scheduledStart: start.toISOString(), scheduledEnd: new Date(start.getTime() + 3_600_000).toISOString(), paymentMode: 'CASH', ...(photos === undefined ? {} : { photos }) }))
    );
  };
  const photo = (base64 = JPEG) => ({ clientUuid: randomUUID(), contentType: 'image/jpeg', contentBase64: base64 });
  const bookingCount = async (customerId: string): Promise<bigint> => (await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*)::bigint as n FROM bookings WHERE customer_id = ${customerId}::uuid`))[0]!.n;

  it('stores the photos with the booking, past the old 1 MB body limit', async () => {
    const customer = await registerAndVerify(app, 'CUSTOMER');
    const big = Buffer.alloc(1_200_000, 3).toString('base64');
    const created = await place(customer, [photo(), photo(big)]);
    expect(created.status).toBe(201);
    const evidence = await callApi<{ items: { kind: string; contentType: string }[] }>(app, `/bookings/${created.body.id}/evidence`, bearer(customer.accessToken));
    expect(evidence.status).toBe(200);
    expect(evidence.body.items.map(item => item.kind)).toEqual(['CUSTOMER_PROBLEM', 'CUSTOMER_PROBLEM']);
  });

  it('a booking with no photos is exactly as before', async () => {
    const customer = await registerAndVerify(app, 'CUSTOMER');
    const created = await place(customer);
    expect(created.status).toBe(201);
    const evidence = await callApi<{ items: unknown[] }>(app, `/bookings/${created.body.id}/evidence`, bearer(customer.accessToken));
    expect(evidence.body.items).toHaveLength(0);
  });

  it('is atomic: a refused photo leaves no booking behind', async () => {
    const customer = await registerAndVerify(app, 'CUSTOMER');
    const tooBig = await place(customer, [photo(), photo(Buffer.alloc(5_500_000, 3).toString('base64'))]);
    expect(tooBig.status).toBe(422);
    expect(await bookingCount(customer.id)).toBe(0n);

    const tooMany = await place(customer, Array.from({ length: 6 }, () => photo()));
    expect(tooMany.status).toBe(422);
    const twins = photo();
    expect((await place(customer, [twins, twins])).status).toBe(422);
    const notAnImage = await place(customer, [{ ...photo(), contentType: 'application/pdf' }]);
    expect(notAnImage.status).toBe(422);
    expect(await bookingCount(customer.id)).toBe(0n);
  });
});

// ------------------------------------------------------------------------ BE-027: refresh grace

describe('BE-027: refresh-token reuse grace window', () => {
  const sessions = (): SessionService => app.get(SessionService);
  const reuseCode = async (token: string): Promise<string> => {
    try {
      await sessions().rotate(token, {});
      return 'ROTATED';
    } catch (error) {
      return error instanceof DomainError ? error.code : 'OTHER';
    }
  };
  const ageRotation = (token: string) =>
    prisma.$executeRaw(Prisma.sql`UPDATE sessions SET revoked_at = now() - interval '5 minutes' WHERE refresh_token_hash = ${hashRefreshToken(token)} AND replaced_by IS NOT NULL`);
  const isLive = async (token: string): Promise<boolean> =>
    (await prisma.$queryRaw<{ live: boolean }[]>(Prisma.sql`SELECT revoked_at IS NULL as live FROM sessions WHERE refresh_token_hash = ${hashRefreshToken(token)}`))[0]?.live ?? false;

  it('a token replayed just after it was rotated gets a fresh token, and nothing is signed out', async () => {
    const user = await registerAndVerify(app, 'CUSTOMER');
    const first = await sessions().start(user.id, {});
    const second = await sessions().rotate(first.refreshToken, {});
    const raced = await sessions().rotate(first.refreshToken, {}); // the second tab, a moment later
    expect(raced.userId).toBe(user.id);
    expect(raced.refreshToken).not.toBe(second.refreshToken);
    expect(raced.refreshToken).not.toBe(first.refreshToken);
    // Both successors are usable.
    expect(await reuseCode(second.refreshToken)).toBe('ROTATED');
    expect(await reuseCode(raced.refreshToken)).toBe('ROTATED');
  });

  it('two tabs refreshing at the same instant both succeed', async () => {
    const user = await registerAndVerify(app, 'CUSTOMER');
    const first = await sessions().start(user.id, {});
    const results = await Promise.all([reuseCode(first.refreshToken), reuseCode(first.refreshToken), reuseCode(first.refreshToken)]);
    expect(results).toEqual(['ROTATED', 'ROTATED', 'ROTATED']);
  });

  it('a replay after the window is still theft: the whole family is revoked', async () => {
    const user = await registerAndVerify(app, 'CUSTOMER');
    const first = await sessions().start(user.id, {});
    const second = await sessions().rotate(first.refreshToken, {});
    const raced = await sessions().rotate(first.refreshToken, {});
    await ageRotation(first.refreshToken);

    expect(await reuseCode(first.refreshToken)).toBe('REFRESH_REUSE_DETECTED');
    expect(await isLive(second.refreshToken)).toBe(false);
    expect(await isLive(raced.refreshToken)).toBe(false);
    expect(await reuseCode(second.refreshToken)).toBe('REFRESH_REUSE_DETECTED');
  });

  it('a token revoked on purpose (logout) is never given a grace replay', async () => {
    const user = await registerAndVerify(app, 'CUSTOMER');
    const first = await sessions().start(user.id, {});
    await prisma.$executeRaw(Prisma.sql`UPDATE sessions SET revoked_at = now() WHERE refresh_token_hash = ${hashRefreshToken(first.refreshToken)}`);
    expect(await reuseCode(first.refreshToken)).toBe('UNAUTHENTICATED');
  });

  it('a rotated token of a family that was then fully revoked gets no grace either', async () => {
    const user = await registerAndVerify(app, 'CUSTOMER');
    const first = await sessions().start(user.id, {});
    const second = await sessions().rotate(first.refreshToken, {});
    await sessions().revokeAllForUser(user.id);
    expect(await isLive(second.refreshToken)).toBe(false);
    expect(await reuseCode(first.refreshToken)).toBe('REFRESH_REUSE_DETECTED');
  });

  it('over HTTP: the cookie flow survives a double refresh and the response carries a new cookie', async () => {
    const user = await registerAndVerify(app, 'CUSTOMER');
    const login = await loginAs(app, user.phoneE164, PASSWORD);
    const cookie = login.setCookie.find(entry => entry.startsWith('shm_rt='))!.split(';')[0]!;
    const one = await callApi(app, '/auth/refresh', { method: 'POST', headers: { cookie } });
    const two = await callApi(app, '/auth/refresh', { method: 'POST', headers: { cookie } });
    expect(one.status).toBe(201);
    expect(two.status).toBe(201);
    expect(two.setCookie.some(entry => entry.startsWith('shm_rt='))).toBe(true);
  });
});

// ------------------------------------------------------------------------ BE-017: concurrency

describe('BE-017: modest parallel load never answers 500', () => {
  it('8 parallel logins + 8 catalogue reads + 8 service reads, three rounds, all succeed', async () => {
    const users: TestUser[] = [];
    for (let index = 0; index < 8; index += 1) users.push(await registerAndVerify(app, 'CUSTOMER'));

    const statuses: number[] = [];
    for (let round = 0; round < 3; round += 1) {
      const batch = await Promise.all([
        ...users.map(user => loginAs(app, user.phoneE164, PASSWORD)),
        ...Array.from({ length: 8 }, () => callApi(app, '/catalogue/categories')),
        ...Array.from({ length: 8 }, () => callApi(app, '/catalogue/services/leak-repair'))
      ]);
      statuses.push(...batch.map(response => response.status));
    }
    expect(statuses).toHaveLength(72);
    expect(statuses.filter(status => status >= 500)).toEqual([]);
    expect(statuses.filter(status => status !== 200 && status !== 201)).toEqual([]);
  }, 120_000);

  it('a burst of simultaneous token refreshes from one session never errors', async () => {
    const user = await registerAndVerify(app, 'CUSTOMER');
    const login = await loginAs(app, user.phoneE164, PASSWORD);
    const cookie = login.setCookie.find(entry => entry.startsWith('shm_rt='))!.split(';')[0]!;
    const burst = await Promise.all(Array.from({ length: 8 }, () => callApi(app, '/auth/refresh', { method: 'POST', headers: { cookie } })));
    expect(burst.map(response => response.status).filter(status => status >= 500)).toEqual([]);
    expect(burst.every(response => response.status === 201)).toBe(true);
  });
});

// ------------------------------------------------------------------------ BE-028: centroids

describe('BE-028: seeded Lahore areas sit where the real areas are', () => {
  const kmBetween = (a: { lat: number; lng: number }, b: { lat: number; lng: number }): number => {
    const toRad = (value: number): number => (value * Math.PI) / 180;
    const h = Math.sin(toRad(b.lat - a.lat) / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(toRad(b.lng - a.lng) / 2) ** 2;
    return 6371 * 2 * Math.asin(Math.sqrt(h));
  };

  it('Gulberg is within 2 km of 31.52, 74.35 (it used to be ~25 km away) and every area is inside Lahore', async () => {
    const cities = await callApi<{ items: { id: number; name: string }[] }>(app, '/places/cities');
    const lahore = cities.body.items.find(item => item.name === 'Lahore')!;
    const areas = await callApi<{ items: { name: string; lat: number | null; lng: number | null }[] }>(app, `/places/cities/${lahore.id}/areas`);
    const gulberg = areas.body.items.find(item => item.name === 'Gulberg')!;
    expect(kmBetween({ lat: gulberg.lat!, lng: gulberg.lng! }, { lat: 31.52, lng: 74.35 })).toBeLessThan(2);
    for (const area of areas.body.items) {
      if (area.lat === null || area.lng === null) continue;
      if (area.name.startsWith('Area ')) continue; // areas other suites create
      expect(kmBetween({ lat: area.lat, lng: area.lng }, { lat: 31.52, lng: 74.35 }), area.name).toBeLessThan(40);
    }
  });
});
