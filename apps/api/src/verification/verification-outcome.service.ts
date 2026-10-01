// apps/api/src/verification/verification-outcome.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { remarkDisplayName } from '@smart-home/domain';
import { DomainError } from '../common/domain-error.js';
import { applySystemEvent } from '../booking/booking-state.js';
import { ReleaseService, type ReleaseFacts } from '../payment/release.service.js';
import { appendOutboxEvent } from '../platform/audit.service.js';
import { AppClock } from '../platform/app-clock.js';
import { ConductService } from '../conduct/conduct.service.js';
import { ReputationService } from '../reputation/reputation.service.js';
import { SettingsService } from '../platform/settings.service.js';

export type OutcomeBooking = {
  id: string;
  customerId: string;
  providerId: string;
  paymentMode: 'CASH' | 'ONLINE';
  finalAmountPaisa: bigint;
  discountPaisa: bigint;
  commissionRateBp: number;
  failedReworkCount: number;
  /** Money already went to the provider on an earlier verification; this one is a warranty re-check and moves none. */
  alreadyReleased: boolean;
};

export type Actor = { userId: string | null; role: 'AGENT' | 'SYSTEM' };

export type RatingInput = { quality: number; punctuality: number; conduct: number; cleanliness: number; remark?: string | undefined };

export type OutcomeResult = { refundIds: string[]; reworkStarted?: boolean; disputeOpened?: boolean };

/**
 * What a verification outcome does to the job, in one place. Whoever decides — an agent's submission, the customer's
 * one-tap link, or the 72-hour auto-release — the effect is the same code, so the rules (release only on a permitting
 * outcome, rating only from a real answer, at most one dispute) cannot drift between the three entry points. Always
 * called inside the caller's transaction, after the verification row itself has been written.
 */
@Injectable()
export class VerificationOutcomeService {
  constructor(
    @Inject(ReleaseService) private readonly release: ReleaseService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(ReputationService) private readonly reputation: ReputationService,
    @Inject(ConductService) private readonly conduct: ConductService,
    @Inject(AppClock) private readonly clock: AppClock
  ) {}

  static async loadBooking(tx: Prisma.TransactionClient, bookingId: string): Promise<OutcomeBooking> {
    const rows = await tx.$queryRaw<
      { id: string; customerId: string; providerId: string; paymentMode: string; finalAmountPaisa: bigint | null; discountPaisa: bigint; commissionRateBp: number; failedReworkCount: number; releasedAt: Date | null }[]
    >(
      Prisma.sql`SELECT id, customer_id as "customerId", provider_id as "providerId", payment_mode::text as "paymentMode", final_amount_paisa as "finalAmountPaisa", discount_paisa as "discountPaisa",
          commission_rate_bp as "commissionRateBp", failed_rework_count as "failedReworkCount", released_at as "releasedAt" FROM bookings WHERE id = ${bookingId}::uuid FOR UPDATE`
    );
    const row = rows[0];
    if (row === undefined) throw new DomainError('NOT_FOUND', 'Booking was not found');
    const { releasedAt, ...rest } = row;
    return { ...rest, paymentMode: row.paymentMode === 'CASH' ? 'CASH' : 'ONLINE', finalAmountPaisa: row.finalAmountPaisa ?? 0n, alreadyReleased: releasedAt !== null };
  }

  private facts(booking: OutcomeBooking): ReleaseFacts {
    return { bookingId: booking.id, providerId: booking.providerId, finalPaisa: booking.finalAmountPaisa, discountPaisa: booking.discountPaisa, commissionRateBp: booking.commissionRateBp, paymentMode: booking.paymentMode };
  }

