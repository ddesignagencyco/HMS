import { useQuery } from "@tanstack/react-query";
import { ApiError } from "@/lib/api/problem";
import { FRESHNESS, publicKeys, publicRetry } from "@/lib/api/keys";
import type { Locale } from "@/lib/utils";
import { searchApi } from "./api";
import type { ProviderSearchFilters } from "./types";

/* Each of these is a separate query on purpose. A profile, its reputation and
   its remarks are read at different rates — a remark arriving should not
   re-fetch a profile, and a failing remarks call must not blank the profile —
   so they neither block one another nor share a cache entry.

   Every request carries the TanStack `signal`, so switching service or city
   cancels the request in flight instead of letting a stale response land on
   top of a newer one. */

const notFound = (error: unknown): boolean => error instanceof ApiError && error.status === 404;

export function useProviderSearch(filters: ProviderSearchFilters | null, locale: Locale) {
  return useQuery({
    queryKey: publicKeys.providerSearch(filters ?? { serviceSlug: "", lat: 0, lng: 0 }),
    queryFn: ({ signal }) => searchApi.searchProviders(filters as ProviderSearchFilters, { signal, locale }),
    /* No query without a service and a point: the API requires both. */
    enabled: filters !== null,
    staleTime: FRESHNESS.search.staleTime,
    gcTime: FRESHNESS.search.gcTime,
    /* Keeps the previous results on screen while the next set is fetched. */
    placeholderData: (previous) => previous,
    retry: (failureCount, error) => !notFound(error) && publicRetry(failureCount, error),
  });
}

export function useProvider(providerId: string | null, locale: Locale) {
  return useQuery({
    queryKey: publicKeys.provider(providerId ?? ""),
    queryFn: ({ signal }) => searchApi.getProvider(providerId as string, { signal, locale }),
    enabled: providerId !== null && providerId !== "",
    staleTime: FRESHNESS.profile.staleTime,
    gcTime: FRESHNESS.profile.gcTime,
    retry: (failureCount, error) => !notFound(error) && publicRetry(failureCount, error),
  });
}

export function useProviderReputation(providerId: string | null, locale: Locale) {
  return useQuery({
    queryKey: publicKeys.reputation(providerId ?? ""),
    queryFn: ({ signal }) => searchApi.getReputation(providerId as string, { signal, locale }),
    enabled: providerId !== null && providerId !== "",
    staleTime: FRESHNESS.reputation.staleTime,
    gcTime: FRESHNESS.reputation.gcTime,
    retry: (failureCount, error) => !notFound(error) && publicRetry(failureCount, error),
  });
}

export const REMARKS_LIMIT = 20;

export function useProviderRemarks(providerId: string | null, locale: Locale, limit = REMARKS_LIMIT) {
  return useQuery({
    queryKey: publicKeys.remarks(providerId ?? "", limit),
    queryFn: ({ signal }) => searchApi.listRemarks(providerId as string, limit, { signal, locale }),
    enabled: providerId !== null && providerId !== "",
    staleTime: FRESHNESS.reputation.staleTime,
    gcTime: FRESHNESS.reputation.gcTime,
    retry: (failureCount, error) => !notFound(error) && publicRetry(failureCount, error),
  });
}

/**
 * Availability is never treated as cached: the API can lose a slot to another
 * customer at any moment, so it is re-read when the window regains focus and
 * whenever the provider, service or date changes (all three are in the key).
 */
export function useProviderSlots(providerId: string | null, serviceId: number | null, date: string | null, locale: Locale) {
  const ready = providerId !== null && providerId !== "" && serviceId !== null && date !== null && date !== "";
  return useQuery({
    queryKey: publicKeys.slots(providerId ?? "", serviceId ?? 0, date ?? ""),
    queryFn: ({ signal }) => searchApi.listSlots(providerId as string, serviceId as number, date as string, { signal, locale }),
    enabled: ready,
    staleTime: FRESHNESS.slots.staleTime,
    gcTime: FRESHNESS.slots.gcTime,
    refetchOnWindowFocus: FRESHNESS.slots.refetchOnWindowFocus,
    placeholderData: (previous) => previous,
    retry: (failureCount, error) => !notFound(error) && publicRetry(failureCount, error),
  });
}