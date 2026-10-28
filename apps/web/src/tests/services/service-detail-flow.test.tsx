import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceDetail } from "@/features/discovery/service-detail";
import type { ServiceDetail as ServiceDetailPayload } from "@/features/catalogue/api";
import { getDictionary } from "@/lib/dictionaries";
import type { Locale } from "@/lib/utils";

/* One service page.

   Every figure on this screen comes from the service row, and `pricingModel`
   decides how the headline number may honestly be described: a FLAT price is a
   price, a TIME_BASED price is a rate, and INSPECTION_FIRST means the number is
   not the whole cost. Calling any of those the wrong thing is the difference
   between a quote and a promise, so the wording is pinned here. */

const dict = getDictionary("en");
const locale: Locale = "en";

/** Markup-independent: the panel composes several strings into one element, so
    assertions are made against the rendered text rather than exact nodes. */
const text = () => document.body.textContent ?? "";

/* Money is integer paisa end to end. Never a float, never divided in the view. */
const leakRepair: ServiceDetailPayload = {
  id: 1,
  categoryId: 1,
  slug: "leak-repair",
  nameEn: "Leak Repair",
  nameUr: "??? ?? ????",
  description: "Diagnose and repair an indoor or outdoor leak.",
  pricingModel: "FLAT",
  timeUnit: null,
  basePricePaisa: 250000,
  minPricePaisa: 100000,
  maxPricePaisa: 500000,
  visitFeePaisa: 0,
  expectedDurationMin: 90,
  isEmergencyEligible: true,
  isPlanEligible: false,
  warrantyDays: 30,
  isHighRisk: false,
  isActive: true,
  checklist: [
    { id: 1, position: 1, labelEn: "Isolate the water supply", labelUr: "???", requiresPhoto: false },
    { id: 2, position: 2, labelEn: "Photograph the leak before repair", labelUr: "???", requiresPhoto: true },
  ],
};

const wrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const Component = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return Component;
};

const renderDetail = (slug = "leak-repair", payload: unknown = leakRepair) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).includes("/catalogue/categories")) return new Response(JSON.stringify({ items: [{ id: 1, slug: "plumbing", nameEn: "Plumbing", nameUr: "?????", sortOrder: 0, defaultWarrantyDays: 30, isActive: true }] }), { status: 200 });
      return new Response(JSON.stringify(payload), { status: 200 });
    }),
  );
  return render(<ServiceDetail locale={locale} dict={dict} slug={slug} />, { wrapper: wrapper() });
};

