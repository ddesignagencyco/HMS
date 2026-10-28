import { notFound } from "next/navigation";
import { FinanceDebts } from "@/features/portal/finance-views";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

export default async function FinanceDebtsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <FinanceDebts locale={locale} dict={getDictionary(locale)} />;
}
