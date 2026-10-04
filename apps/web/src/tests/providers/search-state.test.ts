import { describe, expect, it } from "vitest";
import {
  buildSearchParams,
  EMPTY_SEARCH,
  isSearchable,
  parseSearchState,
  requiresService,
  searchHref,
  SEARCH_PARAM,
  toApiDate,
  parseApiDate,
  addDays,
} from "@/features/search/types";
import { cityCentre, formatDistance, formatSlotTime, isPlausibleCoordinate } from "@/features/search/location";
import { publicKeys } from "@/lib/api/keys";
import { providerSearchQuery } from "@/features/search/api";

/* The search screen's whole contract with the URL and with the API. The API's
   schema is `.strict()` and takes three keys, so the first thing to pin down is
   that nothing else is ever sent. */

describe("search URL state", () => {
  it("reads a shareable search out of the query string", () => {
    const state = parseSearchState(new URLSearchParams("service=leak-repair&city=1&area=3&lat=31.5204&lng=74.3587"));
    expect(state).toEqual({ serviceSlug: "leak-repair", cityId: 1, areaId: 3, lat: 31.5204, lng: 74.3587, source: "city" });
  });

  it("treats unparseable numbers as absent rather than coercing them", () => {
    const state = parseSearchState(new URLSearchParams("lat=banana&lng=&city=0&area=-4"));
    expect(state.lat).toBeNull();
    expect(state.lng).toBeNull();
    expect(state.cityId).toBeNull();
    expect(state.areaId).toBeNull();
  });

  it("writes back only the parameters that carry meaning", () => {
    const params = buildSearchParams({ serviceSlug: "leak-repair", cityId: 1, areaId: null, lat: 31.5204, lng: 74.3587, source: "city" });
    expect(params.get(SEARCH_PARAM.service)).toBe("leak-repair");
    expect(params.get(SEARCH_PARAM.city)).toBe("1");
    expect(params.has(SEARCH_PARAM.area)).toBe(false);
    /* The source is only stated when it is the device, so a city search keeps a
       short URL. */
    expect(params.has(SEARCH_PARAM.source)).toBe(false);
  });

  it("round-trips through parse and build", () => {
    const original = { serviceSlug: "leak-repair", cityId: 2, areaId: 7, lat: 31.5, lng: 74.3, source: "device" as const };
    expect(parseSearchState(buildSearchParams(original))).toEqual(original);
  });

  it("needs both a service and a point before the API can be called", () => {
    expect(isSearchable(EMPTY_SEARCH)).toBe(false);
    expect(isSearchable({ ...EMPTY_SEARCH, serviceSlug: "leak-repair" })).toBe(false);
    expect(isSearchable({ ...EMPTY_SEARCH, serviceSlug: "leak-repair", lat: 31.5, lng: 74.3 })).toBe(true);
    expect(requiresService({ ...EMPTY_SEARCH, serviceSlug: "", lat: 1, lng: 1 })).toBe(true);
  });

  it("builds a link that survives the locale", () => {
    expect(searchHref("en", { ...EMPTY_SEARCH, serviceSlug: "leak-repair" })).toBe("/en/providers?service=leak-repair");
    expect(searchHref("ur", EMPTY_SEARCH)).toBe("/ur/providers");
  });
});

describe("provider search request", () => {
  it("sends exactly the three keys the API accepts", () => {
    /* `.strict()` on providerSearchQuerySchema: a fourth key is a 422. */
    expect(providerSearchQuery({ serviceSlug: "leak-repair", lat: 31.5204, lng: 74.3587 })).toEqual({
      serviceSlug: "leak-repair",
      lat: 31.5204,
      lng: 74.3587,
    });
  });

  it("keys the cache on every response-affecting filter", () => {
    const a = publicKeys.providerSearch({ serviceSlug: "leak-repair", lat: 31.5204, lng: 74.3587 });
    const b = publicKeys.providerSearch({ serviceSlug: "leak-repair", lat: 31.6, lng: 74.4 });
    /* Two points are two result sets, so they must not share a cache entry. */
    expect(a).not.toEqual(b);
    expect(publicKeys.providerSearch({ serviceSlug: "leak-repair", lat: 31.5204, lng: 74.3587 })).toEqual(a);
  });

  it("keys availability on provider, service and day", () => {
    const base = publicKeys.slots("p1", 1, "2026-10-05");
    expect(base).not.toEqual(publicKeys.slots("p1", 1, "2026-10-06"));
    expect(base).not.toEqual(publicKeys.slots("p1", 2, "2026-10-05"));
    expect(base).not.toEqual(publicKeys.slots("p2", 1, "2026-10-05"));
  });

  it("keeps areas keyed per city so one city's list cannot answer for another", () => {
    expect(publicKeys.areas(1)).not.toEqual(publicKeys.areas(2));
  });
});

describe("dates and slots", () => {
  it("formats the local day the API asks for", () => {
    expect(toApiDate(new Date(2026, 9, 5))).toBe("2026-10-05");
    expect(toApiDate(new Date(2026, 11, 31))).toBe("2026-12-31");
  });

  it("round-trips an API date without shifting it across a day boundary", () => {
    const parsed = parseApiDate("2026-10-05");
    expect(parsed).not.toBeNull();
    expect(toApiDate(parsed as Date)).toBe("2026-10-05");
    expect(parseApiDate("05-10-2026")).toBeNull();
  });

  it("adds days across a month boundary", () => {
    expect(toApiDate(addDays(new Date(2026, 9, 31), 1))).toBe("2026-11-01");
  });

  it("renders a slot instant in the city's timezone, not the browser's", () => {
    /* 2026-10-04T19:00Z is 00:00 on the 5th in Asia/Karachi (+05:00). */
    expect(formatSlotTime("2026-10-04T19:00:00.000Z", "en-PK")).toMatch(/12:00/);
    expect(formatSlotTime("2026-10-04T19:30:00.000Z", "en-PK")).toMatch(/12:30/);
  });
});

describe("location", () => {
  it("resolves a known city to its documented centre and refuses an unknown one", () => {
    expect(cityCentre("Lahore")).toEqual({ lat: 31.5204, lng: 74.3587 });
    expect(cityCentre("  lahore ")).toEqual({ lat: 31.5204, lng: 74.3587 });
    /* An unknown city gets no invented point. */
    expect(cityCentre("Quetta")).toBeNull();
  });

  it("rejects impossible coordinates", () => {
    expect(isPlausibleCoordinate({ lat: 31.5, lng: 74.3 })).toBe(true);
    expect(isPlausibleCoordinate({ lat: 100, lng: 74.3 })).toBe(false);
    expect(isPlausibleCoordinate({ lat: Number.NaN, lng: 74.3 })).toBe(false);
  });

  it("shows distance in metres below a kilometre and kilometres above", () => {
    expect(formatDistance(420, "en-PK")).toBe("420 m");
    expect(formatDistance(1000, "en-PK")).toBe("1 km");
    expect(formatDistance(12_400, "en-PK")).toBe("12 km");
  });
});