/* Query-key factories for the public module.

   Every response-affecting input is part of the key. A provider search keyed
   only by the service would serve one location's results for another, and slots
   keyed only by the provider would show yesterday's availability for a new
   date — so the coordinates and the date are in the key, not bolted on. */

import type { ProviderSearchFilters } from "@/features/search/types";
import { ApiError } from "@/lib/api/problem";

export const publicKeys = {
  categories: ["public", "categories"] as const,
  categoryServices: (slug: string) => ["public", "categories", slug, "services"] as const,
  service: (slug: string) => ["public", "services", slug] as const,
  cities: ["public", "places", "cities"] as const,
  areas: (cityId: number) => ["public", "places", "cities", cityId, "areas"] as const,
  /** Every effective filter, in a fixed order, so equivalent searches share a key. */
  providerSearch: (filters: ProviderSearchFilters) =>
    ["public", "search", "providers", filters.serviceSlug, filters.lat, filters.lng] as const,
  provider: (providerId: string) => ["public", "providers", providerId] as const,
  reputation: (providerId: string) => ["public", "providers", providerId, "reputation"] as const,
  remarks: (providerId: string, limit: number) => ["public", "providers", providerId, "remarks", limit] as const,
  slots: (providerId: string, serviceId: number, date: string) =>
    ["public", "providers", providerId, "slots", serviceId, date] as const,
} as const;

/**
 * Freshness by data type. Catalogue and places are reference data an admin
 * publishes rarely; a profile moves slowly; availability is the opposite of
 * static — a slot listed now can be taken a moment later, so it is never
 * treated as cached for long.
 */
export const FRESHNESS = {
  categories: { staleTime: 30 * 60_000, gcTime: 60 * 60_000 },
  categoryServices: { staleTime: 30 * 60_000, gcTime: 60 * 60_000 },
  service: { staleTime: 15 * 60_000, gcTime: 60 * 60_000 },
  places: { staleTime: 60 * 60_000, gcTime: 24 * 60 * 60_000 },
  search: { staleTime: 60_000, gcTime: 5 * 60_000 },
  profile: { staleTime: 5 * 60_000, gcTime: 15 * 60_000 },
  reputation: { staleTime: 2 * 60_000, gcTime: 15 * 60_000 },
  /** Availability: no stale window, re-read when the window regains focus. */
  slots: { staleTime: 0, gcTime: 60_000, refetchOnWindowFocus: true },
} as const;

/**
 * A transient failure is worth one more attempt; a 404, 400 or 422 is the API
 * answering properly and retrying it only delays the right answer.
 */
export const publicRetry = (failureCount: number, error: unknown): boolean => {
  if (error instanceof ApiError) return error.status >= 500 && failureCount < 1;
  /* A dropped connection, not a refusal. */
  return failureCount < 1;
};