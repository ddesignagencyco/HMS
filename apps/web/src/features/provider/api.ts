/* The signed-in professional's own surface.

   Every route here is `PROVIDER`-guarded and is about **the person reading it** —
   there is no `:providerId` in the path, because the API reads it from the access
   token. That is the single most important thing to understand about migrating the
   provider screens: they used to hardcode `providers[0]` as "me", which meant every
   professional saw the same invented person, "Ahmad Raza", whatever they signed in
   as. There is no "me" endpoint to guess at; it is the absence of an id.

   Two contract facts that shape the UI:

   · **`GET /provider/services` returns the service *and* this provider's price for
     it, plus the approval status.** That is richer than anything the mock had, and
     it is why the service-and-price screen can be built without a second request.

   · **Money is integer paisa end to end**, and the commission figure is
     *snapshotted per booking* from the commission rules. The mock screen computed
     12% in the browser, which is a second source of truth for a number the server
     owns — `earnings.commissionPaisa` must always be read from the endpoint. */

import { apiRequest, type ApiRequest } from '@/lib/api/client';
import type { Locale } from '@/lib/utils';

export type ProviderOptions = { signal?: AbortSignal; locale?: Locale };

const call = <T>(path: string, request: ApiRequest = {}, options?: ProviderOptions) =>
  apiRequest<T>(path, {
    ...request,
    ...(options?.locale === undefined ? {} : { locale: options.locale }),
    ...(options?.signal === undefined ? {} : { signal: options.signal })
  });

/** `provider_status` in the schema. `PENDING_APPROVAL` sees a queued workspace. */
export type ProviderStatus = 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'SUSPENDED' | 'BLOCKED';

export type ProviderProfile = {
  userId: string;
  status: ProviderStatus;
  bio: string | null;
  experienceYears: number | null;
  /** The public trade description, e.g. "Licensed electrician". Deliberately not a
      name: the public search contract omits `users.first_name`. */
  qualification: string | null;
  cityId: number;
  baseAddressText: string | null;
  lat: number | null;
  lng: number | null;
  radiusM: number;
};

export type ProviderProfileInput = {
  bio?: string;
  /** 0–60. `profileUpdateSchema`. */
  experienceYears?: number;
  qualification?: string;
  cityId?: number;
  baseAddressText?: string;
  lat?: number;
  lng?: number;
  /** Metres, 500–50 000. `profileUpdateSchema` — not a kilometre figure. */
  radiusM?: number;
};

/* ---- Services and prices ------------------------------------------------
   `PUT` and `DELETE` are keyed on the *catalogue* service id, not a provider
   service id — there is no provider service row of its own. */

export type ProviderServiceApproval = 'PENDING' | 'APPROVED' | 'REJECTED';

/**
 * One row of `GET /provider/services`, exactly as
 * `ProviderServicesService.listMine` selects it.
 *
 * Note what is **not** here: no price band, no duration, no warranty, and no
 * `nameUr`. The band lives on the catalogue service, so the screen has to join
 * `serviceId` against `GET /catalogue/categories/:slug/services` to know whether
 * the price it is about to set is even allowed. The server enforces the band
 * regardless — a price outside it is a 400, not a silent clamp.
 */
export type ProviderService = {
  providerId: string;
  serviceId: number;
  serviceSlug: string;
  /** English only — see BACKEND_REQUIREMENTS "Known gaps". */
  serviceNameEn: string;
  /** This provider's rate for this service. */
  pricePaisa: number;
  status: ProviderServiceApproval;
  createdAt: string;
};

export type SetProviderServiceInput = { pricePaisa: number };

/* ---- Service areas -------------------------------------------------------
   `GET /provider/service-areas` selects exactly one column — `area_id`. There is
   no name and no city, so the screen has to resolve each id against the places
   API. It already has that map for the address book; the two share it. */

export type ProviderServiceArea = { areaId: number };

export type SetServiceAreasInput = { areaIds: number[] };

/** `serviceAreasReplaceSchema` caps the list at 50. */
export const MAX_SERVICE_AREAS = 50;

/* ---- Availability --------------------------------------------------------
   **Recurring weekly blocks, not a per-day booked/free grid.** The previous
   screen drew a month calendar with "booked" and "free" cells, which is a view of
   bookings, not of availability — and availability is what this endpoint owns.

   `GET /provider/availability` answers `{ items }` and `PUT` takes `{ items }`;
   there is no `travelBufferMinutes` field, so the buffer note cannot be sourced
   from here. Both request and response use the same envelope. */

