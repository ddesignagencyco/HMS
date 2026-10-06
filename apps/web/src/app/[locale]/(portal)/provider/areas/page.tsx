import { notFound } from "next/navigation";
import { ProviderAreasScreen } from "@/features/provider/areas-view";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

export default async function ProviderAreasPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <ProviderAreasScreen locale={locale} dict={getDictionary(locale)} />;
}
