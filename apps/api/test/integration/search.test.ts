import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { adminSession, callApi, createTestApp, patchJson, postJson, putJson, registerAndVerify, verifyCnicFor, type TestUser } from './harness.js';
import { prisma, travelToLocal, unfreeze } from './flow.js';
import { SettingsService } from '../../src/platform/settings.service.js';

let app: NestExpressApplication;
let close: () => Promise<void>;
let admin: { accessToken: string; userId: string };
let leakRepair: { id: number; minPricePaisa: number };
let gulbergAreaId: number;

const BASE_LAT = 31.5204;
const BASE_LNG = 74.3587;
const FAR_LAT = 32.0836; // Faisalabad-ish, well outside a small radius
const FAR_LNG = 72.6711;

beforeAll(async () => {
  const started = await createTestApp();
  app = started.app;
  close = started.close;
  admin = await adminSession(app);
  leakRepair = (await callApi<{ id: number; minPricePaisa: number }>(app, '/catalogue/services/leak-repair')).body;
  const cities = await callApi<{ items: { id: number; name: string }[] }>(app, '/places/cities');
  const lahore = cities.body.items.find(item => item.name === 'Lahore')!;
  const areas = await callApi<{ items: { id: number; name: string }[] }>(app, `/places/cities/${lahore.id}/areas`);
  gulbergAreaId = areas.body.items.find(item => item.name === 'Gulberg')!.id;
});

afterAll(async () => {
  await close();
});

const asAdmin = (init: RequestInit = {}): RequestInit => ({ ...init, headers: { ...init.headers, authorization: `Bearer ${admin.accessToken}` } });
const asProvider = (accessToken: string, init: RequestInit = {}): RequestInit => ({ ...init, headers: { ...init.headers, authorization: `Bearer ${accessToken}` } });

/** A provider fully set up and approved to offer leak-repair, centred on BASE_LAT/BASE_LNG with a small radius. */
const readyProvider = async (radiusM = 5000): Promise<TestUser> => {
  const provider = await registerAndVerify(app, 'PROVIDER');
  await callApi(app, '/provider/profile', asProvider(provider.accessToken, patchJson({ bio: 'Search test provider', cityId: 1, baseAddressText: 'Gulberg', lat: BASE_LAT, lng: BASE_LNG, radiusM })));
  await callApi(app, '/provider/service-areas', asProvider(provider.accessToken, putJson({ areaIds: [gulbergAreaId] })));
  await callApi(app, `/provider/services/${leakRepair.id}`, putJson({ pricePaisa: leakRepair.minPricePaisa }, provider.accessToken));
  await callApi(app, `/admin/provider-services/${provider.id}/${leakRepair.id}/approve`, asAdmin({ method: 'POST' }));
  await verifyCnicFor(app, provider);
  await callApi(app, `/admin/providers/${provider.id}/approve`, asAdmin({ method: 'POST' }));
  return provider;
};

