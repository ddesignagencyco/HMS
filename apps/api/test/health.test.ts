import type { Response } from 'express';
import { describe, expect, it } from 'vitest';
import { HealthController } from '../src/health/health.controller.js';
import type { EnvironmentService } from '../src/config/environment.service.js';
import type { PrismaService } from '../src/database/prisma.service.js';
import type { RedisService } from '../src/database/redis.module.js';
import type { ObjectStoragePort } from '../src/integrations/ports.js';
import type { SettingsService } from '../src/platform/settings.service.js';
import type { QueueRegistry } from '../src/queues/queue.registry.js';

const recorder = (): { response: Response; statusCode: number } => {
  let statusCode = 200;
  const response = { status(code: number) { statusCode = code; return response; } } as unknown as Response;
  return { response, get statusCode() { return statusCode; } };
};

const makeController = (overrides: { databaseDown?: boolean; redisDown?: boolean; storageDown?: boolean } = {}): HealthController => {
  const prisma = { ping: async () => !overrides.databaseDown } as unknown as PrismaService;
  const redis = { ping: async () => !overrides.redisDown } as unknown as RedisService;
  const queues = { depths: async () => ({ outbox: 0, notifications: 0, payments: 0, verification: 0, projections: 0 }) } as unknown as QueueRegistry;
  const settings = { get: async () => 60 } as unknown as SettingsService;
  const environment = { storageBuckets: ['evidence'] } as unknown as EnvironmentService;
  const storage = {
    head: async () => {
      if (overrides.storageDown) throw new Error('bucket unreachable');
      return null;
    }
  } as unknown as ObjectStoragePort;
  return new HealthController(prisma, redis, queues, settings, environment, storage);
};

describe('GET /health/ready answers with a status code, not only a body', () => {
  it('answers 200 and status ok when every dependency responds', async () => {
    const recorderInstance = recorder();
    const report = await makeController().ready(recorderInstance.response);
    expect(recorderInstance.statusCode).toBe(200);
    expect(report.status).toBe('ok');
  });

  it('answers 503 when the database is unreachable, so the load balancer drains the instance', async () => {
    const recorderInstance = recorder();
    const report = await makeController({ databaseDown: true }).ready(recorderInstance.response);
    expect(recorderInstance.statusCode).toBe(503);
    expect(report.status).toBe('down');
    expect(report.checks.find(check => check.name === 'database')?.status).toBe('down');
  });

  it('answers 503 when redis is unreachable', async () => {
    const recorderInstance = recorder();
    const report = await makeController({ redisDown: true }).ready(recorderInstance.response);
    expect(recorderInstance.statusCode).toBe(503);
    expect(report.checks.find(check => check.name === 'redis')?.status).toBe('down');
  });

  it('answers 503 when object storage is unreachable', async () => {
    const recorderInstance = recorder();
    const report = await makeController({ storageDown: true }).ready(recorderInstance.response);
    expect(recorderInstance.statusCode).toBe(503);
    expect(report.checks.find(check => check.name === 'storage')?.status).toBe('down');
  });
});
