/* The state behind `/providers`, split by where it lives.

   URL      — anything a person would want to share or survive a refresh: which
              service, which city, which area, and the point being searched.
   Local    — what is open (the mobile filter sheet) and which provider is
              expanded. None of it belongs in a URL.
   Server   — the results themselves, in TanStack Query.

   `ProviderSearchFilters` is exactly what `/search/providers` accepts. It has
   no page, no sort and no text, because the API has none. */

import type { Locale } from "@/lib/utils";

export type ProviderSearchFilters = {
  serviceSlug: string;
  lat: number;
  lng: number;
};

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