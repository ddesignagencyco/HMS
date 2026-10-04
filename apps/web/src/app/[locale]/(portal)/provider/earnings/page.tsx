import { notFound } from "next/navigation";
import { ProviderEarnings } from "@/features/portal/provider-workspace-views";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

export default async function ProviderEarningsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <ProviderEarnings locale={locale} dict={getDictionary(locale)} />;
}
