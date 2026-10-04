"use client";

import Link from "next/link";
import { BadgeCheck, MapPin, ShieldCheck, Wrench } from "lucide-react";
import type { Dictionary } from "@/lib/dictionaries";
import { formatNumber, localizedPath, type Locale } from "@/lib/utils";
import { ApiError } from "@/lib/api/problem";
import { buttonStyles } from "@/components/ui";
import { money } from "@/features/catalogue/pricing";
import { formatDistance } from "@/features/search/location";
import { useProvider } from "@/features/search/queries";
import { AvailabilityPanel } from "./availability-panel";
import { ReputationSection, RemarksSection } from "./profile-sections";
import { InlineError, LoadingSkeleton, NotFoundState } from "./states";

/* A provider profile, from `GET /search/providers/:providerId`.

   The API publishes no name and no photograph for a provider, so the page is
   headed by what it does publish — qualification, bio, reputation — rather
   than by a fabricated identity. A provider who is not approved answers 404,
   which is deliberately indistinguishable from one that does not exist. */

export function ProviderProfile({ locale, dict, providerId }: { locale: Locale; dict: Dictionary; providerId: string }) {
  const provider = useProvider(providerId, locale);

  if (provider.isPending) return <ProfileSkeleton />;

  if (provider.isError) {
    if (provider.error instanceof ApiError && (provider.error.status === 404 || provider.error.status === 400)) {
      return (
        <div className="container-shell py-16">
          <NotFoundState
            title={dict.profile.notFoundTitle}
            body={dict.profile.notFoundText}
            action={
              <Link href={localizedPath(locale, "/providers")} className={buttonStyles()}>
                {dict.profile.backToSearch}
              </Link>
            }
          />
        </div>
      );
    }
    return (
      <div className="container-shell py-16">
        <InlineError
          title={dict.profile.loadError}
          actionLabel={dict.catalogue.retry}
          onRetry={() => void provider.refetch()}
        />
      </div>
    );
  }

  const value = provider.data;

  return (
    <>
      <nav aria-label={dict.catalogue.breadcrumbHome} className="border-b border-line bg-white">
        <div className="container-shell flex items-center gap-2 py-3 text-sm text-muted">
          <Link href={localizedPath(locale)} className="transition-colors hover:text-navy">
            {dict.catalogue.breadcrumbHome}
          </Link>
          <span aria-hidden="true">/</span>
          <Link href={localizedPath(locale, "/providers")} className="transition-colors hover:text-navy">
            {dict.search.eyebrow}
          </Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page" className="truncate font-medium text-navy">
            {value.qualification ?? dict.profile.titleFallback}
          </span>
        </div>
      </nav>

      <section className="bg-page py-10 sm:py-14">
        <div className="container-shell grid gap-10 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-14">
          <div className="min-w-0">
            <p className="eyebrow eyebrow-light">{dict.profile.eyebrow}</p>
            <h1 className="title-page mt-3 text-navy">{value.qualification ?? dict.profile.titleFallback}</h1>

            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-secondary">
              {value.experienceYears !== null ? (
                <span>{dict.search.yearsExperience.replace("{years}", formatNumber(value.experienceYears, locale))}</span>
              ) : null}
              {value.reputation.badge !== null ? (
                <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                  <BadgeCheck className="size-3.5 text-slate-600" aria-hidden="true" />
                  {value.reputation.badge}
                </span>
              ) : null}
              {value.status === "APPROVED" ? (
                /* `status` is exactly an approval flag: getProviderDetail only
                   ever returns APPROVED providers. That is not the same claim as
                   "verified", so it is not dressed up as one. */
                <span className="inline-flex items-center gap-1.5 text-slate-700 font-medium">
                  <ShieldCheck className="size-4 text-emerald-600" aria-hidden="true" />
                  {dict.profile.approved}
                </span>
              ) : null}
            </div>

            {value.bio !== null && value.bio !== "" ? (
              <section aria-labelledby="about-heading" className="mt-8">
                <h2 id="about-heading" className="text-[20px] font-semibold tracking-[-0.03em] text-navy">
                  {dict.profile.about}
                </h2>
                <p dir="auto" className="mt-3 text-pretty text-base leading-7 text-secondary">
                  {value.bio}
                </p>
              </section>
            ) : null}

            <dl className="mt-8 divide-y divide-line border-y border-line">
              {value.qualification !== null && value.qualification !== "" ? (
                <div className="grid gap-1.5 py-4 sm:grid-cols-[180px_1fr] sm:gap-6">
                  <dt className="text-sm font-semibold text-navy">{dict.profile.qualification}</dt>
                  <dd className="text-sm leading-6 text-secondary">{value.qualification}</dd>
                </div>
              ) : null}
              <div className="grid gap-1.5 py-4 sm:grid-cols-[180px_1fr] sm:gap-6">
                <dt className="text-sm font-semibold text-navy">{dict.profile.experience}</dt>
                <dd className="text-sm text-secondary">
                  {value.experienceYears === null
                    ? dict.profile.notPublished
                    : dict.search.yearsExperience.replace("{years}", formatNumber(value.experienceYears, locale))}
                </dd>
              </div>
              <div className="grid gap-1.5 py-4 sm:grid-cols-[180px_1fr] sm:gap-6">
                <dt className="text-sm font-semibold text-navy">{dict.profile.serviceRadius}</dt>
                <dd className="text-sm text-secondary">
                  {dict.profile.serviceRadiusValue.replace("{radius}", formatDistance(value.radiusM, locale))}
                </dd>
              </div>
            </dl>

            {value.services.length > 0 ? (
              <section aria-labelledby="offers-heading" className="mt-8">
                <h2 id="offers-heading" className="flex items-center gap-2 text-[20px] font-semibold tracking-[-0.03em] text-navy">
                  <Wrench className="size-5 text-slate-400" aria-hidden="true" />
                  {dict.profile.servicesOffered}
                </h2>
                <ul className="mt-4 grid gap-2.5 sm:grid-cols-2">
                  {value.services.map((service) => (
                    <li key={service.serviceId}>
                      <Link
                        href={`${localizedPath(locale, "/providers")}?service=${encodeURIComponent(service.slug)}`}
                        className="flex items-center justify-between gap-3 rounded-[10px] border border-line bg-white p-3.5 transition-colors duration-200 hover:border-slate-300 hover:bg-slate-50"
                      >
                        <span className="truncate text-sm font-medium text-navy">{service.nameEn}</span>
                        <span className="shrink-0 text-sm font-semibold text-primary-strong tabular-nums">
                          {money(service.pricePaisa, locale)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
                {/* The API publishes provider service names in English only. */}
                {locale === "ur" ? <p className="mt-3 text-xs leading-5 text-muted">خدمتوں کے نام انگریزی میں دیے گئے ہیں۔</p> : null}
              </section>
            ) : null}

            {value.areas.length > 0 ? (
              <section aria-labelledby="coverage-heading" className="mt-8">
                <h2 id="coverage-heading" className="flex items-center gap-2 text-[20px] font-semibold tracking-[-0.03em] text-navy">
                  <MapPin className="size-5 text-slate-400" aria-hidden="true" />
                  {dict.profile.coverage}
                </h2>
                <ul className="mt-4 flex flex-wrap gap-2">
                  {value.areas.map((area) => (
                    <li
                      key={area.areaId}
                      className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 text-[13px] font-medium text-secondary"
                    >
                      <MapPin className="size-3.5 shrink-0 text-slate-400" aria-hidden="true" />
                      {area.name}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <div className="mt-8 grid gap-6">
              <ReputationSection
                locale={locale}
                dict={dict}
                providerId={value.providerId}
                reputation={value.reputation}
              />
              <RemarksSection locale={locale} dict={dict} providerId={value.providerId} />
            </div>
          </div>

          <aside className="lg:sticky lg:top-[calc(var(--demo-bar-h,0px)+1.5rem)] lg:self-start">
            <div className="rounded-[16px] border border-line bg-white p-5 shadow-soft sm:p-6">
              <h2 className="text-[19px] font-semibold tracking-[-0.03em] text-navy">{dict.profile.bookingHeading}</h2>
              <div className="mt-5">
                <AvailabilityPanel locale={locale} dict={dict} providerId={value.providerId} services={value.services} />
              </div>
            </div>
          </aside>
        </div>
      </section>
    </>
  );
}

function ProfileSkeleton() {
  return (
    <div className="container-shell grid gap-10 py-10 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-14" aria-busy="true" aria-live="polite">
      <div>
        <LoadingSkeleton className="h-4 w-28" />
        <LoadingSkeleton className="mt-4 h-10 w-2/3" />
        <LoadingSkeleton className="mt-4 h-4 w-full" />
        <LoadingSkeleton className="mt-8 h-32 w-full" />
        <LoadingSkeleton className="mt-6 h-40 w-full" />
      </div>
      <div>
        <LoadingSkeleton className="h-80 w-full rounded-[16px]" />
      </div>
    </div>
  );
}