import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  adminApi,
  type AdminCustomerRow,
  type AdminUserRow,
  type AssignableRole,
  type AuditFilters,
  type ListCustomersFilters,
  type ListUsersFilters,
  type StaffConflictInput,
  type UserStatus
} from '@/features/admin/api';
import { FRESHNESS, adminKeys, publicRetry } from '@/lib/api/keys';
import type { Locale } from '@/lib/utils';

/* Server state for the ADMIN surface.
 *
 * **No mutation here retries.** Every one of these is a privileged decision about
 * another person's account — lock it, deactivate it, take a role away. A retried
 * `POST .../deactivate` is a second attempt at something an operator did once, and
 * the audit log records each one. The read layer may retry a 5xx; this layer may
 * not.
 *
 * **Every mutation invalidates `adminKeys.all`, not just the one list it touched.**
 * These routes mutate shared state: blocking a user changes what the users list
 * says *and* what the audit log just recorded, and granting a role changes both
 * the users list and the role matrix in one person. Narrow invalidation here would
 * leave an admin looking at a status the server has already changed.
 *
 * Short freshness throughout: an operator acting on this data is making decisions
 * about real people, and a stale status is worse than a slow page. */

/* ---- reads ------------------------------------------------------------- */

/**
 * `GET /admin/users`.
 *
 * A 403 here is `totpRequired` failing, not an empty platform — see the note in
 * `api.ts`. `publicRetry` does not retry a 403, so the screen can show it as
 * itself rather than as a list that happens to be empty.
 */
export function useAdminUsers(filters: ListUsersFilters, locale: Locale) {
  const role = filters.role as string | undefined;
  const status = filters.status as string | undefined;
  return useQuery({
    queryKey: adminKeys.users(role, status, filters.q),
    queryFn: ({ signal }) => adminApi.listUsers(filters, { signal, locale }),
    staleTime: FRESHNESS.search.staleTime,
    gcTime: FRESHNESS.search.gcTime,
    retry: publicRetry
  });
}

export function useAdminCustomers(filters: ListCustomersFilters, locale: Locale) {
  return useQuery({
    queryKey: adminKeys.customers(filters.q),
    queryFn: ({ signal }) => adminApi.listCustomers(filters, { signal, locale }),
    staleTime: FRESHNESS.search.staleTime,
    gcTime: FRESHNESS.search.gcTime,
    retry: publicRetry
  });
}

/**
 * `GET /admin/roles` — the RBAC matrix.
 *
 * Reference data, and the longest-lived thing in the admin surface: it changes
 * when a migration does, and every admin session reads the same rows.
 */
export function useAdminRoles(locale: Locale) {
  return useQuery({
    queryKey: adminKeys.roles,
    queryFn: ({ signal }) => adminApi.listRoles({ signal, locale }),
    staleTime: FRESHNESS.categories.staleTime,
    gcTime: FRESHNESS.categories.gcTime,
    retry: publicRetry
  });
}

export function useStaffConflicts(locale: Locale) {
  return useQuery({
    queryKey: adminKeys.staffConflicts,
    queryFn: ({ signal }) => adminApi.listStaffConflicts({ signal, locale }),
    staleTime: FRESHNESS.bookingList.staleTime,
    gcTime: FRESHNESS.bookingList.gcTime,
    retry: publicRetry
  });
}

export function useAuditLog(filters: AuditFilters, locale: Locale) {
  return useQuery({
    queryKey: adminKeys.audit(filters.action, filters.entityType, filters.entityId, filters.from, filters.to),
    queryFn: ({ signal }) => adminApi.queryAudit(filters, { signal, locale }),
    staleTime: FRESHNESS.bookingList.staleTime,
    gcTime: FRESHNESS.bookingList.gcTime,
    retry: publicRetry
  });
}

