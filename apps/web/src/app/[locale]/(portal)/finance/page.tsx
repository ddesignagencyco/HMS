import { notFound } from "next/navigation";
import { FinanceOverviewView } from "@/features/portal/staff-views";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

export default async function FinancePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <FinanceOverviewView locale={locale} dict={getDictionary(locale)} />;
}
