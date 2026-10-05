/* What the API will and will not let a customer do to a booking, mirrored from
   `packages/domain/src/bookingTransitions.ts`.

   This is a *presentation* copy of the transition table, not an authority: the
   server re-checks every one of these and answers 409 `ILLEGAL_TRANSITION` when
   the booking has moved on since it was read. Its job is to avoid offering a
   button that cannot work — a disabled "Reschedule" with the reason on screen
   beats a 409 the customer has to interpret.

   Two rules are worth stating plainly because they are not what the copy in the
   old mock flow claimed:

   · **A cancellation fee is not applied by the API.** `POST /bookings/:id/cancel`
     records the cancellation and the reason only; the controller's own
     description says the FR-BK-06 fee rules are not applied "until M8 exists".
     So no fee is quoted at cancellation time. See BACKEND_REQUIREMENTS.md §3.3.

   · **One reschedule, free, up to 4 hours before the slot** — `rescheduleCount`
     and the scheduled start together decide it, and both are on the booking. */

import type { Booking, BookingStatus } from "./api";

/** A booking the job is still happening for. */
const LIVE_STATUSES: readonly BookingStatus[] = [
  "PENDING_PAYMENT",
  "REQUESTED",
  "SCHEDULED",
  "EN_ROUTE",
  "IN_PROGRESS",
  "QUOTE_REVISION",
  "AWAITING_VERIFICATION",
  "REWORK_REQUIRED",
];

/** Nothing further will happen on these without a new booking. */
const CLOSED_STATUSES: readonly BookingStatus[] = [
  "ABANDONED",
  "UNFULFILLED",
  "CANCELLED_CUSTOMER",
  "CANCELLED_PROVIDER",
  "NO_SHOW",
  "DISPUTED",
  "CLOSED",
];

const contains = (list: readonly BookingStatus[], status: BookingStatus): boolean => list.includes(status);

export const isLiveBooking = (status: BookingStatus): boolean => contains(LIVE_STATUSES, status);

export const isClosedBooking = (status: BookingStatus): boolean => contains(CLOSED_STATUSES, status);

/** Whether an open job is still ahead of today. */
export const isUpcomingBooking = (booking: Pick<Booking, "status" | "scheduledStart">, now: Date = new Date()): boolean =>
  isLiveBooking(booking.status) && new Date(booking.scheduledStart).getTime() > now.getTime();

/**
 * `cancel` exists on PENDING_PAYMENT, REQUESTED and SCHEDULED, for the customer
 * in all three. Everything past SCHEDULED has begun moving and cannot be called
 * off from the customer side.
 */
export const canCancel = (booking: Pick<Booking, "status">): boolean =>
  booking.status === "PENDING_PAYMENT" || booking.status === "REQUESTED" || booking.status === "SCHEDULED";

/**
 * FR-BK-05: one free reschedule, and only from SCHEDULED, and only at least
 * four hours before the current slot. Both extra conditions are checked here so
 * the button can explain itself, and re-checked by the server.
 */
export const RESCHEDULE_NOTICE_HOURS = 4;

export const rescheduleBlockReason = (booking: Pick<Booking, "status" | "rescheduleCount" | "scheduledStart">, now: Date = new Date()): "status" | "used" | "notice" | null => {
  if (booking.status !== "SCHEDULED") return "status";
  if (booking.rescheduleCount >= 1) return "used";
  const cutoff = new Date(booking.scheduledStart).getTime() - RESCHEDULE_NOTICE_HOURS * 60 * 60 * 1000;
  if (now.getTime() > cutoff) return "notice";
  return null;
};

export const canReschedule = (booking: Pick<Booking, "status" | "rescheduleCount" | "scheduledStart">, now: Date = new Date()): boolean =>
  rescheduleBlockReason(booking, now) === null;

/** A revised quote is waiting on the customer's answer. */
export const hasPendingRevision = (booking: Pick<Booking, "status">): boolean => booking.status === "QUOTE_REVISION";

/**
 * The chat is open only while a professional is on the job. `MessageService`
 * keys this off the same status list, and it is *not* the same as "live" —
 * REQUESTED is live but the chat is closed until somebody accepts.
 */
const CHAT_OPEN_STATUSES: readonly BookingStatus[] = [
  "SCHEDULED",
  "EN_ROUTE",
  "IN_PROGRESS",
  "QUOTE_REVISION",
  "WORK_COMPLETED",
  "AWAITING_VERIFICATION",
];

export const canMessage = (status: BookingStatus): boolean => contains(CHAT_OPEN_STATUSES, status);

/** A provider has been fixed to this booking, so it is no longer a request. */
export const hasAssignedProvider = (booking: Pick<Booking, "providerId">): boolean => booking.providerId !== null;

/** Still waiting for a professional to take it on. */
export const isAwaitingProvider = (booking: Pick<Booking, "status" | "providerId" | "isAutoAssign">): boolean =>
  booking.isAutoAssign && booking.providerId === null && (booking.status === "REQUESTED" || booking.status === "PENDING_PAYMENT");

/**
 * Money the customer is waiting on rather than money that has moved. A cash
 * booking is settled with the professional after verification, so `CASH` is not
 * `CASH_DUE` yet; only these two mean the platform is holding it.
 */
export const isHeldPayment = (booking: Pick<Booking, "paymentStatus">): boolean =>
  booking.paymentStatus === "PENDING" || booking.paymentStatus === "HELD";

/**
 * What a customer actually owes for this booking right now.
 *
 * `finalAmountPaisa` is the provider's closing figure and exists only once the
 * job is done; until then the approved total is the figure. Preferring it after
 * completion is the one case where the number changes after the customer
 * approved it — and it can only go down, which the API enforces.
 */
export const bookingTotalPaisa = (booking: Pick<Booking, "approvedTotalPaisa" | "finalAmountPaisa">): number =>
  booking.finalAmountPaisa ?? booking.approvedTotalPaisa;