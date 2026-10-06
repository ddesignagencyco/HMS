'use client';

import { CheckCircle2, MessageSquare, Star, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Button, Card, Label, PageHeader, Textarea } from '@/components/ui';
import { useProviderRatings, useReplyToRemark, type ProviderRating } from '@/features/provider/queries';
import type { Dictionary } from '@/lib/dictionaries';
import { cn, formatDate, formatNumber, type Locale } from '@/lib/utils';

/* Ratings and remarks the provider has received.

   Three things this screen must get right, all of them contract facts:

   · **`reply` is a string here**, not the `{ body, createdAt }` the *public*
     remarks endpoint returns. Rendering the object form throws in React. The type
     in `features/provider/api.ts` says so at the definition.

   · **A remark with no ratings still shows.** `remark` is nullable; the rating row
     and the remark are separate things the API left-joins.

   · **An unpublished remark is still listed**, because FR-SP-05 says the provider
     keeps seeing it. It is labelled as withdrawn rather than hidden — hiding it
     would look like the customer never wrote it.

   A reply is **once**: `POST /provider/remarks/:id/reply` is a 409 on the second
   attempt and cannot be edited. So the control disappears after a successful
   reply rather than offering an edit that the API refuses. */

const CRITERIA = ['quality', 'punctuality', 'conduct', 'cleanliness'] as const;

