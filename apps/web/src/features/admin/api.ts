/* The ADMIN surface (apps/api/src/admin/*, plus the admin routes on the
   complaints, conduct, provider and catalogue controllers).
 *
 * Every route here is `@PolicyDecorator({ roles: ['ADMIN'], totpRequired: true })`,
   which has two consequences the UI has to respect rather than discover at
   runtime:

   · **Every admin call needs a cleared second factor.** `totpRequired: true` reads
     the `totp` claim on the *access token*, not the database — the same rule
     `SessionProvider.confirmTotp` already handles. A staff member who enrolled but
     has not completed the challenge is redirected to `/auth/totp` by the workspace
     gate before reaching any of this, and a 403 TOTP_REQUIRED from any of these
     calls is the server restating that, not a permissions problem.

   · **A 403 here is not "no permission to read this row".** It is "this session
     is not an admin session", so it must never be rendered as an empty list — that
     is the difference between "there are no complaints" and "you cannot see them".

   Row shapes are taken from the service, not from the old screens. That matters
   most for `CustomerRow`, which the previous `AdminCustomers` screen filled out
   with a booking count, a lifetime-spend figure and an area — **none of which the
   endpoint returns**. There is no admin bookings list and no per-customer total,
   so those columns are gone rather than filled with an estimate. */

import { apiRequest, type ApiRequest } from '@/lib/api/client';
import type { Locale } from '@/lib/utils';

/** `provider_status` / `user_status` as the database spells them. */
export const USER_STATUSES = ['ACTIVE', 'LOCKED', 'DEACTIVATED'] as const;
export const ASSIGNABLE_ROLES = ['CUSTOMER', 'PROVIDER', 'AGENT', 'FINANCE', 'ADMIN'] as const;

/** `provider_status`, which is a different and larger enum than `USER_STATUSES`. */
export const PROVIDER_STATUSES = ['PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'SUSPENDED', 'BLOCKED', 'DEACTIVATED'] as const;

export type UserStatus = (typeof USER_STATUSES)[number];
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];
export type ProviderStatus = (typeof PROVIDER_STATUSES)[number];

/** `listUsersQuerySchema` is `.strict()`, so an unknown filter is a 422. */
export type AdminUserRow = {
  id: string;
  email: string | null;
  phoneE164: string | null;
  firstName: string;
  lastName: string;
  status: string;
  /** `array_agg` over `user_roles`; an empty array for an account with no role. */
  roles: string[];
  createdAt: string;
};

/** Same people, keyed on `userId` because the customers table owns the identity. */
export type AdminCustomerRow = {
  userId: string;
  email: string | null;
  phoneE164: string | null;
  firstName: string;
  lastName: string;
  status: string;
  /** The `customers` row's own `created_at`, not the `users` row's. */
  createdAt: string;
};

export type RoleRow = { code: string; name: string; permissions: string[] };

export type StaffConflictRow = {
  id: string;
  staffUserId: string;
  otherUserId: string;
  reason: string;
  createdBy: string;
  createdAt: string;
};

/** `before`/`after` are Prisma JSON — null, or any shape the caller wrote. */
export type AuditRow = {
  id: string;
  actorUserId: string | null;
  actorRole: string;
  action: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
  createdAt: string;
};

/** What every status change answers. `status` is the new value, not the old one. */
export type UserStatusResult = { id: string; status: string };

/** `limit` is coerced and defaulted to 50 by the schema, capped at 200. */
const MAX_LIMIT = 200;

export type AdminApiOptions = { signal?: AbortSignal; locale?: Locale };

export type ListUsersFilters = { role?: AssignableRole; status?: UserStatus; q?: string; limit?: number };
export type ListCustomersFilters = { q?: string; limit?: number };
export type AuditFilters = {
  action?: string;
  actorUserId?: string;
  entityType?: string;
  entityId?: string;
  from?: string;
  to?: string;
  limit?: number;
};

/** `staffConflictCreateSchema` — `reason` is 5–500 characters, and the two ids must differ. */
export type StaffConflictInput = { staffUserId: string; otherUserId: string; reason: string };

