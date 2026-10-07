'use client';

import { Activity } from 'lucide-react';
import Link from 'next/link';
import { Button, Card, PageHeader } from '@/components/ui';
import { useAdminProviders, useAdminUsers } from '@/features/admin/queries';
import { useComplaintQueue, useDisputes, usePenalties } from '@/features/admin/cases-queries';
import { ApiError } from '@/lib/api/problem';
import type { Dictionary } from '@/lib/dictionaries';
import { formatNumber, localizedPath, type Locale } from '@/lib/utils';

/* The operations board — the live queue, from the queues themselves.
 *
 * **Every number here is a count of rows the screen actually holds**, taken from
 * the same endpoint the corresponding screen uses. Nothing is a stored total and
 * nothing is summed across endpoints the API does not offer: a "platform-wide
 * bookings today" tile would need an admin bookings list, and `GET /admin/bookings`
 * does not exist, so the board reports what it can count and names what it cannot.
 *
 * The previous version of this screen printed a lane for every booking status —
 * REQUESTED / SCHEDULED / IN_PROGRESS / VERIFICATION / DISPUTED — with invented
 * counts, on the strength of a "live bookings" figure the API has no route for.
 * A lane of five made-up numbers is worse than four real ones, because it looks
 * like the whole platform is being watched. */

/** Bounded: the queues are the authority and they answer up to 200 rows. */
const COUNT_CEILING = 200;

