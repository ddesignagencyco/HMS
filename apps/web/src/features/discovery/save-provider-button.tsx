'use client';

import { useState } from 'react';
import { Heart, Loader2 } from 'lucide-react';
import { useFavourites, useAddFavourite, useRemoveFavourite } from '@/features/account/me-queries';
import { detailOf, toastError, toastSuccess } from '@/features/auth/auth-feedback';
import { useSession } from '@/features/auth/session';
import { ApiError } from '@/lib/api/problem';
import type { Dictionary } from '@/lib/dictionaries';
import type { Locale } from '@/lib/utils';

/* Save this professional — `POST /me/favourites/:providerId` and its DELETE.
 *
 * **Shown to customers only.** All three favourite routes are
 * `@PolicyDecorator({ roles: ['CUSTOMER'] })`, so a professional or a staff
 * account tapping this would get a 403. The role comes from the one session query
 * rather than from a prop, because the profile page is public and also renders for
 * signed-in people of every role.
 *
 * **The button never claims a save it did not make.** `POST` answers 404 unless the
 * provider is APPROVED — and a profile page is reachable for whatever the public
 * search published — so the one failure worth explaining in the product's words is
 * that condition, not a generic error.
 *
 * All three hooks run unconditionally, above the early returns, so a hook never
 * appears or disappears with the session state. */

export function SaveProviderButton({ locale, dict, providerId }: { locale: Locale; dict: Dictionary; providerId: string }) {
  const { user } = useSession();
  const favourites = useFavourites(locale);
  const add = useAddFavourite(locale);
  const remove = useRemoveFavourite(locale);
  const [localError, setLocalError] = useState('');

  /* The shortlist is the authority on whether this provider is saved. The session is
     not: it carries no favourites. So until the list answers, the control stays
     hidden rather than rendering "Save" for someone who already saved this one. */
  if (user === null || !user.roles.includes('CUSTOMER') || favourites.isPending || favourites.isError) return null;

  const saved = favourites.data.items.some((item) => item.providerId === providerId);
  const busy = add.isPending || remove.isPending;

  const toggle = async (): Promise<void> => {
    setLocalError('');
    try {
      if (saved) {
        await remove.mutateAsync(providerId);
        toastSuccess(dict.portal.favouritesRemoved);
      } else {
        await add.mutateAsync(providerId);
        toastSuccess(dict.portal.favouritesSaveAction);
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        setLocalError(dict.portal.favouritesSaveFailed);
        return;
      }
      setLocalError(detailOf(error, dict));
    }
  };

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={busy}
        aria-pressed={saved}
        className={
          saved
            ? 'inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[9px] border border-primary bg-white px-4 text-sm font-semibold text-primary-strong transition hover:bg-blue-50 disabled:opacity-60'
            : 'inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[9px] border border-line bg-white px-4 text-sm font-semibold text-navy transition hover:border-primary disabled:opacity-60'
        }
      >
        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Heart className={`size-4 ${saved ? 'fill-current' : ''}`} aria-hidden="true" />}
        {saved ? dict.portal.favouritesSavedAction : dict.portal.favouritesSaveAction}
      </button>

      {localError !== '' ? (
        <p role="alert" className="mt-2 text-xs font-medium leading-5 text-rose-700">
          {localError}
        </p>
      ) : null}
    </div>
  );
}
