import { notFound } from "next/navigation";
import { CustomerDashboard } from "@/features/portal/customer-views";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

export default async function AccountPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <CustomerDashboard locale={locale} dict={getDictionary(locale)} />;
}
