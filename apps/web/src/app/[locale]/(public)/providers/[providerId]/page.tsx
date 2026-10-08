import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProviderProfile } from "@/features/discovery/provider-profile";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

export async function generateMetadata({ params }: { params: Promise<{ locale: string; providerId: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const dict = isLocale(locale) ? getDictionary(locale) : getDictionary("en");
  return { title: dict.profile.eyebrow, description: dict.search.intro };
}

/** The API keys providers by id, so the segment is an id rather than a slug,
    and the profile must be read per request rather than baked into a build. */
export const dynamic = "force-dynamic";

export default async function ProviderDetailPage({
  params,
}: {
  params: Promise<{ locale: string; providerId: string }>;
}) {
  const { locale, providerId } = await params;
  if (!isLocale(locale)) notFound();
  return <ProviderProfile locale={locale} dict={getDictionary(locale)} providerId={providerId} />;
}