export type AvailabilityBlock = {
  /** 0 = Sunday … 6 = Saturday. `availabilityReplaceSchema`. */
  weekday: number;
  /** Local wall-clock `HH:MM`, not an instant. The one place local time is right. */
  startTime: string;
  endTime: string;
};

/** `availabilityReplaceSchema` caps the list at 21 blocks. See `limits.ts`. */
export { MAX_AVAILABILITY_BLOCKS } from './limits';

export type Availability = { items: AvailabilityBlock[] };

/* ---- Leave ---------------------------------------------------------------
   `timeOffCreateSchema` takes `{ start, end }` as **ISO datetimes**, not dates —
   an earlier draft of this file typed them as `fromDate`/`toDate`, which would
   have been a 422 on every leave request. */

export type TimeOff = {
  id: string;
  start: string;
  end: string;
  reason: string | null;
};

export type TimeOffInput = { start: string; end: string; reason?: string };

/* ---- Offers -------------------------------------------------------------
   Already joined server-side: `serviceName` and `areaName` arrive resolved, so
   the offer row needs no catalogue or places lookup to render. */

export type ProviderOffer = {
  id: string;
  bookingId: string;
  bookingCode: string;
  serviceName: string;
  areaName: string | null;
  scheduledStart: string;
  scheduledEnd: string;
  quotedAmountPaisa: number;
  isEmergency: boolean;
  problemText: string | null;
  /** When this offer lapses. The countdown on screen reads this, not a timer the
      client invents — an offer that already expired must not look live. */
  expiresAt: string;
};

/* ---- Money --------------------------------------------------------------- */

export type Earnings = {
  heldPaisa: number;
  releasablePaisa: number;
  paidPaisa: number;
  /** Already netted per booking. Never recompute a percentage here. */
  commissionPaisa: number;
  weekly: { period: string; releasedPaisa: number }[];
  monthly: { period: string; releasedPaisa: number }[];
};

export type Wallet = {
  balancePaisa: number;
  debtPaisa: number;
  debtCeilingPaisa: number;
  /** FR: a provider over the commission-debt ceiling is not offered new work. */
  offersBlocked: boolean;
  offerBlockedReason: string | null;
};

export type PayoutStatus = 'REQUESTED' | 'APPROVED' | 'PROCESSING' | 'PAID' | 'REJECTED';

/** One row of `GET /provider/payouts` (`listForProvider`), with the destination
    account already joined in. */
export type Payout = {
  id: string;
  providerId: string;
  amountPaisa: number;
  status: PayoutStatus;
  requestedAt: string;
  paidAt: string | null;
  /** Why the bank refused it, when it did. */
  failureReason: string | null;
  /** Which batch settled it, once one has. */
  batchId: string | null;
  accountTitle: string;
  institution: string;
  /** The last four digits only — the full number is never returned. */
  accountLast4: string;
};

/** `POST /provider/payouts` answers 201 with the new request. */
export type PayoutRequestResult = { id: string; amountPaisa: number; status: PayoutStatus };

/** `payoutSchema`: amount must be a positive integer, at least
    `payout.min_amount_paisa`, and no more than the releasable balance. */
export type PayoutRequestInput = { amountPaisa: number; payoutAccountId: string };

/** `GET /provider/payout-accounts`. `accountLast4` is the only part of the
    number the API will ever hand back. */
export type PayoutAccount = {
  id: string;
  kind: 'BANK' | 'WALLET';
  accountTitle: string;
  institution: string;
  accountLast4: string;
  isDefault: boolean;
};

/** `accountSchema` in provider-payouts.controller.ts — `.strict()`. */
export type PayoutAccountInput = {
  kind: 'BANK' | 'WALLET';
  accountTitle: string;
  institution: string;
  accountNumber: string;
  isDefault?: boolean;
};

/* ---- Reputation and conduct ---------------------------------------------- */

export type RemarkReply = { body: string; createdAt: string } | null;

export type ProviderRating = {
  ratingId: string;
  score: number;
  quality: number | null;
  punctuality: number | null;
  conduct: number | null;
  cleanliness: number | null;
  createdAt: string;
  remark: { id: string; body: string; displayName: string; published: boolean; reply: RemarkReply } | null;
};

export type ProviderRatings = {
  reputation: {
    score: number;
    ratingCount: number;
    /** Counts keyed by "1".."5". */
    distribution: Record<string, number>;
    verifiedJobs: number;
    badge: string | null;
  };
  items: ProviderRating[];
};

export type ConductAward = {
  id: string;
  code: string;
  points: number;
  grantedAt: string;
  expiresAt: string | null;
};

