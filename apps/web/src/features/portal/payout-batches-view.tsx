'use client';

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
 * rather than a link. It is a separate act from step 3, taken only once the bank
 * has answered: each payout in the batch is recorded as `PAID` or `FAILED`, and a
 * failed one reverses its ledger postings and puts the money back in that
 * provider's wallet. The server would read an empty body as "all paid", so this
 * screen never sends one — it always sends the per-payout results.
 */

import { Banknote, Check, Download, FileSpreadsheet, Loader2, Plus, RefreshCcw, TriangleAlert } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Button, Card, EmptyState, PageHeader, StatCard } from '@/components/ui';
import { downloadFile } from '@/lib/api/download';
import { financeKeys, publicRetry } from '@/lib/api/keys';
import type { Dictionary } from '@/lib/dictionaries';
import { formatDate, formatDateTime, formatMoney, formatNumber, type Locale } from '@/lib/utils';
import { detailOf } from '@/features/auth/auth-feedback';
import { newIdempotencyKey } from '@/lib/api/idempotency';
import { financeApi, payoutBatchCsvPath, type FinancePayout, type FinancePayoutBatch, type FinancePayoutResult } from './finance-api';

/* ---- dates ------------------------------------------------------------ */

const toApiDate = (date: Date): string => {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
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

const isPeriodValid = (start: string, end: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end) && end > start;

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
 * Creates a batch — and only that. The payouts move to `IN_BATCH` and the bank
 * file is written; nothing is paid until the bank has answered and the operator
 * records that answer per payout (`useRecordBankResult`).
 *
 * The create is **not retried** and carries an idempotency key: it gathers rows
 * `FOR UPDATE` and flips them to `IN_BATCH`, so a replayed request must return
 * the first response rather than build a second batch. The server's own
 * protection is the 409 "no approved payouts waiting for a batch".
 */
function useCreateBatch(locale: Locale, dict: Dictionary) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { period: { start: string; end: string }; idempotencyKey: string }) =>
      financeApi.createPayoutBatch({ periodStart: input.period.start, periodEnd: input.period.end }, input.idempotencyKey, { locale }),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: financeKeys.all });
      toast.success(dict.finance.batchCreated.replace('{count}', formatNumber(created.payouts, locale)).replace('{total}', formatMoney(created.totalPaisa, locale)));
    },
    retry: false
  });
}

/** The payouts in one batch still waiting for the bank's answer. `GET
    /finance/payouts` has no batch filter, so the IN_BATCH list is narrowed here. */
function useBatchPayouts(batchId: string, enabled: boolean, locale: Locale) {
  return useQuery({
    queryKey: [...financeKeys.all, 'payouts', 'IN_BATCH'],
    queryFn: ({ signal }) => financeApi.payouts('IN_BATCH', { signal, locale }),
    enabled,
    select: (data) => data.items.filter((payout) => payout.batchId === batchId),
    retry: publicRetry
  });
}

function useRecordBankResult(batchId: string, locale: Locale, dict: Dictionary) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { results: FinancePayoutResult[]; idempotencyKey: string }) => financeApi.markPayoutBatchPaid(batchId, input.results, input.idempotencyKey, { locale }),
    onSuccess: (settled) => {
      void queryClient.invalidateQueries({ queryKey: financeKeys.all });
      toast.success(dict.finance.bankResultSaved.replace('{paid}', formatNumber(settled.paid, locale)).replace('{failed}', formatNumber(settled.failed, locale)));
    },
    retry: false
  });
}

type Decision = { status: 'PAID' | 'FAILED' | null; reason: string };

/** Only payouts with a decision are sent; a FAILED one carries its reason when given. */
export const bankResultsFrom = (payouts: readonly Pick<FinancePayout, 'id'>[], decisions: Record<string, Decision>): FinancePayoutResult[] =>
  payouts.flatMap((payout) => {
    const decision = decisions[payout.id];
    if (decision === undefined || decision.status === null) return [];
    const reason = decision.reason.trim();
    return [decision.status === 'FAILED' && reason !== '' ? { payoutId: payout.id, status: 'FAILED' as const, failureReason: reason } : { payoutId: payout.id, status: decision.status }];
  });

