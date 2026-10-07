/* The rest of the ADMIN surface: complaints, disputes, conduct (penalties and
   appeals), settings, notification templates and the delivery log.
 *
 * Read from the controllers and services, not from the mock screens these replace.
 * The shapes that matter, and the ones a screen gets wrong most easily:
 *
 * · **`slaRemainingMinutes` and `slaBreached` are the server's.** The complaint
 *   queue computes them from `sla_due_at` and the current time, and orders open
 *   first, SAFETY at the top, then by how soon the SLA runs out. A screen that
 *   re-derives a deadline in the browser will disagree with the server by the time
 *   the row is read, and the ordering it was sorted by is then wrong too. So the
 *   order the API sent is the order shown — re-sorting would discard the
 *   server's own judgement about what is urgent.
 *
 * · **A resolution is not free text.** `RESOLUTIONS` is a closed set and three of
 *   its members take extra required-ish fields (`refundPaisa`, `suspensionDays`,
 *   `breachCode`), which is why the decision form on the complaints screen is built
 *   from the enum rather than from a text box.
 *
 * · **PARTIAL_RELEASE is the only dispute ruling that takes an amount**, and the
 *   split always has to add up to exactly what was held — so the form says what is
 *   held and refuses to send a release larger than it.
 *
 * · **`apply` on a penalty is refused with 409 until the provider has replied or 48
 *   hours have passed.** That right of reply is the reason the button is gated in
 *   the UI rather than left to fail.
 */

import { apiRequest, type ApiRequest } from '@/lib/api/client';
import type { Locale } from '@/lib/utils';

/* ---- complaints ---------------------------------------------------------- */

export type ComplaintStatus = 'OPEN' | 'UNDER_REVIEW' | 'AWAITING_RESPONSE' | 'RESOLVED' | 'REJECTED';
export type ComplaintSeverity = 'SAFETY' | 'HIGH' | 'NORMAL';

/** `RESOLUTIONS` in complaints.schemas.ts. Mirrored, not imported — see the note
    on `CUSTOMER_CATEGORIES` in features/complaints/api.ts for why. */
export const RESOLUTIONS = ['NO_ACTION', 'WARNING', 'PARTIAL_REFUND', 'FULL_REFUND', 'PROVIDER_PENALTY', 'TEMPORARY_SUSPENSION', 'PERMANENT_BLOCK'] as const;
export type Resolution = (typeof RESOLUTIONS)[number];

/** The closed set of statuses `transition` accepts as a *target*. Note that OPEN
    is absent: `open` is where everything starts, and moving *back* to it is a 409. */
export const COMPLAINT_TARGETS = ['UNDER_REVIEW', 'AWAITING_RESPONSE', 'RESOLVED', 'REJECTED'] as const;
export type ComplaintTarget = (typeof COMPLAINT_TARGETS)[number];

export type AdminComplaintRow = {
  id: string;
  bookingId: string | null;
  bookingCode: string | null;
  raisedBy: string | null;
  against: string;
  source: string;
  category: string;
  severity: string;
  status: string;
  description: string;
  slaDueAt: string;
  assignedTo: string | null;
  resolution: string | null;
  resolutionNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
  raisedByName: string | null;
  againstName: string;
  /** Server-computed. Negative once missed. Never recomputed in the browser. */
  slaRemainingMinutes: number;
  slaBreached: boolean;
};

export type AdminComplaintDetail = AdminComplaintRow & {
  booking: { status: string; paymentMode: string; finalAmountPaisa: number | null } | null;
  disputes: { id: string; status: string; origin: string }[];
  penalties: { id: string; breachCode: string; status: string }[];
  timeline: { id: string; kind: string; body: string | null; createdAt: string; actorUserId: string | null }[];
};

export type ComplaintQueueFilters = { status?: ComplaintStatus; severity?: ComplaintSeverity; assignedTo?: string; open?: 'true' | 'false' };

export type ComplaintTransitionInput = {
  to: ComplaintTarget;
  note?: string;
  resolution?: Resolution;
  refundPaisa?: number;
  breachCode?: string;
  excessPaisa?: number;
  suspensionDays?: number;
};