export type ConductThreshold = {
  points: number;
  consequence: string;
  /** Server-supplied label in both languages — never reworded client-side. */
  label: { en: string; ur: string };
};

export type Conduct = {
  providerStatus: ProviderStatus;
  activePoints: number;
  daysSinceLastBreachOrDecay: number | null;
  awards: ConductAward[];
  standingConsequences: { code: string; label: { en: string; ur: string } }[];
  thresholds: ConductThreshold[];
  schedule: { code: string; label: { en: string; ur: string } }[];
};

export type PenaltyStatus = 'OPEN' | 'APPLIED' | 'WITHDRAWN' | 'EXPIRED';

export type Penalty = {
  id: string;
  code: string;
  status: PenaltyStatus;
  points: number;
  reason: string;
  issuedAt: string;
  /** The window in which the provider may put their case. */
  replyDeadline: string | null;
  providerReply: string | null;
  finePaisa: number;
};

export type AppealGrounds = string;

export type Appeal = {
  id: string;
  penaltyId: string;
  grounds: AppealGrounds;
  status: 'OPEN' | 'UPHELD' | 'REVERSED' | 'PARTIAL';
  decisionNote: string | null;
  finePaisa: number | null;
  submittedAt: string;
};

export type ProviderDispute = {
  id: string;
  bookingCode: string;
  origin: string;
  status: string;
  replyDueAt: string | null;
  providerReplied: boolean;
  resolution: string | null;
};

export type ProviderDisputeDetail = ProviderDispute & {
  customerStatement: string | null;
  providerStatement: string | null;
  evidence: { id: string; kind: string; url: string; createdAt: string }[];
};

/* ---- Documents -----------------------------------------------------------
   Added by the backend in the 5 Oct handoff. This endpoint did **not** exist when
   these screens were first written, and BACKEND_REQUIREMENTS §6.1 said so — that
   entry is now wrong and has been corrected.

   Upload is presigned, not a single POST:
     POST /uploads/presign  →  a target URL
     PUT  <that URL>        →  the file bytes
     POST /provider/documents  →  confirm, returns 201
   See `presignUpload` below. */

/** `provider_document_kind` in the schema. */
export type ProviderDocumentKind = 'CNIC_FRONT' | 'CNIC_BACK' | 'TRADE_CERTIFICATE' | 'CHARACTER_CERTIFICATE';

export type ProviderDocument = {
  id: string;
  kind: ProviderDocumentKind;
  /** Object key, not a public URL. Resolve it through the storage route. */
  objectKey: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  rejectionReason: string | null;
  uploadedAt: string;
  reviewedAt: string | null;
};

export type ProviderDocumentInput = { kind: ProviderDocumentKind; objectKey: string };

/** What `POST /uploads/presign` returns. */
export type PresignedUpload = {
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
  objectKey: string;
  /** PUT the bytes to `url` directly — do not route this through `apiRequest`. */
  expiresAt: string;
};

/** Only defined keys are sent: the provider write schemas are `.strict()`. */
const compact = <T extends Record<string, unknown>>(input: T): Partial<T> => {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) if (value !== undefined) out[key] = value;
  return out as Partial<T>;
};

