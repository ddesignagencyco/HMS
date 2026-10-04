import { notFound } from "next/navigation";
import { ProviderDashboard } from "@/features/portal/provider-views";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

export default async function ProviderPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <ProviderDashboard locale={locale} dict={getDictionary(locale)} />;
}
