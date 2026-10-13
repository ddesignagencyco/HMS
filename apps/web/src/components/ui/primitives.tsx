import { BadgeCheck, Brush, Bug, CookingPot, Droplets, Hammer, Paintbrush, Snowflake, SprayCan, Star, Wrench, Zap, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Container({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('container-shell', className)}>{children}</div>;
}

export function Rating({ value, count, label, tone = 'amber' }: { value: number; count?: number; label: string; tone?: 'amber' | 'yellow' }) {
  const starClass = tone === 'yellow' ? 'fill-yellow-500 text-yellow-500' : 'fill-amber-400 text-amber-400';
  return (
    <span className="inline-flex items-center gap-1.5 text-sm" aria-label={`${label}: ${value}`}>
      <Star className={cn('size-4', starClass)} aria-hidden="true" />
      <span className="font-semibold text-navy">{value.toFixed(1)}</span>
      {count !== undefined ? <span className="text-muted">({count})</span> : null}
    </span>
  );
}

export function VerifiedMark({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700">
      <BadgeCheck className="size-4" aria-hidden="true" />
      {label}
    </span>
  );
}

/**
 * Category glyphs, keyed by the **slug the API publishes** — `/catalogue/categories`
 * returns `slug`, and that slug is what every screen has to key on.
 *
 * These used to be keyed on slugs the catalogue never published
 * (`sanitary-bathroom`, `carpentry-furniture`, `paint-masonry-waterproofing`),
 * so every real category fell through to the `Wrench` default and six different
 * trades all drew the same spanner. Any slug the API adds later falls back to
 * `Wrench` rather than breaking — add it here when it appears.
 */
const categoryIcons: Record<string, LucideIcon> = {
  plumbing: Droplets,
  'leak-repair': Droplets,
  'blocked-drain': Droplets,
  'new-fixture-install': Droplets,
  'bathroom-and-water-heating': Droplets,
  electrical: Zap,
  'fault-finding': Zap,
  'switch-socket-repair': Zap,
  'switch-repair': Zap,
  'appliance-repair': CookingPot,
  'washing-machine-repair': CookingPot,
  'ac-service': Snowflake,
  'refrigerator-repair': Snowflake,
  'ac-and-refrigeration': Snowflake,
  carpentry: Hammer,
  'furniture-repair': Hammer,
  'door-window-repair': Hammer,
  'door-repair': Hammer,
  'carpentry-furniture': Hammer,
  painting: Paintbrush,
  'interior-painting': Paintbrush,
  waterproofing: Paintbrush,
  'waterproofing-treatment': Paintbrush,
  'painting-waterproofing': Paintbrush,
  'paint-masonry-waterproofing': Paintbrush,
  cleaning: SprayCan,
  'deep-cleaning': SprayCan,
  'cleaning-pest': Bug,
  pest: Bug,
  'pest-control': Bug,
  /* Slugs that only ever existed in `src/lib/data.ts`, kept so a stale link
     still draws something sensible while it is being corrected. */
  'sanitary-bathroom': Wrench,
  '': Brush
};

export function CategoryIcon({ category, className }: { category: string; className?: string }) {
  const Icon = categoryIcons[category] ?? Wrench;
  return <Icon className={className} aria-hidden="true" />;
}

import Image from 'next/image';
import { getServicePhoto } from '@/lib/service-images';

export function getCategoryPhoto(category: string): string {
  return getServicePhoto(category);
}

/**
 * The media area of a card, styled with authentic brand photography matching
 * the hero and auth panels, with a subtle dark gradient and trade badge.
 */
export function IconMedia({ category, className }: { category: string; className?: string }) {
  const photo = getCategoryPhoto(category);
  return (
    <span aria-hidden="true" className={cn('relative block overflow-hidden bg-slate-900 group', className)}>
      <Image
        src={photo}
        alt=""
        fill
        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
        className="object-cover transition-transform duration-300 group-hover:scale-105"
      />
      <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-navy-950/85 via-navy-950/35 to-navy-950/10" />
      <span className="absolute bottom-2.5 start-2.5 inline-flex items-center gap-1.5 rounded-md bg-white/95 px-2 py-1 text-xs font-semibold text-navy shadow-xs backdrop-blur-xs">
        <CategoryIcon category={category} className="size-3.5 text-primary" />
      </span>
    </span>
  );
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-[14px] border border-dashed border-line bg-white px-6 py-12 text-center">
      <h2 className="text-lg font-semibold text-navy">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-secondary">{description}</p>
    </div>
  );
}

export function StatCard({ label, value, icon: Icon }: { label: string; value: string; icon?: LucideIcon }) {
  return (
    <div className="rounded-[14px] border border-line bg-white p-5 shadow-[0_4px_18px_rgba(15,23,42,0.04)]">
      <div className="flex items-center gap-3">
        {Icon ? (
          <span className="grid size-10 place-items-center rounded-[9px] bg-yellow-50 text-navy ring-1 ring-inset ring-yellow-500/25">
            <Icon className="size-5" />
          </span>
        ) : null}
        <div>
          <p className="text-2xl font-semibold tracking-[-0.04em] text-navy">{value}</p>
          <p className="mt-1 text-xs text-secondary">{label}</p>
        </div>
      </div>
    </div>
  );
}
