import { useQuery } from "@tanstack/react-query";
import { ApiError } from "@/lib/api/problem";
import { FRESHNESS, publicKeys, publicRetry } from "@/lib/api/keys";
import type { Locale } from "@/lib/utils";
import { catalogueApi } from "./api";

/* Catalogue is reference data an administrator publishes. It is cached for a
   long time and never polled. A 404 is the API saying the slug does not exist,
   so it is not retried — that is how `/services/[slug]` reaches a not-found
   state instead of an empty page. */

const notFound = (error: unknown): boolean => error instanceof ApiError && error.status === 404;

export function useCategories(locale: Locale) {
  return useQuery({
    queryKey: publicKeys.categories,
    queryFn: ({ signal }) => catalogueApi.listCategories({ signal, locale }),
    staleTime: FRESHNESS.categories.staleTime,
    gcTime: FRESHNESS.categories.gcTime,
    retry: publicRetry,
  });
}

export function useCategoryServices(slug: string | null, locale: Locale) {
  return useQuery({
    queryKey: publicKeys.categoryServices(slug ?? ""),
    queryFn: ({ signal }) => catalogueApi.listServicesInCategory(slug ?? "", { signal, locale }),
    /* Never ask for a category that has not been chosen. */
    enabled: slug !== null && slug !== "",
    staleTime: FRESHNESS.categoryServices.staleTime,
    gcTime: FRESHNESS.categoryServices.gcTime,
    retry: (failureCount, error) => !notFound(error) && publicRetry(failureCount, error),
  });
}

export function useService(slug: string, locale: Locale) {
  return useQuery({
    queryKey: publicKeys.service(slug),
    queryFn: ({ signal }) => catalogueApi.getService(slug, { signal, locale }),
    staleTime: FRESHNESS.service.staleTime,
    gcTime: FRESHNESS.service.gcTime,
    retry: (failureCount, error) => !notFound(error) && publicRetry(failureCount, error),
  });
}

export function useAllServices(locale: Locale) {
  return useQuery({
    queryKey: ["public", "all-catalogue-services", locale],
    queryFn: ({ signal }) => catalogueApi.listAllServices({ signal, locale }),
    staleTime: FRESHNESS.categoryServices.staleTime,
    gcTime: FRESHNESS.categoryServices.gcTime,
    retry: publicRetry,
  });
}