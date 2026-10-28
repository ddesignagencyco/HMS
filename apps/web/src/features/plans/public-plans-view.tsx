'use client';

/* The public plan catalogue — `GET /plans`, which is `@Public()`.
 *
 * **This page used to invent three tiers.** A `tiers` array held
 * "care" / "plus" / "cover" at Rs 4,900, 8,900 and 14,900 with 2, 4 and
 * 6 visits, and every bullet on each card was a marketing string keyed
 * by that tier id. Not one of those numbers existed anywhere — `plans`
 * was an empty table that no route read. A price card is a commitment: a
 * visitor could reasonably hold the platform to Rs 8,900 for four
 * visits — so the array is gone rather than "kept as an example".
 *
 * What is on the page now is what the server sent: each plan's own
 * `nameEn`/`nameUr`, its stored `pricePaisa`, its `durationMonths`, and
 * the `plan_services` rows behind it — service name, how many visits,
 * how many days apart.
 *
 * **There is no "most popular" badge.** The old `featured: true` flag
 * was decoration on an invented tier. Nothing in the API ranks plans,
 * and a badge implying a recommendation the server did not make is the
 * same class of error as a made-up price.
 *
 * **The visit count is a sum, and it is a count.** `planTotalVisits`
 * adds `visitsIncluded` across the plan's service rows. That is a count
 * of visits, not money, so summing it in the browser is safe — the
 * *price* is never divided here, because `distributePlanVisits` already
 * split it to the exact paisa at purchase time.
 *
 * **An empty catalogue is a real answer.** No plan published is stated
 * as such, with somewhere useful to go. There is no fallback tier. */

