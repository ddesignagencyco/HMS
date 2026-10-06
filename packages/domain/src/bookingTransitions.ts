/**
 * Only a customer or a provider ever fires a booking transition in this
 * codebase's current scope. Staff roles (ADMIN/AGENT/FINANCE) act on
 * bookings through dispute/verification tooling that doesn't exist yet
 * (M7+) — this package stays dependency-free from apps/api's broader
 * ActorRole union on purpose.
 */
export type BookingActorRole = 'CUSTOMER' | 'PROVIDER' | 'SYSTEM';

/**
 * The subset of the database's `booking_status` enum this package's
 * transition table covers. `ACCEPTED`, `PENDING_PAYMENT`, `ABANDONED` and
 * everything from `AWAITING_VERIFICATION` onward are real enum values the
 * database defines but this build doesn't drive yet (see the design doc,
 * "Out of scope").
 */
export type BookingStatus =
  | 'PENDING_PAYMENT'
  | 'ABANDONED'
  | 'REQUESTED'
  | 'SCHEDULED'
  | 'EN_ROUTE'
  | 'IN_PROGRESS'
  | 'QUOTE_REVISION'
  | 'WORK_COMPLETED'
  | 'AWAITING_VERIFICATION'
  | 'REWORK_REQUIRED'
  | 'VERIFIED'
  | 'AUTO_RELEASED'
  | 'DISPUTED'
  | 'PAYMENT_RELEASED'
  | 'PARTIALLY_REFUNDED'
  | 'REFUNDED'
  | 'CLOSED'
  | 'UNFULFILLED'
  | 'CANCELLED_CUSTOMER'
  | 'CANCELLED_PROVIDER'
  | 'NO_SHOW';

export type BookingEvent =
  | 'accept'
  | 'decline'
  | 'cancel'
  | 'reschedule'
  | 'depart'
  | 'start'
  | 'raiseQuoteRevision'
  | 'approveQuoteRevision'
  | 'rejectQuoteRevision'
  | 'complete'
  | 'noShow'
  | 'paymentCaptured'
  | 'paymentAbandoned'
  | 'exhaustOffers'
  | 'handToVerification'
  | 'completeAtVisitFee'
  | 'verified'
  | 'linkConfirmed'
  | 'outcomeRework'
  | 'outcomeDisputed'
  | 'autoRelease'
  | 'reworkWindowExpired'
  | 'release'
  | 'confirmCashReceived'
  | 'warrantyClaim'
  | 'close'
  | 'resolveRelease'
  | 'resolvePartial'
  | 'resolveRefund';

export type BookingTransition = { to: BookingStatus; allowedRoles: readonly BookingActorRole[] };

/**
 * `cancel`'s `to` here is a placeholder only used to prove the event is
 * legal from SCHEDULED; the caller (BookingStateService) always overrides
 * it with CANCELLED_CUSTOMER or CANCELLED_PROVIDER based on which role
 * actually fired the event, since a single table entry can't encode "the
 * target depends on who calls it."
 */
