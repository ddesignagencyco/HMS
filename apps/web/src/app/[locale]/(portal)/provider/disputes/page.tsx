import { notFound } from "next/navigation";
import { ProviderDisputesScreen } from "@/features/provider/disputes-view";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

export default async function ProviderDisputesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <ProviderDisputesScreen locale={locale} dict={getDictionary(locale)} />;
}
