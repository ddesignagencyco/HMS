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
  type LedgerQueryParams,
} from "./finance-api";

/* ------------------------------------------------------------------ *
 * Query Hooks for Live Finance APIs
 * ------------------------------------------------------------------ */

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

const defaultEntries: Entry[] = [
  { id: "txn-1001", date: "2026-09-02", type: "ONLINE_CAPTURE", booking: "bk-1030", reference: "SHM-0001030", lines: [{ account: "GATEWAY_CLEARING", debit: 850000, credit: 0 }, { account: "ESCROW", debit: 0, credit: 850000, party: "bk-1030" }] },
  { id: "txn-1002", date: "2026-09-03", type: "ONLINE_CAPTURE", booking: "bk-1031", reference: "SHM-0001031", lines: [{ account: "GATEWAY_CLEARING", debit: 420000, credit: 0 }, { account: "ESCROW", debit: 0, credit: 420000, party: "bk-1031" }] },
  { id: "txn-1003", date: "2026-09-04", type: "RELEASE", booking: "bk-1034", reference: "SHM-0001034", lines: [{ account: "ESCROW", debit: 400000, credit: 0, party: "bk-1034" }, { account: "PROVIDER_WALLET", debit: 0, credit: 352000, party: "prv-kashif-carpenter" }, { account: "PLATFORM_COMMISSION", debit: 0, credit: 48000 }] },
  { id: "txn-1004", date: "2026-09-05", type: "CASH_SETTLEMENT", booking: "bk-1036", reference: "SHM-0001036", lines: [{ account: "PROVIDER_WALLET", debit: 42000, credit: 0, party: "prv-bilal-plumbing" }, { account: "PLATFORM_COMMISSION", debit: 0, credit: 42000 }] },
  { id: "txn-1005", date: "2026-09-06", type: "REFUND", booking: "bk-1031", reference: "SHM-0001031", lines: [{ account: "ESCROW", debit: 120000, credit: 0, party: "bk-1031" }, { account: "GATEWAY_CLEARING", debit: 0, credit: 120000 }] },
  { id: "txn-1006", date: "2026-09-08", type: "PAYOUT_APPROVED", reference: "po-2041", lines: [{ account: "PROVIDER_WALLET", debit: 610000, credit: 0, party: "prv-ahmad-plumber" }, { account: "PAYOUT_CLEARING", debit: 0, credit: 610000 }] },
  { id: "txn-1007", date: "2026-09-09", type: "PAYOUT_CONFIRMED", reference: "po-2041", lines: [{ account: "PAYOUT_CLEARING", debit: 610000, credit: 0 }, { account: "GATEWAY_CLEARING", debit: 0, credit: 610000 }] },
  { id: "txn-1008", date: "2026-09-11", type: "PENALTY_FINE", booking: "bk-1030", reference: "SHM-0001030", lines: [{ account: "PROVIDER_WALLET", debit: 150000, credit: 0, party: "prv-ahmad-plumber" }, { account: "PENALTY_INCOME", debit: 0, credit: 150000 }] },
  { id: "txn-1009", date: "2026-09-14", type: "LATE_CANCEL_CASH", booking: "bk-1036", reference: "SHM-0001036", lines: [{ account: "CUSTOMER_RECEIVABLE", debit: 90000, credit: 0, party: "bk-1036" }, { account: "PLATFORM_COMMISSION", debit: 0, credit: 90000 }] },
  { id: "txn-1010", date: "2026-09-18", type: "PLAN_PURCHASE", reference: "sub-77", lines: [{ account: "GATEWAY_CLEARING", debit: 890000, credit: 0 }, { account: "PLAN_DEFERRED", debit: 0, credit: 890000, party: "sub-77" }] },
];

const isBalanced = (e: Entry) => e.lines.reduce((s, l) => s + l.debit, 0) === e.lines.reduce((s, l) => s + l.credit, 0);

