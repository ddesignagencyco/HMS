import { notFound } from "next/navigation";
import { ProviderDocumentsScreen } from "@/features/provider/documents-view";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

export default async function ProviderDocumentsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <ProviderDocumentsScreen locale={locale} dict={getDictionary(locale)} />;
}