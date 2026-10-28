import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { PlansCatalogue } from "@/features/plans/public-plans-view";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";
import { pageMetadata } from "@/lib/seo";

/* This route used to hold its own `tiers` array — "care" / "plus" / "cover" at
   Rs 4,900 / 8,900 / 14,900 with 2, 4 and 6 visits — and render marketing
   bullets keyed by that tier id. Not one of those numbers came from the API.

   A price card is a commitment: a visitor could reasonably hold the platform
   to Rs 8,900 for four visits, and `plans` was an empty table that no route
   read. The array is gone rather than "kept as an example". What renders now
   is `PlansCatalogue`, which shows only what `GET /plans` returned. */

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const dict = getDictionary(isLocale(locale) ? locale : "en");
  return pageMetadata(locale, "/plans", `${dict.plansPage.titleLead} ${dict.plansPage.titleAccent}`, dict.plansPage.description);
}

export default async function PlansPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  /* Every other page in this app 404s on an unknown locale; this one cannot,
     because the catalogue is a client component that needs a `Locale` rather
     than a string. */
  if (locale !== "en" && locale !== "ur") notFound();
  return <PlansCatalogue locale={locale} />;
}