'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Heart, Loader2, Search, Trash2 } from 'lucide-react';
import { Button, Card, PageHeader } from '@/components/ui';
import { favouriteName } from '@/features/account/me-api';
import { useFavourites, useRemoveFavourite } from '@/features/account/me-queries';
import { detailOf, toastError, toastSuccess } from '@/features/auth/auth-feedback';
import { ApiError } from '@/lib/api/problem';
import type { Dictionary } from '@/lib/dictionaries';
import { formatDate, localizedPath, type Locale } from '@/lib/utils';

/* Saved professionals — `GET /me/favourites`, with `DELETE /me/favourites/:id`
   to remove one.
 *
 * **What this screen used to be.** It rendered a card saying saving a professional
 * was not available yet, and pointed at the directory. That was true when it was
 * written: the `favourites` table existed and nothing read it. `favourites.service.ts`
 * now reads and writes it, so the explanation became the wrong thing to show — a
 * shortlist the API supports, described as unsupported.
 *
 * **What a card here may claim.** `FavouriteItem` is exactly
 * `{ providerId, firstName, lastName, providerStatus, favouritedAt }`. There is no
 * rating, no area, no distance and no photograph in that row, so this screen shows
 * the name, the approval status and when you saved them, and links to the profile
 * for the rest. The earlier note promised a card "with their rating, area and
 * distance"; that promise was never backed by an endpoint and is not made here.
 *
 * **`providerStatus` is not decoration.** `POST /me/favourites/:id` requires
 * `APPROVED`, but the list does not filter on it — a professional suspended or
 * blocked after you saved them stays in the list. So the status is rendered from
 * the same `statusKeys` map the professional's own screens use, rather than every
 * row being presented as bookable. */

export function CustomerFavouritesScreen({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const favourites = useFavourites(locale);
  const remove = useRemoveFavourite(locale);
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);

  const confirmRemove = async (providerId: string): Promise<void> => {
    try {
      await remove.mutateAsync(providerId);
      setPendingRemove(null);
      toastSuccess(dict.portal.favouritesRemoved);
    } catch (error) {
      /* `DELETE` answers 400 when the row was already gone. That is the API being
         precise about a state this screen no longer has, so the list is re-read
         rather than the message being left standing above a row that remains. */
      if (error instanceof ApiError && error.status === 400) {
        setPendingRemove(null);
        void favourites.refetch();
        toastSuccess(dict.portal.favouritesRemoved);
        return;
      }
      toastError(detailOf(error, dict));
    }
  };

  if (favourites.isPending) {
    return (
      <div aria-busy="true" aria-live="polite" className="grid gap-4">
        <span className="skeleton h-8 w-48 rounded-[9px]" />
        <span className="skeleton h-28 w-full rounded-[12px]" />
        <span className="skeleton h-28 w-full rounded-[12px]" />
      </div>
    );
  }

  const items = favourites.data?.items ?? [];

  return (
    <div>
      <PageHeader
        eyebrow={dict.portal.customer}
        title={dict.portal.favourites}
        description={dict.portal.favouritesDescription}
        action={
          <Link
            href={localizedPath(locale, '/providers')}
            className="inline-flex min-h-11 items-center gap-2 rounded-[9px] border border-line px-4 text-sm font-semibold text-navy transition hover:border-slate-300"
          >
            <Search className="size-4" aria-hidden="true" />
            {dict.portal.browseProviders}
          </Link>
        }
      />

      {favourites.isError ? (
        <div role="alert" className="mt-6 rounded-[14px] border border-rose-200 bg-rose-50 p-5">
          <p className="text-sm font-medium leading-6 text-rose-800">{dict.portal.favouritesLoadError}</p>
          <Button type="button" variant="secondary" size="sm" className="mt-4" onClick={() => void favourites.refetch()}>
            {dict.catalogue.retry}
          </Button>
        </div>
      ) : items.length === 0 ? (
        <Card className="mt-6 border-dashed px-6 py-14 text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-full bg-surface-2 text-muted" aria-hidden="true">
            <Heart className="size-6" />
          </span>
          <h2 className="mt-4 font-semibold text-navy">{dict.portal.noFavourites}</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-secondary">{dict.portal.noFavouritesText}</p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <ButtonLinkProxy locale={locale} dict={dict} />
          </div>
        </Card>
      ) : (
        <ul className="mt-6 grid gap-4 md:grid-cols-2">
          {items.map((item) => {
            const name = favouriteName(item);
            const status = dict.portal.statusKeys[item.providerStatus as keyof typeof dict.portal.statusKeys] ?? null;
            return (
              <li key={item.providerId}>
                <Card className="flex h-full flex-col p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      {/* The name is what the API publishes here, unlike the public
                          provider search, which publishes no name at all. */}
                      <h2 className="font-semibold text-navy">{name === '' ? dict.profile.titleFallback : name}</h2>
                      <p className="mt-2 text-xs text-muted">{dict.portal.favouritesSavedOn.replace('{date}', formatDate(item.favouritedAt, locale))}</p>
                    </div>
                    {status !== null ? <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700">{status}</span> : null}
                  </div>

                  {/* The richer public profile is one link away rather than
                      summarised here from fields this response never had. */}
                  <Link href={localizedPath(locale, `/providers/${item.providerId}`)} className="mt-3 text-sm font-medium text-primary-strong hover:underline">
                    {dict.portal.favouritesBookAgo}
                  </Link>

                  <div className="mt-4 flex flex-wrap gap-2 pt-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-rose-700"
                      aria-expanded={pendingRemove === item.providerId}
                      onClick={() => setPendingRemove(pendingRemove === item.providerId ? null : item.providerId)}
                      aria-label={`${dict.portal.favouritesRemove}: ${name}`}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                      {dict.portal.favouritesRemove}
                    </Button>
                  </div>

                  {pendingRemove === item.providerId ? (
                    <div role="group" aria-label={dict.portal.favouritesRemove} className="mt-3 rounded-[9px] border border-rose-200 bg-rose-50 p-3">
                      <p className="text-sm leading-6 text-rose-800">{dict.portal.favouritesRemoveConfirm}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button type="button" size="sm" disabled={remove.isPending} onClick={() => void confirmRemove(item.providerId)}>
                          {remove.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                          {dict.portal.favouritesRemove}
                        </Button>
                        <Button type="button" variant="secondary" size="sm" onClick={() => setPendingRemove(null)}>
                          {dict.common.cancel}
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-4 text-xs leading-5 text-muted">{dict.portal.favouritesText}</p>
    </div>
  );
}

/** Both empty-state destinations, so the card reads as an offer and not a notice. */
function ButtonLinkProxy({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  return (
    <>
      <Link
        href={localizedPath(locale, '/providers')}
        className="inline-flex min-h-11 items-center gap-2 rounded-[9px] border border-line bg-white px-4 text-sm font-semibold text-navy hover:border-primary"
      >
        <Search className="size-4" aria-hidden="true" />
        {dict.portal.browseProviders}
      </Link>
      <Link href={localizedPath(locale, '/services')} className="inline-flex min-h-11 items-center rounded-[9px] border border-line bg-white px-4 text-sm font-semibold text-navy hover:border-primary">
        {dict.portal.browseServices}
      </Link>
    </>
  );
}
