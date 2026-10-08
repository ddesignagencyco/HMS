// apps/api/test/integration/flow.ts
//
// Shared scenario builders for the phase 3 suites: a job taken all the way to AWAITING_VERIFICATION,
// staff sessions, and a frozen clock inside calling hours.
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppClock } from '../../src/platform/app-clock.js';
import { callApi, postJson, readOtpFromInbox, readyBookableProvider, registerAndVerify, staffSession, type TestUser } from './harness.js';

export const prisma = new PrismaClient();

export const bearer = (accessToken: string, init: RequestInit = {}): RequestInit => ({ ...init, headers: { ...init.headers, authorization: `Bearer ${accessToken}` } });

export const JPEG = Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex').toString('base64');

/** The next moment (at or after now) that is `hour`:`minute` Pakistan time: Pakistan is UTC+5 all year. */
export const nextLocalTime = (hour: number, minute = 0): Date => {
  const now = new Date();
  let candidate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour - 5, minute));
  while (candidate.getTime() < now.getTime()) candidate = new Date(candidate.getTime() + 24 * 3_600_000);
  return candidate;
};

/** Makes the application's clock read 10:30 Pakistan time — inside calling hours whenever the suite really runs. Real elapsed time still counts. */
export const freezeInsideCallingHours = (app: NestExpressApplication, at: Date = nextLocalTime(10, 30)): void => app.get(AppClock).travelTo(at);
export const travelToLocal = (app: NestExpressApplication, hour: number, minute = 0): void => app.get(AppClock).travelTo(nextLocalTime(hour, minute));
export const unfreeze = (app: NestExpressApplication): void => app.get(AppClock).reset();

export type Provider = { id: string; accessToken: string; serviceId: number; areaId: number; user: TestUser };

export const newProvider = async (app: NestExpressApplication, where?: { lat: number; lng: number }): Promise<Provider> => {
  const ready = await readyBookableProvider(app, where);
  return { id: ready.provider.id, accessToken: ready.provider.accessToken, serviceId: ready.serviceId, areaId: ready.areaId, user: ready.provider };
};

export type Job = { id: string; code: string; customer: TestUser; provider: Provider; verificationId: string };

/** The provider enters the customer's latest start code. `minutesOnSite` back-dates the verified start so the job does not look suspiciously quick (rule R4). */
export const startVisit = async (app: NestExpressApplication, provider: Provider, customer: TestUser, bookingId: string, minutesOnSite?: number): Promise<void> => {
  const code = await readOtpFromInbox(app, customer.phoneE164);
  const started = await callApi(app, `/bookings/${bookingId}/start`, bearer(provider.accessToken, postJson({ code })));
  if (started.status !== 200) throw new Error(`start failed: ${started.status} ${JSON.stringify(started.body)}`);
  if (minutesOnSite !== undefined) {
    await prisma.$executeRaw(Prisma.sql`UPDATE bookings SET start_otp_verified_at = now() - make_interval(mins => ${minutesOnSite}::int) WHERE id = ${bookingId}::uuid`);
  }
};

/** Before photo, every checklist step (photographing the ones that need it), after photo, then complete. Works for a rework visit too: evidence is per visit. */
export const doWorkAndComplete = async (app: NestExpressApplication, provider: Provider, customer: TestUser, bookingId: string, finalReduction?: number): Promise<{ status: string; code: string }> => {
  const asProvider = (init: RequestInit = {}): RequestInit => bearer(provider.accessToken, init);
  await callApi(app, `/bookings/${bookingId}/evidence`, asProvider(postJson({ clientUuid: randomUUID(), kind: 'BEFORE', contentType: 'image/jpeg', contentBase64: JPEG })));
  const service = await callApi<{ checklist: { id: number; requiresPhoto: boolean }[] }>(app, '/catalogue/services/leak-repair');
  for (const item of service.body.checklist) {
    let evidenceId: string | undefined;
    if (item.requiresPhoto) evidenceId = (await callApi<{ id: string }>(app, `/bookings/${bookingId}/evidence`, asProvider(postJson({ clientUuid: randomUUID(), kind: 'CHECKLIST', checklistItemId: item.id, contentType: 'image/jpeg', contentBase64: JPEG })))).body.id;
    await callApi(app, `/bookings/${bookingId}/checklist/${item.id}`, asProvider(postJson({ done: true, ...(evidenceId === undefined ? {} : { evidenceId }) })));
  }
  await callApi(app, `/bookings/${bookingId}/evidence`, asProvider(postJson({ clientUuid: randomUUID(), kind: 'AFTER', contentType: 'image/jpeg', contentBase64: JPEG })));
  let finalAmount: number | undefined;
  if (finalReduction !== undefined) {
    const booking = await callApi<{ approvedTotalPaisa: number }>(app, `/bookings/${bookingId}`, bearer(customer.accessToken));
    finalAmount = booking.body.approvedTotalPaisa - finalReduction;
  }
  const completed = await callApi<{ status: string; code: string }>(app, `/bookings/${bookingId}/complete`, asProvider(postJson(finalAmount === undefined ? {} : { finalAmountPaisa: finalAmount })));
  if (completed.status !== 200 || completed.body.status !== 'AWAITING_VERIFICATION') throw new Error(`complete failed: ${completed.status} ${JSON.stringify(completed.body)}`);
  return completed.body;
};

