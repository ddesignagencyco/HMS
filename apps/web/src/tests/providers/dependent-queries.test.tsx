import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCityAreas } from "@/features/places/queries";
import { useProviderSlots } from "@/features/search/queries";
import { ApiError } from "@/lib/api/problem";

/* The two queries that must not fire before they can succeed.

   Areas need a city: `GET /places/cities/:cityId/areas` 404s for a city that
   does not exist and 400s for one that is not a number, so an area list may only
   be requested once a real city is chosen.

   Slots need a provider, a service and a day, all three of which the endpoint
   requires; there is no "show me everything available" form of this request. */

/* vitest runs with `globals: false`, so Testing Library's automatic cleanup is
   never registered and one hook's container stays mounted for the next. Each
   case creates its own QueryClient, so a stale container cannot answer — but the
   leak makes counts and failures read as product bugs, so unmount explicitly. */
afterEach(() => cleanup());

const problem = (status: number, code: string) => ({
  type: "about:blank",
  title: "x",
  status,
  code,
  detail: "x",
  errors: [],
});

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

const wrapper = (client: QueryClient) => {
  const Component = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return Component;
};

describe("dependent location filter", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => json({ items: [{ id: 1, cityId: 1, name: "Gulberg" }] }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not ask for areas until a city has been chosen", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useCityAreas(null, "en"), { wrapper: wrapper(client) });

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats city zero as no city, because it would 404", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useCityAreas(0, "en"), { wrapper: wrapper(client) });

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches areas once a valid city exists", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useCityAreas(1, "en"), { wrapper: wrapper(client) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.items[0]?.name).toBe("Gulberg");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/places/cities/1/areas");
  });

  it("does not retry a city that does not exist", async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify(problem(404, "NOT_FOUND")), { status: 404 }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useCityAreas(999, "en"), { wrapper: wrapper(client) });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
    /* One attempt, not the default three: the API answered properly. */
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("availability selection", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () =>
      json({
        date: "2026-10-05",
        durationMin: 90,
        items: [
          { start: "2026-10-04T19:00:00.000Z", end: "2026-10-04T20:30:00.000Z" },
          { start: "2026-10-04T19:30:00.000Z", end: "2026-10-04T21:00:00.000Z" },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const providerId = "00000000-0000-4000-8000-000000000098";

  it("waits for a provider, a service and a day before asking", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useProviderSlots(providerId, null, null, "en"), { wrapper: wrapper(client) });

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("waits for a day as well as a provider and a service", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useProviderSlots(providerId, 1, null, "en"), { wrapper: wrapper(client) });

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks once all three are present, with both in the query string", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useProviderSlots(providerId, 1, "2026-10-05", "en"), { wrapper: wrapper(client) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain("/slots?");
    expect(url).toContain("serviceId=1");
    expect(url).toContain("date=2026-10-05");
    expect(result.current.data?.durationMin).toBe(90);
    expect(result.current.data?.items).toHaveLength(2);
  });

  it("reports an empty day as an empty day rather than an error", async () => {
    fetchMock.mockImplementation(async () => json({ date: "2026-10-05", durationMin: 90, items: [] }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useProviderSlots(providerId, 1, "2026-10-05", "en"), { wrapper: wrapper(client) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.items).toHaveLength(0);
    expect(result.current.isError).toBe(false);
  });

  it("never caches availability, because a slot can be taken at any moment", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useProviderSlots(providerId, 1, "2026-10-05", "en"), { wrapper: wrapper(client) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.dataUpdatedAt).toBeGreaterThan(0);
    /* staleTime 0 means the entry is stale the moment it lands, which is what
       makes refetchOnWindowFocus re-read it. */
    const query = client.getQueryCache().find({ queryKey: ["public", "providers", providerId, "slots", 1, "2026-10-05"] });
    expect(query?.isStale()).toBe(true);
  });
});