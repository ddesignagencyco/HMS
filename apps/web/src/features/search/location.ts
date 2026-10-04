/* Where the point in a provider search comes from.

   `/search/providers` takes `lat` and `lng`, and nothing in the public contract
   hands us one: `GET /places/cities` returns an id, a name and a timezone, and
   `GET /places/cities/:cityId/areas` returns an id, a city and a name — no
   coordinates at all, even though `areas.centroid` exists in the database and
   is simply not selected (apps/api/src/places/places.service.ts:20).

   So there are exactly two honest sources, and both are labelled in the UI:

   1. The person's own device location, asked for explicitly.
   2. A city centre, held here as an approximation. Lahore's point is the one
      the API's own OpenAPI description uses as its Lahore example. It is a
      search centre, not a claim about anybody's address.

   Closing this properly needs one line of SQL in the backend — see
   docs/BACKEND_REQUIREMENTS.md §2.2 — not a guess here. */

export type LatLng = { lat: number; lng: number };

/** Approximate centres, keyed by the API's own city name. */
const CITY_CENTRES: Record<string, LatLng> = {
  // The point the API's OpenAPI description uses for its Lahore examples.
  lahore: { lat: 31.5204, lng: 74.3587 },
};

export const cityCentre = (cityName: string): LatLng | null => CITY_CENTRES[cityName.trim().toLowerCase()] ?? null;

export const isPlausibleCoordinate = (value: LatLng): boolean =>
  Number.isFinite(value.lat) && Number.isFinite(value.lng) && Math.abs(value.lat) <= 90 && Math.abs(value.lng) <= 180;

export type GeolocationOutcome =
  | { status: "granted"; point: LatLng }
  | { status: "denied" }
  | { status: "unavailable" };

/**
 * The browser's geolocation, only ever called from a user action. A refusal is
 * a normal answer, not an error to shout about.
 */
export const requestDeviceLocation = (): Promise<GeolocationOutcome> =>
  new Promise((resolve) => {
    if (typeof navigator === "undefined" || navigator.geolocation === undefined) {
      resolve({ status: "unavailable" });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const point = { lat: position.coords.latitude, lng: position.coords.longitude };
        resolve(isPlausibleCoordinate(point) ? { status: "granted", point } : { status: "unavailable" });
      },
      (error) => resolve(error.code === error.PERMISSION_DENIED ? { status: "denied" } : { status: "unavailable" }),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60_000 },
    );
  });

/** Metres, for showing how far a provider's base is from the search point. */
export const formatDistance = (metres: number, locale: string): string => {
  if (!Number.isFinite(metres)) return "";
  if (metres < 1000) return `${Math.round(metres)} m`;
  const km = metres / 1000;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: km < 10 ? 1 : 0 }).format(km)} km`;
};

/**
 * A slot comes back as an ISO instant for a local Asia/Karachi day. Rendering
 * it in the browser's own zone would show the wrong clock to anybody outside
 * Pakistan, so the label is always built in the city's timezone.
 */
export const formatSlotTime = (iso: string, locale: string): string =>
  new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", timeZone: "Asia/Karachi", hour12: undefined }).format(
    new Date(iso),
  );

export const formatSlotDay = (iso: string, locale: string): string =>
  new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Karachi" }).format(
    new Date(iso),
  );