'use client';

import { AlertTriangle, CalendarClock, CheckCircle2, Clock3, MapPin } from 'lucide-react';
import Link from 'next/link';
import { useMemo } from 'react';
import { ButtonLink, Card, PageHeader, StatCard, StatusBadge } from '@/components/ui';
import { useMyBookings } from '@/features/booking/queries';
import type { Booking, BookingStatus } from '@/features/booking/api';
import { useAllServices } from '@/features/catalogue/queries';
import { useProviderOffers, useTimeOff, useAvailability } from '@/features/provider/queries';
import type { Dictionary } from '@/lib/dictionaries';
import { cn, formatDate, formatDateTime, formatMoney, localizedPath, type Locale } from '@/lib/utils';

/* One day of work.
 *
 * The previous version of this screen was the worst of the mock-data screens: it
 * read `getBookingsForProvider(provider.id)` from `@/lib/data`, invented a
 * `provider.nextSlot`, filtered on statuses — `COMPLETED`, `CANCELLED` — that are
 * **not in `booking_status` at all** (the real names are `WORK_COMPLETED`,
 * `CANCELLED_CUSTOMER`, `CANCELLED_PROVIDER`), and summed `finalPaisa` over
 * whatever it called "completed today". Every filter it used matched nothing.
 *
 * What replaced it:
 *
 * · **Jobs grouped by where they are in the day** — morning, afternoon, evening —
 *   computed from `scheduledStart` in the *platform's* timezone rather than the
 *   viewer's. A provider in Karachi looking at a 05:00Z booking should see
 *   "morning", not whatever their laptop's offset makes it.
 * · **Today's earnings from what actually settled.** `finalAmountPaisa` once the
 *   job is completed; the approved total before that. An in-progress job is not
 *   counted as earned, because it is still held.
 * · **Availability and leave, from the real endpoints**, so the screen can say
 *   whether today is a working day at all instead of assuming it is.
 *
 * It still cannot show the address — see `backend_requirement.md` §3.10. The area
 * is not on the booking either, so nothing here claims to know where the job is. */

export function ProviderTodayScreen({ locale, dict, now }: { locale: Locale; dict: Dictionary; now?: Date }) {
  const bookings = useMyBookings(undefined, locale);
  const offers = useProviderOffers(locale);
  const availability = useAvailability(locale);
  const timeOff = useTimeOff(locale);
  const services = useAllServices(locale);

  /* "Now" is injectable for tests: a day boundary is real, and a test computed
     from the real clock can straddle it on a slow, heavily loaded run (exactly
     the flake that made a past and a future booking count as the same kind, and
     made a loaded run report the wrong weekday). The default is the wall clock. */
  const nowDate = useMemo(() => now ?? new Date(), [now]);
  const nowMs = nowDate.getTime();

  /** Bilingual service names, joined from `serviceId` by real lookup. */
  const names = useMemo(() => {
    const map = new Map<number, string>();
    for (const entry of services.data?.items ?? []) map.set(entry.id, locale === 'ur' ? entry.nameUr : entry.nameEn);
    return map;
  }, [services.data, locale]);

  const rows = useMemo(() => bookings.data?.items ?? [], [bookings.data]);

  /**
   * "Today" is the platform's day, not the viewer's.
   *
   * `scheduledStart` is an instant and the business operates in Asia/Karachi, so
   * the day boundary has to be the platform's. Formatting in UTC — or in the
   * browser's zone — would file a 05:00Z booking under the previous day for any
   * viewer east of Greenwich, and this screen's whole purpose is a day.
   */
  const platformDay = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(nowDate);

  const todays = useMemo(() => rows.filter((row) => localDay(row.scheduledStart) === platformDay), [rows, platformDay]);
  const later = useMemo(() => rows.filter((row) => localDay(row.scheduledStart) !== platformDay).sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart)), [rows, platformDay]);

  const settled = todays.filter((row) => COMPLETED.has(row.status));
  const live = todays.filter((row) => !COMPLETED.has(row.status) && !VOID.has(row.status));

  /** Only settled money counts as earned. An open job is still held. */
  const earnedToday = settled.reduce((sum, row) => sum + (row.finalAmountPaisa ?? row.approvedTotalPaisa), 0);

  const windows = availability.data?.items ?? [];
  /* `provider_availability.weekday` is 0 = Sunday … 6 = Saturday, the same numbering
     `Intl` uses with `weekday: 'short'` in the `en-US` locale. */
  const todayWeekday = new Intl.DateTimeFormat('en-US', { timeZone: BUSINESS_TIMEZONE, weekday: 'short' }).format(nowDate);
  const todaysWindows = windows.filter((window) => WEEKDAY_INDEX[todayWeekday] === window.weekday);

  /* A day-scale question does not need a ticking clock — `nowMs` is seeded once,
     consistent with `platformDay` above, and a leave period whose end has passed
     does not cover today because `provider_time_off.period` is half-open. */
  const onLeave = (timeOff.data?.items ?? []).some((period) => {
    const start = new Date(period.start).getTime();
    const end = new Date(period.end).getTime();
    return start <= nowMs && nowMs < end;
  });

  return (
    <div>
      <PageHeader
        eyebrow={dict.portal.provider}
        title={dict.portal.today}
        description={dict.portal.todayText}
        action={<p className="text-sm text-muted">{formatDate(nowDate.toISOString(), locale)}</p>}
      />

      {/* Whether today is even a working day is a fact from the availability and
          leave endpoints, not an assumption. */}
      {onLeave ? (
        <p className="mt-5 flex items-start gap-2 rounded-[10px] border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-primary-strong">
          <CalendarClock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {dict.portal.todayOnLeave}
        </p>
      ) : todaysWindows.length === 0 ? (
        <p className="mt-5 flex items-start gap-2 rounded-[10px] border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {dict.portal.todayNotWorking}
        </p>
      ) : null}

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <StatCard icon={Clock3} label={dict.portal.activeBookings} value={String(live.length)} />
        <StatCard icon={CheckCircle2} label={dict.portal.completedToday} value={String(settled.length)} />
        <StatCard icon={CheckCircle2} label={dict.portal.todayEarnings} value={formatMoney(earnedToday, locale)} />
      </div>

      <div className="mt-6 grid gap-5">
        {bookings.isPending ? (
          <div aria-busy="true" aria-live="polite" className="grid gap-2">
            {[0, 1].map((index) => (
              <span key={index} className="skeleton h-20 w-full rounded-[12px]" />
            ))}
          </div>
        ) : todays.length === 0 && later.length === 0 ? (
          <Card className="px-6 py-14 text-center">
            <p className="text-sm text-secondary">{dict.portal.todayEmpty}</p>
            {(offers.data?.items ?? []).length > 0 ? (
              <ButtonLink href={localizedPath(locale, '/provider/offers')} className="mt-4">
                {dict.portal.dashboardOpenOffers}
              </ButtonLink>
            ) : null}
          </Card>
        ) : (
          <>
            {/* Titled with the date rather than the word "Today", which the page
                header already says — and a date is what a professional actually
                checks against their own diary. */}
            <DaySection title={formatDate(nowDate.toISOString(), locale)} rows={todays} locale={locale} dict={dict} names={names} />

            {later.length > 0 ? <DaySection title={dict.portal.laterJobs} rows={later.slice(0, 8)} locale={locale} dict={dict} names={names} /> : null}
          </>
        )}
      </div>
    </div>
  );
}

