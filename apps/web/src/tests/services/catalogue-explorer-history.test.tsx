import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CatalogueExplorer } from "@/features/discovery/catalogue-explorer";
import { getDictionary } from "@/lib/dictionaries";

/* Found in the browser audit: the category was `useState(initialCategory)`, read
   once. Browser Back/Forward between `/services?category=…` URLs re-rendered the
   page with a new `initialCategory`, the address bar changed, and the list stayed
   on the old category. The URL's category must win when it changes. */

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
      if (url.includes("/catalogue/categories/electrical/services")) return json({ items: [service(5, 2, "fault-finding", "Fault Finding")] });
      if (url.includes("/catalogue/categories")) return json({ items: [category(1, "plumbing", "Plumbing"), category(2, "electrical", "Electrical")] });
      return json({ items: [] });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("catalogue explorer and history", () => {
  it("follows the URL's category when it changes (Back/Forward)", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const view = render(<CatalogueExplorer locale="en" dict={dict} initialCategory="electrical" />, { wrapper });
    expect(await screen.findByText("Fault Finding")).toBeTruthy();
    expect(screen.queryByText("Leak Repair")).toBeNull();

    /* What a history step does: the server page re-renders with the other category. */
    view.rerender(<CatalogueExplorer locale="en" dict={dict} initialCategory="plumbing" />);
    expect(await screen.findByText("Leak Repair")).toBeTruthy();
    expect(screen.queryByText("Fault Finding")).toBeNull();

    view.rerender(<CatalogueExplorer locale="en" dict={dict} initialCategory="" />);
    expect(await screen.findByText("Leak Repair")).toBeTruthy();
    expect(screen.getByText("Fault Finding")).toBeTruthy();
  });
});
