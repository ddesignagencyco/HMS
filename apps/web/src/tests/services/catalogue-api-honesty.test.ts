import { describe, expect, it, vi } from "vitest";
import { catalogueApi } from "@/features/catalogue/api";
import { ApiError, NetworkError } from "@/lib/api/problem";

/* The API layer must never invent a response.

   An earlier version caught every error and answered from a hardcoded dataset
   instead. It looked reasonable and it passed every gate, and it was the most
   dangerous bug in the module: an unknown slug was answered with a *different
   real service*, complete with price, duration and warranty, so a customer could
   have booked a job that does not exist — and a total API outage rendered a
   perfectly healthy-looking catalogue, so nobody would ever know to look.

   These tests pin the rule that prevents it coming back. */

/** A row that looks exactly like a real published service. */
const realCategory = { id: 1, slug: "plumbing", nameEn: "Plumbing", nameUr: "x", sortOrder: 0, defaultWarrantyDays: 30, isActive: true };
const realService = {
  id: 1, categoryId: 1, slug: "leak-repair", nameEn: "Leak Repair", nameUr: "x",
  description: "d", pricingModel: "FLAT", timeUnit: null,
  basePricePaisa: 250000, minPricePaisa: 100000, maxPricePaisa: 500000, visitFeePaisa: 0,
  expectedDurationMin: 90, isEmergencyEligible: true, isPlanEligible: false,
  warrantyDays: 30, isHighRisk: false, isActive: true,
};
const realDetail = { ...realService, checklist: [{ id: 1, position: 1, labelEn: "a", labelUr: "b", requiresPhoto: false }] };

const problem = (status: number, code = "NOT_FOUND") => ({
  type: "about:blank",
  title: "x",
  status,
  code,
  detail: "x",
  errors: [],
});

const respond = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const stub = (handler: (url: string) => Response) => vi.stubGlobal("fetch", vi.fn(async (url: string) => handler(String(url))));

describe("catalogue API — never substitutes data", () => {
  it("propagates a 404 for an unknown service instead of returning another service", async () => {
    stub(() => respond(404, problem(404)));
    const error = await catalogueApi.getService("no-such-service").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(404);
    /* The specific failure matters: a caller can tell "no such slug" from
       "the API is unwell" and render a different state for each. */
    expect((error as ApiError).code).toBe("NOT_FOUND");
  });

  it("propagates a 500 rather than pretending the catalogue loaded", async () => {
    stub(() => respond(500, problem(500, "INTERNAL_ERROR")));
    const error = await catalogueApi.listCategories().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(500);
  });

  it("propagates a transport failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }));
    const error = await catalogueApi.listCategories().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NetworkError);
  });

  it("propagates a 404 for an unknown category", async () => {
    stub(() => respond(404, problem(404)));
    await expect(catalogueApi.listServicesInCategory("no-such-category")).rejects.toBeInstanceOf(ApiError);
  });

  it("does not answer a failed category with services from a different one", async () => {
    stub((url) =>
      url.endsWith("/catalogue/categories") ? respond(200, { items: [realCategory] }) : respond(500, problem(500, "INTERNAL_ERROR")),
    );
    await expect(catalogueApi.listServicesInCategory("plumbing")).rejects.toBeInstanceOf(ApiError);
  });

  it("returns exactly what the API sent when it succeeds", async () => {
    /* GET /catalogue/services/:slug answers the row itself, not an envelope. */
    stub(() => respond(200, realDetail));
    const detail = await catalogueApi.getService("leak-repair");
    expect(detail).toEqual(realDetail);
    expect(detail.checklist).toHaveLength(1);
  });
});

describe("catalogue API — listAllServices", () => {
  it("fans out across the published category list, inventing no endpoint", async () => {
    const seen: string[] = [];
    stub((url) => {
      seen.push(url);
      if (url.endsWith("/catalogue/categories")) return respond(200, { items: [realCategory] });
      return respond(200, { items: [realService] });
    });

    const { items } = await catalogueApi.listAllServices();
    expect(seen[0]).toContain("/catalogue/categories");
    /* There is no all-services route on the API, so this must be a real fan-out
       rather than a guess at a contract. */
    expect(seen[1]).toContain("/catalogue/categories/plumbing/services");
    expect(items[0]).toMatchObject({ slug: "leak-repair", categorySlug: "plumbing", categoryNameEn: "Plumbing" });
  });

  it("fails loudly if any single category fails, rather than returning a partial catalogue", async () => {
    /* A partial catalogue presented as a complete one is the same lie as
       substituting made-up rows. */
    stub((url) => (url.endsWith("/catalogue/categories") ? respond(200, { items: [realCategory] }) : respond(500, problem(500))));
    await expect(catalogueApi.listAllServices()).rejects.toBeInstanceOf(ApiError);
  });

  it("skips a category the API has marked inactive", async () => {
    const seen: string[] = [];
    stub((url) => {
      seen.push(url);
      if (url.endsWith("/catalogue/categories")) return respond(200, { items: [realCategory, { ...realCategory, id: 2, slug: "retired", isActive: false }] });
      return respond(200, { items: [realService] });
    });

    const { items } = await catalogueApi.listAllServices();
    expect(seen.some((u) => u.includes("/retired/services"))).toBe(false);
    expect(items).toHaveLength(1);
  });
});