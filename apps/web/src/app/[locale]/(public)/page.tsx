import { notFound } from "next/navigation";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";
import { HeroSearch } from "@/features/home/hero-search";
import { BrandTrustSection, CategorySection, ClosingCtaSection, CoverageSection, FaqSection, HomeHero, PopularServicesSection, ProcessSection, ReviewsSection, TrustSection } from "@/features/home/home-sections";

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);

  return (
    <>
      {/* The search control reads the catalogue and places endpoints itself, so
          the homepage passes no mock service or area list into it. */}
      <HomeHero locale={locale} dict={dict} search={<HeroSearch locale={locale} dict={dict} />} />
      <CategorySection locale={locale} dict={dict} />
      <BrandTrustSection locale={locale} dict={dict} />
      <PopularServicesSection locale={locale} dict={dict} />
      <ProcessSection locale={locale} dict={dict} />
      <ClosingCtaSection locale={locale} dict={dict} />
      <TrustSection locale={locale} dict={dict} />
      <ReviewsSection locale={locale} dict={dict} />
      <FaqSection locale={locale} dict={dict} />
      <CoverageSection locale={locale} dict={dict} />
    </>
  );
}