beforeEach(() => vi.clearAllMocks());

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("service detail", () => {
  it("shows the name, description and the checklist the API returned", async () => {
    renderDetail();
    expect(await screen.findByRole("heading", { name: "Leak Repair" })).toBeDefined();
    expect(screen.getByText("Diagnose and repair an indoor or outdoor leak.")).toBeDefined();
    expect(screen.getByText("Isolate the water supply")).toBeDefined();
    expect(screen.getByText("Photograph the leak before repair")).toBeDefined();
  });

  it("marks the checklist items that need photo evidence", async () => {
    renderDetail();
    await screen.findByText("Isolate the water supply");
    /* Only the second item declares requiresPhoto. */
    expect(screen.getAllByText(dict.catalogue.checklistPhoto)).toHaveLength(1);
  });

  it("presents a FLAT price as a fixed price, in whole rupees", async () => {
    renderDetail();
    await screen.findByRole("heading", { name: "Leak Repair" });
    expect(screen.getByText("Rs 2,500")).toBeDefined();
    expect(screen.getByText(dict.catalogue.priceFlat)).toBeDefined();
  });

  it("shows the range only when the service declares one", async () => {
    renderDetail();
    await screen.findByRole("heading", { name: "Leak Repair" });
expect(text()).toContain(dict.catalogue.priceRange);
    expect(text()).toContain("Rs 1,000");
    expect(text()).toContain("Rs 5,000");
  });

  it("omits the range when min and max are the same", async () => {
    renderDetail("leak-repair", { ...leakRepair, minPricePaisa: 250000, maxPricePaisa: 250000 });
    await screen.findByRole("heading", { name: "Leak Repair" });
    expect(screen.queryByText(dict.catalogue.priceRange)).toBeNull();
  });

  it("calls a TIME_BASED price a rate with its unit, never a fixed price", async () => {
    renderDetail("leak-repair", { ...leakRepair, pricingModel: "TIME_BASED", timeUnit: "HOUR" });
    await screen.findByRole("heading", { name: "Leak Repair" });
    expect(text()).toContain(dict.catalogue.priceRate);
    expect(text()).toContain(dict.catalogue.perHour);
    expect(screen.queryByText(dict.catalogue.priceFlat)).toBeNull();
  });

  it("calls an INSPECTION_FIRST price an estimate", async () => {
    renderDetail("leak-repair", { ...leakRepair, pricingModel: "INSPECTION_FIRST" });
    await screen.findByRole("heading", { name: "Leak Repair" });
    expect(screen.getByText(dict.catalogue.priceEstimate)).toBeDefined();
  });

  it("shows duration and warranty with their own wording", async () => {
    renderDetail();
    await screen.findByRole("heading", { name: "Leak Repair" });
    expect(screen.getByText(dict.catalogue.duration)).toBeDefined();
    expect(screen.getByText("1 h 30 min")).toBeDefined();
    expect(screen.getByText("30-day warranty")).toBeDefined();
    /* The warranty line explains itself rather than borrowing other copy. */
    expect(screen.getByText(dict.catalogue.warrantyNote.replace("{days}", "30"))).toBeDefined();
  });

  it("omits the warranty row entirely when no warranty is recorded", async () => {
    renderDetail("leak-repair", { ...leakRepair, warrantyDays: 0 });
    await screen.findByRole("heading", { name: "Leak Repair" });
    expect(screen.queryByText(/day warranty/)).toBeNull();
  });

  it("shows a visit fee only when one is charged", async () => {
    renderDetail("leak-repair", { ...leakRepair, visitFeePaisa: 50000 });
    await screen.findByRole("heading", { name: "Leak Repair" });
    expect(text()).toContain(dict.catalogue.visitFee);
    expect(text()).toContain("Rs 500");
  });

  it("links onward to provider search carrying the service slug", async () => {
    renderDetail();
    await screen.findByRole("heading", { name: "Leak Repair" });
    const find = screen.getByRole("link", { name: new RegExp(dict.catalogue.findProfessionals) });
    expect(find.getAttribute("href")).toBe("/en/providers?service=leak-repair");
  });

  it("links to the booking entry point with the same slug", async () => {
    renderDetail();
    await screen.findByRole("heading", { name: "Leak Repair" });
    const book = screen.getByRole("link", { name: dict.catalogue.checkAvailability });
    expect(book.getAttribute("href")).toBe("/en/book/leak-repair");
  });

  it("breadcrumbs carry the real category from the categories call", async () => {
    renderDetail();
    await screen.findByRole("heading", { name: "Leak Repair" });
    const category = screen.getByRole("link", { name: "Plumbing" });
    expect(category.getAttribute("href")).toBe("/en/services?category=plumbing");
  });

  it("renders a not-found state for an unknown slug rather than an empty page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ type: "about:blank", title: "x", status: 404, code: "NOT_FOUND", detail: "x", errors: [] }), { status: 404 })),
    );
    render(<ServiceDetail locale={locale} dict={dict} slug="no-such-service" />, { wrapper: wrapper() });

    expect(await screen.findByText(dict.catalogue.notFoundTitle)).toBeDefined();
    expect(screen.getByRole("link", { name: dict.catalogue.breadcrumbServices })).toBeDefined();
  });

it("offers a retry on a server fault, not a not-found state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ type: "about:blank", title: "x", status: 500, code: "INTERNAL_ERROR", detail: "x", errors: [] }), { status: 500 })),
    );
    render(<ServiceDetail locale={locale} dict={dict} slug="leak-repair" />, { wrapper: wrapper() });

    await waitFor(() => expect(text()).toContain(dict.catalogue.loadError), { timeout: 5000 });
    expect(screen.getByRole("button", { name: new RegExp(dict.catalogue.retry, "i") })).toBeDefined();
    expect(text()).not.toContain(dict.catalogue.notFoundTitle);
  });

  it("shows an empty checklist state when the API returns none", async () => {
    renderDetail("leak-repair", { ...leakRepair, checklist: [] });
    await screen.findByRole("heading", { name: "Leak Repair" });
    expect(screen.getByText(dict.common.empty)).toBeDefined();
  });

  it("renders the Urdu name on the Urdu route", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/catalogue/categories")) return new Response(JSON.stringify({ items: [] }), { status: 200 });
        return new Response(JSON.stringify(leakRepair), { status: 200 });
      }),
    );
    render(<ServiceDetail locale="ur" dict={getDictionary("ur")} slug="leak-repair" />, { wrapper: wrapper() });
    /* nameUr is what a person in Urdu should be shown, not nameEn. */
    expect(await screen.findByRole("heading", { name: leakRepair.nameUr })).toBeDefined();
  });
});