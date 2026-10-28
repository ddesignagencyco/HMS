import { notFound } from "next/navigation";
import { AdminOpsBoard } from "@/features/admin/ops-board";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

/* `AdminOps` in `ops-view.tsx` counted rows out of the complaints, disputes and
   penalties queues and put the totals on tiles — no bookings, no queue depth, no
   SLA count, no escrow, and a 200-row ceiling on every figure. `GET
   /admin/ops-board` answers all of that from the tables it describes and pushes
   updates over SSE, so the board is now that endpoint. `AdminOverview`, the
   `/admin` landing, is a different screen and stays in `ops-view.tsx`. */
export default async function AdminOpsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <AdminOpsBoard locale={locale} dict={getDictionary(locale)} />;
}