let slotHours = 5_000;

/**
 * A booking driven through the real API to AWAITING_VERIFICATION. `minutesOnSite` back-dates the verified start so the job does not look
 * suspiciously quick (rule R4) when a test wants a routine one.
 */
export const completedJob = async (app: NestExpressApplication, provider: Provider, options: { mode?: 'CASH' | 'ONLINE'; minutesOnSite?: number; couponCode?: string; finalReduction?: number; customer?: TestUser } = {}): Promise<Job> => {
  const mode = options.mode ?? 'CASH';
  const customer = options.customer ?? (await registerAndVerify(app, 'CUSTOMER'));
  const address = await callApi<{ id: string }>(app, '/customer/addresses', bearer(customer.accessToken, postJson({ label: 'Home', line1: 'House 1', areaId: provider.areaId, lat: 31.52, lng: 74.35, isDefault: true })));
  slotHours += 24;
  const start = new Date(Date.now() + slotHours * 3_600_000);
  const created = await callApi<{ id: string; code: string; payment?: { paymentId: string } }>(
    app,
    '/bookings',
    bearer(customer.accessToken, postJson({ providerId: provider.id, serviceId: provider.serviceId, addressId: address.body.id, scheduledStart: start.toISOString(), scheduledEnd: new Date(start.getTime() + 3_600_000).toISOString(), paymentMode: mode, ...(options.couponCode === undefined ? {} : { couponCode: options.couponCode }) }))
  );
  if (created.status !== 201) throw new Error(`booking failed: ${created.status} ${JSON.stringify(created.body)}`);
  const id = created.body.id;
  if (created.body.payment !== undefined) await callApi(app, `/dev/payments/${created.body.payment.paymentId}/complete?outcome=captured`, { method: 'POST' });
  const asProvider = (init: RequestInit = {}): RequestInit => bearer(provider.accessToken, init);
  await callApi(app, `/bookings/${id}/accept`, asProvider({ method: 'POST' }));
  await callApi(app, `/bookings/${id}/depart`, asProvider({ method: 'POST' }));
  await startVisit(app, provider, customer, id, options.minutesOnSite);
  const completed = await doWorkAndComplete(app, provider, customer, id, options.finalReduction);
  const verification = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM verification_calls WHERE booking_id = ${id}::uuid ORDER BY visit_no DESC LIMIT 1`);
  return { id, code: completed.code, customer, provider, verificationId: verification[0]!.id };
};

export const agentSession = (app: NestExpressApplication, which: 'agent1' | 'agent2' = 'agent1'): Promise<{ accessToken: string; userId: string }> =>
  staffSession(app, which === 'agent1' ? 'agent1@smart-home.local' : 'agent2@smart-home.local');

/** Puts back anything this agent still holds, so one test's claim never blocks the next. */
export const dropLocks = async (agentId: string): Promise<void> => {
  await prisma.$executeRaw(Prisma.sql`UPDATE verification_calls SET status = 'QUEUED'::verification_status, locked_by = NULL, locked_at = NULL WHERE locked_by = ${agentId}::uuid AND status = 'LOCKED'`);
};

export const claim = (app: NestExpressApplication, agentToken: string, verificationId: string) =>
  callApi<{ item: { id: string; status: string; lockedByMe: boolean } | null; code?: string }>(app, '/agent/queue/claim', bearer(agentToken, postJson({ verificationId })));

export const answeredCall = (app: NestExpressApplication, agentToken: string, verificationId: string) =>
  callApi<{ attemptNo: number }>(app, `/agent/verifications/${verificationId}/attempts`, bearer(agentToken, postJson({ result: 'ANSWERED', durationSeconds: 120 })));

export const satisfied = { workCompleted: 'FULL', quality: 5, punctuality: 4, conduct: 5, cleanliness: 4, extraChargeDemanded: false, uniformWorn: true, ownTools: true, consentLineRead: true, consentToRelease: true, outcome: 'VERIFIED_SATISFIED', remark: 'Fixed the leak, tidy work.' } as const;

/** Claims the call, logs an answered attempt and submits: the whole agent side of one verification. */
export const agentVerify = async (app: NestExpressApplication, agent: { accessToken: string; userId: string }, job: { verificationId: string }, body: Record<string, unknown> = satisfied) => {
  await dropLocks(agent.userId);
  const claimed = await claim(app, agent.accessToken, job.verificationId);
  if (claimed.status !== 200) throw new Error(`claim failed: ${claimed.status} ${JSON.stringify(claimed.body)}`);
  await answeredCall(app, agent.accessToken, job.verificationId);
  return callApi<{ bookingStatus: string; released: boolean; code?: string }>(app, `/agent/verifications/${job.verificationId}/submit`, bearer(agent.accessToken, postJson(body)));
};

export const walletOf = async (userId: string): Promise<bigint> =>
  (await prisma.$queryRaw<{ balance: bigint }[]>(Prisma.sql`SELECT coalesce(sum(b.balance), 0)::bigint as balance FROM ledger_accounts a JOIN account_balances b ON b.account_id = a.id WHERE a.type = 'PROVIDER_WALLET' AND a.owner_user_id = ${userId}::uuid`))[0]?.balance ?? 0n;
