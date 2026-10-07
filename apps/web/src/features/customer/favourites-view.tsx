'use client';

import { HeartOff, Search } from 'lucide-react';
import Link from 'next/link';
import { ButtonLink, Card, PageHeader } from '@/components/ui';
import type { Dictionary } from '@/lib/dictionaries';
import { localizedPath, type Locale } from '@/lib/utils';

/* Saved professionals.
 *
 * **There is no backend for this screen.** `favourites` is a real, migrated table
 * — `@@id([customer_id, provider_id])`, joined to both parties — and
 * `grep -ri favourite apps/api/src` returns zero. No service, no controller, no
 * module. So a customer cannot save a professional today, and nothing the web app
 * renders can change that.
 *
 * The choice here is between three things, and two of them are wrong:
 *
 *   · a list of professionals with hearts, which would be a favourites list that
 *     silently discards every tap;
 *   · a list from `GET /search/providers`, which is not favourites at all and
 *     would show the same professionals every time, implying they were saved;
 *   · this.
 *
 * A heart that does not save is worse than no heart: the customer believes they
 * have a shortlist, come back to find it empty, and conclude the platform lost
 * their data. So the screen states the absence and points somewhere useful.
 *
 * The requirement is written up in `docs/backend_requirement.md` §3.12: three
 * routes, with `GET` returning enough to render a card rather than a column of
 * UUIDs, `POST` idempotent because the composite primary key already makes it so,
 * and `DELETE` keyed on `providerId` because the table has no surrogate id. */

export function CustomerFavouritesScreen({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  return (
    <div>
      <PageHeader eyebrow={dict.portal.customer} title={dict.portal.favourites} description={dict.portal.favouritesDescription} />

      <Card className="mt-6 border-dashed px-6 py-14 text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-full bg-surface-2 text-muted" aria-hidden="true">
          <HeartOff className="size-6" />
        </span>
        <h2 className="mt-4 font-semibold text-navy">{dict.portal.favouritesUnavailableTitle}</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-secondary">{dict.portal.favouritesUnavailableText}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <ButtonLink href={localizedPath(locale, '/providers')}>
            <Search className="size-4" aria-hidden="true" />
            {dict.portal.browseProviders}
          </ButtonLink>
          {/* A search for someone already half-decided is more useful than the
              general directory, so both are offered. */}
          <Link
            href={localizedPath(locale, '/services')}
            className="inline-flex min-h-11 items-center rounded-[9px] border border-line bg-white px-4 text-sm font-medium text-navy hover:border-primary"
          >
            {dict.portal.browseServices}
          </Link>
        </div>
      </Card>

      <p className="mt-4 text-xs leading-5 text-muted">{dict.portal.favouritesNote}</p>
    </div>
  );
}