function computeBalances(rows: Entry[]): { account: Account; balance: number }[] {
  return (Object.keys(accountMeta) as Account[]).map((account) => {
    const debit = rows.reduce((t, e) => t + e.lines.filter((l) => l.account === account).reduce((s, l) => s + l.debit, 0), 0);
    const credit = rows.reduce((t, e) => t + e.lines.filter((l) => l.account === account).reduce((s, l) => s + l.credit, 0), 0);
    return { account, balance: accountMeta[account].normal === "debit" ? debit - credit : credit - debit };
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
                  const commission = Math.round(item.heldPaisa * 0.12);
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
                        <p className="mt-1 text-xs text-muted tabular-nums">{dict.finance.providerShare} {formatMoney(item.heldPaisa - commission, locale)}</p>
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

const fallbackRefunds = [
  { id: "rf-1", bookingCode: "SHM-0001031", amountPaisa: 120000, reasonCode: "disputedScope", reasonText: "Disputed Scope", createdAt: "2026-09-06", gateway: "ONLINE", status: "SUCCEEDED" as const },
  { id: "rf-2", bookingCode: "SHM-0001032", amountPaisa: 950000, reasonCode: "unfulfilled", reasonText: "Unfulfilled", createdAt: "2026-09-19", gateway: "ONLINE", status: "PENDING" as const },
  { id: "rf-3", bookingCode: "SHM-0001036", amountPaisa: 420000, reasonCode: "providerNoShow", reasonText: "Provider No Show", createdAt: "2026-09-20", gateway: "CASH", status: "SUCCEEDED" as const },
];

export function FinanceRefunds({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const { data, isLoading, refetch } = useFinanceRefunds(undefined, locale);

  const items = data?.items && data.items.length > 0 ? data.items : fallbackRefunds;
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
        <StatCard icon={FileSpreadsheet} label={dict.finance.ledgerRows} value={isLoading ? "..." : String(items.length * 2)} />
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

const fallbackPayouts = [
  { id: "po-2044", providerId: "prv-ahmad-plumber", providerName: "Ahmad Plumbing Works", amountPaisa: 842000, createdAt: "2026-09-26", status: "APPROVED" as const },
  { id: "po-2043", providerId: "prv-sana-sanitary", providerName: "Sana Sanitary & Electrical", amountPaisa: 1280000, createdAt: "2026-09-26", status: "APPROVED" as const },
  { id: "po-2042", providerId: "prv-kashif-carpenter", providerName: "Kashif Woodworking", amountPaisa: 352000, createdAt: "2026-09-26", status: "REQUESTED" as const },
  { id: "po-2041", providerId: "prv-ahmad-plumber", providerName: "Ahmad Plumbing Works", amountPaisa: 610000, createdAt: "2026-09-09", status: "PAID" as const },
  { id: "po-2040", providerId: "prv-bilal-plumbing", providerName: "Bilal QuickFix Services", amountPaisa: 385000, createdAt: "2026-09-02", status: "PAID" as const },
];

export function FinancePayouts({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const queryClient = useQueryClient();
  const { data, isLoading, refetch } = useFinancePayouts(undefined, locale);

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

  const items = data?.items && data.items.length > 0 ? data.items : fallbackPayouts;
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
        <StatCard icon={FileSpreadsheet} label={dict.finance.batchFile} value="pay_2026_09_26.csv" />
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

const fallbackCash = [
  { providerId: "prv-imran-appliance", providerName: "Imran Appliance Services", awaitingConfirmationJobs: 1, awaitingConfirmationPaisa: 520000, settledJobs: 0, collectedPaisa: 0, commissionPaisa: 62400 },
  { providerId: "prv-sana-sanitary", providerName: "Sana Sanitary & Electrical", awaitingConfirmationJobs: 0, awaitingConfirmationPaisa: 0, settledJobs: 1, collectedPaisa: 560000, commissionPaisa: 67200 },
  { providerId: "prv-bilal-plumbing", providerName: "Bilal QuickFix Services", awaitingConfirmationJobs: 1, awaitingConfirmationPaisa: 420000, settledJobs: 0, collectedPaisa: 0, commissionPaisa: 50400 },
];

export function FinanceCash({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const { data, isLoading } = useFinanceCashReconciliation(locale);

  const items = data?.items && data.items.length > 0 ? data.items : fallbackCash;
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
        <StatCard icon={CircleDollarSign} label={dict.finance.receivables} value={formatMoney(90000, locale)} />
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
  const { data: debtsData, isLoading } = useFinanceDebts(locale);

  const items = (debtsData?.items ?? []).map((d) => ({
    id: d.providerId,
    name: d.providerName ?? d.providerId,
    amount: d.debtPaisa,
    ceiling: d.ceilingPaisa ?? 500000,
    since: d.createdAt ?? d.since,
    isBlocked: d.offersBlocked ?? d.isBlocked ?? d.debtPaisa > (d.ceilingPaisa ?? 500000),
  }));

  const blocked = items.filter((d) => d.isBlocked);
  const total = items.reduce((s, d) => s + d.amount, 0);

  return (
    <div>
      <PageHeader eyebrow={dict.portal.finance} title={dict.finance.debts} description={dict.finance.debtsText} />

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={CircleDollarSign} label={dict.finance.totalDebt} value={isLoading ? "..." : formatMoney(total, locale)} />
        <StatCard icon={TriangleAlert} label={dict.finance.blockedProviders} value={isLoading ? "..." : String(blocked.length)} />
        <StatCard icon={Wallet} label={dict.finance.debtCeiling} value={formatMoney(500000, locale)} />
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
                const pct = Math.min(100, (row.amount / row.ceiling) * 100);
                return (
                  <tr key={row.id} className="hover:bg-slate-50">
                    <td className="p-4 font-medium text-navy">{row.name}</td>
                    <td className="p-4 text-secondary">{row.since ? formatDate(row.since, locale) : "—"}</td>
                    <td className="p-4 text-end">
                      <p className="font-semibold text-navy tabular-nums">{formatMoney(row.amount, locale)}</p>
                      <div className="mt-1.5 h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
                        <div className={`h-full rounded-full ${isBlocked ? "bg-rose-500" : "bg-amber-500"}`} style={{ width: `${pct}%` }} />
                      </div>
                    </td>
                    <td className="p-4 text-end text-secondary tabular-nums">{formatMoney(row.ceiling, locale)}</td>
                    <td className="p-4">
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${isBlocked ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>
                        {isBlocked ? dict.finance.blocked : dict.finance.active}
                      </span>
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
  const { data: ledgerData, isLoading } = useFinanceLedger(undefined, locale);

  const accounts = computeBalances(defaultEntries);
  const unbalanced = defaultEntries.filter((e) => !isBalanced(e)).length;

  return (
    <div>
      <PageHeader eyebrow={dict.portal.finance} title={dict.finance.ledger} description={dict.finance.ledgerText} />

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Scale} label={dict.finance.accounts} value={String(accounts.length)} />
        <StatCard icon={ReceiptText} label={dict.finance.transactions} value={isLoading ? "..." : String(ledgerData?.items?.length ?? defaultEntries.length)} />
        <StatCard icon={FileSpreadsheet} label={dict.finance.lines} value={String(defaultEntries.reduce((s, e) => s + e.lines.length, 0))} />
        <StatCard icon={BadgeCheck} label={dict.finance.balanced} value={`${defaultEntries.length - unbalanced} / ${defaultEntries.length}`} />
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
          {ledgerData?.items && ledgerData.items.length > 0 ? (
            <ul className="divide-y divide-line">
              {ledgerData.items.map((entry) => (
                <li key={entry.entryId} className="p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-mono text-xs font-semibold text-navy">#{entry.entryId} · {entry.transactionId.slice(0, 8)}</p>
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
          ) : (
            <ul className="divide-y divide-line">
              {defaultEntries.map((entry) => (
                <li key={entry.id} className="p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-mono text-xs font-semibold text-navy">{entry.id}</p>
                      <p className="mt-0.5 text-sm text-secondary">{(dict.finance.types as Record<string, string>)[entry.type]}</p>
                    </div>
                    <div className="text-end">
                      <p className="text-sm font-semibold text-navy tabular-nums">{formatMoney(entry.lines.reduce((s, l) => s + l.debit, 0), locale)}</p>
                      <p className="mt-0.5 text-xs text-muted">{formatDate(entry.date, locale)}</p>
                    </div>
                  </div>
                  <table className="mt-3 w-full text-xs">
                    <tbody>
                      {entry.lines.map((line) => (
                        <tr key={`${entry.id}-${line.account}`} className="border-t border-line">
                          <td className="py-1.5 font-mono text-secondary">{line.account}</td>
                          <td className="py-1.5 text-end text-muted tabular-nums">{line.debit ? formatMoney(line.debit, locale) : ""}</td>
                          <td className="py-1.5 text-end text-muted tabular-nums">{line.credit ? formatMoney(line.credit, locale) : ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700">
                    <ArrowDownLeft className="size-3" aria-hidden="true" />
                    {dict.finance.balances}
                    <ArrowUpRight className="size-3" aria-hidden="true" />
                  </p>
                </li>
              ))}
            </ul>
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
