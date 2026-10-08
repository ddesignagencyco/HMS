import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RemarksSection, ReputationSection } from "@/features/discovery/profile-sections";
import { useProviderSearch } from "@/features/search/queries";
import type { Reputation } from "@/features/search/api";
import { getDictionary } from "@/lib/dictionaries";
import type { Locale } from "@/lib/utils";

/* The three things the browser pass could not reach against the seeded data.

   The seeded professional has no ratings and no remarks, so the reply rendering
   and the rating-distribution bar had never actually executed. They are the
   highest-risk part of this module: `remark.reply` is an object, and rendering
   it as a React child throws rather than looking wrong. */

const dict = getDictionary("en");
const locale: Locale = "en";
const providerId = "00000000-0000-4000-8000-000000000098";

/* vitest runs with `globals: false`, so Testing Library's automatic cleanup is
   never registered. Without this, one test's DOM is still mounted when the next
   one starts and queries match the previous render — which reads as a product
   bug rather than a test bug. */
afterEach(() => cleanup());

const wrapperFor = (client: QueryClient) => {
  const Component = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return Component;
};

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

describe("remark with a reply", () => {
  beforeEach(() => {
    /* Exactly the shape publicRemarks returns: reply is an object. */
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({
          items: [
            {
              id: "3f1c0a4e-0000-4000-8000-000000000001",
              displayName: "Ayesha K.",
              body: "Arrived on time and left the place clean.",
              score: 5,
              createdAt: "2026-09-30T09:12:00.000Z",
              reply: { body: "Thank you — glad it worked out.", createdAt: "2026-09-30T11:40:00.000Z" },
            },
          ],
        }),
      ),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it("renders the reply text rather than throwing on the object", async () => {
    render(<RemarksSection locale={locale} dict={dict} providerId={providerId} />, { wrapper: wrapperFor(client()) });

    await waitFor(() => expect(screen.getByText("Ayesha K.")).toBeDefined());
    expect(screen.getByText("Thank you — glad it worked out.")).toBeDefined();
    expect(screen.getByText(dict.profile.remarkReply)).toBeDefined();
    /* The masked display name, first name and last initial only. */
    expect(screen.getByText(/^Ayesha K\.$/)).toBeDefined();
  });

  it("renders a remark with no reply without a reply block", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({
          items: [
            {
              id: "3f1c0a4e-0000-4000-8000-000000000002",
              displayName: "Bilal S.",
              body: "Fixed the leak.",
              score: 4,
              createdAt: "2026-09-01T09:12:00.000Z",
              reply: null,
            },
          ],
        }),
      ),
    );
    render(<RemarksSection locale={locale} dict={dict} providerId={providerId} />, { wrapper: wrapperFor(client()) });

    await waitFor(() => expect(screen.getByText("Bilal S.")).toBeDefined());
    expect(screen.queryByText(dict.profile.remarkReply)).toBeNull();
  });
});

