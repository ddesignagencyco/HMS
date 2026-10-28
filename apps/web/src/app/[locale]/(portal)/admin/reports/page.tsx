import { notFound } from "next/navigation";
import { AdminReports } from "@/features/portal/reports-views";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

/* This route used to render a screen that said reporting did not exist.
   `ReportsController` exists, allows ADMIN as well as FINANCE, and returns a real
   report — so the route stays under `/admin` and the placeholder goes. See
   `features/portal/reports-views.tsx`. */
export default async function AdminReportsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <AdminReports locale={locale} dict={getDictionary(locale)} />;
}