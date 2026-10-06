'use client';

import { useMemo, useState } from 'react';
import { Button, Card, PageHeader } from '@/components/ui';
import { useCities, useCityAreas } from '@/features/places/queries';
import { useProviderServiceAreas, useSetServiceAreas } from '@/features/provider/queries';
import { MAX_SERVICE_AREAS } from '@/features/provider/api';
import type { Dictionary } from '@/lib/dictionaries';
import { cn, formatNumber, type Locale } from '@/lib/utils';

/* The areas a professional travels to.

   `GET /provider/service-areas` returns a bare list of `areaId`s — the API has no
   reason to denormalise a name into a binding table. So the picker is built from
   the places API (`/places/cities`, then `/places/cities/{id}/areas`), which is
   also what validates the ids: `replaceMine` refuses an id that is not an active
   area with a 404.

   Saving is a **full replace**, not an add or a remove. Ticking one more box and
   pressing Save sends the whole set, because `PUT /provider/service-areas`
   deletes and re-inserts. That is also why the screen keeps a draft and only
   commits on Save — sending on every tick would fight the user mid-selection. */

export function ProviderAreasScreen({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const mine = useProviderServiceAreas(locale);
  const cities = useCities(locale);
  const save = useSetServiceAreas(locale);

  const [cityId, setCityId] = useState<number | null>(null);
  const [draft, setDraft] = useState<number[] | null>(null);
  const [localError, setLocalError] = useState('');

  const effectiveCityId = cityId ?? cities.data?.items[0]?.id ?? null;
  const catalogueAreas = useCityAreas(effectiveCityId, locale);

  const selected = useMemo(() => new Set(draft ?? mine.data?.items.map((area) => area.areaId) ?? []), [draft, mine.data]);

  const toggle = (areaId: number): void => {
    const next = new Set(selected);
    if (next.has(areaId)) next.delete(areaId);
    else {
      /* The API caps the set at 50. Silently truncating would be worse than
         saying so, so the last box is simply refused. */
      if (next.size >= MAX_SERVICE_AREAS) {
        setLocalError(dict.portal.tooManyAreas.replace('{max}', String(MAX_SERVICE_AREAS)));
        return;
      }
      next.add(areaId);
    }
    setLocalError('');
    setDraft([...next]);
  };

  const commit = async (): Promise<void> => {
    setLocalError('');
    const ids = [...selected];
    /* No areas is legal — `replaceMine` handles an empty set — so an empty
       selection is a deliberate "I will not travel" rather than an error. */
    if (ids.length === 0 && (mine.data?.items.length ?? 0) === 0) return;
    try {
      await save.mutateAsync(ids);
      setDraft(null);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : dict.portal.areasSaveFailed);
    }
  };

  if (mine.isPending || cities.isPending) {
    return (
      <div aria-busy="true" aria-live="polite" className="grid gap-3">
        <span className="skeleton h-8 w-56 rounded-[9px]" />
        <span className="skeleton h-48 w-full rounded-[12px]" />
      </div>
    );
  }

  if (mine.isError) {
    return (
      <div>
        <PageHeader eyebrow={dict.portal.provider} title={dict.portal.serviceArea} />
        <div role="alert" className="mt-6 rounded-[14px] border border-rose-200 bg-rose-50 p-5">
          <p className="text-sm font-medium leading-6 text-rose-800">{dict.portal.areasLoadError}</p>
          <Button type="button" variant="secondary" size="sm" className="mt-4" onClick={() => void mine.refetch()}>
            {dict.catalogue.retry}
          </Button>
        </div>
      </div>
    );
  }

  const dirty = draft !== null;
  const savedCount = mine.data.items.length;

  return (
    <div>
      <PageHeader eyebrow={dict.portal.provider} title={dict.portal.serviceArea} description={dict.portal.serviceAreaText} />

      <Card className="mt-6 p-6">
        <p className="text-sm text-secondary">{dict.portal.areasSaved.replace('{count}', formatNumber(savedCount, locale))}</p>

        {cities.isError ? (
          <p role="alert" className="mt-4 text-sm text-rose-700">
            {dict.booking.citiesError}
          </p>
        ) : catalogueAreas.isPending ? (
          <span className="skeleton mt-4 h-24 w-full rounded-[10px]" aria-hidden="true" />
        ) : catalogueAreas.isError ? (
          <p role="alert" className="mt-4 text-sm text-rose-700">
            {dict.booking.areasError}
          </p>
        ) : catalogueAreas.data.items.length === 0 ? (
          <p className="mt-4 text-sm text-secondary">{dict.portal.noAreasYet}</p>
        ) : (
          <fieldset className="mt-4">
            <legend className="sr-only">{dict.portal.serviceArea}</legend>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {catalogueAreas.data.items.map((area) => {
                const checked = selected.has(area.id);
                return (
                  <label
                    key={area.id}
                    className={cn(
                      'flex cursor-pointer items-center gap-3 rounded-[10px] border p-3 text-sm transition',
                      checked ? 'border-primary bg-blue-50 font-medium text-navy' : 'border-line hover:border-slate-300'
                    )}
                  >
                    <input type="checkbox" className="size-4 accent-blue-600" checked={checked} onChange={() => toggle(area.id)} />
                    <span className="min-w-0">{area.name}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        )}

        {localError !== '' ? (
          <p role="alert" className="mt-4 rounded-[9px] bg-rose-50 p-3 text-sm text-rose-700">
            {localError}
          </p>
        ) : null}

        {/* Save is enabled only once something differs, because the endpoint is a
            destructive full replace — an accidental press with no intent would
            otherwise clear the set. */}
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button type="button" onClick={() => void commit()} disabled={!dirty || save.isPending}>
            {save.isPending ? dict.portal.saving : dict.portal.saveAreas}
          </Button>
          {dirty ? (
            <Button type="button" variant="secondary" onClick={() => setDraft(null)} disabled={save.isPending}>
              {dict.common.cancel}
            </Button>
          ) : null}
        </div>
        <p className="mt-4 text-xs leading-5 text-muted">{dict.portal.areasReplaceNote}</p>
      </Card>
    </div>
  );
}