/* ---- disputes ----------------------------------------------------------- */

export type DisputeStatus = 'OPEN' | 'AWAITING_PROVIDER_REPLY' | 'READY' | 'RESOLVED';

export type DisputeRuling = 'FULL_RELEASE' | 'PARTIAL_RELEASE' | 'FULL_REFUND' | 'REFUND_WITH_PENALTY';

export type DisputeRow = {
  id: string;
  bookingCode: string;
  origin: string;
  status: string;
  /** Null until the provider has been asked. Null is not "not yet due". */
  replyDueAt: string | null;
  providerReplied: boolean;
  createdAt: string;
  resolution: string | null;
  provider: string | null;
};

export type DisputeResolveInput = {
  resolution: DisputeRuling;
  note: string;
  /** PARTIAL_RELEASE only. The rest goes back to the customer. */
  releasePaisa?: number;
  /** Required when ruling before the reply window closes with no reply. */
  overrideReason?: string;
  /** REFUND_WITH_PENALTY only. */
  breachCode?: string;
  excessPaisa?: number;
};

/* ---- conduct ------------------------------------------------------------ */

export type PenaltyStatus = 'PROPOSED' | 'APPLIED' | 'APPEALED' | 'UPHELD' | 'REVERSED' | 'WITHDRAWN';
export type AppealStatus = 'OPEN' | 'UPHELD' | 'REVERSED' | 'PARTIAL';

export type PenaltyRow = {
  id: string;
  providerId: string;
  breachCode: string;
  breachName: string;
  category: string;
  points: number;
  status: string;
  bookingCode: string | null;
  finePaisa: number;
  /** The provider's 48-hour right of reply. `apply` is refused until it closes. */
  replyDueAt: string;
  providerReply: string | null;
  repliedAt: string | null;
  /** Free-form JSON recorded by the proposing admin. */
  evidence: unknown;
  appliedAt: string | null;
  createdAt: string;
};

export type AppealRow = {
  id: string;
  penaltyId: string;
  providerId: string;
  grounds: string;
  status: string;
  decisionNote: string | null;
  createdAt: string;
  decidedAt: string | null;
  breachCode: string;
  finePaisa: number;
};

export type AppealDecisionInput = { decision: AppealStatus & 'OPEN' extends never ? never : 'UPHELD' | 'REVERSED' | 'PARTIAL'; note: string; refundFinePaisa?: number };

export type ProposePenaltyInput = {
  providerId: string;
  breachCode: string;
  bookingId?: string;
  complaintId?: string;
  disputeId?: string;
  excessPaisa?: number;
  evidence?: Record<string, unknown>;
};

/* ---- settings ----------------------------------------------------------- */

/** The value union in `settingUpdateSchema`. Settings are heterogeneous, so this
    is genuinely a union rather than a convenience type. */
export type SettingValue = string | number | boolean | null | string[] | Record<string, string | number | boolean | null>;

export type SettingRow = { key: string; value: SettingValue; description: string; updatedAt: string };

/* ---- notification templates -------------------------------------------- */

export type Channel = 'SMS' | 'EMAIL' | 'IN_APP' | 'WHATSAPP';
export type NotificationStatus = 'QUEUED' | 'SENT' | 'DELIVERED' | 'FAILED' | 'READ';

export type TemplateRow = {
  id: string;
  eventKey: string;
  channel: string;
  locale: string;
  subject: string | null;
  body: string;
  isActive: boolean;
  updatedAt: string;
};

export type NotificationLogRow = {
  id: string;
  userId: string;
  /** The phone or email the notification went to, from `users`. */
  recipient: string | null;
  eventKey: string;
  channel: string;
  status: string;
  error: string | null;
  attempts: number | null;
  templateId: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
};

/* ---- provider documents (admin side) ------------------------------------ */

/** `review_status` minus PENDING — a decision has to be a decision. */
export const REVIEW_DECISIONS = ['VERIFIED', 'REJECTED'] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

export type AdminDocumentRow = {
  id: string;
  providerId: string;
  docType: string;
  status: string;
  /** Never rendered: it is a storage key, not a URL. Use the signed-url route. */
  storageKey: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  createdAt: string;
};

