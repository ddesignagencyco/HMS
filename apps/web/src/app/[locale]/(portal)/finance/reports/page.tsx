import { notFound } from "next/navigation";
import { AdminReports } from "@/features/portal/reports-views";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

/* `ReportsController` allows FINANCE as well as ADMIN; FINANCE cannot enter
   `/admin`, so the same screen is served in the finance area too. */
export default async function FinanceReportsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);
  return <AdminReports locale={locale} dict={dict} eyebrow={dict.portal.finance} />;
}
