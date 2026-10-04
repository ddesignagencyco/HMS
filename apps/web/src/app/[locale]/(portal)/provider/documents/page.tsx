import { notFound } from "next/navigation";
import { ProviderDocuments } from "@/features/portal/provider-workspace-views";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

export default async function ProviderDocumentsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <ProviderDocuments locale={locale} dict={getDictionary(locale)} />;
}
