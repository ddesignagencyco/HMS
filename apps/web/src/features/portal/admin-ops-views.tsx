"use client";

import {
  BadgeCheck,
  BarChart3,
  Bell,
  Check,
  Download,
  FileText,
  Gavel,
  Languages,
  Lock,
  Mail,
  MessageSquare,
  Minus,
  PhoneCall,
  ShieldAlert,
  Smartphone,
  Star,
  TriangleAlert,
  UsersRound,
  Wallet,
} from "lucide-react";
import type { Dictionary } from "@/lib/dictionaries";
import { bookings, categories, providers, services } from "@/lib/data";
import { formatDate, formatMoney, formatNumber, type Locale } from "@/lib/utils";
import {
  Card,
  PageHeader,
  StatCard,
} from "@/components/ui";

/* ------------------------------------------------------------------ *
 * Disputes and penalties — M10, M15
 * FR-PN-05 per-job liability cap, FR-PN-06 evidence + 48 h to respond
 * before a penalty may move PROPOSED to APPLIED.
 * ------------------------------------------------------------------ */

const disputes = [
  { id: "dp-1", booking: "bk-1031", code: "SHM-0001031", parties: "customer", state: "OPEN", opened: "2026-09-24", claim: 120000, cap: 142000 },
  { id: "dp-2", booking: "bk-1030", code: "SHM-0001030", parties: "customer", state: "UNDER_REVIEW", opened: "2026-09-18", claim: 500000, cap: 850000 },
  { id: "dp-3", booking: "bk-1036", code: "SHM-0001036", parties: "provider", state: "RESOLVED", opened: "2026-09-11", claim: 0, cap: 420000 },
  { id: "dp-4", booking: "bk-1033", code: "SHM-0001033", parties: "customer", state: "OPEN", opened: "2026-09-25", claim: 95000, cap: 118000 },
  { id: "dp-5", booking: "bk-1035", code: "SHM-0001035", parties: "provider", state: "UNDER_REVIEW", opened: "2026-09-16", claim: 240000, cap: 615000 },
  { id: "dp-6", booking: "bk-1028", code: "SHM-0001028", parties: "customer", state: "RESOLVED", opened: "2026-09-05", claim: 0, cap: 300000 },
] as const;

