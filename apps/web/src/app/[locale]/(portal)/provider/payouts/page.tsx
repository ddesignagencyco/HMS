import { notFound } from "next/navigation";
import { ProviderPayoutsScreen } from "@/features/provider/payouts-view";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

export default async function ProviderPayoutsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <ProviderPayoutsScreen locale={locale} dict={getDictionary(locale)} />;
}
