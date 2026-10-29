// apps/api/src/verification/verification-self.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { addBusinessMinutes, paisaToNumber, selfVerifyDecision, selfVerifyProblems } from '@smart-home/domain';
import { DomainError, notFound } from '../common/domain-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { AppClock } from '../platform/app-clock.js';
import { SettingsService } from '../platform/settings.service.js';
import { BOOKING_COLUMNS, toBookingRow, type BookingRow, type BookingRowRaw } from '../booking/booking.row.js';
import { BookingStateService } from '../booking/booking-state.service.js';
import type { SelfVerifyInput } from './verification.schemas.js';
import { VerificationOutcomeService } from './verification-outcome.service.js';

export type SelfVerifyOutcomeName = 'CONFIRMED' | 'CONFIRMED_WITH_ISSUE' | 'ESCALATED';

export type SelfVerifyResult = {
  outcome: SelfVerifyOutcomeName;
  bookingId: string;
  bookingStatus: string;
  /** What the customer is told next, written out rather than implied: the three answers lead to genuinely different screens. */
  message: string;
  booking: BookingRow;
};

const ESCALATED_REASON = "You've already told us about a problem with this job. One of our team will call you.";

/** Everything `availability()` needs to answer, gathered in one place so the GET and the POST cannot disagree about it. */
type Verifiability = { status: string; callInProgress: boolean; escalated: boolean; alreadyReleased: boolean; enabled: boolean };

/**
 * FR-VC-16: the customer's own "verify the work and rate your provider" form.
 *
 * This exists because of a specific failure, not as a nicer screen. Verification has three exits today â€”
 * an agent's call, a texted link that is only sent for Tier B jobs or after three unanswered calls, and a
 * 72-hour auto-release that publishes no rating at all. A Tier A job whose agent never picked it up had
 * none of them: the provider's money sat in escrow for three days and the customer was never once asked
 * what they thought of the work. This is that missing exit. It is open from the moment the job completes
 * rather than after a grace period, because what it removes from the critical path is a phone call, not a
 * control.
 *
 * What it is *not* is a way for one side to decide a dispute. Three boundaries hold:
 *
 *  - **It only ever releases the customer's own money to the provider they chose and already paid for.**
 *    The customer is the payer, so this cannot move money out of anyone's hands but their own.
 *  - **The integrity guard still applies.** "No work was done", or "they asked for more than the agreed
 *    price", forces an escalation regardless of which button was pressed â€” the same rule
 *    `allowedOutcomes` applies to an agent's answers, enforced a second time by the CHECK on
 *    `verification_calls`.
 *  - **It cannot record a rework or a dispute as a *decision*.** `verification_calls` deliberately
 *    requires a real agent, a full questionnaire and a spoken consent line for any outcome other than the
 *    two customer-driven ones, and that is a rule worth having rather than an obstacle. So "not
 *    acceptable" releases nothing and hands the case to a person at the front of the queue â€” which is
 *    exactly where the texted link already sends a negative answer, so the two transports agree.
 *
 * A submitted form supersedes any link we texted them: those rows are closed in the same transaction, or
 * the customer could confirm one job twice through two transports and earn two ratings from it.
 */
