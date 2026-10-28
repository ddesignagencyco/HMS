'use client';

import { BadgeCheck, BriefcaseBusiness, MapPinned, Star } from 'lucide-react';
import type { Dictionary } from '@/lib/dictionaries';
import { formatNumber, localizedPath, type Locale } from '@/lib/utils';
import { Container, Section, SectionHeader, TextLink } from '@/components/ui';
import { Reveal } from '@/components/reveal';
import { AtmosphericBackground } from '@/components/layout/atmospheric-background';
import { ProfessionalCard } from '@/components/cards';
import { useAllServices, useCategories } from '@/features/catalogue/queries';
import { useCities, useCityAreas } from '@/features/places/queries';
import { useProviderSearch } from '@/features/search/queries';
import { cityCentre, ratingOf } from '@/features/search/location';

/* Neighbouring surface colour, matched to the server-module home sections so a
   wave never shows a seam. `home-sections.tsx` keeps its own copy for the same
   reason — it is a server module and this one is not. */
const WHITE = '#ffffff';

/* The home page's platform sections, over the live API.
 *
 * These three used to be static markup in `home-sections.tsx`, counted and ranked
 * from `src/lib/data.ts`: a fixed number of professionals, an average built from
 * three invented ratings, a list of invented coverage areas. The homepage then
 * advertised a marketplace that did not exist, with a 4.8 average next to
 * `/providers` showing nothing.
 *
 * This file is a client module for the same reason `home-catalogue.tsx` is: they
 * call `useQuery`, and a hook invoked from a server component throws. It is kept
 * separate so the genuinely static sections in `home-sections.tsx` — the hero,
 * the process band, the FAQ — stay out of the client bundle. */

/* ================================================================== *
 * LEVEL 2 — TRUST / METRICS
 * ================================================================== */

/**
 * Four figures, all of them countable from the API.
 *
 * The average is the mean of the *published* scores of the professionals the
 * search actually returned, and it is omitted entirely when there are none. A
 * homepage that says "4.8" while `/providers` returns an empty list is the kind of
 * claim this section exists to make and must not make.
 */
