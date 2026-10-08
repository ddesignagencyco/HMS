import { notFound } from "next/navigation";
import { ProviderEarningsScreen } from "@/features/provider/earnings-view";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

export default async function ProviderEarningsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <ProviderEarningsScreen locale={locale} dict={getDictionary(locale)} />;
}