/**
 * `GET /finance/escrow` — money the platform is holding on a customer's behalf.
 *
 * `totalHeldPaisa` is the whole figure, computed server-side from the ledger.
 * `items` carries the per-booking detail with `heldPaisa > 0`, newest first, and
 * is capped at 500 rows by the API — so it is a drill-down and must never be
 * summed here to produce the total.
 */
export type EscrowRead = {
  totalHeldPaisa: number;
  items: {
    bookingId: string;
    code: string;
    status: string;
    paymentMode: string;
    providerId: string | null;
    heldPaisa: number;
    /** Null until the provider has closed the job. */
    finalPaisa: number | null;
  }[];
};

const call = <T>(path: string, init: ApiRequest = {}, options?: AdminApiOptions): Promise<T> =>
  apiRequest<T>(path, {
    ...init,
    ...(options?.locale === undefined ? {} : { locale: options.locale }),
    ...(options?.signal === undefined ? {} : { signal: options.signal })
  });

/* ---- the operations board (`GET /admin/ops-board`) -------------------- */

/**
 * One read, from `OpsBoardService.compute()`.
 *
 * **Every figure here is queried from the table it describes**, recomputed on a
 * shared five-second cadence and cached in Redis. That is the whole point of the
 * endpoint: an operations board that had quietly drifted from the thing it
 * reports would be worse than no board at all, so nothing on this screen may be
 * derived, re-summed or cached client-side.
 *
 * Two shapes in here are deliberately not the usual ones:
 *
 * · **`escrow.heldPaisa` is a string.** It is a Postgres int8 handed straight
 *   through (`ops-board.service.ts:137`), so it must go through the same
 *   paisa-to-number conversion as every other money figure before it is shown.
 * · **`alerts` is sorted worst-first by the server.** Rendering it in another
 *   order would hide the thing the endpoint is trying to put at the top.
 */
export type OpsBoard = {
  /** When this snapshot was computed. Not when this browser asked for it. */
  generatedAt: string;
  /** Bookings *created* today, not booked for today. */
  bookingsToday: { total: number; byStatus: Record<string, number> };
  /** Waiting depth per background queue. A number that keeps climbing is the alert. */
  queueDepth: { outbox: number; notifications: number; payments: number; verification: number; projections: number };
  slaBreaches: { verifications: number; complaints: number };
  openDisputes: { total: number; awaitingReply: number };
  escrow: { heldPaisa: string; bookingsHolding: number };
  debtBlockedProviders: number;
  alerts: { severity: 'CRITICAL' | 'WARNING' | 'INFO'; code: string; detail: string; count: number }[];
};

/**
 * `GET /admin/providers/{providerId}/ratings` — `reputation.service.ts:215`.
 *
 * Note what this is for: it is the **moderation** view. The public remarks list
 * never shows an unpublished remark, so an admin has no way to take one back
 * from anywhere else — this screen is the only place `remarkId` and
 * `unpublishedReason` are both available, and therefore the only place
 * `POST /admin/remarks/{id}/unpublish` can be offered.
 */
export type AdminProviderRating = {
  ratingId: string;
  bookingCode: string;
  score: number;
  createdAt: string;
  /** Null when the rating carried no remark, so there is nothing to moderate. */
  remarkId: string | null;
  body: string | null;
  displayName: string | null;
  /** **Null means no remark exists** — not an unpublished one. */
  published: boolean | null;
  unpublishedReason: string | null;
};

/** `CommissionRuleRow` from `catalogue.service.ts:69`. */
export type CommissionRule = {
  id: string;
  scope: 'GLOBAL' | 'CATEGORY' | 'PROVIDER';
  categoryId: number | null;
  providerId: string | null;
  /** Basis points: 1500 is 15%. The API stores and returns integers only. */
  rateBp: number;
  effectiveFrom: string;
  /** Non-null means the rule has been closed and no longer applies. */
  effectiveTo: string | null;
  createdBy: string | null;
  createdAt: string;
};

