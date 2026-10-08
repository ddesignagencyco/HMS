'use client';

import Link from 'next/link';
import { BarChart3, CalendarRange, CreditCard, Info } from 'lucide-react';
import { ButtonLink, Card, PageHeader } from '@/components/ui';
import type { Dictionary } from '@/lib/dictionaries';
import { localizedPath, type Locale } from '@/lib/utils';

/* Reports and maintenance plans — the two admin screens with **no backend at all**.
 *
 * Both are named here in one file because the reason is the same and the reason is
 * the point: neither can show a number.
 *
 * `/admin/reports` used to print a revenue chart, a services-by-category table, a
 * "provider performance" leaderboard and a "completed jobs" figure, all from
 * `src/lib/data.ts`. There is no reporting route in `apps/api/src` — not
 * `GET /admin/reports`, not a chart endpoint, not an aggregate. The numbers it
 * showed described no transaction that had happened. The operations board now
 * counts the queues it actually holds, which is the honest version of "live
 * activity", and this screen does not pretend to replace it.
 *
 * `/admin/plans` had four fully migrated tables behind it (`plans`,
 * `subscriptions`, `plan_visits`, `plan_services`) and not one route that reads or
 * writes any of them. A plan card showing "Rs 2,999 / month, 4 visits included" is
 * a specific, confident, wrong number that an operator could act on.
 *
 * Both requirements are written up in `apps/web/docs/backend_requirement.md`. */

export function AdminReports({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  return (
    <div>
      <PageHeader eyebrow={dict.portal.admin} title={dict.admin.reports} description={dict.admin.reportsText} />

      <Card className="mt-6 border-dashed px-6 py-14 text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-full bg-surface-2 text-muted" aria-hidden="true">
          <BarChart3 className="size-6" />
        </span>
        <h2 className="mt-4 font-semibold text-navy">{dict.admin.reportsUnavailableTitle}</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-secondary">{dict.admin.reportsUnavailableText}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <ButtonLink href={localizedPath(locale, '/admin')}>{dict.admin.goToOps}</ButtonLink>
          <ButtonLink href={localizedPath(locale, '/finance/ledger')} variant="secondary">
            {dict.admin.goToLedger}
          </ButtonLink>
        </div>
      </Card>

      <p className="mt-4 flex items-start gap-2 text-xs leading-5 text-muted">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        {dict.admin.reportsRequirement}
      </p>
    </div>
  );
}

export function AdminPlans({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  return (
    <div>
      <PageHeader eyebrow={dict.portal.admin} title={dict.portal.plans} description={dict.admin.plansText} />

      <Card className="mt-6 border-dashed px-6 py-14 text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-full bg-surface-2 text-muted" aria-hidden="true">
          <CreditCard className="size-6" />
        </span>
        <h2 className="mt-4 font-semibold text-navy">{dict.admin.adminPlansUnavailableTitle}</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-secondary">{dict.admin.adminPlansUnavailableText}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <ButtonLink href={localizedPath(locale, '/services')}>{dict.portal.browseServices}</ButtonLink>
        </div>
      </Card>

      <p className="mt-4 flex items-start gap-2 text-xs leading-5 text-muted">
        <CalendarRange className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        {dict.admin.adminPlansRequirement}
      </p>

      {/* A link the customer-side plan screen also carries, so the two agree. */}
      <p className="mt-3 text-xs text-muted">
        <Link href={localizedPath(locale, '/account/plans')} className="font-semibold text-primary-strong hover:underline">
          {dict.admin.customerPlansLink}
        </Link>
      </p>
    </div>
  );
}
