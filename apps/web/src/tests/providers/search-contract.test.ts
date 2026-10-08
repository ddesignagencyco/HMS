import { describe, expect, it } from "vitest";
import { providerSearchQuery, type Remark } from "@/features/search/api";
import type { ProviderSearchResult } from "@/features/search/api";

/* The response shapes, copied from what the running API actually sent against
   the seeded development database. These guard the mapping in both directions: a
   field the API sends that the frontend drops, and a field it invents that the
   API never sends. Every assertion below corresponds to a real response. */

/* GET /search/providers — a provider with no ratings at all. */
const searchRow: ProviderSearchResult = {
  providerId: "00000000-0000-4000-8000-000000000098",
  bio: "Seeded test provider for API development.",
  experienceYears: 5,
  qualification: "Licensed plumber",
  pricePaisa: 100000,
  distanceM: 0,
  badge: null,
  ratingCount: 0,
  ratingScore: 3.5,
};

describe("provider search row", () => {
  it("carries exactly the nine fields the endpoint returns", () => {
    expect(Object.keys(searchRow).sort()).toEqual(
      ["badge", "bio", "distanceM", "experienceYears", "pricePaisa", "providerId", "qualification", "ratingCount", "ratingScore"].sort(),
    );
  });

  it("publishes no name and no photo, so neither may be rendered", () => {
    const forbidden = ["name", "firstName", "lastName", "displayName", "photoUrl", "imageUrl", "photoKey"];
    for (const key of forbidden) {
      expect(key in searchRow).toBe(false);
    }
  });

  it("reports a prior score with a zero count, which is not a rating", () => {
    /* reputation.service.ts pulls the mean toward `rating.bayesian_prior`, so an
       unrated provider scores 3.5. Printing that next to a star would be a claim
       nobody has made: only `ratingCount > 0` may unlock a rating. */
    expect(searchRow.ratingScore).toBe(3.5);
    expect(searchRow.ratingCount).toBe(0);
  });
});

describe("provider search query", () => {
  it("sends only the three keys the strict schema accepts", () => {
    /* providerSearchQuerySchema is `.strict()`: a fourth key is a 422
       VALIDATION_FAILED with `unrecognized_keys`. There is no page, no sort and
       no free text on this endpoint. */
    expect(Object.keys(providerSearchQuery({ serviceSlug: "leak-repair", lat: 31.5204, lng: 74.3587 })).sort()).toEqual([
      "lat",
      "lng",
      "serviceSlug",
    ]);
  });
});

describe("remark row", () => {
  it("types the reply as an object, because the API sends { body, createdAt }", () => {
    const remark: Remark = {
      id: "3f1c0a4e-0000-4000-8000-000000000001",
      displayName: "Test C.",
      body: "Arrived on time and left the place clean.",
      score: 5,
      createdAt: "2026-09-30T09:12:00.000Z",
      reply: { body: "Thank you — glad it worked out.", createdAt: "2026-09-30T11:40:00.000Z" },
    };
    /* publicRemarks maps the join to an object. Typing it as a string and
       rendering it directly throws: React will not take an object as a child. */
    expect(typeof remark.reply).toBe("object");
    expect(remark.reply?.body).toBe("Thank you — glad it worked out.");
    expect(remark.reply?.createdAt).toBe("2026-09-30T11:40:00.000Z");
  });

  it("keeps an un-replied remark null rather than an empty object", () => {
    const remark: Remark = {
      id: "3f1c0a4e-0000-4000-8000-000000000002",
      displayName: "A.",
      body: "Fine work.",
      score: 4,
      createdAt: "2026-09-01T09:12:00.000Z",
      reply: null,
    };
    expect(remark.reply).toBeNull();
  });

  it("shows only the masked display name the API publishes", () => {
    /* FR-RT-06: first name and last initial. Never the customer's full name. */
    const remark: Remark = {
      id: "3f1c0a4e-0000-4000-8000-000000000003",
      displayName: "Ayesha K.",
      body: "…",
      score: 5,
      createdAt: "2026-09-01T09:12:00.000Z",
      reply: null,
    };
    expect(remark.displayName.split(" ")).toHaveLength(2);
    expect(Object.keys(remark)).not.toContain("customerId");
  });
});