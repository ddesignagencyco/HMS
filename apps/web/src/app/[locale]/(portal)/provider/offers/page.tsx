import { notFound } from "next/navigation";
import { ProviderOffersView } from "@/features/provider/offers-view";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

export default async function ProviderOffersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <ProviderOffersView locale={locale} dict={getDictionary(locale)} />;
}