  /** T18 / T21: the job is verified (or auto-released). Online money is released now; cash waits for the provider to confirm they were paid. */
  async permitRelease(
    tx: Prisma.TransactionClient,
    input: { booking: OutcomeBooking; verificationId: string; event: 'verified' | 'linkConfirmed' | 'autoRelease'; actor: Actor; rating?: RatingInput | undefined; withIssue?: boolean; issueNote?: string | undefined }
  ): Promise<OutcomeResult> {
    const { booking, actor } = input;
    const moved = await applySystemEvent(tx, booking.id, input.event, { actorUserId: actor.userId ?? undefined, actorRole: actor.role, metadata: { verificationId: input.verificationId } });
    if (moved === null) throw new DomainError('ILLEGAL_TRANSITION', 'The booking is no longer awaiting verification');

    // A warranty re-check confirms the repair, but the job was already paid for and rated: no second rating, no second release.
    if (booking.alreadyReleased) {
      await applySystemEvent(tx, booking.id, 'release', { metadata: { verificationId: input.verificationId, warrantyRecheck: true } });
      return { refundIds: [] };
    }
    if (input.rating !== undefined) {
      await this.publishRating(tx, booking, input.verificationId, input.rating);
      await this.reputation.refresh(tx, booking.providerId);
    }
    if (input.withIssue === true) await this.raiseIssue(tx, booking, input.issueNote);

    let refundIds: string[] = [];
    if (booking.paymentMode === 'ONLINE') {
      const released = await this.release.releaseOnline(tx, this.facts(booking), actor.userId);
      refundIds = released.refundIds;
      await applySystemEvent(tx, booking.id, 'release', { metadata: { verificationId: input.verificationId, providerPaisa: released.providerPaisa.toString(), commissionPaisa: released.commissionPaisa.toString() } });
    } else {
      // Cash: the call gates the handover. The provider is now authorised to collect; `cash-received` completes the release.
      await appendOutboxEvent(tx, { aggregate: 'booking', aggregateId: booking.id, type: 'booking.cash_authorised', payload: { bookingId: booking.id, verificationId: input.verificationId } });
    }
    return { refundIds };
  }

  /** Rating and remark, only ever from a real answer (FR-RT-03: the database rejects one without a rating-producing verification). */
  private async publishRating(tx: Prisma.TransactionClient, booking: OutcomeBooking, verificationId: string, rating: RatingInput): Promise<void> {
    const rated = await tx.$queryRaw<{ id: string }[]>(
      Prisma.sql`INSERT INTO ratings(verification_call_id, booking_id, provider_id, customer_id, quality, punctuality, conduct, cleanliness)
        VALUES (${verificationId}::uuid, ${booking.id}::uuid, ${booking.providerId}::uuid, ${booking.customerId}::uuid, ${rating.quality}, ${rating.punctuality}, ${rating.conduct}, ${rating.cleanliness})
        RETURNING id`
    );
    const ratingId = rated[0]?.id;
    if (ratingId === undefined) throw new Error('Rating insert did not return a row');
    const text = rating.remark?.trim() ?? '';
    if (text === '') return;
    const names = await tx.$queryRaw<{ firstName: string; lastName: string }[]>(Prisma.sql`SELECT first_name as "firstName", last_name as "lastName" FROM users WHERE id = ${booking.customerId}::uuid`);
    const name = names[0] ?? { firstName: 'Customer', lastName: '' };
    await tx.$executeRaw(
      Prisma.sql`INSERT INTO remarks(rating_id, provider_id, body, display_name) VALUES (${ratingId}::uuid, ${booking.providerId}::uuid, ${text}, ${remarkDisplayName(name.firstName, name.lastName)})`
    );
  }

  /** VERIFIED_WITH_ISSUE (FR-VC / SRS §5.4): money still moves, but a complaint opens and the provider is flagged; three flags in the window sends them to admin review. */
  private async raiseIssue(tx: Prisma.TransactionClient, booking: OutcomeBooking, note: string | undefined): Promise<void> {
    const sla = await this.settings.get<{ NORMAL?: number }>('complaint.sla_hours');
    const normalHours = sla?.NORMAL ?? 72;
    const complaints = await tx.$queryRaw<{ id: string }[]>(
      Prisma.sql`INSERT INTO complaints(booking_id, raised_by_user_id, against_user_id, source, category, severity, description, sla_due_at)
        VALUES (${booking.id}::uuid, NULL, ${booking.providerId}::uuid, 'VERIFICATION_AUTO'::complaint_source, 'QUALITY'::complaint_category, 'NORMAL'::complaint_severity,
          ${note ?? 'The customer reported an issue during the verification call'}, now() + make_interval(hours => ${normalHours}::int)) RETURNING id`
    );
    const complaintId = complaints[0]?.id;
    if (complaintId !== undefined) {
      await tx.$executeRaw(Prisma.sql`INSERT INTO complaint_events(complaint_id, type, to_status, body) VALUES (${complaintId}::uuid, 'CREATED'::complaint_event_type, 'OPEN'::complaint_status, 'Opened automatically from a verification call')`);
    }
    await tx.$executeRaw(Prisma.sql`INSERT INTO provider_flags(provider_id, kind, booking_id, detail) VALUES (${booking.providerId}::uuid, 'VERIFIED_WITH_ISSUE'::flag_kind, ${booking.id}::uuid, ${JSON.stringify({ complaintId })}::jsonb)`);
    const windowDays = await this.settings.getNumber('flags.window_days');
    const reviewCount = await this.settings.getNumber('flags.review_count');
    const flags = await tx.$queryRaw<{ n: bigint }[]>(
      Prisma.sql`SELECT count(*)::bigint as n FROM provider_flags WHERE provider_id = ${booking.providerId}::uuid AND cleared_at IS NULL AND created_at > now() - make_interval(days => ${windowDays}::int)`
    );
    if ((flags[0]?.n ?? 0n) >= BigInt(reviewCount)) {
      await appendOutboxEvent(tx, { aggregate: 'provider', aggregateId: booking.providerId, type: 'provider.review_required', payload: { providerId: booking.providerId, reason: 'FLAGS_THRESHOLD', flags: flags[0]?.n.toString() ?? '0' } });
    }
  }