@Injectable()
export class VerificationSelfService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(AppClock) private readonly clock: AppClock,
    @Inject(VerificationOutcomeService) private readonly outcomes: VerificationOutcomeService,
    @Inject(BookingStateService) private readonly bookingState: BookingStateService
  ) {}

  /**
   * The form's own bootstrap: enough to render it, and an honest answer when it cannot be filled in.
   *
   * `canSubmit` comes back as a 200 rather than a 404 or 409 so the client can render the button *and*
   * the reason it is unavailable â€” "one of our team is calling you now" and "this job is already settled"
   * are both things a customer deserves to read, and a client handed only a status code has nothing to
   * show them.
   */
  async describe(bookingId: string, customerId: string) {
    const rows = await this.prisma.$queryRaw<
      { code: string; status: string; paymentMode: string; customerId: string; serviceName: string; providerFirstName: string | null; amountPaisa: bigint | null; alreadyReleased: boolean }[]
    >(
      Prisma.sql`SELECT b.code, b.status::text as status, b.payment_mode::text as "paymentMode", b.customer_id as "customerId", s.name_en as "serviceName",
          pu.first_name as "providerFirstName", b.final_amount_paisa as "amountPaisa", b.released_at IS NOT NULL as "alreadyReleased"
        FROM bookings b JOIN services s ON s.id = b.service_id LEFT JOIN users pu ON pu.id = b.provider_id WHERE b.id = ${bookingId}::uuid`
    );
    const row = rows[0];
    // Someone else's booking is a 404, not a 403: that another customer's booking exists is not this
    // customer's business. The same rule the booking service applies throughout.
    if (row === undefined || row.customerId !== customerId) throw notFound('Booking');

    const call = await this.openCall(this.prisma, bookingId);
    const { canSubmit, blockedReason } = this.availability({
      status: row.status,
      callInProgress: call.inProgress,
      escalated: call.escalated,
      alreadyReleased: row.alreadyReleased,
      enabled: await this.enabled()
    });

    return {
      bookingCode: row.code,
      serviceName: row.serviceName,
      providerFirstName: row.providerFirstName,
      paymentMode: row.paymentMode === 'CASH' ? 'CASH' : 'ONLINE',
      amountPaisa: row.amountPaisa === null ? null : paisaToNumber(row.amountPaisa),
      canSubmit,
      blockedReason,
      questions: [
        { key: 'workCompleted', label: 'Was the work completed?', answers: ['FULL', 'PARTIAL', 'NONE'] },
        { key: 'ratings', label: 'Rate the quality, punctuality, conduct and cleanliness, 1 to 5 each' },
        { key: 'extraChargeDemanded', label: 'Did the provider ask for any money beyond the agreed price?', answers: [true, false] },
        {
          key: 'choice',
          label: 'How would you like to leave this?',
          answers: ['SATISFIED', 'WITH_ISSUE', 'NOT_ACCEPTABLE']
        }
      ]
    };
  }

  async submit(bookingId: string, customerId: string, input: SelfVerifyInput): Promise<SelfVerifyResult> {
    const problems = selfVerifyProblems(input, input.outcome);
    if (problems.length > 0) {
      throw new DomainError('VALIDATION_FAILED', 'This cannot be submitted as it stands', problems.map(problem => ({ path: problem.field, code: 'invalid', message: problem.message })));
    }

    const decided = await this.prisma.$transaction(async tx => {
      const held = await tx.$queryRaw<{ customerId: string; status: string; alreadyReleased: boolean }[]>(
        Prisma.sql`SELECT b.customer_id as "customerId", b.status::text as status, b.released_at IS NOT NULL as "alreadyReleased" FROM bookings b WHERE b.id = ${bookingId}::uuid FOR UPDATE`
      );
      const bookingRow = held[0];
      if (bookingRow === undefined || bookingRow.customerId !== customerId) throw notFound('Booking');

      // Re-checked here, not trusted from the row read a moment ago: a flag is not a lock, and between
      // the customer opening the form and pressing submit an agent may have claimed the call.
      const openCall = await this.openCall(tx, bookingId);
      const available = this.availability({
        status: bookingRow.status,
        callInProgress: openCall.inProgress,
        escalated: openCall.escalated,
        alreadyReleased: bookingRow.alreadyReleased,
        enabled: await this.enabled()
      });
      if (!available.canSubmit) {
        // 409 rather than 404: the job plainly exists and belongs to this customer, so there is nothing
        // to hide â€” and the detail *is* the reason, which is the one thing the client must show.
        throw new DomainError('CONFLICT', available.blockedReason ?? 'This job cannot be confirmed right now');
      }

      // The open verification for this visit, locked. `FOR UPDATE` rather than `SKIP LOCKED` on
      // purpose: this is a customer acting, not a sweeper, so waiting a moment for whoever holds the row
      // and then re-reading it beats silently doing nothing. The re-read below is what makes that wait
      // safe â€” the 72-hour sweep takes the same row, and both deciding would release the money twice.
      const calls = await tx.$queryRaw<{ id: string; status: string; lockedBy: string | null }[]>(
        Prisma.sql`SELECT id, status::text, locked_by as "lockedBy" FROM verification_calls WHERE booking_id = ${bookingId}::uuid AND submitted_at IS NULL ORDER BY visit_no DESC LIMIT 1 FOR UPDATE`
      );
      const call = calls[0];
      if (call === undefined) throw new DomainError('CONFLICT', 'There is nothing open to confirm on this job');
      if (call.lockedBy !== null) throw new DomainError('CONFLICT', 'One of our team is calling you about this job right now');
      if (call.status === 'SUBMITTED') throw new DomainError('CONFLICT', 'This job has already been confirmed');

      const booking = await VerificationOutcomeService.loadBooking(tx, bookingId);
      const decision = selfVerifyDecision(input, input.outcome);

      // The customer's own answers are written onto the open record before anything is decided, which is
      // what an agent picking this case up wants to read before dialling: nobody should ask a customer
      // "was the work done?" when they have already typed the answer. Safe to write while the row is
      // unsubmitted â€” the immutability trigger only bites once `submitted_at` is set.
      await tx.$executeRaw(
        Prisma.sql`UPDATE verification_calls SET work_completed = ${input.workCompleted}::work_completion, quality = ${input.quality}, punctuality = ${input.punctuality},
            conduct = ${input.conduct}, cleanliness = ${input.cleanliness}, extra_charge_demanded = ${input.extraChargeDemanded}, consent_to_release = ${input.consentToRelease},
            remark_text = ${input.remark ?? null} WHERE id = ${call.id}::uuid AND submitted_at IS NULL`
      );
      await this.closeLinks(tx, call.id, decision.kind === 'escalate' ? 'ESCALATED' : 'SUBMITTED');

      if (decision.kind === 'escalate') {
        // Not something a form should decide, and nothing is released. This is the same destination the
        // texted link sends a negative answer to: Tier A, at the front of the queue, money untouched.
        //
        // Deliberately *not* proposing an OVERCHARGE demerit here, though the submit service does for an
        // agent's confirmed call. An unverified self-report is an accusation the provider cannot yet
        // answer on the record; escalating is what puts a person in a position to check it, and that
        // person proposes the breach if it holds. `extra_charge_demanded` is preserved on the row for
        // exactly that purpose.
        const reason = decision.reason === 'INTEGRITY' ? 'CUSTOMER_INTEGRITY_FLAG' : 'CUSTOMER_NOT_ACCEPTED';
        // The case gets a fresh SLA, counted in business minutes, exactly as the Tier-B escalation gives
        // one. That deadline is what keeps this from becoming a way to freeze a payment forever: the
        // 72-hour sweep skips a customer-negated call only until this passes (see `autoRelease`), after
        // which the job rejoins the ordinary path â€” agent queue, link fallback, then the sweep.
        const minutes = await this.settings.getNumber(booking.paymentMode === 'CASH' ? 'verification.cash_sla_min' : 'verification.sla_min');
        await tx.$executeRaw(
          Prisma.sql`UPDATE verification_calls SET tier = 'A'::verification_tier, routing_reasons = array_append(routing_reasons, ${reason}), status = 'QUEUED'::verification_status,
              locked_by = NULL, locked_at = NULL, priority = 0, next_attempt_at = ${this.clock.now().toISOString()}::timestamptz,
              sla_due_at = ${addBusinessMinutes(this.clock.now(), minutes).toISOString()}::timestamptz WHERE id = ${call.id}::uuid AND submitted_at IS NULL`
        );
        await tx.$executeRaw(Prisma.sql`UPDATE bookings SET verification_tier = 'A'::verification_tier WHERE id = ${bookingId}::uuid`);
        return { outcome: 'ESCALATED' as const, refundIds: [] as string[], after: await this.readStatus(tx, bookingId) };
      }

      // The release path. `permitRelease` is the same entry point an agent's submission and the texted
      // link both use, so the money, the rating, the reputation refresh and any complaint behave
      // identically whichever door the customer came through â€” the alternative is three code paths that
      // agree right up until the day one of them is edited.
      const updated = await tx.$executeRaw(
        Prisma.sql`UPDATE verification_calls SET status = 'SUBMITTED'::verification_status, outcome = 'LINK_CONFIRMED'::verification_outcome, submitted_at = now(),
            confirmed_via = 'IN_APP'::verification_confirmed_via, locked_by = NULL, locked_at = NULL WHERE id = ${call.id}::uuid AND submitted_at IS NULL`
      );
      if (updated === 0) throw new DomainError('CONFLICT', 'This job has already been confirmed');

      const released = await this.outcomes.permitRelease(tx, {
        booking,
        verificationId: call.id,
        event: 'linkConfirmed',
        actor: { userId: customerId, role: 'CUSTOMER' },
        rating: { quality: input.quality, punctuality: input.punctuality, conduct: input.conduct, cleanliness: input.cleanliness, remark: input.remark },
        withIssue: decision.withIssue,
        issueNote: input.remark
      });
      return {
        outcome: decision.withIssue ? ('CONFIRMED_WITH_ISSUE' as const) : ('CONFIRMED' as const),
        refundIds: released.refundIds,
        after: await this.readStatus(tx, bookingId)
      };
    });

    await this.bookingState.settleRefunds(decided.refundIds);

    const refreshed = await this.prisma.$queryRaw<BookingRowRaw[]>(Prisma.sql`SELECT ${BOOKING_COLUMNS} FROM bookings WHERE id = ${bookingId}::uuid`);
    const row = refreshed[0];
    if (row === undefined) throw notFound('Booking');
    const booking = toBookingRow(row);

    return {
      outcome: decided.outcome,
      bookingId,
      bookingStatus: decided.after,
      message: this.messageFor(decided.outcome, booking),
      booking
    };
  }

  /** What the customer is told, which is not the same thing for all three answers. */
  private messageFor(outcome: SelfVerifyOutcomeName, booking: BookingRow): string {
    if (outcome === 'ESCALATED') {
      return 'Nothing has been released. One of our team will call you about this â€” your money stays with us until the job is settled.';
    }
    // Cash never reaches PAYMENT_RELEASED from here: the form authorises the handover and the provider
    // confirms they were paid, exactly as it works after an agent's call.
    if (booking.paymentMode === 'CASH' && booking.status !== 'PAYMENT_RELEASED') {
      return 'Thank you. The provider can now collect the payment from you, and they have been notified.';
    }
    if (outcome === 'CONFIRMED_WITH_ISSUE') {
      return 'Thank you. The payment has been released and your provider has been told about the problem you reported.';
    }
    return 'Thank you. The payment has been released to the provider and your rating has been published.';
  }

  /**
   * Whether the form can be filled in, and why not when it cannot. One function for both the GET and the
   * POST so the screen and the submission can never offer different answers.
   *
   * `alreadyReleased` is the warranty re-check case: the booking comes back to AWAITING_VERIFICATION for
   * a return visit, but the customer has already paid and already been asked to rate. Offering them a
   * "release payment" form there would promise money that moved weeks ago.
   */
  private availability(state: Verifiability): { canSubmit: boolean; blockedReason: string | null } {
    if (!state.enabled) return { canSubmit: false, blockedReason: 'Self-confirmation is switched off. Our team will call you to confirm this job.' };
    if (state.alreadyReleased) return { canSubmit: false, blockedReason: 'This job has already been paid for.' };
    if (state.status !== 'AWAITING_VERIFICATION') return { canSubmit: false, blockedReason: 'This job has already been confirmed.' };
    if (state.callInProgress) return { canSubmit: false, blockedReason: 'One of our team is calling you about this job right now.' };
    // Single-use per job: once the customer has escalated (not acceptable, no work done, extra charge) the case belongs to a person, and a second answer
    // from the form could release the money and publish a rating on a case at the front of the agent queue.
    if (state.escalated) return { canSubmit: false, blockedReason: ESCALATED_REASON };
    // The form is single-use per job: once the customer has said "not acceptable" (or reported no work / an extra charge) the case belongs to a person, and a
    // second answer from the form could release the money and publish a rating on a case sitting at the front of the agent queue.
    if (state.escalated) return { canSubmit: false, blockedReason: ESCALATED_REASON };
    return { canSubmit: true, blockedReason: null };
  }

  /** What the open verification says that a booking row cannot: whether an agent holds it, and whether the customer has already escalated it. */
  private async openCall(tx: Prisma.TransactionClient | PrismaService, bookingId: string): Promise<{ inProgress: boolean; escalated: boolean }> {
    const rows = await tx.$queryRaw<{ inProgress: boolean | null; escalated: boolean | null }[]>(
      Prisma.sql`SELECT bool_or(locked_by IS NOT NULL) as "inProgress", bool_or(routing_reasons && ARRAY['CUSTOMER_NOT_ACCEPTED','CUSTOMER_INTEGRITY_FLAG']::text[]) as escalated
        FROM verification_calls WHERE booking_id = ${bookingId}::uuid AND submitted_at IS NULL`
    );
    return { inProgress: rows[0]?.inProgress ?? false, escalated: rows[0]?.escalated ?? false };
  }

  private async enabled(): Promise<boolean> {
    // Defaults to on when the setting has never been written: a missing row must not silently switch off
    // the exit that exists so money cannot get stuck.
    return (await this.settings.get<boolean>('verification.self_verify_enabled')) ?? true;
  }

  /**
   * Closes any link we texted for this call, so one job cannot be answered twice through two transports.
   * Marks them responded rather than deleting them: the row is the record that a link was sent, and it is
   * kept so an auditor can see both routes were offered and which one the customer used.
   */
  private async closeLinks(tx: Prisma.TransactionClient, verificationId: string, how: 'SUBMITTED' | 'ESCALATED'): Promise<void> {
    await tx.$executeRaw(
      Prisma.sql`UPDATE verification_links SET responded_at = ${this.clock.now().toISOString()}::timestamptz, answers = jsonb_build_object('source', 'IN_APP', 'via', ${how})
        WHERE verification_call_id = ${verificationId}::uuid AND responded_at IS NULL`
    );
  }

  private async readStatus(tx: Prisma.TransactionClient, bookingId: string): Promise<string> {
    const rows = await tx.$queryRaw<{ status: string }[]>(Prisma.sql`SELECT status::text FROM bookings WHERE id = ${bookingId}::uuid`);
    return rows[0]?.status ?? 'UNKNOWN';
  }
}
