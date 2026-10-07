/* POST /bookings/quote, POST /bookings, GET /bookings, GET /bookings/:id and
   every customer-callable action on a booking.

   Four things about this surface are worth reading before changing anything:

   · **The server prices the booking, not this app.** `POST /bookings/quote`
     returns the itemised figure a checkout would create, and `create()` runs
     through the same `PricingService.price()`. Nothing here recomputes a total
     from the catalogue: a FLAT base price, an INSPECTION_FIRST visit fee and an
     emergency surcharge are three different shapes, and the settings behind them
     are administrator-owned. Showing a locally computed total next to the
     server's own would be two sources of truth for one number.

   · **`providerId` is optional and that is a real product choice.** Left out, the
     booking is auto-assigned: it is offered to ranked providers one at a time
     until one accepts, and goes UNFULFILLED if nobody does. Supplied, exactly
     one provider is asked. Both are priced; auto-assign is priced at the
     service's base price rather than a chosen professional's rate.

   · **Both create bodies are `.strict()`.** One unrecognised key is a 422, so
     these functions build the body themselves rather than forwarding a spread.

   · **A slot can be lost between listing and checkout.** The database's
     exclusion constraint is the final word, and the loser of the race gets
     409 `SLOT_TAKEN`. No function here treats a held slot as reserved. */

import { apiRequest, type ApiRequest } from "@/lib/api/client";
import type { Locale } from "@/lib/utils";

/* ---- What the API returns ------------------------------------------------
   Mirrors `BookingRow` in apps/api/src/booking/booking.row.ts field for field.
   Amounts are integer paisa, never rupees and never a float. */

export type BookingStatus =
  | "PENDING_PAYMENT"
  | "ABANDONED"
  | "REQUESTED"
  | "UNFULFILLED"
  | "ACCEPTED"
  | "SCHEDULED"
  | "EN_ROUTE"
  | "IN_PROGRESS"
  | "QUOTE_REVISION"
  | "WORK_COMPLETED"
  | "AWAITING_VERIFICATION"
  | "REWORK_REQUIRED"
  | "VERIFIED"
  | "AUTO_RELEASED"
  | "DISPUTED"
  | "PAYMENT_RELEASED"
  | "PARTIALLY_REFUNDED"
  | "REFUNDED"
  | "CANCELLED_CUSTOMER"
  | "CANCELLED_PROVIDER"
  | "NO_SHOW"
  | "CLOSED";

export type PaymentMode = "CASH" | "ONLINE";

/**
 * `GET /bookings?status=` takes **any** value of the booking status enum.
 *
 * This used to be a ten-value subset, because the API's schema listed only those.
 * The backend now derives `BOOKING_STATUS_VALUES` from the database enum itself,
 * so the filter accepts every status — including `VERIFIED`, `CLOSED`,
 * `CANCELLED_PROVIDER` and the rest. Keeping a hand-written subset here would
 * silently make those bookings unreachable from the list's own filter.
 */
export type BookingListStatus = BookingStatus;

/**
 * What cancelling this booking would cost right now, from
 * `GET /bookings/:id` under `cancellation`.
 *
 * The server builds it from the same rule `POST /bookings/:id/cancel` applies, so
 * the two cannot disagree: `feeDuePaisa` is non-zero only once the booking is
 * SCHEDULED and the start is inside `booking.free_cancel_hours`, and it is capped
 * at the booking total. A quote of zero is the normal answer, not a missing one —
 * so this is shown as "free" rather than as an absence.
 */
export type CancellationQuote = {
  freeCancelHours: number;
  lateCancelFeePaisa: number;
  hoursUntilStart: number;
  isLate: boolean;
  feeDuePaisa: number;
};

