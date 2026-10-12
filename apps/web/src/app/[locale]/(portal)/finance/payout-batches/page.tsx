import { notFound } from "next/navigation";
import { FinancePayoutBatches } from "@/features/portal/payout-batches-view";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

/* Batches are their own route rather than a tab on `/finance/payouts`: the
   payouts screen is the per-request queue an operator works through, while a
   batch is a bank file with a lifecycle of its own that outlives the requests it
   gathered. Mixing them would put a bank CSV next to an individual payout row. */
export default async function FinancePayoutBatchesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <FinancePayoutBatches locale={locale} dict={getDictionary(locale)} />;
}