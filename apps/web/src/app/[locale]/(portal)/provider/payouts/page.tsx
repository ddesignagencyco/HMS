import { notFound } from "next/navigation";
import { ProviderPayouts } from "@/features/portal/provider-workspace-views";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

export default async function ProviderPayoutsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <ProviderPayouts locale={locale} dict={getDictionary(locale)} />;
}
