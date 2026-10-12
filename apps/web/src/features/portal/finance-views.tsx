"use client";

import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  BadgeCheck,
  Banknote,
  Check,
  CircleDollarSign,
  ClipboardCheck,
  CreditCard,
  FileSpreadsheet,
  Landmark,
  ReceiptText,
  RefreshCcw,
  Scale,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import toast from "react-hot-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Dictionary } from "@/lib/dictionaries";
import { formatDate, formatMoney, type Locale } from "@/lib/utils";
import { Card, PageHeader, StatCard, StatusBadge } from "@/components/ui";
import {
  financeApi,
  type FinanceLedgerEntry,
  type LedgerQueryParams,
} from "./finance-api";

/* ------------------------------------------------------------------ *
 * Query Hooks for Live Finance APIs
 * ------------------------------------------------------------------ */

/**
 * What every finance screen shows when its read fails.
 *
 * These screens used to answer a failed or empty read with invented rows —
 * see the note on `FinanceRefunds`. The rule these two components exist to
 * enforce: a money figure the server did not send is never displayed, and a
 * failure is never dressed up as an empty result.
 */
function FinanceLoadError({ dict }: { dict: Dictionary }) {
  return (
    <div role="alert" className="rounded-[14px] border border-rose-200 bg-rose-50 p-5">
      <p className="flex items-start gap-2 text-sm font-medium leading-6 text-rose-800">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        {dict.finance.loadError}
      </p>
    </div>
  );
}

function FinanceLoading({ dict }: { dict: Dictionary }) {
  return (
    <Card className="p-8 text-center text-sm text-muted" aria-busy="true">
      {dict.portal.financeLoading}
    </Card>
  );
}

export function useFinanceRefunds(status?: string, locale?: Locale) {
  return useQuery({
    queryKey: ["finance", "refunds", status],
    queryFn: () => financeApi.refunds(status, { locale }),
  });
}

export function useFinancePayouts(status?: string, locale?: Locale) {
  return useQuery({
    queryKey: ["finance", "payouts", status],
    queryFn: () => financeApi.payouts(status, { locale }),
  });
}

export function useFinanceCashReconciliation(locale?: Locale) {
  return useQuery({
    queryKey: ["finance", "cash-reconciliation"],
    queryFn: () => financeApi.cashReconciliation({ locale }),
  });
}

export function useFinanceLedger(params?: LedgerQueryParams, locale?: Locale) {
  return useQuery({
    queryKey: ["finance", "ledger", params],
    queryFn: () => financeApi.ledger(params, { locale }),
  });
}

export function useFinanceEscrow(locale?: Locale) {
  return useQuery({
    queryKey: ["finance", "escrow"],
    queryFn: () => financeApi.escrow({ locale }),
  });
}

export function useFinanceDebts(locale?: Locale) {
  return useQuery({
    queryKey: ["finance", "debts"],
    queryFn: () => financeApi.debts({ locale }),
  });
}

/* ------------------------------------------------------------------ *
 * Chart of accounts — TRD 6.2. Every transaction below is balanced:
 * sum of debits equals sum of credits (TRD 6.1 / NFR-IN-01).
 * ------------------------------------------------------------------ */

type Account =
  | "GATEWAY_CLEARING"
  | "ESCROW"
  | "PROVIDER_WALLET"
  | "PLATFORM_COMMISSION"
  | "PENALTY_INCOME"
  | "CUSTOMER_COMPENSATION"
  | "PROMO_EXPENSE"
  | "CUSTOMER_RECEIVABLE"
  | "PLAN_DEFERRED"
  | "PAYOUT_CLEARING";

type Line = { account: Account; debit: number; credit: number; party?: string };

type Entry = {
  id: string;
  date: string;
  type: keyof Dictionary["finance"]["types"];
  booking?: string;
  reference: string;
  lines: Line[];
};

