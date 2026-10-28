/* Where the point in a provider search comes from.

   `/search/providers` takes `lat` and `lng`, and both are published by the places
   module: `GET /places/cities` returns the centre of the areas it contains, and
   `GET /places/cities/:cityId/areas` returns each area's own centroid — both as
   nullable `lat`/`lng` (places.service.ts projects `ST_Y`/`ST_X` out of the
   geometry). This file used to hold a hardcoded Lahore coordinate and a comment
   claiming the API published no coordinates at all; both are now wrong, and the
   coordinate is gone rather than kept as a fallback, because an invented point
   silently searches the wrong place and looks authoritative.

   So a search point comes from exactly two sources, and both are labelled in the
   UI:

     1. The person's own device location, asked for explicitly.
     2. The API's own centre for the city or area they picked.

   A null centroid is not a reason to guess one. It means this area has not been
   surveyed, and the caller shows that rather than searching somewhere else. */

export type LatLng = { lat: number; lng: number };

export const isPlausibleCoordinate = (value: LatLng): boolean =>
  Number.isFinite(value.lat) && Number.isFinite(value.lng) && Math.abs(value.lat) <= 90 && Math.abs(value.lng) <= 180;

/**
 * The API's own point for a row, or null when it has none.
 *
 * Both coordinates must be present, finite and in range: a row with `lat` but a
 * null `lng` is half a location, not a location, and searching on it would put
 * the customer in the middle of the ocean.
 */
export const apiPoint = (lat: number | null | undefined, lng: number | null | undefined): LatLng | null => {
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  const point = { lat, lng };
  return isPlausibleCoordinate(point) ? point : null;
};

/** `GET /places/cities` — the centre of a city, or null if it has no surveyed area. */
export const cityCentre = (city: { lat: number | null; lng: number | null } | null | undefined): LatLng | null =>
  city === null || city === undefined ? null : apiPoint(city.lat, city.lng);

/**
 * `GET /places/cities/:cityId/areas` — an area's own centroid, which is the
 * smallest location a customer can name and therefore the point an address
 * without an exact location should use.
 */
export const areaCentroid = (area: { lat: number | null; lng: number | null } | null | undefined): LatLng | null =>
  area === null || area === undefined ? null : apiPoint(area.lat, area.lng);

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

/* ---- Ratings -------------------------------------------------------------
   `ratingScore` (search) and `Reputation.score` are both null for a provider
   nobody has rated, and they are ranked on anyway. One helper decides what that
   looks like, so no screen can invent its own: `0.0`, `NaN` and a bare star
   would all be claims the API did not make. */

export type RatingPresentation = { rated: true; score: number } | { rated: false };

/**
 * True only when there is a real score to show.
 *
 * `null`, `undefined` and `NaN` all mean "unrated" — the last two cannot come
 * from a correct API but a single unguarded `null` in a JSON pipeline turns into
 * `NaN` two frames later, and `NaN.toFixed(2)` is the string "NaN" on screen.
 */
export const ratingOf = (score: number | null | undefined): RatingPresentation =>
  typeof score === "number" && Number.isFinite(score) ? { rated: true, score } : { rated: false };