import { notFound } from "next/navigation";
import { FinanceRefunds } from "@/features/portal/finance-views";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

export default async function FinanceRefundsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <FinanceRefunds locale={locale} dict={getDictionary(locale)} />;
}