const accountMeta: Record<Account, { normal: "debit" | "credit"; group: keyof Dictionary["finance"]["groups"] }> = {
  GATEWAY_CLEARING: { normal: "debit", group: "asset" },
  ESCROW: { normal: "credit", group: "liability" },
  PROVIDER_WALLET: { normal: "credit", group: "liability" },
  PLATFORM_COMMISSION: { normal: "credit", group: "revenue" },
  PENALTY_INCOME: { normal: "credit", group: "revenue" },
  CUSTOMER_COMPENSATION: { normal: "debit", group: "expense" },
  PROMO_EXPENSE: { normal: "debit", group: "expense" },
  CUSTOMER_RECEIVABLE: { normal: "debit", group: "asset" },
  PLAN_DEFERRED: { normal: "credit", group: "liability" },
  PAYOUT_CLEARING: { normal: "credit", group: "liability" },
};

/** Ten invented ledger entries used to live here.
 *
 *  They were balanced by construction, which is what made them dangerous: the
 *  screen rendered a "Balanced 10 / 10" badge computed over them, so a finance
 *  user was shown a proof that the books tie when in fact nothing had been read
 *  from the API at all. `GET /finance/ledger` is the only source of these rows
 *  now. The `Entry` type stays — it is the shape the API sends. */

/**
 * Balances per account, from the flat ledger entries the API sent.
 *
 * Each row carries one account and one direction, so an account's balance is
 * the signed sum of its own rows — `amountPaisa` is integer paisa and is only
 * summed here, never divided or recomputed. Accounts the server has not posted
 * anything to come back as zero, which is a real balance and not an absence.
 */
function computeBalances(rows: FinanceLedgerEntry[]): { account: Account; balance: number }[] {
  return (Object.keys(accountMeta) as Account[]).map((account) => {
    const signed = rows.reduce(
      (total, row) => (row.account === account ? total + (row.direction === "DEBIT" ? row.amountPaisa : -row.amountPaisa) : total),
      0,
    );
    return { account, balance: accountMeta[account].normal === "debit" ? signed : -signed };
  });
}

/* ------------------------------------------------------------------ *
 * Releases — TRD 6.3 release recipe
 * ------------------------------------------------------------------ */