describe('FR-SR-03/04/06: provider search', () => {
  it('finds a ready, in-range provider and reports a small distance', async () => {
    const provider = await readyProvider();
    const response = await callApi<{ items: { providerId: string; distanceM: number; pricePaisa: number }[] }>(app, `/search/providers?serviceSlug=leak-repair&lat=${BASE_LAT}&lng=${BASE_LNG}`);
    expect(response.status).toBe(200);
    const match = response.body.items.find(item => item.providerId === provider.id);
    expect(match).toBeDefined();
    expect(match!.distanceM).toBeLessThan(100);
    expect(match!.pricePaisa).toBe(leakRepair.minPricePaisa);
  });

  it('excludes a provider whose search point falls outside their radius', async () => {
    const provider = await readyProvider(1000);
    const response = await callApi<{ items: { providerId: string }[] }>(app, `/search/providers?serviceSlug=leak-repair&lat=${FAR_LAT}&lng=${FAR_LNG}`);
    expect(response.body.items.map(item => item.providerId)).not.toContain(provider.id);
  });

  it('excludes a provider whose account is not yet approved', async () => {
    const provider = await registerAndVerify(app, 'PROVIDER');
    await callApi(app, '/provider/profile', asProvider(provider.accessToken, patchJson({ lat: BASE_LAT, lng: BASE_LNG, radiusM: 5000 })));
    await callApi(app, `/provider/services/${leakRepair.id}`, putJson({ pricePaisa: leakRepair.minPricePaisa }, provider.accessToken));
    await callApi(app, `/admin/provider-services/${provider.id}/${leakRepair.id}/approve`, asAdmin({ method: 'POST' }));
    // provider account itself is never approved

    const response = await callApi<{ items: { providerId: string }[] }>(app, `/search/providers?serviceSlug=leak-repair&lat=${BASE_LAT}&lng=${BASE_LNG}`);
    expect(response.body.items.map(item => item.providerId)).not.toContain(provider.id);
  });

  it('excludes a provider whose offer to provide the service is still pending', async () => {
    const provider = await registerAndVerify(app, 'PROVIDER');
    await callApi(app, '/provider/profile', asProvider(provider.accessToken, patchJson({ lat: BASE_LAT, lng: BASE_LNG, radiusM: 5000 })));
    await callApi(app, `/provider/services/${leakRepair.id}`, putJson({ pricePaisa: leakRepair.minPricePaisa }, provider.accessToken));
    await callApi(app, `/admin/providers/${provider.id}/approve`, asAdmin({ method: 'POST' }));
    // the provider_services binding is never approved

    const response = await callApi<{ items: { providerId: string }[] }>(app, `/search/providers?serviceSlug=leak-repair&lat=${BASE_LAT}&lng=${BASE_LNG}`);
    expect(response.body.items.map(item => item.providerId)).not.toContain(provider.id);
  });

  it('rejects an unknown service slug with NOT_FOUND', async () => {
    const response = await callApi<{ code: string }>(app, `/search/providers?serviceSlug=does-not-exist&lat=${BASE_LAT}&lng=${BASE_LNG}`);
    expect(response.status).toBe(404);
    expect(response.body.code).toBe('NOT_FOUND');
  });

  it('drops a service from search once an admin deactivates it', async () => {
    const category = await callApi<{ id: number }>(app, '/admin/catalogue/categories', asAdmin(postJson({ slug: `srch-cat-${randomUUID().slice(0, 8)}`, nameEn: 'Search Category', nameUr: 'ٹیسٹ', defaultWarrantyDays: 0 })));
    const slug = `srch-svc-${randomUUID().slice(0, 8)}`;
    const service = await callApi<{ id: number }>(app, '/admin/catalogue/services', asAdmin(postJson({
      categoryId: category.body.id, slug, nameEn: 'Search Service', nameUr: 'ٹیسٹ', description: 'A service for the search test.',
      pricingModel: 'FLAT' as const, basePricePaisa: 10_000, minPricePaisa: 5_000, maxPricePaisa: 20_000, expectedDurationMin: 30
    })));
    expect((await callApi(app, `/search/providers?serviceSlug=${slug}&lat=${BASE_LAT}&lng=${BASE_LNG}`)).status).toBe(200);

    await callApi(app, `/admin/catalogue/services/${service.body.id}`, asAdmin(patchJson({ isActive: false })));
    expect((await callApi(app, `/search/providers?serviceSlug=${slug}&lat=${BASE_LAT}&lng=${BASE_LNG}`)).status).toBe(404);
  });
});

