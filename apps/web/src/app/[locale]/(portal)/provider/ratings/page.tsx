import { notFound } from "next/navigation";
import { ProviderRatings } from "@/features/portal/provider-workspace-views";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

export default async function ProviderRatingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <ProviderRatings locale={locale} dict={getDictionary(locale)} />;
}
