// apps/api/src/booking/offer.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DomainError, notFound } from '../common/domain-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { PaymentsService } from '../payment/payments.service.js';
import { SettingsService } from '../platform/settings.service.js';
import { appendOutboxEvent } from '../platform/audit.service.js';
import { applySystemEvent } from './booking-state.js';
import { BookingStateService } from './booking-state.service.js';
import { toBookingRow, BOOKING_COLUMNS, type BookingRow, type BookingRowRaw } from './booking.row.js';
import { localTimeOfDay, localWeekday } from './slot-time.js';

const EXCLUSION_VIOLATION = '23P01';

export type ProviderOffer = {
  id: string;
  bookingId: string;
  bookingCode: string;
  serviceName: string;
  areaName: string;
  scheduledStart: Date;
  scheduledEnd: Date;
  quotedAmountPaisa: number;
  isEmergency: boolean;
  problemText: string | null;
  expiresAt: Date;
};

type OfferContext = { refundIds: string[] };

/**
 * FR-SP-09 / FR-SR-07 / FR-BK-10 / CL-05: how a REQUESTED booking finds its provider.
 *
 * A booking aimed at one provider gets a single offer to them; an auto-assign
 * booking is offered to ranked candidates one at a time (`booking_offers` allows
 * only one PENDING offer per booking, in the database). Silence is an answer: an
 * offer past its deadline is forfeited by `expireDue()` and the next candidate
 * is tried. When candidates, the offer count (`booking.max_offers`) or the
 * total window (`booking.max_offer_window_min`) run out, the booking goes
 * UNFULFILLED and any captured payment is refunded — exactly once, keyed on the booking.
 */