export type Booking = {
  id: string;
  /** Short human reference, e.g. `SHM-0000001`. This is what a customer quotes. */
  code: string;
  customerId: string;
  /** Null while the booking is an open auto-assign request with no taker yet. */
  providerId: string | null;
  serviceId: number;
  addressId: string;
  status: BookingStatus;
  paymentMode: PaymentMode;
  paymentStatus: string;
  isEmergency: boolean;
  /** True when the customer let the platform choose the professional. */
  isAutoAssign: boolean;
  scheduledStart: string;
  scheduledEnd: string;
  problemText: string | null;
  /** What the customer picked to narrow the service, when they picked one. */
  issueOptionId: number | null;
  /**
   * Someone other than the customer will receive the provider.
   *
   * This pair is only *who to knock on*. The contact **number is deliberately not
   * on this row** — every provider-facing endpoint in the booking module returns it,
   * including the offer list where the professional is still deciding whether to
   * take the job. The number comes from `GET /bookings/:id/on-behalf-contact`,
   * masked until the job is accepted. See `OnBehalfContact`.
   */
  isOnBehalf: boolean;
  onBehalfName: string | null;
  /** What the platform priced the booking at. */
  quotedAmountPaisa: number;
  /** What the customer approved. Equal to the quote unless a revision was taken. */
  approvedTotalPaisa: number;
  /** The provider's closing figure, set when the job is completed. Null until then. */
  finalAmountPaisa: number | null;
  discountPaisa: number;
  /** FR-BK-05 allows exactly one free reschedule; this counts it. */
  rescheduleCount: number;
  noShowParty: "CUSTOMER" | "PROVIDER" | null;
  cancelReason: string | null;
  startOtpVerifiedAt: string | null;
  completedAt: string | null;
  verificationTier: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * `GET /bookings/:id` returns more than the booking row: the readable names
 * behind its ids, the line items it was priced for, and what cancelling would
 * cost. All three are absent from `GET /bookings` (the list), so they are held
 * apart rather than merged into `Booking` and left undefined in the list.
 */
export type BookingDetail = Booking & {
  serviceName: string | null;
  serviceNameUr: string | null;
  serviceSlug: string | null;
  providerQualification: string | null;
  addressLabel: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  areaName: string | null;
  items: { id: string; kind: string; description: string; quantity: number; unitPricePaisa: number; amountPaisa: number }[];
  /** The cancellation rule in plain words, rendered by the server. */
  cancellationPolicy: string;
  /** What cancelling this booking costs right now. */
  cancellation: CancellationQuote;
};

/**
 * What an ONLINE booking returns on top of the booking: where to send the
 * browser to pay. Absent for CASH, and the booking is already REQUESTED then.
 *
 * `returnUrl` is echoed back by `startCheckout` unchanged so the client knows
 * where the gateway will land the customer. It is informational: the return page
 * cannot observe the webhook, so it must not be treated as proof of payment.
 */
export type BookingPayment = { paymentId: string; redirectUrl: string; returnUrl?: string };

export type CreatedBooking = Booking & { payment?: BookingPayment };

/* ---- The quote ----------------------------------------------------------
   `QuoteLine.description` is English text generated by the server from
   administrator-owned settings. It is shown as-is: translating a server string
   client-side would produce a sentence the API never agreed to. */

export type QuoteLineKind = "SERVICE" | "VISIT_FEE" | "SURCHARGE" | "DISCOUNT";

export type QuoteLine = {
  kind: QuoteLineKind;
  description: string;
  /** Negative for a discount, which is why the UI must not assume a sign. */
  amountPaisa: number;
};

export type Quote = {
  currency: "PKR";
  servicePaisa: number;
  visitFeePaisa: number;
  emergencySurchargePaisa: number;
  discountPaisa: number;
  /** What this booking costs: service + visit fee + surcharge − discount. */
  totalPaisa: number;
  /**
   * Cash owed from an earlier cancelled cash job (FR-PY-11). Collected
   * separately and **not** part of the booking total.
   */
  outstandingReceivablePaisa: number;
  /** Everything the customer settles: the booking total plus the receivable. */
  payablePaisa: number;
  lines: QuoteLine[];
  /** Rendered by the server from `booking.free_cancel_hours` and the late fee. */
  cancellationPolicy: string;
};

export type QuoteInput = {
  /** Omit for an auto-assigned job. */
  providerId?: string;
  serviceId: number;
  isEmergency?: boolean;
  couponCode?: string;
};

export type CreateBookingInput = {
  providerId?: string;
  serviceId: number;
  addressId: string;
  /** ISO instants. Must start in the future and end on the same local day. */
  scheduledStart: string;
  scheduledEnd: string;
  /**
   * One of the service's own faults, from `GET /catalogue/services/:slug/issue-options`.
   *
   * The server validates it against the service (`resolveIssueOption` looks the id
   * up scoped to `service_id` and `is_active`), so an id from another service is
   * refused rather than stored. The API treats this as a narrowing hint, not a
   * constraint: a booking may send this, `problemText`, or both.
   */
  issueOptionId?: number;
  problemText?: string;
  paymentMode: PaymentMode;
  isEmergency?: boolean;
  couponCode?: string;
};

export type RescheduleInput = { scheduledStart: string; scheduledEnd: string };

/** `POST /bookings/:id/evidence` — one photo, base64, insert-only. */
export type EvidenceKind = "CUSTOMER_PROBLEM" | "BEFORE" | "AFTER" | "CHECKLIST";

export type Evidence = {
  id: string;
  kind: EvidenceKind;
  /** Generated on the device, so a retried upload stores once and returns 200. */
  clientUuid: string;
  checklistItemId: number | null;
  contentType: "image/jpeg" | "image/png" | "image/webp";
  sizeBytes: number;
  receivedAt: string;
  clientCapturedAt: string | null;
  url: string;
};

export type AddEvidenceInput = {
  clientUuid: string;
  kind: EvidenceKind;
  contentType: "image/jpeg" | "image/png" | "image/webp";
  contentBase64: string;
  checklistItemId?: number;
  capturedAt?: string;
  lat?: number;
  lng?: number;
};

/** The server reports whether a repeated clientUuid was a duplicate, not a new row. */
export type AddEvidenceResult = Evidence & { duplicate: boolean };

export type ChatMessage = {
  id: string;
  senderUserId: string;
  body: string;
  /** True when the signed-in account wrote it. */
  mine: boolean;
  readAt: string | null;
  createdAt: string;
};

export type ChatThread = { items: ChatMessage[]; open: boolean };

/** geoPoint on the start/complete schemas: client location recorded as the check-in. */
export type GeoPoint = { lat?: number; lng?: number; accuracyM?: number };

/** `bookingStartSchema` — 6-digit code the customer reads out; the location is
    recorded as the check-in. A geofence shortfall is a warning, never a refusal. */
export type StartBookingInput = { code: string } & GeoPoint;

/** `bookingCompleteSchema` — finalAmountPaisa may lower, never exceed. */
export type CompleteBookingInput = { finalAmountPaisa?: number } & GeoPoint;

/** `bookingRaiseRevisionSchema` — the extra work the provider found, as a delta. */
export type CreateRevisionInput = { deltaPaisa: number; reason: string };

export type BookingOptions = { signal?: AbortSignal; locale?: Locale };

/**
 * Every booking call is authenticated, so `auth` is never set to false and the
 * client is free to refresh and replay on an expired token — the opposite of
 * the public module, where a 401 must never start a refresh.
 */
const call = <T>(path: string, request: ApiRequest = {}, options?: BookingOptions) =>
  apiRequest<T>(path, {
    ...request,
    ...(options?.locale === undefined ? {} : { locale: options.locale }),
    ...(options?.signal === undefined ? {} : { signal: options.signal }),
  });

/** Only defined keys are sent; `.strict()` turns anything else into a 422. */
const compact = <T extends Record<string, unknown>>(input: T): Partial<T> => {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) if (value !== undefined) out[key] = value;
  return out as Partial<T>;
};