export function ProviderRatingsScreen({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const ratings = useProviderRatings(locale);
  const reply = useReplyToRemark(locale);

  const [draft, setDraft] = useState<Record<string, string>>({});
  const [replied, setReplied] = useState<Record<string, boolean>>({});
  const [localError, setLocalError] = useState('');

  const sendReply = async (remarkId: string): Promise<void> => {
    setLocalError('');
    const body = (draft[remarkId] ?? '').trim();
    if (body === '') {
      setLocalError(dict.portal.replyRequired);
      return;
    }
    try {
      await reply.mutateAsync({ remarkId, body });
      setReplied((previous) => ({ ...previous, [remarkId]: true }));
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : dict.portal.replyFailed);
    }
  };

  if (ratings.isPending) {
    return (
      <div aria-busy="true" aria-live="polite" className="grid gap-3">
        <span className="skeleton h-8 w-56 rounded-[9px]" />
        <span className="skeleton h-56 w-full rounded-[12px]" />
      </div>
    );
  }

  if (ratings.isError) {
    return (
      <div>
        <PageHeader eyebrow={dict.portal.provider} title={dict.portal.ratings} />
        <div role="alert" className="mt-6 rounded-[14px] border border-rose-200 bg-rose-50 p-5">
          <p className="text-sm font-medium leading-6 text-rose-800">{dict.portal.ratingsLoadError}</p>
          <Button type="button" variant="secondary" size="sm" className="mt-4" onClick={() => void ratings.refetch()}>
            {dict.catalogue.retry}
          </Button>
        </div>
      </div>
    );
  }

  const { reputation, items } = ratings.data;
  const hasRatings = reputation.ratingCount > 0;

  return (
    <div>
      <PageHeader eyebrow={dict.portal.provider} title={dict.portal.ratings} description={dict.portal.ratingsText} />

      <div className="mt-6 grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        <Card className="p-6">
          {/* The score is a Bayesian mean pulled toward the prior, so it is only
              shown once there is at least one rating. Below that, 3.5 is an
              artefact of the prior rather than anything a customer said. */}
          <p className="text-sm text-muted">{dict.portal.overallRating}</p>
          <p className="mt-2 flex items-center gap-2">
            {hasRatings ? (
              <>
                <span className="flex" aria-hidden="true">
                  {Array.from({ length: 5 }, (_unused, index) => (
                    <Star key={index} className={cn('size-5', index < Math.round(reputation.score) ? 'fill-amber-400 text-amber-400' : 'text-slate-300')} />
                  ))}
                </span>
                <span className="text-2xl font-semibold text-navy">{reputation.score.toFixed(1)}</span>
              </>
            ) : (
              <span className="text-lg font-semibold text-muted">{dict.portal.noRatingsYet}</span>
            )}
          </p>
          {hasRatings ? <p className="mt-1 text-sm text-muted">{dict.portal.fromRatings.replace('{count}', formatNumber(reputation.ratingCount, locale))}</p> : null}
          <p className="mt-4 text-xs leading-5 text-muted">{dict.portal.scoreIsPriorNote}</p>

          <dl className="mt-5 grid gap-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted">{dict.portal.verifiedJobsLabel}</dt>
              <dd className="font-medium text-navy">{formatNumber(reputation.verifiedJobs, locale)}</dd>
            </div>
          </dl>
        </Card>

        <div className="grid gap-4">
          {items.length === 0 ? (
            /* Not `noRatingsYet` again — the summary card already says that. What
               is useful here is *when* one will appear. */
            <Card className="p-8 text-center text-sm leading-6 text-secondary">{dict.portal.noRatingsListHint}</Card>
          ) : (
            items.map((rating) => (
              <RatingCard
                key={rating.ratingId}
                rating={rating}
                locale={locale}
                dict={dict}
                draft={draft}
                setDraft={setDraft}
                replied={replied[rating.remark?.id ?? ''] ?? false}
                onSend={sendReply}
                busy={reply.isPending}
                localError={localError}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function RatingCard({
  rating,
  locale,
  dict,
  draft,
  setDraft,
  replied,
  onSend,
  busy,
  localError
}: {
  rating: ProviderRating;
  locale: Locale;
  dict: Dictionary;
  draft: Record<string, string>;
  setDraft: (next: Record<string, string>) => void;
  replied: boolean;
  onSend: (remarkId: string) => Promise<void>;
  busy: boolean;
  localError: string;
}) {
  const remark = rating.remark;
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-lg font-semibold text-navy tabular-nums">{rating.score.toFixed(1)}</span>
          <span className="flex" aria-hidden="true">
            {Array.from({ length: 5 }, (_unused, index) => (
              <Star key={index} className={cn('size-4', index < Math.round(rating.score) ? 'fill-amber-400 text-amber-400' : 'text-slate-300')} />
            ))}
          </span>
        </div>
        <span className="text-xs text-muted">{formatDate(rating.createdAt, locale)}</span>
      </div>

      <dl className="mt-3 grid gap-1.5 text-xs sm:grid-cols-2">
        {CRITERIA.map((criterion) => (
          <div key={criterion} className="flex justify-between gap-3">
            <dt className="text-muted">{dict.portal.criteria[criterion]}</dt>
            <dd className="font-medium text-navy tabular-nums">{rating[criterion]}</dd>
          </div>
        ))}
      </dl>

      {remark === null ? null : (
        <div className="mt-4 border-t border-line pt-4">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-navy">
            <MessageSquare className="size-3.5 text-muted" aria-hidden="true" />
            {remark.displayName ?? dict.portal.anonymousCustomer}
            {!remark.published ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
                <XCircle className="size-3" aria-hidden="true" />
                {dict.portal.remarkWithdrawn}
              </span>
            ) : null}
          </p>
          {remark.body !== null && remark.body !== '' ? <p className="mt-2 text-sm leading-6 text-secondary">{remark.body}</p> : <p className="mt-2 text-sm text-muted">{dict.portal.noRemarkText}</p>}

          {remark.reply !== null && remark.reply !== '' ? (
            <p className="mt-3 flex items-start gap-2 rounded-[9px] bg-blue-50 p-3 text-sm leading-6 text-navy">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
              {/* A string, not `{ body, createdAt }` — see the note in api.ts. */}
              <span>{remark.reply}</span>
            </p>
          ) : null}

          {/* One reply per remark, never editable. After a successful reply the
              control is gone rather than turned into an edit. */}
          {remark.reply === null && replied ? (
            <p role="status" className="mt-3 flex items-center gap-2 text-sm font-medium text-emerald-700">
              <CheckCircle2 className="size-4" aria-hidden="true" />
              {dict.portal.replySent}
            </p>
          ) : remark.reply === null && remark.published ? (
            <div className="mt-3 grid gap-2">
              <Label htmlFor={`reply-${remark.id}`}>{dict.portal.replyToRemark}</Label>
              <Textarea
                id={`reply-${remark.id}`}
                value={draft[remark.id] ?? ''}
                onChange={(event) => setDraft({ ...draft, [remark.id]: event.target.value })}
                placeholder={dict.portal.replyPlaceholder}
              />
              <div>
                <Button type="button" size="sm" onClick={() => void onSend(remark.id)} disabled={busy}>
                  {dict.portal.sendReply}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {localError !== '' && remark !== null && remark.reply === null && !replied ? (
        <p role="alert" className="mt-3 rounded-[9px] bg-rose-50 p-3 text-sm text-rose-700">
          {localError}
        </p>
      ) : null}
    </Card>
  );
}
