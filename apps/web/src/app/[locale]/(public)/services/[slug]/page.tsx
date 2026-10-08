import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ServiceDetail } from "@/features/discovery/service-detail";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

export async function generateMetadata({ params }: { params: Promise<{ locale: string; slug: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const dict = isLocale(locale) ? getDictionary(locale) : getDictionary("en");
  return { title: dict.catalogue.breadcrumbServices, description: dict.catalogue.intro };
}

/** One service by slug, read from the catalogue API at request time. */
export const dynamic = "force-dynamic";

export default async function ServiceDetailPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  return <ServiceDetail locale={locale} dict={getDictionary(locale)} slug={slug} />;
}