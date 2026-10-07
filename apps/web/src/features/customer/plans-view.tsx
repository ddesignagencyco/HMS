'use client';

import { CreditCard, Info } from 'lucide-react';
import Link from 'next/link';
import { ButtonLink, Card, PageHeader } from '@/components/ui';
import type { Dictionary } from '@/lib/dictionaries';
import { localizedPath, type Locale } from '@/lib/utils';

/* Your maintenance plan.
 *
 * **There is no backend for this screen either.** Four tables exist and are fully
 * migrated — `plans` (with `name_en` and `name_ur`, a price and a duration),
 * `subscriptions` (status, `starts_at`, `ends_at`, `cancelled_at`, `address_id`,
 * a nullable `preferred_provider_id`), `plan_visits` and `plan_services`. Not one
 * is read or written anywhere in `apps/api/src`: there is no
 * `SubscriptionModule` in `app.module.ts` and no controller with a plan or
 * subscription route.
 *
 * The web app had a `/plans` public page and this screen, both of which could
 * only show invented prices and invented visit allowances.
 *
 * **That is the thing not to do here.** A plan card showing "Rs 2,999 / month,
 * 4 visits included" is not a harmless placeholder: it is a specific, confident,
 * wrong number, and a customer could reasonably book against it or hold the
 * platform to it. The same applies to the public `/plans` page — the requirement
 * is written up in `docs/backend_requirement.md` §3.13, and it asks for a public
 * catalogue route precisely so that page can be fed from one source rather than
 * from a dictionary.
 *
 * So this screen states the absence, names what is missing, and sends the customer
 * to services they can actually buy today. */

export function CustomerPlansScreen({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  return (
    <div>
      <PageHeader eyebrow={dict.portal.customer} title={dict.portal.plans} description={dict.portal.plansDescription} />

      <Card className="mt-6 border-dashed px-6 py-14 text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-full bg-surface-2 text-muted" aria-hidden="true">
          <CreditCard className="size-6" />
        </span>
        <h2 className="mt-4 font-semibold text-navy">{dict.portal.plansUnavailableTitle}</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-secondary">{dict.portal.plansUnavailableText}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <ButtonLink href={localizedPath(locale, '/services')}>{dict.portal.browseServices}</ButtonLink>
          <ButtonLink href={localizedPath(locale, '/providers')} variant="secondary">
            {dict.portal.browseProviders}
          </ButtonLink>
        </div>
      </Card>

      <p className="mt-4 flex items-start gap-2 text-xs leading-5 text-muted">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        {dict.portal.plansNote}
      </p>
    </div>
  );
}
