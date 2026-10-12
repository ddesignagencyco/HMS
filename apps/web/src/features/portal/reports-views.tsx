"use client";

/* `/admin/reports` — the reports finance actually asked for, on the real API.
 *
 * **This screen used to be a placeholder that said there was no backend.** That
 * was true when it was written and stopped being true when `ReportsController`
 * and `ReportsService` landed. It went on saying otherwise, which is the failure
 * mode this codebase is written against: a screen that describes the absence of
 * a thing is just as wrong as one that invents it, and it keeps being wrong for
 * as long as nobody checks.
 *
 * Three things about this API shape the whole screen:
 *
 * · **A report is a run, not a response.** `POST /finance/reports` queues work a
 *   background worker does and returns immediately. There is no body of numbers
 *   to render — there is a `QUEUED`/`RUNNING`/`DONE`/`FAILED` row to poll, and a
 *   file to download once it is `DONE`. A screen that wanted a chart had to wait
 *   for this endpoint; there is no synchronous aggregate anywhere, and that is
 *   deliberate (see `reports.service.ts:47`).
 *
 * · **Revenue comes from the ledger, not from `bookings.total`** — and the two
 *   are not interchangeable. The report names commission and released-to-provider
 *   separately for exactly this reason, so this screen must never sum them or
 *   present one as the other.
 *
 * · **`totalPaisa` arrives as a string** because Postgres int8 does not survive
 *   JSON as a number. It is converted here and nowhere else.
 *
 * **Asking twice returns the open run.** `reports.service.ts:78` matches on
 * type + period + status and hands back the run already in flight, so a
 * double-click cannot start two copies of the same numbers — but the button is
 * still disabled while the request is out, because the second click would show
 * the operator a row they did not mean to create.
 */

import {
  BarChart3,
  CheckCircle2,
  Download,
  Loader2,
  RefreshCcw,
  XCircle,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Button, Card, EmptyState, PageHeader, StatCard } from "@/components/ui";
import { downloadFile } from "@/lib/api/download";
import { financeKeys, FRESHNESS, publicRetry } from "@/lib/api/keys";
import type { Dictionary } from "@/lib/dictionaries";
import { formatDate, formatDateTime, formatMoney, formatNumber, type Locale } from "@/lib/utils";
import {
  financeApi,
  reportDownloadPath,
  REPORT_FORMATS,
  REPORT_TYPES,
  type FinanceReportRun,
  type ReportFormat,
  type ReportType,
} from "./finance-api";

/* ---- money ------------------------------------------------------------ */

/**
 * A report's total, as a number the screen can format.
 *
 * `totalPaisa` is a decimal string of paisa on purpose. `Number(...)` on a string
 * that is not a number yields `NaN`, and `formatMoney(NaN)` renders "PKR NaN" on
 * a finance screen — so this returns `null` for anything unparseable and every
 * caller treats null as "the run has no total yet", which is the honest reading
 * of a QUEUED row.
 */
const reportTotal = (run: FinanceReportRun): number | null => {
  if (run.totalPaisa === null) return null;
  const paisa = Number(run.totalPaisa);
  return Number.isSafeInteger(paisa) ? paisa : null;
};

/* ---- dates ------------------------------------------------------------ */

/** `YYYY-MM-DD` in local time — the format both schemas insist on. */
const toApiDate = (date: Date): string => {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
};

const addDays = (date: Date, days: number): Date => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

/**
 * The default window: the last 30 days, ending **tomorrow**.
 *
 * Tomorrow rather than today because `periodEnd` is **exclusive**
 * (`reports.controller.ts`: "exclusive, so adjacent periods tile without a gap or
 * an overlap"). Ending on today would silently drop today from every report — a
 * finance figure that is quietly one day short every single time, which is the
 * hardest kind of wrong number to notice.
 */
const defaultPeriod = (): { start: string; end: string } => {
  const today = new Date();
  return { start: toApiDate(addDays(today, -29)), end: toApiDate(addDays(today, 1)) };
};

/**
 * The same rule the server enforces, checked before the request.
 *
 * `periodEnd > periodStart` is a `.refine` on the schema, so an inverted range is
 * a 422 with no explanation of which field is wrong.
 */
const isPeriodValid = (start: string, end: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end) && end > start;

/** `YYYY-MM-DD` rendered for a person, without pretending to be a timestamp. */
const formatPeriodDay = (value: string, locale: Locale): string => {
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? value : formatDate(parsed.toISOString(), locale);
};

/* ---- queries ---------------------------------------------------------- */

/**
 * Your own runs, newest first. Capped at 50 by the server.
 *
 * Refetched whenever a mutation lands, and **never on a timer of its own** — the
 * per-run poller below is what watches a run in progress, so that a list of 50
 * finished reports is not re-read every few seconds to watch one of them build.
 */
