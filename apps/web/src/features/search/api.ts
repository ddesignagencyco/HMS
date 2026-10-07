/* Public provider search, profile, reputation, remarks and availability.

   Two things to keep in mind when reading these signatures:

   · `/search/providers` is `.strict()` and takes `serviceSlug`, `lat` and `lng`
     and nothing else — no page, no sort, no text. A fourth parameter comes back
     422 `unrecognized_keys`, so the query is built here and nowhere else.
   · A provider the API will not describe (not approved) answers 404, which is
     indistinguishable from a provider that does not exist. That is deliberate
     on the API's side and is why `getProvider` treats 404 as "not found" rather
     than as an empty profile. */

import { apiRequest } from "@/lib/api/client";
import type { Locale } from "@/lib/utils";
import type { ProviderSearchFilters } from "./types";

export type Reputation = {
  /**
   * The published score on the 1–5 scale, or **null** when nobody has rated this
   * provider. `reputation.service.ts` returns null rather than the Bayesian
   * prior precisely so an unrated professional cannot be rendered as a 3.5 — the
   * prior remains a ranking input only. Every rendering must branch on this
   * being null and say "no ratings yet"; `ratingCount` alone is no longer a
   * sufficient guard, because a count with a null score is a legitimate answer.
   */
  score: number | null;
  ratingCount: number;
  distribution: Record<"1" | "2" | "3" | "4" | "5", number>;
  verifiedJobs: number;
  badge: string | null;
};

export type ProviderSearchResult = {
  providerId: string;
  bio: string | null;
  experienceYears: number | null;
  qualification: string | null;
  pricePaisa: number;
  distanceM: number;
  /** Null when nobody has rated this provider yet. Render "no ratings yet" for
      it — the search row is ranked on it, but it is not a rating to display. */
  ratingScore: number | null;
  ratingCount: number;
  badge: string | null;
};

export type ProviderServiceOffer = { serviceId: number; slug: string; nameEn: string; pricePaisa: number };

export type ProviderArea = { areaId: number; name: string };

export type ProviderDetail = {
  providerId: string;
  status: string;
  bio: string | null;
  experienceYears: number | null;
  qualification: string | null;
  cityId: number | null;
  radiusM: number;
  services: ProviderServiceOffer[];
  areas: ProviderArea[];
  reputation: Reputation;
};

/**
 * The provider's reply to a remark, or null when they never replied.
 *
 * This is an object, not a string. `reputation.service.ts` maps the
 * `remark_replies` row to `{ body: replyBody, createdAt: repliedAt }`, so a
 * frontend that types it as `string` renders `[object Object]` — or throws,
 * because React will not take an object as a child.
 */
export type RemarkReply = {
  body: string;
  createdAt: string;
};

export type Remark = {
  id: string;
  displayName: string;
  body: string;
  score: number;
  createdAt: string;
  reply: RemarkReply | null;
};

export type Slot = { start: string; end: string };

export type SlotDay = { date: string; durationMin: number; items: Slot[] };

export type SearchOptions = { signal?: AbortSignal; locale?: Locale };

const read = <T>(path: string, options: SearchOptions & { query?: Record<string, string | number | undefined> } = {}) =>
  apiRequest<T>(path, {
    method: "GET",
    ...(options.locale === undefined ? {} : { locale: options.locale }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.query === undefined ? {} : { query: options.query }),
    auth: false,
    refreshOnExpiry: false,
  });

/** Only these three keys ever reach `/search/providers`. */
export const providerSearchQuery = (filters: ProviderSearchFilters): Record<string, string | number> => ({
  serviceSlug: filters.serviceSlug,
  lat: filters.lat,
  lng: filters.lng,
});

export const searchApi = {
  searchProviders: (filters: ProviderSearchFilters, options?: SearchOptions) =>
    read<{ items: ProviderSearchResult[] }>("/search/providers", { ...options, query: providerSearchQuery(filters) }),

  getProvider: (providerId: string, options?: SearchOptions) =>
    read<ProviderDetail>(`/search/providers/${encodeURIComponent(providerId)}`, options),

  getReputation: (providerId: string, options?: SearchOptions) =>
    read<Reputation>(`/search/providers/${encodeURIComponent(providerId)}/reputation`, options),

  listRemarks: (providerId: string, limit: number, options?: SearchOptions) =>
    read<{ items: Remark[] }>(`/search/providers/${encodeURIComponent(providerId)}/remarks`, {
      ...options,
      query: { limit },
    }),

  listSlots: (providerId: string, serviceId: number, date: string, options?: SearchOptions) =>
    read<SlotDay>(`/search/providers/${encodeURIComponent(providerId)}/slots`, {
      ...options,
      query: { serviceId, date },
    }),

  /** When this provider is next free, across all services. There is no date
      input — it is the "when can I get in soonest?" question, which needs no
      guess about a day. */
  nextSlots: (providerId: string, options?: SearchOptions) =>
    read<{ slots: Slot[] }>(`/search/providers/${encodeURIComponent(providerId)}/next-slots`, options),
};