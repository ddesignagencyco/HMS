"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { BadgeCheck, LocateFixed, Loader2, MapPin, RotateCcw, Search, SearchX, SlidersHorizontal, Star, X } from "lucide-react";
import type { Dictionary } from "@/lib/dictionaries";
import { cn, formatNumber, localizedPath, type Locale } from "@/lib/utils";
import { Button, Input, buttonStyles } from "@/components/ui";
import { FilterDrawer, filterLabels } from "@/components/ui/filter";
import { SelectField } from "@/components/select-field";
import { useCategories, useCategoryServices } from "@/features/catalogue/queries";
import { useCities, useCityAreas } from "@/features/places/queries";
import { useProviderSearch } from "@/features/search/queries";
import { areaCentroid, cityCentre, requestDeviceLocation } from "@/features/search/location";
import {
  buildSearchParams,
  EMPTY_SEARCH,
  isSearchable,
  parseSearchState,
  type ParsedSearchState,
  type ProviderSearchFilters,
} from "@/features/search/types";
import { ProviderCard, ProviderCardSkeleton } from "./provider-card";
import { EmptyState, InlineError, RefreshingNote } from "./states";

/* Provider search, backed by `GET /search/providers`.

   That endpoint takes `serviceSlug`, `lat` and `lng` and nothing else — the
   schema is `.strict()`, so a `page` or a `sort` comes back 422. This screen
   therefore offers only a service and a point: no pager, no sorter, no text
   box, and no client-side filtering of the response. The result list is the
   API's ranking, in the API's order.

   Filters live in the URL, so a search survives a refresh, a shared link and
   the back button. The only local state is whether the mobile filter sheet is
   open. */

type ServiceOption = { value: string; label: string; group: string };
type SortKey = "default" | "distance" | "rating" | "price_asc" | "price_desc" | "experience";