import { ArrowRight, CheckCircle2, Repeat2, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { ButtonLink, Card, Container, PageBanner, Section, SectionHeader, buttonStyles } from '@/components/ui';
import { planName, planServiceName, planTotalVisits } from '@/features/plans/api';
import { usePlans } from '@/features/plans/queries';
import { getDictionary } from '@/lib/dictionaries';
import { cn, formatMoney, formatNumber, localizedPath, type Locale } from '@/lib/utils';

const stepOrder = ['choose', 'schedule', 'release'] as const;

export function PlansCatalogue({ locale }: { locale: Locale }) {
  const dict = getDictionary(locale);
  const plans = usePlans(locale);
  const items = plans.data?.items ?? [];

  /* The grid widens with the data: three plans get three columns, two get
     two, one is capped rather than stretched across a 3-column track. */
  const grid = items.length >= 3 ? 'lg:grid-cols-3' : items.length === 2 ? 'lg:grid-cols-2' : 'max-w-md';

  return (
    <>
      <PageBanner eyebrow={dict.plansPage.eyebrow} title={dict.plansPage.titleLead} titleAccent={dict.plansPage.titleAccent} description={dict.plansPage.description} />

      <Section tone="light" size="feature">
        <Container>
          {plans.isPending ? (
            <Card className="p-8 text-center text-sm text-muted" aria-busy="true">
              {dict.portal.plansLoading}
            </Card>
          ) : plans.isError ? (
            <div role="alert" className="rounded-[14px] border border-rose-200 bg-rose-50 p-5">
              <p className="text-sm font-medium leading-6 text-rose-800">{dict.portal.plansCatalogueError}</p>
            </div>
          ) : items.length === 0 ? (
            <Card className="border-dashed p-10 text-center">
              <span className="mx-auto grid size-12 place-items-center rounded-full bg-surface-2 text-muted" aria-hidden="true">
                <Sparkles className="size-6" />
              </span>
              <h2 className="mt-4 text-lg font-semibold text-navy">{dict.plansPage.emptyTitle}</h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-secondary">{dict.plansPage.emptyText}</p>
              <Link href={localizedPath(locale, '/services')} className={buttonStyles({ variant: 'primary', className: 'mt-6' })}>
                {dict.home.browseServices}
                <ArrowRight className="size-4 arrow-slide rtl:rotate-180" aria-hidden="true" />
              </Link>
            </Card>
          ) : (
            <div className={cn('grid gap-5', grid)}>
              {items.map((plan) => (
                <div key={plan.id} className="flex h-full flex-col rounded-[14px] bg-white p-6 ring-1 ring-navy/[0.06]">
                  <span className="grid size-11 place-items-center rounded-[10px] bg-blue-50 text-primary-strong" aria-hidden="true">
                    <CheckCircle2 className="size-5" />
                  </span>
                  <h2 className="mt-4 text-[19px] font-semibold tracking-[-0.03em] text-navy">{planName(plan, locale)}</h2>
                  <p className="mt-3 flex items-baseline gap-2">
                    <strong className="text-[32px] font-semibold tracking-[-0.04em] text-navy tabular-nums">{formatMoney(plan.pricePaisa, locale)}</strong>
                    <span className="text-sm text-muted">
                      {dict.plansPage.forLabel} {formatNumber(plan.durationMonths, locale)} {dict.plansPage.months}
                    </span>
                  </p>
                  <p className="mt-1 text-sm text-secondary">
                    {formatNumber(planTotalVisits(plan.services), locale)} {dict.plansPage.visits}
                  </p>

                  <h3 className="mt-5 text-xs font-semibold uppercase tracking-[0.08em] text-muted">{dict.plansPage.included}</h3>
                  <ul className="mt-2.5 grid gap-2">
                    {plan.services.map((service) => (
                      <li key={service.serviceId} className="flex items-start gap-2.5 text-sm leading-6 text-secondary">
                        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden="true" />
                        <span>
                          {planServiceName(service, locale)} — {formatNumber(service.visitsIncluded, locale)} {dict.plansPage.visits}, {dict.plansPage.every}{' '}
                          {formatNumber(service.intervalDays, locale)} {dict.plansPage.days}
                        </span>
                      </li>
                    ))}
                  </ul>

                  {/* `plans.description` is a single column with no Urdu counterpart (B5),
                       so on `/ur/plans` this line is the one English sentence on
                       the card. It is rendered as the server sent it rather than
                       hidden — a plan card with no description would be worse —
                       and the gap is written up. */}
                  <p className="mt-4 text-sm leading-6 text-secondary">{plan.description}</p>

                  <div className="mt-6 flex-1" />
                  <ButtonLink href={localizedPath(locale, '/auth/register')} className="w-full">
                    {dict.plansPage.choose}
                  </ButtonLink>
                </div>
              ))}
            </div>
          )}
          <p className="mt-6 text-sm text-muted">{dict.plansPage.coverageNote}</p>
        </Container>
      </Section>

      {/* How it works sits on its own light band, so the two navy fields
          never stack into one flat mass. It is process copy, not plan
          data, so it stays as dictionary text. */}
      <Section tone="surface" size="default">
        <Container>
          <div className="grid gap-10 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:items-center lg:gap-16">
            <div>
              <SectionHeader variant="left" eyebrow={dict.plansPage.howEyebrow} title={dict.plansPage.howTitle} description={dict.plansPage.howText} />
              <Link href={localizedPath(locale, '/services')} className={buttonStyles({ variant: 'secondary', className: 'group mt-7' })}>
                <Repeat2 className="size-4" aria-hidden="true" />
                {dict.home.browseServices}
                <ArrowRight className="size-4 arrow-slide rtl:rotate-180" aria-hidden="true" />
              </Link>
            </div>
            <ol className="grid gap-3">
              {stepOrder.map((key, index) => (
                <li key={key} className="flex gap-4 rounded-[12px] border border-line bg-white p-5">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-navy text-[13px] font-semibold text-white tabular-nums">{index + 1}</span>
                  <div>
                    <h3 className="text-[16px] font-semibold tracking-[-0.02em] text-navy">{dict.plansPage.steps[key].title}</h3>
                    <p className="mt-1.5 text-sm leading-6 text-secondary">{dict.plansPage.steps[key].text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </Container>
      </Section>

      <Section tone="light" size="feature">
        <Container>
          <div className="relative isolate overflow-hidden rounded-[20px] bg-navy-950 px-6 py-14 text-center text-white sm:px-12 sm:py-16">
            <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(58%_78%_at_50%_0%,rgba(37,99,235,0.32),transparent_68%)]" />
            <div className="relative mx-auto flex max-w-2xl flex-col items-center">
              <p className="eyebrow eyebrow-dark justify-center">{dict.plansPage.ctaEyebrow}</p>
              <h2 className="title-page mt-5 text-white">
                {dict.plansPage.ctaTitleLead} <span className="text-yellow-500">{dict.plansPage.ctaTitleAccent}</span>
              </h2>
              <p className="mt-5 max-w-xl text-pretty text-base leading-7 text-slate-300">{dict.plansPage.ctaDescription}</p>
              <div className="mt-9 flex w-full flex-col items-center gap-3 sm:w-auto sm:flex-row sm:justify-center">
                <Link href={localizedPath(locale, '/auth/register')} className={buttonStyles({ variant: 'accent', size: 'lg', className: 'group w-full sm:w-auto' })}>
                  {dict.plansPage.ctaPrimary}
                  <ArrowRight className="size-4 arrow-slide rtl:rotate-180" aria-hidden="true" />
                </Link>
                <Link href={localizedPath(locale, '/services')} className={buttonStyles({ variant: 'outline-light', size: 'lg', className: 'w-full sm:w-auto' })}>
                  {dict.plansPage.ctaSecondary}
                </Link>
              </div>
            </div>
          </div>
        </Container>
      </Section>
    </>
  );
}
