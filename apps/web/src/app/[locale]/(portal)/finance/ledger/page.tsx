import { notFound } from "next/navigation";
import { FinanceLedger } from "@/features/portal/finance-views";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

export default async function FinanceLedgerPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <FinanceLedger locale={locale} dict={getDictionary(locale)} />;
}
