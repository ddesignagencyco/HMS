"use client";

import { ChevronLeft, ChevronRight, Star } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { getService, providers, reviews } from "@/lib/data";
import type { Review } from "@/lib/types";
import { formatDate, formatNumber, getText, localizedPath, type Locale } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { QuotationMark } from "@/components/decorative";
import { VerifiedMark } from "@/components/ui/primitives";

/* Reviews are the one place on this page that should read as editorial rather
   than as a catalogue, and the two columns stay: the claim on the left, the
   evidence on the right.

   The right column is a carousel, so the thing it must get right is counting.
   A reader should never have to guess whether they are looking at one review
   or several, nor how many exist. So:

     - one review is on screen at a time, never a wall of quotes
     - every slide carries its own reviewer name, at the same weight and in
       the same position, so no slide reads as a continuation of the last
     - a numbered position and a dot navigator sit below, and the dots are
       individually labelled, so the total is always countable
     - the left column states the total once

   The quotation mark stays in the background and never sits behind copy. */

const average = (reviews.reduce((sum, review) => sum + review.score, 0) / reviews.length).toFixed(1);

function Attribution({ review, locale }: { review: Review; locale: Locale }) {
  const service = getService(review.serviceSlug);
  const provider = providers.find((item) => item.id === review.providerId);

  return (
    <div>
      {/* dir=auto: a reviewer name is a name, and must keep its own
          direction and punctuation on an RTL page */}
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
        <span dir="auto" className="text-sm font-semibold text-navy">
          {review.name}
        </span>
        <time dateTime={review.createdAt} className="text-xs leading-5 text-muted tabular-nums">
          {formatDate(review.createdAt, locale)}
        </time>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs leading-5">
        {service ? (
          <Link
            href={localizedPath(locale, `/services/${service.slug}`)}
            className="rounded-[4px] font-medium text-secondary transition-colors duration-200 hover:text-navy"
          >
            {getText(service.name, locale)}
          </Link>
        ) : null}
        {provider ? (
          <Link
            dir="auto"
            href={localizedPath(locale, `/providers/${provider.slug}`)}
            className="rounded-[4px] text-muted transition-colors duration-200 hover:text-navy"
          >
            {provider.name}
          </Link>
        ) : null}
      </div>
    </div>
  );
}

export function ReviewsEditorial({
  locale,
  eyebrow,
  title,
  description,
  countLabel,
  label,
  prevLabel,
  nextLabel,
  verifiedLabel,
  ratingLabel,
}: {
  locale: Locale;
  eyebrow: string;
  title: string;
  description: string;
  countLabel: string;
  label: string;
  prevLabel: string;
  nextLabel: string;
  verifiedLabel: string;
  ratingLabel: string;
}) {
  const [index, setIndex] = useState(0);
  const total = reviews.length;
  const review = reviews[index];

  const step = (direction: 1 | -1) => setIndex((current) => (current + direction + total) % total);

  return (
    <div className="grid gap-12 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:items-stretch lg:gap-16">
      {/* LEFT — the claim, and the only place the total is stated */}
      <div className="relative flex flex-col">
        <QuotationMark className="pointer-events-none absolute -top-8 -start-5 hidden h-24 w-24 text-primary/[0.09] lg:block" />
        <p className="eyebrow eyebrow-light">{eyebrow}</p>
        <h2 className="title-section mt-4 max-w-lg text-navy">{title}</h2>
        <p className="mt-4 max-w-sm text-pretty text-base leading-7 text-secondary">{description}</p>

        <div className="mt-8 flex items-end gap-4 border-t border-line pt-6 lg:mt-auto">
          <p className="text-[52px] font-semibold leading-none tracking-[-0.045em] text-navy tabular-nums">{average}</p>
          <div className="pb-1.5">
            <div className="flex items-center gap-0.5" aria-label={`${ratingLabel}: ${average}`}>
              {Array.from({ length: 5 }).map((_, star) => (
                <Star key={star} className="size-3.5 fill-yellow-500 text-yellow-500" aria-hidden="true" />
              ))}
              <span className="sr-only">{ratingLabel}</span>
            </div>
            <p className="mt-2 text-xs text-secondary">{countLabel.replace("{count}", formatNumber(total, locale))}</p>
          </div>
        </div>
      </div>

      {/* RIGHT — one review at a time, with its own controls */}
      <div aria-roledescription="carousel" aria-label={label} className="flex flex-col">
        <div className="flex items-center justify-between gap-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted">{label}</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => step(-1)}
              aria-label={prevLabel}
              className="grid size-10 shrink-0 place-items-center rounded-full border border-line bg-white text-navy transition-colors duration-200 hover:border-navy hover:bg-navy hover:text-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100 motion-reduce:transition-none"
            >
              <ChevronLeft className="size-4 rtl:rotate-180" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => step(1)}
              aria-label={nextLabel}
              className="grid size-10 shrink-0 place-items-center rounded-full border border-line bg-white text-navy transition-colors duration-200 hover:border-navy hover:bg-navy hover:text-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100 motion-reduce:transition-none"
            >
              <ChevronRight className="size-4 rtl:rotate-180" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div aria-live="polite" className="flex flex-1 flex-col">
          <figure key={review.id} className="flex flex-1 flex-col pt-5 animate-[review-in_520ms_cubic-bezier(0.22,1,0.36,1)_both]">
            <blockquote>
              <p dir="auto" className="text-balance text-[26px] font-medium leading-[1.35] tracking-[-0.03em] text-navy sm:text-[30px]">
                &ldquo;{review.body}&rdquo;
              </p>
            </blockquote>
            {review.verified ? (
              <p className="mt-5">
                <VerifiedMark label={verifiedLabel} />
              </p>
            ) : null}
            <div className="mt-auto">
              {/* the rule spans the whole slide, so a short quote never
                  leaves a stub of a divider floating */}
              <div className="flex items-start justify-between gap-4 border-t border-line pt-4">
                <Attribution review={review} locale={locale} />
                <div className="flex shrink-0 items-center gap-1.5" aria-label={`${ratingLabel}: ${review.score}`}>
                  <Star className="size-4 fill-yellow-500 text-yellow-500" aria-hidden="true" />
                  <span className="text-sm font-semibold text-navy tabular-nums">{review.score.toFixed(1)}</span>
                </div>
              </div>
            </div>
          </figure>
        </div>

        {/* position and navigator, so the set is always countable */}
        <div className="mt-7 flex items-center justify-between gap-4 border-t border-line pt-5">
          {/* a position out of a total is always read left to right */}
          <p dir="ltr" className="text-xs font-semibold text-navy tabular-nums">
            {formatNumber(index + 1, locale)} <span className="font-normal text-muted">/ {formatNumber(total, locale)}</span>
          </p>
          <div className="flex items-center gap-2">
            {reviews.map((item, position) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setIndex(position)}
                aria-label={`${position + 1} / ${total}`}
                aria-current={position === index}
                className={cn(
                  "h-1.5 rounded-full transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
                  position === index ? "w-6 bg-navy" : "w-1.5 bg-line hover:bg-slate-300",
                )}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
