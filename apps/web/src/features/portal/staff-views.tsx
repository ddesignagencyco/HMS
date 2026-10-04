"use client";

import { AlertTriangle, BadgeCheck, BriefcaseBusiness, ClipboardCheck, CreditCard, ShieldCheck, UsersRound } from "lucide-react";
import Link from "next/link";
import type { Dictionary } from "@/lib/dictionaries";
import { bookings, getService, providers } from "@/lib/data";
import { formatDateTime, formatMoney, localizedPath, type Locale } from "@/lib/utils";
import {
  Card,
  PageHeader,
  StatCard,
  StatusBadge,
  VerifiedMark,
} from "@/components/ui";

export function AgentQueue({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const queue = bookings.filter((booking) => ["AWAITING_VERIFICATION", "DISPUTED", "VERIFIED"].includes(booking.status));
  const sorted = [...queue].sort((left, right) => right.scheduledStart.localeCompare(left.scheduledStart));

  return (
    <div>
      <PageHeader eyebrow={dict.portal.agent} title={dict.portal.queueTitle} description={dict.portal.queueDescription} />
      <div className="mt-6 grid gap-4 sm:grid-cols-3"><StatCard icon={ClipboardCheck} label={dict.portal.callsToday} value="6" /><StatCard icon={AlertTriangle} label={dict.portal.disputes} value={String(queue.filter((item) => item.status === "DISPUTED").length)} /><StatCard icon={BadgeCheck} label={dict.portal.passed} value={String(queue.filter((item) => item.status === "VERIFIED").length)} /></div>

      <Card className="mt-6 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-slate-50 text-xs text-muted"><tr><th className="p-4 text-start">{dict.common.service}</th><th className="p-4 text-start">{dict.common.professional}</th><th className="p-4 text-start">{dict.common.date}</th><th className="p-4 text-start">{dict.common.status}</th><th className="p-4 text-end">{dict.common.actions}</th></tr></thead>
            <tbody className="divide-y divide-line">
              {sorted.map((booking) => { const service = getService(booking.serviceSlug); const provider = providers.find((item) => item.id === booking.providerId); return <tr key={booking.id}><td className="p-4 font-medium text-navy">{service?.name[locale]}</td><td className="p-4 text-secondary">{provider?.name ?? "-"}</td><td className="p-4 text-secondary">{formatDateTime(booking.scheduledStart, locale)}</td><td className="p-4"><StatusBadge status={booking.status} label={dict.status[booking.status]} /></td><td className="p-4 text-end"><Link href={localizedPath(locale, `/agent/verification/${booking.id}`)} className="font-semibold text-primary-strong">{dict.portal.console}</Link></td></tr>; })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

export function AdminOverview({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  return (
    <div>
      <PageHeader eyebrow={dict.portal.admin} title={dict.portal.adminOverview} description={dict.portal.controlRoomDescription} />
      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><StatCard icon={BriefcaseBusiness} label={dict.portal.totalBookings} value={String(bookings.length)} /><StatCard icon={UsersRound} label={dict.home.statPros} value={String(providers.length)} /><StatCard icon={ClipboardCheck} label={dict.portal.queue} value="2" /><StatCard icon={CreditCard} label={dict.portal.protectedTotal} value={formatMoney(bookings.filter((item) => item.paymentStatus === "HELD").reduce((sum, item) => sum + item.quotedPaisa, 0), locale)} /></div>
      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_320px]">
        <Card className="p-5"><h2 className="font-semibold text-navy">{dict.portal.bookings}</h2><div className="mt-4 grid gap-3">{bookings.slice(0, 5).map((booking) => { const service = getService(booking.serviceSlug); return <div key={booking.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3 text-sm"><div><p className="font-medium text-navy">{service?.name[locale]}</p><p className="text-xs text-muted">{booking.code}</p></div><StatusBadge status={booking.status} label={dict.status[booking.status]} /></div>; })}</div></Card>
        <Card className="p-5"><h2 className="font-semibold text-navy">{dict.portal.escrow}</h2><div className="mt-4 grid gap-4 text-sm"><div><p className="text-muted">{dict.portal.held}</p><p className="mt-1 text-2xl font-semibold text-navy">{formatMoney(bookings.filter((item) => item.paymentStatus === "HELD").reduce((sum, item) => sum + item.quotedPaisa, 0), locale)}</p></div><div><p className="text-muted">{dict.portal.released}</p><p className="mt-1 text-2xl font-semibold text-navy">{formatMoney(bookings.filter((item) => item.paymentStatus === "RELEASED").reduce((sum, item) => sum + (item.finalPaisa ?? item.quotedPaisa), 0), locale)}</p></div></div></Card>
      </div>
    </div>
  );
}

export function AdminProviders({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  return (
    <div>
      <PageHeader eyebrow={dict.portal.admin} title={dict.portal.providers} description={dict.portal.approvalsDescription} />
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {providers.map((provider) => <Card key={provider.id} className="p-5"><div className="flex items-start justify-between gap-3"><div><VerifiedMark label={dict.providers.verified} /><h2 className="mt-2 font-semibold text-navy">{provider.name}</h2><p className="mt-1 text-sm text-secondary">{provider.qualification[locale]}</p></div><ShieldCheck className="size-5 text-emerald-700" /></div><div className="mt-4 flex items-center justify-between border-t border-line pt-4"><span className="text-xs text-muted">{dict.providers.jobs.replace("{count}", String(provider.verifiedJobs))}</span><Link href={localizedPath(locale, `/admin/providers/${provider.id}`)} className="text-sm font-semibold text-primary-strong">{dict.portal.activity}</Link></div></Card>)}
      </div>
    </div>
  );
}

export function AdminProviderDetail({ locale, dict, id }: { locale: Locale; dict: Dictionary; id: string }) {
  const provider = providers.find((item) => item.id === id) ?? providers[0];
  return <div><PageHeader eyebrow={dict.portal.providers} title={provider.name} description={provider.bio[locale]} action={<VerifiedMark label={dict.providers.verified} />} /><div className="mt-6 grid gap-5 md:grid-cols-2"><Card className="p-5"><h2 className="font-semibold text-navy">{dict.providers.qualification}</h2><p className="mt-2 text-sm text-secondary">{provider.qualification[locale]}</p></Card><Card className="p-5"><h2 className="font-semibold text-navy">{dict.providers.expertise}</h2><p className="mt-2 text-sm text-secondary">{provider.serviceSlugs.length} approved services · {provider.areas.length} areas</p></Card></div></div>;
}

export function FinanceOverviewView({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const held = bookings.filter((item) => item.paymentStatus === "HELD");
  const released = bookings.filter((item) => item.paymentStatus === "RELEASED");
  const releasedTotal = released.reduce((sum, item) => sum + (item.finalPaisa ?? item.quotedPaisa), 0);
  const heldTotal = held.reduce((sum, item) => sum + item.quotedPaisa, 0);
  const disputed = bookings.filter((item) => item.status === "DISPUTED");

  return (
    <div>
      <PageHeader eyebrow={dict.portal.finance} title={dict.portal.overview} description={dict.portal.escrowDescription} />
      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={CreditCard} label={dict.portal.held} value={formatMoney(heldTotal, locale)} />
        <StatCard icon={BadgeCheck} label={dict.portal.released} value={formatMoney(releasedTotal, locale)} />
        <StatCard icon={ClipboardCheck} label={dict.portal.heldCount} value={String(held.length)} />
        <StatCard icon={AlertTriangle} label={dict.portal.disputes} value={String(disputed.length)} />
      </div>
    </div>
  );
}

export function EscrowView({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const held = bookings.filter((item) => item.paymentStatus === "HELD");
  return (
    <div>
      <PageHeader eyebrow={dict.portal.finance} title={dict.portal.escrow} description={dict.portal.escrowDescription} />
      <div className="mt-6 grid gap-4 sm:grid-cols-3"><StatCard icon={CreditCard} label={dict.portal.held} value={formatMoney(held.reduce((sum, item) => sum + item.quotedPaisa, 0), locale)} /><StatCard icon={BadgeCheck} label={dict.portal.released} value={formatMoney(bookings.filter((item) => item.paymentStatus === "RELEASED").reduce((sum, item) => sum + (item.finalPaisa ?? item.quotedPaisa), 0), locale)} /><StatCard icon={AlertTriangle} label={dict.portal.refunded} value="0" /></div>
      <Card className="mt-6 overflow-hidden"><div className="overflow-x-auto"><table className="w-full min-w-[700px] text-sm"><thead className="bg-slate-50 text-xs text-muted"><tr><th className="p-4 text-start">{dict.common.service}</th><th className="p-4 text-start">{dict.common.status}</th><th className="p-4 text-start">{dict.common.date}</th><th className="p-4 text-end">{dict.common.amount}</th></tr></thead><tbody className="divide-y divide-line">{held.map((booking) => <tr key={booking.id}><td className="p-4 font-medium text-navy">{getService(booking.serviceSlug)?.name[locale]}</td><td className="p-4"><StatusBadge status={booking.paymentStatus} label={dict.portal.held} /></td><td className="p-4 text-secondary">{formatDateTime(booking.scheduledStart, locale)}</td><td className="p-4 text-end font-semibold text-navy">{formatMoney(booking.quotedPaisa, locale)}</td></tr>)}</tbody></table></div></Card>
    </div>
  );
}
