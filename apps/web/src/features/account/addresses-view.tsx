'use client';

import { MapPin, Pencil, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { Button, Card, PageHeader } from '@/components/ui';
import { addressLine, type Address } from '@/features/account/api';
import { AddressForm } from '@/features/booking/address-step';
import { useAddresses, useArchiveAddress, useUpdateAddress } from '@/features/booking/queries';
import { useCities } from '@/features/places/queries';
import { placesApi } from '@/features/places/api';
import { publicKeys, publicRetry, FRESHNESS } from '@/lib/api/keys';
import type { Dictionary } from '@/lib/dictionaries';
import { cn, type Locale } from '@/lib/utils';

/* The saved address book.

   `GET /customer/addresses` returns `areaId` but no area *name*, and the places
   API only lists areas under a city — so the name is resolved by fanning out
   over the cities. That is one extra request per city, all of it reference data
   with a long stale window, and it buys an address that reads "Home, 12
   Street, Gulberg III" instead of "Home, 12 Street, #14".

   The previous version of this screen rendered four cards invented from
   `src/lib/data.ts` — house numbers that were arithmetic on the array index —
   beside a create form that really did call the API. Two sources of truth for
   one list, and only one of them could be booked against. */

const buttonStyles = () => 'inline-flex min-h-11 items-center gap-2 rounded-[9px] border border-line px-4 text-sm font-semibold text-navy transition hover:border-slate-300';

/** `areaId` → area name, across every city the platform publishes. */
function useAreaNames(locale: Locale): Map<number, string> {
  /* The same query `useCities` runs elsewhere, so this is deduplicated against
     the cache rather than a second request for the same thing. */
  const cities = useCities(locale);
  const cityIds = useMemo(() => (cities.data?.items ?? []).map((city) => city.id), [cities.data]);

  const areas = useQueries({
    queries: cityIds.map((cityId) => ({
      queryKey: publicKeys.areas(cityId),
      queryFn: ({ signal }: { signal: AbortSignal }) => placesApi.listAreas(cityId, { signal, locale }).then((result) => result.items),
      /* Reference data — the same window the single-city hook uses. The keys are
         already per-city, so this fans out without colliding with `useCityAreas`. */
      staleTime: FRESHNESS.places.staleTime,
      gcTime: FRESHNESS.places.gcTime,
      retry: publicRetry
    }))
  });

  return useMemo(() => {
    const names = new Map<number, string>();
    for (const result of areas) {
      if (!result.isSuccess) continue;
      for (const area of result.data) names.set(area.id, area.name);
    }
    return names;
  }, [areas]);
}

export function AddressBookView({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const addresses = useAddresses(locale);
  const areaNames = useAreaNames(locale);
  const [editing, setEditing] = useState<Address | null>(null);
  const [creating, setCreating] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);
  const [localError, setLocalError] = useState('');

  const archive = useArchiveAddress(locale);
  const setDefault = useUpdateAddress(locale);

  const confirmRemove = async (addressId: string): Promise<void> => {
    setLocalError('');
    try {
      await archive.mutateAsync(addressId);
      setPendingRemove(null);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : dict.portal.addressesLoadError);
    }
  };

  const promote = async (addressId: string): Promise<void> => {
    setLocalError('');
    try {
      /* `isDefault: true` un-defaults the others in the same transaction, so the
         list is refetched rather than patched — otherwise two cards would claim
         to be the default until something else invalidated the query. */
      await setDefault.mutateAsync({ id: addressId, input: { isDefault: true } });
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : dict.portal.addressesLoadError);
    }
  };

  if (addresses.isPending) {
    return (
      <div aria-busy="true" aria-live="polite" className="grid gap-4">
        <span className="skeleton h-8 w-48 rounded-[9px]" />
        <span className="skeleton h-28 w-full rounded-[12px]" />
        <span className="skeleton h-28 w-full rounded-[12px]" />
      </div>
    );
  }

  if (addresses.isError) {
    return (
      <div>
        <PageHeader eyebrow={dict.portal.customer} title={dict.portal.addresses} />
        <div role="alert" className="mt-6 rounded-[14px] border border-rose-200 bg-rose-50 p-5">
          <p className="text-sm font-medium leading-6 text-rose-800">{dict.portal.addressesLoadError}</p>
          <Button type="button" variant="secondary" size="sm" className="mt-4" onClick={() => void addresses.refetch()}>
            {dict.catalogue.retry}
          </Button>
        </div>
      </div>
    );
  }

  const items = addresses.data.items;

  /* The form takes over the whole screen: an inline create next to the list was
     the previous shape and it made the empty state indistinguishable from the
     populated one. */
  if (creating || editing !== null) {
    return (
      <div>
        <PageHeader eyebrow={dict.portal.customer} title={editing === null ? dict.booking.newAddressTitle : dict.portal.editAddress} />
        <AddressForm
          locale={locale}
          dict={dict}
          fallbackCityId={null}
          {...(editing === null ? {} : { initial: editing })}
          onCreated={() => {
            setCreating(false);
            setEditing(null);
          }}
          onCancel={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow={dict.portal.customer}
        title={dict.portal.addresses}
        action={
          <button type="button" className={buttonStyles()} onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden="true" />
            {dict.portal.addAddress}
          </button>
        }
      />

      {items.length === 0 ? (
        <div className="mt-6 rounded-[14px] border border-line bg-surface-2 p-6">
          <h2 className="font-semibold text-navy">{dict.portal.noAddresses}</h2>
          <p className="mt-2 text-sm leading-6 text-secondary">{dict.portal.noAddressesText}</p>
        </div>
      ) : (
        <ul className="mt-6 grid gap-4 md:grid-cols-2">
          {items.map((address) => (
            <li key={address.id}>
              <Card className="flex h-full flex-col p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="flex flex-wrap items-center gap-2 font-semibold text-navy">
                      <MapPin className="size-4 shrink-0 text-muted" aria-hidden="true" />
                      {address.label}
                      {address.isDefault ? <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-primary-strong">{dict.portal.defaultBadge}</span> : null}
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-secondary">{addressLine(address, areaNames.get(address.areaId))}</p>
                    {address.notes !== null && address.notes !== '' ? <p className="mt-1 text-xs leading-5 text-muted">{address.notes}</p> : null}
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2 pt-1">
                  <Button type="button" variant="secondary" size="sm" onClick={() => setEditing(address)} aria-label={`${dict.portal.editAddress}: ${address.label}`}>
                    <Pencil className="size-4" aria-hidden="true" />
                    {dict.portal.editAddress}
                  </Button>
                  {!address.isDefault ? (
                    <Button type="button" variant="secondary" size="sm" disabled={setDefault.isPending} onClick={() => void promote(address.id)}>
                      {dict.portal.makeDefault}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={cn('text-rose-700')}
                    onClick={() => setPendingRemove(pendingRemove === address.id ? null : address.id)}
                    aria-expanded={pendingRemove === address.id}
                    aria-label={`${dict.portal.removeAddress}: ${address.label}`}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                    {dict.portal.removeAddress}
                  </Button>
                </div>

                {/* Removing is confirmed inline rather than through `window.confirm`,
                    so the consequence is readable and the answer is dismissible with
                    the keyboard. */}
                {pendingRemove === address.id ? (
                  <div role="group" aria-label={dict.portal.removeAddress} className="mt-3 rounded-[9px] border border-rose-200 bg-rose-50 p-3">
                    <p className="text-sm leading-6 text-rose-800">{dict.portal.removeAddressConfirm}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button type="button" size="sm" disabled={archive.isPending} onClick={() => void confirmRemove(address.id)}>
                        {dict.portal.removeAddress}
                      </Button>
                      <Button type="button" variant="secondary" size="sm" onClick={() => setPendingRemove(null)}>
                        {dict.common.cancel}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      )}

      {localError !== '' ? (
        <p role="alert" className="mt-4 rounded-[9px] bg-rose-50 p-3 text-sm text-rose-700">
          {localError}
        </p>
      ) : null}
    </div>
  );
}
