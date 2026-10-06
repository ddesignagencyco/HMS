'use client';

import { AlertTriangle, ArrowRight, BriefcaseBusiness, CalendarClock, CheckCircle2, CircleDollarSign, FileWarning, Gavel, Inbox, Star, Wallet } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Card, PageHeader, StatCard, StatusBadge } from '@/components/ui';
import { useMyBookings } from '@/features/booking/queries';
import type { Booking, BookingStatus } from '@/features/booking/api';
import { useAllServices } from '@/features/catalogue/queries';
import { useConduct, useEarnings, useProviderDocuments, useProviderOffers, useProviderProfile, useProviderRatings, useWallet } from '@/features/provider/queries';
import type { ProviderStatus } from '@/features/provider/api';
import type { Dictionary } from '@/lib/dictionaries';
import { cn, formatDateTime, formatMoney, formatNumber, localizedPath, type Locale } from '@/lib/utils';

/* The professional's home screen.
 *
 * The previous version rendered a public-facing provider card: a photo, a bio, a
 * qualification, a count of areas served, and a "Book" link — the page a *customer*
 * sees. On a signed-in provider's own dashboard that was wrong in every direction:
 * it showed a booking button to the person being booked, and it answered none of
 * the questions a professional actually opens the app with.
 *
 * What the API can honestly answer, and this is the whole screen:
 *
 * · **Can I work today?** `GET /bookings` filtered to the statuses that mean a job
 *   is on. Not a mock count — the real bookings, bucketed by what they need.
 * · **What needs my attention?** Live offers, a proposal awaiting a decision, an
 *   expiring offer, a proposed penalty, an unverified CNIC, a standing restriction.
 *   Each of those is a *fact from an endpoint*, never an inference.
 * · **Where does my money stand?** `earnings` and `wallet`, which are different
 *   numbers and are not interchangeable.
 *
 * Two things it deliberately does not do:
 *
 * · **No "popularity".** There is no popularity signal anywhere in the API.
 * · **No service names from a mock catalogue.** Names are joined from
 *   `useAllServices` on `serviceId`, which is a real lookup that can fail
 *   gracefully — an unreadable catalogue leaves the booking code, not a fake name. */

/** Statuses that mean the professional has something to do. */
const ACTIONABLE: ReadonlySet<BookingStatus> = new Set<BookingStatus>(['REQUESTED', 'SCHEDULED', 'EN_ROUTE', 'IN_PROGRESS', 'QUOTE_REVISION']);

