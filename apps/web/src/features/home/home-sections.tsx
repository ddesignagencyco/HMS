import { ArrowRight, BadgeCheck, BriefcaseBusiness, CheckCircle2, FileCheck2, MapPin, MapPinned, ReceiptText, Camera, ShieldCheck, Star } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import type { Dictionary } from '@/lib/dictionaries';
import { areas, heroImage, journeyImage, providers } from '@/lib/data';
import { formatDateTime, formatNumber, getText, localizedPath, type Locale } from '@/lib/utils';
import { cn } from '@/lib/utils';

import { Container, Eyebrow, Section, SectionHeader, TextLink, buttonStyles } from '@/components/ui';
import { AtmosphericBackground } from '@/components/layout/atmospheric-background';
import { ServiceDocument, VerificationGeometry } from '@/components/decorative';
import { DrawGraphic } from '@/components/motion/draw-graphic';
import { HeroDepth } from '@/components/motion/hero-depth';
import { ProcessJourney } from '@/components/motion/process-journey';
import { CountUp } from '@/components/motion/count-up';
import { Reveal } from '@/components/reveal';
import { ProfessionalCard } from '@/components/cards';
import { FaqAccordion } from '@/features/home/faq-accordion';
import { ReviewsEditorial } from '@/features/home/reviews-editorial';

const iconCard = 'size-[18px] shrink-0';
const iconTone = (tone: string) => `size-4 shrink-0 ${tone}`;
const arrowClass = iconTone('link-arrow arrow-slide rtl:rotate-180');

/* Neighbouring surface colours, matched exactly so a wave never shows
   an outline, a shadow or a seam. */
const WHITE = '#ffffff';
const SURFACE = '#f8fafc';

/* ================================================================== *
 * LEVEL 1 — HERO
 * Straight bottom edge: the floating search panel is the only overlap on
 * the page, and it is not repeated anywhere else.
 * ================================================================== */
export function HomeHero({ locale, dict, search }: { locale: Locale; dict: Dictionary; search?: React.ReactNode }) {
  return (
    <section className="relative overflow-x-clip bg-navy-950 pb-32 pt-14 text-white sm:pb-28 sm:pt-20">
      <AtmosphericBackground variant="hero" />

      <Container className="relative grid items-center gap-12 lg:grid-cols-[1fr_1.02fr] lg:gap-14">
        <div>
          <Reveal variant="from-start" delay={0}>
            <Eyebrow tone="dark">{dict.home.eyebrow}</Eyebrow>
          </Reveal>
          <Reveal variant="section" delay={70}>
            <h1 className="title-hero mt-5 text-white">
              {dict.home.titleLead} <span className="text-yellow-500">{dict.home.titleAccent}</span>
            </h1>
          </Reveal>
          <Reveal variant="copy" delay={140}>
            <p className="mt-5 max-w-xl text-pretty text-base leading-7 text-slate-300">{dict.home.description}</p>
          </Reveal>
          <Reveal variant="copy" delay={210}>
            <div className="mt-7 flex flex-wrap gap-x-6 gap-y-2.5 text-sm text-white">
              <span className="inline-flex items-center gap-2">
                <CheckCircle2 className={iconTone('text-yellow-500')} aria-hidden="true" />
                {dict.home.trustOne}
              </span>
              <span className="inline-flex items-center gap-2">
                <CheckCircle2 className={iconTone('text-yellow-500')} aria-hidden="true" />
                {dict.home.trustTwo}
              </span>
            </div>
          </Reveal>
        </div>

        <Reveal variant="media" delay={120}>
          <HeroDepth depth={4}>
            <figure className="relative m-0 overflow-hidden rounded-[16px] bg-navy-900 shadow-lifted ring-1 ring-white/10">
              <div className="relative aspect-[16/11] w-full">
                <Image src={heroImage.url} alt={getText(heroImage.alt, locale)} fill preload sizes="(max-width: 1023px) 100vw, 50vw" className="object-cover object-[50%_30%]" />
                <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgba(7,21,47,0.34),transparent_46%)]" />
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-navy-950/55 via-transparent to-transparent" />
                <span className="absolute end-4 top-4 inline-flex items-center gap-1.5 rounded-full bg-navy-950/90 px-3 py-1.5 text-xs font-semibold text-white ring-1 ring-white/15 backdrop-blur">
                  <BadgeCheck className={iconTone('text-yellow-500')} aria-hidden="true" />
                  {dict.providers.verified}
                </span>
                <div className="absolute bottom-4 start-4 inline-flex items-center gap-2 rounded-xl bg-navy-950/85 px-3.5 py-2 text-xs font-medium text-white shadow-lg backdrop-blur-sm ring-1 ring-white/15">
                  <div className="flex -space-x-0.5 rtl:space-x-reverse text-yellow-400">
                    <Star className="size-3.5 fill-current" aria-hidden="true" />
                    <Star className="size-3.5 fill-current" aria-hidden="true" />
                    <Star className="size-3.5 fill-current" aria-hidden="true" />
                    <Star className="size-3.5 fill-current" aria-hidden="true" />
                    <Star className="size-3.5 fill-current" aria-hidden="true" />
                  </div>
                  <span className="font-bold text-white">4.9/5</span>
                  <span className="text-slate-300 text-[11px]">• {locale === 'ur' ? 'لاہور میں تصدیق شدہ' : 'Verified in Lahore'}</span>
                </div>
              </div>
            </figure>
          </HeroDepth>
        </Reveal>
      </Container>

      {search ? (
        <div className="absolute inset-x-0 bottom-0 z-20 translate-y-1/2">
          <Container>
            <Reveal variant="section" delay={280}>
              {search}
            </Reveal>
          </Container>
        </div>
      ) : null}
    </section>
  );
}

