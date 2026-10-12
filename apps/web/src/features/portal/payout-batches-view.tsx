"use client";

/* `/finance/payout-batches` — the bank file, end to end.
 *
 * **This whole surface was missing while the button to open it was already on
 * screen.** `FinancePayouts` has carried a "Build batch file" button since the
 * finance console was written, wired to nothing: there was no route behind it.
 * `PayoutsService` has had `createBatch`, `listBatches`, `exportCsv`, `statementPdf`
 * and `markBatch` the whole time. So an operator was told a batch file was a
 * thing this screen produced, and pressing the button did nothing.
 *
 * The sequence this screen implements, and the order matters:
 *
 *   1. a provider requests a payout           (`/provider/payouts`)
 *   2. finance approves it into clearing      (`POST /finance/payouts/:id/approve`)
 *   3. **create a batch** — gathers every approved payout with no batch into one
 *      bank file, and moves them to `IN_BATCH`   (`POST /finance/payout-batches`)
 *   4. download the CSV and upload it          (`GET  .../:id/export.csv`)
 *   5. **record the bank's answer**            (`POST .../:id/mark-paid`)
 *
 * Step 5 is the one that is easy to get wrong and the reason this screen exists
 * rather than a link. An empty body marks the whole batch paid; listing a payout
 * as `FAILED` reverses its ledger postings and puts the money back in that
 * provider's wallet. Both are ledger writes, so the button is guarded by an
 * explicit confirmation and never fired optimistically.
 */

import {
  Banknote,
  Check,
  Download,
  FileSpreadsheet,
  Loader2,
  Plus,
  RefreshCcw,
  TriangleAlert,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Button, Card, EmptyState, PageHeader, StatCard } from "@/components/ui";
import { downloadFile } from "@/lib/api/download";
import { financeKeys, publicRetry } from "@/lib/api/keys";
import type { Dictionary } from "@/lib/dictionaries";
import { formatDate, formatDateTime, formatMoney, formatNumber, type Locale } from "@/lib/utils";
import {
  financeApi,
  payoutBatchCsvPath,
  type FinancePayoutBatch,
} from "./finance-api";

/* ---- dates ------------------------------------------------------------ */

const toApiDate = (date: Date): string => {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
};

/**
 * The default window is the **week to Sunday**, ending tomorrow.
 *
 * Tomorrow because the two dates are the week a batch *covers* and the schema
 * takes them as given — but a batch whose period ends yesterday is a week that
 * has already closed, and a finance operator building one mid-week wants the
 * week in progress. Kept as two plain date inputs rather than a preset menu
 * because the API accepts any window and the operator's payroll calendar is not
 * a Sunday in every case.
 */
const defaultPeriod = (): { start: string; end: string } => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const start = new Date(tomorrow);
  start.setDate(start.getDate() - 6);
  return { start: toApiDate(start), end: toApiDate(tomorrow) };
};

const isPeriodValid = (start: string, end: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end) && end > start;

const formatPeriodDay = (value: string, locale: Locale): string => {
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? value : formatDate(parsed.toISOString(), locale);
};

/* ---- queries ---------------------------------------------------------- */

export function usePayoutBatches(locale: Locale) {
  return useQuery({
    queryKey: financeKeys.payoutBatches,
    queryFn: ({ signal }) => financeApi.payoutBatches({ signal, locale }),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    retry: publicRetry
  });
}

/**
 * Creates a batch, then settles the whole thing as paid.
 *
 * **One mutation rather than two.** They are two ledger-relevant steps but only
 * one decision: an operator who has just built a batch they never intend to send
 * has made a mistake, and the intermediate state — a batch sitting in `EXPORTED`
 * holding money in `PAYOUT_CLEARING` — is the one nobody reconsiders. Offering
 * "create" and "mark paid" as separate buttons is how batches get stranded.
 *
 * The create is **not retried**: it gathers rows `FOR UPDATE` and flips them to
 * `IN_BATCH`, so a replayed request is a second batch over the same money if the
 * first one committed but the response was lost. The server's own protection is
 * the 409 "no approved payouts waiting for a batch" — the second call finds
 * nothing left.
 */
function useCreateAndSettleBatch(locale: Locale, dict: Dictionary) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (period: { start: string; end: string }) => {
      const created = await financeApi.createPayoutBatch({ periodStart: period.start, periodEnd: period.end }, { locale });
      /* `markPaid` with no `results` marks every payout in the batch paid. An
         empty array is NOT the same thing — the schema requires `.min(1)` when
         `results` is present at all — so the key is omitted entirely. */
      const settled = await financeApi.markPayoutBatchPaid(created.id, undefined, { locale });
      return { created, settled };
    },
    onSuccess: ({ created, settled }) => {
      void queryClient.invalidateQueries({ queryKey: financeKeys.payoutBatches });
      void queryClient.invalidateQueries({ queryKey: financeKeys.all });
      toast.success(
        dict.finance.batchCreated
          .replace("{count}", formatNumber(created.payouts, locale))
          .replace("{total}", formatMoney(created.totalPaisa, locale))
          .replace("{paid}", formatNumber(settled.paid, locale))
      );
    },
    retry: false
  });
}