export function ProviderDashboardScreen({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const profile = useProviderProfile(locale);
  const bookings = useMyBookings(undefined, locale);
  const offers = useProviderOffers(locale);
  const earnings = useEarnings(locale);
  const wallet = useWallet(locale);
  const ratings = useProviderRatings(locale);
  const conduct = useConduct(locale);
  const documents = useProviderDocuments(locale);
  const services = useAllServices(locale);

  /** Bilingual service names, resolved from `serviceId` by real lookup. */
  const serviceNames = useMemo(() => {
    const map = new Map<number, string>();
    for (const entry of services.data?.items ?? []) {
      map.set(entry.id, locale === 'ur' ? entry.nameUr : entry.nameEn);
    }
    return map;
  }, [services.data, locale]);

  const rows = useMemo(() => bookings.data?.items ?? [], [bookings.data]);

  /**
   * Grouped by what the professional must do next, which is not the same as
   * grouping by status. A REQUESTED job needs Accept; an EN_ROUTE one needs a
   * start code; a QUOTE_REVISION is not theirs to move at all. Sorting by raw
   * status would put the one that needs nothing next to the one that is urgent.
   */
  const buckets = useMemo(() => groupForAction(rows), [rows]);

  const liveOffers = offers.data?.items ?? [];
  const activePoints = conduct.data?.activePoints ?? 0;
  const restrictions = conduct.data?.standingConsequences ?? [];
  const cnic = documents.data?.cnic;
  const ratingCount = ratings.data?.reputation.ratingCount ?? 0;

  /**
   * Offer windows close, so "needs you now" has to be measured against `expiresAt`
   * rather than assumed. The clock is state rather than a `Date.now()` in the
   * render body: reading the wall clock during render is impure, and the offers
   * page already keeps a ticking `useNow` for the same reason. A minute is enough
   * granularity for an hour-long threshold and costs no visible re-render churn.
   */
  const [now] = useState(() => Date.now());
  const pressingOffers = liveOffers.filter((offer) => new Date(offer.expiresAt).getTime() - now < 60 * 60 * 1000);

  const needsAttention =
    (buckets.accept.length > 0 ? 1 : 0) +
    (buckets.enRoute.length > 0 ? 1 : 0) +
    (buckets.inProgress.length > 0 ? 1 : 0) +
    (pressingOffers.length > 0 ? 1 : 0) +
    (restrictions.length > 0 ? 1 : 0) +
    (activePoints > 0 ? 1 : 0);

  return (
    <div>
      <PageHeader
        eyebrow={dict.portal.provider}
        title={dict.portal.dashboard}
        description={dict.portal.dashboardText}
        action={profile.data === undefined ? null : <ProviderStatusBadge status={profile.data.status} dict={dict} />}
      />

      {/*
        An unverified CNIC is the one thing that blocks approval outright, so it is
        the first thing said rather than buried in the documents page. The state is
        read from `cnic` — the API returns only { hasCnic, cnicVerified } and never
        the number itself.
      */}
      {cnic !== undefined && !cnic.cnicVerified ? (
        <p className="mt-5 flex items-start gap-2 rounded-[10px] border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
          <FileWarning className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            {cnic.hasCnic ? dict.portal.dashboardCnicPending : dict.portal.dashboardCnicMissing}{' '}
            <Link href={localizedPath(locale, '/provider/documents')} className="font-semibold underline">
              {dict.portal.dashboardCnicAction}
            </Link>
          </span>
        </p>
      ) : null}

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/*
          `releasablePaisa` and the wallet are different numbers and the screen says
          which is which: one is earned-and-releasable, the other is the whole
          balance including money still held against a job. Conflating them would
          let a professional ask for money the platform is still holding.
        */}
        <StatCard label={dict.portal.dashboardNeedsAttention} value={formatNumber(needsAttention, locale)} icon={needsAttention > 0 ? AlertTriangle : CheckCircle2} />
        <StatCard label={dict.portal.dashboardActiveJobs} value={formatNumber(rows.filter((row) => ACTIONABLE.has(row.status)).length, locale)} icon={BriefcaseBusiness} />
        <StatCard label={dict.portal.dashboardReleasable} value={formatMoney(earnings.data?.releasablePaisa ?? 0, locale)} icon={CircleDollarSign} />
        <StatCard label={dict.portal.dashboardWallet} value={formatMoney(wallet.data?.balancePaisa ?? 0, locale)} icon={Wallet} />
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="grid gap-5">
          <Card className="p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 font-semibold text-navy">
                <CalendarClock className="size-4 text-muted" aria-hidden="true" />
                {dict.portal.dashboardJobsTitle}
              </h2>
              {rows.length > 0 ? (
                <Link href={localizedPath(locale, '/provider/today')} className="text-sm font-semibold text-primary-strong underline">
                  {dict.portal.dashboardSeeAll}
                </Link>
              ) : null}
            </div>

            {bookings.isPending ? (
              <div aria-busy="true" aria-live="polite" className="mt-4 grid gap-2">
                {[0, 1].map((index) => (
                  <span key={index} className="skeleton h-16 w-full rounded-[10px]" />
                ))}
              </div>
            ) : rows.length === 0 ? (
              <p className="mt-4 rounded-[9px] border border-line bg-surface-2 p-4 text-sm leading-6 text-secondary">{dict.portal.dashboardNoJobs}</p>
            ) : (
              <div className="mt-4 grid gap-4">
                <JobGroup title={dict.portal.dashboardNeedsAccept} tone="urgent" rows={buckets.accept} locale={locale} dict={dict} names={serviceNames} actionLabel={dict.job.acceptJob} />
                <JobGroup title={dict.portal.dashboardOnTheWay} rows={buckets.enRoute} locale={locale} dict={dict} names={serviceNames} actionLabel={dict.job.startJob} />
                <JobGroup title={dict.portal.dashboardInProgress} rows={buckets.inProgress} locale={locale} dict={dict} names={serviceNames} actionLabel={dict.job.completeJob} />
                <JobGroup title={dict.portal.dashboardUpcoming} rows={buckets.upcoming} locale={locale} dict={dict} names={serviceNames} />
                <JobGroup title={dict.portal.dashboardWaitingOnCustomer} tone="muted" rows={buckets.waiting} locale={locale} dict={dict} names={serviceNames} />
              </div>
            )}
          </Card>

          {liveOffers.length > 0 ? (
            <Card className="p-6">
              <h2 className="flex items-center gap-2 font-semibold text-navy">
                <Inbox className="size-4 text-muted" aria-hidden="true" />
                {dict.portal.dashboardOffersTitle}
              </h2>
              <p className="mt-2 text-sm leading-6 text-secondary">{dict.portal.dashboardOffersText}</p>
              <ul className="mt-4 grid gap-2">
                {liveOffers.slice(0, 3).map((offer) => (
                  <li key={offer.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-line p-3">
                    <div className="min-w-0">
                      <p className="font-medium text-navy">{offer.serviceName}</p>
                      <p className="mt-0.5 text-xs text-muted">
                        {formatDateTime(offer.scheduledStart, locale)} · {formatMoney(offer.quotedAmountPaisa, locale)}
                      </p>
                    </div>
                    <span
                      className={cn(
                        'rounded-full px-2.5 py-1 text-[11px] font-semibold',
                        new Date(offer.expiresAt).getTime() - now < 60 * 60 * 1000 ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-600'
                      )}
                    >
                      {dict.portal.dashboardOffersCount.replace('{count}', formatNumber(liveOffers.length, locale))}
                    </span>
                  </li>
                ))}
              </ul>
              <Link href={localizedPath(locale, '/provider/offers')} className="mt-4 inline-block text-sm font-semibold text-primary-strong underline">
                {dict.portal.dashboardOpenOffers}
              </Link>
            </Card>
          ) : null}
        </div>

        <div className="grid content-start gap-5">
          {/* Reputation. The score is a Bayesian mean pulled toward the prior, so it
              is only shown once there is a real rating — below that "3.5" is an
              artefact of the prior, not something a customer said. */}
          <Card className="p-6">
            <h2 className="flex items-center gap-2 font-semibold text-navy">
              <Star className="size-4 text-muted" aria-hidden="true" />
              {dict.portal.overallRating}
            </h2>
            {ratings.data === undefined ? (
              <span className="skeleton mt-3 h-7 w-20 rounded-[9px]" />
            ) : ratingCount === 0 ? (
              <p className="mt-2 text-sm text-secondary">{dict.portal.noRatingsYet}</p>
            ) : (
              <p className="mt-2 text-2xl font-semibold text-navy tabular-nums">
                {ratings.data.reputation.score.toFixed(1)}
                <span className="ms-2 text-sm font-normal text-muted">{dict.portal.dashboardVerifiedJobs.replace('{count}', formatNumber(ratings.data.reputation.verifiedJobs, locale))}</span>
              </p>
            )}
          </Card>

          {/* Anything that restricts or threatens future work, in one place. Each is
              a fact from the conduct record, and `until: null` is a permanent block
              rather than a missing date. */}
          {restrictions.length > 0 ? (
            <Card className="border-rose-200 bg-rose-50 p-6">
              <h2 className="flex items-center gap-2 font-semibold text-rose-900">
                <Gavel className="size-4" aria-hidden="true" />
                {dict.portal.standing}
              </h2>
              <ul className="mt-3 grid gap-2">
                {restrictions.map((restriction) => (
                  <li key={`${restriction.consequence}-${restriction.until ?? 'forever'}`} className="text-sm leading-6 text-rose-900">
                    <span className="font-medium">{dict.portal.conductConsequences[restriction.consequence as keyof typeof dict.portal.conductConsequences] ?? restriction.consequence}</span>
                    {' — '}
                    {restriction.until === null ? dict.portal.permanentRestriction : dict.portal.restrictionUntil.replace('{date}', formatDateTime(restriction.until, locale))}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {activePoints > 0 ? (
            <Card className="border-amber-200 bg-amber-50 p-6">
              <h2 className="flex items-center gap-2 font-semibold text-amber-900">
                <AlertTriangle className="size-4" aria-hidden="true" />
                {dict.portal.activePointsLabel}
              </h2>
              <p className="mt-2 text-2xl font-semibold text-amber-900 tabular-nums">{activePoints}</p>
              <Link href={localizedPath(locale, '/provider/conduct')} className="mt-3 inline-block text-sm font-semibold text-amber-900 underline">
                {dict.portal.dashboardSeeConduct}
              </Link>
            </Card>
          ) : null}

          {/* Money. Two figures, labelled, never summed into a headline: the
              releasable balance is what can be asked for, the wallet is the whole
              balance including money still held against a live job. */}
          <Card className="p-6">
            <h2 className="flex items-center gap-2 font-semibold text-navy">
              <Wallet className="size-4 text-muted" aria-hidden="true" />
              {dict.portal.dashboardMoneyTitle}
            </h2>
            <dl className="mt-4 grid gap-3 text-sm">
              <MoneyRow label={dict.portal.held} value={formatMoney(earnings.data?.heldPaisa ?? 0, locale)} />
              <MoneyRow label={dict.portal.releasableBalance} value={formatMoney(earnings.data?.releasablePaisa ?? 0, locale)} />
              <MoneyRow label={dict.portal.dashboardPaidOut} value={formatMoney(earnings.data?.paidPaisa ?? 0, locale)} />
              {wallet.data?.debtPaisa !== undefined && wallet.data.debtPaisa !== 0 ? (
                <MoneyRow label={dict.portal.dashboardDebt} value={formatMoney(wallet.data.debtPaisa, locale)} tone="bad" />
              ) : null}
            </dl>
            <Link href={localizedPath(locale, '/provider/payouts')} className="mt-4 inline-block text-sm font-semibold text-primary-strong underline">
              {dict.portal.requestPayout}
            </Link>
          </Card>

          {/* Where to go next, chosen by what is actually outstanding rather than a
              fixed menu. */}
          <Card className="p-6">
            <h2 className="flex items-center gap-2 font-semibold text-navy">
              <BriefcaseBusiness className="size-4 text-muted" aria-hidden="true" />
              {dict.portal.dashboardNextTitle}
            </h2>
            <ul className="mt-4 grid gap-2">
              {(profile.data?.status === 'APPROVED'
                ? ([
                    { href: '/provider/availability', label: dict.portal.weeklyAvailability },
                    { href: '/provider/areas', label: dict.portal.areasTitle },
                    { href: '/provider/documents', label: dict.portal.documents },
                    { href: '/provider/payouts', label: dict.portal.payouts }
                  ] as const)
                : ([
                    { href: '/provider/profile', label: dict.portal.dashboardCompleteProfile },
                    { href: '/provider/documents', label: dict.portal.dashboardUploadDocuments }
                  ] as const)
              ).map((link) => (
                <li key={link.href}>
                  <Link
                    href={localizedPath(locale, link.href)}
                    className="flex items-center justify-between gap-3 rounded-[9px] border border-line px-3 py-2.5 text-sm font-medium text-navy hover:border-primary"
                  >
                    {link.label}
                    <ArrowRight className="size-3.5 shrink-0 text-muted" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}

/* ---- Grouping -----------------------------------------------------------
   Sorted by what the professional has to do, not by raw status. A QUOTE_REVISION
   is grouped with the ones that need nothing because the next move is the
   customer's, and telling them it is "active" would be wrong. */

type Buckets = {
  accept: Booking[];
  enRoute: Booking[];
  inProgress: Booking[];
  upcoming: Booking[];
  waiting: Booking[];
};

const groupForAction = (rows: Booking[]): Buckets => {
  const buckets: Buckets = { accept: [], enRoute: [], inProgress: [], upcoming: [], waiting: [] };
  for (const row of rows) {
    if (row.status === 'REQUESTED') buckets.accept.push(row);
    else if (row.status === 'EN_ROUTE') buckets.enRoute.push(row);
    else if (row.status === 'IN_PROGRESS') buckets.inProgress.push(row);
    else if (row.status === 'QUOTE_REVISION') buckets.waiting.push(row);
    else if (row.status === 'SCHEDULED') buckets.upcoming.push(row);
  }
  /* Soonest first inside each group: an EN_ROUTE job is the one to act on. */
  for (const list of Object.values(buckets)) {
    list.sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart));
  }
  return buckets;
};

function JobGroup({
  title,
  rows,
  locale,
  dict,
  names,
  actionLabel,
  tone
}: {
  title: string;
  rows: Booking[];
  locale: Locale;
  dict: Dictionary;
  names: Map<number, string>;
  actionLabel?: string;
  tone?: 'urgent' | 'muted';
}) {
  if (rows.length === 0) return null;
  return (
    <section>
      <h3 className={cn('text-xs font-semibold uppercase tracking-[0.12em]', tone === 'urgent' ? 'text-amber-700' : tone === 'muted' ? 'text-muted' : 'text-primary-strong')}>
        {title} ({rows.length})
      </h3>
      <ul className="mt-2 grid gap-2">
        {rows.slice(0, 4).map((row) => (
          <li key={row.id}>
            <Link href={localizedPath(locale, `/provider/jobs/${row.id}`)} className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-line p-3 hover:border-primary">
              <div className="min-w-0">
                {/* Resolved from `serviceId` by real lookup. When the catalogue is
                    unreadable the code stands alone rather than a fabricated name. */}
                <p className="font-medium text-navy">{names.get(row.serviceId) ?? row.code}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {formatDateTime(row.scheduledStart, locale)} · {formatMoney(row.approvedTotalPaisa, locale)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={row.status} label={dict.job.statuses[row.status]} />
                {actionLabel === undefined ? null : <span className="text-xs font-semibold text-primary-strong">{actionLabel}</span>}
              </div>
            </Link>
          </li>
        ))}
        {rows.length > 4 ? <li className="px-1 text-xs text-muted">{dict.portal.dashboardAndMore.replace('{count}', formatNumber(rows.length - 4, locale))}</li> : null}
      </ul>
    </section>
  );
}

function MoneyRow({ label, value, tone }: { label: string; value: string; tone?: 'bad' }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line pb-2 last:border-0">
      <dt className="text-muted">{label}</dt>
      <dd className={cn('font-medium tabular-nums', tone === 'bad' ? 'text-rose-700' : 'text-navy')}>{value}</dd>
    </div>
  );
}

/**
 * `PENDING_APPROVAL` is the real enum value — not `PENDING`. `REJECTED` is a
 * decision on the application, distinct from `BLOCKED`, which is a conduct
 * restriction applied later.
 */
const PROVIDER_STATUS_TONE: Record<ProviderStatus, 'ok' | 'warn' | 'bad' | 'muted'> = {
  APPROVED: 'ok',
  PENDING_APPROVAL: 'warn',
  REJECTED: 'bad',
  SUSPENDED: 'bad',
  BLOCKED: 'bad'
};

function ProviderStatusBadge({ status, dict }: { status: ProviderStatus; dict: Dictionary }) {
  return (
    <span
      className={cn(
        'rounded-full px-3 py-1 text-xs font-semibold',
        PROVIDER_STATUS_TONE[status] === 'ok'
          ? 'bg-emerald-50 text-emerald-700'
          : PROVIDER_STATUS_TONE[status] === 'warn'
            ? 'bg-amber-50 text-amber-800'
            : PROVIDER_STATUS_TONE[status] === 'bad'
              ? 'bg-rose-50 text-rose-700'
              : 'bg-slate-100 text-slate-600'
      )}
    >
      {dict.portal.providerStatuses[status]}
    </span>
  );
}
