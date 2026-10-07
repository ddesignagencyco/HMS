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

const call = <T>(path: string, init: ApiRequest = {}, options?: AdminApiOptions): Promise<T> =>
  apiRequest<T>(path, {
    ...init,
    ...(options?.locale === undefined ? {} : { locale: options.locale }),
    ...(options?.signal === undefined ? {} : { signal: options.signal })
  });

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

  rejectProvider: (providerId: string, options?: AdminApiOptions) =>
    call<{ providerId: string; status: string }>(`/admin/providers/${encodeURIComponent(providerId)}/reject`, { method: 'POST' }, options),

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
    call<unknown>(`/admin/provider-services/${encodeURIComponent(providerId)}/${serviceId}/reject`, { method: 'POST' }, options)
};

/** One person's name, from the two fields the API splits it into. */
export const personName = (row: { firstName: string; lastName: string }): string =>
  [row.firstName, row.lastName]
    .filter((part) => part !== '')
    .join(' ')
    .trim();
