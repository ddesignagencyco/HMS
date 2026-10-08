'use client';

import { AlertTriangle, ClipboardCheck, ReceiptText, ShieldCheck, Wallet } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Card, PageHeader, StatCard, StatusBadge } from '@/components/ui';
import { useMyBookings } from '@/features/booking/queries';
import type { Booking, BookingStatus } from '@/features/booking/api';
import { useAllServices } from '@/features/catalogue/queries';
import { useMyComplaints } from '@/features/complaints/queries';
import type { Dictionary } from '@/lib/dictionaries';
import { formatDateTime, formatMoney, formatNumber, localizedPath, type Locale } from '@/lib/utils';

/* The customer's home screen.
 *
 * The previous version counted mock bookings against a **hardcoded date string**
 * — `bookings.filter((item) => item.scheduledStart >= "2026-09-25")` — which is a
 * number that stopped meaning anything the day it was written, and printed a
 * verification count of literally `"1"` because there was no source for it.
 *
 * Every figure here is now derived from two real reads: the customer's own
 * bookings, and their complaints.
 *
 * Two decisions worth stating:
 *
 * · **Money held is summed from the bookings that actually hold it.**
 *   `paymentStatus` is a string from the database, so it is matched against the
 *   statuses the API documents rather than guessed, and the figure is labelled as
 *   "held for your jobs" rather than presented as a balance — it is money the
 *   platform is holding, not the customer's.
 * · **A breached complaint SLA is counted, and said.** `slaRemainingMinutes` is a
 *   signed remainder and `slaBreached` is computed server-side, so the screen
 *   reports the platform's own verdict rather than recomputing a deadline.
 */

/** Statuses that mean the customer has a job they are waiting on. */
const LIVE: ReadonlySet<BookingStatus> = new Set<BookingStatus>(['REQUESTED', 'SCHEDULED', 'EN_ROUTE', 'IN_PROGRESS', 'QUOTE_REVISION']);

/** `payment_status` values that mean the platform is still holding the money. */
const HELD: ReadonlySet<string> = new Set(['HELD', 'PENDING', 'AUTHORIZED']);