export type AdminApiOptions = { signal?: AbortSignal; locale?: Locale };

const call = <T>(path: string, init: ApiRequest = {}, options?: AdminApiOptions): Promise<T> =>
  apiRequest<T>(path, {
    ...init,
    ...(options?.locale === undefined ? {} : { locale: options.locale }),
    ...(options?.signal === undefined ? {} : { signal: options.signal })
  });

const query = (filters: Record<string, string | number | undefined>): Record<string, string | number> => {
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(filters)) if (value !== undefined && value !== '') out[key] = value;
  return out;
};

export const casesApi = {
  /** `GET /admin/complaints` — the queue, already ordered by the server. */
  queue: (filters: ComplaintQueueFilters = {}, options?: AdminApiOptions) =>
    call<{ items: AdminComplaintRow[] }>('/admin/complaints', { query: query({ status: filters.status, severity: filters.severity, assignedTo: filters.assignedTo, open: filters.open }) }, options),

  /** The complaint with its booking, disputes, penalties and whole timeline. */
  one: (id: string, options?: AdminApiOptions) => call<AdminComplaintDetail>(`/admin/complaints/${encodeURIComponent(id)}`, {}, options),

  /** `{}` takes it yourself; `{ assigneeId }` gives it to an admin or an agent. */
  assign: (id: string, assigneeId?: string, options?: AdminApiOptions) =>
    call<unknown>(`/admin/complaints/${encodeURIComponent(id)}/assign`, { method: 'POST', body: assigneeId === undefined ? {} : { assigneeId } }, options),

  /** Any other move is a 409. Closing needs a note. */
  transition: (id: string, input: ComplaintTransitionInput, options?: AdminApiOptions) =>
    call<unknown>(`/admin/complaints/${encodeURIComponent(id)}/transition`, { method: 'POST', body: { ...input } }, options),

  /** Freezes the job's money so it cannot be released while a ruling is pending. */
  openDispute: (id: string, options?: AdminApiOptions) => call<unknown>(`/admin/complaints/${encodeURIComponent(id)}/open-dispute`, { method: 'POST' }, options)
};

export const disputesApi = {
  /** Open disputes first, then oldest, with the reply deadline. */
  list: (status?: DisputeStatus, options?: AdminApiOptions) => call<{ items: DisputeRow[] }>('/admin/disputes', { query: query({ status }) }, options),

  /** The evidence floor: the money held, the start code, the geofence, the photos,
      the checklist, the invoice, the verifications, the calls, the complaints. */
  evidence: (id: string, options?: AdminApiOptions) => call<Record<string, unknown>>(`/admin/disputes/${encodeURIComponent(id)}`, {}, options),

  /** `overrideReason` is required (409) when ruling before the reply window
      closes without a reply. */
  resolve: (id: string, input: DisputeResolveInput, options?: AdminApiOptions) => call<unknown>(`/admin/disputes/${encodeURIComponent(id)}/resolve`, { method: 'POST', body: { ...input } }, options)
};

export const conductApi = {
  list: (filters: { status?: PenaltyStatus; providerId?: string } = {}, options?: AdminApiOptions) =>
    call<{ items: PenaltyRow[] }>('/admin/penalties', { query: query({ status: filters.status, providerId: filters.providerId }) }, options),

  get: (id: string, options?: AdminApiOptions) => call<PenaltyRow>(`/admin/penalties/${encodeURIComponent(id)}`, {}, options),

  /** Proposes only. Nothing happens to the provider until `apply`. */
  propose: (input: ProposePenaltyInput, options?: AdminApiOptions) => call<PenaltyRow>('/admin/penalties', { method: 'POST', body: { ...input } }, options),

  /** 409 until the provider has replied or the 48 hours have passed. */
  apply: (id: string, options?: AdminApiOptions) => call<unknown>(`/admin/penalties/${encodeURIComponent(id)}/apply`, { method: 'POST' }, options),

  withdraw: (id: string, reason: string, options?: AdminApiOptions) => call<unknown>(`/admin/penalties/${encodeURIComponent(id)}/withdraw`, { method: 'POST', body: { reason } }, options),

  appeals: (status?: AppealStatus, options?: AdminApiOptions) => call<{ items: AppealRow[] }>('/admin/appeals', { query: query({ status }) }, options),

  /** UPHELD changes nothing, REVERSED undoes the penalty exactly, PARTIAL refunds
      part of the fine and keeps the points. */
  decideAppeal: (id: string, input: { decision: 'UPHELD' | 'REVERSED' | 'PARTIAL'; note: string; refundFinePaisa?: number }, options?: AdminApiOptions) =>
    call<unknown>(`/admin/appeals/${encodeURIComponent(id)}/decide`, { method: 'POST', body: { ...input } }, options)
};