export type CommissionRuleInput = {
  scope: CommissionRule['scope'];
  /** Required for CATEGORY, forbidden for GLOBAL — the schema refuses a mismatch. */
  categoryId?: number | null;
  /** Required for PROVIDER, forbidden for GLOBAL. */
  providerId?: string | null;
  rateBp: number;
};

/** Drops `undefined` so a filter that is not in use is absent, not empty-string. */
const filterQuery = (filters: Record<string, string | number | undefined>, max = MAX_LIMIT): Record<string, string | number> => {
  const query: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(filters)) if (value !== undefined && value !== '') query[key] = value;
  if (query.limit === undefined) query.limit = 50;
  if (typeof query.limit === 'number' && query.limit > max) query.limit = max;
  return query;
};

export const adminApi = {
  /** `GET /admin/users` — every account, filterable by role, status or a substring. */
  listUsers: (filters: ListUsersFilters = {}, options?: AdminApiOptions) =>
    call<{ items: AdminUserRow[] }>('/admin/users', { query: filterQuery({ role: filters.role, status: filters.status, q: filters.q, limit: filters.limit }) }, options),

  /** `GET /admin/customers` — accounts holding the CUSTOMER side-table. */
  listCustomers: (filters: ListCustomersFilters = {}, options?: AdminApiOptions) =>
    call<{ items: AdminCustomerRow[] }>('/admin/customers', { query: filterQuery({ q: filters.q, limit: filters.limit }) }, options),

  /** Locks the account and revokes every session. 409 if already LOCKED. */
  blockUser: (userId: string, options?: AdminApiOptions) => call<UserStatusResult>(`/admin/users/${encodeURIComponent(userId)}/block`, { method: 'POST' }, options),

  /** Back to ACTIVE. Sessions are **not** resurrected — they sign in afresh. */
  unblockUser: (userId: string, options?: AdminApiOptions) => call<UserStatusResult>(`/admin/users/${encodeURIComponent(userId)}/unblock`, { method: 'POST' }, options),

  /** Soft only (FR-AD-09): the row and its financial history stay. */
  deactivateUser: (userId: string, options?: AdminApiOptions) => call<UserStatusResult>(`/admin/users/${encodeURIComponent(userId)}/deactivate`, { method: 'POST' }, options),

  /**
   * FR-AD-03/04: the reset code goes to the account owner's own phone or email.
   * The admin never sees or sets a password, so this button must never be paired
   * with a password field — and it always answers `{ sent: true }`, so it also
   * never discloses whether the account has a reachable identifier.
   */
  sendPasswordReset: (userId: string, options?: AdminApiOptions) => call<{ sent: true }>(`/admin/users/${encodeURIComponent(userId)}/send-reset`, { method: 'POST' }, options),

  /** The same soft deactivation, on the customers route. */
  deactivateCustomer: (customerId: string, options?: AdminApiOptions) => call<UserStatusResult>(`/admin/customers/${encodeURIComponent(customerId)}/deactivate`, { method: 'POST' }, options),

  /** `GET /admin/roles` — the RBAC matrix, ordered by code. */
  listRoles: (options?: AdminApiOptions) => call<{ items: RoleRow[] }>('/admin/roles', {}, options),

  /** Idempotent (`ON CONFLICT DO NOTHING`). A user may hold several roles. */
  grantRole: (userId: string, roleCode: string, options?: AdminApiOptions) =>
    call<{ userId: string; roleCode: string }>(`/admin/users/${encodeURIComponent(userId)}/roles/${encodeURIComponent(roleCode)}`, { method: 'POST' }, options),

  /** 409 rather than a silent no-op when the user did not hold that role. */
  revokeRole: (userId: string, roleCode: string, options?: AdminApiOptions) =>
    call<{ userId: string; roleCode: string; revoked: true }>(`/admin/users/${encodeURIComponent(userId)}/roles/${encodeURIComponent(roleCode)}`, { method: 'DELETE' }, options),

  /** Declared conflicts of interest (FR-AD-16), newest first. */
  listStaffConflicts: (options?: AdminApiOptions) => call<{ items: StaffConflictRow[] }>('/admin/staff-conflicts', {}, options),

  /** 201. Re-declaring the same pair updates the reason rather than duplicating. */
  declareStaffConflict: (input: StaffConflictInput, options?: AdminApiOptions) => call<StaffConflictRow>('/admin/staff-conflicts', { method: 'POST', body: { ...input } }, options),

  /** 204. */
  removeStaffConflict: (id: string, options?: AdminApiOptions) => call<undefined>(`/admin/staff-conflicts/${encodeURIComponent(id)}`, { method: 'DELETE' }, options),

  /** `GET /admin/audit` — append-only, newest first, filterable by action/actor/entity/time. */
  queryAudit: (filters: AuditFilters = {}, options?: AdminApiOptions) =>
    call<{ items: AuditRow[] }>(
      '/admin/audit',
      {
        query: filterQuery({
          action: filters.action,
          actorUserId: filters.actorUserId,
          entityType: filters.entityType,
          entityId: filters.entityId,
          from: filters.from,
          to: filters.to,
          limit: filters.limit
        })
      },
      options
    ),

  /* ---- providers, on their own side-table -------------------------------- */

  approveProvider: (providerId: string, options?: AdminApiOptions) =>
    call<{ providerId: string; status: string }>(`/admin/providers/${encodeURIComponent(providerId)}/approve`, { method: 'POST' }, options),

  /**
   * `providerRejectSchema` requires a `reason`, and it is what the professional is
   * shown — so it is a parameter here rather than an optional body field.
   */
  rejectProvider: (providerId: string, reason: string, options?: AdminApiOptions) =>
    call<{ providerId: string; status: string }>(`/admin/providers/${encodeURIComponent(providerId)}/reject`, { method: 'POST', body: { reason } }, options),

  /** BLOCKED — stops new work. Distinct from a conduct penalty, which is separate. */
  blockProvider: (providerId: string, options?: AdminApiOptions) =>
    call<{ providerId: string; status: string }>(`/admin/providers/${encodeURIComponent(providerId)}/block`, { method: 'POST' }, options),

  /** Back to APPROVED. */
  unblockProvider: (providerId: string, options?: AdminApiOptions) =>
    call<{ providerId: string; status: string }>(`/admin/providers/${encodeURIComponent(providerId)}/unblock`, { method: 'POST' }, options),

  /** Soft only (FR-AD-09). */
  deactivateProvider: (providerId: string, options?: AdminApiOptions) =>
    call<{ providerId: string; status: string }>(`/admin/providers/${encodeURIComponent(providerId)}/deactivate`, { method: 'POST' }, options),

  /** One provider-service offer, for the approval queue. */
  approveProviderService: (providerId: string, serviceId: number, options?: AdminApiOptions) =>
    call<unknown>(`/admin/provider-services/${encodeURIComponent(providerId)}/${serviceId}/approve`, { method: 'POST' }, options),

rejectProviderService: (providerId: string, serviceId: number, options?: AdminApiOptions) =>
    call<unknown>(`/admin/provider-services/${encodeURIComponent(providerId)}/${encodeURIComponent(String(serviceId))}/reject`, { method: 'POST' }, options),

  /**
   * `GET /finance/escrow` — customer money currently held, and the total.
   *
   * This is a **finance** route, not an admin one, but its policy is
   * `{ roles: ['FINANCE', 'ADMIN'], totpRequired: true }` — so an administrator
   * can read it. That is what makes the escrow total available on the admin
   * landing: it was previously written up as having no backend, which was wrong.
   *
   * `items` is capped at 500 by the server and is only the *held* accounts, so the
   * total is the figure to show and the rows are a drill-down, not a complete
   * list of every booking that has ever moved money.
   */
  escrow: (options?: AdminApiOptions) => call<EscrowRead>(`/finance/escrow`, {}, options),

  /* ---- the operations board --------------------------------------------
   * A **finance** policy (`roles: ['FINANCE', 'ADMIN']`, `totpRequired`) despite
   * living under `/admin`, which is why the admin rail can link to it and why a
   * 403 here is still the second factor rather than the role.
   *
   * Cached in Redis server-side for fifteen seconds and recomputed every five, so
   * it is cheap to poll — but polling is handled by the live stream, not by
   * refetching this on a timer from a dozen open tabs. */

  opsBoard: (options?: AdminApiOptions) => call<OpsBoard>(`/admin/ops-board`, {}, options),

  /* ---- commission rules (`/admin/catalogue/commission-rules`) ----------- */

  /**
   * Rates are **basis points**, not percentages: 100bp is 1%, so the seeded
   * platform rate of 15% is 1500. The screen must not send 15.
   *
   * Global, category and provider rules can overlap and the most specific one
   * applies at booking time — so this list is not "the one current rate", and
   * showing a single highlighted row would misstate how pricing works.
   */
  listCommissionRules: (
    filters: { scope?: CommissionRule['scope']; categoryId?: number; providerId?: string } = {},
    options?: AdminApiOptions
  ) =>
    call<{ items: CommissionRule[] }>(
      '/admin/catalogue/commission-rules',
      {
        query: {
          ...(filters.scope === undefined ? {} : { scope: filters.scope }),
          ...(filters.categoryId === undefined ? {} : { categoryId: filters.categoryId }),
          ...(filters.providerId === undefined ? {} : { providerId: filters.providerId })
        }
      },
      options
    ),

  /**
   * **Creates; it does not replace.** A live rule stays live until it is closed,
   * because a commission rate that changed without a boundary would make every
   * booking priced under the old rate unexplainable afterwards. Close the old one
   * with `endCommissionRule` first — the two are deliberately two actions.
   *
   * 404 if the category or provider does not exist; the schema also refuses a
   * scope/target mismatch (CATEGORY without a `categoryId`) as a 422.
   */
  createCommissionRule: (input: CommissionRuleInput, options?: AdminApiOptions) =>
    call<CommissionRule>('/admin/catalogue/commission-rules', { method: 'POST', body: { ...input } }, options),

  /** Stamps `effectiveTo`. Never a delete — the history they drove has to stay. */
  endCommissionRule: (id: string, options?: AdminApiOptions) =>
    call<CommissionRule>(`/admin/catalogue/commission-rules/${encodeURIComponent(id)}/end`, { method: 'POST' }, options),

  /* ---- remark moderation (`/admin/remarks`) ---------------------------- */

  /**
   * Every rating for a provider, **unpublished remarks included**, with who
   * removed them and why. This is the admin's copy and the public one is not the
   * same list.
   */
  providerRatings: (providerId: string, options?: AdminApiOptions) =>
    call<{ reputation: { score: number | null; ratingCount: number; verifiedJobs: number }; items: AdminProviderRating[] }>(
      `/admin/providers/${encodeURIComponent(providerId)}/ratings`,
      {},
      options
    ),

  /**
   * Hides an abusive remark from the public. **The rating behind it stays in the
   * provider's score** — removing the words must not move the number, which is
   * why this is not a rating deletion.
   *
   * `reason` is 3–500 characters and is kept and audited, so the screen must ask
   * for one rather than posting an empty string. 409 if it is already
   * unpublished.
   */
  unpublishRemark: (remarkId: string, reason: string, options?: AdminApiOptions) =>
    call<{ id: string; published: false }>(`/admin/remarks/${encodeURIComponent(remarkId)}/unpublish`, { method: 'POST', body: { reason } }, options)
};

/** One person's name, from the two fields the API splits it into. */
export const personName = (row: { firstName: string; lastName: string }): string =>
  [row.firstName, row.lastName]
    .filter((part) => part !== '')
    .join(' ')
    .trim();

/**
 * The live board, as Server-Sent Events.
 *
 * A path rather than a method, because this one **cannot go through
 * `apiRequest`**: that reads the body to the end and would wait forever on a
 * stream that stays open by design. It cannot go through `EventSource` either —
 * that cannot send an `Authorization` header, and the board is
 * `totpRequired`. So `useOpsBoardStream` opens it with `fetch` and reads the
 * body as a stream.
 *
 * The server names its event `board` and recomputes on one shared five-second
 * cadence however many streams are open, so an operator with six tabs costs the
 * database one recompute, not six.
 */
export const OPS_BOARD_STREAM_PATH = '/admin/ops-board/stream';
