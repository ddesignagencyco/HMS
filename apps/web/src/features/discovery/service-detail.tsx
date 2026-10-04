"use client";

import Link from "next/link";
import { AlertTriangle, ArrowUpRight, Banknote, Camera, CheckCircle2, Clock3, ShieldCheck, Sparkles } from "lucide-react";
import type { Dictionary } from "@/lib/dictionaries";
import { cn, formatDuration, localizedPath, type Locale } from "@/lib/utils";
import { ApiError } from "@/lib/api/problem";
import { buttonStyles } from "@/components/ui";
import { useCategories, useService } from "@/features/catalogue/queries";
import { presentPrice } from "@/features/catalogue/pricing";
import { InlineError, LoadingSkeleton, NotFoundState } from "@/features/discovery/states";

/* One service, from `GET /catalogue/services/:slug`.

   Every figure on this page comes from the service row: the pricing model
   decides whether the headline number is a fixed price, a rate or an estimate,
   and the checklist is the API's own list rather than marketing copy. A 404
   becomes a not-found state, not an empty page. */

export function ServiceDetail({ locale, dict, slug }: { locale: Locale; dict: Dictionary; slug: string }) {
  const service = useService(slug, locale);
  const categories = useCategories(locale);

  if (service.isPending) return <ServiceSkeleton />;

  if (service.isError) {
    if (service.error instanceof ApiError && service.error.status === 404) {
      return (
        <div className="container-shell py-16">
          <NotFoundState
            title={dict.catalogue.notFoundTitle}
            body={dict.catalogue.notFoundText}
            action={
              <Link href={localizedPath(locale, "/services")} className={buttonStyles()}>
                {dict.catalogue.breadcrumbServices}
              </Link>
            }
          />
        </div>
      );
    }
    return (
      <div className="container-shell py-16">
        <InlineError title={dict.catalogue.loadError} actionLabel={dict.catalogue.retry} onRetry={() => void service.refetch()} />
      </div>
    );
  }

  const value = service.data;
  const name = locale === "ur" ? value.nameUr : value.nameEn;
  const price = presentPrice(value, locale);
  const category = categories.data?.items.find((item) => item.id === value.categoryId) ?? null;
  const categoryName = category === null ? null : locale === "ur" ? category.nameUr : category.nameEn;

  const facts = [
    { icon: Clock3, label: dict.catalogue.duration, value: formatDuration(value.expectedDurationMin, locale) },
    ...(value.warrantyDays > 0
      ? [
          {
            icon: ShieldCheck,
            label: dict.catalogue.warranty.replace("{days}", String(value.warrantyDays)),
            value: dict.catalogue.warrantyNote.replace("{days}", String(value.warrantyDays)),
          },
        ]
      : []),
    ...(value.isEmergencyEligible ? [{ icon: Sparkles, label: dict.catalogue.emergencyEligible, value: dict.catalogue.emergencyNote }] : []),
    ...(value.isPlanEligible ? [{ icon: CheckCircle2, label: dict.catalogue.planEligible, value: dict.catalogue.planNote }] : []),
    ...(value.isHighRisk ? [{ icon: AlertTriangle, label: dict.catalogue.highRisk, value: dict.catalogue.highRiskNote }] : []),
    ...(value.visitFeePaisa > 0
      ? [{ icon: Banknote, label: dict.catalogue.visitFee, value: price.visitFee ?? "" }]
      : []),
  ].filter((fact) => fact.value !== "");

  const searchHref = `${localizedPath(locale, "/providers")}?service=${encodeURIComponent(value.slug)}`;

  return (
    <>
      <nav aria-label={dict.catalogue.breadcrumbHome} className="border-b border-line bg-white">
        <div className="container-shell flex items-center gap-2 py-3 text-sm text-muted">
          <Link href={localizedPath(locale)} className="transition-colors hover:text-navy">
            {dict.catalogue.breadcrumbHome}
          </Link>
          <span aria-hidden="true">/</span>
          <Link href={localizedPath(locale, "/services")} className="transition-colors hover:text-navy">
            {dict.catalogue.breadcrumbServices}
          </Link>
          {category !== null ? (
            <>
              <span aria-hidden="true">/</span>
              <Link href={`${localizedPath(locale, "/services")}?category=${category.slug}`} className="transition-colors hover:text-navy">
                {categoryName}
              </Link>
            </>
          ) : null}
          <span aria-hidden="true">/</span>
          <span aria-current="page" className="truncate font-medium text-navy">
            {name}
          </span>
        </div>
      </nav>

      <section className="bg-page py-10 sm:py-14">
        <div className="container-shell grid gap-10 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-14">
          <div className="min-w-0">
            <p className="eyebrow eyebrow-light">{categoryName ?? dict.catalogue.eyebrow}</p>
            <h1 className="title-page mt-3 text-navy">{name}</h1>
            <p dir="auto" className="mt-4 max-w-2xl text-pretty text-lg leading-8 text-secondary">
              {value.description}
            </p>

            {facts.length > 0 ? (
              <dl className="mt-8 divide-y divide-line border-y border-line">
                {facts.map(({ icon: Icon, label, value: factValue }) => (
                  <div key={label} className="flex items-start gap-4 py-4">
                    <Icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <dt className="text-sm font-semibold text-navy">{label}</dt>
                      {factValue !== "" ? <dd className="mt-0.5 text-sm leading-6 text-secondary">{factValue}</dd> : null}
                    </div>
                  </div>
                ))}
              </dl>
            ) : null}

            <section aria-labelledby="checklist-heading" className="mt-10">
              <h2 id="checklist-heading" className="text-[20px] font-semibold tracking-[-0.03em] text-navy">
                {dict.catalogue.checklistHeading}
              </h2>
              <p className="mt-2 text-sm text-secondary">{dict.catalogue.checklistNote}</p>
              {value.checklist.length === 0 ? (
                <p className="mt-4 text-sm text-secondary">{dict.common.empty}</p>
              ) : (
                <ol className="mt-5 grid gap-2.5">
                  {value.checklist.map((item) => (
                    <li key={item.id} className="flex items-start gap-3 rounded-[10px] border border-line bg-white p-4">
                      <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-blue-50 text-[11px] font-bold text-primary-strong tabular-nums">
                        {item.position}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p dir="auto" className="text-sm leading-6 text-navy">
                          {locale === "ur" ? item.labelUr : item.labelEn}
                        </p>
                        {item.requiresPhoto ? (
                          <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-muted">
                            <Camera className="size-3" aria-hidden="true" />
                            {dict.catalogue.checklistPhoto}
                          </p>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>

          <aside className="lg:sticky lg:top-[calc(var(--demo-bar-h,0px)+1.5rem)] lg:self-start">
            <div className="rounded-[16px] border border-line bg-white p-5 shadow-soft sm:p-6">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">{dict.catalogue.pricingHeading}</p>

              <p className="mt-2 text-[40px] font-semibold leading-none tracking-[-0.045em] text-navy tabular-nums">{price.primary}</p>
              <p className="mt-2 text-sm text-secondary">
                {price.basis === "flat" ? dict.catalogue.priceFlat : price.basis === "rate" ? dict.catalogue.priceRate : dict.catalogue.priceEstimate}
                {price.perUnit !== undefined ? ` · ${dict.catalogue[price.perUnit]}` : ""}
              </p>

              {price.range !== undefined ? (
                <p className="mt-3 border-t border-line pt-3 text-sm text-secondary">
                  {dict.catalogue.priceRange}:{" "}
                  <span className="font-medium text-navy tabular-nums">
                    {price.range.from} — {price.range.to}
                  </span>
                </p>
              ) : null}
              {price.visitFee !== undefined ? (
                <p className="mt-2 text-sm text-secondary">
                  {dict.catalogue.visitFee}: <span className="font-medium text-navy tabular-nums">{price.visitFee}</span>
                </p>
              ) : null}

              <div className="mt-6 grid gap-2.5">
                <Link href={searchHref} className={buttonStyles({ className: "group w-full" })}>
                  {dict.catalogue.findProfessionals}
                  <ArrowUpRight className="size-4 transition-transform duration-200 group-hover:translate-x-[2px] group-hover:-translate-y-[2px] rtl:rotate-180" aria-hidden="true" />
                </Link>
                <Link href={localizedPath(locale, `/book/${value.slug}`)} className={buttonStyles({ variant: "secondary", className: "w-full" })}>
                  {dict.catalogue.checkAvailability}
                </Link>
              </div>

              <Link
                href={`${localizedPath(locale, "/services")}${category === null ? "" : `?category=${category.slug}`}`}
                className={cn("mt-4 inline-flex text-sm font-semibold text-primary-strong transition-colors hover:text-primary")}
              >
                {dict.catalogue.categoriesHeading}
              </Link>
            </div>
          </aside>
        </div>
      </section>
    </>
  );
}

function ServiceSkeleton() {
  return (
    <div className="container-shell grid gap-10 py-10 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-14" aria-busy="true" aria-live="polite">
      <div>
        <LoadingSkeleton className="h-4 w-32" />
        <LoadingSkeleton className="mt-4 h-10 w-2/3" />
        <LoadingSkeleton className="mt-4 h-4 w-full" />
        <LoadingSkeleton className="mt-2 h-4 w-4/5" />
        <LoadingSkeleton className="mt-8 h-40 w-full" />
      </div>
      <div>
        <LoadingSkeleton className="h-64 w-full rounded-[16px]" />
      </div>
    </div>
  );
}