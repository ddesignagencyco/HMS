import { notFound } from "next/navigation";
import { FinanceCash } from "@/features/portal/finance-views";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

export default async function FinanceCashPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <FinanceCash locale={locale} dict={getDictionary(locale)} />;
}
