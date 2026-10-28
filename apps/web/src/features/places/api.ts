/* GET /places/cities and GET /places/cities/:cityId/areas.

   Both endpoints publish coordinates now. `places.service.ts` projects
   `ST_Y`/`ST_X` out of the geometry: a city's point is the centroid of the
   centroids of its active areas, and an area's is its own.

   Both are `number | null` and that is load-bearing rather than defensive. A city
   whose areas have not all been surveyed has no centre to publish, and an area
   with no surveyed centroid is returned anyway rather than hidden — so a null is
   a real answer meaning "not surveyed yet". These types keep it as null so the
   caller has to decide what to show, and `apiPoint` in `features/search/location`
   refuses a half-supplied pair rather than searching a made-up location. */

import { apiRequest } from "@/lib/api/client";
import type { Locale } from "@/lib/utils";

export type City = {
  id: number;
  name: string;
  timezone: string;
  /** Centre of the city's areas. Null until they have been surveyed. */
  lat: number | null;
  lng: number | null;
};

export type Area = {
  id: number;
  cityId: number;
  name: string;
  /** The area's own centroid. Null when it has not been surveyed. */
  lat: number | null;
  lng: number | null;
};

export type PlacesOptions = { signal?: AbortSignal; locale?: Locale };

const read = <T>(path: string, options: PlacesOptions = {}) =>
  apiRequest<T>(path, {
    method: "GET",
    ...(options.locale === undefined ? {} : { locale: options.locale }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    /* @Public() on the API: no bearer, and no refresh can be triggered by one. */
    auth: false,
    refreshOnExpiry: false,
  });

export const placesApi = {
  listCities: (options?: PlacesOptions) => read<{ items: City[] }>("/places/cities", options),
  listAreas: (cityId: number, options?: PlacesOptions) => read<{ items: Area[] }>(`/places/cities/${cityId}/areas`, options),
};