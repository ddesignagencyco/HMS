import { notFound } from "next/navigation";
import { ProviderServicesScreen } from "@/features/provider/services-view";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

export default async function ProviderServicesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <ProviderServicesScreen locale={locale} dict={getDictionary(locale)} />;
}