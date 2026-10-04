import {
  ArrowDownLeft,
  ArrowUpRight,
  BadgeCheck,
  Banknote,
  CircleDollarSign,
  FileSpreadsheet,
  Landmark,
  ReceiptText,
  RefreshCcw,
  Scale,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import type { Dictionary } from "@/lib/dictionaries";
import { bookings, getService, providers } from "@/lib/data";
import { formatDate, formatMoney, type Locale } from "@/lib/utils";
import { Card, PageHeader, StatCard, StatusBadge } from "@/components/ui";

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

const entries: Entry[] = [
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

const sum = (rows: Entry[], pick: (l: Line) => number) => rows.reduce((t, e) => t + e.lines.reduce((s, l) => s + pick(l), 0), 0);
const isBalanced = (e: Entry) => e.lines.reduce((s, l) => s + l.debit, 0) === e.lines.reduce((s, l) => s + l.credit, 0);

function balances(): { account: Account; balance: number }[] {
  return (Object.keys(accountMeta) as Account[]).map((account) => {
    const debit = entries.reduce((t, e) => t + e.lines.filter((l) => l.account === account).reduce((s, l) => s + l.debit, 0), 0);
    const credit = entries.reduce((t, e) => t + e.lines.filter((l) => l.account === account).reduce((s, l) => s + l.credit, 0), 0);
    return { account, balance: accountMeta[account].normal === "debit" ? debit - credit : credit - debit };
  });
}

/* ------------------------------------------------------------------ *
 * Releases — TRD 6.3 release recipe
 * ------------------------------------------------------------------ */

export function FinanceReleases({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const releasable = bookings.filter((b) => b.status === "AWAITING_VERIFICATION");
  const released = entries.filter((e) => e.type === "RELEASE");
  const totalHeld = releasable.reduce((s, b) => s + b.quotedPaisa, 0);

  return (
    <div>
      <PageHeader eyebrow={dict.portal.finance} title={dict.finance.releases} description={dict.finance.releasesText} />

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Scale} label={dict.portal.held} value={formatMoney(totalHeld, locale)} />
        <StatCard icon={BadgeCheck} label={dict.portal.released} value={formatMoney(sum(released, (l) => l.credit), locale)} />
        <StatCard icon={ReceiptText} label={dict.finance.commissionEarned} value={formatMoney(sum(released, (l) => (l.account === "PLATFORM_COMMISSION" ? l.credit : 0)), locale)} />
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
              {releasable.map((booking) => {
                const provider = booking.providerId ? providers.find((p) => p.id === booking.providerId) : null;
                const final = booking.finalPaisa ?? booking.quotedPaisa;
                const commission = Math.round(final * 0.12);
                return (
                  <tr key={booking.id} className="hover:bg-slate-50">
                    <td className="p-4">
                      <p className="font-medium text-navy">{getService(booking.serviceSlug)?.name[locale]}</p>
                      <p className="mt-1 font-mono text-xs text-muted">{booking.code}</p>
                    </td>
                    <td className="p-4 text-secondary">{provider?.name ?? "-"}</td>
                    <td className="p-4"><StatusBadge status={booking.status} label={dict.status[booking.status]} /></td>
                    <td className="p-4 text-end">
                      <p className="font-semibold text-navy tabular-nums">{formatMoney(final, locale)}</p>
                      <p className="mt-1 text-xs text-muted tabular-nums">{dict.finance.providerShare} {formatMoney(final - commission, locale)}</p>
                    </td>
                  </tr>
                );
              })}
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

const refunds = [
  { id: "rf-1", booking: "bk-1031", code: "SHM-0001031", amount: 120000, reason: "disputedScope", date: "2026-09-06", method: "ONLINE", state: "COMPLETED" },
  { id: "rf-2", booking: "bk-1032", code: "SHM-0001032", amount: 950000, reason: "unfulfilled", date: "2026-09-19", method: "ONLINE", state: "PENDING" },
  { id: "rf-3", booking: "bk-1036", code: "SHM-0001036", amount: 420000, reason: "providerNoShow", date: "2026-09-20", method: "CASH", state: "COMPLETED" },
] as const;

export function FinanceRefunds({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const completed = refunds.filter((r) => r.state === "COMPLETED");

  return (
    <div>
      <PageHeader eyebrow={dict.portal.finance} title={dict.finance.refunds} description={dict.finance.refundsText} />

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={RefreshCcw} label={dict.finance.refundedTotal} value={formatMoney(completed.reduce((s, r) => s + r.amount, 0), locale)} />
        <StatCard icon={TriangleAlert} label={dict.finance.pendingRefunds} value={String(refunds.length - completed.length)} />
        <StatCard icon={Landmark} label={dict.finance.toOriginalMethod} value={String(completed.length)} />
        <StatCard icon={FileSpreadsheet} label={dict.finance.ledgerRows} value={String(refunds.length * 2)} />
      </div>

      <Card className="mt-6 overflow-hidden">
        <div className="border-b border-line p-5"><h2 className="font-semibold text-navy">{dict.finance.refundQueue}</h2></div>
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
              {refunds.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50">
                  <td className="p-4 font-mono text-xs font-semibold text-navy">{row.code}</td>
                  <td className="p-4 text-secondary">{dict.finance.reasons[row.reason]}</td>
                  <td className="p-4 text-secondary">{row.method === "CASH" ? dict.booking.cash : dict.booking.online}</td>
                  <td className="p-4 text-secondary">{formatDate(row.date, locale)}</td>
                  <td className="p-4">
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${row.state === "COMPLETED" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>
                      {row.state === "COMPLETED" ? dict.finance.completed : dict.finance.pending}
                    </span>
                  </td>
                  <td className="p-4 text-end font-semibold text-navy tabular-nums">{formatMoney(row.amount, locale)}</td>
                </tr>
              ))}
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

const payoutRows = [
  { id: "po-2044", provider: "prv-ahmad-plumber", amount: 842000, date: "2026-09-26", state: "APPROVED" },
  { id: "po-2043", provider: "prv-sana-sanitary", amount: 1280000, date: "2026-09-26", state: "APPROVED" },
  { id: "po-2042", provider: "prv-kashif-carpenter", amount: 352000, date: "2026-09-26", state: "REQUESTED" },
  { id: "po-2041", provider: "prv-ahmad-plumber", amount: 610000, date: "2026-09-09", state: "PAID" },
  { id: "po-2040", provider: "prv-bilal-plumbing", amount: 385000, date: "2026-09-02", state: "PAID" },
] as const;

export function FinancePayouts({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const approved = payoutRows.filter((r) => r.state === "APPROVED");

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
        <StatCard icon={Banknote} label={dict.finance.approvedThisRun} value={formatMoney(approved.reduce((s, r) => s + r.amount, 0), locale)} />
        <StatCard icon={ReceiptText} label={dict.finance.awaitingApproval} value={String(payoutRows.filter((r) => r.state === "REQUESTED").length)} />
        <StatCard icon={BadgeCheck} label={dict.finance.paidToDate} value={formatMoney(payoutRows.filter((r) => r.state === "PAID").reduce((s, r) => s + r.amount, 0), locale)} />
        <StatCard icon={FileSpreadsheet} label={dict.finance.batchFile} value="pay_2026_09_26.csv" />
      </div>

      <Card className="mt-6 overflow-hidden">
        <div className="border-b border-line p-5"><h2 className="font-semibold text-navy">{dict.finance.payoutRun}</h2></div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-slate-50 text-xs text-muted">
              <tr>
                <th className="p-4 text-start">{dict.finance.reference}</th>
                <th className="p-4 text-start">{dict.common.professional}</th>
                <th className="p-4 text-start">{dict.common.date}</th>
                <th className="p-4 text-start">{dict.common.status}</th>
                <th className="p-4 text-end">{dict.common.amount}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {payoutRows.map((row) => {
                const provider = providers.find((p) => p.id === row.provider);
                const tone = row.state === "PAID" ? "bg-emerald-50 text-emerald-700" : row.state === "APPROVED" ? "bg-blue-50 text-primary-strong" : "bg-amber-50 text-amber-800";
                return (
                  <tr key={row.id} className="hover:bg-slate-50">
                    <td className="p-4 font-mono text-xs font-semibold text-navy">{row.id}</td>
                    <td className="p-4 text-secondary">{provider?.name ?? row.provider}</td>
                    <td className="p-4 text-secondary">{formatDate(row.date, locale)}</td>
                    <td className="p-4"><span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${tone}`}>{dict.finance.states[row.state]}</span></td>
                    <td className="p-4 text-end font-semibold text-navy tabular-nums">{formatMoney(row.amount, locale)}</td>
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

const cashJobs = [
  { id: "bk-1033", code: "SHM-0001033", provider: "prv-imran-appliance", amount: 520000, status: "SCHEDULED", state: "authorisedToCollect" },
  { id: "bk-1035", code: "SHM-0001035", provider: "prv-sana-sanitary", amount: 560000, status: "COMPLETED", state: "collected" },
  { id: "bk-1036", code: "SHM-0001036", provider: "prv-bilal-plumbing", amount: 420000, status: "REQUESTED", state: "authorisedToCollect" },
] as const;

export function FinanceCash({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const outstanding = cashJobs.filter((j) => j.state === "authorisedToCollect");
  const commission = Math.round(cashJobs.filter((j) => j.state === "collected").reduce((s, j) => s + j.amount, 0) * 0.12);

  return (
    <div>
      <PageHeader eyebrow={dict.portal.finance} title={dict.finance.cash} description={dict.finance.cashText} />

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Banknote} label={dict.finance.cashJobs} value={String(cashJobs.length)} />
        <StatCard icon={Wallet} label={dict.finance.outstandingCash} value={formatMoney(outstanding.reduce((s, j) => s + j.amount, 0), locale)} />
        <StatCard icon={BadgeCheck} label={dict.finance.cashCommission} value={formatMoney(commission, locale)} />
        <StatCard icon={CircleDollarSign} label={dict.finance.receivables} value={formatMoney(90000, locale)} />
      </div>

      <Card className="mt-6 overflow-hidden">
        <div className="border-b border-line p-5"><h2 className="font-semibold text-navy">{dict.finance.cashReconciliation}</h2></div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-slate-50 text-xs text-muted">
              <tr>
                <th className="p-4 text-start">{dict.finance.booking}</th>
                <th className="p-4 text-start">{dict.common.professional}</th>
                <th className="p-4 text-start">{dict.common.status}</th>
                <th className="p-4 text-start">{dict.finance.settlement}</th>
                <th className="p-4 text-end">{dict.common.amount}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {cashJobs.map((job) => {
                const provider = providers.find((p) => p.id === job.provider);
                const done = job.state === "collected";
                return (
                  <tr key={job.id} className="hover:bg-slate-50">
                    <td className="p-4 font-mono text-xs font-semibold text-navy">{job.code}</td>
                    <td className="p-4 text-secondary">{provider?.name}</td>
                    <td className="p-4"><StatusBadge status={job.status} label={dict.status[job.status]} /></td>
                    <td className="p-4">
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${done ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-secondary"}`}>
                        {done ? dict.finance.collected : dict.finance.authorisedToCollect}
                      </span>
                    </td>
                    <td className="p-4 text-end font-semibold text-navy tabular-nums">{formatMoney(job.amount, locale)}</td>
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

const debts = [
  { id: "prv-ahmad-plumber", amount: 150000, ceiling: 500000, since: "2026-09-11" },
  { id: "prv-bilal-plumbing", amount: 42000, ceiling: 500000, since: "2026-09-04" },
  { id: "prv-kashif-carpenter", amount: 600000, ceiling: 500000, since: "2026-08-21" },
] as const;

export function FinanceDebts({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const blocked = debts.filter((d) => d.amount > d.ceiling);
  const total = debts.reduce((s, d) => s + d.amount, 0);

  return (
    <div>
      <PageHeader eyebrow={dict.portal.finance} title={dict.finance.debts} description={dict.finance.debtsText} />

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={CircleDollarSign} label={dict.finance.totalDebt} value={formatMoney(total, locale)} />
        <StatCard icon={TriangleAlert} label={dict.finance.blockedProviders} value={String(blocked.length)} />
        <StatCard icon={Wallet} label={dict.finance.debtCeiling} value={formatMoney(500000, locale)} />
        <StatCard icon={BadgeCheck} label={dict.finance.clearedOnline} value={String(debts.length - blocked.length)} />
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
              {debts.map((row) => {
                const provider = providers.find((p) => p.id === row.id);
                const isBlocked = row.amount > row.ceiling;
                const pct = Math.min(100, (row.amount / row.ceiling) * 100);
                return (
                  <tr key={row.id} className="hover:bg-slate-50">
                    <td className="p-4 font-medium text-navy">{provider?.name ?? row.id}</td>
                    <td className="p-4 text-secondary">{formatDate(row.since, locale)}</td>
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
 * Ledger — the drill-down every figure on the other pages comes from
 * ------------------------------------------------------------------ */

export function FinanceLedger({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const accounts = balances();
  const unbalanced = entries.filter((e) => !isBalanced(e)).length;

  return (
    <div>
      <PageHeader eyebrow={dict.portal.finance} title={dict.finance.ledger} description={dict.finance.ledgerText} />

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Scale} label={dict.finance.accounts} value={String(accounts.length)} />
        <StatCard icon={ReceiptText} label={dict.finance.transactions} value={String(entries.length)} />
        <StatCard icon={FileSpreadsheet} label={dict.finance.lines} value={String(entries.reduce((s, e) => s + e.lines.length, 0))} />
        <StatCard icon={BadgeCheck} label={dict.finance.balanced} value={`${entries.length - unbalanced} / ${entries.length}`} />
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
                    <p className="mt-0.5 text-[11px] text-muted">{dict.finance.groups[meta.group]}</p>
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
          <ul className="divide-y divide-line">
            {entries.map((entry) => (
              <li key={entry.id} className="p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-mono text-xs font-semibold text-navy">{entry.id}</p>
                    <p className="mt-0.5 text-sm text-secondary">{dict.finance.types[entry.type]}</p>
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
        </Card>
      </div>
    </div>
  );
}
