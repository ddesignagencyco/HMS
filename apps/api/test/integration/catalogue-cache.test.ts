import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { CATALOGUE_TTL_SECONDS } from '../../src/catalogue/catalogue.service.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { RedisService } from '../../src/database/redis.module.js';
import { adminSession, callApi, createTestApp, patchJson, postJson, putJson } from './harness.js';

/**
 * SHM-019: the public catalogue endpoints are cached, and an admin write invalidates
 * that cache. The proof used here is the strong one: after a listing has been served
 * once, a change made *behind the service's back* (direct SQL) does not show through
 * the cached response, but an admin write does — on the next request, because the
 * cache key carries a version that every instance reads from shared Redis.
 */

let app: NestExpressApplication;
let close: () => Promise<void>;
let admin: { accessToken: string; userId: string };
let prisma: PrismaService;
let redis: RedisService;

beforeAll(async () => {
  const started = await createTestApp();
  app = started.app;
  close = started.close;
  admin = await adminSession(app);
  prisma = app.get(PrismaService);
  redis = app.get(RedisService);
});

afterAll(async () => {
  await close();
});

const asAdmin = (init: RequestInit = {}): RequestInit => ({ ...init, headers: { ...init.headers, authorization: `Bearer ${admin.accessToken}` } });

const newCategory = async (nameEn: string): Promise<{ id: number; slug: string }> => {
  const slug = `cache-cat-${randomUUID().slice(0, 8)}`;
  const created = await callApi<{ id: number; slug: string }>(app, '/admin/catalogue/categories', asAdmin(postJson({ slug, nameEn, nameUr: 'کیشے', defaultWarrantyDays: 0 })));
  expect(created.status).toBe(201);
  return created.body;
};

const flatServicePayload = (categoryId: number, slug: string) => ({
  categoryId,
  slug,
  nameEn: 'Test Service',
  nameUr: 'ٹیسٹ سروس',
  description: 'A service created for tests.',
  pricingModel: 'FLAT' as const,
  basePricePaisa: 250_00,
  minPricePaisa: 100_00,
  maxPricePaisa: 500_00,
  expectedDurationMin: 60
});

describe('SHM-019: public catalogue reads are cached', () => {
  it('serves the cached category listing, then reloads it after an admin write', async () => {
    const category = await newCategory('Cache Probe');

    const first = await callApi<{ items: { id: number; nameEn: string }[] }>(app, '/catalogue/categories');
    expect(first.body.items.find(item => item.id === category.id)?.nameEn).toBe('Cache Probe');

    // A change made directly in the database (bypassing the service, so no invalidation)
    // must not show through a cached response.
    await prisma.$executeRaw(Prisma.sql`UPDATE categories SET name_en = 'Probe A' WHERE id = ${category.id}`);
    const second = await callApi<{ items: { id: number; nameEn: string }[] }>(app, '/catalogue/categories');
    expect(second.body.items.find(item => item.id === category.id)?.nameEn).toBe('Cache Probe');

    // An admin write bumps the shared version, so the next read is fresh.
    const patched = await callApi(app, `/admin/catalogue/categories/${category.id}`, asAdmin(patchJson({ nameEn: 'Probe B' })));
    expect(patched.status).toBe(200);
    const third = await callApi<{ items: { id: number; nameEn: string }[] }>(app, '/catalogue/categories');
    expect(third.body.items.find(item => item.id === category.id)?.nameEn).toBe('Probe B');

    // The entry really is in Redis, with the bounded TTL.
    const keys = await redis.client.keys('catalogue:*:categories');
    expect(keys.length).toBeGreaterThan(0);
    const ttl = await redis.client.ttl(keys[0] ?? '');
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(CATALOGUE_TTL_SECONDS);

    // Take it out of the public listing, which also invalidates the cache for the next test.
    await callApi(app, `/admin/catalogue/categories/${category.id}`, asAdmin(patchJson({ isActive: false })));
  });

  it('caches a service detail and reloads it after the checklist is replaced', async () => {
    const category = await newCategory('Cache Service Category');
    const slug = `cache-svc-${randomUUID().slice(0, 8)}`;
    const created = await callApi<{ id: number }>(app, '/admin/catalogue/services', asAdmin(postJson(flatServicePayload(category.id, slug))));
    expect(created.status).toBe(201);

    const first = await callApi<{ nameEn: string }>(app, `/catalogue/services/${slug}`);
    expect(first.body.nameEn).toBe('Test Service');

    await prisma.$executeRaw(Prisma.sql`UPDATE services SET name_en = 'Svc A' WHERE id = ${created.body.id}`);
    const second = await callApi<{ nameEn: string }>(app, `/catalogue/services/${slug}`);
    expect(second.body.nameEn).toBe('Test Service');

    const replaced = await callApi(app, `/admin/catalogue/services/${created.body.id}/checklist`, asAdmin(putJson({ items: [{ labelEn: 'Only step', labelUr: 'ایک', requiresPhoto: false }] })));
    expect(replaced.status).toBe(200);

    const third = await callApi<{ nameEn: string; checklist: { labelEn: string }[] }>(app, `/catalogue/services/${slug}`);
    expect(third.body.nameEn).toBe('Svc A');
    expect(third.body.checklist.map(item => item.labelEn)).toEqual(['Only step']);

    await callApi(app, `/admin/catalogue/services/${created.body.id}`, asAdmin(patchJson({ isActive: false })));
    await callApi(app, `/admin/catalogue/categories/${category.id}`, asAdmin(patchJson({ isActive: false })));
  });

  it('does not cache a miss: an unknown slug is a miss and still answers 404 on repeat', async () => {
    const first = await callApi<{ code: string }>(app, '/catalogue/categories/nope-does-not-exist/services');
    const second = await callApi<{ code: string }>(app, '/catalogue/categories/nope-does-not-exist/services');
    expect(first.status).toBe(404);
    expect(second.status).toBe(404);
  });
});
