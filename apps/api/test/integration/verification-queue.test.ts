// apps/api/test/integration/verification-queue.test.ts
//
// SHM-055 / SHM-056 (read side): the agents' queue, claiming, locks, SLA and the console payload.
import { Prisma } from '@prisma/client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppClock } from '../../src/platform/app-clock.js';
import { VerificationQueueService } from '../../src/verification/verification-queue.service.js';
import { callApi, createTestApp, postJson, registerAndVerify, adminSession } from './harness.js';
import { agentSession, bearer, claim, completedJob, dropLocks, freezeInsideCallingHours, newProvider, prisma, travelToLocal, unfreeze, type Provider } from './flow.js';

let app: NestExpressApplication;
let close: () => Promise<void>;
let provider: Provider;
let agent1: { accessToken: string; userId: string };
let agent2: { accessToken: string; userId: string };

beforeAll(async () => {
  const started = await createTestApp();
  app = started.app;
  close = started.close;
  freezeInsideCallingHours(app);
  provider = await newProvider(app);
  agent1 = await agentSession(app, 'agent1');
  agent2 = await agentSession(app, 'agent2');
});

afterEach(async () => {
  freezeInsideCallingHours(app);
  await dropLocks(agent1.userId);
  await dropLocks(agent2.userId);
});

afterAll(async () => {
  unfreeze(app);
  await close();
  await prisma.$disconnect();
});