export const providerApi = {
  profile: (options?: ProviderOptions) => call<ProviderProfile>('/provider/profile', {}, options),
  updateProfile: (input: ProviderProfileInput, options?: ProviderOptions) => call<ProviderProfile>('/provider/profile', { method: 'PATCH', body: compact(input) }, options),

  /* ---- Services ---- */
  services: (options?: ProviderOptions) => call<{ items: ProviderService[] }>('/provider/services', {}, options),
  setServicePrice: (serviceId: number, input: SetProviderServiceInput, options?: ProviderOptions) =>
    call<ProviderService>(`/provider/services/${serviceId}`, { method: 'PUT', body: compact(input) }, options),
  removeService: (serviceId: number, options?: ProviderOptions) => call<undefined>(`/provider/services/${serviceId}`, { method: 'DELETE' }, options),

  /* ---- Areas ---- */
  serviceAreas: (options?: ProviderOptions) => call<{ items: ProviderServiceArea[] }>('/provider/service-areas', {}, options),
  setServiceAreas: (areaIds: number[], options?: ProviderOptions) => call<{ items: ProviderServiceArea[] }>('/provider/service-areas', { method: 'PUT', body: { areaIds } }, options),

  /* ---- Availability ---- */
  availability: (options?: ProviderOptions) => call<Availability>('/provider/availability', {}, options),
  setAvailability: (blocks: AvailabilityBlock[], options?: ProviderOptions) => call<Availability>('/provider/availability', { method: 'PUT', body: { items: blocks } }, options),

  timeOff: (options?: ProviderOptions) => call<{ items: TimeOff[] }>('/provider/time-off', {}, options),
  addTimeOff: (input: TimeOffInput, options?: ProviderOptions) =>
    call<{ id: string; start: string; end: string; reason: string | null }>('/provider/time-off', { method: 'POST', body: compact(input) }, options),
  removeTimeOff: (id: string, options?: ProviderOptions) => call<undefined>(`/provider/time-off/${encodeURIComponent(id)}`, { method: 'DELETE' }, options),

  /* ---- Offers ---- */
  offers: (options?: ProviderOptions) => call<{ items: ProviderOffer[] }>('/provider/offers', {}, options),
  acceptOffer: (offerId: string, options?: ProviderOptions) => call<import('@/features/booking/api').Booking>(`/provider/offers/${encodeURIComponent(offerId)}/accept`, { method: 'POST' }, options),
  declineOffer: (offerId: string, reason?: string, options?: ProviderOptions) =>
    call<undefined>(`/provider/offers/${encodeURIComponent(offerId)}/decline`, { method: 'POST', body: compact({ reason }) }, options),

  /* ---- Money ---- */
  earnings: (options?: ProviderOptions) => call<Earnings>('/provider/earnings', {}, options),
  wallet: (options?: ProviderOptions) => call<Wallet>('/provider/wallet', {}, options),
  payouts: (options?: ProviderOptions) => call<{ items: Payout[] }>('/provider/payouts', {}, options),
  requestPayout: (input: PayoutRequestInput, options?: ProviderOptions) => call<PayoutRequestResult>('/provider/payouts', { method: 'POST', body: compact(input) }, options),
  payoutAccounts: (options?: ProviderOptions) => call<{ items: PayoutAccount[] }>('/provider/payout-accounts', {}, options),
  addPayoutAccount: (input: PayoutAccountInput, options?: ProviderOptions) => call<PayoutAccount>('/provider/payout-accounts', { method: 'POST', body: compact(input) }, options),
  /** `payDebtSchema` takes an optional amount — omitting it pays the whole debt.
    It starts an online payment and answers with where to send the browser, so it
    is not a `Wallet` and the caller has to follow the redirect. */
  payDebt: (amountPaisa: number | undefined, options?: ProviderOptions) =>
    call<{ paymentId?: string; redirectUrl: string }>('/provider/debt/pay', { method: 'POST', body: compact({ amountPaisa }) }, options),

  /* ---- Documents ---- */
  documents: (options?: ProviderOptions) => call<{ items: ProviderDocument[] }>('/provider/documents', {}, options),
  submitDocument: (input: ProviderDocumentInput, options?: ProviderOptions) => call<ProviderDocument>('/provider/documents', { method: 'POST', body: compact(input) }, options),

  /* ---- Reputation ---- */
  ratings: (options?: ProviderOptions) => call<ProviderRatings>('/provider/ratings', {}, options),
  replyToRemark: (remarkId: string, body: string, options?: ProviderOptions) =>
    call<ProviderRating>(`/provider/remarks/${encodeURIComponent(remarkId)}/reply`, { method: 'POST', body: { body } }, options),

  /* ---- Conduct ---- */
  conduct: (options?: ProviderOptions) => call<Conduct>('/provider/conduct', {}, options),
  penalties: (options?: ProviderOptions) => call<{ items: Penalty[] }>('/provider/penalties', {}, options),
  penalty: (id: string, options?: ProviderOptions) => call<Penalty>(`/provider/penalties/${encodeURIComponent(id)}`, {}, options),
  replyToPenalty: (id: string, body: string, options?: ProviderOptions) => call<Penalty>(`/provider/penalties/${encodeURIComponent(id)}/reply`, { method: 'POST', body: { body } }, options),
  appealPenalty: (id: string, grounds: string, options?: ProviderOptions) => call<Appeal>(`/provider/penalties/${encodeURIComponent(id)}/appeal`, { method: 'POST', body: { grounds } }, options),

  /* ---- Disputes ---- */
  disputes: (options?: ProviderOptions) => call<{ items: ProviderDispute[] }>('/provider/disputes', {}, options),
  dispute: (id: string, options?: ProviderOptions) => call<ProviderDisputeDetail>(`/provider/disputes/${encodeURIComponent(id)}`, {}, options),
  replyToDispute: (id: string, body: string, options?: ProviderOptions) =>
    call<ProviderDisputeDetail>(`/provider/disputes/${encodeURIComponent(id)}/reply`, { method: 'POST', body: { body } }, options)
};
