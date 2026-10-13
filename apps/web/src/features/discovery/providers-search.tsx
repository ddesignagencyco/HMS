"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { BadgeCheck, LocateFixed, Loader2, MapPin, RotateCcw, Search, SearchX, SlidersHorizontal, Star, X } from "lucide-react";
import type { Dictionary } from "@/lib/dictionaries";
import { cn, formatNumber, localizedPath, type Locale } from "@/lib/utils";
import { Button, Input, buttonStyles } from "@/components/ui";
import { FilterDrawer, filterLabels } from "@/components/ui/filter";
import { SelectField } from "@/components/select-field";
import { useAllServices, useCategories, useCategoryServices } from "@/features/catalogue/queries";
import { useCities, useCityAreas } from "@/features/places/queries";
import { useProviderSearch } from "@/features/search/queries";
import { searchApi, type ProviderDetail, type ProviderSearchResult } from "@/features/search/api";
import { publicKeys, FRESHNESS } from "@/lib/api/keys";
import { areaCentroid, cityCentre, ratingOf, requestDeviceLocation } from "@/features/search/location";
import {
  buildSearchParams,
  EMPTY_SEARCH,
  isSearchable,
  parseSearchState,
  type ParsedSearchState,
  type ProviderRefinement,
  type ProviderSearchFilters,
} from "@/features/search/types";
import { isPriceBandValid } from "@/features/search/api";
import { ProviderCard, ProviderCardSkeleton } from "./provider-card";
import { EmptyState, InlineError, RefreshingNote } from "./states";
import { LocationMap } from "@/components/location-map";
import { SearchRefinements } from "./search-refinements";

/* Provider search backed by `GET /search/providers`.
   Handles service, location coordinates, and server refinements. */

type ServiceOption = { value: string; label: string; group: string };
type SortKey = "default" | "distance" | "rating" | "price_asc" | "price_desc" | "experience";

/** Nothing narrowed — the state a cleared panel returns to. */
const EMPTY_REFINEMENT: ProviderRefinement = {};

