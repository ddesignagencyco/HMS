"use client";

import Link from "next/link";
import { BadgeCheck, BriefcaseBusiness, MapPin, Star } from "lucide-react";
import type { Dictionary } from "@/lib/dictionaries";
import { cn, formatNumber, localizedPath, type Locale } from "@/lib/utils";
import { money } from "@/features/catalogue/pricing";
import { formatDistance } from "@/features/search/location";
import type { ProviderSearchResult } from "@/features/search/api";

/* A provider card can show only what the API returns, and that is less than a
   typical marketplace card: there is no public name and no photo on
   `/search/providers`. So the card leads with the professional's own words
   (bio, qualification), their real numbers, and a neutral monogram — never a
   stock photograph of somebody who does not exist, and never a name invented
   from a qualification. */

const monogram = (source: ProviderSearchResult): string => {
  const fromQualification = source.qualification?.trim()[0] ?? "";
  return (fromQualification === "" ? "•" : fromQualification).toUpperCase();
};

export function ProviderCard({
  locale,
  dict,
  provider,
  serviceName,
  className,
}: {
  locale: Locale;
  dict: Dictionary;
  provider: ProviderSearchResult;
  serviceName: string;
  className?: string;
}) {
  const hasRating = provider.ratingCount > 0;
  const href = localizedPath(locale, `/providers/${provider.providerId}`);

  return (
    <article
      className={cn(
        /* `relative` is load-bearing: the title link below is stretched over the
           whole card with `after:absolute after:inset-0`, and without a
           positioned ancestor on the card that pseudo-element resolves against
           something much further up the page — covering the filter sidebar and
           swallowing clicks on it. */
        "group relative flex h-full flex-col rounded-xl border border-slate-200/90 bg-white p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-soft",
        className,
      )}
    >
      <div className="flex items-start gap-3.5">
        {/* The API exposes no provider photo, so this is a neutral monogram
            rather than an image of a stranger. */}
        <span
          aria-hidden="true"
          className="grid size-11 shrink-0 place-items-center rounded-lg bg-navy text-base font-bold text-white shadow-sm"
        >
          {monogram(provider)}
        </span>

        <div className="min-w-0 flex-1">
          <h3 className="clamp-lines-2 line-clamp-2 text-base font-bold leading-snug tracking-tight text-navy">
            <Link href={href} className="transition-colors duration-200 after:absolute after:inset-0 hover:text-primary focus:outline-none">
              {provider.qualification ?? dict.profile.titleFallback}
            </Link>
          </h3>

          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-secondary">
            {hasRating ? (
              <span className="inline-flex items-center gap-1">
                <Star className="size-3.5 fill-amber-400 text-amber-400" aria-hidden="true" />
                <span className="font-semibold text-navy tabular-nums">{provider.ratingScore.toFixed(2)}</span>
                <span className="text-muted">({formatNumber(provider.ratingCount, locale)})</span>
              </span>
            ) : (
              <span className="text-muted">{dict.profile.noRatingsYet}</span>
            )}
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3.5 text-slate-400" aria-hidden="true" />
              {dict.search.distanceAway.replace("{distance}", formatDistance(provider.distanceM, locale))}
            </span>
          </div>
        </div>

        {provider.badge !== null ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
            <BadgeCheck className="size-3 text-slate-600" aria-hidden="true" />
            {provider.badge}
          </span>
        ) : null}
      </div>

      {provider.bio !== null && provider.bio !== "" ? (
        <p dir="auto" className="clamp-lines-2 mt-4 text-pretty text-sm leading-6 text-secondary">
          {provider.bio}
        </p>
      ) : null}

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-line pt-4 text-xs">
        <div>
          <dt className="text-muted">{dict.catalogue.pricingHeading}</dt>
          <dd className="mt-0.5 text-sm font-semibold text-navy tabular-nums">{money(provider.pricePaisa, locale)}</dd>
        </div>
        <div>
          <dt className="text-muted">{dict.catalogue.servicesHeading}</dt>
          <dd className="mt-0.5 truncate text-sm font-semibold text-navy">{serviceName}</dd>
        </div>
        {provider.experienceYears !== null ? (
          <div>
            <dt className="text-muted">{dict.profile.experience}</dt>
            <dd className="mt-0.5 inline-flex items-center gap-1 text-sm font-semibold text-navy">
              <BriefcaseBusiness className="size-3.5 text-slate-400" aria-hidden="true" />
              {dict.search.yearsExperience.replace("{years}", formatNumber(provider.experienceYears, locale))}
            </dd>
          </div>
        ) : null}
      </dl>

      <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-primary-strong">
        {dict.catalogue.viewService}
        <span aria-hidden="true" className="transition-transform duration-200 group-hover:translate-x-[3px] rtl:rotate-180">
          →
        </span>
      </span>
    </article>
  );
}

/** Card-shaped placeholders, so the grid does not reflow when data lands. */
export function ProviderCardSkeleton() {
  return (
    <div className="flex h-full flex-col rounded-[14px] border border-line bg-white p-5">
      <div className="flex items-start gap-3.5">
        <span className="skeleton size-12 shrink-0 rounded-[10px]" />
        <div className="min-w-0 flex-1">
          <span className="skeleton block h-4 w-2/3 rounded-[6px]" />
          <span className="skeleton mt-2 block h-3 w-1/2 rounded-[6px]" />
        </div>
      </div>
      <span className="skeleton mt-4 block h-3 w-full rounded-[6px]" />
      <span className="skeleton mt-2 block h-3 w-4/5 rounded-[6px]" />
      <div className="mt-4 grid grid-cols-2 gap-4 border-t border-line pt-4">
        <span className="skeleton block h-8 rounded-[6px]" />
        <span className="skeleton block h-8 rounded-[6px]" />
      </div>
    </div>
  );
}