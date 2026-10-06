import { ArrowRight, ArrowUpRight, Clock3, ShieldCheck, Star } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { TiltCard } from '@/components/motion/tilt-card';
import { CategoryIcon, IconMedia, VerifiedMark } from '@/components/ui/primitives';
import { formatNumber, type Locale } from '@/lib/utils';
import { cn } from '@/lib/utils';

const focusRing = 'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100';
const iconSm = 'size-4 shrink-0';

/* Every card family carries the same resting outline and the same hover
   lift, so a grid never mixes "flat until you touch it" cards with
   "already an object" cards. The ring is a hairline in navy, not a border:
   a border would eat 2px of the media box on every side and the three
   families would no longer line up. */
const cardSurface = 'rounded-[14px] bg-white ring-1 ring-navy/[0.08] transition-shadow duration-200 hover:shadow-soft';

/* Two-line clamps on Latin are tuned to the em box; Nastaliq draws outside
   it, so the clamped rows carry a hook the Urdu locale can open up. */
const clampTwo = 'clamp-lines-2 line-clamp-2';
const clampOne = 'clamp-lines-1 line-clamp-1';
const eyebrowRow = 'eyebrow-row flex min-h-4 items-center gap-2 font-bold uppercase tracking-[0.12em] text-muted';

/* Three card families, each normalised on its own terms. They deliberately
   do not share dimensions: a discovery card, a bookable job and a person are
   different objects and should not pretend to be the same shape.

     CategoryCard ......... equal height · 16/10 media · CTA on the baseline
     PopularServiceCard ... equal height · 128/96 media · price on the baseline
     ProfessionalCard ..... equal height · 4/5 portrait · metadata on the baseline
*/

/* ------------------------------------------------------------------ *
 * Family A — CategoryCard (discovery)
 * ------------------------------------------------------------------ */
export function CategoryCard({ href, meta, categoryIcon, title, description, cta }: { href: string; meta: string; categoryIcon: string; title: string; description: string; cta: string }) {
  return (
    <TiltCard className="h-full">
      <Link href={href} className={cn(focusRing, cardSurface, 'group relative flex h-full flex-col overflow-hidden')}>
        <span className="card-mark" aria-hidden="true" />
        {/* No photograph: the catalogue publishes no image, and inventing one put
            stock art of the wrong trade beside a real service name. */}
        <IconMedia category={categoryIcon} className="relative aspect-[16/10] w-full overflow-hidden" />
        <div data-tilt-depth="body" className="flex flex-1 flex-col p-5">
          <p className={cn(eyebrowRow, 'text-xs')}>
            <CategoryIcon category={categoryIcon} className={cn(iconSm, 'text-primary')} />
            <span className="truncate">{meta}</span>
          </p>
          {/* The rows below are clamped, not height-locked. A min-height
              would leave a hole under a one-line title and would crop the
              marks off a two-line Nastaliq one; the price line is held on
              the card's own bottom edge by `mt-auto` either way. */}
          <h3 className={cn(clampTwo, 'mt-3 text-[19px] font-semibold leading-6 tracking-[-0.03em] text-navy transition-colors duration-200 group-hover:text-primary-strong')}>{title}</h3>
          <p className={cn(clampTwo, 'mt-2 text-sm leading-6 text-secondary')}>{description}</p>
          <p className="mt-auto flex items-center gap-1.5 pt-5 text-sm font-semibold text-primary-strong">
            {cta}
            <ArrowUpRight className={cn(iconSm, 'arrow-slide-diag rtl:rotate-180')} aria-hidden="true" />
          </p>
        </div>
      </Link>
    </TiltCard>
  );
}

/* ------------------------------------------------------------------ *
 * Family B — PopularServiceCard (a bookable job, not a category)
 * A horizontal job row: small media, the job, and the price you can book at.
 * ------------------------------------------------------------------ */
