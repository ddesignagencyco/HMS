import { notFound } from "next/navigation";
import { AdminOpsBoard } from "@/features/admin/ops-board";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

/* `GET /admin/ops-board` (and its stream) allows FINANCE as well as ADMIN, but
   the web only served the board under `/admin`, an area FINANCE cannot enter.
   This is the same board in the finance area. */
export default async function FinanceOpsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);
  return <AdminOpsBoard locale={locale} dict={dict} eyebrow={dict.portal.finance} />;
}
