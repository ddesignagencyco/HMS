'use client';

import { useState } from 'react';
import { Button, Card, Input, Label, PageHeader, Textarea } from '@/components/ui';
import { useProviderProfile, useProviderServiceAreas, useUpdateProviderProfile } from '@/features/provider/queries';
import { MAX_EXPERIENCE_YEARS, MAX_RADIUS_M, MIN_RADIUS_M } from '@/features/provider/limits';
import type { Dictionary } from '@/lib/dictionaries';
import { formatNumber, type Locale } from '@/lib/utils';

/* The professional's own profile.

   This screen used to render `providers[0]` — a hardcoded "Ahmad Raza" from
   `src/lib/data.ts`. Whichever professional signed in saw the same invented
   person, because the mock had no notion of who was asking.

   The API identifies the caller from the access token (`GET /provider/profile`
   has no id in its path), so there is no `providers[0]` to replace — the answer
   is simply "the account reading this".

   **Names are absent by design.** The public search contract deliberately omits
   `users.first_name`, so `qualification` ("Licensed electrician") is what a
   professional shows publicly, and this screen shows the same field for the same
   reason. Inventing a name field here would be the one place a private value
 * escaped into the workspace chrome. */

const formatRadius = (metres: number, locale: Locale): string => (metres >= 1000 ? `${formatNumber(Math.round(metres / 1000), locale)} km` : `${formatNumber(metres, locale)} m`);

