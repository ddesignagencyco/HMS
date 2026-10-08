import { notFound } from "next/navigation";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";
import { HeroSearch } from "@/features/home/hero-search";
import { CategorySection, PopularServicesSection } from "@/features/home/home-catalogue";
import { CoverageSection, FeaturedProfessionalsSection, PlatformMetricsSection } from "@/features/home/home-platform";
import { ClosingCtaSection, FaqSection, HomeHero, ProcessSection, TrustSection } from "@/features/home/home-sections";
import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const dict = getDictionary(isLocale(locale) ? locale : "en");
  return pageMetadata(locale, "/", `${dict.home.titleLead} ${dict.home.titleAccent}`, dict.home.description);
}

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);

  return (
    <>
      {/* The search control reads the catalogue and places endpoints itself, so
          the homepage passes no mock service or area list into it. */}
      <HomeHero locale={locale} dict={dict} search={<HeroSearch locale={locale} dict={dict} />} />
      {/* These read the catalogue API, so they are client components imported
          from `home-catalogue.tsx` and `home-platform.tsx` rather than from the
          server-module `home-sections.tsx`. A `useQuery` called from a server
          component throws at render time. */}
      <CategorySection locale={locale} dict={dict} />
      <PlatformMetricsSection locale={locale} dict={dict} />
      <PopularServicesSection locale={locale} dict={dict} />
      <ProcessSection locale={locale} dict={dict} />
      <ClosingCtaSection locale={locale} dict={dict} />
      <TrustSection locale={locale} dict={dict} />
      <FeaturedProfessionalsSection locale={locale} dict={dict} />
      <FaqSection locale={locale} dict={dict} />
      <CoverageSection locale={locale} dict={dict} />
    </>
  );
}