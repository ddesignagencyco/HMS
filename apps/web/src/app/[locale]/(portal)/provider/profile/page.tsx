import { notFound } from "next/navigation";
import { ProviderProfileView } from "@/features/portal/provider-views";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

export default async function ProviderProfilePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <ProviderProfileView locale={locale} dict={getDictionary(locale)} />;
}
