// apps/api/src/booking/booking-state.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { canTransition, type BookingActorRole, type BookingEvent, type BookingStatus } from '@smart-home/domain';
import { DomainError, notFound } from '../common/domain-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { ConductService } from '../conduct/conduct.service.js';
import { LedgerService } from '../payment/ledger.service.js';
import { PaymentsService } from '../payment/payments.service.js';
import { appendOutboxEvent } from '../platform/audit.service.js';
import { AppClock } from '../platform/app-clock.js';
import { SettingsService } from '../platform/settings.service.js';
import { BOOKING_COLUMNS, toBookingRow, type BookingRow, type BookingRowRaw } from './booking.row.js';

export type ApplyOptions = { reason?: string; noShowParty?: 'CUSTOMER' | 'PROVIDER' };

export type ApplyResult = { booking: BookingRow; refundIds: string[] };

/**
 * The sole writer of `bookings.status` for actor-driven events (TRD §5.2); the
 * platform's own events go through `applySystemEvent`. The
 * `bookings_status_guard` trigger rejects any status change made without
 * `app.transition_ctx = 'on'` set inside the same transaction, so every other
 * write path is refused by the database, not just by convention.
 *
 * Money follows status here on purpose: cancelling or declining a paid booking
 * and queueing its refund happen in one transaction, so a booking can never be
 * cancelled without its refund being booked, nor refunded without being cancelled.
 */
