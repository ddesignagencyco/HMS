'use client';

import { Crosshair, MapPin, Plus } from 'lucide-react';
import { useState } from 'react';
import type { Dictionary } from '@/lib/dictionaries';
import { cn, type Locale } from '@/lib/utils';
import { Button, Input, Label, RadioGroup, RadioGroupItem, Textarea } from '@/components/ui';
import { SelectField } from '@/components/select-field';
import { cityCentre, requestDeviceLocation, type LatLng } from '@/features/search/location';
import { useCities, useCityAreas } from '@/features/places/queries';
import { addressLine, type Address, type CreateAddressInput } from '@/features/account/api';
import { useAddresses, useCreateAddress, useUpdateAddress } from '@/features/booking/queries';

/* The address step. `POST /bookings` requires an `addressId`, so a saved address
   is not a convenience here — it is the only way the booking can be created at
   all. A customer with none saved gets an inline create form rather than a dead
   end pointing at a portal page.

   The form cannot geocode anything: there is no geocoding endpoint, and
   `areas.centroid` is not selected by the places API (BACKEND_REQUIREMENTS.md
   §2.2). So the point comes from one of exactly two honest sources, both
   labelled on screen — the device's own location, or the city centre the
   provider search already uses as an approximation. Neither is presented as the
   person's address. */

type PointSource = 'none' | 'device' | 'city' | 'saved';