describe('SHM-055: the queue', () => {
  it('is for agents only: a customer, a provider and an unauthenticated caller are refused', async () => {
    const customer = await registerAndVerify(app, 'CUSTOMER');
    expect((await callApi(app, '/agent/queue', bearer(customer.accessToken))).status).toBe(403);
    expect((await callApi(app, '/agent/queue', bearer(provider.accessToken))).status).toBe(403);
    expect((await callApi(app, '/agent/queue')).status).toBe(401);
    const admin = await adminSession(app);
    expect((await callApi(app, '/agent/queue', bearer(admin.accessToken))).status).toBe(403);
  });

  it('puts cash jobs ahead of online ones, and shows an SLA counted in business minutes', async () => {
    const online = await completedJob(app, provider, { mode: 'ONLINE' });
    const cash = await completedJob(app, provider, { mode: 'CASH' });
    const list = await callApi<{ items: { id: string; priority: number; paymentMode: string; slaRemainingMinutes: number; slaBreached: boolean; tier: string; routingReasons: string[] }[] }>(app, '/agent/queue', bearer(agent1.accessToken));
    expect(list.status).toBe(200);
    const ids = list.body.items.map(item => item.id);
    expect(ids).toContain(cash.verificationId);
    expect(ids).toContain(online.verificationId);
    expect(ids.indexOf(cash.verificationId)).toBeLessThan(ids.indexOf(online.verificationId));
    const cashItem = list.body.items.find(item => item.id === cash.verificationId)!;
    expect(cashItem).toMatchObject({ priority: 0, paymentMode: 'CASH', tier: 'A', slaBreached: false });
    expect(cashItem.routingReasons).toContain('R8_CASH');
    expect(Number.isInteger(cashItem.slaRemainingMinutes)).toBe(true);
  });

  it('claims a call: it locks to the agent and cannot be claimed by another', async () => {
    const job = await completedJob(app, provider);
    const first = await claim(app, agent1.accessToken, job.verificationId);
    expect(first.status).toBe(200);
    expect(first.body.item).toMatchObject({ id: job.verificationId, status: 'LOCKED', lockedByMe: true });
    const second = await claim(app, agent2.accessToken, job.verificationId);
    expect(second.status).toBe(409);
    const asOther = await callApi<{ items: { id: string; status: string; lockedByMe: boolean }[] }>(app, '/agent/queue', bearer(agent2.accessToken));
    expect(asOther.body.items.find(item => item.id === job.verificationId)).toMatchObject({ status: 'LOCKED', lockedByMe: false });
  });

  it('two agents claiming the same call at the same instant: exactly one lock', async () => {
    const job = await completedJob(app, provider);
    const results = await Promise.all([claim(app, agent1.accessToken, job.verificationId), claim(app, agent2.accessToken, job.verificationId)]);
    expect(results.map(result => result.status).sort()).toEqual([200, 409]);
    const owners = await prisma.$queryRaw<{ lockedBy: string | null }[]>(Prisma.sql`SELECT locked_by as "lockedBy" FROM verification_calls WHERE id = ${job.verificationId}::uuid`);
    expect([agent1.userId, agent2.userId]).toContain(owners[0]?.lockedBy);
  });

  it('an agent holds one call at a time: claiming again returns the one they hold', async () => {
    const one = await completedJob(app, provider);
    const two = await completedJob(app, provider);
    await claim(app, agent1.accessToken, one.verificationId);
    const again = await claim(app, agent1.accessToken, two.verificationId);
    expect(again.body.item?.id).toBe(one.verificationId);
  });

  it('refuses to hand out calls outside calling hours with 423', async () => {
    const job = await completedJob(app, provider);
    travelToLocal(app, 3); // 03:00 Pakistan time
    const response = await claim(app, agent1.accessToken, job.verificationId);
    expect(response.status).toBe(423);
    expect(response.body.code).toBe('OUTSIDE_CALLING_HOURS');
  });

  it('refuses an agent who is linked to the job (CONFLICT_OF_INTEREST), and only that agent', async () => {
    const job = await completedJob(app, provider);
    const admin = await adminSession(app);
    await prisma.$executeRaw(Prisma.sql`INSERT INTO staff_conflicts(staff_user_id, other_user_id, reason, created_by) VALUES (${agent1.userId}::uuid, ${job.customer.id}::uuid, 'relative', ${admin.userId}::uuid)`);
    const refused = await claim(app, agent1.accessToken, job.verificationId);
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe('CONFLICT_OF_INTEREST');
    expect((await claim(app, agent2.accessToken, job.verificationId)).status).toBe(200);
  });

  it('release-lock returns the call to the queue; only the holder can do it', async () => {
    const job = await completedJob(app, provider);
    await claim(app, agent1.accessToken, job.verificationId);
    const stranger = await callApi(app, `/agent/verifications/${job.verificationId}/release-lock`, bearer(agent2.accessToken, { method: 'POST' }));
    expect(stranger.status).toBe(404);
    const released = await callApi(app, `/agent/verifications/${job.verificationId}/release-lock`, bearer(agent1.accessToken, { method: 'POST' }));
    expect(released.status).toBe(200);
    expect((await claim(app, agent2.accessToken, job.verificationId)).status).toBe(200);
  });

  it('a claim abandoned past the lock timeout goes back to the queue by itself', async () => {
    const job = await completedJob(app, provider);
    await claim(app, agent1.accessToken, job.verificationId);
    const queue = app.get(VerificationQueueService);
    expect(await queue.sweepExpiredLocks()).toBe(0);
    app.get(AppClock).advanceMinutes(11);
    expect(await queue.sweepExpiredLocks()).toBeGreaterThanOrEqual(1);
    const row = await prisma.$queryRaw<{ status: string; lockedBy: string | null }[]>(Prisma.sql`SELECT status::text, locked_by as "lockedBy" FROM verification_calls WHERE id = ${job.verificationId}::uuid`);
    expect(row[0]).toEqual({ status: 'QUEUED', lockedBy: null });
    expect((await claim(app, agent2.accessToken, job.verificationId)).status).toBe(200);
  });

  it('flags an SLA breach once, and shows it as negative time remaining', async () => {
    const job = await completedJob(app, provider);
    await prisma.$executeRaw(Prisma.sql`UPDATE verification_calls SET sla_due_at = now() - interval '2 hours' WHERE id = ${job.verificationId}::uuid`);
    const queue = app.get(VerificationQueueService);
    expect(await queue.flagSlaBreaches()).toBeGreaterThanOrEqual(1);
    expect(await queue.flagSlaBreaches()).toBe(0);
    const row = await prisma.$queryRaw<{ breached: Date | null }[]>(Prisma.sql`SELECT sla_breached_at as breached FROM verification_calls WHERE id = ${job.verificationId}::uuid`);
    expect(row[0]?.breached).not.toBeNull();
    const list = await callApi<{ items: { id: string; slaBreached: boolean; slaRemainingMinutes: number }[] }>(app, '/agent/queue', bearer(agent1.accessToken));
    const item = list.body.items.find(entry => entry.id === job.verificationId)!;
    expect(item.slaBreached).toBe(true);
    expect(item.slaRemainingMinutes).toBeLessThan(0);
  });
});

