/* `POST /complaints`, `GET /complaints` and the single-complaint view.

   Typed from `complaints.schemas.ts` and `ComplaintsService`, because the screen
   this serves had none of it: the complaint form lived in `customer-views.tsx`
   with invented category slugs (`scope`) that are not in `CATEGORIES`, and posted
   nothing.

   Two things about this contract that shape the UI:

   · **The category list is not symmetric.** A customer raises MISBEHAVIOUR,
     QUALITY, OVERCHARGE, NO_SHOW, SAFETY, CASH_DISCREPANCY or OTHER. NON_PAYMENT,
     UNSAFE_PREMISES and ABUSE exist in the same enum but are for a provider
     complaining about their customer. Sending one is accepted by the schema and
     nonsense for the person raising it, so the picker offers only the
     customer-facing half.
   · **`SAFETY` and `UNSAFE_PREMISES` are urgent**: one-hour SLA and the admins
     are alerted at once. The screen says so where the customer picks it, because
     the alternative is discovering it from a clock. */

import { apiRequest, type ApiRequest } from '@/lib/api/client';
import type { Locale } from '@/lib/utils';

/** `CATEGORIES` in complaints.schemas.ts. */
export type ComplaintCategory = 'MISBEHAVIOUR' | 'QUALITY' | 'OVERCHARGE' | 'NO_SHOW' | 'SAFETY' | 'NON_PAYMENT' | 'UNSAFE_PREMISES' | 'ABUSE' | 'CASH_DISCREPANCY' | 'OTHER';

/**
 * What a *customer* may pick.
 *
 * `NON_PAYMENT`, `UNSAFE_PREMISES` and `ABUSE` are in the enum because a provider
 * raises them against a customer. The schema accepts them from either party, which
 * is the API's business; offering them to a customer would be offering them to
 * complain about themselves.
 */
export const CUSTOMER_CATEGORIES: readonly ComplaintCategory[] = ['QUALITY', 'MISBEHAVIOUR', 'OVERCHARGE', 'NO_SHOW', 'SAFETY', 'CASH_DISCREPANCY', 'OTHER'];

/** `UNSAFE_PREMISES` is the provider's urgent one; this is the customer's. */
export const URGENT_CATEGORIES: readonly ComplaintCategory[] = ['SAFETY'];

export type ComplaintStatus = 'OPEN' | 'UNDER_REVIEW' | 'AWAITING_RESPONSE' | 'RESOLVED' | 'REJECTED';
export type ComplaintSeverity = 'SAFETY' | 'HIGH' | 'NORMAL';
export type ComplaintSource = 'CUSTOMER' | 'PROVIDER' | 'RECEIPT_LINK' | 'DISPUTE';
export type ComplaintResolution = 'NO_ACTION' | 'WARNING' | 'PARTIAL_REFUND' | 'FULL_REFUND' | 'PROVIDER_PENALTY' | 'TEMPORARY_SUSPENSION' | 'PERMANENT_BLOCK';

/** `ComplaintsService.head` joined to the two parties' names. */
export type Complaint = {
  id: string;
  /** Null when the complaint is not about a booking. */
  bookingId: string | null;
  bookingCode: string | null;
  raisedBy: string | null;
  against: string;
  source: ComplaintSource;
  category: ComplaintCategory;
  severity: ComplaintSeverity;
  status: ComplaintStatus;
  description: string;
  slaDueAt: string;
  assignedTo: string | null;
  resolution: ComplaintResolution | null;
  resolutionNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
  raisedByName: string | null;
  againstName: string;
  /**
   * Minutes left on the SLA. **Negative once breached** — it is a signed
   * remainder, not a duration, so the screen must not clamp it to zero or a
   * breached complaint will read as "on time".
   */
  slaRemainingMinutes: number;
  slaBreached: boolean;
};

/** One row of `complaint_events`, from `ComplaintsService.timeline`. */
export type ComplaintEvent = {
  id: string;
  /** Null for a system event, such as a status change nobody made by hand. */
  actorUserId: string | null;
  type: string;
  fromStatus: ComplaintStatus | null;
  toStatus: ComplaintStatus | null;
  body: string | null;
  createdAt: string;
  /** A signed path under the API's dev storage route, not a public URL. */
  evidenceUrl: string | null;
};

/** What `GET /complaints/:id` adds on top of the head row. */
export type ComplaintDetail = Complaint & {
  /** Which side of it the caller is on. Decides whether a reply is a defence. */
  youAre: 'COMPLAINANT' | 'RESPONDENT';
  timeline: ComplaintEvent[];
};

export type ComplaintPhotoInput = {
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  contentBase64: string;
};

/** `complaintCreateSchema` — `.strict()`, and `description` needs 10 characters. */
export type ComplaintCreateInput = {
  bookingId: string;
  category: ComplaintCategory;
  description: string;
  photos?: ComplaintPhotoInput[];
};

/** `complaintCreateSchema` caps `photos` at five. */
export const MAX_COMPLAINT_PHOTOS = 5;

/** `complaintCreateSchema`. */
export const MIN_COMPLAINT_DESCRIPTION = 10;

/** `complaintCreateSchema`. */
export const MAX_COMPLAINT_DESCRIPTION = 3000;

/** `complaintReplySchema` takes `{ body }`, 1–3000 characters. */
export type ComplaintReplyInput = { body: string };

export type ComplaintOptions = { signal?: AbortSignal; locale?: Locale };

const call = <T>(path: string, request: ApiRequest = {}, options?: ComplaintOptions) =>
  apiRequest<T>(path, {
    ...request,
    ...(options?.locale === undefined ? {} : { locale: options.locale }),
    ...(options?.signal === undefined ? {} : { signal: options.signal })
  });

export const complaintsApi = {
  /**
   * `POST /complaints` — returns the complaint as `viewFor` presents it, so the
   * screen that raised it has the timeline and `youAre` without a second request.
   */
  create: (input: ComplaintCreateInput, options?: ComplaintOptions) => call<ComplaintDetail>('/complaints', { method: 'POST', body: input }, options),

  listMine: (options?: ComplaintOptions) => call<{ items: Complaint[] }>('/complaints', {}, options),

  one: (id: string, options?: ComplaintOptions) => call<ComplaintDetail>(`/complaints/${encodeURIComponent(id)}`, {}, options),

  /**
   * `POST /complaints/:id/reply`.
   *
   * A respondent's reply puts a complaint that was waiting on them back under
   * review; a complainant's is a further comment. One field, two meanings — the
   * server decides from which side the caller is on, so the screen must not send
   * a flag saying which it thinks it is.
   */
  reply: (id: string, body: string, options?: ComplaintOptions) => call<ComplaintDetail>(`/complaints/${encodeURIComponent(id)}/reply`, { method: 'POST', body: { body } }, options),

  /** `complaintEvidenceSchema` is the photo on its own, not wrapped in `photos`. */
  addEvidence: (id: string, photo: ComplaintPhotoInput, options?: ComplaintOptions) => call<ComplaintEvent>(`/complaints/${encodeURIComponent(id)}/evidence`, { method: 'POST', body: photo }, options)
};