export function CustomerDashboardScreen({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const bookings = useMyBookings(undefined, locale);
  const complaints = useMyComplaints(locale);
  const services = useAllServices(locale);

  /** Bilingual service names, joined from `serviceId` by real lookup. */
  const names = useMemo(() => {
    const map = new Map<number, string>();
    for (const entry of services.data?.items ?? []) map.set(entry.id, locale === 'ur' ? entry.nameUr : entry.nameEn);
    return map;
  }, [services.data, locale]);

  const rows = useMemo(() => bookings.data?.items ?? [], [bookings.data]);
  /* Reading the clock during render is impure, so it is seeded into state once. A
     day-scale question needs no ticker; what it must not do is depend on how long
     the component happened to be mounted before the bookings arrived, which is
     exactly what a `Date.now()` in the render body would give. */
  const [now] = useState(() => Date.now());

  const live = rows.filter((row) => LIVE.has(row.status));

  /** Later than now — the old screen compared against a literal date string. */
  const upcoming = rows.filter((row) => new Date(row.scheduledStart).getTime() >= now && LIVE.has(row.status));

  const heldPaisa = rows.filter((row) => HELD.has(row.paymentStatus)).reduce((sum, row) => sum + row.quotedAmountPaisa, 0);

  const raised = complaints.data?.items ?? [];
  /* `raisedBy` null means it came from the receipt link, where nobody signed in —
     those are still the customer's own complaints to see. */
  const mine = raised.filter((item) => item.raisedBy !== null);
  const breached = raised.filter((item) => item.slaBreached);

  return (
    <div>
      <PageHeader eyebrow={dict.portal.customer} title={dict.portal.customerDashboard} description={dict.portal.customerDashboardText} />

      {breached.length > 0 ? (
        <p className="mt-5 flex items-start gap-2 rounded-[10px] border border-rose-200 bg-rose-50 p-4 text-sm leading-6 text-rose-800">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {dict.portal.complaintSlaBreached.replace('{count}', formatNumber(breached.length, locale))}
        </p>
      ) : null}

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={ClipboardCheck} label={dict.portal.activeBookings} value={formatNumber(live.length, locale)} />
        <StatCard icon={Wallet} label={dict.portal.upcomingVisits} value={formatNumber(upcoming.length, locale)} />
        {/* Money the platform is holding, not a balance the customer can spend. */}
        <StatCard icon={ReceiptText} label={dict.portal.heldForYourJobs} value={formatMoney(heldPaisa, locale)} />
        <StatCard icon={ShieldCheck} label={dict.portal.yourComplaints} value={formatNumber(mine.length, locale)} />
      </div>

      <Card className="mt-6 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-5">
          <h2 className="font-semibold text-navy">{dict.portal.activeBookings}</h2>
          {rows.length > 0 ? (
            <Link href={localizedPath(locale, '/account/bookings')} className="text-sm font-semibold text-primary-strong underline">
              {dict.portal.dashboardSeeAll}
            </Link>
          ) : null}
        </div>
        <BookingTable locale={locale} dict={dict} items={live.length === 0 ? [] : live} names={names} />
      </Card>

      {raised.length > 0 ? (
        <Card className="mt-5 p-6">
          <h2 className="font-semibold text-navy">{dict.portal.yourComplaints}</h2>
          <ul className="mt-4 grid gap-2">
            {raised.slice(0, 3).map((complaint) => (
              <li key={complaint.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-line p-3">
                <div className="min-w-0">
                  <p className="font-medium text-navy">{dict.portal.complaintCategories[complaint.category]}</p>
                  <p className="mt-0.5 line-clamp-1 text-xs text-muted">{complaint.description}</p>
                </div>
                <span className="shrink-0">
                  <StatusBadge status={complaint.status} label={dict.portal.complaintStatuses[complaint.status]} />
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

/**
 * The customer's bookings.
 *
* `GET /bookings` publishes ids only, not the readable names `GET /bookings/:id`
 * returns (recorded in `docs/backend_requirement.md`), so the service name is
 * joined here from the catalogue by `serviceId`, and the **booking code stands in
 * when the catalogue is unreadable**. Showing a made-up name would be worse than
 * showing a reference the customer can quote on the phone.
 *
 * There is deliberately no "re-book" column. The old screen linked to
 * `/book/[slug]?rebook=<id>`, and nothing ever reads `?rebook=`, so it was a
 * button that went to a fresh booking form having silently forgotten which
 * provider and service were being re-booked.
 */
export function BookingTable({ locale, dict, items, names, total = items.length }: { locale: Locale; dict: Dictionary; items: Booking[]; names: Map<number, string>; /** What the API returned in total, before the tabs split it. */ total?: number }) {
  if (items.length === 0) {
    /* Distinguishes "you have never booked" from "nothing in this tab".
       They used to share one sentence, so an account with four finished bookings
       opening on "In play" was told it had never booked anything — a false
       statement about real records. `total` is what the API returned; anything
       above zero means the tabs are what is empty, not the history. */
    return <p className="p-6 text-sm text-secondary">{total > 0 ? dict.portal.noBookingsInTab : dict.portal.noBookingsYet}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-start text-sm">
        <thead className="bg-slate-50 text-xs text-muted">
          <tr>
            <th scope="col" className="p-4 text-start font-medium">
              {dict.common.service}
            </th>
            <th scope="col" className="p-4 text-start font-medium">
              {dict.common.date}
            </th>
            <th scope="col" className="p-4 text-start font-medium">
              {dict.common.status}
            </th>
            <th scope="col" className="p-4 text-start font-medium">
              {dict.common.amount}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {items.map((booking) => (
            <tr key={booking.id} className="hover:bg-slate-50">
              <td className="p-4">
                <Link href={localizedPath(locale, `/account/bookings/${booking.id}`)} className="font-medium text-navy hover:text-primary-strong">
                  {names.get(booking.serviceId) ?? booking.code}
                </Link>
                <p className="mt-1 font-mono text-xs text-muted">{booking.code}</p>
              </td>
              <td className="p-4 text-secondary">{formatDateTime(booking.scheduledStart, locale)}</td>
              <td className="p-4">
                <StatusBadge status={booking.status} label={dict.bookingStatus[booking.status]} />
              </td>
              <td className="p-4 font-semibold text-navy tabular-nums">{formatMoney(booking.finalAmountPaisa ?? booking.approvedTotalPaisa, locale)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
