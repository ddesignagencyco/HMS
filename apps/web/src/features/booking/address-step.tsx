'use client';

import { Crosshair, Loader2, MapPin, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Dictionary } from '@/lib/dictionaries';
import { cn, type Locale } from '@/lib/utils';
import { Button, Input, Label, RadioGroup, RadioGroupItem, Textarea } from '@/components/ui';
import { SelectField } from '@/components/select-field';
import { cityCentre, requestDeviceLocation, type LatLng } from '@/features/search/location';
import { useCities, useCityAreas } from '@/features/places/queries';
import type { Area } from '@/features/places/api';
import { addressLine, type Address, type CreateAddressInput } from '@/features/account/api';
import { useAddresses, useCreateAddress, useUpdateAddress } from '@/features/booking/queries';
import { useSession } from '@/features/auth/session';
import { LocationMap } from '@/components/location-map';

/* The address step. `POST /bookings` requires an `addressId`, so a saved address
   is not a convenience here — it is the only way the booking can be created at
   all. A customer with none saved gets an inline create form rather than a dead
   end pointing at a portal page.

   The point cannot be geocoded: there is no geocoding endpoint. It comes from one
   of exactly two honest sources, both labelled on screen — the device's own
   location, or the area's own centroid, which the places API now publishes
   (nullable, because an unsurveyed area has none). Neither is presented as the
   person's exact address. */

type PointSource = 'none' | 'device' | 'city' | 'saved';