export function ProviderProfileScreen({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const profile = useProviderProfile(locale);
  const areas = useProviderServiceAreas(locale);
  const update = useUpdateProviderProfile(locale);

  const [editing, setEditing] = useState(false);
  const [bio, setBio] = useState<string | null>(null);
  const [qualification, setQualification] = useState<string | null>(null);
  const [experienceYears, setExperienceYears] = useState<string | null>(null);
  const [radiusKm, setRadiusKm] = useState<string | null>(null);
  const [localError, setLocalError] = useState('');

  if (profile.isPending) {
    return (
      <div aria-busy="true" aria-live="polite" className="grid gap-3">
        <span className="skeleton h-8 w-56 rounded-[9px]" />
        <span className="skeleton h-64 w-full rounded-[12px]" />
      </div>
    );
  }

  if (profile.isError) {
    return (
      <div>
        <PageHeader eyebrow={dict.portal.provider} title={dict.portal.profile} />
        <div role="alert" className="mt-6 rounded-[14px] border border-rose-200 bg-rose-50 p-5">
          <p className="text-sm font-medium leading-6 text-rose-800">{dict.portal.profileLoadError}</p>
          <Button type="button" variant="secondary" size="sm" className="mt-4" onClick={() => void profile.refetch()}>
            {dict.catalogue.retry}
          </Button>
        </div>
      </div>
    );
  }

  const me = profile.data;

  const startEditing = (): void => {
    setBio(me.bio ?? '');
    setQualification(me.qualification ?? '');
    setExperienceYears(me.experienceYears === null ? '' : String(me.experienceYears));
    setRadiusKm(String(Math.round(me.radiusM / 1000)));
    setLocalError('');
    setEditing(true);
  };

  const save = async (): Promise<void> => {
    setLocalError('');
    const years = experienceYears?.trim() === '' ? null : Number(experienceYears);
    /* `profileUpdateSchema`: experienceYears is 0–60. */
    if (years !== null && (!Number.isInteger(years) || years < 0 || years > MAX_EXPERIENCE_YEARS)) {
      setLocalError(dict.portal.experienceInvalid);
      return;
    }
    const radius = Number(radiusKm);
    /* `profileUpdateSchema`: radiusM is 500–50 000 **metres**. The field is in
       kilometres, so the bounds are 0.5–50 — an earlier version of this form
       accepted 1–100 and every value above 50 would have been a 422. */
    if (!Number.isFinite(radius) || radius * 1000 < MIN_RADIUS_M || radius * 1000 > MAX_RADIUS_M) {
      setLocalError(dict.portal.radiusInvalid);
      return;
    }
    try {
      await update.mutateAsync({
        bio: bio?.trim() ?? '',
        qualification: qualification?.trim() ?? '',
        ...(years === null ? {} : { experienceYears: years }),
        radiusM: Math.round(radius * 1000)
      });
      setEditing(false);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : dict.portal.profileSaveFailed);
    }
  };

  const selectedAreaCount = areas.data?.items.length ?? 0;

  return (
    <div>
      <PageHeader
        eyebrow={dict.portal.provider}
        title={dict.portal.profile}
        action={
          editing ? undefined : (
            <Button type="button" variant="secondary" size="sm" onClick={startEditing}>
              {dict.portal.editProfile}
            </Button>
          )
        }
      />

      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="p-6">
          {editing ? (
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="provider-qualification">{dict.providers.qualification}</Label>
                <Input id="provider-qualification" value={qualification ?? ''} onChange={(event) => setQualification(event.target.value)} placeholder={dict.portal.qualificationPlaceholder} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="provider-bio">{dict.providers.about}</Label>
                <Textarea id="provider-bio" value={bio ?? ''} onChange={(event) => setBio(event.target.value)} />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="provider-experience">{dict.portal.yearsExperience}</Label>
                  <Input id="provider-experience" inputMode="numeric" value={experienceYears ?? ''} onChange={(event) => setExperienceYears(event.target.value)} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="provider-radius">{dict.portal.travelRadius}</Label>
                  <Input id="provider-radius" inputMode="numeric" value={radiusKm ?? ''} onChange={(event) => setRadiusKm(event.target.value)} />
                </div>
              </div>

              {localError !== '' ? (
                <p role="alert" className="rounded-[9px] bg-rose-50 p-3 text-sm text-rose-700">
                  {localError}
                </p>
              ) : null}

              <div className="flex flex-wrap gap-3">
                <Button type="button" onClick={() => void save()} disabled={update.isPending}>
                  {update.isPending ? dict.portal.saving : dict.portal.save}
                </Button>
                <Button type="button" variant="secondary" onClick={() => setEditing(false)} disabled={update.isPending}>
                  {dict.common.cancel}
                </Button>
              </div>
            </div>
          ) : (
            <dl className="grid gap-4 text-sm">
              <div className="flex justify-between gap-4 border-b border-line pb-3">
                <dt className="text-muted">{dict.providers.qualification}</dt>
                <dd className="max-w-sm text-end font-medium text-navy">{me.qualification ?? dict.portal.notPublished}</dd>
              </div>
              <div className="flex justify-between gap-4 border-b border-line pb-3">
                <dt className="text-muted">{dict.providers.about}</dt>
                <dd className="max-w-sm text-end text-navy">{me.bio ?? dict.portal.notPublished}</dd>
              </div>
              <div className="flex justify-between gap-4 border-b border-line pb-3">
                <dt className="text-muted">{dict.portal.yearsExperience}</dt>
                <dd className="text-end font-medium text-navy">{me.experienceYears === null ? dict.portal.notPublished : formatNumber(me.experienceYears, locale)}</dd>
              </div>
              <div className="flex justify-between gap-4 border-b border-line pb-3">
                <dt className="text-muted">{dict.portal.travelRadius}</dt>
                <dd className="text-end font-medium text-navy">{formatRadius(me.radiusM, locale)}</dd>
              </div>
              <div className="flex justify-between gap-4 border-b border-line pb-3">
                <dt className="text-muted">{dict.providers.areasServed}</dt>
                <dd className="text-end font-medium text-navy">{areas.isPending ? '…' : formatNumber(selectedAreaCount, locale)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted">{dict.portal.approvalStatus}</dt>
                <dd className="text-end font-medium text-navy">{dict.portal.statusKeys[me.status] ?? me.status}</dd>
              </div>
            </dl>
          )}
        </Card>

        <Card className="p-6">
          <h2 className="font-semibold text-navy">{dict.providers.areasServed}</h2>
          {areas.isPending ? (
            <span className="skeleton mt-4 h-20 w-full rounded-[10px]" aria-hidden="true" />
          ) : areas.isError ? (
            <p role="alert" className="mt-3 text-sm text-rose-700">
              {dict.portal.areasLoadError}
            </p>
          ) : selectedAreaCount === 0 ? (
            <p className="mt-3 text-sm leading-6 text-secondary">{dict.portal.noAreasYet}</p>
          ) : (
            /* The endpoint returns bare `areaId`s, so there is nothing to print
               here without a second fetch. The count and a link to the picker
               carry the same information honestly — a list of ids would not. */
            <p className="mt-3 text-sm leading-6 text-secondary">{dict.portal.areasSaved.replace('{count}', formatNumber(selectedAreaCount, locale))}</p>
          )}
          <p className="mt-5 text-xs leading-5 text-muted">{dict.portal.areasLinkNote}</p>
        </Card>
      </div>
    </div>
  );
}