@Injectable()
export class OfferService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(PaymentsService) private readonly payments: PaymentsService,
    @Inject(BookingStateService) private readonly state: BookingStateService
  ) {}

  /** Starts the offer cascade for a booking that has just become REQUESTED. Runs inside the transaction that made it so. */
  async open(tx: Prisma.TransactionClient, bookingId: string): Promise<void> {
    const rows = await tx.$queryRaw<{ providerId: string | null }[]>(Prisma.sql`SELECT provider_id as "providerId" FROM bookings WHERE id = ${bookingId}::uuid`);
    const booking = rows[0];
    if (booking === undefined) throw notFound('Booking');
    if (booking.providerId !== null) {
      const timeoutMin = await this.settings.getNumber('booking.offer_timeout_min');
      await tx.$executeRaw(
        Prisma.sql`INSERT INTO booking_offers(booking_id, provider_id, rank, expires_at) VALUES (${bookingId}::uuid, ${booking.providerId}::uuid, 1, now() + make_interval(mins => ${timeoutMin}::int))`
      );
      await appendOutboxEvent(tx, { aggregate: 'booking', aggregateId: bookingId, type: 'booking.offer_created', payload: { bookingId, providerId: booking.providerId } });
      return;
    }
    await this.offerNext(tx, bookingId, { refundIds: [] });
  }

  async listForProvider(providerId: string): Promise<ProviderOffer[]> {
    const rows = await this.prisma.$queryRaw<(Omit<ProviderOffer, 'quotedAmountPaisa'> & { quotedAmountPaisa: bigint })[]>(
      Prisma.sql`SELECT o.id, b.id as "bookingId", b.code as "bookingCode", s.name_en as "serviceName", a.name as "areaName", b.scheduled_start as "scheduledStart",
          b.scheduled_end as "scheduledEnd", b.quoted_amount_paisa as "quotedAmountPaisa", b.is_emergency as "isEmergency", b.problem_text as "problemText", o.expires_at as "expiresAt"
        FROM booking_offers o JOIN bookings b ON b.id = o.booking_id JOIN services s ON s.id = b.service_id
          JOIN addresses ad ON ad.id = b.address_id JOIN areas a ON a.id = ad.area_id
        WHERE o.provider_id = ${providerId}::uuid AND o.status = 'PENDING' AND o.expires_at > now() AND b.status = 'REQUESTED'
          AND NOT EXISTS (SELECT 1 FROM providers blocked WHERE blocked.user_id = o.provider_id AND blocked.offer_blocked_reason IS NOT NULL)
        ORDER BY o.expires_at`
    );
    return rows.map(row => ({ ...row, quotedAmountPaisa: Number(row.quotedAmountPaisa) }));
  }

  /** The provider says yes. Returns the booking, now SCHEDULED to them; the caller issues the start code. */
  async accept(offerId: string, providerId: string): Promise<BookingRow> {
    try {
      return await this.prisma.$transaction(async tx => {
        const offer = await this.lockPendingOffer(tx, offerId, providerId);
        const bookings = await tx.$queryRaw<BookingRowRaw[]>(Prisma.sql`SELECT ${BOOKING_COLUMNS} FROM bookings WHERE id = ${offer.bookingId}::uuid FOR UPDATE`);
        const booking = bookings[0];
        if (booking === undefined) throw notFound('Booking');
        if (booking.status !== 'REQUESTED') throw new DomainError('ILLEGAL_TRANSITION', `This request is no longer open (${booking.status})`);
        if (booking.providerId === null) {
          // Auto-assign: the winning provider is fixed only now. The exclusion constraint on (provider, slot) is the final arbiter of a clash.
          await tx.$executeRaw(Prisma.sql`UPDATE bookings SET provider_id = ${providerId}::uuid WHERE id = ${offer.bookingId}::uuid`);
        }
        const { booking: accepted } = await this.state.applyInTx(tx, offer.bookingId, 'accept', providerId);
        return accepted;
      });
    } catch (error) {
      const meta = error instanceof Prisma.PrismaClientKnownRequestError ? (error.meta as { code?: unknown } | undefined) : undefined;
      if (meta?.code === EXCLUSION_VIOLATION) throw new DomainError('SLOT_TAKEN', 'You are no longer free at this time');
      throw error;
    }
  }

  /** The provider says no. An auto-assign booking moves on to the next candidate; a direct request has nobody else to ask and is UNFULFILLED. */
  async decline(offerId: string, providerId: string): Promise<BookingRow> {
    const context: OfferContext = { refundIds: [] };
    const booking = await this.prisma.$transaction(async tx => {
      const offer = await this.lockPendingOffer(tx, offerId, providerId);
      const rows = await tx.$queryRaw<{ isAutoAssign: boolean }[]>(Prisma.sql`SELECT is_auto_assign as "isAutoAssign" FROM bookings WHERE id = ${offer.bookingId}::uuid FOR UPDATE`);
      if (rows[0] === undefined) throw notFound('Booking');
      if (rows[0].isAutoAssign) {
        await tx.$executeRaw(Prisma.sql`UPDATE booking_offers SET status = 'DECLINED'::offer_status, responded_at = now() WHERE id = ${offerId}::uuid`);
        await this.offerNext(tx, offer.bookingId, context);
        const current = await tx.$queryRaw<BookingRowRaw[]>(Prisma.sql`SELECT ${BOOKING_COLUMNS} FROM bookings WHERE id = ${offer.bookingId}::uuid`);
        return toBookingRow(current[0] as BookingRowRaw);
      }
      const result = await this.state.applyInTx(tx, offer.bookingId, 'decline', providerId);
      context.refundIds.push(...result.refundIds);
      return result.booking;
    });
    await this.state.settleRefunds(context.refundIds);
    return booking;
  }

  /** Forfeits every offer whose deadline passed and moves each booking on. Safe to run from several workers at once. */
  async expireDue(): Promise<number> {
    const due = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM booking_offers WHERE status = 'PENDING' AND expires_at <= now()`);
    const context: OfferContext = { refundIds: [] };
    let expired = 0;
    for (const { id } of due) {
      await this.prisma.$transaction(async tx => {
        const rows = await tx.$queryRaw<{ id: string; bookingId: string; status: string }[]>(
          Prisma.sql`SELECT id, booking_id as "bookingId", status FROM booking_offers WHERE id = ${id}::uuid FOR UPDATE SKIP LOCKED`
        );
        const offer = rows[0];
        if (offer === undefined || offer.status !== 'PENDING') return;
        await tx.$executeRaw(Prisma.sql`UPDATE booking_offers SET status = 'EXPIRED'::offer_status, responded_at = now() WHERE id = ${id}::uuid`);
        expired += 1;
        const bookings = await tx.$queryRaw<{ status: string; isAutoAssign: boolean }[]>(
          Prisma.sql`SELECT status, is_auto_assign as "isAutoAssign" FROM bookings WHERE id = ${offer.bookingId}::uuid FOR UPDATE`
        );
        const booking = bookings[0];
        if (booking === undefined || booking.status !== 'REQUESTED') return;
        if (booking.isAutoAssign) await this.offerNext(tx, offer.bookingId, context);
        else await this.exhaust(tx, offer.bookingId, context);
      });
    }
    await this.state.settleRefunds(context.refundIds);
    return expired;
  }

  private async lockPendingOffer(tx: Prisma.TransactionClient, offerId: string, providerId: string): Promise<{ bookingId: string }> {
    const rows = await tx.$queryRaw<{ bookingId: string; status: string; expired: boolean }[]>(
      Prisma.sql`SELECT booking_id as "bookingId", status, expires_at <= now() as expired FROM booking_offers WHERE id = ${offerId}::uuid AND provider_id = ${providerId}::uuid FOR UPDATE`
    );
    const offer = rows[0];
    if (offer === undefined) throw notFound('Offer');
    if (offer.status !== 'PENDING') throw new DomainError('ILLEGAL_TRANSITION', `This offer is already ${offer.status.toLowerCase()}`);
    // A late answer is refused rather than honoured: the deadline is the rule, and expireDue() has (or will) move the booking on.
    if (offer.expired) throw new DomainError('ILLEGAL_TRANSITION', 'This offer has expired');
    return { bookingId: offer.bookingId };
  }

  /** Offers the next-best free provider, or ends the search. */
  private async offerNext(tx: Prisma.TransactionClient, bookingId: string, context: OfferContext): Promise<void> {
    const bookings = await tx.$queryRaw<
      { serviceId: number; addressId: string; scheduledStart: Date; scheduledEnd: Date; slotAgeMin: number; offered: bigint }[]
    >(
      Prisma.sql`SELECT b.service_id as "serviceId", b.address_id as "addressId", b.scheduled_start as "scheduledStart", b.scheduled_end as "scheduledEnd",
          EXTRACT(EPOCH FROM (now() - b.created_at)) / 60 as "slotAgeMin", (SELECT count(*) FROM booking_offers o WHERE o.booking_id = b.id) as offered
        FROM bookings b WHERE b.id = ${bookingId}::uuid`
    );
    const booking = bookings[0];
    if (booking === undefined) throw notFound('Booking');

    const maxOffers = await this.settings.getNumber('booking.max_offers');
    const windowMin = await this.settings.getNumber('booking.max_offer_window_min');
    if (Number(booking.offered) >= maxOffers || Number(booking.slotAgeMin) >= windowMin) return this.exhaust(tx, bookingId, context);

    const weekday = localWeekday(booking.scheduledStart);
    const candidates = await tx.$queryRaw<{ providerId: string }[]>(
      Prisma.sql`SELECT p.user_id as "providerId"
        FROM providers p
        JOIN provider_services ps ON ps.provider_id = p.user_id AND ps.service_id = ${booking.serviceId} AND ps.status = 'APPROVED'
        JOIN addresses ad ON ad.id = ${booking.addressId}::uuid
        WHERE p.status = 'APPROVED' AND p.offer_blocked_reason IS NULL AND p.base_location IS NOT NULL AND ST_DWithin(p.base_location, ad.location, p.radius_m)
          AND NOT EXISTS (SELECT 1 FROM booking_offers o WHERE o.booking_id = ${bookingId}::uuid AND o.provider_id = p.user_id)
          AND EXISTS (SELECT 1 FROM provider_availability av WHERE av.provider_id = p.user_id AND av.weekday = ${weekday}
                        AND av.start_time <= ${localTimeOfDay(booking.scheduledStart)}::time AND av.end_time >= ${localTimeOfDay(booking.scheduledEnd)}::time)
          AND NOT EXISTS (SELECT 1 FROM provider_time_off t WHERE t.provider_id = p.user_id AND t.period && tstzrange(${booking.scheduledStart.toISOString()}::timestamptz, ${booking.scheduledEnd.toISOString()}::timestamptz, '[)'))
          AND NOT EXISTS (SELECT 1 FROM bookings x WHERE x.provider_id = p.user_id AND x.slot && (SELECT slot FROM bookings WHERE id = ${bookingId}::uuid)
                            AND x.status IN ('PENDING_PAYMENT','REQUESTED','ACCEPTED','SCHEDULED','EN_ROUTE','IN_PROGRESS','QUOTE_REVISION'))
        ORDER BY ST_Distance(p.base_location, ad.location) ASC, p.user_id
        LIMIT 1`
    );
    const next = candidates[0];
    if (next === undefined) return this.exhaust(tx, bookingId, context);

    const timeoutMin = await this.settings.getNumber('booking.offer_timeout_min');
    await tx.$executeRaw(
      Prisma.sql`INSERT INTO booking_offers(booking_id, provider_id, rank, expires_at) VALUES (${bookingId}::uuid, ${next.providerId}::uuid, ${Number(booking.offered) + 1}, now() + make_interval(mins => ${timeoutMin}::int))`
    );
    await appendOutboxEvent(tx, { aggregate: 'booking', aggregateId: bookingId, type: 'booking.offer_created', payload: { bookingId, providerId: next.providerId } });
  }

  /** Nobody took it. UNFULFILLED, and the customer gets any captured money back — once, whichever path reached here first. */
  private async exhaust(tx: Prisma.TransactionClient, bookingId: string, context: OfferContext): Promise<void> {
    const moved = await applySystemEvent(tx, bookingId, 'exhaustOffers', { reason: 'no provider accepted in time' });
    if (moved === null) return;
    await tx.$executeRaw(Prisma.sql`UPDATE booking_offers SET status = 'CANCELLED'::offer_status, responded_at = now() WHERE booking_id = ${bookingId}::uuid AND status = 'PENDING'`);
    if (moved.paymentMode === 'ONLINE') {
      const queued = await this.payments.queueRefund(tx, { bookingId, amountPaisa: moved.approvedTotalPaisa, reasonCode: 'UNFULFILLED', idempotencyKey: `booking:${bookingId}:unfulfilled` });
      context.refundIds.push(...queued);
    }
  }
}
