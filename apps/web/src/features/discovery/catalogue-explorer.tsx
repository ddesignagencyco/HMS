"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useMemo, useState } from "react";
import {
  ArrowRight,
  Clock3,
  Filter,
  RotateCcw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from "lucide-react";
import type { Dictionary } from "@/lib/dictionaries";
import { cn, formatDuration, formatNumber, localizedPath, type Locale } from "@/lib/utils";
import { presentPrice } from "@/features/catalogue/pricing";
import { useCategories, useAllServices } from "@/features/catalogue/queries";
import type { CatalogueService } from "@/features/catalogue/api";
import { InlineError, LoadingSkeleton } from "./states";

import { SelectField } from "@/components/select-field";

type PricingFilter = "ALL" | "FLAT" | "TIME_BASED" | "INSPECTION_FIRST";
type SortOption = "recommended" | "price-asc" | "price-desc" | "duration-asc" | "warranty-desc" | "name-asc";

export function CatalogueExplorer({
  locale,
  dict,
  initialCategory = "",
}: {
  locale: Locale;
  dict: Dictionary;
  initialCategory: string;
}) {
  const router = useRouter();
  const searchId = useId();

  // Load real API catalogue categories and all real services
  const categoriesQuery = useCategories(locale);
  const servicesQuery = useAllServices(locale);

  // Filter States
  const [selectedCategory, setSelectedCategory] = useState<string>(initialCategory);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [pricingFilter, setPricingFilter] = useState<PricingFilter>("ALL");
  const [emergencyOnly, setEmergencyOnly] = useState<boolean>(false);
  const [planOnly, setPlanOnly] = useState<boolean>(false);
  const [highRiskOnly, setHighRiskOnly] = useState<boolean>(false);
  const [quickServiceOnly, setQuickServiceOnly] = useState<boolean>(false);
  const [minWarranty, setMinWarranty] = useState<number | "ALL">("ALL");
  const [sortBy, setSortBy] = useState<SortOption>("recommended");
  const [isMobileFiltersOpen, setIsMobileFiltersOpen] = useState<boolean>(false);

  const categories = useMemo(() => categoriesQuery.data?.items ?? [], [categoriesQuery.data]);
  const allServices = useMemo(() => servicesQuery.data?.items ?? [], [servicesQuery.data]);

  /* A category slug in the URL that the API does not publish is discarded rather
     than applied. Filtering to a category that does not exist yields "0 services"
     with no explanation, which reads as an empty catalogue — so an unrecognised
     slug falls back to the whole catalogue instead. */
  const effectiveCategory = useMemo(
    () => (selectedCategory !== "" && categories.some((c) => c.slug === selectedCategory) ? selectedCategory : ""),
    [categories, selectedCategory],
  );

  // Sync category selection with URL
  const handleCategorySelect = (slug: string) => {
    setSelectedCategory(slug);
    const path = localizedPath(locale, "/services");
    if (slug) {
      router.push(`${path}?category=${slug}`, { scroll: false });
    } else {
      router.push(path, { scroll: false });
    }
  };

  // Reset all filters
  const resetFilters = () => {
    setSelectedCategory("");
    setSearchQuery("");
    setPricingFilter("ALL");
    setEmergencyOnly(false);
    setPlanOnly(false);
    setHighRiskOnly(false);
    setQuickServiceOnly(false);
    setMinWarranty("ALL");
    setSortBy("recommended");
    router.push(localizedPath(locale, "/services"), { scroll: false });
  };

  // Count active non-default filters
  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (effectiveCategory !== "") count += 1;
    if (searchQuery.trim() !== "") count += 1;
    if (pricingFilter !== "ALL") count += 1;
    if (emergencyOnly) count += 1;
    if (planOnly) count += 1;
    if (highRiskOnly) count += 1;
    if (quickServiceOnly) count += 1;
    if (minWarranty !== "ALL") count += 1;
    return count;
  }, [effectiveCategory, searchQuery, pricingFilter, emergencyOnly, planOnly, highRiskOnly, quickServiceOnly, minWarranty]);

  // Filter and sort the services
  const filteredServices = useMemo(() => {
    return allServices
      .filter((service) => {
        // 1. Category Filter ("" means ALL)
        if (effectiveCategory !== "" && service.categorySlug !== effectiveCategory) {
          return false;
        }

        // 2. Search Query Filter
        if (searchQuery.trim() !== "") {
          const q = searchQuery.toLowerCase().trim();
          const matchNameEn = service.nameEn.toLowerCase().includes(q);
          const matchNameUr = service.nameUr.toLowerCase().includes(q);
          const matchDesc = service.description.toLowerCase().includes(q);
          const matchCat = service.categorySlug?.toLowerCase().includes(q);
          if (!matchNameEn && !matchNameUr && !matchDesc && !matchCat) {
            return false;
          }
        }

        // 3. Pricing Model Filter
        if (pricingFilter !== "ALL" && service.pricingModel !== pricingFilter) {
          return false;
        }

        // 4. Feature Badges
        if (emergencyOnly && !service.isEmergencyEligible) return false;
        if (planOnly && !service.isPlanEligible) return false;
        if (highRiskOnly && !service.isHighRisk) return false;
        if (quickServiceOnly && service.expectedDurationMin > 60) return false;

        // 5. Warranty Filter
        if (minWarranty !== "ALL" && service.warrantyDays < minWarranty) {
          return false;
        }

        return true;
      })
      .sort((a, b) => {
        switch (sortBy) {
          case "price-asc":
            return a.basePricePaisa - b.basePricePaisa;
          case "price-desc":
            return b.basePricePaisa - a.basePricePaisa;
          case "duration-asc":
            return a.expectedDurationMin - b.expectedDurationMin;
          case "warranty-desc":
            return b.warrantyDays - a.warrantyDays;
          case "name-asc": {
            const nameA = locale === "ur" ? a.nameUr : a.nameEn;
            const nameB = locale === "ur" ? b.nameUr : b.nameEn;
            return nameA.localeCompare(nameB);
          }
          default:
            return a.id - b.id;
        }
      });
  }, [allServices, effectiveCategory, searchQuery, pricingFilter, emergencyOnly, planOnly, highRiskOnly, quickServiceOnly, minWarranty, sortBy, locale]);

  // Selected Category Information
  const currentCategoryObj = useMemo(
    () => categories.find((c) => c.slug === effectiveCategory) ?? null,
    [categories, effectiveCategory],
  );

  const currentCategoryTitle = currentCategoryObj
    ? locale === "ur"
      ? currentCategoryObj.nameUr
      : currentCategoryObj.nameEn
    : locale === "ur"
      ? "تمام خدمات"
      : "All Services";

  // Category counts map
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of allServices) {
      if (s.categorySlug) {
        counts[s.categorySlug] = (counts[s.categorySlug] ?? 0) + 1;
      }
    }
    return counts;
  }, [allServices]);

  const isLoading = categoriesQuery.isPending || servicesQuery.isPending;
  const isError = categoriesQuery.isError && servicesQuery.isError;

  return (
    <div className="relative">
      {/* Top Search & Filter Bar */}
      <div className="mb-8 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          {/* Real-time Search Box */}
          <div className="relative flex-1">
            <label htmlFor={searchId} className="sr-only">
              {dict.services.search}
            </label>
            <div className="pointer-events-none absolute inset-y-0 start-0 flex items-center ps-3.5 text-slate-400">
              <Search className="size-4.5" aria-hidden="true" />
            </div>
            <input
              id={searchId}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={locale === "ur" ? "خدمت تلاش کریں (مثلاً: پلمبنگ، اے سی، وائرنگ...)" : "Search any service (e.g. leak repair, AC service, wiring...)"}
              className="w-full rounded-xl border border-slate-200 bg-slate-50/60 py-2.5 pe-9 ps-10 text-sm font-medium text-navy placeholder:text-slate-400 focus:border-slate-400 focus:bg-white focus:outline-none focus:ring-0 transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute inset-y-0 end-0 flex items-center pe-3 text-slate-400 hover:text-navy focus:outline-none"
                aria-label={dict.common.clearFilters}
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            )}
          </div>

          {/* Quick Controls: Sort & Mobile Filter Toggle */}
          <div className="flex items-center gap-3">
            {/* Mobile Filter Toggle Button */}
            <button
              type="button"
              onClick={() => setIsMobileFiltersOpen(true)}
              className="inline-flex lg:hidden items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-navy shadow-sm transition hover:bg-slate-50 focus:outline-none"
            >
              <SlidersHorizontal className="size-4 text-slate-600" aria-hidden="true" />
              <span>{dict.services.filters}</span>
              {activeFiltersCount > 0 && (
                <span className="grid size-5 place-items-center rounded-full bg-navy text-[11px] font-bold text-white">
                  {activeFiltersCount}
                </span>
              )}
            </button>

            {/* Sort Selector using React Select */}
            <div className="flex items-center gap-2.5 ms-auto lg:ms-0">
              <span className="hidden sm:inline text-xs font-semibold uppercase tracking-wider text-muted">
                {dict.services.sort}:
              </span>
              <div className="w-[180px]">
                <SelectField
                  id="sort-select"
                  value={sortBy}
                  onChange={(val) => setSortBy(val as SortOption)}
                  options={[
                    { value: "recommended", label: dict.services.sortRecommended },
                    { value: "price-asc", label: dict.services.sortPriceLowHigh },
                    { value: "price-desc", label: dict.services.sortPriceHighLow },
                    { value: "duration-asc", label: dict.services.sortDurationShort },
                    { value: "warranty-desc", label: dict.services.sortWarrantyLong },
                    { value: "name-asc", label: dict.services.sortNameAZ },
                  ]}
                  placeholder={dict.services.sort}
                  size="sm"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Quick Category Chips for Fast Access (Clean & Professional) */}
        <div className="mt-4 flex items-center gap-2 overflow-x-auto pb-1 pt-2 no-scrollbar border-t border-slate-100">
          <button
            type="button"
            onClick={() => handleCategorySelect("")}
            className={cn(
              "inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors focus:outline-none",
              effectiveCategory === ""
                ? "bg-navy text-white shadow-sm"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200 hover:text-navy",
            )}
          >
            <span>{locale === "ur" ? "تمام زمرے" : "All Categories"}</span>
            <span className={cn("rounded-md px-1.5 py-0.5 text-[10px] tabular-nums", effectiveCategory === "" ? "bg-white/20 text-white" : "bg-slate-200 text-slate-700")}>
              {allServices.length}
            </span>
          </button>

          {categories.map((cat) => {
            const count = categoryCounts[cat.slug] ?? 0;
            const isActive = effectiveCategory === cat.slug;
            const catName = locale === "ur" ? cat.nameUr : cat.nameEn;

            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => handleCategorySelect(cat.slug)}
                className={cn(
                  "inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors focus:outline-none",
                  isActive
                    ? "bg-navy text-white shadow-sm"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200 hover:text-navy",
                )}
              >
                <span>{catName}</span>
                {count > 0 && (
                  <span className={cn("rounded-md px-1.5 py-0.5 text-[10px] tabular-nums", isActive ? "bg-white/20 text-white" : "bg-slate-200 text-slate-700")}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Grid: Sidebar + Results */}
      <div className="grid gap-8 lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-10 items-start">
        {/* DESKTOP SIDEBAR FILTRATION */}
        <aside className="hidden lg:block sticky top-24 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3.5">
            <div className="flex items-center gap-2">
              <Filter className="size-4 text-slate-600" aria-hidden="true" />
              <h2 className="text-sm font-bold text-navy uppercase tracking-wider">{dict.services.filters}</h2>
            </div>
            {activeFiltersCount > 0 && (
              <button
                type="button"
                onClick={resetFilters}
                className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-navy transition-colors focus:outline-none"
              >
                <RotateCcw className="size-3" aria-hidden="true" />
                <span>{dict.services.reset}</span>
              </button>
            )}
          </div>

          {/* 1. Category Filter Dropdown */}
          <div className="mt-5">
            <label htmlFor="filter-category" className="block text-xs font-bold uppercase tracking-wider text-muted mb-2">
              {dict.catalogue.categoriesHeading}
            </label>
            <SelectField
              id="filter-category"
              value={effectiveCategory}
              onChange={handleCategorySelect}
              options={[
                { value: "", label: `${locale === "ur" ? "تمام زمرے" : "All Categories"} (${allServices.length})` },
                ...categories.map((cat) => ({
                  value: cat.slug,
                  label: `${locale === "ur" ? cat.nameUr : cat.nameEn} (${categoryCounts[cat.slug] ?? 0})`,
                })),
              ]}
              placeholder={dict.catalogue.categoriesHeading}
            />
          </div>

          {/* 2. Pricing Model Filter Dropdown */}
          <div className="mt-5 border-t border-slate-100 pt-4">
            <label htmlFor="filter-pricing" className="block text-xs font-bold uppercase tracking-wider text-muted mb-2">
              {dict.admin.pricingModel}
            </label>
            <SelectField
              id="filter-pricing"
              value={pricingFilter}
              onChange={(val) => setPricingFilter(val as PricingFilter)}
              options={[
                { value: "ALL", label: locale === "ur" ? "تمام قیمت ماڈل" : "All Pricing Models" },
                { value: "FLAT", label: dict.catalogue.priceFlat },
                { value: "TIME_BASED", label: dict.catalogue.priceRate },
                { value: "INSPECTION_FIRST", label: locale === "ur" ? "معائنہ کے بعد حتمی" : "Inspection First" },
              ]}
              placeholder={dict.admin.pricingModel}
            />
          </div>

          {/* 3. Warranty Filter Dropdown */}
          <div className="mt-5 border-t border-slate-100 pt-4">
            <label htmlFor="filter-warranty" className="block text-xs font-bold uppercase tracking-wider text-muted mb-2">
              {dict.services.warrantyFilter}
            </label>
            <SelectField
              id="filter-warranty"
              value={String(minWarranty)}
              onChange={(val) => setMinWarranty(val === "ALL" ? "ALL" : Number(val))}
              options={[
                { value: "ALL", label: dict.services.warrantyAny },
                { value: "15", label: `15+ ${locale === "ur" ? "دن ضمانت" : "days warranty"}` },
                { value: "30", label: `30+ ${locale === "ur" ? "دن ضمانت" : "days warranty"}` },
                { value: "60", label: `60+ ${locale === "ur" ? "دن ضمانت" : "days warranty"}` },
                { value: "90", label: `90+ ${locale === "ur" ? "دن ضمانت" : "days warranty"}` },
              ]}
              placeholder={dict.services.warrantyFilter}
            />
          </div>

          {/* 4. Service Eligibility & Attributes */}
          <div className="mt-5 border-t border-slate-100 pt-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted mb-3">
              {locale === "ur" ? "خصوصیات و سہولیات" : "Service Features"}
            </h3>
            <div className="grid gap-2.5">
              <label className="flex items-center gap-2.5 text-xs font-medium text-slate-700 hover:text-navy cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={emergencyOnly}
                  onChange={(e) => setEmergencyOnly(e.target.checked)}
                  className="size-4 rounded border-slate-300 text-navy accent-navy cursor-pointer focus:ring-0 focus:outline-none"
                />
                <span>{dict.catalogue.emergencyEligible}</span>
              </label>

              <label className="flex items-center gap-2.5 text-xs font-medium text-slate-700 hover:text-navy cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={planOnly}
                  onChange={(e) => setPlanOnly(e.target.checked)}
                  className="size-4 rounded border-slate-300 text-navy accent-navy cursor-pointer focus:ring-0 focus:outline-none"
                />
                <span>{dict.catalogue.planEligible}</span>
              </label>

              <label className="flex items-center gap-2.5 text-xs font-medium text-slate-700 hover:text-navy cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={highRiskOnly}
                  onChange={(e) => setHighRiskOnly(e.target.checked)}
                  className="size-4 rounded border-slate-300 text-navy accent-navy cursor-pointer focus:ring-0 focus:outline-none"
                />
                <span>{locale === "ur" ? "حفاظتی سرٹیفائیڈ کام" : "Safety Certified"}</span>
              </label>

              <label className="flex items-center gap-2.5 text-xs font-medium text-slate-700 hover:text-navy cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={quickServiceOnly}
                  onChange={(e) => setQuickServiceOnly(e.target.checked)}
                  className="size-4 rounded border-slate-300 text-navy accent-navy cursor-pointer focus:ring-0 focus:outline-none"
                />
                <span>{locale === "ur" ? "فوری سروس (≤ 60 منٹ)" : "Quick (≤ 60 mins)"}</span>
              </label>
            </div>
          </div>
        </aside>

        {/* MOBILE FILTERS DRAWER / MODAL */}
        {isMobileFiltersOpen && (
          <div className="fixed inset-0 z-50 flex bg-navy-950/60 backdrop-blur-sm lg:hidden animate-in fade-in duration-200">
            <div className="relative ms-auto flex h-full w-full max-w-sm flex-col bg-white p-5 shadow-2xl overflow-y-auto">
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div className="flex items-center gap-2">
                  <SlidersHorizontal className="size-5 text-slate-700" />
                  <h2 className="text-lg font-bold text-navy">{dict.services.filters}</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setIsMobileFiltersOpen(false)}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-navy focus:outline-none"
                >
                  <X className="size-5" />
                </button>
              </div>

              {/* Mobile Category Dropdown */}
              <div className="mt-5">
                <label htmlFor="mobile-filter-category" className="block text-xs font-bold uppercase tracking-wider text-muted mb-2">
                  {dict.catalogue.categoriesHeading}
                </label>
                <SelectField
                  id="mobile-filter-category"
                  value={effectiveCategory}
                  onChange={(val) => {
                    handleCategorySelect(val);
                    setIsMobileFiltersOpen(false);
                  }}
                  options={[
                    { value: "", label: `${locale === "ur" ? "تمام زمرے" : "All Categories"} (${allServices.length})` },
                    ...categories.map((c) => ({
                      value: c.slug,
                      label: `${locale === "ur" ? c.nameUr : c.nameEn} (${categoryCounts[c.slug] ?? 0})`,
                    })),
                  ]}
                  placeholder={dict.catalogue.categoriesHeading}
                />
              </div>

              {/* Mobile Pricing Filter Dropdown */}
              <div className="mt-5 border-t border-slate-100 pt-4">
                <label htmlFor="mobile-filter-pricing" className="block text-xs font-bold uppercase tracking-wider text-muted mb-2">
                  {dict.admin.pricingModel}
                </label>
                <SelectField
                  id="mobile-filter-pricing"
                  value={pricingFilter}
                  onChange={(val) => setPricingFilter(val as PricingFilter)}
                  options={[
                    { value: "ALL", label: locale === "ur" ? "تمام قیمت ماڈل" : "All Pricing Models" },
                    { value: "FLAT", label: dict.catalogue.priceFlat },
                    { value: "TIME_BASED", label: dict.catalogue.priceRate },
                    { value: "INSPECTION_FIRST", label: locale === "ur" ? "معائنہ کے بعد حتمی" : "Inspection First" },
                  ]}
                  placeholder={dict.admin.pricingModel}
                />
              </div>

              {/* Mobile Warranty Filter Dropdown */}
              <div className="mt-5 border-t border-slate-100 pt-4">
                <label htmlFor="mobile-filter-warranty" className="block text-xs font-bold uppercase tracking-wider text-muted mb-2">
                  {dict.services.warrantyFilter}
                </label>
                <SelectField
                  id="mobile-filter-warranty"
                  value={String(minWarranty)}
                  onChange={(val) => setMinWarranty(val === "ALL" ? "ALL" : Number(val))}
                  options={[
                    { value: "ALL", label: dict.services.warrantyAny },
                    { value: "15", label: `15+ ${locale === "ur" ? "دن ضمانت" : "days warranty"}` },
                    { value: "30", label: `30+ ${locale === "ur" ? "دن ضمانت" : "days warranty"}` },
                    { value: "60", label: `60+ ${locale === "ur" ? "دن ضمانت" : "days warranty"}` },
                    { value: "90", label: `90+ ${locale === "ur" ? "دن ضمانت" : "days warranty"}` },
                  ]}
                  placeholder={dict.services.warrantyFilter}
                />
              </div>

              {/* Mobile Features */}
              <div className="mt-5 border-t border-slate-100 pt-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-muted mb-2.5">
                  {locale === "ur" ? "خصوصیات" : "Features"}
                </h3>
                <div className="grid gap-2.5 text-xs text-slate-700">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={emergencyOnly} onChange={(e) => setEmergencyOnly(e.target.checked)} className="size-4 rounded accent-navy focus:ring-0 focus:outline-none" />
                    <span>{dict.catalogue.emergencyEligible}</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={planOnly} onChange={(e) => setPlanOnly(e.target.checked)} className="size-4 rounded accent-navy focus:ring-0 focus:outline-none" />
                    <span>{dict.catalogue.planEligible}</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={highRiskOnly} onChange={(e) => setHighRiskOnly(e.target.checked)} className="size-4 rounded accent-navy focus:ring-0 focus:outline-none" />
                    <span>{locale === "ur" ? "حفاظتی سرٹیفائیڈ کام" : "Safety Certified"}</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={quickServiceOnly} onChange={(e) => setQuickServiceOnly(e.target.checked)} className="size-4 rounded accent-navy focus:ring-0 focus:outline-none" />
                    <span>{locale === "ur" ? "فوری سروس (≤ 60 منٹ)" : "Quick (≤ 60 mins)"}</span>
                  </label>
                </div>
              </div>

              {/* Mobile Actions */}
              <div className="mt-auto border-t border-slate-100 pt-4 flex gap-3">
                <button
                  type="button"
                  onClick={resetFilters}
                  className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-semibold text-secondary hover:bg-slate-50 focus:outline-none"
                >
                  {dict.services.reset}
                </button>
                <button
                  type="button"
                  onClick={() => setIsMobileFiltersOpen(false)}
                  className="flex-1 rounded-xl bg-navy py-2.5 text-sm font-semibold text-white hover:bg-navy-950 focus:outline-none"
                >
                  {dict.services.apply}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* RESULTS CONTENT AREA */}
        <div className="min-w-0">
          {/* Results Summary Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-line">
            <div>
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-navy">
                {currentCategoryTitle}
              </h2>
              <p className="mt-0.5 text-sm text-secondary">
                {locale === "ur"
                  ? `${formatNumber(filteredServices.length, locale)} تصدیق شدہ خدمات دستیاب ہیں`
                  : `Showing ${filteredServices.length} verified services with upfront pricing`}
              </p>
            </div>

            {/* Active Filters Summary Chips */}
            {activeFiltersCount > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                {effectiveCategory && (
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-semibold text-primary-strong">
                    <span>{currentCategoryTitle}</span>
                    <button type="button" onClick={() => handleCategorySelect("")} aria-label="Remove category filter">
                      <X className="size-3" />
                    </button>
                  </span>
                )}
                {searchQuery && (
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-navy">
                    <span>&quot;{searchQuery}&quot;</span>
                    <button type="button" onClick={() => setSearchQuery("")} aria-label="Clear search">
                      <X className="size-3" />
                    </button>
                  </span>
                )}
                {emergencyOnly && (
                  <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700">
                    <span>{locale === "ur" ? "فوری سروس" : "Same-day"}</span>
                    <button type="button" onClick={() => setEmergencyOnly(false)} aria-label="Remove emergency filter">
                      <X className="size-3" />
                    </button>
                  </span>
                )}
                {planOnly && (
                  <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700">
                    <span>{locale === "ur" ? "پلان اہل" : "Plan Eligible"}</span>
                    <button type="button" onClick={() => setPlanOnly(false)} aria-label="Remove plan filter">
                      <X className="size-3" />
                    </button>
                  </span>
                )}
                {highRiskOnly && (
                  <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700">
                    <span>{locale === "ur" ? "حفاظت جانچ" : "Safety Check"}</span>
                    <button type="button" onClick={() => setHighRiskOnly(false)} aria-label="Remove safety filter">
                      <X className="size-3" />
                    </button>
                  </span>
                )}
                {quickServiceOnly && (
                  <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700">
                    <span>≤ 60 min</span>
                    <button type="button" onClick={() => setQuickServiceOnly(false)} aria-label="Remove duration filter">
                      <X className="size-3" />
                    </button>
                  </span>
                )}
                {pricingFilter !== "ALL" && (
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-navy">
                    <span>
                      {pricingFilter === "FLAT" ? dict.catalogue.priceFlat : pricingFilter === "TIME_BASED" ? dict.catalogue.priceRate : "Inspection"}
                    </span>
                    <button type="button" onClick={() => setPricingFilter("ALL")} aria-label="Remove pricing filter">
                      <X className="size-3" />
                    </button>
                  </span>
                )}
                <button
                  type="button"
                  onClick={resetFilters}
                  className="text-xs font-semibold text-rose-600 hover:text-rose-700 underline"
                >
                  {dict.common.clearFilters}
                </button>
              </div>
            )}
          </div>

          {/* Loading Skeletons */}
          {isLoading ? (
            <div className="mt-6 grid gap-5 sm:grid-cols-2">
              {Array.from({ length: 6 }, (_, index) => (
                <div key={index} className="h-64 rounded-2xl border border-line bg-white p-6 shadow-soft animate-pulse">
                  <div className="flex justify-between items-center mb-4">
                    <LoadingSkeleton className="h-6 w-24 rounded-full" />
                    <LoadingSkeleton className="h-5 w-16 rounded-full" />
                  </div>
                  <LoadingSkeleton className="h-6 w-3/4 rounded-md mb-2" />
                  <LoadingSkeleton className="h-4 w-full rounded-md mb-1" />
                  <LoadingSkeleton className="h-4 w-2/3 rounded-md mb-6" />
                  <div className="border-t border-slate-100 pt-4 mt-auto flex justify-between items-end">
                    <LoadingSkeleton className="h-8 w-24 rounded-md" />
                    <LoadingSkeleton className="h-10 w-28 rounded-xl" />
                  </div>
                </div>
              ))}
            </div>
          ) : isError ? (
            <InlineError
              className="mt-6"
              title={dict.catalogue.loadError}
              actionLabel={dict.catalogue.retry}
              onRetry={() => {
                void categoriesQuery.refetch();
                void servicesQuery.refetch();
              }}
            />
          ) : filteredServices.length === 0 ? (
            /* Empty Search/Filter State */
            <div className="mt-8 rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center shadow-soft">
              <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-blue-50 text-primary">
                <Search className="size-7" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-lg font-bold text-navy">{dict.services.noResults}</h3>
              <p className="mt-2 text-sm text-secondary max-w-md mx-auto">
                {dict.services.noResultsText}
              </p>
              <button
                type="button"
                onClick={resetFilters}
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-primary/20 hover:bg-primary-strong transition-all"
              >
                <RotateCcw className="size-4" aria-hidden="true" />
                <span>{dict.services.reset}</span>
              </button>
            </div>
          ) : (
            /* REAL SERVICE CARDS GRID */
            <div className="mt-6 grid gap-5 sm:grid-cols-2">
              {filteredServices.map((service) => (
                <ServiceCard
                  key={service.id}
                  locale={locale}
                  dict={dict}
                  service={service}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* HIGH-END SERVICE CARD COMPONENT */
export function ServiceCard({
  locale,
  dict,
  service,
  className,
}: {
  locale: Locale;
  dict: Dictionary;
  service: CatalogueService & { categorySlug?: string; categoryNameEn?: string; categoryNameUr?: string };
  className?: string;
}) {
  const name = locale === "ur" ? service.nameUr : service.nameEn;
  const price = presentPrice(service, locale);
  const detailHref = localizedPath(locale, `/services/${service.slug}`);
  const bookHref = localizedPath(locale, `/book/${service.slug}`);

  const categorySlug = service.categorySlug ?? "plumbing";
  const categoryLabel =
    locale === "ur"
      ? service.categoryNameUr ?? categorySlug.replace("-", " ")
      : service.categoryNameEn ?? categorySlug.replace("-", " ");

  return (
    <article
      className={cn(
        "group relative flex flex-col justify-between rounded-xl border border-slate-200/90 bg-white p-5 sm:p-6 transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-soft",
        className,
      )}
    >
      <div>
        {/* Card Header: Category Badge + Eligibility Badges */}
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3.5">
          <span className="inline-flex items-center rounded-md bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 capitalize">
            {categoryLabel}
          </span>

          <div className="flex flex-wrap items-center gap-1.5">
            {service.isEmergencyEligible && (
              <span className="inline-flex items-center rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700">
                {locale === "ur" ? "فوری سروس" : "Same-day"}
              </span>
            )}
            {service.isPlanEligible && (
              <span className="inline-flex items-center rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700">
                {locale === "ur" ? "پلان اہل" : "Plan"}
              </span>
            )}
            {service.isHighRisk && (
              <span className="inline-flex items-center rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700">
                {locale === "ur" ? "حفاظت جانچ" : "Safety Check"}
              </span>
            )}
          </div>
        </div>

        {/* Service Title */}
        <h3 className="text-lg font-bold leading-snug tracking-tight text-navy group-hover:text-primary transition-colors">
          <Link href={detailHref} className="focus:outline-none">
            {name}
          </Link>
        </h3>

        {/* Description */}
        <p dir="auto" className="mt-2 line-clamp-2 text-sm leading-relaxed text-secondary">
          {service.description}
        </p>

        {/* Specs Strip */}
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-50 px-2 py-1 font-medium text-slate-600">
            <Clock3 className="size-3.5 text-slate-400" aria-hidden="true" />
            {formatDuration(service.expectedDurationMin, locale)}
          </span>

          {service.warrantyDays > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-50 px-2 py-1 font-medium text-slate-600">
              <ShieldCheck className="size-3.5 text-slate-400" aria-hidden="true" />
              {dict.catalogue.warranty.replace("{days}", String(service.warrantyDays))}
            </span>
          )}

          {service.visitFeePaisa > 0 && (
            <span className="inline-flex items-center gap-1 rounded-md bg-slate-50 px-2 py-1 font-medium text-slate-600">
              <span>{dict.catalogue.visitFee}: {price.visitFee}</span>
            </span>
          )}
        </div>
      </div>

      {/* Pricing & Call to Action Footer */}
      <div className="mt-5 border-t border-slate-100 pt-4">
        <div className="flex items-end justify-between gap-3">
          {/* Price Block */}
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted">
              {price.basis === "flat"
                ? dict.catalogue.priceFlat
                : price.basis === "rate"
                  ? dict.catalogue.priceRate
                  : dict.catalogue.priceEstimate}
            </span>
            <div className="mt-0.5 flex items-baseline gap-1.5">
              <span className="text-2xl font-extrabold tracking-tight text-navy tabular-nums">
                {price.primary}
              </span>
              {price.perUnit !== undefined && (
                <span className="text-xs font-medium text-muted">
                  / {dict.catalogue[price.perUnit]}
                </span>
              )}
            </div>

            {price.range && (
              <p className="mt-0.5 text-xs text-secondary font-medium">
                {price.range.from} — {price.range.to}
              </p>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            <Link
              href={detailHref}
              className="inline-flex items-center justify-center rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-secondary hover:border-slate-300 hover:bg-slate-50 hover:text-navy transition-all focus:outline-none"
            >
              <span>{dict.catalogue.viewService}</span>
            </Link>

            <Link
              href={bookHref}
              className="inline-flex items-center justify-center gap-1 rounded-lg bg-navy px-3.5 py-2 text-xs font-bold text-white shadow-sm hover:bg-navy-950 transition-all focus:outline-none"
            >
              <span>{locale === "ur" ? "بک کریں" : "Book"}</span>
              <ArrowRight className="size-3.5 rtl:rotate-180" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </div>
    </article>
  );
}