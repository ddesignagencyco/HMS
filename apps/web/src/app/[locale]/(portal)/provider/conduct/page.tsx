import { notFound } from "next/navigation";
import { ProviderConduct } from "@/features/portal/provider-workspace-views";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

export default async function ProviderConductPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <ProviderConduct locale={locale} dict={getDictionary(locale)} />;
}
