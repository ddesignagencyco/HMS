'use client';

import type { Dictionary } from '@/lib/dictionaries';
import { formatDuration, formatMoney, formatNumber, localizedPath, type Locale } from '@/lib/utils';
import { Container, Section, SectionHeader, TextLink, buttonStyles } from '@/components/ui';
import { CategoryCard, PopularServiceCard } from '@/components/cards';
import { Reveal } from '@/components/reveal';
import { useAllServices, useCategories } from '@/features/catalogue/queries';

/* The two catalogue-reading sections of the home page.

   **This file is a client module and it has to stay one.** `home-sections.tsx`
   has no `"use client"` — it is a server module, because every other section on
   the page is static markup over `src/lib/data.ts`. These two are the exception:
   they call `useQuery`, and a hook invoked from a server component throws
   "Attempted to call useQuery() from the server but useQuery is on the client".

   That is why they live here rather than in `home-sections.tsx`: marking the
   whole file `"use client"` would push every other section — the hero, the
   process band, the FAQ, the coverage map — into the client bundle for the sake
   of two sections. `hero-search.tsx` is the same arrangement for the same reason,
   and `app/[locale]/(public)/page.tsx` imports both this file and that one
   directly.

   If either section ever goes back to reading `src/lib/data.ts`, delete this
   file and move them back — they do not need the client without it. */

/* ================================================================== *
 * LEVEL 3 — EXPLORE SERVICES (category discovery)
 * Straight top edge: the hero is a peak, so the cut back to white is
 * a straight one. Left-heavy wave arrives only on the section below.
 * ================================================================== */