export function useReportRuns(locale: Locale) {
  return useQuery({
    queryKey: financeKeys.reports,
    queryFn: ({ signal }) => financeApi.reports({ signal, locale }),
    staleTime: 0,
    gcTime: 60_000,
    retry: publicRetry,
  });
}

/**
 * Watches **one** run until it stops moving.
 *
 * Only active while `status` is `QUEUED` or `RUNNING`, and the interval is three
 * seconds: the server recomputes nothing per client here, so this is one small
 * indexed read, and the endpoint it hits (`GET /finance/reports/{id}`) is
 * deliberately the cheap one.
 *
 * `refetchInterval` returning `false` is what stops it — without that the
 * interval would keep firing after the report finished, which is a pointless
 * request forever.
 */
function useReportPoller(runId: string | undefined, status: FinanceReportRun["status"] | undefined, locale: Locale) {
  const watching = runId !== undefined && (status === "QUEUED" || status === "RUNNING");
  return useQuery({
    queryKey: financeKeys.report(runId ?? ""),
    queryFn: ({ signal }) => financeApi.report(runId as string, { signal, locale }),
    enabled: watching,
    staleTime: 0,
    gcTime: 60_000,
    retry: publicRetry,
    refetchInterval: watching ? 3_000 : false,
  });
}

/** Queues a run. Invalidates the list; never retried. */
export function useRequestReport(locale: Locale) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { type: ReportType; periodStart: string; periodEnd: string; format: ReportFormat }) =>
      financeApi.requestReport(input, { locale }),
    onSuccess: (run) => {
      void queryClient.invalidateQueries({ queryKey: financeKeys.reports });
      /* Drop any stale copy of this run so the poller starts from the truth the
         POST just returned rather than from a previous view of the same id. */
      queryClient.setQueryData(financeKeys.report(run.id), run);
    },
    retry: false,
  });
}

/* ---- the form --------------------------------------------------------- */

type FormState = {
  type: ReportType;
  periodStart: string;
  periodEnd: string;
  format: ReportFormat;
};

