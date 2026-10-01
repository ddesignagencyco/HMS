// apps/api/src/verification/verification-submit.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { submissionProblems } from '@smart-home/domain';
import { DomainError, notFound } from '../common/domain-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { BookingService } from '../booking/booking.service.js';
import { ConductService } from '../conduct/conduct.service.js';
import { BookingStateService } from '../booking/booking-state.service.js';
import type { SubmitInput } from './verification.schemas.js';
import { VerificationOutcomeService, type OutcomeResult } from './verification-outcome.service.js';
import { VerificationQueueService } from './verification-queue.service.js';

export type SubmitResult = { verificationId: string; outcome: string; bookingStatus: string; released: boolean } & Pick<OutcomeResult, 'reworkStarted' | 'disputeOpened'>;

/**
 * FR-VC-04 / FR-VC-05 / FR-VC-08 / FR-PY-03 / FR-PY-06 / FR-RT-01..03: an agent's verdict. Everything it causes — the
 * immutable record, the booking's new state, the money, the rating and remark, a complaint and flag, a dispute — commits
 * in one transaction or not at all, so there is no moment when money has moved without a record saying why, or a record
 * says "release" and the money has not moved.
 */
@Injectable()
export class VerificationSubmitService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(VerificationOutcomeService) private readonly outcomes: VerificationOutcomeService,
    @Inject(VerificationQueueService) private readonly queue: VerificationQueueService,
    @Inject(BookingService) private readonly bookings: BookingService,
    @Inject(BookingStateService) private readonly bookingState: BookingStateService,
    @Inject(ConductService) private readonly conduct: ConductService
  ) {}

  async submit(agentId: string, verificationId: string, input: SubmitInput): Promise<SubmitResult> {
    const problems = submissionProblems(input, input.outcome);
    if (input.extraChargeDemanded && input.extraChargeAmountPaisa === undefined) {
      problems.push({ field: 'extraChargeAmountPaisa', message: 'Say how much was demanded' });
    }
    if (problems.length > 0) {
      throw new DomainError('VALIDATION_FAILED', 'The verification cannot be submitted as it stands', problems.map(problem => ({ path: problem.field, code: 'invalid', message: problem.message })));
    }

    const result = await this.prisma.$transaction(async tx => {
      const held = await tx.$queryRaw<{ id: string; bookingId: string; status: string; lockedBy: string | null }[]>(
        Prisma.sql`SELECT id, booking_id as "bookingId", status::text, locked_by as "lockedBy" FROM verification_calls WHERE id = ${verificationId}::uuid FOR UPDATE`
      );
      const call = held[0];
      if (call === undefined || call.lockedBy !== agentId || call.status !== 'LOCKED') throw notFound('Verification');
      if (await this.queue.hasConflictOfInterest(tx, agentId, call.bookingId)) throw new DomainError('CONFLICT_OF_INTEREST', 'You are linked to this job and cannot verify it');

      const answered = await tx.$queryRaw<{ n: bigint }[]>(
        Prisma.sql`SELECT count(*)::bigint as n FROM verification_call_attempts WHERE verification_call_id = ${verificationId}::uuid AND result = 'ANSWERED'`
      );
      if ((answered[0]?.n ?? 0n) === 0n) throw new DomainError('CONFLICT', 'Log the answered call before submitting the verification');

      const booking = await VerificationOutcomeService.loadBooking(tx, call.bookingId);
      const statuses = await tx.$queryRaw<{ status: string }[]>(Prisma.sql`SELECT status::text FROM bookings WHERE id = ${call.bookingId}::uuid`);
      if (statuses[0]?.status !== 'AWAITING_VERIFICATION') throw new DomainError('ILLEGAL_TRANSITION', `The booking is ${statuses[0]?.status ?? 'unknown'}, not awaiting verification`);

      // The record first. From this UPDATE on, the database refuses any edit to it (FR-VC-08); corrections are new `verification_amendments` rows.
      await tx.$executeRaw(
        Prisma.sql`UPDATE verification_calls SET status = 'SUBMITTED'::verification_status, outcome = ${input.outcome}::verification_outcome, submitted_at = now(), agent_id = ${agentId}::uuid,
            work_completed = ${input.workCompleted}::work_completion, quality = ${input.quality}, punctuality = ${input.punctuality}, conduct = ${input.conduct}, cleanliness = ${input.cleanliness},
            extra_charge_demanded = ${input.extraChargeDemanded}, extra_charge_amount_paisa = ${input.extraChargeAmountPaisa === undefined ? null : BigInt(input.extraChargeAmountPaisa)},
            uniform_worn = ${input.uniformWorn}, own_tools = ${input.ownTools}, consent_line_read = ${input.consentLineRead}, consent_to_release = ${input.consentToRelease},
            remark_text = ${input.remark ?? null}, recording_ref = ${input.recordingRef ?? null}, call_duration_seconds = ${input.callDurationSeconds ?? null}, locked_by = NULL, locked_at = NULL
          WHERE id = ${verificationId}::uuid`
      );

      const actor = { userId: agentId, role: 'AGENT' as const };
      let outcome: OutcomeResult;
      if (input.outcome === 'VERIFIED_SATISFIED' || input.outcome === 'VERIFIED_WITH_ISSUE') {
        outcome = await this.outcomes.permitRelease(tx, {
          booking, verificationId, event: 'verified', actor,
          rating: { quality: input.quality, punctuality: input.punctuality, conduct: input.conduct, cleanliness: input.cleanliness, remark: input.remark },
          withIssue: input.outcome === 'VERIFIED_WITH_ISSUE', issueNote: input.remark
        });
      } else if (input.outcome === 'REWORK_REQUIRED') {
        outcome = await this.outcomes.requireRework(tx, { booking, verificationId, actor });
      } else {
        await this.outcomes.openDispute(tx, { booking, origin: 'VERIFICATION', event: 'outcomeDisputed', actor, verificationId });
        // SHM-080: the customer says the provider asked for more than the approved price. Proposed with the amount, for the provider to answer.
        if (input.extraChargeDemanded) {
          await this.conduct.autoPropose(tx, { providerId: booking.providerId, breachCode: 'OVERCHARGE', bookingId: booking.id, excessPaisa: BigInt(input.extraChargeAmountPaisa ?? 0), evidence: { verificationId, demandedPaisa: input.extraChargeAmountPaisa ?? null } });
        }
        outcome = { refundIds: [], disputeOpened: true };
      }
      const after = await tx.$queryRaw<{ status: string }[]>(Prisma.sql`SELECT status::text FROM bookings WHERE id = ${call.bookingId}::uuid`);
      return { ...outcome, bookingId: call.bookingId, bookingStatus: after[0]?.status ?? 'UNKNOWN' };
    });

    await this.bookingState.settleRefunds(result.refundIds);
    // A rework visit is a new visit: the customer gets a fresh start code for it.
    if (result.reworkStarted === true) await this.bookings.issueStartOtp(result.bookingId);
    return {
      verificationId,
      outcome: input.outcome,
      bookingStatus: result.bookingStatus,
      released: result.bookingStatus === 'PAYMENT_RELEASED',
      ...(result.reworkStarted === undefined ? {} : { reworkStarted: result.reworkStarted }),
      ...(result.disputeOpened === undefined ? {} : { disputeOpened: result.disputeOpened })
    };
  }
}
