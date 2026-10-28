'use client';

import { useState } from 'react';
import { Button, Card, Input, Label, PageHeader, Textarea } from '@/components/ui';
import { SelectField } from '@/components/select-field';
import { useCities, useCityAreas } from '@/features/places/queries';
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

/** Where the base point came from. `saved` is the point already on the profile;
    it is kept until the professional picks something else. */
type BasePoint = { lat: number; lng: number; source: 'saved' | 'area' | 'device' };

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
  /* Base location. `POST /provider/submit` refuses a profile without `city_id`
     and `base_location` (`provider-onboarding.service.ts`), and only this form
     can set them — so without these fields the "profile" step could never pass. */
  const [cityId, setCityId] = useState('');
  const [areaId, setAreaId] = useState('');
  const [baseAddress, setBaseAddress] = useState('');
  const [basePoint, setBasePoint] = useState<BasePoint | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationNote, setLocationNote] = useState('');
  const cities = useCities(locale);
  const cityAreas = useCityAreas(cityId === '' ? null : Number(cityId), locale);

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
    setCityId(me.cityId === null ? '' : String(me.cityId));
    setAreaId('');
    setBaseAddress(me.baseAddressText ?? '');
    setBasePoint(me.lat === null || me.lng === null ? null : { lat: me.lat, lng: me.lng, source: 'saved' });
    setLocationNote('');
    setLocalError('');
    setEditing(true);
  };

  const chooseCity = (next: string): void => {
    setCityId(next);
    setAreaId('');
    /* A point from the old city's area (or the saved one) is now in the wrong
       city. A device fix is where the professional actually is, so it stays. */
    setBasePoint((point) => (point?.source === 'device' ? point : null));
    setLocationNote('');
  };

  const chooseArea = (next: string): void => {
    setAreaId(next);
    const area = cityAreas.data?.items.find((item) => String(item.id) === next);
    /* The area's centroid stands in for the exact spot. An unsurveyed area has
       none, and then there is no honest point to send. */
    if (area !== undefined && area.lat !== null && area.lng !== null) {
      setBasePoint({ lat: area.lat, lng: area.lng, source: 'area' });
      setLocationNote(dict.portal.locationFromArea);
    }
  };

  const locateMe = (): void => {
    if (typeof navigator === 'undefined' || navigator.geolocation === undefined) {
      setLocationNote(dict.portal.locationDenied);
      return;
    }
    setLocating(true);
    setLocationNote('');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setBasePoint({ lat: position.coords.latitude, lng: position.coords.longitude, source: 'device' });
        setLocationNote(dict.portal.locationFromDevice);
        setLocating(false);
      },
      () => {
        /* Refused or unavailable: the area picker still works, so say so and leave it. */
        setLocationNote(dict.portal.locationDenied);
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15_000 }
    );
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
    /* All three parts of the base location, or none of them: a city with no
       point still fails submission, and saying so now beats a 400 later. */
    const address = baseAddress.trim();
    const anyBase = cityId !== '' || address !== '' || (basePoint !== null && basePoint.source !== 'saved');
    if (anyBase && (cityId === '' || address === '' || basePoint === null)) {
      setLocalError(dict.portal.baseLocationIncomplete);
      return;
    }
    const trimmedBio = bio?.trim() ?? '';
    const trimmedQualification = qualification?.trim() ?? '';
    /* `PATCH /provider/profile` can only replace bio/qualification
       (`COALESCE(new, old)` in profile.service.ts), never clear them. Omitting an
       emptied field used to "save" and silently bring the old text back. */
    if ((trimmedBio === '' && me.bio !== null && me.bio !== '') || (trimmedQualification === '' && me.qualification !== null && me.qualification !== '')) {
      setLocalError(dict.portal.bioCannotBeEmpty);
      return;
    }
    try {
      /* `profileUpdateSchema` is `.trim().min(1)` on bio and qualification, so an
         empty string is a 422 — an empty field is omitted, not sent blank. */
      await update.mutateAsync({
        ...(trimmedBio === '' ? {} : { bio: trimmedBio }),
        ...(trimmedQualification === '' ? {} : { qualification: trimmedQualification }),
        ...(years === null ? {} : { experienceYears: years }),
        radiusM: Math.round(radius * 1000),
        ...(anyBase && basePoint !== null ? { cityId: Number(cityId), baseAddressText: address, lat: basePoint.lat, lng: basePoint.lng } : {})
      });
      setEditing(false);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : dict.portal.profileSaveFailed);
    }
  };

  const selectedAreaCount = areas.data?.items.length ?? 0;
  const savedCityName = me.cityId === null ? null : (cities.data?.items.find((city) => city.id === me.cityId)?.name ?? null);
  const baseIsSet = me.cityId !== null && me.lat !== null && me.lng !== null;

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

              <fieldset className="grid gap-3 rounded-[12px] border border-line p-4">
                <legend className="px-1 text-sm font-semibold text-navy">{dict.portal.baseLocationTitle}</legend>
                <p className="text-xs leading-5 text-muted">{dict.portal.baseLocationHint}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="provider-city">{dict.portal.cityLabel}</Label>
                    <SelectField
                      id="provider-city"
                      value={cityId}
                      onChange={chooseCity}
                      options={(cities.data?.items ?? []).map((city) => ({ value: String(city.id), label: city.name }))}
                      placeholder={dict.portal.chooseCity}
                      isDisabled={cities.isPending}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="provider-area">{dict.portal.areaLabel}</Label>
                    <SelectField
                      id="provider-area"
                      value={areaId}
                      onChange={chooseArea}
                      options={(cityAreas.data?.items ?? []).map((area) => ({ value: String(area.id), label: area.name }))}
                      placeholder={dict.portal.chooseArea}
                      isDisabled={cityId === '' || cityAreas.isPending}
                    />
                  </div>
                </div>
                <div>
                  <Button type="button" variant="secondary" size="sm" onClick={locateMe} disabled={locating}>
                    {locating ? dict.portal.locatingYou : dict.portal.useMyLocation}
                  </Button>
                  {locationNote !== '' ? (
                    <p aria-live="polite" className="mt-2 text-xs leading-5 text-secondary">
                      {locationNote}
                    </p>
                  ) : null}
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="provider-base-address">{dict.portal.baseAddressLabel}</Label>
                  <Input id="provider-base-address" value={baseAddress} onChange={(event) => setBaseAddress(event.target.value)} placeholder={dict.portal.baseAddressPlaceholder} />
                </div>
              </fieldset>

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
                <dt className="text-muted">{dict.portal.baseLocationTitle}</dt>
                <dd className="max-w-sm text-end font-medium text-navy">
                  {baseIsSet ? [savedCityName, me.baseAddressText].filter((part): part is string => part !== null && part !== '').join(' · ') : dict.portal.baseLocationNotSet}
                </dd>
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