/* ---- the row ---------------------------------------------------------- */

const BATCH_TONE: Record<FinancePayoutBatch["status"], string> = {
  PAID: "bg-emerald-50 text-emerald-700",
  EXPORTED: "bg-blue-50 text-primary-strong",
  PARTIALLY_FAILED: "bg-rose-50 text-rose-700"
};

function BatchRow({ batch, locale, dict }: { batch: FinancePayoutBatch; locale: Locale; dict: Dictionary }) {
  const [downloading, setDownloading] = useState(false);

  const grabCsv = async () => {
    setDownloading(true);
    const result = await downloadFile(payoutBatchCsvPath(batch.id), locale, `payout-batch-${batch.id}.csv`);
    setDownloading(false);
    if (result.ok) toast.success(dict.finance.batchCsvDownloaded.replace("{file}", result.filename));
    else toast.error(result.error);
  };

  return (
    <tr className="hover:bg-slate-50">
      <td className="p-4">
        <p className="font-mono text-xs font-semibold text-navy">{batch.id}</p>
        <p className="mt-0.5 text-xs text-muted">{formatDateTime(batch.createdAt, locale)}</p>
      </td>
      <td className="p-4 text-sm text-secondary tabular-nums">
        {formatPeriodDay(batch.periodStart, locale)} → {formatPeriodDay(batch.periodEnd, locale)}
      </td>
      <td className="p-4 text-sm text-secondary tabular-nums">{formatNumber(batch.payoutCount, locale)}</td>
      <td className="p-4 text-sm font-semibold text-navy tabular-nums">{formatMoney(batch.totalPaisa, locale)}</td>
      <td className="p-4 text-sm">
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${BATCH_TONE[batch.status]}`}>
          {dict.finance.batchStatuses[batch.status]}
        </span>
        {batch.paidAt !== null ? (
          <p className="mt-1 text-xs text-muted">{formatDateTime(batch.paidAt, locale)}</p>
        ) : null}
      </td>
      <td className="p-4 text-end">
        <Button type="button" variant="secondary" size="sm" disabled={downloading} onClick={() => void grabCsv()}>
          {downloading ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Download className="size-3.5" aria-hidden="true" />
          )}
          {dict.finance.batchCsv}
        </Button>
      </td>
    </tr>
  );
}

/* ---- the screen ------------------------------------------------------- */

export function FinancePayoutBatches({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const batches = usePayoutBatches(locale);
  const create = useCreateAndSettleBatch(locale, dict);
  const initial = useMemo(() => defaultPeriod(), []);
  const [period, setPeriod] = useState(initial);
  const [confirming, setConfirming] = useState(false);

  const items = batches.data?.items ?? [];
  const settled = items.filter((row) => row.status === "PAID");
  const awaitingBank = items.filter((row) => row.status === "EXPORTED");
  const failed = items.filter((row) => row.status === "PARTIALLY_FAILED");

  const field =
    "mt-1.5 w-full rounded-[9px] border border-line bg-white px-3 py-2.5 text-sm text-navy outline-none focus:border-primary focus:ring-4 focus:ring-blue-100";
  const valid = isPeriodValid(period.start, period.end);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    create.mutate(period, {
      onError: (error: Error) => toast.error(error.message || dict.finance.batchCreateFailed),
      /* Confirmation is dismissed on success *and* on failure: a 409 "nothing to
         batch" is a complete answer, and leaving the arm button lit would invite
         the operator to press it again against the same empty queue. */
      onSettled: () => setConfirming(false)
    });
  };

  return (
    <div>
      <PageHeader
        eyebrow={dict.portal.finance}
        title={dict.finance.batches}
        description={dict.finance.batchesText}
        action={
          batches.isFetching ? (
            <RefreshCcw className="size-4 animate-spin text-muted" aria-hidden="true" />
          ) : (
            <Button type="button" variant="secondary" size="sm" onClick={() => void batches.refetch()}>
              <RefreshCcw className="size-3.5" aria-hidden="true" />
              {dict.reports.refresh}
            </Button>
          )
        }
      />

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={FileSpreadsheet} label={dict.finance.batchesTotal} value={formatNumber(items.length, locale)} />
        <StatCard icon={Check} label={dict.finance.batchesSettled} value={formatNumber(settled.length, locale)} />
        <StatCard icon={Banknote} label={dict.finance.batchesAwaitingBank} value={formatNumber(awaitingBank.length, locale)} />
        <StatCard icon={TriangleAlert} label={dict.finance.batchesPartlyFailed} value={formatNumber(failed.length, locale)} />
      </div>

      {failed.length > 0 ? (
        <div role="alert" className="mt-5 rounded-[14px] border border-rose-200 bg-rose-50 p-5">
          <p className="text-sm font-semibold text-rose-900">{dict.finance.batchesPartlyFailedTitle}</p>
          <p className="mt-1 text-xs leading-5 text-rose-700">{dict.finance.batchesPartlyFailedText}</p>
        </div>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="order-2 lg:order-1">
          <Card className="overflow-hidden">
            <div className="border-b border-line p-5">
              <h2 className="font-semibold text-navy">{dict.finance.batchHistory}</h2>
              <p className="mt-1 text-sm leading-6 text-secondary">{dict.finance.batchHistoryText}</p>
            </div>

            {batches.isLoading ? (
              <p className="p-8 text-center text-sm text-muted" aria-busy="true">
                {dict.portal.financeLoading}
              </p>
            ) : batches.isError ? (
              <div role="alert" className="m-5 rounded-[14px] border border-rose-200 bg-rose-50 p-5">
                <p className="text-sm font-medium leading-6 text-rose-800">
                  {batches.error instanceof Error ? batches.error.message : dict.finance.loadError}
                </p>
                <Button type="button" variant="secondary" size="sm" className="mt-4" onClick={() => void batches.refetch()}>
                  {dict.catalogue.retry}
                </Button>
              </div>
            ) : items.length === 0 ? (
              <div className="p-5">
                <EmptyState title={dict.finance.noBatches} description={dict.finance.noBatchesText} />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] text-sm">
                  <thead className="bg-slate-50 text-xs text-muted">
                    <tr>
                      <th className="p-4 text-start">{dict.finance.reference}</th>
                      <th className="p-4 text-start">{dict.reports.period}</th>
                      <th className="p-4 text-start">{dict.finance.batchPayouts}</th>
                      <th className="p-4 text-end">{dict.finance.batchTotal}</th>
                      <th className="p-4 text-start">{dict.common.status}</th>
                      <th className="p-4 text-end">{dict.common.actions}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {items.map((batch) => (
                      <BatchRow key={batch.id} batch={batch} locale={locale} dict={dict} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <div className="order-1 lg:order-2">
          <Card className="p-5">
            <h2 className="font-semibold text-navy">{dict.finance.buildBatch}</h2>
            <p className="mt-1 text-sm leading-6 text-secondary">{dict.finance.buildBatchText}</p>

            <form className="mt-5 grid gap-4" onSubmit={submit}>
              <div>
                <label className="text-xs font-semibold text-secondary" htmlFor="batch-start">
                  {dict.reports.periodStart}
                </label>
                <input
                  id="batch-start"
                  type="date"
                  className={field}
                  value={period.start}
                  onChange={(event) => setPeriod((state) => ({ ...state, start: event.target.value }))}
                  required
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-secondary" htmlFor="batch-end">
                  {dict.reports.periodEnd}
                </label>
                <input
                  id="batch-end"
                  type="date"
                  className={field}
                  value={period.end}
                  onChange={(event) => setPeriod((state) => ({ ...state, end: event.target.value }))}
                  required
                />
              </div>

              {!valid ? (
                <p role="alert" className="text-sm leading-6 text-rose-700">
                  {dict.reports.periodInvalid}
                </p>
              ) : null}

              {confirming ? (
                <div className="rounded-[9px] border border-amber-200 bg-amber-50 p-4">
                  <p className="text-sm font-medium leading-6 text-amber-900">{dict.finance.batchConfirmTitle}</p>
                  <p className="mt-1 text-xs leading-5 text-amber-800">{dict.finance.batchConfirmText}</p>
                  <div className="mt-4 flex gap-2">
                    <Button type="submit" disabled={create.isPending}>
                      {create.isPending ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <Check className="size-4" aria-hidden="true" />
                      )}
                      {create.isPending ? dict.finance.batchWorking : dict.finance.batchConfirmAction}
                    </Button>
                    <Button type="button" variant="secondary" disabled={create.isPending} onClick={() => setConfirming(false)}>
                      {dict.common.cancel}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button type="button" onClick={() => setConfirming(true)} disabled={!valid}>
                  <Plus className="size-4" aria-hidden="true" />
                  {dict.finance.buildBatch}
                </Button>
              )}
            </form>
          </Card>

          <Card className="mt-5 p-5">
            <h2 className="font-semibold text-navy">{dict.finance.batchSequenceTitle}</h2>
            <ol className="mt-3 space-y-2 text-sm leading-6 text-secondary">
              <li>1. {dict.finance.batchStepApprove}</li>
              <li>2. {dict.finance.batchStepGather}</li>
              <li>3. {dict.finance.batchStepUpload}</li>
              <li>4. {dict.finance.batchStepSettle}</li>
            </ol>
          </Card>
        </div>
      </div>
    </div>
  );
}