export const settingsApi = {
  /** `?q=` is a substring match against key *and* description. */
  list: (q?: string, options?: AdminApiOptions) => call<{ items: SettingRow[] }>('/admin/settings', { query: query({ q }) }, options),

  read: (key: string, options?: AdminApiOptions) => call<{ key: string; value: SettingValue; configured: boolean }>(`/admin/settings/${encodeURIComponent(key)}`, {}, options),

  /** Takes effect immediately and is written to the audit log. */
  update: (key: string, value: SettingValue, options?: AdminApiOptions) => call<unknown>(`/admin/settings/${encodeURIComponent(key)}`, { method: 'PUT', body: { value } }, options)
};

export const notificationsApi = {
  /** The delivery log, newest first. */
  log: (filters: { userId?: string; eventKey?: string; channel?: Channel; status?: NotificationStatus; limit?: number } = {}, options?: AdminApiOptions) =>
    call<{ items: NotificationLogRow[] }>(
      '/admin/notifications',
      { query: query({ userId: filters.userId, eventKey: filters.eventKey, channel: filters.channel, status: filters.status, limit: filters.limit }) },
      options
    ),

  /** Every template per event x channel x language, plus the placeholders the
      system will fill in. */
  templates: (filters: { eventKey?: string; channel?: Channel; locale?: 'en' | 'ur' } = {}, options?: AdminApiOptions) =>
    call<{ items: TemplateRow[]; variables: string[] }>('/admin/templates', { query: query({ eventKey: filters.eventKey, channel: filters.channel, locale: filters.locale }) }, options),

  template: (id: string, options?: AdminApiOptions) => call<TemplateRow>(`/admin/templates/${encodeURIComponent(id)}`, {}, options),

  /** Renders a draft with sample values and lists any placeholder the system would
      not fill in. Saves nothing. */
  preview: (input: { body: string; subject?: string | null; variables?: Record<string, string> }, options?: AdminApiOptions) =>
    call<{ rendered: string; missing: string[] }>('/admin/templates/preview', { method: 'POST', body: { ...input } }, options),

  create: (input: { eventKey: string; channel: Channel; locale: 'en' | 'ur'; subject?: string | null; body: string; isActive?: boolean }, options?: AdminApiOptions) =>
    call<TemplateRow>('/admin/templates', { method: 'POST', body: { ...input } }, options),

  update: (id: string, input: { subject?: string | null; body: string; isActive?: boolean }, options?: AdminApiOptions) =>
    call<TemplateRow>(`/admin/templates/${encodeURIComponent(id)}`, { method: 'PUT', body: { ...input } }, options)
};

export const providerDocumentsApi = {
  /** The documents plus the CNIC review state that gates approval. */
  listForProvider: (providerId: string, options?: AdminApiOptions) =>
    call<{ items: AdminDocumentRow[]; cnic: { hasCnic: boolean; cnicVerified: boolean } }>(`/admin/providers/${encodeURIComponent(providerId)}/documents`, {}, options),

  /** A five-minute signed link. Every call is audited — who looked at whose CNIC. */
  signedUrl: (documentId: string, options?: AdminApiOptions) => call<{ url: string; expiresAt: string }>(`/admin/documents/${encodeURIComponent(documentId)}/url`, {}, options),

  /** A rejection requires a note: it is what the provider is told. */
  review: (documentId: string, input: { status: ReviewDecision; note?: string }, options?: AdminApiOptions) =>
    call<AdminDocumentRow>(`/admin/documents/${encodeURIComponent(documentId)}/review`, { method: 'POST', body: { ...input } }, options)
};