export const bookingApi = {
  /**
   * Prices a booking without creating it. `.strict()` on the server, and a
   * coupon the platform does not recognise is a 400 rather than a silent zero
   * discount — so an invalid code is reported, never swallowed.
   */
  quote: (input: QuoteInput, options?: BookingOptions) =>
    call<Quote>(
      "/bookings/quote",
      { method: "POST", body: compact({ ...input, isEmergency: input.isEmergency ?? false }) },
      options,
    ),

  /**
   * Creates the booking, its priced line items and — for ONLINE — the payment
   * it waits on, in one transaction.
   *
   * Worth knowing: a CASH booking is REQUESTED immediately; an ONLINE one is
   * PENDING_PAYMENT and only becomes REQUESTED once the gateway's signed
   * webhook confirms capture. So a successful 201 with a `redirectUrl` means
   * "not yet booked" as much as it means "booked".
   */
  create: (input: CreateBookingInput, options?: BookingOptions) =>
    call<CreatedBooking>(
      "/bookings",
      { method: "POST", body: compact({ ...input, isEmergency: input.isEmergency ?? false }) },
      options,
    ),

  /** 404 for someone else's booking — the API does not confirm it exists. */
  get: (bookingId: string, options?: BookingOptions) =>
    call<BookingDetail>(`/bookings/${encodeURIComponent(bookingId)}`, {}, options),

  /**
   * Everything you are the customer or the provider on, newest first.
   *
   * No paging and no cursor — the endpoint takes only `status`. A long history
   * is one unbounded response, which the UI must not pretend it can page.
   */
  listMine: (status?: BookingListStatus, options?: BookingOptions) =>
    call<{ items: Booking[] }>("/bookings", { query: status === undefined ? undefined : { status } }, options),

  /** Both parties may cancel. The reason is optional and stored verbatim. */
  cancel: (bookingId: string, reason?: string, options?: BookingOptions) =>
    call<Booking>(`/bookings/${encodeURIComponent(bookingId)}/cancel`, { method: "POST", body: compact({ reason }) }, options),

  /** Once, free, and at least 4 hours before the current slot. Otherwise 400. */
  reschedule: (bookingId: string, input: RescheduleInput, options?: BookingOptions) =>
    call<Booking>(`/bookings/${encodeURIComponent(bookingId)}/reschedule`, { method: "POST", body: input }, options),

  /** The provider found extra work; the customer answers with one of these. */
  approveRevision: (bookingId: string, options?: BookingOptions) =>
    call<Booking>(`/bookings/${encodeURIComponent(bookingId)}/revisions/approve`, { method: "POST" }, options),

  rejectRevision: (bookingId: string, options?: BookingOptions) =>
    call<Booking>(`/bookings/${encodeURIComponent(bookingId)}/revisions/reject`, { method: "POST" }, options),

  /**
   * Reopens a paid job as rework while the service's warranty lasts. A second
   * failure escalates to a dispute, so this is a real remedy and not a retry.
   */
  warrantyClaim: (bookingId: string, reason: string, options?: BookingOptions) =>
    call<Booking>(`/bookings/${encodeURIComponent(bookingId)}/warranty-claim`, { method: "POST", body: { reason } }, options),

  /** Reports that the other party did not turn up. */
  reportNoShow: (bookingId: string, party: "CUSTOMER" | "PROVIDER", options?: BookingOptions) =>
    call<Booking>(`/bookings/${encodeURIComponent(bookingId)}/no-show`, { method: "POST", body: { party } }, options),

  listEvidence: (bookingId: string, options?: BookingOptions) =>
    call<{ items: Evidence[] }>(`/bookings/${encodeURIComponent(bookingId)}/evidence`, {}, options),

  addEvidence: (bookingId: string, input: AddEvidenceInput, options?: BookingOptions) =>
    call<AddEvidenceResult>(
      `/bookings/${encodeURIComponent(bookingId)}/evidence`,
      { method: "POST", body: input },
      options,
    ),

  /** Reading marks the other side's messages read, so this is not a pure read. */
  listMessages: (bookingId: string, options?: BookingOptions) =>
    call<ChatThread>(`/bookings/${encodeURIComponent(bookingId)}/messages`, {}, options),

  /** 409 once the chat has closed; the response says whether a number was masked. */
  sendMessage: (bookingId: string, body: string, options?: BookingOptions) =>
    call<ChatMessage & { masked: boolean }>(
      `/bookings/${encodeURIComponent(bookingId)}/messages`,
      { method: "POST", body: { body } },
      options,
    ),

  /** The contact the booking is for when somebody else is paying. The number is
      masked until the provider accepts — an offer is not yet a customer, and a
      provider browsing offers should not collect details for jobs they may
      decline. `revealed:false` means render the masked form as-is; never try
      to reconstruct it. */
  onBehalfContact: (bookingId: string, options?: BookingOptions) =>
    call<{ contact: { name: string; phone: string; revealed: boolean } | null }>(
      `/bookings/${encodeURIComponent(bookingId)}/on-behalf-contact`,
      {},
      options,
    ),

  /* ---- The provider's actions on a booking. Still on `/bookings`, so they live
      here rather than in features/provider — that module is only the provider's
      own profile, settings, money and reputation. */

  /** `POST /provider/offers/{id}/accept` is a different route that takes an offer
      id; this one takes the booking id and is for direct provider actions. */
  accept: (bookingId: string, options?: BookingOptions) =>
    call<Booking>(`/bookings/${encodeURIComponent(bookingId)}/accept`, { method: "POST" }, options),

  decline: (bookingId: string, options?: BookingOptions) =>
    call<Booking>(`/bookings/${encodeURIComponent(bookingId)}/decline`, { method: "POST" }, options),

  depart: (bookingId: string, options?: BookingOptions) =>
    call<Booking>(`/bookings/${encodeURIComponent(bookingId)}/depart`, { method: "POST" }, options),

  /** Wrong code is 422 `OTP_INVALID`; the fifth consecutive wrong one is
      423 `OTP_LOCKED` for 15 minutes. The location is recorded as the check-in:
      it answers `distanceM` and `withinGeofence`, and a geofence shortfall is a
      warning, never a refusal. */
  start: (bookingId: string, input: StartBookingInput, options?: BookingOptions) =>
    call<Booking>(`/bookings/${encodeURIComponent(bookingId)}/start`, { method: "POST", body: compact(input) }, options),

  /** `{ done: true, evidenceId? }` per step. A photo step needs the evidenceId of
      a CHECKLIST photo already uploaded for that step, else 422. */
  markChecklistDone: (bookingId: string, itemId: number, evidenceId: string | undefined, options?: BookingOptions) =>
    call<{ checklistItemId: number; done: boolean; evidenceId: string | null }>(
      `/bookings/${encodeURIComponent(bookingId)}/checklist/${itemId}`,
      { method: "POST", body: compact({ done: true as const, evidenceId }) },
      options,
    ),

  /** All checklist steps and a before&after photo are enforced server-side; the
      response is AWAITING_VERIFICATION and a verification call is queued.
      finalAmountPaisa may lower the charge, never exceed the approved total. */
  complete: (bookingId: string, input: CompleteBookingInput, options?: BookingOptions) =>
    call<Booking>(`/bookings/${encodeURIComponent(bookingId)}/complete`, { method: "POST", body: compact(input) }, options),

  /** Only after a passing verification has authorised collection. */
  cashReceived: (bookingId: string, options?: BookingOptions) =>
    call<Booking>(`/bookings/${encodeURIComponent(bookingId)}/cash-received`, { method: "POST" }, options),

  /** The provider found extra work; the customer approves or rejects. */
  createRevision: (bookingId: string, input: CreateRevisionInput, options?: BookingOptions) =>
    call<Booking>(`/bookings/${encodeURIComponent(bookingId)}/revisions`, { method: "POST", body: compact(input) }, options),
};