export function PopularServiceCard({
  href,
  category,
  categoryIcon,
  title,
  duration,
  warranty,
  priceFrom,
  price,
  emergency,
  emergencyLabel,
  actionLabel
}: {
  href: string;
  category: string;
  categoryIcon: string;
  title: string;
  duration: string;
  warranty: string;
  priceFrom: string;
  price: string;
  emergency?: boolean;
  emergencyLabel: string;
  actionLabel: string;
}) {
  return (
    <TiltCard className="h-full" intensity={4}>
      <Link href={href} className={cn(focusRing, cardSurface, 'group relative flex h-full flex-col gap-3 p-3 sm:flex-row sm:items-stretch sm:gap-6 sm:p-4')}>
        <div className="flex min-w-0 flex-1 items-stretch gap-3 sm:gap-5">
          <IconMedia category={categoryIcon} className="aspect-[4/3] w-[96px] shrink-0 rounded-[10px] sm:w-[136px]" />

          <div data-tilt-depth="body" className="flex min-w-0 flex-1 flex-col justify-center py-0.5">
            <p className={cn(eyebrowRow, 'gap-1.5 text-[11px]')}>
              <CategoryIcon category={categoryIcon} className="size-3.5 shrink-0 text-primary" />
              <span className="truncate">{category}</span>
            </p>
            <h3 className={cn(clampTwo, 'mt-1.5 text-[17px] font-semibold leading-6 tracking-[-0.025em] text-navy transition-colors duration-200 group-hover:text-primary-strong')}>{title}</h3>
            <p className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] leading-5 text-muted sm:gap-x-3 sm:text-xs">
              <span className="inline-flex items-center gap-1.5">
                <Clock3 className={iconSm} aria-hidden="true" />
                {duration}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck className={iconSm} aria-hidden="true" />
                {warranty}
              </span>
              {emergency ? (
                <span className="inline-flex items-center gap-1.5 font-semibold text-primary-strong">
                  <span className="size-1.5 rounded-full bg-yellow-500" aria-hidden="true" />
                  {emergencyLabel}
                </span>
              ) : null}
            </p>
          </div>
        </div>

        {/* the price is the point of this card, so it gets the strongest type
            in the row and a single compact action beside it */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-line pt-3 text-end sm:w-[104px] sm:flex-col sm:items-end sm:justify-center sm:border-t-0 sm:pt-0">
          <div className="sm:text-end">
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted sm:text-[11px]">{priceFrom}</p>
            <p className="-mt-0.5 text-lg font-semibold leading-7 tracking-[-0.03em] text-navy tabular-nums sm:text-xl">{price}</p>
          </div>
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-navy text-white transition-colors duration-200 group-hover:bg-primary-strong">
            <ArrowRight className="size-4 arrow-slide rtl:rotate-180" aria-hidden="true" />
          </span>
          <span className="sr-only">{actionLabel}</span>
        </div>
      </Link>
    </TiltCard>
  );
}

/* ------------------------------------------------------------------ *
 * Family C — ProfessionalCard (a person, not a listing)
 * ------------------------------------------------------------------ */
export function ProfessionalCard({
  locale,
  href,
  image,
  focus,
  name,
  specialisation,
  bio,
  verifiedLabel,
  rating,
  ratingCount,
  ratingAriaLabel,
  jobs,
  availability
}: {
  locale: Locale;
  href: string;
  image: { url: string; alt: string };
  focus?: string;
  name: string;
  specialisation: string;
  bio: string;
  verifiedLabel: string;
  rating: number;
  ratingCount: number;
  ratingAriaLabel: string;
  jobs: string;
  availability: string;
}) {
  return (
    <TiltCard className="h-full" intensity={6}>
      <Link href={href} className={cn(focusRing, cardSurface, 'group relative flex h-full flex-col overflow-hidden')}>
        <div data-tilt-depth="media" className="relative aspect-[4/5] w-full overflow-hidden bg-slate-100">
          <Image
            src={image.url}
            alt={image.alt}
            fill
            sizes="(max-width: 639px) calc(100vw - 2.25rem), (max-width: 1279px) calc(50vw - 3rem), calc(33.333vw - 4.33rem)"
            style={{ objectPosition: focus ?? '50% 26%' }}
            className="media-hover-soft object-cover"
          />
          <span data-tilt-depth="chip" className="badge-hover absolute bottom-3 start-3 rounded-full bg-white/95 px-2.5 py-1 shadow-[0_8px_20px_-10px_rgba(11,27,63,0.6)]">
            <VerifiedMark label={verifiedLabel} />
          </span>
          <span
            data-tilt-depth="chip"
            className="absolute end-3 top-3 grid size-8 place-items-center rounded-full bg-white/95 text-navy shadow-[0_8px_20px_-10px_rgba(11,27,63,0.6)] transition-colors duration-200 group-hover:bg-navy group-hover:text-white"
          >
            <ArrowUpRight className="size-4 arrow-slide-diag rtl:rotate-180" aria-hidden="true" />
          </span>
        </div>

        <div data-tilt-depth="body" className="flex flex-1 flex-col p-4 sm:p-5">
          {/* name and rating share one baseline in every card */}
          <div className="flex items-baseline justify-between gap-3">
            <h3 className={cn(clampOne, 'text-[19px] font-semibold leading-6 tracking-[-0.03em] text-navy transition-colors duration-200 group-hover:text-primary-strong')}>{name}</h3>
            <p className="flex shrink-0 items-center gap-1 text-sm" aria-label={`${ratingAriaLabel}: ${rating}`}>
              <Star className="size-3.5 shrink-0 fill-yellow-500 text-yellow-500" aria-hidden="true" />
              <span className="font-semibold text-navy tabular-nums">{rating.toFixed(1)}</span>
              <span className="text-xs text-muted tabular-nums">({formatNumber(ratingCount, locale)})</span>
            </p>
          </div>
          <p className={cn(eyebrowRow, 'mt-1.5 gap-0 text-[10px] tracking-[0.1em]')}>{specialisation}</p>
          <p className={cn(clampTwo, 'mt-3 text-sm leading-6 text-secondary')}>{bio}</p>

          <div className="mt-auto border-t border-line pt-4">
            <p className="text-sm leading-5 text-secondary">{jobs}</p>
            <p className="mt-1.5 flex items-center gap-1.5 text-xs font-medium leading-5 text-emerald-700">
              <span className="size-1.5 rounded-full bg-emerald-600" aria-hidden="true" />
              {availability}
            </p>
          </div>
        </div>
      </Link>
    </TiltCard>
  );
}
