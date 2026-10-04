import { describe, expect, it } from "vitest";
import { FRESHNESS, publicRetry } from "@/lib/api/keys";
import { ApiError, NetworkError } from "@/lib/api/problem";

/* The freshness table and the retry rule. Query-key coverage lives in
   `features/search/search-state.test.ts`, where the URL contract it protects is
   also described. */

describe("freshness policy", () => {
  it("treats reference data as long-lived and availability as not cached at all", () => {
    expect(FRESHNESS.categories.staleTime).toBeGreaterThan(FRESHNESS.search.staleTime);
    expect(FRESHNESS.places.staleTime).toBeGreaterThan(FRESHNESS.profile.staleTime);
    /* A slot can be taken by someone else a moment later, so there is no window
       in which a remembered list is still true. */
    expect(FRESHNESS.slots.staleTime).toBe(0);
    expect(FRESHNESS.slots.refetchOnWindowFocus).toBe(true);
  });

  it("refreshes search and public profiles sooner than the catalogue", () => {
    expect(FRESHNESS.search.staleTime).toBeLessThan(FRESHNESS.categories.staleTime);
    expect(FRESHNESS.profile.staleTime).toBeLessThan(FRESHNESS.categories.staleTime);
    expect(FRESHNESS.reputation.staleTime).toBeLessThan(FRESHNESS.service.staleTime);
  });

  it("holds catalogue and place data for long enough that browsing does not refetch it", () => {
    expect(FRESHNESS.categories.staleTime).toBeGreaterThanOrEqual(15 * 60_000);
    expect(FRESHNESS.places.staleTime).toBeGreaterThanOrEqual(30 * 60_000);
  });
});

describe("retry policy", () => {
  const apiError = (status: number) =>
    new ApiError({ type: "about:blank", title: "x", status, code: "INTERNAL_ERROR", detail: "x", errors: [] });

  it("retries a server fault once", () => {
    expect(publicRetry(0, apiError(500))).toBe(true);
    expect(publicRetry(1, apiError(500))).toBe(false);
  });

  it("never retries an answer the API meant to give", () => {
    for (const status of [400, 404, 422]) {
      expect(publicRetry(0, apiError(status))).toBe(false);
    }
  });

  it("retries a dropped connection once", () => {
    expect(publicRetry(0, new NetworkError("offline"))).toBe(true);
    expect(publicRetry(1, new NetworkError("offline"))).toBe(false);
  });
});