function ReportRequestForm({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const initial = useMemo(() => {
    const period = defaultPeriod();
    return { type: "REVENUE", periodStart: period.start, periodEnd: period.end, format: "XLSX" } satisfies FormState;
  }, []);
  const [form, setForm] = useState<FormState>(initial);
  const request = useRequestReport(locale);

  const periodValid = isPeriodValid(form.periodStart, form.periodEnd);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!periodValid) return;
    request.mutate(
      { ...form },
      {
        onSuccess: (run) => {
          toast.success(
            run.status === "DONE"
              ? dict.reports.requestedAlreadyReady
              : dict.reports.requestedBuilding
          );
          setForm(initial);
        },
        onError: (error: Error) => toast.error(error.message || dict.reports.requestFailed),
      }
    );
  };

  const field =
    "mt-1.5 w-full rounded-[9px] border border-line bg-white px-3 py-2.5 text-sm text-navy outline-none focus:border-primary focus:ring-4 focus:ring-blue-100";

  return (
    <Card className="p-5">
      <h2 className="font-semibold text-navy">{dict.reports.requestTitle}</h2>
      <p className="mt-1 text-sm leading-6 text-secondary">{dict.reports.requestText}</p>

      <form className="mt-5 grid gap-4 sm:grid-cols-2" onSubmit={submit}>
        <div>
          <label className="text-xs font-semibold text-secondary" htmlFor="report-type">
            {dict.reports.reportType}
          </label>
          <select
            id="report-type"
            className={field}
            value={form.type}
            onChange={(event) => setForm((state) => ({ ...state, type: event.target.value as ReportType }))}
          >
            {REPORT_TYPES.map((type) => (
              <option key={type} value={type}>
                {dict.reports.types[type]}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-xs leading-5 text-muted">{dict.reports.typesNote}</p>
        </div>

        <div>
          <label className="text-xs font-semibold text-secondary" htmlFor="report-format">
            {dict.reports.reportFormat}
          </label>
          <select
            id="report-format"
            className={field}
            value={form.format}
            onChange={(event) => setForm((state) => ({ ...state, format: event.target.value as ReportFormat }))}
          >
            {REPORT_FORMATS.map((format) => (
              <option key={format} value={format}>
                {dict.reports.formats[format]}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-xs leading-5 text-muted">{dict.reports.formatNote}</p>
        </div>

        <div>
          <label className="text-xs font-semibold text-secondary" htmlFor="period-start">
            {dict.reports.periodStart}
          </label>
          <input
            id="period-start"
            type="date"
            className={field}
            value={form.periodStart}
            onChange={(event) => setForm((state) => ({ ...state, periodStart: event.target.value }))}
            required
          />
        </div>

        <div>
          <label className="text-xs font-semibold text-secondary" htmlFor="period-end">
            {dict.reports.periodEnd}
          </label>
          <input
            id="period-end"
            type="date"
            className={field}
            value={form.periodEnd}
            onChange={(event) => setForm((state) => ({ ...state, periodEnd: event.target.value }))}
            required
          />
        </div>

        {!periodValid ? (
          <p role="alert" className="text-sm leading-6 text-rose-700 sm:col-span-2">
            {dict.reports.periodInvalid}
          </p>
        ) : null}

        <div className="sm:col-span-2">
          <Button type="submit" disabled={!periodValid || request.isPending}>
            {request.isPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <BarChart3 className="size-4" aria-hidden="true" />
            )}
            {request.isPending ? dict.reports.requesting : dict.reports.requestAction}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/* ---- one row ---------------------------------------------------------- */

const STATUS_TONE: Record<FinanceReportRun["status"], string> = {
  QUEUED: "bg-blue-50 text-primary-strong",
  RUNNING: "bg-blue-50 text-primary-strong",
  DONE: "bg-emerald-50 text-emerald-700",
  FAILED: "bg-rose-50 text-rose-700"
};

function ReportRow({ run, locale, dict }: { run: FinanceReportRun; locale: Locale; dict: Dictionary }) {
  const watching = run.status === "QUEUED" || run.status === "RUNNING";
  const poll = useReportPoller(watching ? run.id : undefined, run.status, locale);
  /* While the poller has a newer copy of the same run, the list row is the stale
     one — showing it would tell the operator a finished report is still building,
     or the reverse. `createdAt` is the identity check: a re-run is a new id, so
     the two can never be confused. */
  const fresh = poll.data;
  const current: FinanceReportRun = fresh !== undefined && fresh.createdAt === run.createdAt ? { ...run, ...fresh } : run;

  const [downloading, setDownloading] = useState(false);

  const grab = async () => {
    setDownloading(true);
    const result = await downloadFile(
      reportDownloadPath(current.id),
      locale,
      `${current.type.toLowerCase()}-${current.periodStart}.${current.format.toLowerCase()}`
    );
    setDownloading(false);
    if (result.ok) toast.success(dict.reports.downloaded.replace("{file}", result.filename));
    else toast.error(result.error);
  };

  const total = reportTotal(current);
  const ready = current.status === "DONE" && current.downloadUrl !== null;
  const inFlight = current.status === "QUEUED" || current.status === "RUNNING";

  return (
    <tr className="hover:bg-slate-50">
      <td className="p-4">
        <p className="text-sm font-semibold text-navy">{dict.reports.types[current.type]}</p>
        <p className="mt-0.5 font-mono text-[11px] text-muted">{current.id}</p>
      </td>
      <td className="p-4 text-sm text-secondary tabular-nums">
        {formatPeriodDay(current.periodStart, locale)} → {formatPeriodDay(current.periodEnd, locale)}
      </td>
      <td className="p-4 text-sm text-secondary">
        <span className="font-medium">{dict.reports.formats[current.format]}</span>
        {current.rowCount !== null ? (
          <span className="mt-0.5 block text-xs text-muted">
            {dict.reports.rowCount.replace("{count}", formatNumber(current.rowCount, locale))}
          </span>
        ) : null}
      </td>
      <td className="p-4 text-sm">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${STATUS_TONE[current.status]}`}>
          {inFlight ? <Loader2 className="size-3 animate-spin" aria-hidden="true" /> : null}
          {dict.reports.statuses[current.status]}
        </span>
        {current.status === "FAILED" && current.failureReason !== null ? (
          <p className="mt-1 max-w-xs text-xs leading-5 text-rose-700">{current.failureReason}</p>
        ) : null}
      </td>
      <td className="p-4 text-end text-sm font-semibold text-navy tabular-nums">
        {total === null ? <span className="text-muted">{dict.reports.noTotalYet}</span> : formatMoney(total, locale)}
      </td>
      <td className="p-4 text-end">
        {ready ? (
          <Button type="button" variant="secondary" size="sm" disabled={downloading} onClick={() => void grab()}>
            {downloading ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Download className="size-3.5" aria-hidden="true" />
            )}
            {dict.reports.download}
          </Button>
        ) : (
          <span className="text-xs text-muted">{current.status === "FAILED" ? "—" : dict.reports.notReady}</span>
        )}
      </td>
    </tr>
  );
}

/* ---- the screen ------------------------------------------------------- */

/**
 * The reports screen.
 *
 * Exported as `AdminReports` because that is the name
 * `app/[locale]/(portal)/admin/reports/page.tsx` imports — the route has always
 * lived under `/admin`, and `ReportsController` allows ADMIN as well as FINANCE,
 * so the path is still correct.
 */
export function AdminReports({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const runs = useReportRuns(locale);
  const [downloadBlocked, setDownloadBlocked] = useState(false);

  /* Checked once, not per render: this screen must never offer a button that
     cannot work, and it must find out on the client where `URL` exists. */
  useEffect(() => {
    setDownloadBlocked(typeof URL === "undefined" || typeof URL.createObjectURL !== "function");
  }, []);

  const items = runs.data?.items ?? [];
  const building = items.filter((run) => run.status === "QUEUED" || run.status === "RUNNING");
  const ready = items.filter((run) => run.status === "DONE" && run.downloadUrl !== null);
  const failed = items.filter((run) => run.status === "FAILED");

  /* Counts of what the server said, not of what this screen can see: the list is
     capped at 50 runs server-side, so these are the last 50, not all time. */
  const readyTotal = ready.reduce((sum, run) => sum + (reportTotal(run) ?? 0), 0);

  return (
    <div>
      <PageHeader
        eyebrow={dict.portal.admin}
        title={dict.admin.reports}
        description={dict.reports.headerText}
        action={
          runs.isFetching ? (
            <RefreshCcw className="size-4 animate-spin text-muted" aria-hidden="true" />
          ) : (
            <Button type="button" variant="secondary" size="sm" onClick={() => void runs.refetch()}>
              <RefreshCcw className="size-3.5" aria-hidden="true" />
              {dict.reports.refresh}
            </Button>
          )
        }
      />

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={BarChart3} label={dict.reports.reportedRuns} value={formatNumber(items.length, locale)} />
        <StatCard icon={Loader2} label={dict.reports.building} value={formatNumber(building.length, locale)} />
        <StatCard icon={CheckCircle2} label={dict.reports.readyToDownload} value={formatNumber(ready.length, locale)} />
        <StatCard icon={XCircle} label={dict.reports.failed} value={formatNumber(failed.length, locale)} />
      </div>

      {failed.length > 0 ? (
        <div role="alert" className="mt-5 rounded-[14px] border border-rose-200 bg-rose-50 p-5">
          <p className="text-sm font-semibold text-rose-900">{dict.reports.someFailed}</p>
          <p className="mt-1 text-xs leading-5 text-rose-700">{dict.reports.someFailedText}</p>
        </div>
      ) : null}

      {downloadBlocked ? (
        <p role="alert" className="mt-5 rounded-[14px] border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
          {dict.reports.downloadsUnavailable}
        </p>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="order-2 lg:order-1">
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-line p-5">
              <h2 className="font-semibold text-navy">{dict.reports.yourRuns}</h2>
              <p className="text-xs text-muted">{dict.reports.listCapped}</p>
            </div>

            {runs.isLoading ? (
              <p className="p-8 text-center text-sm text-muted" aria-busy="true">
                {dict.portal.financeLoading}
              </p>
            ) : runs.isError ? (
              /* A failure is never an empty list — that would say "you have never
                 asked for a report", which is a different and wrong statement. */
              <div role="alert" className="m-5 rounded-[14px] border border-rose-200 bg-rose-50 p-5">
                <p className="text-sm font-medium leading-6 text-rose-800">
                  {runs.error instanceof Error ? runs.error.message : dict.finance.loadError}
                </p>
                <Button type="button" variant="secondary" size="sm" className="mt-4" onClick={() => void runs.refetch()}>
                  {dict.catalogue.retry}
                </Button>
              </div>
            ) : items.length === 0 ? (
              <div className="p-5">
                <EmptyState title={dict.reports.noneYet} description={dict.reports.noneYetText} />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] text-sm">
                  <thead className="bg-slate-50 text-xs text-muted">
                    <tr>
                      <th className="p-4 text-start">{dict.reports.report}</th>
                      <th className="p-4 text-start">{dict.reports.period}</th>
                      <th className="p-4 text-start">{dict.reports.formats.PDF}</th>
                      <th className="p-4 text-start">{dict.common.status}</th>
                      <th className="p-4 text-end">{dict.reports.total}</th>
                      <th className="p-4 text-end">{dict.common.actions}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {items.map((run) => (
                      <ReportRow key={run.id} run={run} locale={locale} dict={dict} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <div className="order-1 lg:order-2">
          <ReportRequestForm locale={locale} dict={dict} />

          <Card className="mt-5 p-5">
            <h2 className="font-semibold text-navy">{dict.reports.ledgerNoteTitle}</h2>
            <p className="mt-2 text-sm leading-6 text-secondary">{dict.reports.ledgerNote}</p>
            <p className="mt-3 text-sm font-semibold text-navy tabular-nums">
              {formatMoney(readyTotal, locale)}
            </p>
            <p className="mt-1 text-xs leading-5 text-muted">{dict.reports.ledgerNoteTotal}</p>
          </Card>
        </div>
      </div>
    </div>
  );
}