/**
 * Providers are read through `GET /admin/users?role=PROVIDER`.
 *
 * There is no admin providers list of its own, and that is a real limitation
 * rather than a shortcut: the users route publishes the account's `roles` and
 * `status` (`user_status`) but **not** the `provider_status` the approval queue
 * exists to act on. So a screen built on it can find the professionals and lock an
 * account, but it cannot tell a PENDING_APPROVAL provider from a SUSPENDED one
 * without asking each one. `useAdminUsers` returns `AdminUserRow[]` and the
 * approval screen states that limit rather than inventing the missing status.
 */
export function useAdminProviders(filters: { status?: UserStatus; q?: string; limit?: number }, locale: Locale) {
  return useQuery({
    queryKey: adminKeys.providers(filters.status, filters.q),
    queryFn: ({ signal }) => adminApi.listUsers({ role: 'PROVIDER', ...filters }, { signal, locale }),
    staleTime: FRESHNESS.search.staleTime,
    gcTime: FRESHNESS.search.gcTime,
    retry: publicRetry
  });
}

/* ---- writes ------------------------------------------------------------ */

/**
 * Every privileged write, for one reason: see the note at the top of the file.
 *
 * Named `usePrivilegedAction` because it calls hooks — the name is the contract
 * the `rules-of-hooks` lint rule enforces, and a caller that forgets `use` would
 * otherwise break hook ordering at runtime.
 */
const usePrivilegedAction = <TInput, TResult>(perform: (input: TInput) => Promise<TResult>) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: perform,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: adminKeys.all }),
    retry: false
  });
};

export const useBlockUser = (locale: Locale) => usePrivilegedAction((userId: string) => adminApi.blockUser(userId, { locale }));

export const useUnblockUser = (locale: Locale) => usePrivilegedAction((userId: string) => adminApi.unblockUser(userId, { locale }));

export const useDeactivateUser = (locale: Locale) => usePrivilegedAction((userId: string) => adminApi.deactivateUser(userId, { locale }));

/** FR-AD-03/04. Always answers `{ sent: true }`, so it never confirms an address. */
export const useSendPasswordReset = (locale: Locale) => usePrivilegedAction((userId: string) => adminApi.sendPasswordReset(userId, { locale }));

export const useDeactivateCustomer = (locale: Locale) => usePrivilegedAction((customerId: string) => adminApi.deactivateCustomer(customerId, { locale }));

export const useGrantRole = (locale: Locale) => usePrivilegedAction((input: { userId: string; roleCode: AssignableRole }) => adminApi.grantRole(input.userId, input.roleCode, { locale }));

export const useRevokeRole = (locale: Locale) => usePrivilegedAction((input: { userId: string; roleCode: AssignableRole }) => adminApi.revokeRole(input.userId, input.roleCode, { locale }));

export const useDeclareStaffConflict = (locale: Locale) => usePrivilegedAction((input: StaffConflictInput) => adminApi.declareStaffConflict(input, { locale }));

export const useRemoveStaffConflict = (locale: Locale) => usePrivilegedAction((id: string) => adminApi.removeStaffConflict(id, { locale }));

export const useApproveProvider = (locale: Locale) => usePrivilegedAction((providerId: string) => adminApi.approveProvider(providerId, { locale }));

export const useRejectProvider = (locale: Locale) => usePrivilegedAction((providerId: string) => adminApi.rejectProvider(providerId, { locale }));

export const useBlockProvider = (locale: Locale) => usePrivilegedAction((providerId: string) => adminApi.blockProvider(providerId, { locale }));

export const useUnblockProvider = (locale: Locale) => usePrivilegedAction((providerId: string) => adminApi.unblockProvider(providerId, { locale }));

export const useDeactivateProvider = (locale: Locale) => usePrivilegedAction((providerId: string) => adminApi.deactivateProvider(providerId, { locale }));

export const useApproveProviderService = (locale: Locale) =>
  usePrivilegedAction((input: { providerId: string; serviceId: number }) => adminApi.approveProviderService(input.providerId, input.serviceId, { locale }));

export const useRejectProviderService = (locale: Locale) =>
  usePrivilegedAction((input: { providerId: string; serviceId: number }) => adminApi.rejectProviderService(input.providerId, input.serviceId, { locale }));

export type { AdminCustomerRow, AdminUserRow };
