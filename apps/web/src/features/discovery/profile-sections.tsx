"use client";

import { MessageSquareQuote, Star } from "lucide-react";
import type { Dictionary } from "@/lib/dictionaries";
import { formatDate, formatNumber, type Locale } from "@/lib/utils";
import type { Reputation, Remark } from "@/features/search/api";
import { useProviderRemarks, useProviderReputation } from "@/features/search/queries";
import { ratingOf } from "@/features/search/location";
import { InlineError, LoadingSkeleton } from "./states";

/* Reputation and remarks are two separate queries with two separate failure
   modes: a remark that fails to load must not take the profile down with it, and
   neither blocks the other.

   The one number that needs care is `score`. The API returns **null** when
   nobody has rated this professional — it deliberately stopped publishing the
   Bayesian prior as if it were a rating — while still ranking on the prior
   internally. A null is a real answer, not a zero, so it is rendered as "no
   ratings yet" rather than 0.0, and the branch is on the score itself rather
   than on `ratingCount`, since a count with a null score is legitimate. */

export function ReputationSection({
  locale,
  dict,
  providerId,
  reputation,
}: {
  locale: Locale;
  dict: Dictionary;
  providerId: string;
  /** From the provider detail payload; used until the dedicated query answers. */
  reputation?: Reputation;
}) {
  const query = useProviderReputation(providerId, locale);
  const value = query.data ?? reputation;
  /* Narrowed by the branch below: the "rated" arm is the only place a score is
     printed, and reading it off the discriminant keeps that true by type rather
     than by hope. */
  const rating = value === undefined ? ratingOf(null) : ratingOf(value.score);
  const score = rating.rated ? rating.score : 0;

  return (
    <section aria-labelledby="reputation-heading" className="rounded-[16px] border border-line bg-white p-5 sm:p-6">
      <h2 id="reputation-heading" className="text-[19px] font-semibold tracking-[-0.03em] text-navy">
        {dict.profile.reputationHeading}
      </h2>

      {value === undefined ? (
        <div className="mt-4 grid gap-3">
          <LoadingSkeleton className="h-6 w-40" />
          <LoadingSkeleton className="h-3 w-full" />
        </div>
      ) : query.isError && !query.isPending ? (
        <InlineError className="mt-4" title={dict.search.loadError} actionLabel={dict.catalogue.retry} onRetry={() => void query.refetch()} />
      ) : ratingOf(value.score).rated === false ? (
        <p className="mt-3 text-sm text-secondary">{dict.profile.noRatingsYet}</p>
      ) : (
        <div className="mt-4 grid gap-4">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1.5">
              <Star className="size-5 fill-yellow-500 text-yellow-500" aria-hidden="true" />
              <span className="text-[28px] font-semibold leading-none tracking-[-0.04em] text-navy tabular-nums">{score.toFixed(2)}</span>
            </span>
            <span className="text-sm text-secondary">
              {dict.profile.ratingOf
                .replace("{score}", score.toFixed(2))
                .replace("{count}", formatNumber(value.ratingCount, locale))}
            </span>
          </div>

          <div className="grid gap-1.5">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">{dict.profile.ratingBreakdown}</p>
            {(["5", "4", "3", "2", "1"] as const).map((star) => {
              const count = value.distribution[star] ?? 0;
              const share = value.ratingCount === 0 ? 0 : (count / value.ratingCount) * 100;
              /* The label names the star level, not how many people gave it:
                 "5 stars" for the top row however many ratings it holds. */
              const label = star === "1" ? dict.profile.starsLabel.replace("{count}", "1") : dict.profile.starsLabelPlural.replace("{count}", star);
              return (
                <div key={star} className="flex items-center gap-2.5 text-xs">
                  <span className="w-16 shrink-0 text-muted">{label}</span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <span className="block h-full rounded-full bg-yellow-500" style={{ width: `${share}%` }} />
                  </span>
                  <span className="w-6 shrink-0 text-end text-muted tabular-nums">{count}</span>
                </div>
              );
            })}
          </div>

          {value.verifiedJobs > 0 ? (
            <p className="text-sm text-secondary">{dict.profile.verifiedJobs.replace("{count}", formatNumber(value.verifiedJobs, locale))}</p>
          ) : null}
        </div>
      )}
    </section>
  );
}

export function RemarksSection({ locale, dict, providerId }: { locale: Locale; dict: Dictionary; providerId: string }) {
  const query = useProviderRemarks(providerId, locale);

  return (
    <section aria-labelledby="remarks-heading" className="rounded-[16px] border border-line bg-white p-5 sm:p-6">
      <h2 id="remarks-heading" className="flex items-center gap-2 text-[19px] font-semibold tracking-[-0.03em] text-navy">
        <MessageSquareQuote className="size-5 text-slate-400" aria-hidden="true" />
        {dict.profile.remarksHeading}
      </h2>

      {query.isPending ? (
        <div className="mt-4 grid gap-3">
          {Array.from({ length: 2 }, (_, index) => (
            <LoadingSkeleton key={index} className="h-24 w-full" />
          ))}
        </div>
      ) : query.isError ? (
        <InlineError className="mt-4" title={dict.search.loadError} actionLabel={dict.catalogue.retry} onRetry={() => void query.refetch()} />
      ) : query.data.items.length === 0 ? (
        <p className="mt-3 text-sm text-secondary">{dict.profile.noRemarks}</p>
      ) : (
        <ul className="mt-4 grid gap-4">
          {query.data.items.map((remark) => (
            <RemarkCard key={remark.id} locale={locale} dict={dict} remark={remark} />
          ))}
        </ul>
      )}
    </section>
  );
}

function RemarkCard({ locale, dict, remark }: { locale: Locale; dict: Dictionary; remark: Remark }) {
  return (
    <li className="rounded-[12px] border border-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold text-navy">{remark.displayName}</span>
        <span className="inline-flex items-center gap-1 text-xs text-muted">
          <Star className="size-3.5 fill-yellow-500 text-yellow-500" aria-hidden="true" />
          <span className="tabular-nums">{remark.score.toFixed(1)}</span>
          <span aria-hidden="true">·</span>
          {formatDate(remark.createdAt, locale)}
        </span>
      </div>
      {/* Customer remarks are free text written by a third party, so the
          direction is resolved from the content rather than the page locale. */}
      <p dir="auto" className="mt-2.5 text-pretty text-sm leading-6 text-secondary">
        {remark.body}
      </p>
      {remark.reply !== null ? (
        <div className="mt-3 border-s-2 border-blue-200 ps-3">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">{dict.profile.remarkReply}</p>
          <p dir="auto" className="mt-1 text-pretty text-sm leading-6 text-secondary">
            {remark.reply.body}
          </p>
          <p className="mt-1 text-xs text-muted">{formatDate(remark.reply.createdAt, locale)}</p>
        </div>
      ) : null}
    </li>
  );
}