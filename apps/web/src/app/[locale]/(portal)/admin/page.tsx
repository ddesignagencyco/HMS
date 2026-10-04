import { notFound } from "next/navigation";
import { AdminOverview } from "@/features/portal/staff-views";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

export default async function AdminPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <AdminOverview locale={locale} dict={getDictionary(locale)} />;
}