describe('SHM-108: search filters and addressId', () => {
  const around = async (extra: string): Promise<string[]> =>
    (await callApi<{ items: { providerId: string }[] }>(app, `/search/providers?serviceSlug=leak-repair&lat=${BASE_LAT}&lng=${BASE_LNG}&${extra}`)).body.items.map(item => item.providerId);

  it('filters by minimum experience', async () => {
    const rookie = await readyProvider();
    const veteran = await readyProvider();
    await callApi(app, '/provider/profile', asProvider(rookie.accessToken, patchJson({ experienceYears: 1 })));
    await callApi(app, '/provider/profile', asProvider(veteran.accessToken, patchJson({ experienceYears: 12 })));

    expect(await around('minExperienceYears=10')).toContain(veteran.id);
    expect(await around('minExperienceYears=10')).not.toContain(rookie.id);
    // Both still show with no filter, so the filter is doing the work rather than the setup.
    const all = await around('');
    expect(all).toContain(rookie.id);
    expect(all).toContain(veteran.id);
  });

  it('filters by minimum completed jobs', async () => {
    const provider = await readyProvider();
    expect(await around('minCompletedJobs=1')).not.toContain(provider.id);
    // Give them one finished job behind the search's back: the filter reads bookings, not a counter.
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO bookings(customer_id, provider_id, service_id, address_id, status, payment_mode, payment_status, slot, scheduled_start, scheduled_end, completed_at, start_otp_verified_at, quoted_amount_paisa, approved_total_paisa, commission_rate_bp)
      VALUES ((SELECT id FROM users WHERE email = 'customer@smart-home.local'::citext), ${provider.id}::uuid, ${leakRepair.id}, (SELECT id FROM addresses LIMIT 1), 'CLOSED'::booking_status, 'CASH'::payment_mode, 'CASH_SETTLED'::booking_payment_status,
        tstzrange(now() - interval '2 days', now() - interval '2 days' + interval '1 hour', '[)'), now() - interval '2 days', now() - interval '2 days' + interval '1 hour', now() - interval '2 days', now() - interval '2 days', 1000, 1000, 1500)`);
    expect(await around('minCompletedJobs=1')).toContain(provider.id);
  });

  it('filters by price range for this service', async () => {
    const cheap = await readyProvider();
    const pricey = await readyProvider();
    await callApi(app, `/provider/services/${leakRepair.id}`, putJson({ pricePaisa: leakRepair.minPricePaisa }, cheap.accessToken));
    await callApi(app, `/provider/services/${leakRepair.id}`, putJson({ pricePaisa: leakRepair.minPricePaisa + 5_000 }, pricey.accessToken));
    await callApi(app, `/admin/provider-services/${cheap.id}/${leakRepair.id}/approve`, asAdmin({ method: 'POST' }));
    await callApi(app, `/admin/provider-services/${pricey.id}/${leakRepair.id}/approve`, asAdmin({ method: 'POST' }));

    const cheapest = leakRepair.minPricePaisa;
    expect(await around(`maxPricePaisa=${cheapest}`)).toContain(cheap.id);
    expect(await around(`maxPricePaisa=${cheapest}`)).not.toContain(pricey.id);
    expect(await around(`minPricePaisa=${leakRepair.minPricePaisa + 5_000}`)).toContain(pricey.id);
    expect(await around(`minPricePaisa=${leakRepair.minPricePaisa + 5_000}`)).not.toContain(cheap.id);
  });

  it('rejects a price range that cannot match anything, rather than quietly returning everything', async () => {
    const response = await callApi<{ code: string }>(app, `/search/providers?serviceSlug=leak-repair&lat=${BASE_LAT}&lng=${BASE_LNG}&minPricePaisa=900000&maxPricePaisa=1000`);
    expect(response.status).toBe(422);
    expect(response.body.code).toBe('VALIDATION_FAILED');
  });

  it('filters to providers with a verified document', async () => {
    // Every `readyProvider` has a verified CNIC, so this proves the filter keeps them...
    const provider = await readyProvider();
    expect(await around('verifiedDocsOnly=true')).toContain(provider.id);
    // ...and that it is not vacuous: take the document away and they disappear.
    await prisma.$executeRaw(Prisma.sql`UPDATE provider_documents SET status = 'PENDING'::review_status WHERE provider_id = ${provider.id}::uuid`);
    expect(await around('verifiedDocsOnly=true')).not.toContain(provider.id);
    expect(await around('')).toContain(provider.id);
  });

  it('filters to providers free later today', async () => {
    // Declared hours are a wall-clock range inside one local day, so "available today" has to be
    // checked against them — a provider whose day ended cannot be offered at 23:00, and one who
    // never declared hours at all cannot be offered anything. That makes this assertion a statement
    // about the time of day, so the test says which time it means rather than passing at 11:00 and
    // failing at 02:00, and it gives the provider hours to be available *in* — a provider with no
    // availability rows is genuinely not free today.
    const provider = await readyProvider();
    const days = [0, 1, 2, 3, 4, 5, 6].map(weekday => ({ weekday, startTime: '09:00', endTime: '18:00' }));
    await callApi(app, '/provider/availability', asProvider(provider.accessToken, putJson({ items: days })));
    travelToLocal(app, 10);
    try {
      expect(await around('availableToday=true')).toContain(provider.id);
      // ...and once their day is over they drop out, while an unfiltered search still has them.
      travelToLocal(app, 23);
      expect(await around('availableToday=true')).not.toContain(provider.id);
      expect(await around('')).toContain(provider.id);
    } finally {
      unfreeze(app);
    }
  });

  it('takes an addressId instead of coordinates, and refuses a half-given point', async () => {
    const provider = await readyProvider();
    const customer = await registerAndVerify(app, 'CUSTOMER');
    const address = await callApi<{ id: string }>(app, '/customer/addresses', asProvider(customer.accessToken, postJson({ label: 'Home', line1: 'House 1', areaId: gulbergAreaId, lat: BASE_LAT, lng: BASE_LNG, isDefault: true })));
    expect(address.status).toBe(201);

    const byAddress = await callApi<{ items: { providerId: string }[] }>(app, `/search/providers?serviceSlug=leak-repair&addressId=${address.body.id}`, asProvider(customer.accessToken));
    expect(byAddress.status).toBe(200);
    expect(byAddress.body.items.map(item => item.providerId)).toContain(provider.id);

    // BE-004: only the signed-in owner can search around a saved address. Anonymous callers, another customer and a provider all get
    // the same 404 as an address that does not exist, so an address id cannot be used to triangulate where somebody lives.
    const byAddressUrl = `/search/providers?serviceSlug=leak-repair&addressId=${address.body.id}`;
    const stranger = await registerAndVerify(app, 'CUSTOMER');
    expect((await callApi(app, byAddressUrl)).status).toBe(404);
    expect((await callApi(app, byAddressUrl, asProvider(stranger.accessToken))).status).toBe(404);
    expect((await callApi(app, byAddressUrl, asProvider(provider.accessToken))).status).toBe(404);
    expect((await callApi(app, byAddressUrl, asProvider('not-a-token'))).status).toBe(404);

    // An address nobody owns, or that does not exist, is a 404 rather than an empty result.
    expect((await callApi(app, `/search/providers?serviceSlug=leak-repair&addressId=${randomUUID()}`)).status).toBe(404);

    // A point with only half of itself is a validation error, not a search of (0, 0).
    const half = await callApi<{ code: string }>(app, `/search/providers?serviceSlug=leak-repair&lat=${BASE_LAT}`);
    expect(half.status).toBe(422);
    expect(half.body.code).toBe('VALIDATION_FAILED');

    // And neither form at all.
    expect((await callApi(app, `/search/providers?serviceSlug=leak-repair`)).status).toBe(422);
  });
});

describe('SHM-109: every configured ranking weight is actually applied', () => {
  const weightKeys = async (): Promise<string[]> => Object.keys((await app.get(SettingsService).get<Record<string, number>>('ranking.weights')) ?? {});

  it('the code applies every key the setting carries', async () => {
    // The guard this ticket exists for. `ranking.weights` advertised five signals for weeks while the
    // code ranked on two, and an operator tuning completion/response/recency saw nothing happen —
    // silently, because nothing failed. This reads the keys straight out of the setting and checks
    // the ranking knows each one, so a new key cannot be added without ranking on it.
    const { RANKING_SIGNAL_KEYS } = await import('../../src/search/search.service.js');
    const applied = new Set<string>(RANKING_SIGNAL_KEYS);
    const keys = await weightKeys();
    expect(keys.filter(key => !applied.has(key)).join(',') || 'none', 'ranking.weights carries a key the code ignores').toBe('none');
  });

  it('publishes each signal and names the ones a provider has no data for', async () => {
    const provider = await readyProvider();
    const response = await callApi<{ items: { providerId: string; signals: Record<string, number | null>; missingSignals: string[] }[] }>(
      app,
      `/search/providers?serviceSlug=leak-repair&lat=${BASE_LAT}&lng=${BASE_LNG}`
    );
    const match = response.body.items.find(item => item.providerId === provider.id)!;
    // A brand-new provider has no history, so the three history signals must be *absent*, not zero —
    // and the reason must be visible to whoever is looking at the list.
    expect(Object.keys(match.signals).sort()).toEqual(['completion', 'distance', 'rating', 'recency', 'response']);
    expect(match.signals.completion).toBeNull();
    expect(match.signals.response).toBeNull();
    expect(match.signals.recency).toBeNull();
    expect(match.missingSignals.sort()).toEqual(['completion', 'recency', 'response']);
  });

  it('a provider with history fills those signals in', async () => {
    const provider = await readyProvider();
    const other = await readyProvider();
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO bookings(customer_id, provider_id, service_id, address_id, status, payment_mode, payment_status, slot, scheduled_start, scheduled_end, completed_at, start_otp_verified_at, quoted_amount_paisa, approved_total_paisa, commission_rate_bp, created_at)
      VALUES ((SELECT id FROM users WHERE email = 'customer@smart-home.local'::citext), ${provider.id}::uuid, ${leakRepair.id}, (SELECT id FROM addresses LIMIT 1), 'CLOSED'::booking_status, 'CASH'::payment_mode, 'CASH_SETTLED'::booking_payment_status,
        tstzrange(now() - interval '2 days', now() - interval '2 days' + interval '1 hour', '[)'), now() - interval '2 days', now() - interval '2 days' + interval '1 hour', now() - interval '1 day', now() - interval '2 days', 1000, 1000, 1500, now() - interval '2 days')`);
    const offered = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM booking_offers WHERE provider_id = ${provider.id}::uuid LIMIT 1`);

    const response = await callApi<{ items: { providerId: string; signals: Record<string, number | null>; missingSignals: string[] }[] }>(
      app,
      `/search/providers?serviceSlug=leak-repair&lat=${BASE_LAT}&lng=${BASE_LNG}`
    );
    const match = response.body.items.find(item => item.providerId === provider.id)!;
    // One job finished yesterday: completion is 1 (no no-shows) and recency is high.
    expect(match.signals.completion).toBe(1);
    expect(match.signals.recency).toBeGreaterThan(0.9);
    expect(match.missingSignals).not.toContain('completion');
    expect(match.missingSignals).not.toContain('recency');
    // Response speed needs an answered offer; nobody ever answered this provider's, so it stays absent.
    expect(match.signals.response).toBeNull();
    void offered;
    void other;
  });
});

describe('FR-SR-02: provider detail', () => {
  it("returns an approved provider's full detail with services and areas", async () => {
    const provider = await readyProvider();
    const response = await callApi<{ providerId: string; bio: string; services: { slug: string }[]; areas: { areaId: number }[] }>(app, `/search/providers/${provider.id}`);
    expect(response.status).toBe(200);
    expect(response.body.bio).toBe('Search test provider');
    expect(response.body.services.map(item => item.slug)).toContain('leak-repair');
    expect(response.body.areas.map(item => item.areaId)).toContain(gulbergAreaId);
  });

  it('hides an unapproved provider behind NOT_FOUND', async () => {
    const provider = await registerAndVerify(app, 'PROVIDER');
    const response = await callApi<{ code: string }>(app, `/search/providers/${provider.id}`);
    expect(response.status).toBe(404);
    expect(response.body.code).toBe('NOT_FOUND');
  });

  it('answers a malformed provider id with 404, the same as one that does not exist (BE-032)', async () => {
    for (const path of ['', '/slots?serviceId=1&date=2030-01-01', '/next-slots?serviceId=1']) {
      const response = await callApi<{ code: string }>(app, `/search/providers/not-a-uuid${path}`);
      expect(response.status, path).toBe(404);
      expect(response.body.code).toBe('NOT_FOUND');
    }
  });
});
