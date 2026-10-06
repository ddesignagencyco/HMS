// apps/api/src/booking/booking.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { canTransition, splitAtLocalMidnight, windowRefusal, type BookingEvent, type BookingStatus } from '@smart-home/domain';
import { DomainError, badRequest, conflict, notFound } from '../common/domain-error.js';
import { EnvironmentService } from '../config/environment.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { SMS_SENDER } from '../integrations/integrations.module.js';
import type { SmsSenderPort } from '../integrations/ports.js';
import { constantTimeEquals, generateOtpCode, hmacSha256 } from '../identity/otp.js';
import { appendOutboxEvent } from '../platform/audit.service.js';
import { AppClock } from '../platform/app-clock.js';
import { SettingsService } from '../platform/settings.service.js';
import { ReleaseService } from '../payment/release.service.js';
import { PaymentsService } from '../payment/payments.service.js';
import { BookingStateService } from './booking-state.service.js';
import { CompletionService } from './completion.service.js';
import { ExecutionService } from './execution.service.js';
import { OfferService } from './offer.service.js';
import { contactFor, maySeeFullContact, type OnBehalfContact } from './on-behalf.js';
import { PricingService } from './pricing.service.js';
import type { BookingCreateInput, BookingRescheduleInput } from './booking.schemas.js';

export { BOOKING_COLUMNS, toBookingRow, type BookingRow, type BookingRowRaw } from './booking.row.js';
import { BOOKING_COLUMNS, toBookingRow, type BookingRow, type BookingRowRaw } from './booking.row.js';

const EXCLUSION_VIOLATION = '23P01';

/** FR-BK-05: one free reschedule, and only up to this many hours before the *current* slot. */
const RESCHEDULE_NOTICE_HOURS = 4;

/** FR-EX-02: 5 tries, then a 15-minute lock, matching TRD §10's start-OTP rule. */
const START_OTP_MAX_ATTEMPTS = 5;
const START_OTP_LOCK_MINUTES = 15;

/**
 * Booking start codes are a different concept from the auth OTPs in
 * `identity/otp.service.ts` (those live in `otp_codes`, keyed by
 * target+purpose; this one lives directly on the booking row), so it gets its
 * own hash rather than reusing `hashOtpCode`'s auth-specific `OtpPurpose`.
 */
const hashStartOtp = (pepper: string, bookingId: string, code: string): string => hmacSha256(pepper, `BOOKING_START:${bookingId}:${code}`);

import { localTimeOfDay, localWeekday } from './slot-time.js';

