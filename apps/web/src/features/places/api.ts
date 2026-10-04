/* GET /places/cities and GET /places/cities/:cityId/areas.

   `AreaRow` carries no coordinates — see docs/BACKEND_REQUIREMENTS.md §2.2 — so an
   area is a label and an id, never a lat/lng pair. */

import { apiRequest } from "@/lib/api/client";
import type { Locale } from "@/lib/utils";

export type City = { id: number; name: string; timezone: string };

export type Area = { id: number; cityId: number; name: string };

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