export function ProvidersSearch({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [locating, setLocating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  /* Client-side result controls: sorting, rating threshold, badge and in-result keyword filter */
  const [sortBy, setSortBy] = useState<SortKey>("default");
  const [minRating, setMinRating] = useState<number>(0);
  const [badgeOnly, setBadgeOnly] = useState<boolean>(false);
  const [query, setQuery] = useState<string>("");

  /* The five the server actually filters on. Local state, deliberately — a
     shared link should carry the service and the place, not the fact that
     somebody had a price band half-typed. */
  const [refinement, setRefinement] = useState<ProviderRefinement>(EMPTY_REFINEMENT);

  const state = useMemo(() => parseSearchState(new URLSearchParams(searchParams.toString())), [searchParams]);

  const cities = useCities(locale);
  const areas = useCityAreas(state.cityId, locale);

  /* Service options come from the catalogue itself rather than a hardcoded
     list. Which category is being browsed is temporary UI state; the chosen
     *service* is what belongs in the URL, so only that is persisted. */
  const categories = useCategories(locale);
  /* "All categories" is the default view, mirroring /services. */
  const [browseCategory, setBrowseCategory] = useState<string>("ALL");
  const ALL_CATEGORIES = "ALL";
  /* `null` disables the query; `useCategoryServices` is enabled on a non-empty
     slug, and ALL has no slug. */
  const listingSlug = browseCategory === ALL_CATEGORIES ? null : browseCategory;
  const listed = useCategoryServices(listingSlug, locale);
  /* The whole catalogue, used for the "All categories" service list so the
     customer can pick any trade without first choosing a category. */
  const everything = useAllServices(locale);

  const serviceOptions = useMemo<ServiceOption[]>(() => {
    if (listingSlug === ALL_CATEGORIES || listingSlug === null) {
      if (everything.data === undefined) return [];
      return everything.data.items.map((service) => ({
        value: service.slug,
        label: locale === "ur" ? service.nameUr : service.nameEn,
        group: locale === "ur" ? service.categoryNameUr : service.categoryNameEn,
      }));
    }
    if (listed.data === undefined) return [];
    return listed.data.items.map((service) => ({
      value: service.slug,
      label: locale === "ur" ? service.nameUr : service.nameEn,
      group: categories.data?.items.find((item) => item.slug === listingSlug)?.nameEn ?? "",
    }));
  }, [categories.data, everything.data, listed.data, listingSlug, locale]);

  const serviceName = useMemo(() => {
    const match = serviceOptions.find((option) => option.value === state.serviceSlug);
    return match?.label ?? state.serviceSlug;
  }, [serviceOptions, state.serviceSlug]);

  const push = useCallback(
    (next: ParsedSearchState) => {
      const query = buildSearchParams(next).toString();
      router.replace(query === "" ? localizedPath(locale, "/providers") : `${localizedPath(locale, "/providers")}?${query}`, {
        scroll: false,
      });
    },
    [locale, router],
  );

  const setService = (serviceSlug: string) => push({ ...state, serviceSlug });

  /** Changing the city invalidates the area: an area id means nothing in a
      different city, so it is dropped rather than left to fail.

      A city with no surveyed areas has no centre of its own, so its coordinates
      are dropped too rather than kept from the previous city — a stale point
      would search the wrong place while looking deliberate. The search then
      needs a point, which the screen already says out loud. */
  const setCity = (cityId: string) => {
    const parsed = cityId === "" ? null : Number(cityId);
    const city = cities.data?.items.find((item) => item.id === parsed) ?? null;
    const centre = cityCentre(city);
    push({
      ...state,
      cityId: parsed,
      areaId: null,
      lat: centre?.lat ?? null,
      lng: centre?.lng ?? null,
      source: "city",
    });
  };

  /** An area's own centroid is the most precise point the customer has named, so
      selecting one replaces the city centre rather than only recording an id. */
  const setArea = (areaId: string) => {
    const parsed = areaId === "" ? null : Number(areaId);
    const area = areas.data?.items.find((item) => item.id === parsed) ?? null;
    const centroid = areaCentroid(area);
    push({
      ...state,
      areaId: parsed,
      ...(centroid === null ? {} : { lat: centroid.lat, lng: centroid.lng, source: "city" as const }),
    });
  };

  const applyDeviceLocation = async () => {
    setLocating(true);
    setNotice(null);
    const outcome = await requestDeviceLocation();
    setLocating(false);
    if (outcome.status === "granted") {
      push({ ...state, lat: outcome.point.lat, lng: outcome.point.lng, source: "device" });
      return;
    }
    setNotice(outcome.status === "denied" ? dict.search.locationDenied : dict.search.locationUnavailable);
  };

  const reset = () => push(EMPTY_SEARCH);

  /* A price band the server would reject (422) is not sent at all: the request is
     simply not made, and the panel says why. Sending it would produce an error
     page over a state a person can reach by typing. */
  const defaultCity = cities.data?.items?.[0] ?? null;
  const effectiveLat = state.lat ?? (cityCentre(defaultCity)?.lat ?? 31.5204);
  const effectiveLng = state.lng ?? (cityCentre(defaultCity)?.lng ?? 74.3587);

  const filters = useMemo(() => {
    if (!isSearchable(state)) return null;
    if (!isPriceBandValid(refinement)) return null;
    return { serviceSlug: state.serviceSlug, lat: state.lat, lng: state.lng, ...refinement } satisfies ProviderSearchFilters;
  }, [state, refinement]);
  const results = useProviderSearch(filters, locale);

  /* When no specific service is selected in URL, fetch initial providers across representative services of active categories */
  const representativeServices = useMemo(() => {
    if (state.serviceSlug !== "") return [];
    if (browseCategory !== ALL_CATEGORIES) {
      const catServices = listed.data?.items ?? [];
      return catServices.length > 0 ? catServices.slice(0, 3).map((s) => s.slug) : [];
    }
    const all = everything.data?.items ?? [];
    if (!all.length) return ["leak-repair"];
    const seen = new Set<number>();
    const slugs: string[] = [];
    for (const s of all) {
      if (s.categoryId && !seen.has(s.categoryId)) {
        seen.add(s.categoryId);
        slugs.push(s.slug);
      }
      if (slugs.length >= 6) break;
    }
    return slugs.length > 0 ? slugs : ["leak-repair"];
  }, [state.serviceSlug, browseCategory, listed.data, everything.data]);

  const initialProviderQueries = useQueries({
    queries: representativeServices.map((slug) => ({
      queryKey: publicKeys.providerSearch({
        serviceSlug: slug,
        lat: effectiveLat,
        lng: effectiveLng,
        ...refinement,
      }),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        searchApi.searchProviders(
          {
            serviceSlug: slug,
            lat: effectiveLat,
            lng: effectiveLng,
            ...refinement,
          },
          { signal, locale },
        ),
      staleTime: FRESHNESS.search.staleTime,
      enabled: state.serviceSlug === "",
    })),
  });

  const rawResults = useMemo(() => {
    if (state.serviceSlug !== "") {
      return results.data?.items ?? [];
    }
    const seen = new Set<string>();
    const combined: ProviderSearchResult[] = [];
    for (const q of initialProviderQueries) {
      for (const item of q.data?.items ?? []) {
        if (!seen.has(item.providerId)) {
          seen.add(item.providerId);
          combined.push(item);
        }
      }
    }
    return combined;
  }, [state.serviceSlug, results.data, initialProviderQueries]);

  const isSearchPending =
    state.serviceSlug !== ""
      ? results.isPending
      : (everything.isPending && representativeServices.length === 0) ||
        (representativeServices.length > 0 && initialProviderQueries.some((q) => q.isPending));

  const isSearchError =
    state.serviceSlug !== ""
      ? results.isError
      : representativeServices.length > 0 && initialProviderQueries.every((q) => q.isError);

  /** Filters out bulk-loaded providers with numeric IDs instead of UUIDs. */
  const isUuid = (id: string): boolean =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

  const filteredResults = rawResults.filter((p) => isUuid(p.providerId));

  const providerDetails = useQueries({
    queries: filteredResults.map((p) => ({
      queryKey: publicKeys.provider(p.providerId),
      queryFn: ({ signal }: { signal: AbortSignal }) => searchApi.getProvider(p.providerId, { signal, locale }),
      staleTime: FRESHNESS.profile.staleTime,
      enabled: state.areaId !== null,
    })),
  });

  const detailsLoading = state.areaId !== null && providerDetails.some((q) => q.isPending);

  /* Client-side refined results based on sort and filter settings */
  const processedProviders = useMemo(() => {
    if (!filteredResults.length) return [];
    let items = [...filteredResults];

    if (state.areaId !== null && !detailsLoading) {
      items = items.filter((p, index) => {
        const detail = providerDetails[index]?.data as ProviderDetail | undefined;
        if (!detail) return true;
        if (detail.areas && Array.isArray(detail.areas) && detail.areas.length > 0) {
          return detail.areas.some((area) => area.areaId === state.areaId);
        }
        return true;
      });
    }

    if (minRating > 0) {
      items = items.filter((p) => (p.ratingScore ?? 0) >= minRating);
    }

    if (badgeOnly) {
      items = items.filter((p) => p.badge !== null && p.badge.trim() !== "");
    }

    if (query.trim() !== "") {
      const q = query.toLowerCase().trim();
      items = items.filter(
        (p) =>
          (p.qualification?.toLowerCase().includes(q) ?? false) ||
          (p.bio?.toLowerCase().includes(q) ?? false),
      );
    }

    switch (sortBy) {
      case "distance":
        items.sort((a, b) => a.distanceM - b.distanceM);
        break;
      case "rating":
        /* Unrated professionals go last, and the sort is stable among them.
         *
         * `(b.ratingScore ?? 0) - (a.ratingScore ?? 0)` ranked every unrated
         * professional as if the API had published `0.0` — so under "Highest
         * Rated" a provider nobody had rated competed on an equal footing with
         * the worst rated one, and ordering between them was arbitrary. Every
         * other render path in the app goes through `ratingOf`, whose comment
         * says a null score "is not a rating" and that `0.0` "would be a claim
         * the API did not make". Unrated is not zero; it sorts last. */
        items.sort((a, b) => {
          const left = ratingOf(a.ratingScore);
          const right = ratingOf(b.ratingScore);
          if (!left.rated && !right.rated) return 0;
          if (!left.rated) return 1;
          if (!right.rated) return -1;
          return right.score - left.score;
        });
        break;
      case "price_asc":
        items.sort((a, b) => a.pricePaisa - b.pricePaisa);
        break;
      case "price_desc":
        items.sort((a, b) => b.pricePaisa - a.pricePaisa);
        break;
      case "experience":
        items.sort((a, b) => (b.experienceYears ?? 0) - (a.experienceYears ?? 0));
        break;
      default:
        break;
    }

    return items;
  }, [filteredResults, minRating, badgeOnly, query, sortBy]);

  const hasResultFilters = minRating > 0 || badgeOnly || query.trim() !== "" || sortBy !== "default";
  const resetResultFilters = () => {
    setMinRating(0);
    setBadgeOnly(false);
    setQuery("");
    setSortBy("default");
  };

  const sortOptions = [
    { value: "default", label: locale === "ur" ? "تجویز کردہ (سسٹم ترتیب)" : "Recommended (Best Match)" },
    { value: "distance", label: locale === "ur" ? "فاصلہ: قریب ترین پہلے" : "Distance: Nearest First" },
    { value: "rating", label: locale === "ur" ? "ریٹنگ: سب سے زیادہ" : "Rating: Highest Rated" },
    { value: "price_asc", label: locale === "ur" ? "قیمت: کم سے زیادہ" : "Price: Low to High" },
    { value: "price_desc", label: locale === "ur" ? "قیمت: زیادہ سے کم" : "Price: High to Low" },
    { value: "experience", label: locale === "ur" ? "تجربہ: زیادہ سال" : "Experience: Most Experienced" },
  ];

  const city = cities.data?.items.find((item) => item.id === state.cityId) ?? null;
  const pointLabel =
    state.source === "device"
      ? dict.search.pointFromDevice
      : city !== null
        ? dict.search.pointFromCity.replace("{city}", city.name)
        : dict.search.locationLabel;

  const areaOptions = [
    { value: "", label: state.cityId === null ? dict.search.areaPending : areas.isPending ? dict.search.areaLoading : dict.search.areaPlaceholder },
    ...(areas.data?.items ?? []).map((area) => ({ value: String(area.id), label: area.name })),
  ];

  const serviceValue = state.serviceSlug === "" ? "" : state.serviceSlug;
  /* Either query can be in flight: one while a category is chosen, the other
     while "All categories" is. Without this the list showed an empty
     placeholder for the request that had not come back yet. */
  const servicePending = listingSlug === null ? everything.isPending : listed.isPending;
  const cityValue = state.cityId === null ? "" : String(state.cityId);
  const areaValue = state.areaId === null ? "" : String(state.areaId);

  /* One label set for the drawer, from the shared dictionary, so the copy on the
     filter panel is the same here as on every other filtered screen. */
  const labels = filterLabels(dict.common);
  const activeFilterCount =
    [state.serviceSlug !== "", state.cityId !== null, state.areaId !== null].filter(Boolean).length +
    Object.values(refinement).filter((value) => value !== undefined).length;

  const filterBody = (
    <div className="grid gap-4">
      {categories.data !== undefined && categories.data.items.length > 0 ? (
        <div className="grid gap-2">
          <label htmlFor="search-category" className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
            {dict.catalogue.categoriesHeading}
          </label>
          <SelectField
            id="search-category"
            value={browseCategory}
            onChange={(val) => setBrowseCategory(val)}
            /* "All categories" first, exactly as `/services` opens on the whole
               catalogue. Selecting it swaps the service list below to every
               service in the catalogue rather than leaving the previous
               category's list on screen. */
            options={[
              { value: ALL_CATEGORIES, label: dict.catalogue.allCategories },
              ...categories.data.items.map((category) => ({
                value: category.slug,
                label: locale === "ur" ? category.nameUr : category.nameEn,
              })),
            ]}
            placeholder={dict.catalogue.allCategories}
          />
        </div>
      ) : null}

      <div className="grid gap-2">
        <label htmlFor="search-service" className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
          {dict.search.serviceLabel}
        </label>
        <SelectField
          id="search-service"
          value={serviceValue}
          onChange={setService}
          options={[
            { value: "", label: servicePending ? "…" : dict.search.servicePlaceholder },
            ...serviceOptions.map((option) => ({ value: option.value, label: option.label })),
          ]}
          placeholder={dict.search.servicePlaceholder}
        />
        {/* "No services" is only meaningful for a real category. With "All
            categories" selected an empty list means the catalogue itself is
            empty, which the page states differently. */}
        {listingSlug !== null && listed.data !== undefined && listed.data.items.length === 0 ? (
          <p className="text-xs text-muted">{dict.catalogue.noServices}</p>
        ) : null}
      </div>

      <div className="grid gap-2">
        <label htmlFor="search-city" className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
          {dict.search.cityLabel}
        </label>
        <SelectField
          id="search-city"
          value={cityValue}
          onChange={setCity}
          options={[
            { value: "", label: dict.search.cityPlaceholder },
            ...(cities.data?.items ?? []).map((item) => ({ value: String(item.id), label: item.name })),
          ]}
          placeholder={dict.search.cityPlaceholder}
        />
      </div>

      <div className="grid gap-2">
        <label htmlFor="search-area" className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-muted">
          <MapPin className="size-3.5" aria-hidden="true" />
          {dict.search.areaLabel}
        </label>
        <SelectField
          id="search-area"
          value={areaValue}
          onChange={setArea}
          /* Disabled only while there is genuinely nothing to choose from. While
             the areas are in flight the control stays live and says so, because a
             disabled dropdown is a dead click target with no explanation. */
          isDisabled={state.cityId === null}
          options={areaOptions}
          placeholder={state.cityId === null ? dict.search.areaPending : areas.isPending ? dict.search.areaLoading : dict.search.areaPlaceholder}
        />
        {/* An area *is* used as the search point — `setArea` takes its centroid,
            which is more precise than the city centre. This line used to claim the
            API returned no coordinates for an area, so the control was described as
            useless while it was in fact the sharpest filter on the form. */}
        <p className="text-xs leading-5 text-muted">{dict.search.areaHint}</p>
      </div>

      <div className="grid gap-2 border-t border-line pt-4">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">{dict.search.locationLabel}</p>
        <p className="text-sm text-navy">{pointLabel}</p>
        <Button type="button" variant="secondary" size="sm" onClick={() => void applyDeviceLocation()} disabled={locating} className="w-full">
          {locating ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <LocateFixed className="size-3.5" aria-hidden="true" />}
          {locating ? dict.search.locating : dict.search.useMyLocation}
        </Button>
        {notice !== null ? (
          <p role="status" className="text-xs leading-5 text-amber-800">
            {notice}
          </p>
        ) : null}
      </div>

      <SearchRefinements
        locale={locale}
        dict={dict}
        value={refinement}
        onChange={setRefinement}
        disabled={!isSearchable(state)}
      />

      <Button type="button" variant="ghost" size="sm" onClick={reset} className="w-full">
        <RotateCcw className="size-3.5" aria-hidden="true" />
        {dict.search.resetFilters}
      </Button>
    </div>
  );

  return (
    <div className="relative">
      {/* Top Search & Controls Bar (Matching catalogue-explorer.tsx) */}
      <div className="mb-8 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          {/* Real-time Search Box */}
          <div className="relative flex-1">
            <label htmlFor="provider-search-input" className="sr-only">
              {locale === "ur" ? "پیشہ ور تلاش کریں" : "Search professionals"}
            </label>
            <div className="pointer-events-none absolute inset-y-0 start-0 flex items-center ps-3.5 text-slate-400">
              <Search className="size-4.5" aria-hidden="true" />
            </div>
            <input
              id="provider-search-input"
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                locale === "ur"
                  ? "پیشہ ور، ہنر، یا قابلیت تلاش کریں (مثلاً: پلمبر، الیکٹریشن، لائسنس یافتہ...)"
                  : "Search professionals by name, skill, bio, or trade (e.g. Plumber, Electrician, Licensed...)"
              }
              className="w-full rounded-xl border border-slate-200 bg-slate-50/60 py-2.5 pe-9 ps-10 text-sm font-medium text-navy placeholder:text-slate-400 focus:border-slate-400 focus:bg-white focus:outline-none focus:ring-0 transition-colors"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute inset-y-0 end-0 flex items-center pe-3 text-slate-400 hover:text-navy focus:outline-none"
                aria-label={dict.common.clearFilters}
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            )}
          </div>

          {/* Quick Controls: Map View, Mobile Filter Toggle, and Sort Selector */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Map View Toggle Button */}
            <Button
              type="button"
              variant={showMap ? "primary" : "secondary"}
              size="sm"
              onClick={() => setShowMap(!showMap)}
              className="gap-1.5 rounded-xl h-10 px-3.5 text-xs font-semibold"
            >
              <MapPin className="size-3.5" aria-hidden="true" />
              {showMap
                ? (locale === "ur" ? "نقشہ چھپائیں" : "Hide Map")
                : (locale === "ur" ? "نقشہ دیکھیں" : "Map View")}
            </Button>

            {/* Mobile Filter Toggle */}
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              className="inline-flex lg:hidden items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 h-10 text-xs font-semibold text-navy shadow-sm transition hover:bg-slate-50 focus:outline-none"
            >
              <SlidersHorizontal className="size-3.5 text-slate-600" aria-hidden="true" />
              <span>{dict.search.openFilters}</span>
              {activeFilterCount > 0 && (
                <span className="grid size-5 place-items-center rounded-full bg-navy text-[11px] font-bold text-white">
                  {activeFilterCount}
                </span>
              )}
            </button>

            {/* Sort Dropdown */}
            <div className="flex items-center gap-2 ms-auto sm:ms-0">
              <span className="hidden sm:inline text-xs font-semibold uppercase tracking-wider text-muted">
                {dict.services.sort}:
              </span>
              <div className="w-[185px]">
                <SelectField
                  id="provider-sort-select"
                  value={sortBy}
                  onChange={(val) => setSortBy(val as SortKey)}
                  options={sortOptions}
                  placeholder={dict.services.sort}
                  size="sm"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Quick Filter Bar: Rating & Badges */}
        <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted me-1">
              {locale === "ur" ? "ریٹنگ:" : "Rating:"}
            </span>
            <button
              type="button"
              onClick={() => setMinRating(0)}
              className={cn(
                "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                minRating === 0 ? "bg-navy text-white" : "bg-white text-secondary hover:bg-slate-100 border border-line"
              )}
            >
              {locale === "ur" ? "تمام" : "All"}
            </button>
            <button
              type="button"
              onClick={() => setMinRating(4.0)}
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                minRating === 4.0 ? "bg-navy text-white" : "bg-white text-secondary hover:bg-slate-100 border border-line"
              )}
            >
              <Star className="size-3 fill-amber-400 text-amber-400" aria-hidden="true" />
              4.0+
            </button>
            <button
              type="button"
              onClick={() => setMinRating(4.5)}
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                minRating === 4.5 ? "bg-navy text-white" : "bg-white text-secondary hover:bg-slate-100 border border-line"
              )}
            >
              <Star className="size-3 fill-amber-400 text-amber-400" aria-hidden="true" />
              4.5+
            </button>

            <button
              type="button"
              onClick={() => setBadgeOnly(!badgeOnly)}
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ms-1.5",
                badgeOnly ? "bg-navy text-white" : "bg-white text-secondary hover:bg-slate-100 border border-line"
              )}
            >
              <BadgeCheck className="size-3.5 text-blue-500" aria-hidden="true" />
              {locale === "ur" ? "صرف تصدیق شدہ بیج" : "Verified Badge Only"}
            </button>
          </div>

          {hasResultFilters ? (
            <Button type="button" variant="ghost" size="sm" onClick={resetResultFilters} className="h-7 text-xs text-muted hover:text-navy">
              <RotateCcw className="size-3 me-1" aria-hidden="true" />
              {locale === "ur" ? "فلٹرز صاف کریں" : "Reset filters"}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-12">
        <aside className="hidden lg:sticky lg:top-[calc(var(--demo-bar-h,0px)+1.5rem)] lg:block lg:self-start">
          <h2 className="eyebrow eyebrow-light">{dict.search.filtersHeading}</h2>
          <div className="mt-4">{filterBody}</div>
        </aside>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-[20px] font-semibold tracking-[-0.03em] text-navy">
                {state.serviceSlug === ""
                  ? (locale === "ur" ? "تمام دستیاب تصدیق شدہ پیشہ ور" : "All Available Verified Professionals")
                  : filteredResults.length === 0
                    ? dict.search.noResultsTitle
                    : filteredResults.length === 1
                      ? dict.search.resultsHeadingOne
                      : dict.search.resultsHeading.replace("{count}", formatNumber(filteredResults.length, locale))}
              </h2>
              <p className="mt-1 text-sm text-secondary">
                {state.serviceSlug !== ""
                  ? dict.search.resultsFor.replace("{service}", serviceName)
                  : (locale === "ur"
                      ? "فہرست میں سے پیشہ ور چنیں یا فلٹرز سے تلاش محدود کریں"
                      : `Showing ${formatNumber(processedProviders.length, locale)} verified specialists ready to book`)}
              </p>
            </div>

            <div className="flex items-center gap-2">
              {results.isFetching && !results.isPending ? <RefreshingNote dict={dict} /> : null}
            </div>
          </div>

          {sheetOpen ? (
            <FilterDrawer
              open={sheetOpen}
              labels={labels}
              activeCount={activeFilterCount}
              onClose={() => setSheetOpen(false)}
              onApply={() => setSheetOpen(false)}
              onReset={reset}
            >
              {filterBody}
            </FilterDrawer>
          ) : null}

          {showMap ? (
            <div className="my-5 overflow-hidden rounded-[14px] border border-line bg-white p-3 shadow-xs">
              <div className="mb-2.5 flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-navy">
                  <MapPin className="size-4 text-primary" />
                  <span>{locale === "ur" ? "انٹرایکٹو تلاش کا نقشہ" : "Interactive Search Map"}</span>
                </div>
                <span className="text-xs text-muted">
                  {locale === "ur" ? "مقام تبدیل کرنے کے لیے نقشے پر کلک کریں" : "Click or drag pin to adjust search location"}
                </span>
              </div>
              <LocationMap
                center={state.lat !== null && state.lng !== null ? { lat: state.lat, lng: state.lng } : (city?.lat != null && city?.lng != null ? { lat: city.lat, lng: city.lng } : undefined)}
                selectedLocation={state.lat !== null && state.lng !== null ? { lat: state.lat, lng: state.lng } : null}
                onSelectLocation={(pt) => {
                  push({ ...state, lat: pt.lat, lng: pt.lng, source: "device" });
                }}
                height="320px"
                hint={locale === "ur" ? "نئے مقام کے لیے نقشے پر کلک کریں" : "Click or drag pin to update your search area"}
              />
            </div>
          ) : null}

          <div className="mt-6">
            {isSearchPending ? (
              <div className="grid gap-4 sm:grid-cols-2">
                {Array.from({ length: 4 }, (_, index) => (
                  <ProviderCardSkeleton key={index} />
                ))}
              </div>
            ) : isSearchError ? (
              <InlineError
                title={dict.search.loadError}
                actionLabel={dict.catalogue.retry}
                onRetry={() => {
                  if (state.serviceSlug !== "") void results.refetch();
                  else initialProviderQueries.forEach((q) => void q.refetch());
                }}
              />
            ) : processedProviders.length === 0 ? (
              <EmptyState
                title={dict.search.noResultsTitle}
                body={dict.search.noResultsText}
                icon={<SearchX className="size-8" aria-hidden="true" />}
                action={
                  <Button type="button" variant="secondary" onClick={() => void applyDeviceLocation()} disabled={locating}>
                    {dict.search.useMyLocation}
                  </Button>
                }
              />
            ) : (
              <>
                <div className={cn("grid gap-4 sm:grid-cols-2")}>
                  {processedProviders.map((provider) => (
                    <ProviderCard key={provider.providerId} locale={locale} dict={dict} provider={provider} serviceName={serviceName} />
                  ))}
                </div>
                <p className="mt-6 text-xs text-muted">{dict.search.resultCountNote}</p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
