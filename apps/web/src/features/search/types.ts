/* The state behind `/providers`, split by where it lives.

   URL      — anything a person would want to share or survive a refresh: which
              service, which city, which area, and the point being searched.
   Local    — what is open (the mobile filter sheet) and which provider is
              expanded. None of it belongs in a URL.
   Server   — the results themselves, in TanStack Query.

   `ProviderSearchFilters` is exactly what `/search/providers` accepts. It has no
   page and no sort, because the API has neither — and the seven filters it does
   accept are all below, each optional and each meaning "and additionally". */

import type { Locale } from "@/lib/utils";

/**
 * `providerSearchQuerySchema`, all eight keys.
 *
 * **Money is in paisa, not rupees.** `minPricePaisa`/`maxPricePaisa` are compared
 * against `provider_services.price_paisa` directly, so sending 1500 where the
 * schema wants 150000 filters out everything rather than filtering by a cheaper
 * band. `minPricePaisa` above `maxPricePaisa` is a 422 from the schema itself.
 *
 * `addressId` and `lat`/`lng` are **alternatives, not additions**: the schema
 * requires exactly one of them, and half a pair is a 422. `addressId` is the
 * better of the two whenever the customer has picked a saved address, because
 * the server resolves it to coordinates itself rather than trusting coordinates
 * a browser derived from a map.
 */
export type ProviderSearchFilters = {
  serviceSlug: string;
  /** A saved address, resolved server-side. Mutually exclusive with lat/lng. */
  addressId?: string;
  lat?: number;
  lng?: number;
  /** FR-SR-02: at least this many years' experience. */
  minExperienceYears?: number;
  /** FR-SR-03: at least this many completed jobs. */
  minCompletedJobs?: number;
  minPricePaisa?: number;
  maxPricePaisa?: number;
  /** FR-SR-05: has a free slot later today, local time. */
  availableToday?: boolean;
  /** FR-SR-07: every one of their documents has been verified. */
  verifiedDocsOnly?: boolean;
};

/**
 * The half of a filter set that is a *refinement*, not a *place*.
 *
 * A search is only callable once a service and a point are known. These five
 * narrow the answer within that point, and they are kept out of the URL on
 * purpose: a shareable link should carry the service and the place, not the fact
 * that somebody had the sheet open.
 */
export type ProviderRefinement = Omit<ProviderSearchFilters, "serviceSlug" | "addressId" | "lat" | "lng">;

export const SEARCH_PARAM = {
  service: "service",
  city: "city",
  area: "area",
  lat: "lat",
  lng: "lng",
  source: "source",
} as const;

/** How the point in the query was arrived at — shown to the person, not guessed. */
export type LocationSource = "city" | "device";

export type ParsedSearchState = {
  serviceSlug: string;
  cityId: number | null;
  areaId: number | null;
  lat: number | null;
  lng: number | null;
  source: LocationSource;
};

export const EMPTY_SEARCH: ParsedSearchState = {
  serviceSlug: "",
  cityId: null,
  areaId: null,
  lat: null,
  lng: null,
  source: "city",
};

const toNumber = (value: string | null): number | null => {
  if (value === null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const toId = (value: string | null): number | null => {
  const parsed = toNumber(value);
  return parsed !== null && Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

/**
 * Reads the search state out of a query string. Anything unparseable becomes
 * absent rather than being coerced, so a hand-edited URL cannot ask the API for
 * `lat=banana`.
 */
export const parseSearchState = (params: URLSearchParams): ParsedSearchState => ({
  serviceSlug: (params.get(SEARCH_PARAM.service) ?? "").trim(),
  cityId: toId(params.get(SEARCH_PARAM.city)),
  areaId: toId(params.get(SEARCH_PARAM.area)),
  lat: toNumber(params.get(SEARCH_PARAM.lat)),
  lng: toNumber(params.get(SEARCH_PARAM.lng)),
  source: params.get(SEARCH_PARAM.source) === "device" ? "device" : "city",
});

/** True when there is enough to call `/search/providers`. */
export const isSearchable = (state: ParsedSearchState): state is ParsedSearchState & { lat: number; lng: number } =>
  state.serviceSlug !== "" && state.lat !== null && state.lng !== null;

/** Writes only the parameters that carry meaning, so shared URLs stay short. */
export const buildSearchParams = (state: ParsedSearchState): URLSearchParams => {
  const params = new URLSearchParams();
  if (state.serviceSlug !== "") params.set(SEARCH_PARAM.service, state.serviceSlug);
  if (state.cityId !== null) params.set(SEARCH_PARAM.city, String(state.cityId));
  if (state.areaId !== null) params.set(SEARCH_PARAM.area, String(state.areaId));
  if (state.lat !== null) params.set(SEARCH_PARAM.lat, String(state.lat));
  if (state.lng !== null) params.set(SEARCH_PARAM.lng, String(state.lng));
  if (state.source === "device") params.set(SEARCH_PARAM.source, "device");
  return params;
};

/** Search must start from a service: the API takes a service slug, not a person. */
export const requiresService = (state: ParsedSearchState): boolean => state.serviceSlug === "";

export const searchHref = (locale: Locale, state: ParsedSearchState): string => {
  const query = buildSearchParams(state).toString();
  return query === "" ? `/${locale}/providers` : `/${locale}/providers?${query}`;
};

/** The API wants the local Asia/Karachi day, so the date is built from local parts. */
export const toApiDate = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const parseApiDate = (value: string): Date | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
};

export const addDays = (date: Date, days: number): Date => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

/** How many days ahead the availability picker offers. */
export const SLOT_WINDOW_DAYS = 14;