export function CategorySection({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const categoriesQuery = useCategories(locale);
  /* The count on each card is real: it comes from the same fan-out `/services`
     uses, so the number on the home page and the number on the services page
     cannot disagree. */
  const servicesQuery = useAllServices(locale);

  const active = (categoriesQuery.data?.items ?? []).filter((category) => category.isActive).sort((a, b) => a.sortOrder - b.sortOrder);

  const countFor = (categoryId: number): number => (servicesQuery.data?.items ?? []).filter((service) => service.categoryId === categoryId && service.isActive).length;

  /* One catalogue, one answer. The previous version of this section counted
     `src/lib/data.ts`, so the home page advertised a catalogue that `/services`
     did not have — the same services, with the same prices, from two lists.

     Both queries have to succeed. If the category list loads but the service
     fan-out fails, every card would read "0 services", which is a worse lie than
     an error: it looks like a real, empty catalogue. */
  if (categoriesQuery.isError || servicesQuery.isError) {
    return (
      <CatalogueNotice
        dict={dict}
        onRetry={() => {
          void categoriesQuery.refetch();
          void servicesQuery.refetch();
        }}
      />
    );
  }

  return (
    <Section size="default" className="section-after-hero">
      <Container className="relative">
        <Reveal>
          <SectionHeader
            eyebrow={dict.home.categoriesEyebrow}
            title={dict.home.categoriesTitle}
            description={dict.home.categoriesDescription}
            action={<TextLink href={localizedPath(locale, '/services')}>{dict.home.browseServices}</TextLink>}
          />
        </Reveal>
        <div className="header-gap grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-6 xl:grid-cols-3">
          {categoriesQuery.isPending || servicesQuery.isPending
            ? Array.from({ length: 3 }, (_unused, index) => <span key={index} aria-hidden="true" className="skeleton h-72 w-full rounded-[14px]" />)
            : active.slice(0, 3).map((category, index) => (
                <Reveal key={category.id} as="div" delay={index * 60} variant="card" className="h-full min-w-0">
                  <CategoryCard
                    href={localizedPath(locale, `/services?category=${category.slug}`)}
                    meta={dict.common.servicesCount.replace('{count}', formatNumber(countFor(category.id), locale))}
                    categoryIcon={category.slug}
                    title={locale === 'ur' ? category.nameUr : category.nameEn}
                    /* The API publishes no category description, so the card says
                     what a category is for in general terms rather than inventing
                     per-category copy that would itself be a second source of
                     truth for the catalogue. */
                    description={dict.home.categoryGenericBlurb}
                    cta={dict.home.explore}
                  />
                </Reveal>
              ))}
        </div>
      </Container>
    </Section>
  );
}

/* ================================================================== *
 * LEVEL 3 — A GOOD PLACE TO START (bookable jobs)
 * Straight top edge after the dark band, then a very shallow curve into
 * Process. Compact, price-forward rows: nothing decorative at all here.
 * ================================================================== */
export function PopularServicesSection({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const servicesQuery = useAllServices(locale);

  /* Bookable services from the published catalogue, cheapest first, so the
     "from" figure a visitor reads is one they can actually book at. The previous
     version picked `services[6]`, `services[9]` and `services[15]` by array
     position — a list that changed shape whenever the mock file was edited.

     The section was called "Popular services" and that claim was not true: the
     API publishes no popularity signal of any kind. It is ordered by price, and
     `dict.home.popularNote` now says so on screen rather than implying a
     ranking the data cannot support. */
  const featured = [...(servicesQuery.data?.items ?? [])]
    .filter((service) => service.isActive)
    .sort((a, b) => a.basePricePaisa - b.basePricePaisa)
    .slice(0, 3);

  if (servicesQuery.isError) {
    return <CatalogueNotice dict={dict} onRetry={() => void servicesQuery.refetch()} />;
  }

  return (
    <Section size="compact" tone="surface">
      <Container className="relative">
        <Reveal>
          <SectionHeader
            eyebrow={dict.home.popularEyebrow}
            title={dict.home.popularTitle}
            description={dict.home.popularNote}
            action={<TextLink href={localizedPath(locale, '/services')}>{dict.home.browseServices}</TextLink>}
          />
        </Reveal>
        <div className="header-gap grid gap-4">
          {servicesQuery.isPending
            ? Array.from({ length: 3 }, (_unused, index) => <span key={index} aria-hidden="true" className="skeleton h-32 w-full rounded-[14px]" />)
            : featured.map((service, index) => (
                <Reveal key={service.id} delay={index * 70} variant="card" className="min-w-0">
                  <PopularServiceCard
                    href={localizedPath(locale, `/services/${service.slug}`)}
                    /* The fan-out already joins the category onto every service, so
                     the name and the slug come from the same response. */
                    category={locale === 'ur' ? service.categoryNameUr : service.categoryNameEn}
                    categoryIcon={service.categorySlug}
                    title={locale === 'ur' ? service.nameUr : service.nameEn}
                    duration={formatDuration(service.expectedDurationMin, locale)}
                    warranty={dict.common.warranty.replace('{days}', formatNumber(service.warrantyDays, locale))}
                    priceFrom={dict.common.from}
                    price={formatMoney(service.basePricePaisa, locale)}
                    emergency={service.isEmergencyEligible}
                    emergencyLabel={dict.common.emergency}
                    actionLabel={dict.home.browseServices}
                  />
                </Reveal>
              ))}
        </div>
      </Container>
    </Section>
  );
}

/**
 * Shown when the catalogue itself cannot be read. A home page that quietly drops
 * its service sections during an outage looks like a site with nothing to sell,
 * so it says what happened instead.
 */
function CatalogueNotice({ dict, onRetry }: { dict: Dictionary; onRetry: () => void }) {
  return (
    <Section size="compact" tone="surface">
      <Container className="relative">
        <div role="alert" className="rounded-[14px] border border-rose-200 bg-rose-50 p-6">
          <p className="text-sm font-medium leading-6 text-rose-800">{dict.catalogue.loadError}</p>
          <button type="button" onClick={onRetry} className={buttonStyles({ variant: 'secondary', className: 'mt-4' })}>
            {dict.catalogue.retry}
          </button>
        </div>
      </Container>
    </Section>
  );
}