describe('SHM-056: the console payload', () => {
  it('gives an agent everything on one call: booking, invoice, photos, checklist, provider history, consent line, questionnaire', async () => {
    const job = await completedJob(app, provider);
    await claim(app, agent1.accessToken, job.verificationId);
    const response = await callApi<{
      verification: { id: string; tier: string; routingReasons: string[]; attempts: unknown[] };
      booking: { code: string; paymentMode: string; finalAmountPaisa: number; minutesOnSite: number | null };
      customer: { firstName: string; phone: string | null };
      invoice: { number: string; totalPaisa: number; lines: { kind: string }[] } | null;
      evidence: { kind: string }[];
      checklist: { done: boolean | null; requiresPhoto: boolean; evidenceId: string | null }[];
      providerHistory: { verifiedJobs: number; openComplaints: number } | null;
      consentLine: string;
      questionnaire: { key: string }[];
      outcomes: string[];
    }>(app, `/agent/verifications/${job.verificationId}`, bearer(agent1.accessToken));
    expect(response.status).toBe(200);
    expect(response.body.verification).toMatchObject({ id: job.verificationId, tier: 'A' });
    expect(response.body.booking.code).toBe(job.code);
    expect(response.body.invoice?.number).toMatch(/^INV-/);
    expect(response.body.invoice?.totalPaisa).toBe(response.body.booking.finalAmountPaisa);
    expect(response.body.invoice?.lines.length).toBeGreaterThan(0);
    expect(response.body.evidence.map(item => item.kind)).toEqual(expect.arrayContaining(['BEFORE', 'AFTER', 'CHECKLIST']));
    expect(response.body.checklist.every(step => step.done === true)).toBe(true);
    expect(response.body.checklist.filter(step => step.requiresPhoto).every(step => step.evidenceId !== null)).toBe(true);
    expect(response.body.providerHistory).not.toBeNull();
    expect(response.body.customer.phone).toMatch(/^\+92/);
    expect(response.body.consentLine).toContain('recorded');
    expect(response.body.questionnaire.map(question => question.key)).toEqual(['workCompleted', 'ratings', 'extraChargeDemanded', 'uniformWorn', 'ownTools', 'consentToRelease', 'remark']);
    expect(response.body.outcomes).toEqual(['VERIFIED_SATISFIED', 'VERIFIED_WITH_ISSUE', 'REWORK_REQUIRED', 'DISPUTED']);
  });

  it('is a 404 for any agent who does not hold the call', async () => {
    const job = await completedJob(app, provider);
    await claim(app, agent1.accessToken, job.verificationId);
    expect((await callApi(app, `/agent/verifications/${job.verificationId}`, bearer(agent2.accessToken))).status).toBe(404);
    expect((await callApi(app, `/agent/verifications/${job.verificationId}/attempts`, bearer(agent2.accessToken))).status).toBe(404);
    expect((await callApi(app, `/agent/verifications/${job.verificationId}/submit`, bearer(agent2.accessToken, postJson({})))).status).toBeGreaterThanOrEqual(404);
  });

  it('click-to-call bridges the agent to the customer; without an endpoint the agent gets the number to dial', async () => {
    const job = await completedJob(app, provider);
    await claim(app, agent1.accessToken, job.verificationId);
    const bridged = await callApi<{ mode: string; callRef?: string; consentLine: string }>(app, `/agent/verifications/${job.verificationId}/call`, bearer(agent1.accessToken, postJson({ agentEndpoint: '+923001112233' })));
    expect(bridged.status).toBe(200);
    expect(bridged.body.mode).toBe('BRIDGED');
    expect(bridged.body.callRef).toBeTruthy();
    const manual = await callApi<{ mode: string; customerPhone: string }>(app, `/agent/verifications/${job.verificationId}/call`, bearer(agent1.accessToken, postJson({})));
    expect(manual.body.mode).toBe('MANUAL');
    expect(manual.body.customerPhone).toBe(job.customer.phoneE164);
  });
});
