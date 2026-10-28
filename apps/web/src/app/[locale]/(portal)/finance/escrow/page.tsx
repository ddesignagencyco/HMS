import { notFound } from "next/navigation";
import { EscrowView } from "@/features/portal/finance-views";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

export default async function EscrowPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <EscrowView locale={locale} dict={getDictionary(locale)} />;
}