@Injectable()
export class BookingStateService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PaymentsService) private readonly payments: PaymentsService,
    @Inject(LedgerService) private readonly ledger: LedgerService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(AppClock) private readonly clock: AppClock,
    @Inject(ConductService) private readonly conduct: ConductService
  ) {}

  async apply(bookingId: string, event: BookingEvent, actorUserId: string, options: ApplyOptions = {}): Promise<BookingRow> {
    const result = await this.prisma.$transaction(tx => this.applyInTx(tx, bookingId, event, actorUserId, options));
    await this.settleRefunds(result.refundIds);
    return result.booking;
  }

  /** Tells the gateway about refunds queued inside a committed transaction. A gateway hiccup leaves the refund PENDING for a retry; it never undoes the booking. */
  async settleRefunds(refundIds: readonly string[]): Promise<void> {
    for (const id of refundIds) {
      try {
        await this.payments.settleRefund(id);
      } catch {
        // Left PENDING; the refund row and ledger posting are already durable, and settleRefund is idempotent.
      }
    }
  }

  async applyInTx(tx: Prisma.TransactionClient, bookingId: string, event: BookingEvent, actorUserId: string, options: ApplyOptions = {}): Promise<ApplyResult> {
    const rows = await tx.$queryRaw<BookingRowRaw[]>(Prisma.sql`SELECT ${BOOKING_COLUMNS} FROM bookings WHERE id = ${bookingId}::uuid FOR UPDATE`);
    const row = rows[0];
    if (row === undefined) throw notFound('Booking');

    const actorRole: BookingActorRole | undefined = row.customerId === actorUserId ? 'CUSTOMER' : row.providerId === actorUserId ? 'PROVIDER' : undefined;
    if (actorRole === undefined) throw notFound('Booking');

    const transition = canTransition(row.status as BookingStatus, event, actorRole);
    if (transition === null) throw new DomainError('ILLEGAL_TRANSITION', `Cannot ${event} a booking in status ${row.status}`);

    // Checked before the status is written, so a refused report leaves no history row
    // and no half-applied change behind.
    if (event === 'noShow') await this.assertNoShowIsReportable(row);

    // `cancel`'s target depends on which role fired it — see the comment on
    // BOOKING_TRANSITIONS in @smart-home/domain for why the table can't encode this.
    const to = event === 'cancel' ? (actorRole === 'CUSTOMER' ? 'CANCELLED_CUSTOMER' : 'CANCELLED_PROVIDER') : transition.to;

    await tx.$executeRaw(Prisma.sql`SET LOCAL app.transition_ctx = 'on'`);
    const updated = await tx.$queryRaw<BookingRowRaw[]>(
      // eslint-disable-next-line no-restricted-syntax -- sanctioned writer: BookingStateService.apply, transition_ctx set above
      Prisma.sql`UPDATE bookings SET status = ${to}::booking_status,
        cancel_reason = COALESCE(${options.reason ?? null}, cancel_reason),
        no_show_party = COALESCE(${options.noShowParty ?? null}::no_show_party, no_show_party)
        WHERE id = ${bookingId}::uuid RETURNING ${BOOKING_COLUMNS}`
    );
    const next = updated[0];
    if (next === undefined) throw new Error('Booking update did not return a row');

    const money = await this.moneyFor(tx, row, event, actorRole, actorUserId, options);

    await tx.$executeRaw(
      Prisma.sql`INSERT INTO booking_status_history(booking_id, from_status, to_status, event, actor_user_id, actor_role, reason, metadata)
        VALUES (${bookingId}::uuid, ${row.status}::booking_status, ${to}::booking_status, ${event}, ${actorUserId}::uuid, ${actorRole}::actor_role, ${options.reason ?? null}, ${JSON.stringify({ ...options, ...money.metadata })}::jsonb)`
    );
    await this.syncOffers(tx, row, event, actorUserId);
    await this.proposeBreach(tx, row, event, actorRole, options);
    await appendOutboxEvent(tx, { aggregate: 'booking', aggregateId: bookingId, type: `booking.${event}`, payload: { bookingId, from: row.status, to, event, actorUserId, actorRole } });

    const refreshed = await tx.$queryRaw<BookingRowRaw[]>(Prisma.sql`SELECT ${BOOKING_COLUMNS} FROM bookings WHERE id = ${bookingId}::uuid`);
    return { booking: toBookingRow(refreshed[0] ?? next), refundIds: money.refundIds };
  }

  /**
   * FR-BK-06 / FR-PY-11 / CL-21: what a status change costs, or refunds.
   *
   * - Customer cancels before a provider accepted, or a provider cancels/declines: no fee, the customer is made whole.
   * - Customer cancels a SCHEDULED job at least `booking.free_cancel_hours` ahead: free.
   * - Customer cancels inside that window: `booking.late_cancel_fee_paisa` (never more than the booking total).
   *   Online: taken out of escrow to PLATFORM_COMMISSION and the rest refunded. Cash: booked as a receivable
   *   against the customer, shown on their next quote.
   */
  private async moneyFor(
    tx: Prisma.TransactionClient,
    row: BookingRowRaw,
    event: BookingEvent,
    actorRole: BookingActorRole,
    actorUserId: string,
    options: ApplyOptions
  ): Promise<{ refundIds: string[]; metadata: Record<string, unknown> }> {
    const refundIds: string[] = [];
    const metadata: Record<string, unknown> = {};
    const online = row.paymentMode === 'ONLINE';

    if (event === 'decline' || (event === 'cancel' && actorRole === 'PROVIDER')) {
      if (online) {
        const queued = await this.payments.queueRefund(tx, { bookingId: row.id, amountPaisa: row.approvedTotalPaisa, reasonCode: event === 'decline' ? 'PROVIDER_DECLINED' : 'PROVIDER_CANCELLED', idempotencyKey: `booking:${row.id}:${event}`, requestedBy: actorUserId });
        refundIds.push(...queued);
      }
      return { refundIds, metadata };
    }

    if (event !== 'cancel' && event !== 'noShow') return { refundIds, metadata };
    if (event === 'noShow') return this.refundForNoShow(tx, row, actorUserId);

    if (row.status === 'PENDING_PAYMENT') {
      // Nothing has been captured; release the hold and let a late capture be refused.
      await tx.$executeRaw(Prisma.sql`UPDATE payments SET status = 'EXPIRED'::payment_status WHERE booking_id = ${row.id}::uuid AND purpose = 'BOOKING' AND status = 'INITIATED'`);
      await tx.$executeRaw(Prisma.sql`UPDATE bookings SET payment_status = 'NONE'::booking_payment_status WHERE id = ${row.id}::uuid`);
      return { refundIds, metadata };
    }

    const freeHours = await this.settings.getNumber('booking.free_cancel_hours');
    const hoursAhead = (row.scheduledStart.getTime() - Date.now()) / 3_600_000;
    const late = row.status === 'SCHEDULED' && hoursAhead < freeHours;
    let feePaisa = 0n;
    if (late) {
      const configured = BigInt(await this.settings.getNumber('booking.late_cancel_fee_paisa'));
      feePaisa = configured > row.approvedTotalPaisa ? row.approvedTotalPaisa : configured;
    }
    metadata.lateCancel = late;
    metadata.feePaisa = feePaisa.toString();

    if (online) {
      if (feePaisa > 0n) {
        await this.ledger.post(tx, {
          type: 'CANCEL_FEE',
          bookingId: row.id,
          idempotencyKey: `cancel-fee:${row.id}`,
          memo: 'Late-cancel fee taken from escrow',
          createdBy: actorUserId,
          lines: [
            { account: 'ESCROW', direction: 'DEBIT', amountPaisa: feePaisa, bookingId: row.id },
            { account: 'PLATFORM_COMMISSION', direction: 'CREDIT', amountPaisa: feePaisa }
          ]
        });
      }
      const refundable = row.approvedTotalPaisa - feePaisa;
      if (refundable > 0n) {
        const queued = await this.payments.queueRefund(tx, { bookingId: row.id, amountPaisa: refundable, reasonCode: late ? 'CUSTOMER_LATE_CANCEL' : 'CUSTOMER_CANCELLED', idempotencyKey: `booking:${row.id}:cancel`, requestedBy: actorUserId });
        refundIds.push(...queued);
      }
    } else if (feePaisa > 0n) {
      await this.ledger.post(tx, {
        type: 'CANCEL_FEE',
        bookingId: row.id,
        idempotencyKey: `cancel-fee:${row.id}`,
        memo: 'Late-cancel fee on a cash booking, owed by the customer',
        createdBy: actorUserId,
        lines: [
          { account: 'CUSTOMER_RECEIVABLE', direction: 'DEBIT', amountPaisa: feePaisa, ownerUserId: row.customerId },
          { account: 'PLATFORM_COMMISSION', direction: 'CREDIT', amountPaisa: feePaisa }
        ]
      });
    }
    void options;
    return { refundIds, metadata };
  }

  /**
   * SRS §7.4: a no-show is settled as "full refund + fixed penalty".
   *
   * Whichever party failed to show, the customer did not receive the service, so the
   * full captured amount goes back. Without this an online no-show left the whole
   * amount sitting in escrow with no transition, endpoint or sweep able to move it --
   * `NO_SHOW` is terminal, so that money was stranded permanently and the nightly
   * reconciliation could not see it, because it only flags escrow on statuses it
   * considers finished.
   *
   * The penalty side is the conduct path (`proposeBreach`), not a ledger posting: the
   * fixed fine is only proposed, never applied, because applying one is a human
   * decision. A cash booking has nothing captured, so there is nothing to return.
   */
  private async refundForNoShow(tx: Prisma.TransactionClient, row: BookingRowRaw, actorUserId: string): Promise<{ refundIds: string[]; metadata: Record<string, unknown> }> {
    if (row.paymentMode !== 'ONLINE' || row.approvedTotalPaisa <= 0n) return { refundIds: [], metadata: { noShowRefundPaisa: '0' } };
    const queued = await this.payments.queueRefund(tx, {
      bookingId: row.id,
      amountPaisa: row.approvedTotalPaisa,
      reasonCode: 'NO_SHOW',
      idempotencyKey: `booking:${row.id}:no-show`,
      requestedBy: actorUserId
    });
    return { refundIds: queued, metadata: { noShowRefundPaisa: row.approvedTotalPaisa.toString() } };
  }

  /**
   * BR-04 / SRS T13: a no-show can only be reported once the grace window after the
   * slot start has passed. `booking.no_show_grace_min` existed in the seed the whole
   * time with no reader, so either party could report a no-show the instant the
   * provider tapped *depart* -- and a provider-only report triggers an automatic
   * penalty proposal worth demerit points and a fine, which is not something to raise
   * off a race with the traffic.
   */
  private async assertNoShowIsReportable(row: BookingRowRaw): Promise<void> {
    const graceMin = await this.settings.getNumber('booking.no_show_grace_min');
    const earliestReportAt = row.scheduledStart.getTime() + graceMin * 60_000;
    if (this.clock.now().getTime() < earliestReportAt) {
      throw new DomainError('BAD_REQUEST', `A no-show can only be reported ${graceMin} minutes after the visit was due to start`);
    }
  }

  /** SHM-080: a provider no-show, or a provider cancelling inside the free-cancel window, is a breach on the schedule. Proposed, never applied. */
  private async proposeBreach(tx: Prisma.TransactionClient, row: BookingRowRaw, event: BookingEvent, actorRole: BookingActorRole, options: ApplyOptions): Promise<void> {
    if (row.providerId === null) return;
    if (event === 'noShow' && options.noShowParty === 'PROVIDER') {
      await this.conduct.autoPropose(tx, { providerId: row.providerId, breachCode: 'NO_SHOW', bookingId: row.id, evidence: { reportedBy: actorRole, bookingCode: row.code } });
    }
    if (event === 'cancel' && actorRole === 'PROVIDER') {
      const freeHours = await this.settings.getNumber('booking.free_cancel_hours');
      const hoursAhead = (row.scheduledStart.getTime() - Date.now()) / 3_600_000;
      if (hoursAhead < freeHours) {
        await this.conduct.autoPropose(tx, { providerId: row.providerId, breachCode: 'LATE_CANCEL', bookingId: row.id, evidence: { hoursBeforeSlot: Math.max(0, Math.round(hoursAhead * 10) / 10), bookingCode: row.code } });
      }
    }
  }

  /** Keeps `booking_offers` truthful when a provider answers through the booking endpoints instead of the offer ones. */
  private async syncOffers(tx: Prisma.TransactionClient, row: BookingRowRaw, event: BookingEvent, actorUserId: string): Promise<void> {
    if (event !== 'accept' && event !== 'decline') return;
    await tx.$executeRaw(
      Prisma.sql`UPDATE booking_offers SET status = ${event === 'accept' ? 'ACCEPTED' : 'DECLINED'}::offer_status, responded_at = now()
        WHERE booking_id = ${row.id}::uuid AND provider_id = ${actorUserId}::uuid AND status = 'PENDING'`
    );
  }
}
