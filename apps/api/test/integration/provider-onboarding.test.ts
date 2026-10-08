import { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { callApi, createTestApp, patchJson, postJson, putJson, registerAndVerify, adminSession, verifyCnicFor, type TestUser } from './harness.js';

/**
 * SHM-021 submit-for-approval: a provider cannot reach PENDING_APPROVAL until every
 * onboarding step is on file, and the transition is recorded (audit + an outbox event
 * so admins are told there is something to review).
 */

const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let counter = 0;
const uniqueCnic = (): string => {
  counter += 1;
  const middle = `${counter}${Math.floor(Math.random() * 900_000)}`.padStart(7, '0').slice(0, 7);
  return `35202-${middle}-${(counter % 9) + 1}`;
};

let app: NestExpressApplication;
let close: () => Promise<void>;
let prisma: PrismaClient;
let lahoreId: number;
let areaId: number;
let serviceId: number;
let minPricePaisa: number;

beforeAll(async () => {
  ({ app, close } = await createTestApp());
  prisma = new PrismaClient();
  const cities = await callApi<{ items: { id: number; name: string }[] }>(app, '/places/cities');
  lahoreId = cities.body.items.find(item => item.name === 'Lahore')!.id;
  const areas = await callApi<{ items: { id: number; name: string }[] }>(app, `/places/cities/${lahoreId}/areas`);
  areaId = areas.body.items.find(item => item.name === 'Gulberg')!.id;
  const service = await callApi<{ id: number; minPricePaisa: number }>(app, '/catalogue/services/leak-repair');
  serviceId = service.body.id;
  minPricePaisa = service.body.minPricePaisa;
});

afterAll(async () => {
  await prisma.$disconnect();
  await close();
});

const asProvider = (provider: TestUser, init: RequestInit = {}): RequestInit => ({ ...init, headers: { ...init.headers, authorization: `Bearer ${provider.accessToken}` } });

const completeOnboarding = async (provider: TestUser): Promise<void> => {
  await callApi(app, '/provider/profile', asProvider(provider, patchJson({ cityId: lahoreId, lat: 31.5204, lng: 74.3587, radiusM: 10_000 })));
  await callApi(app, `/provider/services/${serviceId}`, putJson({ pricePaisa: minPricePaisa }, provider.accessToken));
  await callApi(app, '/provider/service-areas', asProvider(provider, putJson({ areaIds: [areaId] })));
  await callApi(app, '/provider/availability', asProvider(provider, putJson({ items: [{ weekday: 1, startTime: '09:00', endTime: '17:00' }] })));
  await callApi(app, '/provider/documents', postJson({ docType: 'CNIC_FRONT', contentType: 'image/png', contentBase64: PNG_BASE64, cnicNumber: uniqueCnic() }, provider.accessToken));
};

describe('SHM-021: provider submit for approval', () => {
  it('refuses a submit and names every missing step on an empty profile', async () => {
    const provider = await registerAndVerify(app, 'PROVIDER');
    const response = await callApi<{ code: string; errors: { path: string }[] }>(app, '/provider/submit', asProvider(provider, postJson({ acceptPenaltySchedule: true })));

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('BAD_REQUEST');
    const paths = response.body.errors.map(error => error.path).sort();
    expect(paths).toEqual(['areas', 'availability', 'documents', 'profile', 'services']);

    const rows = await prisma.$queryRaw<{ submitted_at: Date | null }[]>(Prisma.sql`SELECT submitted_at FROM providers WHERE user_id = ${provider.id}::uuid`);
    expect(rows[0]?.submitted_at).toBeNull();
  });

  it('still refuses when the CNIC is the only thing missing', async () => {
    const provider = await registerAndVerify(app, 'PROVIDER');
    await callApi(app, '/provider/profile', asProvider(provider, patchJson({ cityId: lahoreId, lat: 31.5204, lng: 74.3587 })));
    await callApi(app, `/provider/services/${serviceId}`, putJson({ pricePaisa: minPricePaisa }, provider.accessToken));
    await callApi(app, '/provider/service-areas', asProvider(provider, putJson({ areaIds: [areaId] })));
    await callApi(app, '/provider/availability', asProvider(provider, putJson({ items: [{ weekday: 1, startTime: '09:00', endTime: '17:00' }] })));

    const response = await callApi<{ errors: { path: string }[] }>(app, '/provider/submit', asProvider(provider, postJson({ acceptPenaltySchedule: true })));
    expect(response.status).toBe(400);
    expect(response.body.errors.map(error => error.path)).toEqual(['documents']);
  });

  it('moves a complete profile to PENDING_APPROVAL and stamps the schedule acceptance and an audit row', async () => {
    const provider = await registerAndVerify(app, 'PROVIDER');
    await completeOnboarding(provider);

    const response = await callApi<{ status: string; submittedAt: string; penaltyScheduleAcceptedAt: string }>(app, '/provider/submit', asProvider(provider, postJson({ acceptPenaltySchedule: true })));
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('PENDING_APPROVAL');
    expect(response.body.submittedAt).toBeTruthy();
    expect(response.body.penaltyScheduleAcceptedAt).toBeTruthy();

    const audit = await prisma.$queryRaw<{ action: string; actor_role: string }[]>(
      Prisma.sql`SELECT action, actor_role::text as "actor_role" FROM audit_log WHERE entity_type = 'provider' AND entity_id = ${provider.id} AND action = 'provider.submit'`
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]?.actor_role).toBe('PROVIDER');
  });

  it('rejects a second submit once it is already pending approval', async () => {
    const provider = await registerAndVerify(app, 'PROVIDER');
    await completeOnboarding(provider);
    await callApi(app, '/provider/submit', asProvider(provider, postJson({ acceptPenaltySchedule: true })));

    const again = await callApi<{ code: string }>(app, '/provider/submit', asProvider(provider, postJson({ acceptPenaltySchedule: true })));
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('CONFLICT');
  });

  it('requires the penalty schedule to be accepted', async () => {
    const provider = await registerAndVerify(app, 'PROVIDER');
    const response = await callApi(app, '/provider/submit', asProvider(provider, postJson({ acceptPenaltySchedule: false })));
    expect(response.status).toBe(422);
  });

  it('the submitted provider can then be approved through the normal admin flow', async () => {
    const provider = await registerAndVerify(app, 'PROVIDER');
    await completeOnboarding(provider);
    await verifyCnicFor(app, provider);
    await callApi(app, '/provider/submit', asProvider(provider, postJson({ acceptPenaltySchedule: true })));

    const admin = await adminSession(app);
    const approved = await callApi<{ status: string }>(app, `/admin/providers/${provider.id}/approve`, { method: 'POST', headers: { authorization: `Bearer ${admin.accessToken}` } });
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe('APPROVED');
  });
});