describe("rating distribution", () => {
  afterEach(() => vi.unstubAllGlobals());

  const rated: Reputation = {
    score: 4.6,
    ratingCount: 5,
    distribution: { "1": 0, "2": 1, "3": 0, "4": 1, "5": 3 },
    verifiedJobs: 12,
    badge: "TRUSTED",
  };

  it("draws every star row, labelled by level and counted correctly", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(rated)));
    render(<ReputationSection locale={locale} dict={dict} providerId={providerId} reputation={rated} />, {
      wrapper: wrapperFor(client()),
    });

    await waitFor(() => expect(screen.getByText("4.60")).toBeDefined());
    expect(screen.getByText(dict.profile.ratingBreakdown)).toBeDefined();
    expect(screen.getByText("5 stars")).toBeDefined();
    expect(screen.getByText("4 stars")).toBeDefined();
    expect(screen.getByText("3 stars")).toBeDefined();
    expect(screen.getByText("2 stars")).toBeDefined();
    /* One star is singular. */
    expect(screen.getByText("1 star")).toBeDefined();
    expect(screen.getByText(dict.profile.verifiedJobs.replace("{count}", "12"))).toBeDefined();
  });

  it("shows no rating at all when the API returns a null score", async () => {
    /* The live case: score is null and ratingCount is 0. */
    const unratedReputation: Reputation = {
      score: null,
      ratingCount: 0,
      distribution: { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 },
      verifiedJobs: 0,
      badge: null,
    };
    vi.stubGlobal("fetch", vi.fn(async () => json(unratedReputation)));
    render(<ReputationSection locale={locale} dict={dict} providerId={providerId} reputation={unratedReputation} />, {
      wrapper: wrapperFor(client()),
    });

    await waitFor(() => expect(screen.getByText(dict.profile.noRatingsYet)).toBeDefined());
    /* Nothing may be printed in place of the absent score. */
    expect(screen.queryByText("NaN")).toBeNull();
    expect(screen.queryByText("0.00")).toBeNull();
    expect(screen.queryByText("3.50")).toBeNull();
    expect(screen.queryByText(dict.profile.ratingBreakdown)).toBeNull();
  });

  /* A count with a null score is a legitimate answer from this API, so the branch
     has to be on the score. Gating on the count would render the breakdown bars
     with no score above them. */
  it("shows no rating when the score is null even if a count is reported", async () => {
    const countOnly: Reputation = {
      score: null,
      ratingCount: 2,
      distribution: { "1": 0, "2": 0, "3": 0, "4": 1, "5": 1 },
      verifiedJobs: 4,
      badge: null,
    };
    vi.stubGlobal("fetch", vi.fn(async () => json(countOnly)));
    render(<ReputationSection locale={locale} dict={dict} providerId={providerId} reputation={countOnly} />, {
      wrapper: wrapperFor(client()),
    });

    await waitFor(() => expect(screen.getByText(dict.profile.noRatingsYet)).toBeDefined());
    expect(screen.queryByText("NaN")).toBeNull();
  });
});

describe("superseded search requests", () => {
  afterEach(() => vi.unstubAllGlobals());

  const A = { serviceSlug: "leak-repair", lat: 31.5204, lng: 74.3587 };
  const B = { serviceSlug: "blocked-drain", lat: 31.5469, lng: 74.3212 };

  const result = (slug: string) => ({
    items: [
      {
        providerId: `provider-for-${slug}`,
        bio: null,
        experienceYears: 1,
        qualification: slug,
        pricePaisa: 100000,
        distanceM: 10,
        ratingScore: null,
        ratingCount: 0,
        badge: null,
      },
    ],
  });

  it("never lets a slow earlier response overwrite a newer one", async () => {
    const aborts: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const isFirst = url.includes("leak-repair");
        /* The first request is deliberately slower than the second, so it lands
           last. Only an abort or a key change can stop it overwriting. */
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, isFirst ? 250 : 20);
          init?.signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            aborts.push(url);
            reject(new DOMException("aborted", "AbortError"));
          });
        });
        return json(result(isFirst ? "leak-repair" : "blocked-drain"));
      }),
    );

    const queryClient = client();
    const { result: hook, rerender } = renderHook((filters: typeof A) => useProviderSearch(filters, locale), {
      wrapper: wrapperFor(queryClient),
      initialProps: A,
    });

    await waitFor(() => expect(hook.current.isSuccess).toBe(true), { timeout: 3000 });
    expect(hook.current.data?.items[0]?.qualification).toBe("leak-repair");

    rerender(B);

    await waitFor(() => expect(hook.current.data?.items[0]?.qualification).toBe("blocked-drain"), { timeout: 3000 });
    /* Give the abandoned response every chance to arrive late and win. */
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(hook.current.data?.items[0]?.qualification).toBe("blocked-drain");
    expect(hook.current.isError).toBe(false);
  });

  it("passes TanStack's abort signal all the way to fetch", async () => {
    const signals: (AbortSignal | null | undefined)[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        signals.push(init?.signal);
        return json(result("leak-repair"));
      }),
    );

    const queryClient = client();
    const { result: hook } = renderHook(() => useProviderSearch(A, locale), { wrapper: wrapperFor(queryClient) });
    await waitFor(() => expect(hook.current.isSuccess).toBe(true));

    expect(signals[0]).toBeInstanceOf(AbortSignal);
  });
});