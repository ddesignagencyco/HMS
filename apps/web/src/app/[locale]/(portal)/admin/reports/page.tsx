import { notFound } from "next/navigation";
import { AdminReports } from "@/features/portal/admin-ops-views";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

export default async function AdminReportsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <AdminReports locale={locale} dict={getDictionary(locale)} />;
}
