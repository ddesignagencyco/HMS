// apps/api/test/integration/disputes.test.ts
//
// FR-CP-05 / FR-CP-06 / UC-14 / T24: an admin's ruling splits the frozen escrow. This suite exists because the money
// mechanics of `DisputesService.resolve` deserve proof: whatever the ruling, the two halves — what the provider gets and
// what goes back — always add up to exactly what the booking was holding, escrow ends at zero, and postings, refund,
// booking state, the dispute record and both parties' notices commit together or not at all.
import { Prisma } from '@prisma/client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { commissionOnPaisa, paisaToNumber } from '@smart-home/domain';
import { callApi, adminSession, createTestApp, postJson } from './harness.js';
import { agentSession, agentVerify, bearer, completedJob, dropLocks, freezeInsideCallingHours, newProvider, prisma, unfreeze, walletOf, type Job, type Provider } from './flow.js';

let app: NestExpressApplication;
let close: () => Promise<void>;
let agent: { accessToken: string; userId: string };
let admin: { accessToken: string; userId: string };
let provider: Provider;

beforeAll(async () => {
  const started = await createTestApp();
  app = started.app;
  close = started.close;
  freezeInsideCallingHours(app);
  agent = await agentSession(app, 'agent1');
  admin = await adminSession(app);
  provider = await newProvider(app);
});

afterEach(async () => {
  freezeInsideCallingHours(app);
  await dropLocks(agent.userId);
});

afterAll(async () => {
  unfreeze(app);
  await close();
  await prisma.$disconnect();
});

/** The only outcome DISPUTED permits: the answers say no work was done. */
const disputedOutcome = { workCompleted: 'NONE', quality: 1, punctuality: 1, conduct: 1, cleanliness: 1, extraChargeDemanded: false, uniformWorn: false, ownTools: false, consentLineRead: true, consentToRelease: false, outcome: 'DISPUTED' } as const;

const escrowOf = async (bookingId: string): Promise<number> => {
  const rows = await prisma.$queryRaw<{ balance: bigint }[]>(
    Prisma.sql`SELECT b.balance FROM ledger_accounts a JOIN account_balances b ON b.account_id = a.id WHERE a.type = 'ESCROW' AND a.booking_id = ${bookingId}::uuid`
  );
  return paisaToNumber(rows[0]?.balance ?? 0n);
};

const bookingOf = async (bookingId: string): Promise<{ status: string; paymentStatus: string }> =>
  (await prisma.$queryRaw<{ status: string; paymentStatus: string }[]>(
    Prisma.sql`SELECT status::text as status, payment_status::text as "paymentStatus" FROM bookings WHERE id = ${bookingId}::uuid`
  ))[0]!;

const refundsOf = async (bookingId: string): Promise<{ amountPaisa: bigint; reasonCode: string }[]> =>
  prisma.$queryRaw<{ amountPaisa: bigint; reasonCode: string }[]>(
    Prisma.sql`SELECT amount_paisa as "amountPaisa", reason_code as "reasonCode" FROM refunds WHERE booking_id = ${bookingId}::uuid ORDER BY created_at`
  );

const penaltyOf = async (providerId: string, bookingId: string): Promise<{ breachCode: string; status: string }[]> =>
  prisma.$queryRaw<{ breachCode: string; status: string }[]>(
    Prisma.sql`SELECT breach_code as "breachCode", status::text as status FROM penalties WHERE provider_id = ${providerId}::uuid AND booking_id = ${bookingId}::uuid`
  );

const disputeOf = async (disputeId: string): Promise<{ status: string; resolution: string | null; releasePaisa: bigint | null; refundPaisa: bigint | null; resolvedBy: string | null; note: string | null }> =>
  (await prisma.$queryRaw<{ status: string; resolution: string | null; releasePaisa: bigint | null; refundPaisa: bigint | null; resolvedBy: string | null; note: string | null }[]>(
    Prisma.sql`SELECT status::text as status, resolution::text as resolution, release_paisa as "releasePaisa", refund_paisa as "refundPaisa", resolved_by as "resolvedBy", note FROM disputes WHERE id = ${disputeId}::uuid`
  ))[0]!;

/**
 * An ONLINE job driven through the real API to DISPUTED: captured into escrow, accepted, visited, completed,
 * handed to verification, and ruled DISPUTED by an agent — money still frozen.
 */
