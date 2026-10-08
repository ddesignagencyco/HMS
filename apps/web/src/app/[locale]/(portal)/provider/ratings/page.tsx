import { notFound } from "next/navigation";
import { ProviderRatingsScreen } from "@/features/provider/ratings-view";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

export default async function ProviderRatingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <ProviderRatingsScreen locale={locale} dict={getDictionary(locale)} />;
}
