import { Prisma } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { EnvironmentService } from '../../src/config/environment.service.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { RedisService } from '../../src/database/redis.module.js';
import { SETTINGS_TTL_SECONDS, SettingsService } from '../../src/platform/settings.service.js';
import { createTestApp } from './harness.js';

/**
 * SHM-008: a setting change must invalidate the cache on every API instance, not
 * just the one that served the write. This boots the real app (instance A) and a
 * second SettingsService on its own Redis connections (instance B, a stand-in for
 * another API replica), then proves that a write on A is seen by B — both because
 * the shared cache entry is gone and because B's subscriber received the
 * invalidation message, which is the counter that increments only on delivery.
 */

const KEY = 'booking.min_notice_min';
const ORIGINAL = 30;
const UPDATED = 31;
const CACHE_KEY = `settings:${KEY}`;

let app: NestExpressApplication;
let close: () => Promise<void>;
let instanceA: SettingsService;
let instanceB: SettingsService;
let bRedis: RedisService;
let redis: RedisService;
let prisma: PrismaService;
let adminId: string;

beforeAll(async () => {
  ({ app, close } = await createTestApp());
  prisma = app.get(PrismaService);
  redis = app.get(RedisService);
  instanceA = app.get(SettingsService);
  bRedis = new RedisService(app.get(EnvironmentService));
  instanceB = new SettingsService(prisma, bRedis);
  await instanceB.start();
  const admins = await prisma.$queryRaw<{ id: string }[]>(
    Prisma.sql`SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id WHERE ur.role_code = 'ADMIN' LIMIT 1`
  );
  const admin = admins[0];
  if (admin === undefined) throw new Error('No ADMIN user to attribute the settings write to');
  adminId = admin.id;
});

afterAll(async () => {
  await instanceB.stop();
  await bRedis.onModuleDestroy();
  await close();
});

/** Put the row back to its seeded value and forget any cache, so each case starts clean. */
const restore = async (): Promise<void> => {
  // `audit_log` is insert-only by trigger, so the `settings.update` rows the write
  // cases leave behind are not cleaned up — they are the audit trail, and leaving
  // them is the point. Only the setting and its cache entry are reset.
  await prisma.$executeRaw(Prisma.sql`UPDATE settings SET value = ${JSON.stringify(ORIGINAL)}::jsonb WHERE key = ${KEY}`);
  await redis.client.del(CACHE_KEY);
};

describe('SHM-008: a setting write invalidates the cache on every API instance', () => {
  it('a write on one instance is seen by another, and its subscriber is told', async () => {
    await restore();

    // Prime the shared cache from both instances, exactly as two replicas would
    // when each reads the setting during startup or a request.
    expect(await instanceA.get<number>(KEY)).toBe(ORIGINAL);
    expect(await instanceB.get<number>(KEY)).toBe(ORIGINAL);

    const invalidationsBefore = instanceB.cacheStats().invalidations;

    await instanceA.set(KEY, UPDATED, adminId);

    // B re-reads: the cached value is gone, so it must come back from the row A wrote.
    expect(await instanceB.get<number>(KEY)).toBe(UPDATED);
    // And B's own subscriber received the invalidation message A published.
    expect(instanceB.cacheStats().invalidations).toBeGreaterThan(invalidationsBefore);

    // The row itself is the source of truth for a cold instance.
    const published = await prisma.$queryRaw<{ value: number }[]>(Prisma.sql`SELECT value FROM settings WHERE key = ${KEY}`);
    expect(published[0]?.value).toBe(UPDATED);
  });

  it('a cached value cannot outlive the TTL when the write bypassed the service', async () => {
    await restore();
    expect(await instanceA.get<number>(KEY)).toBe(ORIGINAL);
    const ttl = await redis.client.ttl(CACHE_KEY);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(SETTINGS_TTL_SECONDS);
  });
});
