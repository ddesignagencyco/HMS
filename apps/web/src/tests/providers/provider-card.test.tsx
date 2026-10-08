import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProviderCard } from "@/features/discovery/provider-card";
import type { ProviderSearchResult } from "@/features/search/api";
import { getDictionary } from "@/lib/dictionaries";
import type { Locale } from "@/lib/utils";

/* The provider card, which is the only place a real professional is presented to
   a stranger before they open the profile.

   Two rules are load-bearing and both are about not inventing anything:

   · There is no name and no photo in the contract, so the card leads with the
     qualification and a neutral monogram. A stock photograph of a person next to
     somebody's real rating is a misrepresentation.
   · `ratingScore` is null when nobody has rated this professional, and the API
     still ranks them on an internal prior. A null must read as "no ratings yet",
     never as 0.00 and never as the prior. */

const dict = getDictionary("en");
const locale: Locale = "en";

const rated: ProviderSearchResult = {
  providerId: "00000000-0000-4000-8000-000000000098",
  bio: "Seeded test provider for API development.",
  experienceYears: 5,
  qualification: "Licensed plumber",
  pricePaisa: 100000,
  distanceM: 840,
  ratingScore: 4.6,
  ratingCount: 5,
  badge: null,
};

/** Exactly what the API returns for a professional nobody has rated yet. */
const unrated: ProviderSearchResult = {
  ...rated,
  providerId: "00000000-0000-4000-8000-0000000000aa",
  ratingScore: null,
  ratingCount: 0,
};

const noOptionalFields: ProviderSearchResult = {
  providerId: "00000000-0000-4000-8000-0000000000bb",
  bio: null,
  experienceYears: null,
  qualification: null,
  pricePaisa: 250000,
  distanceM: 0,
  ratingScore: null,
  ratingCount: 0,
  badge: null,
};

const renderCard = (provider: ProviderSearchResult) =>
  render(<ProviderCard locale={locale} dict={dict} provider={provider} serviceName="Leak Repair" />);

afterEach(() => cleanup());

describe("provider card", () => {
  it("leads with the qualification and links to the profile by id", () => {
    renderCard(rated);
    const link = screen.getByRole("link");
    expect(link.textContent).toBe("Licensed plumber");
    /* The API is keyed by UUID, so the profile link must carry the id. */
    expect(link.getAttribute("href")).toBe("/en/providers/00000000-0000-4000-8000-000000000098");
  });

  it("shows the real price and distance", () => {
    renderCard(rated);
    const text = document.body.textContent ?? "";
    expect(text).toContain("Rs 1,000");
    expect(text).toContain("840 m");
    expect(text).toContain("Leak Repair");
  });

  it("shows the score and count only when there are ratings", () => {
    renderCard(rated);
    const text = document.body.textContent ?? "";
    expect(text).toContain("4.60");
    expect(text).toContain("5");
    expect(text).not.toContain(dict.profile.noRatingsYet);
  });

  it("never shows a score for an unrated professional", () => {
    /* The API sends ratingScore: null for somebody nobody has rated. Printing a
       figure beside a star would be a claim nobody has made. */
    renderCard(unrated);
    const text = document.body.textContent ?? "";
    expect(text).toContain(dict.profile.noRatingsYet);
    expect(text).not.toContain("3.50");
    expect(text).not.toContain("NaN");
    expect(text).not.toContain("0.00");
  });

  it("renders no photograph at all, because the contract has none", () => {
    const { container } = renderCard(rated);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("[style*='background-image']")).toBeNull();
  });

  it("falls back to a neutral heading when the qualification is null", () => {
    renderCard(noOptionalFields);
    expect(screen.getByRole("link").textContent).toBe(dict.profile.titleFallback);
    /* Null biography and null experience are omitted, not rendered as blanks. */
    const text = document.body.textContent ?? "";
    expect(text).not.toContain("Seeded test provider");
    expect(text).not.toContain(dict.profile.experience);
  });

  it("shows a badge only when the API sent one", () => {
    const { unmount } = renderCard(rated);
    expect(screen.queryByText("TRUSTED")).toBeNull();
    unmount();

    renderCard({ ...rated, badge: "TRUSTED" });
    expect(screen.getByText("TRUSTED")).toBeDefined();
  });

  it("stretches the link across the card without escaping it", async () => {
    /* The title link uses after:absolute after:inset-0, so the card must be a
       positioned ancestor — otherwise the overlay covers unrelated UI and
       swallows clicks on it. */
    const { container } = renderCard(rated);
    const article = container.querySelector("article");
    expect(article?.className).toContain("relative");
  });

  it("mirrors for RTL rather than pointing the wrong way", () => {
    render(<ProviderCard locale="ur" dict={getDictionary("ur")} provider={rated} serviceName="Leak Repair" />);
    const article = document.querySelector("article");
    /* Logical utilities only: the arrow is flipped with rtl:rotate-180, never a
       left/right class. */
    expect(article?.innerHTML).toContain("rtl:rotate-180");
  });
});