export function PlatformMetricsSection({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const cities = useCities(locale);
  const city = cities.data?.items[0] ?? null;
  const areas = useCityAreas(city?.id ?? null, locale);
  const services = useAllServices(locale);

  /* Search needs a service and a point. Both come from the API: the first real
     service and the centre the API publishes for the first real city. With
     neither there is no search to make, and the figure is left unread rather
     than falling back to a hardcoded point. */
  const service = services.data?.items[0] ?? null;
  const point = cityCentre(city);

  const search = useProviderSearch(
    service !== null && point !== null ? { serviceSlug: service.slug, lat: point.lat, lng: point.lng } : null,
    locale,
  );

  const professionals = search.data?.items ?? [];
  const rated = professionals.map((row) => ratingOf(row.ratingScore)).filter((value) => value.rated);
  const average = rated.length > 0 ? rated.reduce((sum, value) => sum + (value.rated ? value.score : 0), 0) / rated.length : null;

  const metrics = [
    /* How many professionals the search actually returns — a live count, not the
       size of a mock array. */
    { icon: BadgeCheck, value: search.isSuccess ? professionals.length : null, label: dict.home.metricProfessionals, decimals: 0 },
    /* No score, no figure. Not 0.0, not the prior. */
    { icon: Star, value: average, label: dict.home.metricRating, decimals: 1 },
    /* Services the catalogue actually publishes. */
    { icon: BriefcaseBusiness, value: services.isSuccess ? services.data.items.length : null, label: dict.home.metricJobs, decimals: 0 },
    /* Areas the platform actually operates in. */
    { icon: MapPinned, value: areas.isSuccess ? areas.data.items.length : null, label: dict.home.metricAreas, decimals: 0 },
  ];

  return (
    <Section size="feature" tone="dark" waveTop={{ fill: WHITE, shape: 'left', depth: { sm: 22, md: 44, lg: 84 } }}>
      <AtmosphericBackground variant="trust" />
      <Container className="relative grid gap-14 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:items-center lg:gap-20">
        <Reveal variant="from-start">
          <p className="eyebrow eyebrow-light">{dict.home.trustEyebrow}</p>
          <h2 className="title-section mt-4 max-w-lg text-white">{dict.home.trustTitle}</h2>
          <p className="mt-4 max-w-sm text-pretty text-base leading-7 text-white/70">{dict.home.trustDescription}</p>
        </Reveal>
        <Reveal variant="from-end" delay={90}>
          <dl className="grid grid-cols-2 gap-6 sm:gap-8">
            {metrics.map(({ icon: Icon, value, label, decimals }) => (
              <div key={label} className="border-t border-white/15 pt-5">
                <dt className="flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-white/55">
                  <Icon className="size-3.5" aria-hidden="true" />
                  {label}
                </dt>
                {/* A figure that could not be read is shown as a dash, never as
                    zero: "0 professionals" and "we could not ask" are different
                    facts and the second must not read as the first. */}
                <dd className="mt-2 text-4xl font-semibold tracking-[-0.04em] text-white tabular-nums">
                  {value === null ? '—' : decimals === 1 ? value.toFixed(1) : formatNumber(value, locale)}
                </dd>
              </div>
            ))}
          </dl>
        </Reveal>
      </Container>
    </Section>
  );
}

/* ================================================================== *
 * FEATURED PROFESSIONALS
 * ================================================================== */

/**
 * The professionals the API's own ranking returns for a real service and a real
 * point, in the API's order.
 *
 * The previous version named three professionals from the mock file with photos,
 * ratings and a "next available" time that were all invented. `ProfessionalCard`
 * takes a photo, so a card here is only rendered from fields the search row
 * actually has — which is why this section uses the compact card shape rather
 * than pretending a portrait exists.
 */
export function FeaturedProfessionalsSection({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const cities = useCities(locale);
  const city = cities.data?.items[0] ?? null;
  const services = useAllServices(locale);
  const service = services.data?.items[0] ?? null;
  const point = cityCentre(city);

  const search = useProviderSearch(
    service !== null && point !== null ? { serviceSlug: service.slug, lat: point.lat, lng: point.lng } : null,
    locale,
  );
  const professionals = search.data?.items ?? [];
  const serviceName = service === null ? null : locale === 'ur' ? service.nameUr : service.nameEn;

  return (
    <Section size="default" tone="light">
      <Container>
        <SectionHeader
          eyebrow={dict.home.prosEyebrow}
          title={dict.home.prosTitle}
          description={dict.home.prosDescription}
          action={<TextLink href={localizedPath(locale, '/providers')}>{dict.home.browsePros}</TextLink>}
        />
        <div className="header-gap grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-6 xl:grid-cols-3">
          {professionals.slice(0, 3).map((provider, index) => (
            <Reveal key={provider.providerId} delay={index * 60} variant="card" className="h-full min-w-0">
              <FeaturedCard locale={locale} dict={dict} provider={provider} serviceName={serviceName} />
            </Reveal>
          ))}
        </div>
      </Container>
    </Section>
  );
}

/**
 * A search row, rendered with nothing added.
 *
 * `/search/providers` publishes no photograph, no name and no free-text next
 * slot, so this card leads with the qualification and shows the real numbers. The
 * old `ProfessionalCard` required an image and a next-available time, both of
 * which would have had to be invented.
 */
function FeaturedCard({
  locale,
  dict,
  provider,
  serviceName,
}: {
  locale: Locale;
  dict: Dictionary;
  provider: import('@/features/search/api').ProviderSearchResult;
  serviceName: string | null;
}) {
  const rating = ratingOf(provider.ratingScore);
  return (
    <article className="flex h-full flex-col rounded-xl border border-slate-200/90 bg-white p-5">
      <h3 className="text-base font-bold leading-snug tracking-tight text-navy">
        {provider.qualification ?? dict.profile.titleFallback}
      </h3>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-secondary">
        {rating.rated ? (
          <span className="inline-flex items-center gap-1">
            <Star className="size-3.5 fill-amber-400 text-amber-400" aria-hidden="true" />
            <span className="font-semibold text-navy tabular-nums">{rating.score.toFixed(2)}</span>
            {provider.ratingCount > 0 ? <span className="text-muted">({formatNumber(provider.ratingCount, locale)})</span> : null}
          </span>
        ) : (
          <span className="text-muted">{dict.profile.noRatingsYet}</span>
        )}
        {provider.experienceYears !== null ? (
          <span>{dict.search.yearsExperience.replace('{years}', formatNumber(provider.experienceYears, locale))}</span>
        ) : null}
      </div>
      {provider.bio !== null && provider.bio !== '' ? (
        <p dir="auto" className="clamp-lines-2 mt-3 text-pretty text-sm leading-6 text-secondary">
          {provider.bio}
        </p>
      ) : null}
      <TextLink href={localizedPath(locale, `/providers/${provider.providerId}`)} className="mt-auto pt-4">
        {serviceName ?? dict.catalogue.viewService}
      </TextLink>
    </article>
  );
}

/* ================================================================== *
 * COVERAGE
 * ================================================================== */

/**
 * The areas the platform actually operates in.
 *
 * Each link carries the area's own centroid, which is a real point the search
 * accepts — so following one lands on a `/providers` page that can actually run a
 * query, rather than on a filter the server cannot satisfy.
 */
export function CoverageSection({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const cities = useCities(locale);
  const city = cities.data?.items[0] ?? null;
  const areas = useCityAreas(city?.id ?? null, locale);
  const list = areas.data?.items ?? [];

  const hrefFor = (areaId: number, lat: number | null, lng: number | null): string => {
    const params = new URLSearchParams();
    if (city !== null) params.set('city', String(city.id));
    params.set('area', String(areaId));
    /* Only carried when the API actually published one: a search point that is
       not in the URL is a page that cannot search, and a made-up one would search
       somewhere the customer did not ask for. */
    if (city !== null && typeof lat === 'number' && typeof lng === 'number') {
      params.set('lat', String(lat));
      params.set('lng', String(lng));
      params.set('source', 'city');
    }
    return `${localizedPath(locale, '/providers')}?${params.toString()}`;
  };

  return (
    <Section size="default" tone="light">
      <Container>
        <SectionHeader
          eyebrow={dict.home.coverageEyebrow}
          title={dict.home.coverageTitle}
          description={dict.home.coverageDescription}
          action={<TextLink href={localizedPath(locale, '/providers')}>{dict.home.coverageAction}</TextLink>}
        />
        {areas.isPending ? (
          <div className="header-gap grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }, (_unused, index) => (
              <span key={index} className="skeleton h-12 rounded-[9px]" />
            ))}
          </div>
        ) : areas.isError ? (
          <p role="alert" className="mt-4 rounded-[9px] bg-rose-50 p-4 text-sm text-rose-700">
            {dict.search.loadError}
          </p>
        ) : list.length === 0 ? (
          /* An empty platform is a fact to state, not a gap to paper over. */
          <p className="mt-4 rounded-[12px] border border-line bg-white p-6 text-sm leading-6 text-secondary">
            {dict.common.empty}
          </p>
        ) : (
          <div className="header-gap grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {list.map((area) => (
              <TextLink key={area.id} href={hrefFor(area.id, area.lat, area.lng)} className="flex items-center gap-2 rounded-[9px] border border-line bg-white px-3 py-2.5 text-sm font-medium text-navy">
                <MapPinned className="size-4 shrink-0 text-slate-400" aria-hidden="true" />
                <span className="truncate">{area.name}</span>
              </TextLink>
            ))}
          </div>
        )}
      </Container>
    </Section>
  );
}