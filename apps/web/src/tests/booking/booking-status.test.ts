import { describe, expect, it } from 'vitest';
import {
  RESCHEDULE_NOTICE_HOURS,
  bookingTotalPaisa,
  canCancel,
  canMessage,
  canReschedule,
  hasPendingRevision,
  isAwaitingProvider,
  isClosedBooking,
  isHeldPayment,
  isLiveBooking,
  isUpcomingBooking,
  rescheduleBlockReason
} from '@/features/booking/status';
import type { Booking } from '@/features/booking/api';

/* `booking/status.ts` is a presentation copy of `BOOKING_TRANSITIONS` in
   packages/domain. It decides which buttons appear and — more importantly — which
   do not.

   The point of these tests is not that the helpers work. It is that a button
   cannot appear where the API will refuse it. A "Reschedule" that is enabled on
   a REQUESTED booking, or a cancel offered on an IN_PROGRESS one, turns a correct
   409 into something the customer has to interpret as a fault in the product.

   Every expectation below is cross-checked against the transition table, not
   against what would be convenient. */

const booking = (over: Partial<Booking>): Booking => ({
  id: 'b1',
  code: 'SHM-0000001',
  customerId: 'c1',
  providerId: 'p1',
  serviceId: 1,
  addressId: 'a1',
  status: 'REQUESTED',
  paymentMode: 'CASH',
  paymentStatus: 'NONE',
  isEmergency: false,
  isAutoAssign: false,
  scheduledStart: '2026-10-05T04:00:00.000Z',
  scheduledEnd: '2026-10-05T05:30:00.000Z',
  problemText: null,
  quotedAmountPaisa: 250000,
  approvedTotalPaisa: 250000,
  finalAmountPaisa: null,
  discountPaisa: 0,
  rescheduleCount: 0,
  noShowParty: null,
  cancelReason: null,
  startOtpVerifiedAt: null,
  completedAt: null,
  verificationTier: null,
  createdAt: '2026-10-01T09:00:00.000Z',
  updatedAt: '2026-10-01T09:00:00.000Z',
  /* Present on every `BOOKING_COLUMNS` row; left optional so a test can build a
     partial and let the `over` spread widen them. */
  issueOptionId: null,
  isOnBehalf: false,
  onBehalfName: null,
  ...over
});

const NOW = new Date('2026-10-04T00:00:00.000Z');

describe('cancellation', () => {
  /* `cancel` for CUSTOMER exists on PENDING_PAYMENT, REQUESTED and SCHEDULED
     only. Past SCHEDULED the job is moving and the customer cannot call it off. */
  it.each(['PENDING_PAYMENT', 'REQUESTED', 'SCHEDULED'] as const)('allows a cancel from %s', (status) => {
    expect(canCancel(booking({ status }))).toBe(true);
  });

  it.each(['EN_ROUTE', 'IN_PROGRESS', 'QUOTE_REVISION', 'WORK_COMPLETED', 'AWAITING_VERIFICATION', 'PAYMENT_RELEASED', 'CLOSED'] as const)('refuses a cancel from %s', (status) => {
    expect(canCancel(booking({ status }))).toBe(false);
  });

  it('refuses a cancel on a booking that has already been cancelled', () => {
    /* CANCELLED_* has no `cancel` event at all, so a second attempt is an
       ILLEGAL_TRANSITION rather than a no-op. */
    expect(canCancel(booking({ status: 'CANCELLED_CUSTOMER' }))).toBe(false);
    expect(canCancel(booking({ status: 'CANCELLED_PROVIDER' }))).toBe(false);
  });
});

describe('reschedule — FR-BK-05', () => {
  it('allows one change from SCHEDULED with enough notice', () => {
    const record = booking({ status: 'SCHEDULED', scheduledStart: '2026-10-06T04:00:00.000Z' });
    expect(canReschedule(record, NOW)).toBe(true);
    expect(rescheduleBlockReason(record, NOW)).toBeNull();
  });

  it('refuses before a professional has accepted', () => {
    /* `reschedule` for CUSTOMER is only on SCHEDULED. A REQUESTED booking has no
       professional to re-check availability against, so the API refuses it. */
    expect(rescheduleBlockReason(booking({ status: 'REQUESTED' }), NOW)).toBe('status');
  });

  it('refuses a second change, however early', () => {
    const record = booking({ status: 'SCHEDULED', rescheduleCount: 1, scheduledStart: '2026-10-20T04:00:00.000Z' });
    expect(rescheduleBlockReason(record, NOW)).toBe('used');
    expect(rescheduleBlockReason(record, NOW)).not.toBe('notice');
  });

  it('refuses inside the notice window', () => {
    /* `booking.service.ts` uses RESCHEDULE_NOTICE_HOURS = 4 and rejects when
       now > scheduledStart - 4h. Exactly four hours out is still allowed, so
       this mirrors a strict `>` rather than `>=`. */
    const start = new Date(NOW.getTime() + (RESCHEDULE_NOTICE_HOURS - 0.5) * 60 * 60 * 1000);
    expect(rescheduleBlockReason(booking({ status: 'SCHEDULED', scheduledStart: start.toISOString() }), NOW)).toBe('notice');
  });

  it('allows a change exactly four hours out', () => {
    const start = new Date(NOW.getTime() + RESCHEDULE_NOTICE_HOURS * 60 * 60 * 1000);
    expect(rescheduleBlockReason(booking({ status: 'SCHEDULED', scheduledStart: start.toISOString() }), NOW)).toBeNull();
  });

  it('names the status as the reason before it names the notice window', () => {
    /* Both conditions can be true at once — an unscheduled booking starting in an
       hour. "Only once a professional has accepted" is the more useful of the two
       answers, so it must not be masked by the deadline. */
    const record = booking({ status: 'REQUESTED', scheduledStart: '2026-10-04T01:00:00.000Z' });
    expect(rescheduleBlockReason(record, NOW)).toBe('status');
  });
});