export function AdminOps({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const complaints = useComplaintQueue({}, locale);
  const disputes = useDisputes(undefined, locale);
  const penalties = usePenalties({}, locale);

  const complaintRows = complaints.data?.items ?? [];
  const disputeRows = disputes.data?.items ?? [];
  const penaltyRows = penalties.data?.items ?? [];

  const counts = [
    { label: dict.admin.openComplaints, value: complaintRows.filter((row) => row.status === 'OPEN').length, tone: 'rose' },
    { label: dict.admin.safetyComplaints, value: complaintRows.filter((row) => row.severity === 'SAFETY' && row.status !== 'RESOLVED' && row.status !== 'REJECTED').length, tone: 'rose' },
    { label: dict.admin.slaBreaches, value: complaintRows.filter((row) => row.slaBreached).length, tone: 'rose' },
    { label: dict.admin.openDisputes, value: disputeRows.filter((row) => row.status !== 'RESOLVED').length, tone: 'amber' },
    { label: dict.admin.proposedPenalties, value: penaltyRows.filter((row) => row.status === 'PROPOSED').length, tone: 'amber' },
    { label: dict.admin.appliedPenalties, value: penaltyRows.filter((row) => row.status === 'APPLIED').length, tone: 'amber' }
  ];

  const anyError = complaints.error ?? disputes.error ?? penalties.error;
  const forbidden = anyError instanceof ApiError && anyError.status === 403;

  return (
    <div>
      <PageHeader eyebrow={dict.portal.admin} title={dict.admin.ops} description={dict.admin.opsText} />

      {forbidden ? (
        <div role="alert" className="mt-6 rounded-[14px] border border-rose-200 bg-rose-50 p-5">
          <p className="text-sm font-medium leading-6 text-rose-800">{dict.admin.adminTotpRequired}</p>
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {counts.map((entry) => (
          <Card key={entry.label} className="p-5">
            <p className="text-sm text-muted">{entry.label}</p>
            <p className={entry.tone === 'rose' && entry.value > 0 ? 'mt-2 text-3xl font-semibold text-rose-700 tabular-nums' : 'mt-2 text-3xl font-semibold text-navy tabular-nums'}>
              {formatNumber(entry.value, locale)}
            </p>
          </Card>
        ))}
      </div>

      <Card className="mt-5 p-5">
        <h2 className="flex items-center gap-2 font-semibold text-navy">
          <Activity className="size-4 text-muted" aria-hidden="true" />
          {dict.admin.countsAreFromQueues}
        </h2>
        <p className="mt-2 text-sm leading-6 text-secondary">{dict.admin.countsNote}</p>
        <p className="mt-2 text-sm leading-6 text-secondary">{dict.admin.opsNoBookingTotals}</p>
        {complaintRows.length >= COUNT_CEILING ? (
          /* The queue caps at 200 rows server-side, so past that a count stops
             being a count and becomes a lower bound. Saying so is the difference
             between "46 open" and "at least 200 open". */
          <p className="mt-3 rounded-[9px] border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900">
            {dict.admin.countCeiling.replace('{limit}', formatNumber(COUNT_CEILING, locale))}
          </p>
        ) : null}
      </Card>

      {anyError !== undefined && !forbidden ? (
        <div role="alert" className="mt-5 rounded-[14px] border border-rose-200 bg-rose-50 p-5">
          <p className="text-sm font-medium leading-6 text-rose-800">{dict.admin.opsLoadError}</p>
          <Button type="button" variant="secondary" size="sm" className="mt-4" onClick={() => void complaints.refetch()}>
            {dict.catalogue.retry}
          </Button>
        </div>
      ) : null}

      <p className="mt-4 text-xs leading-5 text-muted">{dict.admin.opsNoFilterNote}</p>
    </div>
  );
}

/**
 * The `/admin` landing.
 *
 * The previous version of this page was the single worst offender in the admin
 * module: it printed total bookings, a professional count, a literal `"2"` for the
 * approval queue, and an escrow balance — every one of them from `src/lib/data.ts`.
 * "Held" and "released" money in particular were sums of invented quotes, on a page
 * whose job is to tell an administrator what is at risk.
 *
 * So the landing is now a **directory**: the counts it can honestly produce (the
 * queues above) plus links to the sections. It does not claim a bookings total or
 * an escrow balance, because there is no admin route for either — see
 * `docs/backend_requirement.md`.
 */
export function AdminOverview({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const complaints = useComplaintQueue({}, locale);
  const disputes = useDisputes(undefined, locale);
  const penalties = usePenalties({}, locale);
  const users = useAdminUsers({}, locale);
  const providers = useAdminProviders({}, locale);

  const complaintRows = complaints.data?.items ?? [];
  const disputeRows = disputes.data?.items ?? [];
  const penaltyRows = penalties.data?.items ?? [];

  const sections = [
    { href: '/admin/ops', label: dict.admin.ops, value: complaintRows.filter((row) => row.status === 'OPEN').length + disputeRows.filter((row) => row.status !== 'RESOLVED').length },
    { href: '/admin/complaints', label: dict.admin.complaints, value: complaintRows.filter((row) => row.slaBreached).length },
    { href: '/admin/disputes', label: dict.admin.disputes, value: disputeRows.filter((row) => row.status !== 'RESOLVED').length },
    { href: '/admin/penalties', label: dict.admin.penalties, value: penaltyRows.filter((row) => row.status === 'PROPOSED').length },
    { href: '/admin/providers', label: dict.admin.allProviders, value: providers.data?.items.length ?? null },
    { href: '/admin/customers', label: dict.admin.customers, value: users.data?.items.length ?? null }
  ];

  return (
    <div>
      <PageHeader eyebrow={dict.portal.admin} title={dict.portal.adminOverview} description={dict.admin.overviewText} />

      <Card className="mt-6 p-5">
        <h2 className="font-semibold text-navy">{dict.admin.overviewWhatIsMissing}</h2>
        <p className="mt-2 text-sm leading-6 text-secondary">{dict.admin.opsNoBookingTotals}</p>
        <p className="mt-1 text-sm leading-6 text-secondary">{dict.admin.overviewNoEscrow}</p>
      </Card>

      <ul className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {sections.map((section) => (
          <li key={section.href}>
            <Link href={localizedPath(locale, section.href)} className="flex items-center justify-between gap-3 rounded-[12px] border border-line bg-white p-5 transition hover:border-primary">
              <span className="text-sm font-semibold text-navy">{section.label}</span>
              {/* A dash, not a zero: a queue that failed to load has no count, and
                  "0" would read as "nothing to do". */}
              <span className="text-xl font-semibold text-navy tabular-nums">{section.value === null ? '—' : formatNumber(section.value, locale)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