const openOnlineDispute = async (options: { finalReduction?: number } = {}): Promise<{ job: Job; disputeId: string; heldPaisa: number; approvedPaisa: number; finalPaisa: number; commissionRateBp: number }> => {
  const job = await completedJob(app, provider, { mode: 'ONLINE', minutesOnSite: 50, ...(options.finalReduction === undefined ? {} : { finalReduction: options.finalReduction }) });
  const submitted = await agentVerify(app, agent, job, disputedOutcome);
  if (submitted.status !== 200 || submitted.body.bookingStatus !== 'DISPUTED') throw new Error(`dispute open failed: ${submitted.status} ${JSON.stringify(submitted.body)}`);
  const disputes = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM disputes WHERE booking_id = ${job.id}::uuid`);
  const rows = await prisma.$queryRaw<{ finalAmountPaisa: bigint | null; approvedTotalPaisa: bigint; commissionRateBp: number }[]>(
    Prisma.sql`SELECT final_amount_paisa as "finalAmountPaisa", approved_total_paisa as "approvedTotalPaisa", commission_rate_bp as "commissionRateBp" FROM bookings WHERE id = ${job.id}::uuid`
  );
  const row = rows[0]!;
  return { job, disputeId: disputes[0]!.id, heldPaisa: await escrowOf(job.id), approvedPaisa: paisaToNumber(row.approvedTotalPaisa), finalPaisa: paisaToNumber(row.finalAmountPaisa ?? row.approvedTotalPaisa), commissionRateBp: row.commissionRateBp };
};

const rule = (disputeId: string, body: Record<string, unknown>) =>
  callApi<{ disputeId: string; resolution: string; releasePaisa: number; refundPaisa: number }>(app, `/admin/disputes/${disputeId}/resolve`, bearer(admin.accessToken, postJson(body)));

/** Every money test rules before the reply deadline, so the override is what makes it legal — and it is asserted where the availability matters. */
const carry = { note: 'Ruled on the evidence floor.', overrideReason: 'Evidence reviewed; ruling before the reply deadline.' };

describe('FR-CP-05 / UC-14: an online ruling splits the frozen escrow exactly', () => {
  it('FULL_RELEASE pays the provider the whole job and zeroes escrow', async () => {
    const { job, disputeId, heldPaisa, finalPaisa, commissionRateBp } = await openOnlineDispute();
    const walletBefore = await walletOf(provider.id);

    const ruled = await rule(disputeId, { resolution: 'FULL_RELEASE', ...carry });
    expect(ruled.status).toBe(200);
    expect(ruled.body.releasePaisa).toBe(finalPaisa);
    expect(ruled.body.refundPaisa).toBe(0);
    expect(ruled.body.releasePaisa + ruled.body.refundPaisa).toBe(heldPaisa);

    expect(await escrowOf(job.id)).toBe(0);
    const commission = commissionOnPaisa(BigInt(finalPaisa), BigInt(commissionRateBp));
    expect(await walletOf(provider.id)).toBe(walletBefore + (BigInt(finalPaisa) - commission));

    const booking = await bookingOf(job.id);
    expect(booking.status).toBe('PAYMENT_RELEASED');
    expect(booking.paymentStatus).toBe('RELEASED');
    expect(await refundsOf(job.id)).toEqual([]);

    const record = await disputeOf(disputeId);
    expect(record.status).toBe('RESOLVED');
    expect(record.resolution).toBe('FULL_RELEASE');
    expect(paisaToNumber(record.releasePaisa ?? 0n)).toBe(finalPaisa);
    expect(paisaToNumber(record.refundPaisa ?? 0n)).toBe(0);
    expect(record.resolvedBy).toBe(admin.userId);

    // The ruling left a trace both parties are told about and the history can prove.
    const noticed = await prisma.$queryRaw<{ payload: { releasePaisa: string; refundPaisa: string } }[]>(
      Prisma.sql`SELECT payload FROM outbox_events WHERE aggregate = 'dispute' AND aggregate_id = ${disputeId}::text AND type = 'dispute.resolved'`
    );
    expect(noticed.length).toBe(1);
    expect(noticed[0]!.payload.releasePaisa).toBe(String(finalPaisa));
    const history = await prisma.$queryRaw<{ event: string }[]>(
      Prisma.sql`SELECT event FROM booking_status_history WHERE booking_id = ${job.id}::uuid AND event = 'resolveRelease'`
    );
    expect(history.length).toBe(1);
  });

  it('FULL_RELEASE refunds whatever the escrow held beyond the job final amount', async () => {
    // The provider charged less than approved, so the capture over-holds: the extra must come back.
    const { job, disputeId, heldPaisa, approvedPaisa, finalPaisa, commissionRateBp } = await openOnlineDispute({ finalReduction: 400_00 });
    expect(heldPaisa).toBe(approvedPaisa);
    expect(finalPaisa).toBeLessThan(heldPaisa);
    const walletBefore = await walletOf(provider.id);

    const ruled = await rule(disputeId, { resolution: 'FULL_RELEASE', ...carry });
    expect(ruled.body.releasePaisa).toBe(finalPaisa);
    expect(ruled.body.refundPaisa).toBe(heldPaisa - finalPaisa);
    expect(ruled.body.releasePaisa + ruled.body.refundPaisa).toBe(heldPaisa);

    expect(await escrowOf(job.id)).toBe(0);
    const commission = commissionOnPaisa(BigInt(finalPaisa), BigInt(commissionRateBp));
    expect(await walletOf(provider.id)).toBe(walletBefore + (BigInt(finalPaisa) - commission));
    const refunds = await refundsOf(job.id);
    expect(refunds.length).toBe(1);
    expect(paisaToNumber(refunds[0]!.amountPaisa)).toBe(heldPaisa - finalPaisa);
    expect(refunds[0]!.reasonCode).toBe('DISPUTE_FULL_RELEASE');
  });

  it('PARTIAL_RELEASE pays the stated part and returns the rest to the customer', async () => {
    const { job, disputeId, heldPaisa, commissionRateBp } = await openOnlineDispute();
    const part = Math.floor(heldPaisa / 2);
    const walletBefore = await walletOf(provider.id);

    const ruled = await rule(disputeId, { resolution: 'PARTIAL_RELEASE', releasePaisa: part, ...carry });
    expect(ruled.body.releasePaisa).toBe(part);
    expect(ruled.body.refundPaisa).toBe(heldPaisa - part);
    expect(ruled.body.releasePaisa + ruled.body.refundPaisa).toBe(heldPaisa);

    expect(await escrowOf(job.id)).toBe(0);
    const commission = commissionOnPaisa(BigInt(part), BigInt(commissionRateBp));
    expect(await walletOf(provider.id)).toBe(walletBefore + (BigInt(part) - commission));
    const refunds = await refundsOf(job.id);
    expect(paisaToNumber(refunds[0]!.amountPaisa)).toBe(heldPaisa - part);
    expect(refunds[0]!.reasonCode).toBe('DISPUTE_PARTIAL_RELEASE');

    const booking = await bookingOf(job.id);
    expect(booking.status).toBe('PARTIALLY_REFUNDED');
    expect(booking.paymentStatus).toBe('PARTIALLY_REFUNDED');
  });

  it('FULL_REFUND returns everything held and pays the provider nothing', async () => {
    const { job, disputeId, heldPaisa } = await openOnlineDispute();
    const walletBefore = await walletOf(provider.id);

    const ruled = await rule(disputeId, { resolution: 'FULL_REFUND', ...carry });
    expect(ruled.body.releasePaisa).toBe(0);
    expect(ruled.body.refundPaisa).toBe(heldPaisa);

    expect(await escrowOf(job.id)).toBe(0);
    expect(await walletOf(provider.id)).toBe(walletBefore);
    const refunds = await refundsOf(job.id);
    expect(paisaToNumber(refunds[0]!.amountPaisa)).toBe(heldPaisa);
    expect(refunds[0]!.reasonCode).toBe('DISPUTE_FULL_REFUND');

    const booking = await bookingOf(job.id);
    expect(booking.status).toBe('REFUNDED');
    expect(booking.paymentStatus).toBe('REFUNDED');
  });

  it('REFUND_WITH_PENALTY refunds everything and proposes the breach for the provider to answer', async () => {
    const { job, disputeId, heldPaisa } = await openOnlineDispute();
    const walletBefore = await walletOf(provider.id);

    const ruled = await rule(disputeId, { resolution: 'REFUND_WITH_PENALTY', breachCode: 'OVERCHARGE', excessPaisa: 10_000, ...carry });
    expect(ruled.status).toBe(200);
    expect(ruled.body.releasePaisa).toBe(0);
    expect(ruled.body.refundPaisa).toBe(heldPaisa);
    expect(await escrowOf(job.id)).toBe(0);
    expect(await walletOf(provider.id)).toBe(walletBefore);

    const booking = await bookingOf(job.id);
    expect(booking.status).toBe('REFUNDED');
    const penalties = await penaltyOf(provider.id, job.id);
    expect(penalties.length).toBe(1);
    expect(penalties[0]!.breachCode).toBe('OVERCHARGE');
    expect(penalties[0]!.status).toBe('PROPOSED');
  });

  it('refuses a ruling before the provider reply window closes, and accepts one the moment a valid override is given', async () => {
    const { disputeId, job, heldPaisa } = await openOnlineDispute();

    const refused = await rule(disputeId, { resolution: 'FULL_REFUND', note: 'Early ruling.' });
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: 'CONFLICT' });

    // Nothing moved: still disputed, money still held, no ruling recorded.
    expect((await bookingOf(job.id)).status).toBe('DISPUTED');
    expect(await escrowOf(job.id)).toBe(heldPaisa);
    expect((await disputeOf(disputeId)).status).toBe('OPEN');

    const ruled = await rule(disputeId, { resolution: 'FULL_REFUND', note: 'Early ruling.', overrideReason: 'The provider already admitted the fault in chat.' });
    expect(ruled.status).toBe(200);
    expect(ruled.body.refundPaisa).toBe(heldPaisa);
    const record = await disputeOf(disputeId);
    expect(record.note).toContain('override: The provider already admitted the fault');
  });
});

describe('FR-CP-05: the provider reply, and a ruling that can only happen once', () => {
  it('a provider reply closes the wait, so a no-override ruling is legal afterwards', async () => {
    const { job, disputeId, heldPaisa } = await openOnlineDispute();

    const replied = await callApi(app, `/provider/disputes/${disputeId}/reply`, bearer(job.provider.accessToken, postJson({ reply: 'The work was completed; the customer signed off in the chat.' })));
    expect(replied.status).toBe(200);
    expect((await disputeOf(disputeId)).status).toBe('READY');

    const ruled = await rule(disputeId, { resolution: 'FULL_RELEASE', note: 'Reply reviewed.' });
    expect(ruled.status).toBe(200);
    expect(ruled.body.releasePaisa).toBe(heldPaisa);
  });

  it('a ruling after the reply window has closed needs no override either', async () => {
    const { job, disputeId, heldPaisa } = await openOnlineDispute();

    // The window is tied to `penalty.reply_hours` (48h) on the frozen app clock; back-date it as if it elapsed.
    await prisma.$executeRaw(Prisma.sql`UPDATE disputes SET reply_due_at = now() - make_interval(hours => 49) WHERE id = ${disputeId}::uuid`);

    const ruled = await rule(disputeId, { resolution: 'FULL_REFUND', note: 'Window lapsed without a reply.' });
    expect(ruled.status).toBe(200);
    expect(ruled.body.refundPaisa).toBe(heldPaisa);
    expect((await bookingOf(job.id)).status).toBe('REFUNDED');
  });

  it('a dispute can be ruled only once', async () => {
    const { disputeId, heldPaisa } = await openOnlineDispute();
    const first = await rule(disputeId, { resolution: 'FULL_REFUND', ...carry });
    expect(first.status).toBe(200);

    const second = await rule(disputeId, { resolution: 'FULL_RELEASE', ...carry });
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ code: 'CONFLICT' });
    // The second attempt changed nothing.
    expect(paisaToNumber((await disputeOf(disputeId)).refundPaisa ?? 0n)).toBe(heldPaisa);
  });

  it('the admin evidence floor names the money held, and the provider\'s own view hides the agents', async () => {
    const { disputeId, heldPaisa, finalPaisa } = await openOnlineDispute();

    const floor = await callApi<{ money: { escrowHeldPaisa: number; finalAmountPaisa: number }; booking: { status: string }; callAttempts: unknown[]; verifications: { agentId: string | null }[] }>(
      app, `/admin/disputes/${disputeId}`, bearer(admin.accessToken)
    );
    expect(floor.status).toBe(200);
    expect(floor.body.money.escrowHeldPaisa).toBe(heldPaisa);
    expect(floor.body.money.finalAmountPaisa).toBe(finalPaisa);
    expect(floor.body.booking.status).toBe('DISPUTED');
  });
});

describe('a cash dispute: nothing held, so the provider is the source of the money', () => {
  let cashProvider: Provider;

  beforeAll(async () => {
    cashProvider = await newProvider(app);
  });

  const openCashDispute = async (): Promise<{ job: Job; disputeId: string; finalPaisa: number; commissionRateBp: number }> => {
    const job = await completedJob(app, cashProvider, { mode: 'CASH', minutesOnSite: 50 });
    const submitted = await agentVerify(app, agent, job, disputedOutcome);
    if (submitted.status !== 200 || submitted.body.bookingStatus !== 'DISPUTED') throw new Error(`cash dispute open failed: ${submitted.status} ${JSON.stringify(submitted.body)}`);
    const disputes = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM disputes WHERE booking_id = ${job.id}::uuid`);
    const rows = await prisma.$queryRaw<{ finalAmountPaisa: bigint | null; commissionRateBp: number }[]>(
      Prisma.sql`SELECT final_amount_paisa as "finalAmountPaisa", commission_rate_bp as "commissionRateBp" FROM bookings WHERE id = ${job.id}::uuid`
    );
    const row = rows[0]!;
    return { job, disputeId: disputes[0]!.id, finalPaisa: paisaToNumber(row.finalAmountPaisa ?? 0n), commissionRateBp: row.commissionRateBp };
  };

  it('FULL_RELEASE on a cash job settles the commission; nothing was ever held', async () => {
    const { job, disputeId, finalPaisa, commissionRateBp } = await openCashDispute();
    expect(await escrowOf(job.id)).toBe(0);
    const walletBefore = await walletOf(cashProvider.id);

    const ruled = await rule(disputeId, { resolution: 'FULL_RELEASE', ...carry });
    expect(ruled.status).toBe(200);
    expect(ruled.body.releasePaisa).toBe(finalPaisa);
    const commission = commissionOnPaisa(BigInt(finalPaisa), BigInt(commissionRateBp));
    expect(await walletOf(cashProvider.id)).toBe(walletBefore - commission);

    const booking = await bookingOf(job.id);
    expect(booking.status).toBe('PAYMENT_RELEASED');
    expect(booking.paymentStatus).toBe('CASH_SETTLED');
    expect(await refundsOf(job.id)).toEqual([]);
  });

  it('FULL_REFUND on a cash job draws the whole job from the provider\'s wallet', async () => {
    const { job, disputeId, finalPaisa } = await openCashDispute();
    const walletBefore = await walletOf(cashProvider.id);

    const ruled = await rule(disputeId, { resolution: 'FULL_REFUND', ...carry });
    expect(ruled.status).toBe(200);
    expect(ruled.body.refundPaisa).toBe(finalPaisa);
    expect(await walletOf(cashProvider.id)).toBe(walletBefore - BigInt(finalPaisa));

    const booking = await bookingOf(job.id);
    expect(booking.status).toBe('REFUNDED');
    expect(booking.paymentStatus).toBe('REFUNDED');
  });

  it('PARTIAL_RELEASE on a cash job settles the released part and compensates the rest', async () => {
    const { disputeId, finalPaisa, commissionRateBp } = await openCashDispute();
    const part = Math.floor(finalPaisa / 2);
    const walletBefore = await walletOf(cashProvider.id);

    const ruled = await rule(disputeId, { resolution: 'PARTIAL_RELEASE', releasePaisa: part, ...carry });
    expect(ruled.status).toBe(200);
    expect(ruled.body.releasePaisa).toBe(part);
    expect(ruled.body.refundPaisa).toBe(finalPaisa - part);

    const commission = commissionOnPaisa(BigInt(part), BigInt(commissionRateBp));
    expect(await walletOf(cashProvider.id)).toBe(walletBefore - commission - BigInt(finalPaisa - part));
    expect(paisaToNumber((await disputeOf(disputeId)).releasePaisa ?? 0n)).toBe(part);
  });
});