describe('pending revision', () => {
  it('surfaces the decision only while the booking is waiting on it', () => {
    expect(hasPendingRevision(booking({ status: 'QUOTE_REVISION' }))).toBe(true);
    expect(hasPendingRevision(booking({ status: 'IN_PROGRESS' }))).toBe(false);
  });
});

describe('chat availability', () => {
  /* `MessageService.OPEN_STATUSES` is a narrower list than "the booking is
     live" — this is the mismatch that would put a composer on screen where every
     send is a 409. */
  it.each(['SCHEDULED', 'EN_ROUTE', 'IN_PROGRESS', 'QUOTE_REVISION', 'WORK_COMPLETED', 'AWAITING_VERIFICATION'] as const)('allows messaging in %s', (status) => {
    expect(canMessage(status)).toBe(true);
  });

  it.each(['PENDING_PAYMENT', 'REQUESTED', 'UNFULFILLED', 'VERIFIED', 'CLOSED'] as const)('closes the chat in %s', (status) => {
    expect(canMessage(status)).toBe(false);
  });

  it('is closed on a live booking that nobody has accepted yet', () => {
    /* The case that matters: REQUESTED is a perfectly healthy booking and the
       chat is still shut, because there is no other party to read it. */
    expect(isLiveBooking('REQUESTED')).toBe(true);
    expect(canMessage('REQUESTED')).toBe(false);
  });
});

describe('auto-assign', () => {
  it('reports an untaken request as awaiting a professional, not as broken', () => {
    /* `offer.service.ts` fixes provider_id only when somebody accepts, so
       providerId is null for the whole REQUESTED window of an auto-assign job. */
    const record = booking({ status: 'REQUESTED', providerId: null, isAutoAssign: true });
    expect(isAwaitingProvider(record)).toBe(true);
  });

  it('does not report a directly-booked request as awaiting assignment', () => {
    /* A request aimed at one professional also has a null providerId until they
       accept — but it is not a cascade, and calling it "being matched" would be
       describing a mechanism that is not running. */
    const record = booking({ status: 'REQUESTED', providerId: null, isAutoAssign: false });
    expect(isAwaitingProvider(record)).toBe(false);
  });

  it('stops reporting once a professional has taken it', () => {
    const record = booking({ status: 'SCHEDULED', providerId: 'p1', isAutoAssign: true });
    expect(isAwaitingProvider(record)).toBe(false);
  });

  it('stops reporting once the request has been abandoned', () => {
    /* UNFULFILLED is a real ending, not a wait. Showing "finding a professional"
       on a booking that will never find one would be an indefinite spinner in
       words. */
    const record = booking({ status: 'UNFULFILLED', providerId: null, isAutoAssign: true });
    expect(isAwaitingProvider(record)).toBe(false);
  });
});

describe('money', () => {
  it('shows the approved total until the job produces a final figure', () => {
    expect(bookingTotalPaisa(booking({ finalAmountPaisa: null }))).toBe(250000);
  });

  it("prefers the provider's closing figure once there is one", () => {
    /* `POST /bookings/:id/complete` allows a lower final amount but never a
       higher one, so this can only reduce what the customer pays. */
    expect(bookingTotalPaisa(booking({ finalAmountPaisa: 200000 }))).toBe(200000);
  });

  it('treats a final figure of zero as a real figure, not as absent', () => {
    /* `??` rather than `||`: free work is free, and falling back to the
       approved total here would bill a customer for work that cost nothing. */
    expect(bookingTotalPaisa(booking({ finalAmountPaisa: 0 }))).toBe(0);
  });

  it('holds money only while the platform is holding it', () => {
    /* CASH is collected by the professional after verification, so a CASH
       booking's paymentStatus of NONE is correct and must not read as a failure. */
    expect(isHeldPayment(booking({ paymentMode: 'CASH', paymentStatus: 'NONE' }))).toBe(false);
    expect(isHeldPayment(booking({ paymentMode: 'ONLINE', paymentStatus: 'PENDING' }))).toBe(true);
    expect(isHeldPayment(booking({ paymentMode: 'ONLINE', paymentStatus: 'HELD' }))).toBe(true);
    expect(isHeldPayment(booking({ paymentMode: 'ONLINE', paymentStatus: 'RELEASED' }))).toBe(false);
  });
});

describe('lifecycle labels', () => {
  it('treats a live booking as live and a finished one as closed', () => {
    expect(isLiveBooking('SCHEDULED')).toBe(true);
    expect(isClosedBooking('CLOSED')).toBe(true);
    expect(isLiveBooking('CLOSED')).toBe(false);
    expect(isClosedBooking('SCHEDULED')).toBe(false);
  });

  it('counts a live booking in the past as not upcoming', () => {
    /* An IN_PROGRESS job that started this morning is live but not upcoming, so
       it must not be counted as a visit still to come. */
    const started = booking({ status: 'IN_PROGRESS', scheduledStart: '2026-10-03T04:00:00.000Z' });
    expect(isLiveBooking(started.status)).toBe(true);
    expect(isUpcomingBooking(started, NOW)).toBe(false);
  });

  it('counts a cancelled booking as neither live nor upcoming', () => {
    const cancelled = booking({ status: 'CANCELLED_CUSTOMER', scheduledStart: '2026-10-20T04:00:00.000Z' });
    expect(isLiveBooking(cancelled.status)).toBe(false);
    expect(isUpcomingBooking(cancelled, NOW)).toBe(false);
  });
});