export function AddressStep({ locale, dict, addressId, onSelect }: { locale: Locale; dict: Dictionary; addressId: string | null; onSelect: (addressId: string, point: LatLng) => void }) {
  const addresses = useAddresses(locale);
  const [creating, setCreating] = useState(false);

  if (addresses.isPending) {
    return (
      <div aria-busy="true" aria-live="polite" className="grid gap-3">
        <span className="skeleton h-6 w-48 rounded-[9px]" />
        <span className="skeleton h-20 w-full rounded-[12px]" />
      </div>
    );
  }

  if (addresses.isError) {
    return (
      <div role="alert" className="rounded-[14px] border border-rose-200 bg-rose-50 p-5">
        <p className="text-sm font-medium leading-6 text-rose-800">{dict.booking.addressesError}</p>
        <Button type="button" variant="secondary" size="sm" className="mt-4" onClick={() => void addresses.refetch()}>
          {dict.catalogue.retry}
        </Button>
      </div>
    );
  }

  const items = addresses.data.items;

  if (creating || items.length === 0) {
    return (
      <div>
        <h2 className="text-xl font-semibold text-navy">{dict.booking.newAddressTitle}</h2>
        <p className="mt-1 text-sm text-secondary">{dict.booking.newAddressText}</p>
        {/* Why the form appeared at all. Without this the customer is dropped into
            a form with no explanation, having asked for nothing. */}
        {items.length === 0 ? <p className="mt-4 rounded-[9px] border border-line bg-surface-2 p-4 text-sm leading-6 text-secondary">{dict.booking.noAddressesYet}</p> : null}
        <AddressForm
          locale={locale}
          dict={dict}
          onCreated={(address) => {
            setCreating(false);
            onSelect(address.id, { lat: address.lat, lng: address.lng });
          }}
          onCancel={items.length === 0 ? undefined : () => setCreating(false)}
          fallbackCityId={null}
        />
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-xl font-semibold text-navy">{dict.booking.addressTitle}</h2>
      <p className="mt-1 text-sm text-secondary">{dict.booking.addressText}</p>

      {items.length === 0 ? (
        <p className="mt-6 rounded-[9px] border border-line bg-surface-2 p-4 text-sm leading-6 text-secondary">{dict.booking.noAddressesYet}</p>
      ) : (
        <RadioGroup
          value={addressId ?? ''}
          onValueChange={(value) => {
            const chosen = items.find((item) => item.id === value);
            if (chosen !== undefined) onSelect(chosen.id, { lat: chosen.lat, lng: chosen.lng });
          }}
          className="mt-6 grid gap-3"
        >
          {items.map((address) => (
            <label
              key={address.id}
              className={cn(
                'flex cursor-pointer items-start gap-4 rounded-[12px] border p-4 transition',
                addressId === address.id ? 'border-primary bg-blue-50' : 'border-line hover:border-slate-300'
              )}
            >
              <RadioGroupItem value={address.id} className="mt-1" />
              <span className="relative min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2 font-semibold text-navy">
                  <MapPin className="size-4 text-muted" aria-hidden="true" />
                  {address.label}
                  {address.isDefault ? <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-primary-strong">{dict.booking.defaultAddress}</span> : null}
                </span>
                <span className="mt-1 block text-sm text-secondary">{addressLine(address)}</span>
                {address.notes !== null && address.notes !== '' ? <span className="mt-1 block text-xs text-muted">{address.notes}</span> : null}
              </span>
            </label>
          ))}
        </RadioGroup>
      )}

      <Button type="button" variant="secondary" size="sm" className="mt-4" onClick={() => setCreating(true)}>
        <Plus className="size-4" aria-hidden="true" />
        {dict.booking.addAnotherAddress}
      </Button>
    </div>
  );
}

type AddressFormProps = {
  locale: Locale;
  dict: Dictionary;
  onCreated: (address: Address) => void;
  onCancel?: () => void;
  fallbackCityId: number | null;
  /** Present when editing a saved address: the form then PATCHes instead of POSTing. */
  initial?: Address;
};

/**
 * Create and edit are the same form. `addressUpdateSchema` is `.strict()` and
 * `addressCreateSchema` requires a point, so an edit that changes the address or
 * its area has to supply both again — reusing one component is what keeps the
 * "where does the map point come from" explanation attached to both paths.
 */
export function AddressForm({ locale, dict, onCreated, onCancel, fallbackCityId, initial }: AddressFormProps) {
  const cities = useCities(locale);
  const [cityId, setCityId] = useState<number | null>(null);
  const [areaId, setAreaId] = useState<number | null>(initial?.areaId ?? null);
  const [label, setLabel] = useState(initial?.label ?? '');
  const [line1, setLine1] = useState(initial?.line1 ?? '');
  const [line2, setLine2] = useState(initial?.line2 ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [point, setPoint] = useState<LatLng | null>(initial === undefined ? null : { lat: initial.lat, lng: initial.lng });
  /* An edit starts from the point already on file, so it is labelled as stored
     rather than as something the person just picked. */
  const [pointSource, setPointSource] = useState<PointSource>(initial === undefined ? 'none' : 'saved');
  const [pointNote, setPointNote] = useState('');
  const [localError, setLocalError] = useState('');

  const effectiveCityId = cityId ?? fallbackCityId ?? cities.data?.items[0]?.id ?? null;
  const areas = useCityAreas(effectiveCityId, locale);
  const create = useCreateAddress(locale);
  const update = useUpdateAddress(locale);

  /* Named `pickDeviceLocation` rather than `useDeviceLocation`: it is an event
     handler, not a hook, and a `use`-prefixed name would be flagged wherever it
     is called from a callback. */
  const pickDeviceLocation = async (): Promise<void> => {
    setPointNote('');
    const outcome = await requestDeviceLocation();
    if (outcome.status === 'granted') {
      setPoint(outcome.point);
      setPointSource('device');
      return;
    }
    setPointSource('none');
    setPointNote(outcome.status === 'denied' ? dict.booking.locationDenied : dict.booking.locationUnavailable);
  };

  const useCityCentre = (): void => {
    const city = cities.data?.items.find((item) => item.id === effectiveCityId);
    const centre = city === undefined ? null : cityCentre(city.name);
    if (centre === null) {
      setPointSource('none');
      setPointNote(dict.booking.noCityCentre);
      return;
    }
    setPoint(centre);
    setPointSource('city');
    setPointNote('');
  };

  const ready = label.trim() !== '' && line1.trim() !== '' && areaId !== null && point !== null && pointSource !== 'none';

  const submit = async (): Promise<void> => {
    setLocalError('');
    if (areaId === null || point === null) {
      setLocalError(dict.booking.addressNeedsAreaAndPoint);
      return;
    }
    /* An edit sends only what the person can change. Sending `isDefault` here
       would make saving an edit silently promote this address, which is a
       separate, deliberate action on the list. */
    const input: CreateAddressInput = {
      label: label.trim(),
      line1: line1.trim(),
      areaId,
      lat: point.lat,
      lng: point.lng,
      ...(line2.trim() === '' ? {} : { line2: line2.trim() }),
      ...(notes.trim() === '' ? {} : { notes: notes.trim() }),
      /* The first address a customer saves is their default; the API
         un-defaults the others in the same transaction when this is true. */
      isDefault: initial?.isDefault ?? true
    };
    try {
      const address = initial === undefined ? await create.mutateAsync(input) : await update.mutateAsync({ id: initial.id, input: { ...input, isDefault: undefined } });
      onCreated(address);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : dict.booking.addressSaveFailed);
    }
  };

  const busy = create.isPending || update.isPending;

  return (
    <div className="mt-6 grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="address-city">{dict.booking.cityLabel}</Label>
        {cities.isPending ? (
          <span className="skeleton h-[42px] w-full rounded-[10px]" aria-hidden="true" />
        ) : cities.isError ? (
          <p role="alert" className="text-sm text-rose-700">
            {dict.booking.citiesError}
          </p>
        ) : (
          <SelectField
            id="address-city"
            value={effectiveCityId === null ? '' : String(effectiveCityId)}
            onChange={(value) => {
              setCityId(value === '' ? null : Number(value));
              setAreaId(null);
            }}
            options={(cities.data?.items ?? []).map((city) => ({ value: String(city.id), label: city.name }))}
            placeholder={dict.booking.chooseCity}
          />
        )}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="address-area">{dict.booking.areaLabel}</Label>
        {effectiveCityId === null ? (
          <p className="text-sm text-secondary">{dict.booking.chooseCityFirst}</p>
        ) : areas.isPending ? (
          <span className="skeleton h-[42px] w-full rounded-[10px]" aria-hidden="true" />
        ) : areas.isError ? (
          <p role="alert" className="text-sm text-rose-700">
            {dict.booking.areasError}
          </p>
        ) : (
          <SelectField
            id="address-area"
            value={areaId === null ? '' : String(areaId)}
            onChange={(value) => setAreaId(value === '' ? null : Number(value))}
            options={(areas.data?.items ?? []).map((area) => ({ value: String(area.id), label: area.name }))}
            placeholder={dict.booking.chooseArea}
            isDisabled={(areas.data?.items ?? []).length === 0}
          />
        )}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="address-label">{dict.booking.addressLabelField}</Label>
        <Input id="address-label" value={label} onChange={(event) => setLabel(event.target.value)} placeholder={dict.booking.addressLabelPlaceholder} />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="address-line1">{dict.booking.houseLabel}</Label>
        <Input id="address-line1" value={line1} onChange={(event) => setLine1(event.target.value)} placeholder={dict.booking.housePlaceholder} />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="address-line2">{dict.booking.addressLine2Label}</Label>
        <Input id="address-line2" value={line2} onChange={(event) => setLine2(event.target.value)} placeholder={dict.booking.addressLine2Placeholder} />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="address-notes">{dict.booking.notesLabel}</Label>
        <Textarea id="address-notes" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder={dict.booking.notesPlaceholder} />
      </div>

      <fieldset className="rounded-[12px] border border-line p-4">
        <legend className="px-1 text-xs font-semibold uppercase tracking-[0.12em] text-muted">{dict.booking.pointLegend}</legend>
        <p className="mt-1 text-sm leading-6 text-secondary">{dict.booking.pointExplainer}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => void pickDeviceLocation()}>
            <Crosshair className="size-4" aria-hidden="true" />
            {dict.booking.useDeviceLocation}
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={useCityCentre} disabled={effectiveCityId === null}>
            <MapPin className="size-4" aria-hidden="true" />
            {dict.booking.useCityCentre}
          </Button>
        </div>
        {point !== null ? (
          <p className="mt-3 text-sm font-medium text-navy">
            {pointSource === 'device' ? dict.booking.pointFromDevice : pointSource === 'saved' ? dict.booking.pointOnFile : dict.booking.pointFromCityCentre}
            <span className="ms-2 font-mono text-xs text-muted tabular-nums">
              {point.lat.toFixed(4)}, {point.lng.toFixed(4)}
            </span>
          </p>
        ) : null}
        {pointNote !== '' ? <p className="mt-2 text-sm text-amber-800">{pointNote}</p> : null}
      </fieldset>

      {localError !== '' ? <p className="rounded-[9px] bg-rose-50 p-3 text-sm text-rose-700">{localError}</p> : null}

      <div className="flex flex-wrap gap-3">
        <Button type="button" onClick={() => void submit()} disabled={!ready || busy}>
          {busy ? dict.booking.savingAddress : initial === undefined ? dict.booking.saveAddress : dict.portal.saveAddress}
        </Button>
        {onCancel !== undefined ? (
          <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
            {dict.common.cancel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
