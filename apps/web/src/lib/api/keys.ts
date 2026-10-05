/* Query-key factories.

   Every response-affecting input is part of the key. A provider search keyed
   only by the service would serve one location's results for another, and slots
   keyed only by the provider would show yesterday's availability for a new
   date — so the coordinates and the date are in the key, not bolted on.

   `publicKeys` are the `@Public()` reads of module 2. `accountKeys` and
   `bookingKeys` belong to the authenticated account of whoever is signed in;
   the session provider clears every non-`auth` key on sign-out, so nothing here
   survives into the next account. */

import type { ProviderSearchFilters } from "@/features/search/types";
import type { BookingListStatus } from "@/features/booking/api";
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

export const accountKeys = {
  /** The signed-in customer's saved addresses. Theirs alone; never shared. */
  addresses: ["account", "addresses"] as const,
} as const;

/**
 * Booking keys.
 *
 * The booking list is keyed by the status filter because it is part of the
 * request, and the detail key is scoped under the list so invalidating one
 * invalidates the other — a cancelled booking must stop being shown as active
 * in both places at once, not only on the page that performed the cancellation.
 *
 * `quote` and `messages` are deliberately *not* here. A quote is a mutation
 * (`POST /bookings/quote`) whose whole point is to be re-read when the basket
 * changes, and reading the chat marks the other side's messages as read, so it
 * is a mutation for the same reason.
 */
export const bookingKeys = {
  all: ["account", "bookings"] as const,
  list: (status?: BookingListStatus) => ["account", "bookings", "list", status ?? "all"] as const,
  detail: (bookingId: string) => ["account", "bookings", "detail", bookingId] as const,
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
  /* Authenticated reads. Short windows throughout: every one of these belongs
     to a person who is waiting on a job, and a stale status is worse than a
     slow page. */
  addresses: { staleTime: 5 * 60_000, gcTime: 30 * 60_000 },
  bookingList: { staleTime: 30_000, gcTime: 5 * 60_000 },
  /** One booking's state moves several times in an hour; do not remember it. */
  booking: { staleTime: 15_000, gcTime: 5 * 60_000 },
  /** The chat changes when the provider replies, and reading it has a side effect. */
  messages: { staleTime: 0, gcTime: 60_000, refetchOnWindowFocus: true },
} as const;

/** True when the API is saying "this does not exist" rather than "try again". */
export const isNotFoundError = (error: unknown): boolean => error instanceof ApiError && error.status === 404;

/**
 * A transient failure is worth one more attempt; a 404, 400 or 422 is the API
 * answering properly and retrying it only delays the right answer.
 */
export const publicRetry = (failureCount: number, error: unknown): boolean => {
  if (error instanceof ApiError) return error.status >= 500 && failureCount < 1;
  /* A dropped connection, not a refusal. */
  return failureCount < 1;
};