import { notFound } from "next/navigation";
import { ProviderServicesView } from "@/features/portal/provider-views";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

export default async function ProviderServicesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <ProviderServicesView locale={locale} dict={getDictionary(locale)} />;
}