@Injectable()
export class BookingService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EnvironmentService) private readonly environment: EnvironmentService,
    @Inject(SMS_SENDER) private readonly sms: SmsSenderPort,
    @Inject(BookingStateService) private readonly state: BookingStateService,
    @Inject(PricingService) private readonly pricing: PricingService,
    @Inject(PaymentsService) private readonly payments: PaymentsService,
    @Inject(OfferService) private readonly offers: OfferService,
    @Inject(CompletionService) private readonly completion: CompletionService,
    @Inject(ExecutionService) private readonly execution: ExecutionService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(AppClock) private readonly clock: AppClock,
    @Inject(ReleaseService) private readonly release: ReleaseService
  ) {}

  /**
   * FR-BK-01..04 / FR-BK-08 / FR-BK-09: checkout. One request creates the booking, its priced line items and — for an online booking — the
   * payment it waits on, in one transaction, so a booking never exists half-built. Cash goes straight to REQUESTED and opens its offer;
   * online stays PENDING_PAYMENT (holding the slot for `booking.pending_payment_timeout_min`) until the gateway's signed webhook captures it.
   * A clash on the provider's slot is refused by the database's exclusion constraint, whoever wins the race.
   */
  async create(customerId: string, input: BookingCreateInput): Promise<BookingRow & { payment?: { paymentId: string; redirectUrl: string } }> {
    const start = new Date(input.scheduledStart);
    const end = new Date(input.scheduledEnd);
    const refusal = await this.refuseWindow(start, end);
    if (refusal !== null) throw badRequest(refusal);

    if (input.providerId !== undefined) {
      const blocked = await this.prisma.$queryRaw<{ reason: string | null }[]>(Prisma.sql`SELECT offer_blocked_reason as reason FROM providers WHERE user_id = ${input.providerId}::uuid`);
      if (blocked[0]?.reason === 'DEBT') throw new DomainError('DEBT_BLOCKED', 'This provider is not taking new jobs right now');
    }
    const priced = await this.pricing.price(customerId, { providerId: input.providerId, serviceId: input.serviceId, isEmergency: input.isEmergency, couponCode: input.couponCode });
    const { quote } = priced;

    const addresses = await this.prisma.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT id FROM addresses WHERE id = ${input.addressId}::uuid AND customer_id = ${customerId}::uuid AND archived_at IS NULL`
    );
    if (addresses.length === 0) throw notFound('Address');

    const issueOptionId = await this.resolveIssueOption(input.serviceId, input.issueOptionId);

    if (input.providerId !== undefined) await this.assertWindowIsBookable(input.providerId, start, end);

    const bufferMin = await this.settings.getNumber('booking.travel_buffer_min');
    const online = input.paymentMode === 'ONLINE';
    if (online && quote.totalPaisa <= 0) throw badRequest('There is nothing to pay online for this booking; choose cash');
    const commissionRateBp = await this.resolveCommissionRateBp(input.providerId ?? null, priced.categoryId);
    const total = BigInt(quote.totalPaisa);

    try {
      const created = await this.prisma.$transaction(async tx => {
        const rows = await tx.$queryRaw<BookingRowRaw[]>(
          Prisma.sql`INSERT INTO bookings(customer_id, provider_id, service_id, address_id, status, payment_mode, payment_status, is_emergency, is_auto_assign, slot, scheduled_start, scheduled_end,
              problem_text, issue_option_id, is_on_behalf, on_behalf_name, on_behalf_phone_e164, quoted_amount_paisa, approved_total_paisa, discount_paisa, coupon_id, commission_rate_bp)
            VALUES (${customerId}::uuid, ${input.providerId ?? null}::uuid, ${input.serviceId}, ${input.addressId}::uuid,
              ${online ? 'PENDING_PAYMENT' : 'REQUESTED'}::booking_status, ${online ? 'ONLINE' : 'CASH'}::payment_mode, ${online ? 'PENDING' : 'NONE'}::booking_payment_status,
              ${input.isEmergency}, ${input.providerId === undefined}, ${this.slotRange(start, end, bufferMin)},
              ${start.toISOString()}::timestamptz, ${end.toISOString()}::timestamptz, ${input.problemText ?? null}, ${issueOptionId ?? null}::int,
              ${input.onBehalfOf !== undefined}, ${input.onBehalfOf?.name ?? null}, ${input.onBehalfOf?.phoneE164 ?? null},
              ${total}, ${total},
              ${BigInt(quote.discountPaisa)}, ${priced.couponId}::uuid, ${commissionRateBp})
            RETURNING ${BOOKING_COLUMNS}`
        );
        const row = rows[0];
        if (row === undefined) throw new Error('Booking insert did not return a row');

        for (const line of quote.lines) {
          const amount = BigInt(line.amountPaisa);
          await tx.$executeRaw(
            Prisma.sql`INSERT INTO booking_items(booking_id, kind, description, quantity, unit_price_paisa, amount_paisa)
              VALUES (${row.id}::uuid, ${line.kind}::item_kind, ${line.description}, 1, ${amount}, ${amount})`
          );
        }
        await tx.$executeRaw(
          Prisma.sql`INSERT INTO booking_status_history(booking_id, from_status, to_status, event, actor_user_id, actor_role, metadata)
            VALUES (${row.id}::uuid, NULL, ${row.status}::booking_status, 'create', ${customerId}::uuid, 'CUSTOMER'::actor_role,
              ${JSON.stringify({ paymentMode: input.paymentMode, isEmergency: input.isEmergency, isOnBehalf: input.onBehalfOf !== undefined, issueOptionId: issueOptionId ?? null })}::jsonb)`
        );

        let paymentId: string | null = null;
        if (online) {
          paymentId = await this.payments.createPayment(tx, { bookingId: row.id, payerUserId: customerId, amountPaisa: total, purpose: 'BOOKING', keySuffix: 'checkout' });
        } else {
          await this.redeemCoupon(tx, row.id, customerId);
          await this.offers.open(tx, row.id);
        }
        return { row, paymentId };
      });

      const booking = toBookingRow(created.row);
      if (created.paymentId === null) return booking;
      const payment = await this.payments.startCheckout(created.paymentId, { userId: customerId }, `/checkout/return?bookingId=${booking.id}`);
      return { ...booking, payment };
    } catch (error) {
      const meta = error instanceof Prisma.PrismaClientKnownRequestError ? (error.meta as { code?: unknown } | undefined) : undefined;
      if (meta?.code === EXCLUSION_VIOLATION) throw new DomainError('SLOT_TAKEN', 'That provider is no longer free at this time');
      throw error;
    }
  }

  /**
   * BR-08: the calendar range a booking occupies is its scheduled time plus *half* the travel buffer either side. Two neighbouring
   * bookings each carry half, so the database's no-overlap constraint requires the full buffer between them — exactly the gap the
   * slot listing keeps — and a provider cannot be booked back to back with no time to get there.
   */
  private slotRange(start: Date, end: Date, bufferMin: number): Prisma.Sql {
    return Prisma.sql`tstzrange(${new Date(start.getTime() - bufferMin * 30_000).toISOString()}::timestamptz, ${new Date(end.getTime() + bufferMin * 30_000).toISOString()}::timestamptz, '[)')`;
  }

  /**
   * FR-EX-07 / T25: within the service's warranty the customer can reopen a released job as rework — the same booking, not a new one.
   * The provider must come back within the rework window with a fresh start code, and the fix goes through verification again. Because
   * the money already moved, a claim that fails verification a second time is a dispute rather than another rework loop.
   */
  async warrantyClaim(bookingId: string, customerId: string, reason: string): Promise<BookingRow> {
    const result = await this.prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<{ warrantyUntil: Date | null; status: string; customerId: string }[]>(
        Prisma.sql`SELECT warranty_until as "warrantyUntil", status::text as status, customer_id as "customerId" FROM bookings WHERE id = ${bookingId}::uuid FOR UPDATE`
      );
      const row = rows[0];
      if (row === undefined || row.customerId !== customerId) throw notFound('Booking');
      if (row.status === 'PAYMENT_RELEASED' && (row.warrantyUntil === null || row.warrantyUntil.getTime() <= this.clock.now().getTime())) {
        throw new DomainError('ILLEGAL_TRANSITION', row.warrantyUntil === null ? 'This service carries no warranty' : 'The warranty on this job has expired');
      }
      const applied = await this.state.applyInTx(tx, bookingId, 'warrantyClaim', customerId, { reason });
      await tx.$executeRaw(Prisma.sql`UPDATE bookings SET failed_rework_count = 1 WHERE id = ${bookingId}::uuid`);
      return applied.booking;
    });
    await this.issueStartOtp(bookingId);
    return result;
  }

  /**
   * FR-PY-04 / UC-18: the provider says the customer paid them in cash. Only after verification has authorised the handover (VERIFIED or
   * AUTO_RELEASED) — the call comes before the cash changes hands. The platform's books catch up in the same transaction: the provider owes
   * the commission (wallet down; negative is debt), any coupon the platform absorbed is credited, and the offer block is re-evaluated.
   * The customer is then texted a receipt with a link to report a problem (FR-CP, source RECEIPT_LINK).
   */
  async confirmCashReceived(bookingId: string, providerId: string): Promise<BookingRow> {
    return this.prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<{ paymentMode: string; finalAmountPaisa: bigint | null; discountPaisa: bigint; commissionRateBp: number; providerId: string | null }[]>(
        Prisma.sql`SELECT payment_mode::text as "paymentMode", final_amount_paisa as "finalAmountPaisa", discount_paisa as "discountPaisa", commission_rate_bp as "commissionRateBp", provider_id as "providerId"
          FROM bookings WHERE id = ${bookingId}::uuid FOR UPDATE`
      );
      const row = rows[0];
      if (row === undefined || row.providerId !== providerId) throw notFound('Booking');
      if (row.paymentMode !== 'CASH') throw new DomainError('ILLEGAL_TRANSITION', 'Only a cash booking is settled by confirming cash was received');
      const applied = await this.state.applyInTx(tx, bookingId, 'confirmCashReceived', providerId);
      await this.release.settleCash(tx, { bookingId, providerId, finalPaisa: row.finalAmountPaisa ?? 0n, discountPaisa: row.discountPaisa, commissionRateBp: row.commissionRateBp, paymentMode: 'CASH' }, providerId);
      await appendOutboxEvent(tx, { aggregate: 'booking', aggregateId: bookingId, type: 'payment.receipt_due', payload: { bookingId } });
      const refreshed = await tx.$queryRaw<BookingRowRaw[]>(Prisma.sql`SELECT ${BOOKING_COLUMNS} FROM bookings WHERE id = ${bookingId}::uuid`);
      return refreshed[0] === undefined ? applied.booking : toBookingRow(refreshed[0]);
    });
  }

  /** Registers the coupon a booking was priced with, once the booking is real (cash created, or online captured). */
  async redeemCoupon(tx: Prisma.TransactionClient, bookingId: string, customerId: string): Promise<void> {
    await tx.$executeRaw(
      Prisma.sql`INSERT INTO coupon_redemptions(coupon_id, customer_id, booking_id, discount_paisa)
        SELECT coupon_id, ${customerId}::uuid, id, discount_paisa FROM bookings WHERE id = ${bookingId}::uuid AND coupon_id IS NOT NULL AND discount_paisa > 0
        ON CONFLICT (booking_id) DO NOTHING`
    );
  }

  /**
   * The common fault the customer picked, if any. Checked against the service being
   * booked rather than merely well-formed, so an option from another service cannot
   * be attached to this booking and later read back to a provider as the reported
   * fault. An inactive option is refused too: it has been retired, and a retired
   * option is not what anyone agreed to.
   */
  private async resolveIssueOption(serviceId: number, issueOptionId: number | undefined): Promise<number | null> {
    if (issueOptionId === undefined) return null;
    const rows = await this.prisma.$queryRaw<{ id: number }[]>(
      Prisma.sql`SELECT id FROM service_issue_options WHERE id = ${issueOptionId} AND service_id = ${serviceId} AND is_active = true`
    );
    if (rows[0] === undefined) throw notFound('Issue option');
    return rows[0].id;
  }

  /**
   * Same-day / next-hour booking: the shortest notice and the widest window the
   * platform accepts. Both thresholds are settings, and the identical rule is
   * applied by `SearchService.listSlots` when it offers start times — a listing
   * that offers a start time checkout would refuse is worse than no listing.
   */
  async refuseWindow(start: Date, end: Date): Promise<string | null> {
    return windowRefusal(this.clock.now(), start, end, {
      minNoticeMin: await this.settings.getNumber('booking.min_notice_min'),
      maxDaySpan: await this.settings.getNumber('booking.max_day_span')
    });
  }

  /**
   * FR-BK-02: the same availability/leave checks for a fresh booking and a reschedule.
   *
   * Availability is a wall-clock range inside *one* local day, so a window that
   * crosses local midnight is asked about one piece per local day: 22:30–00:30
   * needs the provider free until close on the first day *and* from opening on the
   * next. Without the split, a provider who genuinely works late could never be
   * booked for a job that ends just after midnight.
   */
  private async assertWindowIsBookable(providerId: string, start: Date, end: Date, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx ?? this.prisma;
    const pieces = splitAtLocalMidnight(start, end);
    for (const piece of pieces) {
      const weekday = localWeekday(piece.start);
      const availability = await client.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT id FROM provider_availability WHERE provider_id = ${providerId}::uuid AND weekday = ${weekday}
          AND start_time <= ${localTimeOfDay(piece.start)}::time AND end_time >= ${localTimeOfDay(piece.end)}::time`
      );
      if (availability.length === 0) throw badRequest("The requested time falls outside the provider's declared availability");
    }
    const timeOff = await client.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT id FROM provider_time_off WHERE provider_id = ${providerId}::uuid AND period && tstzrange(${start.toISOString()}::timestamptz, ${end.toISOString()}::timestamptz, '[)')`
    );
    if (timeOff.length > 0) throw badRequest('The provider has recorded leave over part of this window');
  }

  /** Delegates to `BookingStateService`, the sole writer of `bookings.status` for actor-driven events. */
  async apply(bookingId: string, event: BookingEvent, actorUserId: string, options: { reason?: string; noShowParty?: 'CUSTOMER' | 'PROVIDER' } = {}): Promise<BookingRow> {
    return this.state.apply(bookingId, event, actorUserId, options);
  }

  /**
   * FR-EX-02: called right after a successful `apply(id, 'accept', ...)`,
   * kept separate rather than folded into `apply()` itself — issuing a code
   * and sending it are a different responsibility from writing the status
   * transition, and every other event `apply()` handles has nothing to do
   * with OTPs at all. Overwrites any code issued by an earlier call (there
   * is only ever one "current" start code per booking), which also covers
   * re-sending if the customer says they never got the SMS.
   */
  async issueStartOtp(bookingId: string): Promise<void> {
    const rows = await this.prisma.$queryRaw<{ phone: string }[]>(
      Prisma.sql`SELECT u.phone_e164 as phone FROM bookings b JOIN users u ON u.id = b.customer_id WHERE b.id = ${bookingId}::uuid`
    );
    const row = rows[0];
    if (row === undefined) throw notFound('Booking');

    const code = generateOtpCode();
    const hash = hashStartOtp(this.environment.values.OTP_PEPPER, bookingId, code);
    await this.prisma.$executeRaw(
      Prisma.sql`UPDATE bookings SET start_otp_hash = ${hash}, start_otp_attempts = 0, start_otp_locked_until = NULL WHERE id = ${bookingId}::uuid`
    );
    await this.sms.send(row.phone, `Your Smart Home start code is ${code}. Give it to your provider when they arrive.`, { purpose: 'BOOKING_START' });
  }

  /**
   * FR-EX-02: work may only begin once the provider enters the code shown to
   * the customer. Locks after `START_OTP_MAX_ATTEMPTS` wrong tries for
   * `START_OTP_LOCK_MINUTES` — state lives on the booking row itself, not
   * Redis, since it's scoped to one booking rather than a user or IP.
   */
  async startWork(bookingId: string, actorUserId: string, input: { code: string; lat?: number | undefined; lng?: number | undefined; accuracyM?: number | undefined }): Promise<BookingRow & { checkin?: { distanceM: number; withinGeofence: boolean } }> {
    const code = input.code;
    // The attempts/lock bookkeeping below has to survive even when this call
    // ultimately reports failure — but a DomainError thrown from inside
    // `$transaction`'s callback rolls back everything written in it,
    // including that bookkeeping. So the callback never throws for an
    // expected wrong-code/locked outcome; it returns a result, and this
    // method throws afterwards, once the attempt has already been committed.
    const outcome = await this.prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<(BookingRowRaw & { startOtpHash: string | null; startOtpAttempts: number; startOtpLockedUntil: Date | null })[]>(
        Prisma.sql`SELECT ${BOOKING_COLUMNS}, start_otp_hash as "startOtpHash", start_otp_attempts as "startOtpAttempts", start_otp_locked_until as "startOtpLockedUntil"
          FROM bookings WHERE id = ${bookingId}::uuid FOR UPDATE`
      );
      const row = rows[0];
      if (row === undefined) throw notFound('Booking');
      if (row.providerId !== actorUserId) throw notFound('Booking');

      const transition = canTransition(row.status as BookingStatus, 'start', 'PROVIDER');
      if (transition === null) throw new DomainError('ILLEGAL_TRANSITION', `Cannot start a booking in status ${row.status}`);

      if (row.startOtpLockedUntil !== null && row.startOtpLockedUntil.getTime() > Date.now()) {
        return { ok: false as const, code: 'OTP_LOCKED' as const, detail: 'Too many incorrect attempts. Ask the customer for the code again shortly.' };
      }
      if (row.startOtpHash === null) return { ok: false as const, code: 'OTP_INVALID' as const, detail: 'No start code has been issued for this booking yet' };

      const expectedHash = hashStartOtp(this.environment.values.OTP_PEPPER, bookingId, code);
      if (!constantTimeEquals(row.startOtpHash, expectedHash)) {
        const attempts = row.startOtpAttempts + 1;
        const lockedUntil = attempts >= START_OTP_MAX_ATTEMPTS ? new Date(Date.now() + START_OTP_LOCK_MINUTES * 60_000) : null;
        await tx.$executeRaw(
          Prisma.sql`UPDATE bookings SET start_otp_attempts = ${attempts}, start_otp_locked_until = ${lockedUntil === null ? null : lockedUntil.toISOString()}::timestamptz WHERE id = ${bookingId}::uuid`
        );
        if (lockedUntil !== null) return { ok: false as const, code: 'OTP_LOCKED' as const, detail: `Too many incorrect attempts. Try again in ${START_OTP_LOCK_MINUTES} minutes.` };
        return { ok: false as const, code: 'OTP_INVALID' as const, detail: `The code is not correct. ${START_OTP_MAX_ATTEMPTS - attempts} attempt(s) remaining` };
      }

      await tx.$executeRaw(Prisma.sql`SET LOCAL app.transition_ctx = 'on'`);
      const updated = await tx.$queryRaw<BookingRowRaw[]>(
        // A rework visit is a new visit: visit_no moves on, so its checklist, photos and verification are separate records from the first.
        // eslint-disable-next-line no-restricted-syntax -- sanctioned writer: BookingService.start (FR-EX-02), transition_ctx set above
        Prisma.sql`UPDATE bookings SET status = 'IN_PROGRESS'::booking_status, start_otp_verified_at = now(), start_otp_attempts = 0, start_otp_locked_until = NULL,
            visit_no = CASE WHEN ${row.status} = 'REWORK_REQUIRED' THEN visit_no + 1 ELSE visit_no END
          WHERE id = ${bookingId}::uuid RETURNING ${BOOKING_COLUMNS}`
      );
      const next = updated[0];
      if (next === undefined) throw new Error('Booking update did not return a row');

      await tx.$executeRaw(
        Prisma.sql`INSERT INTO booking_status_history(booking_id, from_status, to_status, event, actor_user_id, actor_role, metadata)
          VALUES (${bookingId}::uuid, ${row.status}::booking_status, 'IN_PROGRESS'::booking_status, 'start', ${actorUserId}::uuid, 'PROVIDER'::actor_role, '{}'::jsonb)`
      );
      await appendOutboxEvent(tx, { aggregate: 'booking', aggregateId: bookingId, type: 'booking.start', payload: { bookingId, from: row.status, to: 'IN_PROGRESS' } });

      // FR-EX-09 / BR-09: where the provider says they are, against the customer's door. Flagged when outside the geofence, never blocking.
      const checkin = input.lat !== undefined && input.lng !== undefined ? await this.execution.recordCheckin(tx, bookingId, 'checkin', { lat: input.lat, lng: input.lng, accuracyM: input.accuracyM }) : undefined;
      return { ok: true as const, booking: toBookingRow(next), checkin };
    });

    if (!outcome.ok) throw new DomainError(outcome.code, outcome.detail);
    return { ...outcome.booking, ...(outcome.checkin === undefined ? {} : { checkin: outcome.checkin }) };
  }

  /**
   * FR-BK-05: one free reschedule, no fewer than `RESCHEDULE_NOTICE_HOURS`
   * before the *current* slot. Unlike every other event `apply()` handles,
   * `reschedule` doesn't just flip status (it's a same-status transition —
   * `SCHEDULED` → `SCHEDULED` in `BOOKING_TRANSITIONS`) — it moves the slot
   * itself, which needs the same availability/leave re-validation `create()`
   * does. That's different enough work that it gets its own method rather
   * than another branch inside `apply()`.
   */
  async reschedule(bookingId: string, actorUserId: string, input: BookingRescheduleInput): Promise<BookingRow> {
    const start = new Date(input.scheduledStart);
    const end = new Date(input.scheduledEnd);

    try {
      return await this.prisma.$transaction(async tx => {
        const rows = await tx.$queryRaw<BookingRowRaw[]>(Prisma.sql`SELECT ${BOOKING_COLUMNS} FROM bookings WHERE id = ${bookingId}::uuid FOR UPDATE`);
        const row = rows[0];
        if (row === undefined) throw notFound('Booking');
        if (row.customerId !== actorUserId) throw notFound('Booking');

        const transition = canTransition(row.status as BookingStatus, 'reschedule', 'CUSTOMER');
        if (transition === null) throw new DomainError('ILLEGAL_TRANSITION', `Cannot reschedule a booking in status ${row.status}`);

        if (row.rescheduleCount >= 1) throw badRequest('This booking has already been rescheduled once');

        const noticeCutoff = new Date(row.scheduledStart.getTime() - RESCHEDULE_NOTICE_HOURS * 60 * 60 * 1000);
        if (new Date() > noticeCutoff) throw badRequest(`A booking can only be rescheduled at least ${RESCHEDULE_NOTICE_HOURS} hours before its current slot`);

        const windowRefusalMessage = await this.refuseWindow(start, end);
        if (windowRefusalMessage !== null) throw badRequest(windowRefusalMessage);
        await this.assertWindowIsBookable(row.providerId as string, start, end, tx);

        // Status is unchanged (SCHEDULED -> SCHEDULED), so `trg_booking_status_guard`
        // never fires here — no `app.transition_ctx` needed for this update.
        const updated = await tx.$queryRaw<BookingRowRaw[]>(
          Prisma.sql`UPDATE bookings SET
              scheduled_start = ${start.toISOString()}::timestamptz,
              scheduled_end = ${end.toISOString()}::timestamptz,
              slot = ${this.slotRange(start, end, await this.settings.getNumber('booking.travel_buffer_min'))},
              reschedule_count = reschedule_count + 1
            WHERE id = ${bookingId}::uuid RETURNING ${BOOKING_COLUMNS}`
        );
        const next = updated[0];
        if (next === undefined) throw new Error('Booking update did not return a row');

        await tx.$executeRaw(
          Prisma.sql`INSERT INTO booking_status_history(booking_id, from_status, to_status, event, actor_user_id, actor_role, metadata)
            VALUES (${bookingId}::uuid, 'SCHEDULED'::booking_status, 'SCHEDULED'::booking_status, 'reschedule', ${actorUserId}::uuid, 'CUSTOMER'::actor_role,
              ${JSON.stringify({ previousStart: row.scheduledStart.toISOString(), previousEnd: row.scheduledEnd.toISOString() })}::jsonb)`
        );
        await appendOutboxEvent(tx, { aggregate: 'booking', aggregateId: bookingId, type: 'booking.reschedule', payload: { bookingId, previousStart: row.scheduledStart.toISOString(), newStart: start.toISOString() } });

        return toBookingRow(next);
      });
    } catch (error) {
      const meta = error instanceof Prisma.PrismaClientKnownRequestError ? (error.meta as { code?: unknown } | undefined) : undefined;
      if (meta?.code === EXCLUSION_VIOLATION) throw conflict('That provider is no longer free at this time');
      throw error;
    }
  }

  /**
   * FR-EX-05: extra work needs an in-app customer-approved revised quote
   * before it can be charged. Only one revision can ever be pending per
   * booking — `quote_revisions_one_pending`'s unique index is the real
   * guard; in practice a second `raiseQuoteRevision` can't happen anyway,
   * since the first one already moved the booking out of `IN_PROGRESS`.
   */
  async raiseQuoteRevision(bookingId: string, providerId: string, input: { deltaPaisa: number; reason: string }): Promise<BookingRow> {
    return this.prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<BookingRowRaw[]>(Prisma.sql`SELECT ${BOOKING_COLUMNS} FROM bookings WHERE id = ${bookingId}::uuid FOR UPDATE`);
      const row = rows[0];
      if (row === undefined) throw notFound('Booking');
      if (row.providerId !== providerId) throw notFound('Booking');

      const transition = canTransition(row.status as BookingStatus, 'raiseQuoteRevision', 'PROVIDER');
      if (transition === null) throw new DomainError('ILLEGAL_TRANSITION', `Cannot raise a quote revision on a booking in status ${row.status}`);

      await tx.$executeRaw(
        Prisma.sql`INSERT INTO quote_revisions(booking_id, reason, delta_paisa, raised_by) VALUES (${bookingId}::uuid, ${input.reason}, ${input.deltaPaisa}, ${providerId}::uuid)`
      );

      await tx.$executeRaw(Prisma.sql`SET LOCAL app.transition_ctx = 'on'`);
      const updated = await tx.$queryRaw<BookingRowRaw[]>(
        // eslint-disable-next-line no-restricted-syntax -- sanctioned writer: BookingService.raiseQuoteRevision (FR-EX-05), transition_ctx set above
        Prisma.sql`UPDATE bookings SET status = 'QUOTE_REVISION'::booking_status WHERE id = ${bookingId}::uuid RETURNING ${BOOKING_COLUMNS}`
      );
      const next = updated[0];
      if (next === undefined) throw new Error('Booking update did not return a row');

      await tx.$executeRaw(
        Prisma.sql`INSERT INTO booking_status_history(booking_id, from_status, to_status, event, actor_user_id, actor_role, reason, metadata)
          VALUES (${bookingId}::uuid, 'IN_PROGRESS'::booking_status, 'QUOTE_REVISION'::booking_status, 'raiseQuoteRevision', ${providerId}::uuid, 'PROVIDER'::actor_role, ${input.reason}, ${JSON.stringify({ deltaPaisa: input.deltaPaisa })}::jsonb)`
      );
      await appendOutboxEvent(tx, { aggregate: 'booking', aggregateId: bookingId, type: 'booking.raiseQuoteRevision', payload: { bookingId, deltaPaisa: input.deltaPaisa, reason: input.reason } });

      return toBookingRow(next);
    });
  }

  /**
   * FR-EX-05 / FR-EX-04: the customer approves the extra work. On a cash job that is immediate. On an online job
   * the extra amount must first be paid (a top-up payment, CL-11/CL-13): the revision stays pending, the booking
   * stays in QUOTE_REVISION, and the customer gets a payment redirect; the gateway's signed capture then approves
   * it — in the same transaction as the money landing in escrow, so approved ⇔ paid.
   */
  async approveQuoteRevision(bookingId: string, customerId: string): Promise<BookingRow & { payment?: { paymentId: string; redirectUrl: string } }> {
    const outcome = await this.prisma.$transaction(async tx => {
      const { row, revision } = await this.lockRevision(tx, bookingId, customerId, 'approveQuoteRevision');
      if (row.paymentMode === 'CASH') {
        const booking = await this.approveRevisionInTx(tx, row.id, revision.id, customerId);
        return { booking, paymentId: null };
      }
      let paymentId = revision.topupPaymentId;
      if (paymentId === null) {
        paymentId = await this.payments.createPayment(tx, { bookingId: row.id, payerUserId: customerId, amountPaisa: revision.deltaPaisa, purpose: 'TOPUP', keySuffix: revision.id });
        await tx.$executeRaw(Prisma.sql`UPDATE quote_revisions SET topup_payment_id = ${paymentId}::uuid WHERE id = ${revision.id}::uuid`);
      }
      return { booking: toBookingRow(row), paymentId };
    });
    if (outcome.paymentId === null) return outcome.booking;
    const payment = await this.payments.startCheckout(outcome.paymentId, { userId: customerId }, `/checkout/return?bookingId=${bookingId}`);
    return { ...outcome.booking, payment };
  }

  async rejectQuoteRevision(bookingId: string, customerId: string): Promise<BookingRow> {
    return this.prisma.$transaction(async tx => {
      const { row, revision } = await this.lockRevision(tx, bookingId, customerId, 'rejectQuoteRevision');
      await tx.$executeRaw(
        Prisma.sql`UPDATE quote_revisions SET status = 'REJECTED'::revision_status, decided_by = ${customerId}::uuid, decided_at = now() WHERE id = ${revision.id}::uuid`
      );
      // A top-up the customer had started but not paid is void now.
      if (revision.topupPaymentId !== null) {
        await tx.$executeRaw(Prisma.sql`UPDATE payments SET status = 'EXPIRED'::payment_status WHERE id = ${revision.topupPaymentId}::uuid AND status = 'INITIATED'`);
      }
      await tx.$executeRaw(Prisma.sql`SET LOCAL app.transition_ctx = 'on'`);
      // eslint-disable-next-line no-restricted-syntax -- sanctioned writer: BookingService.rejectQuoteRevision (FR-EX-05), transition_ctx set above
      const updated = await tx.$queryRaw<BookingRowRaw[]>(Prisma.sql`UPDATE bookings SET status = 'IN_PROGRESS'::booking_status WHERE id = ${bookingId}::uuid RETURNING ${BOOKING_COLUMNS}`);
      const next = updated[0];
      if (next === undefined) throw new Error('Booking update did not return a row');
      await tx.$executeRaw(
        Prisma.sql`INSERT INTO booking_status_history(booking_id, from_status, to_status, event, actor_user_id, actor_role, metadata)
          VALUES (${bookingId}::uuid, 'QUOTE_REVISION'::booking_status, 'IN_PROGRESS'::booking_status, 'rejectQuoteRevision', ${customerId}::uuid, 'CUSTOMER'::actor_role, ${JSON.stringify({ revisionId: revision.id })}::jsonb)`
      );
      await appendOutboxEvent(tx, { aggregate: 'booking', aggregateId: bookingId, type: 'booking.rejectQuoteRevision', payload: { revisionId: revision.id, bookingId } });

      // FR-EX-11: an inspection-first job whose extra work is refused ends here, at the visit fee.
      const services = await tx.$queryRaw<{ pricingModel: string }[]>(Prisma.sql`SELECT pricing_model as "pricingModel" FROM services WHERE id = ${row.serviceId}`);
      if (services[0]?.pricingModel === 'INSPECTION_FIRST') return this.completion.completeAtVisitFee(tx, bookingId);
      return toBookingRow(next);
    });
  }

  private async lockRevision(
    tx: Prisma.TransactionClient,
    bookingId: string,
    customerId: string,
    event: 'approveQuoteRevision' | 'rejectQuoteRevision'
  ): Promise<{ row: BookingRowRaw; revision: { id: string; deltaPaisa: bigint; reason: string; topupPaymentId: string | null } }> {
    const rows = await tx.$queryRaw<BookingRowRaw[]>(Prisma.sql`SELECT ${BOOKING_COLUMNS} FROM bookings WHERE id = ${bookingId}::uuid FOR UPDATE`);
    const row = rows[0];
    if (row === undefined || row.customerId !== customerId) throw notFound('Booking');
    if (canTransition(row.status as BookingStatus, event, 'CUSTOMER') === null) throw new DomainError('ILLEGAL_TRANSITION', `Cannot ${event} a booking in status ${row.status}`);
    const revisions = await tx.$queryRaw<{ id: string; deltaPaisa: bigint; reason: string; topupPaymentId: string | null }[]>(
      Prisma.sql`SELECT id, delta_paisa as "deltaPaisa", reason, topup_payment_id as "topupPaymentId" FROM quote_revisions WHERE booking_id = ${bookingId}::uuid AND status = 'PENDING' FOR UPDATE`
    );
    const revision = revisions[0];
    if (revision === undefined) throw new DomainError('INTERNAL_ERROR', 'Booking is in QUOTE_REVISION with no pending revision row — data integrity issue');
    return { row, revision };
  }

  /** Adds the revision's amount to the approved total and returns the booking to IN_PROGRESS. Shared by the cash path and the top-up capture. */
  async approveRevisionInTx(tx: Prisma.TransactionClient, bookingId: string, revisionId: string, customerId: string): Promise<BookingRow> {
    const revisions = await tx.$queryRaw<{ deltaPaisa: bigint; reason: string }[]>(Prisma.sql`SELECT delta_paisa as "deltaPaisa", reason FROM quote_revisions WHERE id = ${revisionId}::uuid AND status = 'PENDING' FOR UPDATE`);
    const revision = revisions[0];
    if (revision === undefined) throw new DomainError('ILLEGAL_TRANSITION', 'That revision is no longer pending');
    await tx.$executeRaw(Prisma.sql`UPDATE quote_revisions SET status = 'APPROVED'::revision_status, decided_by = ${customerId}::uuid, decided_at = now() WHERE id = ${revisionId}::uuid`);
    await tx.$executeRaw(Prisma.sql`SET LOCAL app.transition_ctx = 'on'`);
    const updated = await tx.$queryRaw<BookingRowRaw[]>(
      // eslint-disable-next-line no-restricted-syntax -- sanctioned writer: BookingService.approveRevisionInTx (FR-EX-05), transition_ctx set above
      Prisma.sql`UPDATE bookings SET status = 'IN_PROGRESS'::booking_status, approved_total_paisa = approved_total_paisa + ${revision.deltaPaisa} WHERE id = ${bookingId}::uuid RETURNING ${BOOKING_COLUMNS}`
    );
    const next = updated[0];
    if (next === undefined) throw new Error('Booking update did not return a row');
    await tx.$executeRaw(
      Prisma.sql`INSERT INTO booking_items(booking_id, revision_id, kind, description, quantity, unit_price_paisa, amount_paisa)
        VALUES (${bookingId}::uuid, ${revisionId}::uuid, 'EXTRA'::item_kind, ${revision.reason}, 1, ${revision.deltaPaisa}, ${revision.deltaPaisa})`
    );
    await tx.$executeRaw(
      Prisma.sql`INSERT INTO booking_status_history(booking_id, from_status, to_status, event, actor_user_id, actor_role, metadata)
        VALUES (${bookingId}::uuid, 'QUOTE_REVISION'::booking_status, 'IN_PROGRESS'::booking_status, 'approveQuoteRevision', ${customerId}::uuid, 'CUSTOMER'::actor_role, ${JSON.stringify({ revisionId })}::jsonb)`
    );
    await appendOutboxEvent(tx, { aggregate: 'booking', aggregateId: bookingId, type: 'booking.approveQuoteRevision', payload: { revisionId, bookingId } });
    return toBookingRow(next);
  }

  /**
   * Who will receive the provider when a booking was made for someone other than
   * the customer, or `null` when it was not.
   *
   * This is the only way a third party's phone number leaves the database. It is
   * masked for anyone who has not accepted the job, in full for the customer who
   * entered it and for the provider the job belongs to — see `on-behalf.ts`.
   */
  async onBehalfContact(bookingId: string, actorUserId: string): Promise<OnBehalfContact | null> {
    const rows = await this.prisma.$queryRaw<{ customerId: string; providerId: string | null; status: string; isOnBehalf: boolean; onBehalfName: string | null; onBehalfPhoneE164: string | null }[]>(
      Prisma.sql`SELECT customer_id as "customerId", provider_id as "providerId", status, is_on_behalf as "isOnBehalf",
          on_behalf_name as "onBehalfName", on_behalf_phone_e164 as "onBehalfPhoneE164"
        FROM bookings WHERE id = ${bookingId}::uuid AND (customer_id = ${actorUserId}::uuid OR provider_id = ${actorUserId}::uuid)`
    );
    const row = rows[0];
    if (row === undefined) throw notFound('Booking');
    if (!row.isOnBehalf || row.onBehalfName === null || row.onBehalfPhoneE164 === null) return null;
    const revealed = maySeeFullContact(
      { userId: actorUserId, isCustomer: row.customerId === actorUserId, isProvider: row.providerId === actorUserId },
      row
    );
    return contactFor({ name: row.onBehalfName, phone: row.onBehalfPhoneE164 }, revealed);
  }

  async getOwned(bookingId: string, actorUserId: string): Promise<BookingRow> {
    const rows = await this.prisma.$queryRaw<BookingRowRaw[]>(
      Prisma.sql`SELECT ${BOOKING_COLUMNS} FROM bookings WHERE id = ${bookingId}::uuid AND (customer_id = ${actorUserId}::uuid OR provider_id = ${actorUserId}::uuid)`
    );
    const row = rows[0];
    if (row === undefined) throw notFound('Booking');
    return toBookingRow(row);
  }

  async listMine(actorUserId: string, status?: string): Promise<BookingRow[]> {
    const rows = await this.prisma.$queryRaw<BookingRowRaw[]>(
      Prisma.sql`SELECT ${BOOKING_COLUMNS} FROM bookings
        WHERE (customer_id = ${actorUserId}::uuid OR provider_id = ${actorUserId}::uuid)
          AND (${status ?? null}::booking_status IS NULL OR status = ${status ?? null}::booking_status)
        ORDER BY created_at DESC`
    );
    return rows.map(toBookingRow);
  }

  /** Provider-scoped rate wins, then category-scoped, then the platform GLOBAL default (always seeded). */
  private async resolveCommissionRateBp(providerId: string | null, categoryId: number): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ rateBp: number; scope: string }[]>(
      Prisma.sql`SELECT rate_bp as "rateBp", scope FROM commission_rules
        WHERE effective_from <= now() AND (effective_to IS NULL OR effective_to > now())
          AND ((scope = 'PROVIDER' AND provider_id = ${providerId}::uuid AND ${providerId}::uuid IS NOT NULL) OR (scope = 'CATEGORY' AND category_id = ${categoryId}) OR scope = 'GLOBAL')
        ORDER BY CASE scope WHEN 'PROVIDER' THEN 0 WHEN 'CATEGORY' THEN 1 ELSE 2 END
        LIMIT 1`
    );
    const rate = rows[0];
    if (rate === undefined) throw new Error('No commission rule resolved — expected at least a GLOBAL default to be seeded');
    return rate.rateBp;
  }
}
