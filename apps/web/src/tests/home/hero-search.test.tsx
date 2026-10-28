import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HeroSearch } from "@/features/home/hero-search";
import { getDictionary } from "@/lib/dictionaries";

/* Found in the browser audit: the homepage search offered only the *first*
   category's services (plumbing) under a hint promising "plumbing, electrical,
   painting and more". Every active category's services must be choosable. */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

const dict = getDictionary("en");
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const category = (id: number, slug: string, nameEn: string) => ({ id, slug, nameEn, nameUr: nameEn, sortOrder: id, defaultWarrantyDays: 30, isActive: true });
const service = (id: number, categoryId: number, slug: string, nameEn: string) => ({
  id, categoryId, slug, nameEn, nameUr: nameEn, description: "", pricingModel: "FLAT", timeUnit: null, basePricePaisa: 100000, minPricePaisa: 0, maxPricePaisa: 0,
  visitFeePaisa: 0, expectedDurationMin: 60, isEmergencyEligible: false, isPlanEligible: false, warrantyDays: 30, isHighRisk: false, isActive: true,
});

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/catalogue/categories/plumbing/services")) return json({ items: [service(1, 1, "leak-repair", "Leak Repair")] });
      if (url.includes("/catalogue/categories/electrical/services")) return json({ items: [service(5, 2, "fault-finding", "Electrical Fault Finding")] });
      if (url.includes("/catalogue/categories")) return json({ items: [category(1, "plumbing", "Plumbing"), category(2, "electrical", "Electrical")] });
      if (url.includes("/places/cities")) return json({ items: [] });
      return json({ items: [] });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("hero search", () => {
  it("offers services from every category, not only the first", async () => {
    render(<HeroSearch locale="en" dict={dict} />, {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>{children}</QueryClientProvider>
      ),
    });
    /* Wait until both categories' services have been read. */
    await vi.waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([u]) => String(u).includes("electrical/services"))).toBe(true));
    const input = document.getElementById("hero-service") as HTMLInputElement;
    await vi.waitFor(async () => {
      fireEvent.focus(input);
      fireEvent.keyDown(input, { key: "ArrowDown", code: "ArrowDown" });
      expect(await screen.findByText(/Electrical Fault Finding/)).toBeTruthy();
    });
    expect(screen.getByText(/Leak Repair/)).toBeTruthy();
  });
});