  /**
   * T19: rework. The first failed visit sends the provider back (funds stay held); a second failed verification — or an expired rework
   * window — is a dispute instead. Exactly one dispute per booking: the database allows a single non-resolved dispute.
   */
  async requireRework(tx: Prisma.TransactionClient, input: { booking: OutcomeBooking; verificationId: string; actor: Actor }): Promise<OutcomeResult> {
    const { booking, actor } = input;
    if (booking.failedReworkCount >= 1) {
      await this.openDispute(tx, { booking, origin: 'REWORK_FAILED', event: 'outcomeDisputed', actor, verificationId: input.verificationId });
      return { refundIds: [], disputeOpened: true };
    }
    const moved = await applySystemEvent(tx, booking.id, 'outcomeRework', { actorUserId: actor.userId ?? undefined, actorRole: actor.role, metadata: { verificationId: input.verificationId } });
    if (moved === null) throw new DomainError('ILLEGAL_TRANSITION', 'The booking is no longer awaiting verification');
    await tx.$executeRaw(Prisma.sql`UPDATE bookings SET failed_rework_count = failed_rework_count + 1 WHERE id = ${booking.id}::uuid`);
    // SHM-080: rework confirmed by verification is a breach (quality) — proposed for the provider to answer, never applied on its own.
    await this.conduct.autoPropose(tx, { providerId: booking.providerId, breachCode: 'REWORK_VERIFIED', bookingId: booking.id, evidence: { verificationId: input.verificationId } });
    return { refundIds: [], reworkStarted: true };
  }

  /** T20 / T22: funds frozen and the admin dispute queue gets the case. */
  async openDispute(
    tx: Prisma.TransactionClient,
    input: { booking: OutcomeBooking; origin: 'VERIFICATION' | 'REWORK_FAILED' | 'REWORK_EXPIRED' | 'COMPLAINT'; event: 'outcomeDisputed' | 'reworkWindowExpired'; actor: Actor; verificationId?: string | undefined; complaintId?: string | undefined }
  ): Promise<void> {
    const moved = await applySystemEvent(tx, input.booking.id, input.event, { actorUserId: input.actor.userId ?? undefined, actorRole: input.actor.role, metadata: { origin: input.origin, verificationId: input.verificationId ?? null } });
    if (moved === null) throw new DomainError('ILLEGAL_TRANSITION', 'The booking cannot be disputed from its current status');
    const replyHours = await this.settings.getNumber('penalty.reply_hours');
    await tx.$executeRaw(
      Prisma.sql`INSERT INTO disputes(booking_id, complaint_id, origin, status, reply_due_at) VALUES (${input.booking.id}::uuid, ${input.complaintId ?? null}::uuid, ${input.origin}::dispute_origin, 'OPEN'::dispute_status, ${new Date(this.clock.now().getTime() + replyHours * 3_600_000).toISOString()}::timestamptz)`
    );
    await appendOutboxEvent(tx, { aggregate: 'booking', aggregateId: input.booking.id, type: 'dispute.opened', payload: { bookingId: input.booking.id, origin: input.origin } });
  }
}