export function ProvidersSearch({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [locating, setLocating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  /* Client-side result controls: sorting, rating threshold, badge and in-result keyword filter */
  const [sortBy, setSortBy] = useState<SortKey>("default");
  const [minRating, setMinRating] = useState<number>(0);
  const [badgeOnly, setBadgeOnly] = useState<boolean>(false);
  const [query, setQuery] = useState<string>("");

  const state = useMemo(() => parseSearchState(new URLSearchParams(searchParams.toString())), [searchParams]);

  const cities = useCities(locale);
  const areas = useCityAreas(state.cityId, locale);

  /* Service options come from the catalogue itself rather than a hardcoded
     list. Which category is being browsed is temporary UI state; the chosen
     *service* is what belongs in the URL, so only that is persisted. */
  const categories = useCategories(locale);
  const firstCategory = categories.data?.items[0]?.slug ?? null;
  const [browseCategory, setBrowseCategory] = useState<string | null>(null);
  const listingSlug = browseCategory ?? firstCategory;
  const listed = useCategoryServices(listingSlug, locale);

  const serviceOptions = useMemo<ServiceOption[]>(() => {
    if (listed.data === undefined) return [];
    return listed.data.items.map((service) => ({
      value: service.slug,
      label: locale === "ur" ? service.nameUr : service.nameEn,
      group: categories.data?.items.find((item) => item.slug === listingSlug)?.nameEn ?? "",
    }));
  }, [categories.data, listed.data, listingSlug, locale]);

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

  const filters = useMemo(
    () => (isSearchable(state) ? ({ serviceSlug: state.serviceSlug, lat: state.lat, lng: state.lng }) satisfies ProviderSearchFilters : null),
    [state],
  );
  const results = useProviderSearch(filters, locale);

  /* Client-side refined results based on sort and filter settings */
  const processedProviders = useMemo(() => {
    if (!results.data?.items) return [];
    let items = [...results.data.items];

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
        items.sort((a, b) => (b.ratingScore ?? 0) - (a.ratingScore ?? 0));
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
  }, [results.data, minRating, badgeOnly, query, sortBy]);

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
  const cityValue = state.cityId === null ? "" : String(state.cityId);
  const areaValue = state.areaId === null ? "" : String(state.areaId);

  /* One label set for the drawer, from the shared dictionary, so the copy on the
     filter panel is the same here as on every other filtered screen. */
  const labels = filterLabels(dict.common);
  const activeFilterCount = [state.serviceSlug !== "", state.cityId !== null, state.areaId !== null].filter(Boolean).length;

  const filterBody = (
    <div className="grid gap-4">
      {categories.data !== undefined && categories.data.items.length > 1 ? (
        <div className="grid gap-2">
          <label htmlFor="search-category" className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
            {dict.catalogue.categoriesHeading}
          </label>
          <SelectField
            id="search-category"
            value={listingSlug ?? ""}
            onChange={(val) => setBrowseCategory(val)}
            options={categories.data.items.map((category) => ({
              value: category.slug,
              label: locale === "ur" ? category.nameUr : category.nameEn,
            }))}
            placeholder={dict.catalogue.categoriesHeading}
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
            { value: "", label: listed.isPending ? "…" : dict.search.servicePlaceholder },
            ...serviceOptions.map((option) => ({ value: option.value, label: option.label })),
          ]}
          placeholder={dict.search.servicePlaceholder}
        />
        {listed.data !== undefined && listed.data.items.length === 0 ? (
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

      <Button type="button" variant="ghost" size="sm" onClick={reset} className="w-full">
        <RotateCcw className="size-3.5" aria-hidden="true" />
        {dict.search.resetFilters}
      </Button>
    </div>
  );

  return (
    <div className="grid gap-8 lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-12">
      <aside className="hidden lg:sticky lg:top-[calc(var(--demo-bar-h,0px)+1.5rem)] lg:block lg:self-start">
        <h2 className="eyebrow eyebrow-light">{dict.search.filtersHeading}</h2>
        <div className="mt-4">{filterBody}</div>
      </aside>

      <div className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[20px] font-semibold tracking-[-0.03em] text-navy">
              {state.serviceSlug === ""
                ? dict.search.needsServiceTitle
                : !isSearchable(state)
                  ? dict.search.needsLocationTitle
                  : results.data === undefined
                    ? dict.search.filtersHeading
                    : results.data.items.length === 0
                      ? dict.search.noResultsTitle
                      : results.data.items.length === 1
                        ? dict.search.resultsHeadingOne
                        : dict.search.resultsHeading.replace("{count}", formatNumber(results.data.items.length, locale))}
            </h2>
            {state.serviceSlug !== "" && results.data !== undefined && results.data.items.length > 0 ? (
              <p className="mt-1 text-sm text-secondary">{dict.search.resultsFor.replace("{service}", serviceName)}</p>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            {results.isFetching && !results.isPending ? <RefreshingNote dict={dict} /> : null}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="lg:hidden"
              onClick={() => setSheetOpen(true)}
              aria-expanded={sheetOpen}
            >
              <SlidersHorizontal className="size-3.5" aria-hidden="true" />
              {dict.search.openFilters}
            </Button>
          </div>
        </div>

        {sheetOpen ? (
          /* The project's own drawer rather than a second one written here:
             it brings Escape-to-close, the body scroll lock, `aria-modal`, a
             labelled close button and the reset/apply pair. The hand-rolled
             version this replaced had none of those. */
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

        <div className="mt-6">
          {state.serviceSlug === "" ? (
            <EmptyState
              title={dict.search.needsServiceTitle}
              body={dict.search.needsServiceText}
              icon={<SearchX className="size-8" aria-hidden="true" />}
              action={
                <a href={localizedPath(locale, "/services")} className={buttonStyles()}>
                  {dict.search.browseCatalogue}
                </a>
              }
            />
          ) : !isSearchable(state) ? (
            /* The service is chosen but the API still needs a point, so this is
               a different ask from "choose a service" and gets its own copy. */
            <EmptyState
              title={dict.search.needsLocationTitle}
              body={dict.search.needsLocationText}
              icon={<MapPin className="size-8" aria-hidden="true" />}
              action={
                <Button type="button" onClick={() => void applyDeviceLocation()} disabled={locating}>
                  {locating ? dict.search.locating : dict.search.useMyLocation}
                </Button>
              }
            />
          ) : results.isPending ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {Array.from({ length: 4 }, (_, index) => (
                <ProviderCardSkeleton key={index} />
              ))}
            </div>
          ) : results.isError ? (
            <InlineError
              title={dict.search.loadError}
              actionLabel={dict.catalogue.retry}
              onRetry={() => void results.refetch()}
            />
          ) : results.data.items.length === 0 ? (
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
              {/* In-results Sort & Filter Toolbar */}
              <div className="mb-5 grid gap-3 rounded-[12px] border border-line bg-surface-2/60 p-3 sm:p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="relative flex-1 min-w-[200px]">
                    <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
                    <Input
                      type="text"
                      placeholder={locale === "ur" ? "مہارت یا تفصیل میں تلاش کریں..." : "Filter by skill or keyword…"}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      className="h-9 ps-9 pe-8 text-xs"
                    />
                    {query.trim() !== "" ? (
                      <button
                        type="button"
                        onClick={() => setQuery("")}
                        className="absolute end-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-navy"
                        aria-label={locale === "ur" ? "صاف کریں" : "Clear search"}
                      >
                        <X className="size-3.5" aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>

                  <div className="w-full sm:w-64 shrink-0">
                    <SelectField
                      id="results-sort"
                      value={sortBy}
                      onChange={(val) => setSortBy(val as SortKey)}
                      options={sortOptions}
                      placeholder={locale === "ur" ? "ترتیب منتخب کریں" : "Sort results"}
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line/60 pt-2.5">
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

              {hasResultFilters ? (
                <p className="mb-4 text-xs font-medium text-secondary">
                  {locale === "ur"
                    ? `${formatNumber(results.data.items.length, locale)} میں سے ${formatNumber(processedProviders.length, locale)} پیشہ ور دکھائی جا رہے ہیں`
                    : `Showing ${formatNumber(processedProviders.length, locale)} of ${formatNumber(results.data.items.length, locale)} professionals matching criteria`}
                </p>
              ) : null}

              {processedProviders.length === 0 ? (
                <EmptyState
                  title={locale === "ur" ? "کوئی پیشہ ور فلٹر پر پورا نہیں اترا" : "No professionals match your filter criteria"}
                  body={locale === "ur" ? "براہ کرم فلٹرز صاف کریں یا تلاش کا لفظ تبدیل کریں۔" : "Try clearing your filters or using different keywords to see all available professionals."}
                  icon={<SearchX className="size-8" aria-hidden="true" />}
                  action={
                    <Button type="button" variant="secondary" onClick={resetResultFilters}>
                      <RotateCcw className="size-3.5 me-1.5" aria-hidden="true" />
                      {locale === "ur" ? "فلٹرز ختم کریں" : "Reset result filters"}
                    </Button>
                  }
                />
              ) : (
                <div className={cn("grid gap-4 sm:grid-cols-2")}>
                  {processedProviders.map((provider) => (
                    <ProviderCard key={provider.providerId} locale={locale} dict={dict} provider={provider} serviceName={serviceName} />
                  ))}
                </div>
              )}
              <p className="mt-6 text-xs text-muted">{dict.search.resultCountNote}</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