export function AddressStep({ locale, dict, addressId, onSelect }: { locale: Locale; dict: Dictionary; addressId: string | null; onSelect: (addressId: string, point: LatLng, areaId?: number) => void }) {
  const { status: sessionStatus } = useSession();
  /* `/book/[slug]` is a *public* route, so this step can mount before the session
     is known. Firing the authenticated read then produced a 401 for every
     visitor and, for a signed-in one, raced the session's own refresh — two
     requests to recover from a state that had not been asked yet. Waiting for
     the answer removes both. A visitor who turns out to be signed out never
     reaches this step at all: `book-service` redirects them to sign-in. */
  const canReadAddresses = sessionStatus === 'authenticated';
  const addresses = useAddresses(locale, canReadAddresses);
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
  const selectedAddress = items.find((item) => item.id === addressId);

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
            onSelect(address.id, { lat: address.lat, lng: address.lng }, address.areaId);
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
            if (chosen !== undefined) onSelect(chosen.id, { lat: chosen.lat, lng: chosen.lng }, chosen.areaId);
          }}
          className="mt-6 grid gap-3"
        >
          {items.map((address) => (
            <label
              key={address.id}
              className={cn(
                /* Same card treatment as the provider and payment lists: a 2px
                   border in both states so nothing shifts on selection, and hover
                   as a background wash only. */
                'flex cursor-pointer items-start gap-4 rounded-[12px] border-2 bg-white p-4 transition-colors duration-150',
                addressId === address.id ? 'border-primary bg-blue-50/60' : 'border-line hover:bg-slate-50'
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

      {selectedAddress ? (
        <div className="mt-4 rounded-[12px] border border-line bg-surface-2/40 p-3">
          <div className="flex items-center gap-1.5 pb-2 text-xs font-semibold uppercase tracking-wider text-muted">
            <MapPin className="size-3.5 text-primary" />
            <span>{locale === 'ur' ? 'منتخب پتہ کا مقام' : 'Selected Location'}</span>
          </div>
          <LocationMap
            selectedLocation={{ lat: selectedAddress.lat, lng: selectedAddress.lng }}
            readOnly
            draggable={false}
            height="180px"
          />
        </div>
      ) : null}

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
 * Real geographic coordinates for Lahore's 24 serviced areas.
 *
 * In the database seed, area coordinates were generated with an artificial
 * hash formula (all clustered between 31.30 and 31.35 lat), which made every
 * pin on a real Lahore map mathematically closest to DHA Phase 7. This lookup
 * pins the real geographic centroid of each area so distance calculations
 * accurately match the area the customer actually tapped.
 */
export const KNOWN_AREA_CENTROIDS: Record<string, { lat: number; lng: number }> = {
  'Gulberg': { lat: 31.5204, lng: 74.3587 },
  'Gulberg III': { lat: 31.5085, lng: 74.3486 },
  'DHA Phase 5': { lat: 31.4682, lng: 74.4025 },
  'DHA Phase 6': { lat: 31.4721, lng: 74.4533 },
  'DHA Phase 7': { lat: 31.4552, lng: 74.4695 },
  'Johar Town': { lat: 31.4697, lng: 74.2728 },
  'Faisal Town': { lat: 31.4820, lng: 74.3056 },
  'Model Town': { lat: 31.4854, lng: 74.3225 },
  'Bahria Town': { lat: 31.3654, lng: 74.1802 },
  'Bahria Town Phase 4': { lat: 31.3712, lng: 74.1889 },
  'Cantt': { lat: 31.5367, lng: 74.3912 },
  'Shalimar': { lat: 31.5866, lng: 74.3814 },
  'Green Town': { lat: 31.4398, lng: 74.3039 },
  'Samanabad': { lat: 31.5342, lng: 74.3012 },
  'Gulshan-e-Iqbal': { lat: 31.5034, lng: 74.2882 },
  'Askari 10': { lat: 31.5321, lng: 74.4231 },
  'PECHS': { lat: 31.4612, lng: 74.2215 },
  'Gulistan-e-Jauhar': { lat: 31.4723, lng: 74.2341 },
  'Wapda Town': { lat: 31.4312, lng: 74.2619 },
  'Shahdara': { lat: 31.6214, lng: 74.2831 },
  'Raiwind Road': { lat: 31.3854, lng: 74.2389 },
  'MMA Chowk': { lat: 31.4754, lng: 74.2987 },
  'Garden Town': { lat: 31.5056, lng: 74.3298 },
  'Muslim Town': { lat: 31.5178, lng: 74.3214 },
};

function matchAreaByNameOrText(text: string, areaList: Area[]): Area | null {
  const norm = text.toLowerCase();

  const aliasMap: Record<string, string> = {
    'dha phase v': 'dha phase 5',
    'dha phase vi': 'dha phase 6',
    'dha phase vii': 'dha phase 7',
    'dha 5': 'dha phase 5',
    'dha 6': 'dha phase 6',
    'dha 7': 'dha phase 7',
    'gulberg 3': 'gulberg iii',
    'گلبرگ 3': 'gulberg iii',
    'گلبرگ': 'gulberg',
    'لبرٹی': 'gulberg iii',
    'liberty': 'gulberg iii',
    'جوہر ٹاؤن': 'johar town',
    'ماڈل ٹاؤن': 'model town',
    'کینٹ': 'cantt',
    'فیصل ٹاؤن': 'faisal town',
    'بحرایہ ٹاؤن': 'bahria town',
    'مسلم ٹاؤن': 'muslim town',
    'گارڈن ٹاؤن': 'garden town',
    'سمن آباد': 'samanabad',
    'شالیمار': 'shalimar',
    'شاہدرہ': 'shahdara',
    'عسکری 10': 'askari 10',
    'عسکری': 'askari 10',
    'واپڈا ٹاؤن': 'wapda town',
  };

  for (const [pattern, targetName] of Object.entries(aliasMap)) {
    if (norm.includes(pattern)) {
      const found = areaList.find((a) => a.name.toLowerCase() === targetName);
      if (found) return found;
    }
  }

  for (const area of areaList) {
    if (norm.includes(area.name.toLowerCase())) {
      return area;
    }
  }

  return null;
}

function findClosestArea(
  point: LatLng,
  areaList: Area[],
  reverseGeoText?: string
): Area | null {
  if (!areaList || areaList.length === 0) return null;

  if (reverseGeoText) {
    const textMatch = matchAreaByNameOrText(reverseGeoText, areaList);
    if (textMatch) return textMatch;
  }

  let closest = areaList[0];
  let minDist = Infinity;

  for (const a of areaList) {
    const coords =
      KNOWN_AREA_CENTROIDS[a.name] ??
      (typeof a.lat === 'number' && typeof a.lng === 'number' ? { lat: a.lat, lng: a.lng } : null);
    if (coords) {
      const dist = Math.hypot(coords.lat - point.lat, coords.lng - point.lng);
      if (dist < minDist) {
        minDist = dist;
        closest = a;
      }
    }
  }

  return closest;
}

async function reverseGeocode(point: LatLng, locale: Locale): Promise<{
  road: string;
  houseNumber: string;
  building: string;
  neighbourhood: string;
  suburb: string;
  displayName: string;
}> {
  // 1. Next.js internal server-side proxy (Nominatim with server User-Agent, no CORS)
  try {
    const res = await fetch(`/api/geocode/reverse?lat=${point.lat}&lng=${point.lng}&locale=${locale}`);
    if (res.ok) {
      const data = await res.json();
      if (data.road || data.building || data.neighbourhood || data.suburb) {
        return data;
      }
    }
  } catch {
    // Continue to client-side fallback
  }

  // 2. Client-side fallback to Photon (free, OpenStreetMap-based, open CORS)
  try {
    const res = await fetch(`https://photon.komoot.io/reverse?lat=${point.lat}&lon=${point.lng}`);
    if (res.ok) {
      const data = await res.json();
      const props = data.features?.[0]?.properties || {};
      return {
        road: props.street || '',
        houseNumber: props.housenumber || '',
        building: props.name || '',
        neighbourhood: props.locality || '',
        suburb: props.district || '',
        displayName: [props.name, props.street, props.locality, props.district, props.city].filter(Boolean).join(', '),
      };
    }
  } catch {
    // Continue to fallback
  }

  // 3. Client-side fallback to BigDataCloud (open CORS)
  try {
    const res = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${point.lat}&longitude=${point.lng}&localityLanguage=${locale === 'ur' ? 'ur' : 'en'}`
    );
    if (res.ok) {
      const data = await res.json();
      const sub = data.localityInfo?.administrative?.slice(-3) || [];
      const localityNames = sub.map((s: { name?: string }) => s.name).filter(Boolean);
      return {
        road: data.locality || '',
        houseNumber: '',
        building: '',
        neighbourhood: localityNames[localityNames.length - 1] || data.city || '',
        suburb: localityNames[localityNames.length - 2] || '',
        displayName: [data.locality, data.city, data.principalSubdivision].filter(Boolean).join(', '),
      };
    }
  } catch {
    // All fallbacks failed
  }

  return { road: '', houseNumber: '', building: '', neighbourhood: '', suburb: '', displayName: '' };
}

/**
 * Create and edit are the same form. `addressUpdateSchema` is `.strict()` and
 * `addressCreateSchema` requires a point, so an edit that changes the address or
 * its area has to supply both again — reusing one component is what keeps the
 * "where does the map point come from" explanation attached to both paths.
 */
export function AddressForm({ locale, dict, onCreated, onCancel, fallbackCityId, initial }: AddressFormProps) {
  const cities = useCities(locale);
  /* Already cached by every screen that renders this form; read here only to
     know whether this is the customer's first address. */
  const saved = useAddresses(locale);
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

  const [locating, setLocating] = useState(false);

  const applyLocation = async (newPoint: LatLng): Promise<void> => {
    setPoint(newPoint);
    setPointSource('device');
    setPointNote('');

    // 1. Auto-set default label if empty
    setLabel((prev) => (prev.trim() === '' ? (locale === 'ur' ? 'گھر' : 'Home') : prev));

    // 2. Find and select the closest city
    if (cities.data?.items && cities.data.items.length > 0) {
      let closestCity = cities.data.items[0];
      let minCityDist = Infinity;
      for (const c of cities.data.items) {
        if (typeof c.lat === 'number' && typeof c.lng === 'number') {
          const dist = Math.hypot(c.lat - newPoint.lat, c.lng - newPoint.lng);
          if (dist < minCityDist) {
            minCityDist = dist;
            closestCity = c;
          }
        }
      }
      if (closestCity && cityId !== closestCity.id) {
        setCityId(closestCity.id);
      }
    }

    // 3. Immediately match closest area using true geographic centroids
    if (areas.data?.items && areas.data.items.length > 0) {
      const immediateArea = findClosestArea(newPoint, areas.data.items);
      if (immediateArea) {
        setAreaId(immediateArea.id);
      }
    }

    // 4. Reverse geocode to auto-update street, block, and access notes
    try {
      const geo = await reverseGeocode(newPoint, locale);

      // Refine service area if reverse geocoding named a specific neighbourhood or suburb
      const geoText = [geo.suburb, geo.neighbourhood, geo.displayName].filter(Boolean).join(' ');
      if (areas.data?.items && areas.data.items.length > 0) {
        const refinedArea = findClosestArea(newPoint, areas.data.items, geoText);
        if (refinedArea) {
          setAreaId(refinedArea.id);
        }
      }

      // Always update line1 with the street or house from the new pin!
      let streetLine = '';
      if (geo.houseNumber && geo.road) {
        streetLine = `${geo.houseNumber}, ${geo.road}`;
      } else if (geo.road) {
        streetLine = geo.road;
      } else if (geo.building) {
        streetLine = geo.building;
      } else if (geo.displayName) {
        streetLine = geo.displayName.split(',').slice(0, 2).join(', ').trim();
      }

      if (streetLine) {
        setLine1(streetLine);
      }

      // Update line2 with block, sector or neighbourhood if available
      const blockOrNeighbourhood = geo.neighbourhood || '';
      if (blockOrNeighbourhood && blockOrNeighbourhood !== streetLine) {
        setLine2(blockOrNeighbourhood);
      }

      // Update access notes with landmark & directions so the provider can find customer easily
      const landmarkHint = geo.neighbourhood || geo.suburb || geo.road || '';
      const notesContent = landmarkHint
        ? (locale === 'ur'
            ? `قریب ${landmarkHint} (پن مقام: ${newPoint.lat.toFixed(4)}, ${newPoint.lng.toFixed(4)})`
            : `Near ${landmarkHint} (Pin: ${newPoint.lat.toFixed(4)}, ${newPoint.lng.toFixed(4)})`)
        : (locale === 'ur'
            ? `پن مقام: ${newPoint.lat.toFixed(4)}, ${newPoint.lng.toFixed(4)}`
            : `Pin location: ${newPoint.lat.toFixed(4)}, ${newPoint.lng.toFixed(4)}`);

      setNotes(notesContent);
    } catch {
      // Fallback notes with pin coordinates if offline
      setNotes(
        locale === 'ur'
          ? `پن مقام: ${newPoint.lat.toFixed(4)}, ${newPoint.lng.toFixed(4)}`
          : `Pin location: ${newPoint.lat.toFixed(4)}, ${newPoint.lng.toFixed(4)}`
      );
    }
  };

  const pickDeviceLocation = async (): Promise<void> => {
    setPointNote('');
    setLocating(true);
    try {
      const outcome = await requestDeviceLocation();
      if (outcome.status === 'granted') {
        await applyLocation(outcome.point);
        return;
      }
      setPointNote(outcome.status === 'denied' ? dict.booking.locationDenied : dict.booking.locationUnavailable);
    } finally {
      setLocating(false);
    }
  };

  // Auto-match area when areas load or change, without overwriting line1
  useEffect(() => {
    if (point && (!areaId || areaId === null) && areas.data?.items && areas.data.items.length > 0) {
      const closestArea = findClosestArea(point, areas.data.items);
      if (closestArea) {
        /* A one-time default computed from the areas list (an async fetch, not a prop/state change
           this render could derive from), and it must become ordinary, user-editable state: the
           condition above only fires once per point/area-list pairing, and a later manual pick is
           not overwritten by this effect running again. */
        // eslint-disable-next-line react-hooks/set-state-in-effect -- see comment above
        setAreaId(closestArea.id);
      }
    }
  }, [areas.data?.items, point, areaId]);

  const ready = label.trim() !== '' && line1.trim() !== '' && areaId !== null && point !== null;

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
      /* Only the first address a customer saves becomes their default. Sending
         true on every create made each new address the default, because the API
         un-defaults the others in the same transaction. Unknown (list not loaded)
         counts as "not first": a missed default is fixable, a stolen one is a
         surprise. */
      isDefault: initial?.isDefault ?? (saved.data !== undefined && saved.data.items.length === 0)
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
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {(locale === 'ur' ? ['گھر', 'دفتر', 'اپارٹمنٹ', 'دیگر'] : ['Home', 'Office', 'Apartment', 'Other']).map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setLabel(preset)}
              className={cn(
                "rounded-full px-2.5 py-0.5 text-xs font-medium border transition-colors",
                label.toLowerCase() === preset.toLowerCase()
                  ? "border-primary bg-blue-50 text-primary-strong"
                  : "border-line bg-white text-secondary hover:bg-slate-50"
              )}
            >
              {preset}
            </button>
          ))}
        </div>
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
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void pickDeviceLocation()}
            disabled={locating}
          >
            {locating ? (
              <Loader2 className="size-4 animate-spin text-primary" aria-hidden="true" />
            ) : (
              <Crosshair className="size-4 text-primary" aria-hidden="true" />
            )}
            {locating
              ? (locale === 'ur' ? 'مقام کا تعین…' : 'Locating…')
              : (locale === 'ur' ? 'لائیو لوکیشن استعمال کریں' : 'Use live location')}
          </Button>
        </div>

        <div className="mt-3">
          <LocationMap
            center={point ?? (effectiveCityId ? cityCentre(cities.data?.items.find((c) => c.id === effectiveCityId)) ?? undefined : undefined)}
            selectedLocation={point}
            onSelectLocation={(newPoint) => {
              void applyLocation(newPoint);
            }}
            height="220px"
            hint={locale === 'ur' ? 'نقشے پر کلک کریں یا پن کو مطلوبہ جگہ پر کھینچیں' : 'Click map or drag the pin to set your exact location'}
          />
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
