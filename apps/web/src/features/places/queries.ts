import { useQuery } from "@tanstack/react-query";
import { ApiError } from "@/lib/api/problem";
import { FRESHNESS, publicKeys, publicRetry } from "@/lib/api/keys";
import type { Locale } from "@/lib/utils";
import { placesApi } from "./api";

/* Cities and areas are effectively static reference data: one attempt, a long
   stale window, no polling. Areas are fetched only once a city exists, so the
   dependent request can never fire with a missing city. */

export function useCities(locale: Locale) {
  return useQuery({
    queryKey: publicKeys.cities,
    queryFn: ({ signal }) => placesApi.listCities({ signal, locale }),
    staleTime: FRESHNESS.places.staleTime,
    gcTime: FRESHNESS.places.gcTime,
    retry: publicRetry,
  });
}

export function useCityAreas(cityId: number | null, locale: Locale) {
  return useQuery({
    queryKey: publicKeys.areas(cityId ?? 0),
    queryFn: ({ signal }) => placesApi.listAreas(cityId as number, { signal, locale }),
    enabled: cityId !== null && cityId > 0,
    staleTime: FRESHNESS.places.staleTime,
    gcTime: FRESHNESS.places.gcTime,
    retry: (failureCount, error) => !(error instanceof ApiError && error.status === 404) && publicRetry(failureCount, error),
  });
}