/* ================================================================== *
 * LEVEL 3 — EXPLORE SERVICES (category discovery)
 *
 * `CategorySection` and `PopularServicesSection` used to live here. Both now
 * read the catalogue API, so both call `useQuery` — and this file is a *server*
 * module, which makes that a hard error:
 *
 *   "Attempted to call useQuery() from the server but useQuery is on the
 *    client."
 *
 * They live in `home-catalogue.tsx` instead, which is `"use client"` and is
 * imported straight from `app/[locale]/(public)/page.tsx`. Marking this whole
 * file `"use client"` would work and would be wrong: it would push the hero,
 * the process band, the FAQ and the coverage map into the client bundle for the
 * sake of two sections.
 * ================================================================== */

/* ================================================================== *
 * LEVEL 2 — TRUST / METRICS
 * Left-heavy wave: the navy arrives with its weight on the left, under
 * the brand statement, and lifts away to the right.
 * ================================================================== */
export function BrandTrustSection({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const averageRating = providers.length > 0 ? providers.reduce((sum, provider) => sum + provider.rating, 0) / providers.length : 0;
  const completedJobs = providers.reduce((sum, provider) => sum + provider.verifiedJobs, 0);
  const metrics = [
    { icon: BadgeCheck, value: providers.length, label: dict.home.metricProfessionals, decimals: 0 },
    { icon: Star, value: averageRating, label: dict.home.metricRating, decimals: 1 },
    { icon: BriefcaseBusiness, value: completedJobs, label: dict.home.metricJobs, decimals: 0 },
    { icon: MapPinned, value: areas.length, label: dict.home.metricAreas, decimals: 0 }
  ];

  return (
    <Section size="feature" tone="dark" waveTop={{ fill: WHITE, shape: 'left', depth: { sm: 22, md: 44, lg: 84 } }}>
      <AtmosphericBackground variant="trust" />
      <Container className="relative grid gap-14 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:items-center lg:gap-20">
        <Reveal variant="from-start">
          <p className="eyebrow eyebrow-dark">{dict.home.brandEyebrow}</p>
          <h2 className="title-section mt-4 max-w-xl text-white">
            {dict.home.brandTitleLead} <span className="text-yellow-500">{dict.home.brandTitleAccent}</span>
          </h2>
          <p className="mt-4 max-w-lg text-pretty text-base leading-7 text-slate-300">{dict.home.brandDescription}</p>
          <Link href={localizedPath(locale, '/services')} className={buttonStyles({ variant: 'accent', className: 'group lift-sm mt-8' })}>
            {dict.home.brandCta}
            <ArrowRight className={arrowClass} aria-hidden="true" />
          </Link>
        </Reveal>

        {/* no drawing in the band, so the figures carry it alone: the two
            rows sit at their own rhythm and the whole grid is centred
            against the statement, which leaves no dead air under either
            column. */}
        <Reveal variant="from-end" delay={80}>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-10 sm:gap-x-10 sm:gap-y-12">
            {metrics.map(({ icon: Icon, value, label, decimals }) => (
              <div key={label} className="border-t border-white/12 pt-4">
                {/* the label always holds two lines so all four figures sit
                    on exactly the same baseline, whatever the copy length */}
                <dt className="flex min-h-9 items-start gap-2 text-xs font-semibold uppercase leading-[1.5] tracking-[0.12em] text-slate-400">
                  <Icon className="mt-0.5 size-4 shrink-0 text-yellow-500" aria-hidden="true" />
                  <span className="min-w-0">{label}</span>
                </dt>
                <dd className="mt-1 text-[40px] font-semibold leading-none tracking-[-0.045em] text-white tabular-nums sm:text-[52px]">
                  <CountUp value={value} locale={locale} decimals={decimals} />
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
 * LEVEL 2 — PROCESS
 * Very shallow curve in, straight edge out. The photograph is deliberately
 * smaller than the step list, and the route drawing is the only graphic.
 * ================================================================== */
export function ProcessSection({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const steps = [
    { title: dict.home.process1, text: dict.home.process1Text },
    { title: dict.home.process2, text: dict.home.process2Text },
    { title: dict.home.process3, text: dict.home.process3Text },
    { title: dict.home.process4, text: dict.home.process4Text }
  ];
  return (
    <Section
      id="how-it-works"
      size="feature"
      tone="dark"
      className="[scroll-margin-top:calc(6rem+var(--demo-bar-h,0px))]"
      waveTop={{ fill: SURFACE, shape: 'shallow', depth: { sm: 14, md: 24, lg: 34 } }}
    >
      <AtmosphericBackground variant="process" />
      <Container className="relative">
        <Reveal variant="from-start">
          <SectionHeader
            variant="left"
            tone="dark"
            eyebrow={dict.home.processEyebrow}
            title={dict.home.processTitleLead}
            titleAccent={dict.home.processTitleAccent}
            accentTone="dark"
            description={dict.home.processDescription}
            className="max-w-2xl"
          />
        </Reveal>
        <div className="header-gap">
          <ProcessJourney steps={steps} image={journeyImage} locale={locale} />
        </div>
      </Container>
    </Section>
  );
}

/* ================================================================== *
 * LEVEL 3 — PROFESSIONALS
 * Straight edge in. A portrait grid, deliberately unlike the two service
 * grids above it: taller media, one person, one metadata baseline.
 * ================================================================== */
export function FeaturedProfessionalsSection({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  return (
    <Section size="default" tone="light">
      <Container className="relative">
        {/* one small verification mark, set in the empty ground beside the
            heading rather than repeated on every card */}
        <VerificationGeometry className="pointer-events-none absolute end-0 top-0 hidden h-[88px] w-[88px] text-primary/[0.10] lg:block" />
        <Reveal>
          <SectionHeader
            eyebrow={dict.home.prosEyebrow}
            title={dict.home.prosTitle}
            description={dict.home.prosDescription}
            action={<TextLink href={localizedPath(locale, '/providers')}>{dict.home.browsePros}</TextLink>}
          />
        </Reveal>
        <div className="header-gap grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-6 xl:grid-cols-3">
          {providers.slice(0, 3).map((provider, index) => (
            <Reveal key={provider.id} delay={index * 60} variant="card" className="h-full min-w-0">
              <ProfessionalCard
                locale={locale}
                href={localizedPath(locale, `/providers/${provider.slug}`)}
                image={{ url: provider.image.url, alt: getText(provider.image.alt, locale) }}
                focus={provider.focus}
                name={provider.name}
                specialisation={dict.providers.experience.replace('{years}', String(provider.experienceYears))}
                bio={getText(provider.bio, locale)}
                verifiedLabel={dict.providers.verified}
                rating={provider.rating}
                ratingCount={provider.ratingCount}
                ratingAriaLabel={dict.common.rating}
                jobs={dict.providers.jobs.replace('{count}', formatNumber(provider.verifiedJobs, locale))}
                availability={`${dict.home.nextAvailable} ${formatDateTime(provider.nextSlot, locale)}`}
              />
            </Reveal>
          ))}
        </div>
      </Container>
    </Section>
  );
}

/* ================================================================== *
 * LEVEL 3 — COVERAGE
 * The one light band between the dark process and dark trust bands, so the
 * page gets a quiet breath there. Links only: no cards, no images and no
 * drawing, because everything either side of it is already carrying weight.
 * ================================================================== */
export function CoverageSection({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  return (
    <Section size="default" tone="light">
      <Container className="relative">
        <Reveal>
          <SectionHeader
            eyebrow={dict.home.coverageEyebrow}
            title={dict.home.coverageTitle}
            description={dict.home.coverageDescription}
            action={<TextLink href={localizedPath(locale, '/providers')}>{dict.home.coverageAction}</TextLink>}
          />
        </Reveal>
        <Reveal variant="section" delay={60}>
          <ul className="header-gap flex flex-wrap gap-2.5">
            {areas.map((area) => (
              <li key={area.id}>
                <Link
                  href={localizedPath(locale, `/providers?area=${area.slug}`)}
                  className="group inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-white px-4 text-sm font-semibold text-navy transition-colors duration-200 hover:border-primary/40 hover:bg-blue-50 hover:text-primary-strong focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100"
                >
                  <MapPin className="size-3.5 shrink-0 text-muted transition-colors duration-200 group-hover:text-primary-strong" aria-hidden="true" />
                  {getText(area.name, locale)}
                </Link>
              </li>
            ))}
          </ul>
        </Reveal>
      </Container>
    </Section>
  );
}

/* ================================================================== *
 * LEVEL 2 — MANAGED JOURNEY
 * Right-heavy wave in, straight edge out. The service-document drawing
 * occupies the negative space under the statement; the rows on the right
 * are structured lines, not cards.
 *
 * This band carries five lines of copy and three rows, so it runs on the
 * `default` rhythm with a tight column gap. The earlier `feature` sizing
 * plus a 20-unit column gap and 44px of reserved document space spent
 * more vertical scroll than the content it was framing.
 * ================================================================== */
export function TrustSection({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const items = [
    { icon: FileCheck2, title: dict.home.trust1, text: dict.home.trust1Text },
    { icon: ReceiptText, title: dict.home.trust2, text: dict.home.trust2Text },
    { icon: Camera, title: dict.home.trust3, text: dict.home.trust3Text }
  ];
  return (
    <Section
      id="managed-trust"
      size="feature"
      tone="dark"
      className="[scroll-margin-top:calc(6rem+var(--demo-bar-h,0px))]"
      waveTop={{ fill: WHITE, shape: 'right', depth: { sm: 22, md: 44, lg: 84 } }}
    >
      <AtmosphericBackground variant="managed" />
      <Container className="relative grid gap-8 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:items-stretch lg:gap-10">
        <Reveal variant="from-start" className="relative lg:pb-20">
          <p className="eyebrow eyebrow-dark">{dict.home.trustEyebrow}</p>
          <h2 className="title-section mt-3 max-w-lg text-white">{dict.home.trustTitle}</h2>
          <p className="mt-3 max-w-lg text-pretty text-sm leading-6 text-slate-300">{dict.home.trustDescription}</p>
          <div className="mt-5 inline-flex items-center gap-2 border-s-2 border-yellow-500 ps-4 text-sm font-semibold text-white">
            <ShieldCheck className={iconTone('text-yellow-500')} aria-hidden="true" />
            {dict.home.trustTwo}
          </div>
          <div className="mt-4">
            <TextLink href={localizedPath(locale, '/how-verification-works')} className="text-yellow-500 hover:text-yellow-400">
              {dict.nav.howWeVerify}
            </TextLink>
          </div>

          {/* the job sheet, drawn into the negative space under the statement */}
          <DrawGraphic duration={1500} threshold={0.15}>
            <ServiceDocument className="pointer-events-none absolute bottom-0 start-0 hidden h-auto w-[104px] text-blue-300/20 lg:block" />
          </DrawGraphic>
        </Reveal>

        <Reveal variant="from-end" delay={60} className="flex">
          {/* the rows share the full column height, so the section breathes
              evenly instead of trailing off under the statement */}
          <ul className="flex flex-1 flex-col justify-between">
            {items.map(({ icon: Icon, title, text }, index) => (
              <li key={title} className={cn('group grid gap-3 py-5 sm:grid-cols-[44px_1fr] sm:gap-5 lg:py-6', index < items.length - 1 && 'border-b border-white/12')}>
                <span className="grid size-11 place-items-center rounded-[10px] bg-white/5 text-yellow-500 ring-1 ring-white/12 transition-colors duration-200 group-hover:bg-yellow-500 group-hover:text-navy-950">
                  <Icon className={iconCard} aria-hidden="true" />
                </span>
                <div>
                  <h3 className="text-[17px] font-semibold leading-7 tracking-[-0.025em] text-white">{title}</h3>
                  <p className="mt-1 max-w-xl text-pretty text-sm leading-6 text-slate-300">{text}</p>
                </div>
              </li>
            ))}
          </ul>
        </Reveal>
      </Container>
    </Section>
  );
}

/* ================================================================== *
 * LEVEL 3 — REVIEWS
 * Straight edge in. Editorial, not a grid: the quotation mark stays in
 * the background and never sits behind the copy.
 * ================================================================== */
export function ReviewsSection({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  return (
    <Section size="default" tone="light">
      <Container className="relative">
        <Reveal variant="from-start">
          <ReviewsEditorial
            locale={locale}
            eyebrow={dict.home.reviewsEyebrow}
            title={dict.home.reviewsTitle}
            description={dict.home.reviewsDescription}
            countLabel={dict.home.reviewCount}
            label={dict.home.reviewsLabel}
            prevLabel={dict.home.reviewsPrev}
            nextLabel={dict.home.reviewsNext}
            verifiedLabel={dict.providers.verified}
            ratingLabel={dict.common.rating}
          />
        </Reveal>
      </Container>
    </Section>
  );
}

/* ================================================================== *
 * LEVEL 3 — FAQ
 * Left-heavy wave in, at a lighter depth than the one above Trust, and no
 * drawing at all: this is the quietest band on the page.
 * ================================================================== */
export function FaqSection({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const items = [
    { question: dict.home.faq1Q, answer: dict.home.faq1A },
    { question: dict.home.faq2Q, answer: dict.home.faq2A },
    { question: dict.home.faq3Q, answer: dict.home.faq3A },
    { question: dict.home.faq4Q, answer: dict.home.faq4A }
  ];
  return (
    <Section id="faq" size="compact" tone="dark" className="[scroll-margin-top:calc(6rem+var(--demo-bar-h,0px))]" waveTop={{ fill: WHITE, shape: 'left', depth: { sm: 16, md: 30, lg: 52 } }}>
      <AtmosphericBackground variant="faq" />
      <Container className="relative grid gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-16">
        <Reveal variant="from-start">
          <div className="header-stack">
            <p className="eyebrow eyebrow-dark">{dict.home.faqEyebrow}</p>
            <h2 className="title-section max-w-md text-white">{dict.home.faqTitle}</h2>
            <div className="mt-3 border-t border-white/12 pt-5">
              <p className="text-sm font-semibold text-white">{dict.home.faqSupportTitle}</p>
              <p className="mt-2 max-w-sm text-pretty text-sm leading-6 text-slate-300">{dict.home.faqSupportText}</p>
              <TextLink href={localizedPath(locale, '/providers')} className="mt-4 text-yellow-500 hover:text-yellow-400">
                {dict.home.browsePros}
              </TextLink>
            </div>
          </div>
        </Reveal>
        <Reveal variant="from-end" delay={60}>
          <FaqAccordion items={items} tone="dark" />
        </Reveal>
      </Container>
    </Section>
  );
}

/* ================================================================== *
 * LEVEL 1 — FINAL CTA
 * The second brand moment. A contained deep-navy conversion panel with no
 * drawing at all: the closing line of the page carries itself on scale,
 * contrast and a single centred lockup. It must never read as an ordinary
 * content section.
 * ================================================================== */
export function ClosingCtaSection({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  return (
    <Section size="feature" tone="light">
      <Container>
        <Reveal variant="section">
          <div className="relative isolate overflow-hidden rounded-[20px] bg-navy-950 px-6 py-14 text-center text-white sm:px-12 sm:py-16 lg:px-16 lg:py-20">
            {/* one soft field for depth, and nothing else */}
            <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(58%_78%_at_50%_0%,rgba(37,99,235,0.32),transparent_68%)]" />

            <div className="relative mx-auto flex max-w-3xl flex-col items-center">
              <p className="eyebrow eyebrow-dark justify-center">{dict.home.ctaEyebrow}</p>
              <h2 className="title-page mt-5 text-white">
                {dict.home.ctaTitleLead} <span className="text-yellow-500">{dict.home.ctaTitleAccent}</span>
              </h2>
              <p className="mt-5 max-w-xl text-pretty text-base leading-7 text-slate-300">{dict.home.ctaDescription}</p>

              <div className="mt-9 flex w-full flex-col items-center gap-3 sm:w-auto sm:flex-row sm:justify-center">
                <Link href={localizedPath(locale, '/services')} className={buttonStyles({ variant: 'accent', size: 'lg', className: 'group lift-sm w-full sm:w-auto' })}>
                  {dict.nav.bookService}
                  <ArrowRight className={arrowClass} aria-hidden="true" />
                </Link>
                <Link href={localizedPath(locale, '/providers')} className={buttonStyles({ variant: 'outline-light', size: 'lg', className: 'w-full sm:w-auto' })}>
                  {dict.home.browsePros}
                </Link>
              </div>
            </div>
          </div>
        </Reveal>
      </Container>
    </Section>
  );
}