export const BOOKING_TRANSITIONS: Partial<Record<BookingStatus, Partial<Record<BookingEvent, BookingTransition>>>> = {
  PENDING_PAYMENT: {
    paymentCaptured: { to: 'REQUESTED', allowedRoles: ['SYSTEM'] },
    paymentAbandoned: { to: 'ABANDONED', allowedRoles: ['SYSTEM'] },
    cancel: { to: 'CANCELLED_CUSTOMER', allowedRoles: ['CUSTOMER'] }
  },
  REQUESTED: {
    exhaustOffers: { to: 'UNFULFILLED', allowedRoles: ['SYSTEM'] },
    cancel: { to: 'CANCELLED_CUSTOMER', allowedRoles: ['CUSTOMER'] },
    accept: { to: 'SCHEDULED', allowedRoles: ['PROVIDER'] },
    decline: { to: 'UNFULFILLED', allowedRoles: ['PROVIDER'] }
  },
  SCHEDULED: {
    cancel: { to: 'CANCELLED_CUSTOMER', allowedRoles: ['CUSTOMER', 'PROVIDER'] },
    reschedule: { to: 'SCHEDULED', allowedRoles: ['CUSTOMER'] },
    // SRS T13 allows a no-show to be reported from SCHEDULED as well as EN_ROUTE:
    // a provider who never taps "depart" and simply does not turn up has still failed
    // the visit, and the customer is otherwise left with a booking they cannot close.
    // The BR-04 grace window in `BookingStateService` is what stops this being
    // reportable the instant the visit was due to start.
    noShow: { to: 'NO_SHOW', allowedRoles: ['CUSTOMER', 'PROVIDER'] },
    depart: { to: 'EN_ROUTE', allowedRoles: ['PROVIDER'] }
  },
  EN_ROUTE: {
    start: { to: 'IN_PROGRESS', allowedRoles: ['PROVIDER'] },
    noShow: { to: 'NO_SHOW', allowedRoles: ['CUSTOMER', 'PROVIDER'] }
  },
  IN_PROGRESS: {
    raiseQuoteRevision: { to: 'QUOTE_REVISION', allowedRoles: ['PROVIDER'] },
    completeAtVisitFee: { to: 'WORK_COMPLETED', allowedRoles: ['SYSTEM'] },
    complete: { to: 'WORK_COMPLETED', allowedRoles: ['PROVIDER'] }
  },
  WORK_COMPLETED: {
    handToVerification: { to: 'AWAITING_VERIFICATION', allowedRoles: ['SYSTEM'] }
  },
  // T18–T21: the verification outcome. The agent (or the customer's link) decides; the platform applies it, so the actor is SYSTEM here and the
  // history row carries who decided.
  AWAITING_VERIFICATION: {
    verified: { to: 'VERIFIED', allowedRoles: ['SYSTEM'] },
    linkConfirmed: { to: 'VERIFIED', allowedRoles: ['SYSTEM'] },
    outcomeRework: { to: 'REWORK_REQUIRED', allowedRoles: ['SYSTEM'] },
    outcomeDisputed: { to: 'DISPUTED', allowedRoles: ['SYSTEM'] },
    autoRelease: { to: 'AUTO_RELEASED', allowedRoles: ['SYSTEM'] }
  },
  // T24: an admin's ruling on a frozen job. The platform applies it; the history row names the admin.
  DISPUTED: {
    resolveRelease: { to: 'PAYMENT_RELEASED', allowedRoles: ['SYSTEM'] },
    resolvePartial: { to: 'PARTIALLY_REFUNDED', allowedRoles: ['SYSTEM'] },
    resolveRefund: { to: 'REFUNDED', allowedRoles: ['SYSTEM'] }
  },
  // T12 (rework visit needs a fresh start code) and T22.
  REWORK_REQUIRED: {
    start: { to: 'IN_PROGRESS', allowedRoles: ['PROVIDER'] },
    reworkWindowExpired: { to: 'DISPUTED', allowedRoles: ['SYSTEM'] }
  },
  // T23: online money is released by the platform; cash is released when the provider confirms they were paid.
  VERIFIED: {
    release: { to: 'PAYMENT_RELEASED', allowedRoles: ['SYSTEM'] },
    confirmCashReceived: { to: 'PAYMENT_RELEASED', allowedRoles: ['PROVIDER'] }
  },
  AUTO_RELEASED: {
    release: { to: 'PAYMENT_RELEASED', allowedRoles: ['SYSTEM'] },
    confirmCashReceived: { to: 'PAYMENT_RELEASED', allowedRoles: ['PROVIDER'] }
  },
  PAYMENT_RELEASED: {
    warrantyClaim: { to: 'REWORK_REQUIRED', allowedRoles: ['CUSTOMER'] },
    close: { to: 'CLOSED', allowedRoles: ['SYSTEM'] }
  },
  PARTIALLY_REFUNDED: { close: { to: 'CLOSED', allowedRoles: ['SYSTEM'] } },
  REFUNDED: { close: { to: 'CLOSED', allowedRoles: ['SYSTEM'] } },
  QUOTE_REVISION: {
    approveQuoteRevision: { to: 'IN_PROGRESS', allowedRoles: ['CUSTOMER'] },
    rejectQuoteRevision: { to: 'IN_PROGRESS', allowedRoles: ['CUSTOMER'] }
  }
};

/** Role-blind lookup: "does this event exist from this status at all." */
export const transitionFor = (from: BookingStatus, event: BookingEvent): BookingTransition | undefined => BOOKING_TRANSITIONS[from]?.[event];

/** Role-checked lookup: null both when the event doesn't exist from this status, and when this role can't fire it. */
export const canTransition = (from: BookingStatus, event: BookingEvent, actorRole: BookingActorRole): BookingTransition | null => {
  const transition = transitionFor(from, event);
  if (transition === undefined || !transition.allowedRoles.includes(actorRole)) return null;
  return transition;
};
