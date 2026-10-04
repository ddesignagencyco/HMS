import { notFound } from "next/navigation";
import { CustomerPlans } from "@/features/portal/customer-plan-views";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

export default async function AccountPlansPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <CustomerPlans locale={locale} dict={getDictionary(locale)} />;
}