function BankResultForm({ batchId, locale, dict, onDone }: { batchId: string; locale: Locale; dict: Dictionary; onDone: () => void }) {
  const payouts = useBatchPayouts(batchId, true, locale);
  const record = useRecordBankResult(batchId, locale, dict);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  /* One key per opening of this form: a double-click or a lost response replays
     the same answer instead of posting it twice. */
  const [idempotencyKey] = useState(() => newIdempotencyKey(`batch-result:${batchId}:${crypto.randomUUID()}`));

  const items = payouts.data ?? [];
  const results = bankResultsFrom(items, decisions);
  const set = (id: string, patch: Partial<Decision>) => setDecisions((state) => ({ ...state, [id]: { status: state[id]?.status ?? null, reason: state[id]?.reason ?? '', ...patch } }));

  const submit = () => {
    if (results.length === 0) return;
    record.mutate(
      { results, idempotencyKey },
      {
        onSuccess: onDone,
        onError: (error: unknown) => toast.error(detailOf(error, dict) || dict.finance.bankResultFailedToSave)
      }
    );
  };

  if (payouts.isLoading)
    return (
      <p className="text-sm text-muted" aria-busy="true">
        {dict.finance.bankResultLoading}
      </p>
    );
  if (payouts.isError)
    return (
      <p role="alert" className="text-sm text-rose-700">
        {detailOf(payouts.error, dict)}
      </p>
    );
  if (items.length === 0) return <p className="text-sm text-muted">{dict.finance.bankResultNothing}</p>;

  return (
    <div className="grid gap-3">
      <p className="text-xs leading-5 text-secondary">{dict.finance.recordBankResultText}</p>
      <ul className="grid gap-2">
        {items.map((payout) => {
          const decision = decisions[payout.id];
          return (
            <li key={payout.id} className="rounded-[9px] border border-line bg-white p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0 text-sm">
                  <p className="font-semibold text-navy">{payout.providerName}</p>
                  <p className="text-xs text-muted">
                    {payout.institution} · {payout.accountTitle} · ••{payout.accountLast4} · {formatMoney(payout.amountPaisa, locale)}
                  </p>
                </div>
                <div className="flex gap-1.5" role="group" aria-label={payout.providerName}>
                  {(['PAID', 'FAILED'] as const).map((status) => (
                    <Button
                      key={status}
                      type="button"
                      size="sm"
                      variant={decision?.status === status ? 'primary' : 'secondary'}
                      aria-pressed={decision?.status === status}
                      onClick={() => set(payout.id, { status })}
                    >
                      {status === 'PAID' ? dict.finance.bankResultPaid : dict.finance.bankResultFailed}
                    </Button>
                  ))}
                </div>
              </div>
              {decision?.status === 'FAILED' ? (
                <label className="mt-2 block text-xs font-semibold text-secondary">
                  {dict.finance.bankFailureReason}
                  <input
                    className="mt-1 w-full rounded-[9px] border border-line bg-white px-3 py-2 text-sm text-navy outline-none focus:border-primary"
                    maxLength={300}
                    value={decision.reason}
                    onChange={(event) => set(payout.id, { reason: event.target.value })}
                  />
                </label>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div className="flex gap-2">
        <Button type="button" disabled={results.length === 0 || record.isPending} onClick={submit}>
          {record.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Check className="size-4" aria-hidden="true" />}
          {dict.finance.bankResultSave}
        </Button>
        <Button type="button" variant="secondary" disabled={record.isPending} onClick={onDone}>
          {dict.common.cancel}
        </Button>
      </div>
    </div>
  );
}

/* ---- the row ---------------------------------------------------------- */

const BATCH_TONE: Record<FinancePayoutBatch['status'], string> = {
  PAID: 'bg-emerald-50 text-emerald-700',
  EXPORTED: 'bg-blue-50 text-primary-strong',
  PARTIALLY_FAILED: 'bg-rose-50 text-rose-700'
};

function BatchRow({ batch, locale, dict }: { batch: FinancePayoutBatch; locale: Locale; dict: Dictionary }) {
  const [downloading, setDownloading] = useState(false);
  const [recording, setRecording] = useState(false);

  const grabCsv = async () => {
    setDownloading(true);
    const result = await downloadFile(payoutBatchCsvPath(batch.id), locale, `payout-batch-${batch.id}.csv`);
    setDownloading(false);
    if (result.ok) toast.success(dict.finance.batchCsvDownloaded.replace('{file}', result.filename));
    else toast.error(result.error);
  };

  return (
    <>
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
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${BATCH_TONE[batch.status]}`}>{dict.finance.batchStatuses[batch.status]}</span>
          {batch.paidAt !== null ? <p className="mt-1 text-xs text-muted">{formatDateTime(batch.paidAt, locale)}</p> : null}
        </td>
        <td className="p-4 text-end">
          <Button type="button" variant="secondary" size="sm" disabled={downloading} onClick={() => void grabCsv()}>
            {downloading ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Download className="size-3.5" aria-hidden="true" />}
            {dict.finance.batchCsv}
          </Button>
          {batch.status === 'EXPORTED' && !recording ? (
            <Button type="button" size="sm" className="ms-2" onClick={() => setRecording(true)}>
              <Banknote className="size-3.5" aria-hidden="true" />
              {dict.finance.recordBankResult}
            </Button>
          ) : null}
        </td>
      </tr>
      {recording ? (
        <tr>
          <td colSpan={6} className="bg-slate-50 p-4">
            <BankResultForm batchId={batch.id} locale={locale} dict={dict} onDone={() => setRecording(false)} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

/* ---- the screen ------------------------------------------------------- */

export function FinancePayoutBatches({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const batches = usePayoutBatches(locale);
  const create = useCreateBatch(locale, dict);
  /* One key per confirmed intent: a double-submit or a lost response replays the
     same create instead of gathering a second batch. Renewed once it settles. */
  const [createKey, setCreateKey] = useState(() => newIdempotencyKey(`payout-batch:${crypto.randomUUID()}`));
  const initial = useMemo(() => defaultPeriod(), []);
  const [period, setPeriod] = useState(initial);
  const [confirming, setConfirming] = useState(false);

  const items = batches.data?.items ?? [];
  const settled = items.filter((row) => row.status === 'PAID');
  const awaitingBank = items.filter((row) => row.status === 'EXPORTED');
  const failed = items.filter((row) => row.status === 'PARTIALLY_FAILED');

  const field = 'mt-1.5 w-full rounded-[9px] border border-line bg-white px-3 py-2.5 text-sm text-navy outline-none focus:border-primary focus:ring-4 focus:ring-blue-100';
  const valid = isPeriodValid(period.start, period.end);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    create.mutate(
      { period, idempotencyKey: createKey },
      {
        onSuccess: () => setCreateKey(newIdempotencyKey(`payout-batch:${crypto.randomUUID()}`)),
        onError: (error: unknown) => toast.error(detailOf(error, dict) || dict.finance.batchCreateFailed),
        /* Confirmation is dismissed on success *and* on failure: a 409 "nothing to
         batch" is a complete answer, and leaving the arm button lit would invite
         the operator to press it again against the same empty queue. */
        onSettled: () => setConfirming(false)
      }
    );
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
                <p className="text-sm font-medium leading-6 text-rose-800">{batches.error instanceof Error ? batches.error.message : dict.finance.loadError}</p>
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
                <label className="block mb-2 text-xs font-semibold text-secondary" htmlFor="batch-start">
                  {dict.reports.periodStart}
                </label>
                <input id="batch-start" type="date" className={field} value={period.start} onChange={(event) => setPeriod((state) => ({ ...state, start: event.target.value }))} required />
              </div>
              <div>
                <label className="block mb-2 text-xs font-semibold text-secondary" htmlFor="batch-end">
                  {dict.reports.periodEnd}
                </label>
                <input id="batch-end" type="date" className={field} value={period.end} onChange={(event) => setPeriod((state) => ({ ...state, end: event.target.value }))} required />
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
                      {create.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Check className="size-4" aria-hidden="true" />}
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