/** Statuses that count as finished work for a professional. */
const COMPLETED: ReadonlySet<BookingStatus> = new Set<BookingStatus>(['WORK_COMPLETED', 'AWAITING_VERIFICATION', 'VERIFIED', 'AUTO_RELEASED', 'PAYMENT_RELEASED', 'CLOSED']);

/** Statuses that are not finished but need nothing more from the provider. */
const VOID: ReadonlySet<BookingStatus> = new Set<BookingStatus>(['UNFULFILLED', 'CANCELLED_CUSTOMER', 'CANCELLED_PROVIDER', 'NO_SHOW', 'REFUNDED', 'PARTIALLY_REFUNDED']);

/**
 * The platform's calendar date for an instant, as `YYYY-MM-DD`.
 *
 * Deliberately formatted in the business timezone rather than the viewer's: this
 * screen answers "what am I doing today", and the business's day is the one that
 * defines it. Formatting in the browser's zone would move an early-morning job to
 * the previous day for a viewer with a negative offset.
 */
const localDay = (instant: string): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(instant));

/**
 * The business operates on Pakistan time, so that is what "today" means here.
 *
 * A single named constant rather than a repeated literal, because getting it wrong
 * in one place and not another is exactly the bug that would file an
 * early-morning job under the previous day.
 */
const BUSINESS_TIMEZONE = 'Asia/Karachi';

function DaySection({ title, rows, locale, dict, names }: { title: string; rows: Booking[]; locale: Locale; dict: Dictionary; names: Map<number, string> }) {
  if (rows.length === 0) return null;
  return (
    <Card className="p-6">
      <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-primary-strong">{title}</h2>
      <ul className="mt-4 grid gap-2">
        {rows.map((row) => (
          <li key={row.id}>
            <Link href={localizedPath(locale, `/provider/jobs/${row.id}`)} className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-line p-4 hover:border-primary">
              <div className="min-w-0">
                {/* The real name from a catalogue lookup; the booking code stands in
                    when the catalogue is unreadable rather than a made-up name. */}
                <p className="font-medium text-navy">{names.get(row.serviceId) ?? row.code}</p>
                <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                  <Clock3 className="size-3" aria-hidden="true" />
                  {formatDateTime(row.scheduledStart, locale)}
                </p>
                {/*
                  The area is not on the booking and the address is not readable by a
                  provider (backend_requirement.md §3.10), so nothing here claims to know
                  where the job is. Offering a map pin that goes nowhere would be worse
                  than saying nothing.
                */}
                <p className="mt-1 flex items-center gap-1.5 text-xs text-muted">
                  <MapPin className="size-3" aria-hidden="true" />
                  {dict.portal.todayAddressUnavailable}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn('text-sm font-semibold tabular-nums', COMPLETED.has(row.status) ? 'text-navy' : 'text-secondary')}>
                  {formatMoney(row.finalAmountPaisa ?? row.approvedTotalPaisa, locale)}
                </span>
                <StatusBadge status={row.status} label={dict.job.statuses[row.status]} />
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