export function AdminDisputes({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const rows = [...disputes].sort((left, right) => right.opened.localeCompare(left.opened));

  return (
    <div>
      <PageHeader eyebrow={dict.portal.admin} title={dict.admin.disputes} description={dict.admin.disputesText} />

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Gavel} label={dict.admin.openDisputes} value={String(disputes.filter((d) => d.state !== "RESOLVED").length)} />
        <StatCard icon={Wallet} label={dict.admin.totalClaimed} value={formatMoney(disputes.reduce((s, d) => s + d.claim, 0), locale)} />
        <StatCard icon={ShieldAlert} label={dict.admin.providerRaised} value={String(disputes.filter((d) => d.parties === "provider").length)} />
        <StatCard icon={BadgeCheck} label={dict.admin.resolvedDisputes} value={String(disputes.filter((d) => d.state === "RESOLVED").length)} />
      </div>

      <Card className="mt-6 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-5">
          <h2 className="font-semibold text-navy">{dict.admin.disputeQueue}</h2>
          <p className="text-xs text-muted">{dict.admin.capNote}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-slate-50 text-xs text-muted">
              <tr>
                <th className="p-4 text-start">{dict.finance.booking}</th>
                <th className="p-4 text-start">{dict.admin.raisedBy}</th>
                <th className="p-4 text-start">{dict.common.status}</th>
                <th className="p-4 text-end">{dict.admin.claimed}</th>
                <th className="p-4 text-end">{dict.admin.liabilityCap}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50">
                  <td className="p-4 font-mono text-xs font-semibold text-navy">{row.code}</td>
                  <td className="p-4 text-secondary capitalize">{dict.admin.raisedByLabels[row.parties]}</td>
                  <td className="p-4">
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${row.state === "RESOLVED" ? "bg-emerald-50 text-emerald-700" : "bg-blue-50 text-primary-strong"}`}>
                      {dict.admin.complaintStates[row.state as keyof typeof dict.admin.complaintStates]}
                    </span>
                  </td>
                  <td className="p-4 text-end font-semibold text-navy tabular-nums">{formatMoney(row.claim, locale)}</td>
                  <td className="p-4 text-end text-secondary tabular-nums">
                    {formatMoney(row.cap, locale)}
                    {row.claim > row.cap ? <span className="ms-2 text-[11px] font-semibold text-rose-600">{dict.admin.truncated}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

const penalties = [
  { id: "pn-1", provider: "prv-ahmad-plumber", breach: "LATE_30", fine: 60000, points: 1, state: "APPLIED", replyBy: "2026-09-14", since: "2026-08-14" },
  { id: "pn-2", provider: "prv-ahmad-plumber", breach: "NO_SHOW", fine: 100000, points: 8, state: "PROPOSED", replyBy: "2026-09-28", since: "2026-04-19" },
  { id: "pn-3", provider: "prv-bilal-plumbing", breach: "LATE_CANCEL", fine: 50000, points: 3, state: "APPLIED", replyBy: "2026-08-30", since: "2026-07-02" },
  { id: "pn-4", provider: "prv-bilal-plumbing", breach: "POOR_STREAK", fine: 150000, points: 6, state: "PROPOSED", replyBy: "2026-09-30", since: "2026-06-11" },
  { id: "pn-5", provider: "prv-imran-appliance", breach: "REWORK_VERIFIED", fine: 80000, points: 4, state: "APPLIED", replyBy: "2026-08-18", since: "2026-07-20" },
  { id: "pn-6", provider: "prv-ahmad-plumber", breach: "LATE_30", fine: 45000, points: 1, state: "APPLIED", replyBy: "2026-07-04", since: "2026-05-28" },
] as const;

export function AdminPenalties({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const rows = penalties;

  return (
    <div>
      <PageHeader eyebrow={dict.portal.admin} title={dict.admin.penalties} description={dict.admin.penaltiesText} />

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={TriangleAlert} label={dict.admin.proposed} value={String(penalties.filter((p) => p.state === "PROPOSED").length)} />
        <StatCard icon={Gavel} label={dict.admin.applied} value={String(penalties.filter((p) => p.state === "APPLIED").length)} />
        <StatCard icon={Wallet} label={dict.admin.finesRetained} value={formatMoney(penalties.filter((p) => p.state === "APPLIED").reduce((s, p) => s + p.fine, 0), locale)} />
        <StatCard icon={ShieldAlert} label={dict.portal.activePoints} value={`${penalties.reduce((s, p) => s + p.points, 0)} / 60`} />
      </div>

      <div className="mt-6 flex items-start gap-3 rounded-[12px] border border-amber-200 bg-amber-50 px-4 py-3">
        <Lock className="mt-0.5 size-4 shrink-0 text-amber-700" aria-hidden="true" />
        <p className="text-sm leading-6 text-amber-900">{dict.admin.proposedNote}</p>
      </div>

      <Card className="mt-6 overflow-hidden">
        <div className="border-b border-line p-5"><h2 className="font-semibold text-navy">{dict.admin.penaltyRegister}</h2></div>
        <ul className="divide-y divide-line">
          {rows.map((row) => {
            const provider = providers.find((p) => p.id === row.provider);
            const isProposed = row.state === "PROPOSED";
            return (
              <li key={row.id} className={isProposed ? "bg-amber-50/30 p-5" : "p-5"}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-navy">{provider?.name ?? row.provider}</p>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[10px] font-semibold text-secondary">{row.breach}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${isProposed ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-700"}`}>
                        {isProposed ? dict.admin.proposed : dict.admin.applied}
                      </span>
                    </div>
                    <p className="mt-1.5 text-xs text-muted">
                      {dict.admin.since} {formatDate(row.since, locale)} · {dict.admin.replyBy} {formatDate(row.replyBy, locale)}
                    </p>
                  </div>
                  <div className="flex items-center gap-5 text-end">
                    <div>
                      <p className="text-xs text-muted">{dict.admin.fine}</p>
                      <p className="text-sm font-semibold text-navy tabular-nums">{formatMoney(row.fine, locale)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted">{dict.portal.activePoints}</p>
                      <p className="text-sm font-semibold text-rose-600 tabular-nums">+{row.points}</p>
                    </div>
                  </div>
                </div>
                {isProposed ? (
                  <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
                    <button type="button" className="min-h-10 rounded-[9px] border border-line px-4 text-xs font-semibold text-navy transition hover:bg-slate-50">{dict.admin.viewEvidence}</button>
                    <button type="button" className="min-h-10 rounded-[9px] border border-line px-4 text-xs font-semibold text-rose-600 transition hover:border-rose-300 hover:bg-rose-50">{dict.admin.dismiss}</button>
                    {/* A proposal cannot be applied by this role on its own, so
                        the reason is shown instead of a button that never
                        does anything. */}
                    <p className="self-center text-xs text-amber-700">{dict.admin.applyBlocked}</p>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}

const appeals = [
  { id: "ap-1", provider: "prv-ahmad-plumber", against: "pn-2", reason: "disputedNoShow", filed: "2026-09-22", state: "UNDER_REVIEW" },
  { id: "ap-2", provider: "prv-bilal-plumbing", against: "pn-3", reason: "wronglyAttributed", filed: "2026-08-05", state: "UPHELD" },
  { id: "ap-3", provider: "prv-imran-appliance", against: "pn-4", reason: "disputedNoShow", filed: "2026-09-24", state: "UNDER_REVIEW" },
  { id: "ap-4", provider: "prv-bilal-plumbing", against: "pn-6", reason: "wronglyAttributed", filed: "2026-06-30", state: "UPHELD" },
  { id: "ap-5", provider: "prv-ahmad-plumber", against: "pn-5", reason: "disputedNoShow", filed: "2026-09-18", state: "UNDER_REVIEW" },
] as const;

export function AdminAppeals({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const rows = appeals;

  return (
    <div>
      <PageHeader eyebrow={dict.portal.admin} title={dict.admin.appeals} description={dict.admin.appealsText} />

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <StatCard icon={Gavel} label={dict.admin.underReview} value={String(appeals.filter((a) => a.state === "UNDER_REVIEW").length)} />
        <StatCard icon={BadgeCheck} label={dict.admin.upheld} value={String(appeals.filter((a) => a.state === "UPHELD").length)} />
        <StatCard icon={Star} label={dict.admin.reviewed} value={String(appeals.length)} />
      </div>

      <Card className="mt-6 overflow-hidden">
        <div className="border-b border-line p-5"><h2 className="font-semibold text-navy">{dict.admin.appealRegister}</h2></div>
        <ul className="divide-y divide-line">
          {rows.map((row) => {
            const provider = providers.find((p) => p.id === row.provider);
            const upheld = row.state === "UPHELD";
            return (
              <li key={row.id} className="flex flex-wrap items-start justify-between gap-4 p-5">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-navy">{provider?.name ?? row.provider}</p>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[10px] font-semibold text-secondary">{row.against}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${upheld ? "bg-emerald-50 text-emerald-700" : "bg-blue-50 text-primary-strong"}`}>
                      {upheld ? dict.admin.upheld : dict.admin.underReview}
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm text-secondary">{dict.admin.appealReasons[row.reason]}</p>
                  <p className="mt-1 text-xs text-muted">{dict.admin.filed} {formatDate(row.filed, locale)}</p>
                </div>
                {!upheld ? (
                  <div className="flex gap-2">
                    <button type="button" className="min-h-10 rounded-[9px] bg-primary px-4 text-xs font-semibold text-white transition hover:bg-primary-strong">{dict.admin.upholdAppeal}</button>
                    <button type="button" className="min-h-10 rounded-[9px] border border-line px-4 text-xs font-semibold text-navy transition hover:bg-slate-50">{dict.admin.rejectAppeal}</button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
        <p className="border-t border-line bg-slate-50 px-5 py-3 text-xs text-muted">{dict.admin.appealNote}</p>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Reports — FR-RP-01 to FR-RP-06
 * ------------------------------------------------------------------ */

const months = [
  { month: "Apr", bookings: 148, successful: 131, revenue: 7420000 },
  { month: "May", bookings: 172, successful: 158, revenue: 8860000 },
  { month: "Jun", bookings: 165, successful: 149, revenue: 8140000 },
  { month: "Jul", bookings: 194, successful: 181, revenue: 9680000 },
  { month: "Aug", bookings: 208, successful: 190, revenue: 10240000 },
  { month: "Sep", bookings: 186, successful: 171, revenue: 9340000 },
] as const;

export function AdminReports({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const totalBookings = months.reduce((s, m) => s + m.bookings, 0);
  const totalSuccessful = months.reduce((s, m) => s + m.successful, 0);
  const totalRevenue = months.reduce((s, m) => s + m.revenue, 0);
  const peak = Math.max(...months.map((m) => m.revenue));

  const byCategory = categories.map((category) => {
    const count = services.filter((s) => s.categorySlug === category.slug).length;
    return { category, count, share: (count / services.length) * 100 };
  });

  return (
    <div>
      <PageHeader
        eyebrow={dict.portal.admin}
        title={dict.admin.reports}
        description={dict.admin.reportsText}
        action={
          <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-[9px] border border-line bg-white px-4 text-sm font-semibold text-navy transition hover:bg-slate-50">
            <Download className="size-4" aria-hidden="true" />
            {dict.admin.exportPdf}
          </button>
        }
      />

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={BarChart3} label={dict.admin.bookingsSixMonths} value={formatNumber(totalBookings, locale)} />
        <StatCard icon={BadgeCheck} label={dict.admin.successRate} value={`${((totalSuccessful / totalBookings) * 100).toFixed(1)}%`} />
        <StatCard icon={Wallet} label={dict.admin.revenueSixMonths} value={formatMoney(totalRevenue, locale)} />
        <StatCard icon={Star} label={dict.admin.topCategory} value={byCategory[0]?.category.name[locale] ?? "-"} />
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Card className="p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold text-navy">{dict.admin.revenueByMonth}</h2>
            <p className="text-xs text-muted">{dict.admin.tiesToLedger}</p>
          </div>
          <ul className="mt-6 flex h-48 items-end gap-3">
            {months.map((m) => (
              <li key={m.month} className="flex flex-1 flex-col items-center gap-2">
                <span className="text-[10px] font-semibold text-muted tabular-nums">{Math.round(m.revenue / 100000)}k</span>
                <span className="w-full rounded-t-[5px] bg-primary/85 transition-all duration-500" style={{ height: `${(m.revenue / peak) * 100}%` }} />
                <span className="text-xs font-semibold text-navy">{m.month}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="p-5">
          <h2 className="font-semibold text-navy">{dict.admin.byCategory}</h2>
          <ul className="mt-5 grid gap-3.5">
            {byCategory.map(({ category, count, share }) => (
              <li key={category.id}>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-secondary">{category.name[locale]}</span>
                  <span className="text-xs text-muted tabular-nums">{count} {dict.admin.services.toLowerCase()}</span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${share}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card className="mt-6 overflow-hidden">
        <div className="border-b border-line p-5"><h2 className="font-semibold text-navy">{dict.admin.providerPerformance}</h2></div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-sm">
            <thead className="bg-slate-50 text-xs text-muted">
              <tr>
                <th className="p-4 text-start">{dict.common.professional}</th>
                <th className="p-4 text-end">{dict.admin.completedJobs}</th>
                <th className="p-4 text-end">{dict.common.rating}</th>
                <th className="p-4 text-end">{dict.admin.successRate}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {providers.map((provider) => (
                <tr key={provider.id} className="hover:bg-slate-50">
                  <td className="p-4 font-medium text-navy">{provider.name}</td>
                  <td className="p-4 text-end text-secondary tabular-nums">{formatNumber(provider.verifiedJobs, locale)}</td>
                  <td className="p-4 text-end font-semibold text-navy tabular-nums">{provider.rating.toFixed(1)}</td>
                  <td className="p-4 text-end text-secondary tabular-nums">{((94 + provider.rating) - 0.5).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Roles and permissions — FR-AD-13, guard matrix evaluated server-side
 * ------------------------------------------------------------------ */

const permissions = [
  { key: "approveProviders", roles: [true, false, true] },
  { key: "manageCatalogue", roles: [true, false, true] },
  { key: "runVerification", roles: [true, true, false] },
  { key: "releaseEscrow", roles: [false, true, false] },
  { key: "approveRefunds", roles: [false, true, true] },
  { key: "viewAudit", roles: [true, true, true] },
  { key: "changeSettings", roles: [true, false, true] },
  { key: "viewRecordings", roles: [false, true, true] },
  { key: "manageRoles", roles: [true, false, false] },
] as const;

export function AdminRoles({ dict }: { dict: Dictionary }) {
  const roles = [dict.portal.admin, dict.portal.finance, dict.portal.agent] as const;

  return (
    <div>
      <PageHeader eyebrow={dict.portal.admin} title={dict.admin.roles} description={dict.admin.rolesText} />

      <div className="mt-6 flex items-start gap-3 rounded-[12px] border border-blue-200 bg-blue-50 px-4 py-3">
        <Lock className="mt-0.5 size-4 shrink-0 text-primary-strong" aria-hidden="true" />
        <p className="text-sm leading-6 text-navy">{dict.admin.guardNote}</p>
      </div>

      <Card className="mt-6 overflow-hidden">
        <div className="border-b border-line p-5"><h2 className="font-semibold text-navy">{dict.admin.guardMatrix}</h2></div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-slate-50 text-xs text-muted">
              <tr>
                <th className="p-4 text-start">{dict.admin.permission}</th>
                {roles.map((role) => (
                  <th key={role} className="p-4 text-center">{role}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {permissions.map((row) => (
                <tr key={row.key}>
                  <td className="p-4 font-medium text-navy">{dict.admin.permissions[row.key]}</td>
                  {row.roles.map((allowed, index) => (
                    <td key={roles[index]} className="p-4 text-center">
                      {allowed ? (
                        <Check className="mx-auto size-4 text-emerald-600" aria-label={dict.admin.allowed} />
                      ) : (
                        <Minus className="mx-auto size-4 text-slate-300" aria-label={dict.admin.denied} />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Notification templates — FR-NT-06, editable per event x channel x language
 * ------------------------------------------------------------------ */

const templateRows = [
  { event: "bookingConfirmed", channels: ["email", "sms", "inapp"], en: "Your booking {code} is confirmed for {slot}.", ur: "آپ کی بکنگ {code} کی تصدیق ہو گئی۔" },
  { event: "providerEnRoute", channels: ["sms", "inapp"], en: "{name} is on the way to {area}.", ur: "{name} {area} کی طرف روانہ ہیں۔" },
  { event: "startOtp", channels: ["sms"], en: "Your start code is {otp}. Valid on the slot day only.", ur: "آپ کا اسٹارٹ کوڈ {otp} ہے۔" },
  { event: "verificationCall", channels: ["sms", "email"], en: "We will call you between {band} to confirm the work.", ur: "ہم {band} کے دوران کام کی تصدیق کے لیے آپ کو کال کریں گے۔" },
  { event: "paymentReleased", channels: ["email", "sms", "inapp"], en: "{amount} has been released to your professional.", ur: "{amount} آپ کے پیشہ کار کو جاری کر دی گئی ہے۔" },
] as const;

export function AdminTemplates({ dict }: { dict: Dictionary }) {
  return (
    <div>
      <PageHeader
        eyebrow={dict.portal.admin}
        title={dict.admin.templates}
        description={dict.admin.templatesText}
        action={
          <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-[9px] bg-primary px-5 text-sm font-semibold text-white transition hover:bg-primary-strong">
            <Languages className="size-4" aria-hidden="true" />
            {dict.admin.newTemplate}
          </button>
        }
      />

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={FileText} label={dict.admin.templatesTotal} value={String(templateRows.length)} />
        <StatCard icon={Mail} label={dict.admin.channelEmail} value="3" />
        <StatCard icon={MessageSquare} label={dict.admin.channelSms} value="4" />
        <StatCard icon={Bell} label={dict.admin.channelInApp} value="3" />
      </div>

      <div className="mt-6 grid gap-5">
        {templateRows.map((row) => (
          <Card key={row.event} className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold text-navy">{dict.admin.events[row.event]}</h2>
                <p className="mt-1 font-mono text-xs text-muted">{row.event}</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {row.channels.map((channel) => (
                  <span key={channel} className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-secondary">
                    {dict.admin.channels[channel]}
                  </span>
                ))}
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.1em] text-muted">EN</p>
                <p dir="ltr" className="rounded-[8px] border border-line bg-slate-50 px-3 py-2.5 text-sm leading-6 text-navy">{row.en}</p>
              </div>
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.1em] text-muted">UR</p>
                <p dir="rtl" lang="ur" className="rounded-[8px] border border-line bg-slate-50 px-3 py-2.5 text-sm leading-6 text-navy">{row.ur}</p>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Plan definitions — FR-MP-01
 * ------------------------------------------------------------------ */

const planDefs = [
  { id: "care", name: "Care", services: 6, interval: "6 months", price: 490000, subscribers: 214, state: "ACTIVE" },
  { id: "plus", name: "Care Plus", services: 9, interval: "6 months", price: 890000, subscribers: 168, state: "ACTIVE" },
  { id: "cover", name: "Full Cover", services: 12, interval: "6 months", price: 1490000, subscribers: 61, state: "DRAFT" },
] as const;

export function AdminPlans({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  return (
    <div>
      <PageHeader
        eyebrow={dict.portal.admin}
        title={dict.portal.plans}
        description={dict.admin.plansText}
        action={
          <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-[9px] bg-primary px-5 text-sm font-semibold text-white transition hover:bg-primary-strong">
            <FileText className="size-4" aria-hidden="true" />
            {dict.admin.newPlan}
          </button>
        }
      />

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={FileText} label={dict.admin.plansDefined} value={String(planDefs.length)} />
        <StatCard icon={BadgeCheck} label={dict.admin.livePlans} value={String(planDefs.filter((p) => p.state === "ACTIVE").length)} />
        <StatCard icon={UsersRound} label={dict.admin.subscribers} value={formatNumber(planDefs.reduce((s, p) => s + p.subscribers, 0), locale)} />
        <StatCard icon={Wallet} label={dict.admin.planValue} value={formatMoney(planDefs.reduce((s, p) => s + p.subscribers * p.price, 0), locale)} />
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-3">
        {planDefs.map((plan) => (
          <Card key={plan.id} className="flex flex-col p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-[17px] font-semibold tracking-[-0.025em] text-navy">{plan.name}</h2>
                <p className="mt-1 font-mono text-xs text-muted">{plan.id}</p>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${plan.state === "ACTIVE" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-muted"}`}>
                {plan.state === "ACTIVE" ? dict.portal.active : dict.admin.draft}
              </span>
            </div>

            <p className="mt-4 text-2xl font-semibold tracking-[-0.04em] text-navy">{formatMoney(plan.price, locale)}</p>
            <p className="mt-1 text-sm text-secondary">{dict.plansPage.perYear}</p>

            <dl className="mt-5 grid gap-2 border-t border-line pt-4 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted">{dict.admin.includedServices}</dt>
                <dd className="font-semibold text-navy tabular-nums">{plan.services}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">{dict.admin.interval}</dt>
                <dd className="text-secondary">{plan.interval}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">{dict.admin.subscribers}</dt>
                <dd className="text-secondary tabular-nums">{formatNumber(plan.subscribers, locale)}</dd>
              </div>
            </dl>

            <button type="button" className="mt-6 min-h-10 w-full rounded-[9px] border border-line text-xs font-semibold text-navy transition hover:bg-slate-50">
              {dict.common.edit}
            </button>
          </Card>
        ))}
      </div>

      <Card className="mt-6 p-5">
        <h2 className="font-semibold text-navy">{dict.admin.planReleaseNote}</h2>
        <p className="mt-2 text-sm leading-6 text-secondary">{dict.admin.planReleaseText}</p>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Agent attempts — FR-VC-06, three failures across two bands then the
 * Tier B link is sent exactly once.
 * ------------------------------------------------------------------ */

const attempts = [
  { id: "at-1", booking: "bk-1030", band: "08-12", at: "2026-09-25T09:12:00+05:00", outcome: "noAnswer", attempt: 1 },
  { id: "at-2", booking: "bk-1030", band: "08-12", at: "2026-09-25T10:40:00+05:00", outcome: "noAnswer", attempt: 2 },
  { id: "at-3", booking: "bk-1030", band: "12-17", at: "2026-09-25T13:05:00+05:00", outcome: "noAnswer", attempt: 3 },
  { id: "at-4", booking: "bk-1030", band: "12-17", at: "2026-09-25T13:06:00+05:00", outcome: "linkSent", attempt: 4 },
  { id: "at-5", booking: "bk-1034", band: "17-22", at: "2026-09-24T18:22:00+05:00", outcome: "connected", attempt: 1 },
  { id: "at-6", booking: "bk-1036", band: "08-12", at: "2026-09-24T09:41:00+05:00", outcome: "connected", attempt: 1 },
] as const;

export function AgentAttempts({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const linkSent = attempts.filter((a) => a.outcome === "linkSent").length;

  return (
    <div>
      <PageHeader eyebrow={dict.portal.agent} title={dict.agent.attempts} description={dict.agent.attemptsText} />

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={PhoneCall} label={dict.agent.attemptsLogged} value={String(attempts.length)} />
        <StatCard icon={TriangleAlert} label={dict.agent.noAnswers} value={String(attempts.filter((a) => a.outcome === "noAnswer").length)} />
        <StatCard icon={BadgeCheck} label={dict.agent.connected} value={String(attempts.filter((a) => a.outcome === "connected").length)} />
        <StatCard icon={MessageSquare} label={dict.agent.linksSent} value={String(linkSent)} />
      </div>

      <div className="mt-6 flex items-start gap-3 rounded-[12px] border border-blue-200 bg-blue-50 px-4 py-3">
        <Smartphone className="mt-0.5 size-4 shrink-0 text-primary-strong" aria-hidden="true" />
        <p className="text-sm leading-6 text-navy">{dict.agent.fallbackNote}</p>
      </div>

      <Card className="mt-6 overflow-hidden">
        <div className="border-b border-line p-5"><h2 className="font-semibold text-navy">{dict.agent.attemptLog}</h2></div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-slate-50 text-xs text-muted">
              <tr>
                <th className="p-4 text-start">{dict.finance.booking}</th>
                <th className="p-4 text-start">{dict.common.date}</th>
                <th className="p-4 text-start">{dict.agent.band}</th>
                <th className="p-4 text-end">{dict.agent.attemptNo}</th>
                <th className="p-4 text-start">{dict.agent.outcome}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {attempts.map((row) => {
                const booking = bookings.find((b) => b.id === row.booking);
                const tone = row.outcome === "connected" ? "bg-emerald-50 text-emerald-700" : row.outcome === "linkSent" ? "bg-blue-50 text-primary-strong" : "bg-slate-100 text-secondary";
                return (
                  <tr key={row.id} className="hover:bg-slate-50">
                    <td className="p-4 font-mono text-xs font-semibold text-navy">{booking?.code ?? row.booking}</td>
                    <td className="p-4 font-mono text-xs text-secondary">{row.at.replace("T", " ").replace("+05:00", "")}</td>
                    <td className="p-4 text-secondary tabular-nums">{row.band}</td>
                    <td className="p-4 text-end text-secondary tabular-nums">{formatNumber(row.attempt, locale)}</td>
                    <td className="p-4"><span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${tone}`}>{dict.agent.outcomes[row.outcome]}</span></td>
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
