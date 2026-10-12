'use client';

import { BarChart3, Info } from 'lucide-react';
import { ButtonLink, Card, PageHeader } from '@/components/ui';
import type { Dictionary } from '@/lib/dictionaries';
import { localizedPath, type Locale } from '@/lib/utils';

/* `/admin/reports` — still **no backend at all**.
 *
 * The screen used to print a revenue chart, a services-by-category
 * table, a "provider performance" leaderboard and a "completed jobs"
 * figure, all from `src/lib/data.ts`. There is no reporting route in
 * `apps/api/src` — not `GET /admin/reports`, not a chart endpoint, not
 * an aggregate, and the tracker's SHM-090 (Reports with PDF & XLSX) is
 * still `TODO`. The numbers described no transaction that had happened.
 *
 * The operations board counts the queues it actually holds, which is the
 * honest version of "live activity", and this screen points there rather
 * than pretending to replace it. The requirement is written up in
 * `apps/web/docs/backend_requirement.md`.
 *
 * **`/admin/plans` used to live in this file too**, on the grounds that
 * four plan tables existed that no route touched. SHM-089 added
 * `PlansAdminController`, so that screen now reads
 * `/admin/plans/*` for real and has moved to
 * `features/plans/admin-plans-view.tsx`. Only the genuine gap is left
 * here. */

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