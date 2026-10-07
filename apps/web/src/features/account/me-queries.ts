import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { meApi, type PasswordChangeInput, type ProfileUpdateInput } from '@/features/account/me-api';
import { sessionKeys } from '@/features/auth/session';
import { FRESHNESS, accountKeys, publicRetry } from '@/lib/api/keys';
import type { Locale } from '@/lib/utils';

/* Server state for `/me`.
 *
 * Nothing here is keyed on an id, for the same reason `providerKeys` is not: the
 * routes are identified by the access token, so the cache is per-account and is
 * purged on sign-out by the same `queryKey[0] !== 'auth'` rule as everything else.
 * A second customer signing in on the same browser must never see the first
 * one's shortlist.
 *
 * No mutation retries. `PATCH /me/password` revokes sessions and
 * `POST /me/deactivate` anonymises an account — a replayed request is not a
 * harmless duplicate the way a read would be. */

/** `GET /me/favourites`. Short windows: a shortlist is what you rebook from. */
export function useFavourites(locale: Locale) {
  return useQuery({
    queryKey: accountKeys.favourites,
    queryFn: ({ signal }) => meApi.listFavourites({ signal, locale }),
    staleTime: FRESHNESS.search.staleTime,
    gcTime: FRESHNESS.search.gcTime,
    retry: publicRetry
  });
}

/**
 * `POST /me/favourites/:providerId`.
 *
 * The shortlist is invalidated rather than appended to, because a 404 here means
 * "not an approved provider" and the provider profile that asked is the only
 * place that knows whether the tap should have worked at all.
 */
export function useAddFavourite(locale: Locale) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (providerId: string) => meApi.addFavourite(providerId, { locale }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: accountKeys.favourites }),
    retry: false
  });
}

/** `DELETE /me/favourites/:providerId` — 204, and 400 when it was not there. */
export function useRemoveFavourite(locale: Locale) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (providerId: string) => meApi.removeFavourite(providerId, { locale }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: accountKeys.favourites }),
    retry: false
  });
}

/**
 * `PATCH /me`.
 *
 * The response carries the fresh `AuthenticatedUser`, so it is written straight
 * into the session cache. Refetching instead would re-read `/auth/session` for a
 * value already in hand, and the header renders this name — a screen that still
 * said the old one after a successful rename is the bug this avoids.
 */
export function useUpdateProfile(locale: Locale) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ProfileUpdateInput) => meApi.updateProfile(input, { locale }),
    onSuccess: (result) => queryClient.setQueryData(sessionKeys.me, { user: result.user }),
    retry: false
  });
}

/** `PATCH /me/password` — no retry, and no cache to invalidate. */
export function useChangePassword(locale: Locale) {
  return useMutation({
    mutationFn: (input: PasswordChangeInput) => meApi.changePassword(input, { locale }),
    retry: false
  });
}

/**
 * `POST /me/deactivate`.
 *
 * The account is anonymised and every session is revoked, so the local session
 * is ended too rather than left to fail on its next request — and the caches are
 * purged with it, because the person signed in here no longer exists.
 */
export function useDeactivateAccount(locale: Locale) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => meApi.deactivate({ locale }),
    onSuccess: () => {
      queryClient.setQueryData(sessionKeys.me, null);
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'auth' });
    },
    retry: false
  });
}