export function FinanceReleases({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const { data: escrowData, isLoading } = useFinanceEscrow(locale);
  const { data: ledgerData } = useFinanceLedger(undefined, locale);

  const releasable = escrowData?.items ?? [];
  const released = (ledgerData?.items ?? []).filter((e) => e.type === "RELEASE");
  const totalHeld = escrowData?.totalHeldPaisa ?? releasable.reduce((s, b) => s + b.heldPaisa, 0);

  return (
    <div>
      <PageHeader eyebrow={dict.portal.finance} title={dict.finance.releases} description={dict.finance.releasesText} />

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Scale} label={dict.portal.held} value={isLoading ? "..." : formatMoney(totalHeld, locale)} />
        <StatCard icon={BadgeCheck} label={dict.portal.released} value={formatMoney(released.reduce((s, l) => s + l.amountPaisa, 0), locale)} />
        <StatCard icon={ReceiptText} label={dict.finance.commissionEarned} value={formatMoney(released.reduce((s, l) => s + (l.account === "PLATFORM_COMMISSION" ? l.amountPaisa : 0), 0), locale)} />
        <StatCard icon={TriangleAlert} label={dict.finance.pendingRelease} value={String(releasable.length)} />
      </div>

      <Card className="mt-6 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-5">
          <h2 className="font-semibold text-navy">{dict.finance.awaitingRelease}</h2>
          <p className="text-xs text-muted">{dict.finance.freezeNote}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-slate-50 text-xs text-muted">
              <tr>
                <th className="p-4 text-start">{dict.common.service}</th>
                <th className="p-4 text-start">{dict.common.professional}</th>
                <th className="p-4 text-start">{dict.common.status}</th>
                <th className="p-4 text-end">{dict.common.amount}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {releasable.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-secondary">
                    No bookings currently held awaiting escrow release.
                  </td>
                </tr>
              ) : (
                releasable.map((item) => {
                  return (
                    <tr key={item.bookingId} className="hover:bg-slate-50">
                      <td className="p-4">
                        <p className="font-medium text-navy">{item.serviceName ?? "Service"}</p>
                        <p className="mt-1 font-mono text-xs text-muted">{item.bookingCode ?? item.bookingId}</p>
                      </td>
                      <td className="p-4 text-secondary">{item.providerName ?? "—"}</td>
                      <td className="p-4"><StatusBadge status={item.status as never} label={item.status} /></td>
                      <td className="p-4 text-end">
                        <p className="font-semibold text-navy tabular-nums">{formatMoney(item.heldPaisa, locale)}</p>
                        {/* The provider's share used to be computed here as
                            `heldPaisa - round(heldPaisa * 0.12)` — a hardcoded 12%
                            commission the browser invented, printed under a
                            "Provider share" label as though the server had said
                            it. The real split is decided by `PricingService` and
                            posted to the ledger, so it is not restated here. */}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="mt-6 p-5">
        <h2 className="font-semibold text-navy">{dict.finance.releaseRecipe}</h2>
        <p className="mt-2 text-sm leading-6 text-secondary">{dict.finance.releaseRecipeText}</p>
        <ul className="mt-4 grid gap-2 font-mono text-xs text-secondary">
          <li className="rounded-[6px] bg-slate-50 px-3 py-2">D ESCROW[b] (f - d) &nbsp;·&nbsp; D PROMO_EXPENSE d &nbsp;·&nbsp; C PROVIDER_WALLET[p] (f - k) &nbsp;·&nbsp; C PLATFORM_COMMISSION (k - d)</li>
        </ul>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Refunds — FR-PY-07, idempotent, to the original method
 * ------------------------------------------------------------------ */

/** No fallback rows. This screen used to hold three invented refunds and render
 *  them whenever the API returned nothing *or* failed — so a `GET /finance/refunds`
 *  outage produced a full table of fabricated money, including booking codes that
 *  match no real booking. An empty answer is now shown as an empty answer. */
export function FinanceRefunds({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const { data, isLoading, isError, refetch } = useFinanceRefunds(undefined, locale);

  if (isError) return <FinanceLoadError dict={dict} />;
  if (isLoading) return <FinanceLoading dict={dict} />;

  const items = data?.items ?? [];
  const completed = items.filter((r) => r.status === "SUCCEEDED");
  const pending = items.filter((r) => r.status === "PENDING");
  const totalRefunded = completed.reduce((s, r) => s + r.amountPaisa, 0);

  return (
    <div>
      <PageHeader eyebrow={dict.portal.finance} title={dict.finance.refunds} description={dict.finance.refundsText} />

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={RefreshCcw} label={dict.finance.refundedTotal} value={isLoading ? "..." : formatMoney(totalRefunded, locale)} />
        <StatCard icon={TriangleAlert} label={dict.finance.pendingRefunds} value={isLoading ? "..." : String(pending.length)} />
        <StatCard icon={Landmark} label={dict.finance.toOriginalMethod} value={isLoading ? "..." : String(completed.length)} />
        <StatCard icon={FileSpreadsheet} label={dict.finance.ledgerRows} value={isLoading ? "..." : String(items.length)} />
      </div>

      <Card className="mt-6 overflow-hidden">
        <div className="flex items-center justify-between border-b border-line p-5">
          <h2 className="font-semibold text-navy">{dict.finance.refundQueue}</h2>
          <button
            type="button"
            onClick={() => refetch()}
            className="text-xs font-semibold text-primary-strong hover:underline"
          >
            Refresh
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-slate-50 text-xs text-muted">
              <tr>
                <th className="p-4 text-start">{dict.finance.booking}</th>
                <th className="p-4 text-start">{dict.finance.reason}</th>
                <th className="p-4 text-start">{dict.finance.method}</th>
                <th className="p-4 text-start">{dict.common.date}</th>
                <th className="p-4 text-start">{dict.common.status}</th>
                <th className="p-4 text-end">{dict.common.amount}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {items.map((row) => {
                const reasonDisplay =
                  (dict.finance.reasons as Record<string, string>)[row.reasonCode] ??
                  row.reasonText ??
                  row.reasonCode;
                const isDone = row.status === "SUCCEEDED";

                return (
                  <tr key={row.id} className="hover:bg-slate-50">
                    <td className="p-4 font-mono text-xs font-semibold text-navy">{row.bookingCode}</td>
                    <td className="p-4 text-secondary">{reasonDisplay}</td>
                    <td className="p-4 text-secondary">{row.gateway === "CASH" ? dict.booking.cash : dict.booking.online}</td>
                    <td className="p-4 text-secondary">{formatDate(row.createdAt, locale)}</td>
                    <td className="p-4">
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${isDone ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>
                        {isDone ? dict.finance.completed : dict.finance.pending}
                      </span>
                    </td>
                    <td className="p-4 text-end font-semibold text-navy tabular-nums">{formatMoney(row.amountPaisa, locale)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="mt-6 p-5">
        <h2 className="font-semibold text-navy">{dict.finance.idempotency}</h2>
        <p className="mt-2 text-sm leading-6 text-secondary">{dict.finance.idempotencyText}</p>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Payouts — FR-PY-08, batch file and per-provider statements
 * ------------------------------------------------------------------ */

/** No fallback rows, and this one mattered most: the payout table renders a real
 *  "Approve" button against each row, so the five invented payouts that used to
 *  stand in for a failed read offered an operator a live ledger write keyed on
 *  ids like `po-2042` that exist nowhere. */
export function FinancePayouts({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useFinancePayouts(undefined, locale);

  const approveMutation = useMutation({
    mutationFn: (id: string) => financeApi.approvePayout(id, { locale }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["finance", "payouts"] });
      toast.success("Payout request approved into clearing");
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to approve payout");
    },
  });

  if (isError) return <FinanceLoadError dict={dict} />;
  if (isLoading) return <FinanceLoading dict={dict} />;

  const items = data?.items ?? [];
  const approved = items.filter((r) => r.status === "APPROVED");
  const paid = items.filter((r) => r.status === "PAID");
  const requested = items.filter((r) => r.status === "REQUESTED");

  return (
    <div>
      <PageHeader
        eyebrow={dict.portal.finance}
        title={dict.portal.payouts}
        description={dict.finance.payoutsText}
        action={
          <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-[9px] bg-primary px-5 text-sm font-semibold text-white transition hover:bg-primary-strong">
            <FileSpreadsheet className="size-4" aria-hidden="true" />
            {dict.finance.buildBatch}
          </button>
        }
      />

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Banknote} label={dict.finance.approvedThisRun} value={isLoading ? "..." : formatMoney(approved.reduce((s, r) => s + r.amountPaisa, 0), locale)} />
        <StatCard icon={ReceiptText} label={dict.finance.awaitingApproval} value={isLoading ? "..." : String(requested.length)} />
        <StatCard icon={BadgeCheck} label={dict.finance.paidToDate} value={isLoading ? "..." : formatMoney(paid.reduce((s, r) => s + r.amountPaisa, 0), locale)} />
        <StatCard icon={FileSpreadsheet} label={dict.finance.batchFile} value={dict.finance.nothingToShow} />
      </div>

      <Card className="mt-6 overflow-hidden">
        <div className="flex items-center justify-between border-b border-line p-5">
          <h2 className="font-semibold text-navy">{dict.finance.payoutRun}</h2>
          <button
            type="button"
            onClick={() => refetch()}
            className="text-xs font-semibold text-primary-strong hover:underline"
          >
            Refresh
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-slate-50 text-xs text-muted">
              <tr>
                <th className="p-4 text-start">{dict.finance.reference}</th>
                <th className="p-4 text-start">{dict.common.professional}</th>
                <th className="p-4 text-start">{dict.common.date}</th>
                <th className="p-4 text-start">{dict.common.status}</th>
                <th className="p-4 text-end">{dict.common.amount}</th>
                <th className="p-4 text-end">{dict.common.actions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {items.map((row) => {
                const tone =
                  row.status === "PAID"
                    ? "bg-emerald-50 text-emerald-700"
                    : row.status === "APPROVED"
                    ? "bg-blue-50 text-primary-strong"
                    : "bg-amber-50 text-amber-800";

                const stateLabel = (dict.finance.states as Record<string, string>)[row.status] ?? row.status;

                return (
                  <tr key={row.id} className="hover:bg-slate-50">
                    <td className="p-4 font-mono text-xs font-semibold text-navy">{row.id}</td>
                    <td className="p-4 text-secondary">{row.providerName ?? row.providerId}</td>
                    <td className="p-4 text-secondary">{formatDate(row.createdAt, locale)}</td>
                    <td className="p-4">
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${tone}`}>
                        {stateLabel}
                      </span>
                    </td>
                    <td className="p-4 text-end font-semibold text-navy tabular-nums">{formatMoney(row.amountPaisa, locale)}</td>
                    <td className="p-4 text-end">
                      {row.status === "REQUESTED" ? (
                        <button
                          type="button"
                          disabled={approveMutation.isPending}
                          onClick={() => approveMutation.mutate(row.id)}
                          className="inline-flex items-center gap-1 rounded-[6px] bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white shadow-xs hover:bg-emerald-700 disabled:opacity-50"
                        >
                          <Check className="size-3" />
                          Approve
                        </button>
                      ) : (
                        <span className="text-xs text-muted">-</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Cash reconciliation — UC-18
 * ------------------------------------------------------------------ */

/** No fallback rows — three invented cash settlements with invented commission
 *  figures, shown whenever the reconciliation read came back empty or failed. */
export function FinanceCash({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const { data, isLoading, isError } = useFinanceCashReconciliation(locale);

  if (isError) return <FinanceLoadError dict={dict} />;
  if (isLoading) return <FinanceLoading dict={dict} />;

  const items = data?.items ?? [];
  const totalJobs = items.reduce((s, j) => s + (j.awaitingConfirmationJobs + j.settledJobs), 0);
  const outstandingPaisa = items.reduce((s, j) => s + j.awaitingConfirmationPaisa, 0);
  const totalCommission = items.reduce((s, j) => s + j.commissionPaisa, 0);

  return (
    <div>
      <PageHeader eyebrow={dict.portal.finance} title={dict.finance.cash} description={dict.finance.cashText} />

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Banknote} label={dict.finance.cashJobs} value={isLoading ? "..." : String(totalJobs)} />
        <StatCard icon={Wallet} label={dict.finance.outstandingCash} value={isLoading ? "..." : formatMoney(outstandingPaisa, locale)} />
        <StatCard icon={BadgeCheck} label={dict.finance.cashCommission} value={isLoading ? "..." : formatMoney(totalCommission, locale)} />
        <StatCard icon={CircleDollarSign} label={dict.finance.receivables} value={dict.finance.nothingToShow} />
      </div>

      <Card className="mt-6 overflow-hidden">
        <div className="border-b border-line p-5"><h2 className="font-semibold text-navy">{dict.finance.cashReconciliation}</h2></div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-slate-50 text-xs text-muted">
              <tr>
                <th className="p-4 text-start">{dict.common.professional}</th>
                <th className="p-4 text-start">Awaiting Cash Collection</th>
                <th className="p-4 text-start">Settled Cash Jobs</th>
                <th className="p-4 text-end">Platform Commission</th>
                <th className="p-4 text-end">{dict.common.amount}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {items.map((job) => {
                const total = job.awaitingConfirmationPaisa + job.collectedPaisa;
                return (
                  <tr key={job.providerId} className="hover:bg-slate-50">
                    <td className="p-4 font-medium text-navy">{job.providerName ?? job.providerId}</td>
                    <td className="p-4">
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${job.awaitingConfirmationJobs > 0 ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-muted"}`}>
                        {job.awaitingConfirmationJobs} jobs ({formatMoney(job.awaitingConfirmationPaisa, locale)})
                      </span>
                    </td>
                    <td className="p-4">
                      <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                        {job.settledJobs} settled
                      </span>
                    </td>
                    <td className="p-4 text-end font-semibold text-navy tabular-nums">{formatMoney(job.commissionPaisa, locale)}</td>
                    <td className="p-4 text-end font-semibold text-navy tabular-nums">{formatMoney(total, locale)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="mt-6 p-5">
        <h2 className="font-semibold text-navy">{dict.finance.cashSequence}</h2>
        <p className="mt-2 text-sm leading-6 text-secondary">{dict.finance.cashSequenceText}</p>
        <ul className="mt-4 grid gap-2 font-mono text-xs text-secondary">
          <li className="rounded-[6px] bg-slate-50 px-3 py-2">PROVIDER_WALLET[p] {String.fromCharCode(0x2022)} PLATFORM_COMMISSION</li>
        </ul>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Commission debts — FR-PY-05, FR-PY-13
 * ------------------------------------------------------------------ */

export function FinanceDebts({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const { data: debtsData, isLoading, isError } = useFinanceDebts(locale);

  if (isError) return <FinanceLoadError dict={dict} />;

  /* The ceiling is the server's. It used to fall back to a hardcoded 500000,
     which then decided, in the very next line, whether a professional's offers
     were shown "Blocked" — an invented number was making a live decision about
     whether someone can sell their work. Now a missing ceiling blocks nothing,
     because only the server knows the rule; a row with no ceiling and no
     explicit flag is reported as unknown rather than as cleared. */
  const items = (debtsData?.items ?? []).map((d) => ({
    id: d.providerId,
    name: d.providerName ?? d.providerId,
    amount: d.debtPaisa,
    ceiling: d.ceilingPaisa ?? null,
    since: d.createdAt ?? d.since,
    isBlocked: d.offersBlocked ?? d.isBlocked ?? null,
  }));

  const blocked = items.filter((d) => d.isBlocked === true);
  /* A ceiling is only a single figure if the server gave one figure; showing
     Rs 5,000 while every row carries a different ceiling was a second invention. */
  const sharedCeiling = items.every((d) => d.ceiling === items[0]?.ceiling) ? items[0]?.ceiling ?? null : null;
  const total = items.reduce((s, d) => s + d.amount, 0);

  return (
    <div>
      <PageHeader eyebrow={dict.portal.finance} title={dict.finance.debts} description={dict.finance.debtsText} />

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={CircleDollarSign} label={dict.finance.totalDebt} value={isLoading ? "..." : formatMoney(total, locale)} />
        <StatCard icon={TriangleAlert} label={dict.finance.blockedProviders} value={isLoading ? "..." : String(blocked.length)} />
        <StatCard icon={Wallet} label={dict.finance.debtCeiling} value={isLoading ? "..." : sharedCeiling === null ? dict.finance.nothingToShow : formatMoney(sharedCeiling, locale)} />
        <StatCard icon={BadgeCheck} label={dict.finance.clearedOnline} value={isLoading ? "..." : String(items.length - blocked.length)} />
      </div>

      <Card className="mt-6 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-5">
          <h2 className="font-semibold text-navy">{dict.finance.debtLedger}</h2>
          <p className="text-xs text-muted">{dict.finance.debtRule}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-slate-50 text-xs text-muted">
              <tr>
                <th className="p-4 text-start">{dict.common.professional}</th>
                <th className="p-4 text-start">{dict.common.date}</th>
                <th className="p-4 text-end">{dict.finance.debt}</th>
                <th className="p-4 text-end">{dict.finance.ceiling}</th>
                <th className="p-4 text-start">{dict.finance.offerStatus}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {items.map((row) => {
                const isBlocked = row.isBlocked;
                /* With no ceiling from the server there is no denominator, so
                   no bar is drawn. A bar at 100% would be a claim about a
                   threshold nobody published. */
                const pct = row.ceiling !== null && row.ceiling > 0 ? Math.min(100, (row.amount / row.ceiling) * 100) : null;
                return (
                  <tr key={row.id} className="hover:bg-slate-50">
                    <td className="p-4 font-medium text-navy">{row.name}</td>
                    <td className="p-4 text-secondary">{row.since ? formatDate(row.since, locale) : "—"}</td>
                    <td className="p-4 text-end">
                      <p className="font-semibold text-navy tabular-nums">{formatMoney(row.amount, locale)}</p>
                      {pct !== null ? (
                        <div className="mt-1.5 h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
                          <div className={`h-full rounded-full ${isBlocked === true ? "bg-rose-500" : "bg-amber-500"}`} style={{ width: `${pct}%` }} />
                        </div>
                      ) : null}
                    </td>
                    <td className="p-4 text-end text-secondary tabular-nums">{row.ceiling === null ? "—" : formatMoney(row.ceiling, locale)}</td>
                    <td className="p-4">
                      {/* "Blocked" and "Active" are both claims about whether
                          this professional may sell. Only the server may make
                          that one, so an absent flag renders as unknown. */}
                      {isBlocked === null ? (
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-muted">{dict.finance.nothingToShow}</span>
                      ) : (
                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${isBlocked ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>
                          {isBlocked ? dict.finance.blocked : dict.finance.active}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Ledger — drill-down from /finance/ledger
 * ------------------------------------------------------------------ */

export function FinanceLedger({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const { data: ledgerData, isLoading, isError } = useFinanceLedger(undefined, locale);

  /* Every number below is computed from the rows the server sent.
   *
   * This screen used to compute `computeBalances(defaultEntries)` on ten
   * invented transactions and render that chart of accounts, its "Lines" count
   * and its "Balanced 10 / 10" badge **unconditionally** — even when the ledger
   * query succeeded and returned nothing, and it had no error branch at all.
   *
   * The badge is gone rather than recomputed. `GET /finance/ledger` returns one
   * flat row per ledger *entry*, each with a single account and direction
   * (`finance.service.ts:105-117`); it does not return the line pairs of the
   * parent transaction. So whether debits equal credits cannot be checked from
   * this response at all — and a screen that printed "Balanced" over a page of
   * entries was asserting something it had no data for. The constraint is the
   * database's to hold, and it should be verified there. */
  const entries = ledgerData?.items ?? [];
  const accounts = computeBalances(entries);
  /* Distinct transactions, counted from the entries actually returned rather
     than from a fabricated set. */
  const transactionCount = new Set(entries.map((entry) => entry.transactionId)).size;

  if (isError) return <FinanceLoadError dict={dict} />;

  return (
    <div>
      <PageHeader eyebrow={dict.portal.finance} title={dict.finance.ledger} description={dict.finance.ledgerText} />

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Scale} label={dict.finance.accounts} value={isLoading ? "..." : String(accounts.length)} />
        <StatCard icon={ReceiptText} label={dict.finance.transactions} value={isLoading ? "..." : String(transactionCount)} />
        <StatCard icon={FileSpreadsheet} label={dict.finance.lines} value={isLoading ? "..." : String(entries.length)} />
        <StatCard icon={BadgeCheck} label={dict.finance.balanced} value={isLoading ? "..." : dict.finance.notVerifiableHere} />
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-[320px_1fr]">
        <Card className="overflow-hidden">
          <div className="border-b border-line p-5"><h2 className="font-semibold text-navy">{dict.finance.chartOfAccounts}</h2></div>
          <ul className="divide-y divide-line">
            {accounts.map(({ account, balance }) => {
              const meta = accountMeta[account];
              return (
                <li key={account} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-xs font-semibold text-navy">{account}</p>
                    <p className="mt-0.5 text-[11px] text-muted">{(dict.finance.groups as Record<string, string>)[meta.group]}</p>
                  </div>
                  <p className="shrink-0 text-sm font-semibold text-navy tabular-nums">{formatMoney(balance, locale)}</p>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-5">
            <h2 className="font-semibold text-navy">{dict.finance.transactions}</h2>
            <p className="text-xs text-muted">{dict.finance.insertOnly}</p>
          </div>
          {entries.length > 0 ? (
            <ul className="divide-y divide-line">
              {entries.map((entry) => (
                <li key={entry.entryId} className="p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-mono text-xs font-semibold text-navy">
                        #{entry.entryId}
                        {/* `transactionId` had no null guard; one row without it
                            took the whole ledger screen down. */}
                        {typeof entry.transactionId === "string" && entry.transactionId !== "" ? ` · ${entry.transactionId.slice(0, 8)}` : ""}
                      </p>
                      <p className="mt-0.5 text-sm text-secondary">{entry.type} · {entry.account}</p>
                    </div>
                    <div className="text-end">
                      <p className={`text-sm font-semibold tabular-nums ${entry.direction === "DEBIT" ? "text-navy" : "text-emerald-700"}`}>
                        {entry.direction} {formatMoney(entry.amountPaisa, locale)}
                      </p>
                      <p className="mt-0.5 text-xs text-muted">{formatDate(entry.createdAt, locale)}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : isLoading ? (
            <Card className="border-dashed p-10 text-center text-sm text-muted" aria-busy="true">
              {dict.portal.financeLoading}
            </Card>
          ) : (
            /* An empty ledger is stated as empty. The branch that used to sit
               here rendered ten invented transactions with their double-entry
               lines and a "Balances" tick. */
            <Card className="border-dashed p-10 text-center">
              <p className="text-sm font-medium text-navy">{dict.finance.nothingToShow}</p>
              <p className="mt-1.5 text-sm text-muted">{dict.finance.insertOnly}</p>
            </Card>
          )}
        </Card>
      </div>
    </div>
  );
}

export function FinanceOverviewView({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const { data: escrowData, isLoading } = useFinanceEscrow(locale);
  const { data: ledgerData } = useFinanceLedger(undefined, locale);
  const { data: debtsData } = useFinanceDebts(locale);

  const heldTotal = escrowData?.totalHeldPaisa ?? 0;
  const heldCount = escrowData?.items?.length ?? 0;
  const released = (ledgerData?.items ?? []).filter((e) => e.type === "RELEASE");
  const releasedTotal = released.reduce((sum, item) => sum + item.amountPaisa, 0);
  const debtsTotal = (debtsData?.items ?? []).reduce((sum, item) => sum + item.debtPaisa, 0);

  return (
    <div>
      <PageHeader eyebrow={dict.portal.finance} title={dict.portal.overview} description={dict.portal.escrowDescription} />
      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={CreditCard} label={dict.portal.held} value={isLoading ? "..." : formatMoney(heldTotal, locale)} />
        <StatCard icon={BadgeCheck} label={dict.portal.released} value={formatMoney(releasedTotal, locale)} />
        <StatCard icon={ClipboardCheck} label={dict.portal.heldCount} value={isLoading ? "..." : String(heldCount)} />
        <StatCard icon={AlertTriangle} label={dict.finance.debts} value={formatMoney(debtsTotal, locale)} />
      </div>
    </div>
  );
}

export function EscrowView({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const { data: escrowData, isLoading } = useFinanceEscrow(locale);
  const { data: ledgerData } = useFinanceLedger(undefined, locale);

  const items = escrowData?.items ?? [];
  const heldTotal = escrowData?.totalHeldPaisa ?? items.reduce((sum, item) => sum + item.heldPaisa, 0);
  const released = (ledgerData?.items ?? []).filter((e) => e.type === "RELEASE");
  const releasedTotal = released.reduce((sum, item) => sum + item.amountPaisa, 0);

  return (
    <div>
      <PageHeader eyebrow={dict.portal.finance} title={dict.portal.escrow} description={dict.portal.escrowDescription} />
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <StatCard icon={CreditCard} label={dict.portal.held} value={isLoading ? "..." : formatMoney(heldTotal, locale)} />
        <StatCard icon={BadgeCheck} label={dict.portal.released} value={formatMoney(releasedTotal, locale)} />
        <StatCard icon={AlertTriangle} label={dict.portal.heldCount} value={String(items.length)} />
      </div>
      <Card className="mt-6 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-sm">
            <thead className="bg-slate-50 text-xs text-muted">
              <tr>
                <th className="p-4 text-start">{dict.common.service}</th>
                <th className="p-4 text-start">{dict.common.status}</th>
                <th className="p-4 text-start">{dict.common.date}</th>
                <th className="p-4 text-end">{dict.common.amount}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {items.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-secondary">
                    No bookings currently held in escrow.
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.bookingId}>
                    <td className="p-4 font-medium text-navy">
                      <p>{item.serviceName ?? "Service"}</p>
                      <p className="mt-0.5 font-mono text-xs text-muted">{item.code ?? item.bookingCode ?? item.bookingId}</p>
                    </td>
                    <td className="p-4"><StatusBadge status={item.status as never} label={dict.portal.held} /></td>
                    <td className="p-4 text-secondary">{item.createdAt ? formatDate(item.createdAt, locale) : "—"}</td>
                    <td className="p-4 text-end font-semibold text-navy">{formatMoney(item.heldPaisa, locale)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
