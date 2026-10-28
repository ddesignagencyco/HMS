"use client";

/* `/admin/providers/[id]/ratings` — remark moderation.
 *
 * **This is the only place a remark can be taken back from.**
 * `GET /search/providers/:id/remarks` is the public list and it filters
 * `is_published = true`, so an unpublished remark is invisible there by design.
 * `GET /admin/providers/:id/ratings` is the admin's copy: unpublished rows
 * included, each with who removed them and why, and the `remarkId` that
 * `POST /admin/remarks/:id/unpublish` needs. Without this screen the endpoint
 * existed and nothing could call it.
 *
 * The one rule the screen is built around: **unpublishing hides the words, it
 * does not move the number.** The rating stays in the provider's score
 * (`reputation.service.ts:237`). So the action is labelled and described as
 * hiding text, never as removing a rating, and it is not offered on a row that
 * has no remark — there is nothing to moderate on a bare star rating, and
 * `remarkId` is null there.
 *
 * A reason is required (3–500 characters) and is kept and audited, so it is
 * collected in the same dialog that performs the action rather than afterwards.
 */

import { Ban, Loader2, MessageSquareOff, Star } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import toast from "react-hot-toast";
import { Button, Card, PageHeader, Textarea } from "@/components/ui";
import { adminApi, type AdminProviderRating } from "@/features/admin/api";
import { adminKeys, FRESHNESS, publicRetry } from "@/lib/api/keys";
import type { Dictionary } from "@/lib/dictionaries";
import { formatDateTime, formatNumber, type Locale } from "@/lib/utils";

const MIN_REASON = 3;
const MAX_REASON = 500;

export function useProviderRatings(providerId: string, locale: Locale) {
  return useQuery({
    queryKey: adminKeys.providerRatings(providerId),
    queryFn: ({ signal }) => adminApi.providerRatings(providerId, { signal, locale }),
    staleTime: FRESHNESS.ratings.staleTime,
    gcTime: FRESHNESS.ratings.gcTime,
    retry: publicRetry
  });
}

function RemarkRow({
  row,
  dict,
  onHide,
  hiding,
  locale
}: {
  row: AdminProviderRating;
  dict: Dictionary;
  onHide: (row: AdminProviderRating) => void;
  hiding: boolean;
  locale: Locale;
}) {
  /* `remarkId === null` means the rating carried no remark at all - not an
     unpublished one. Unpublished is `published === false` with a remark present. */
  const hasRemark = row.remarkId !== null && typeof row.body === "string" && row.body !== "";
  const published = row.published === true;

  return (
    <li className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 text-sm font-semibold text-navy">
              <Star className="size-3.5 fill-yellow-400 text-yellow-500" aria-hidden="true" />
              {formatNumber(row.score, locale)}
            </span>
            <span className="font-mono text-[11px] text-muted">{row.bookingCode}</span>
            {!published && row.remarkId !== null ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-muted">
                <MessageSquareOff className="size-3" aria-hidden="true" />
                {dict.admin.remarkHidden}
              </span>
            ) : null}
          </p>
          <p className="mt-1 text-xs text-muted">
            {row.displayName ?? dict.admin.remarkAnonymous} · {formatDateTime(row.createdAt, locale)}
          </p>
        </div>

        {hasRemark && published ? (
          <Button type="button" variant="secondary" size="sm" disabled={hiding} onClick={() => onHide(row)}>
            {hiding ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Ban className="size-3.5" aria-hidden="true" />
            )}
            {dict.admin.remarkHide}
          </Button>
        ) : null}
      </div>

      {hasRemark ? (
        <>
          <p className="mt-3 text-sm leading-6 text-secondary">{row.body}</p>
          {row.unpublishedReason !== null ? (
            <p className="mt-2 rounded-[9px] border border-line bg-slate-50 p-3 text-xs leading-5 text-muted">
              <span className="font-semibold text-secondary">{dict.admin.remarkReason}:</span> {row.unpublishedReason}
            </p>
          ) : null}
        </>
      ) : (
        <p className="mt-3 text-sm text-muted">{dict.admin.remarkNone}</p>
      )}
    </li>
  );
}

export function AdminProviderRatings({ providerId, locale, dict }: { providerId: string; locale: Locale; dict: Dictionary }) {
  const queryClient = useQueryClient();
  const ratings = useProviderRatings(providerId, locale);
  const [hiding, setHiding] = useState<AdminProviderRating | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);

  const unpublish = useMutation({
    mutationFn: (input: { remarkId: string; reason: string }) => adminApi.unpublishRemark(input.remarkId, input.reason, { locale }),
    onSuccess: () => {
      /* Two caches, because one write moves both: the admin copy of this
         provider's ratings, and the public profile's reputation and remarks,
         which is what a customer searching for this provider will read. */
      void queryClient.invalidateQueries({ queryKey: adminKeys.providerRatings(providerId) });
      void queryClient.invalidateQueries({ queryKey: ['public', 'providers', providerId] });
      toast.success(dict.admin.remarkHiddenToast);
      setHiding(null);
      setReason("");
      setReasonError(null);
    },
    onError: (cause: Error) => setReasonError(cause.message || dict.admin.remarkHideFailed),
    retry: false
  });

  const items = ratings.data?.items ?? [];
  const reputation = ratings.data?.reputation;
  const trimmed = reason.trim();
  const reasonValid = trimmed.length >= MIN_REASON && trimmed.length <= MAX_REASON;

  const field =
    "mt-1.5 w-full rounded-[9px] border border-line bg-white px-3 py-2.5 text-sm text-navy outline-none focus:border-primary focus:ring-4 focus:ring-blue-100";

  return (
    <div>
      <PageHeader
        eyebrow={dict.portal.admin}
        title={dict.admin.providerRatings}
        description={dict.admin.providerRatingsText}
      />

      {ratings.isLoading ? (
        <Card className="mt-6 p-8 text-center text-sm text-muted" aria-busy="true">
          {dict.portal.financeLoading}
        </Card>
      ) : ratings.isError ? (
        <div role="alert" className="mt-6 rounded-[14px] border border-rose-200 bg-rose-50 p-5">
          <p className="text-sm font-medium leading-6 text-rose-800">
            {ratings.error instanceof Error ? ratings.error.message : dict.finance.loadError}
          </p>
          <Button type="button" variant="secondary" size="sm" className="mt-4" onClick={() => void ratings.refetch()}>
            {dict.catalogue.retry}
          </Button>
        </div>
      ) : (
        <>
          <Card className="mt-6 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">{dict.admin.providerReputation}</p>
            <p className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-navy">
              {reputation?.score === null || reputation === undefined ? dict.admin.reputationUnrated : formatNumber(reputation.score, locale)}
            </p>
            <p className="mt-1 text-xs text-muted">
              {dict.admin.ratingCount.replace(
                "{count}",
                formatNumber(reputation?.ratingCount ?? 0, locale)
              )}
            </p>
            <p className="mt-3 text-xs leading-5 text-muted">{dict.admin.remarkRatingStaysNote}</p>
          </Card>

          <Card className="mt-5 overflow-hidden">
            <div className="border-b border-line p-5">
              <h2 className="font-semibold text-navy">{dict.admin.allRatings}</h2>
              <p className="mt-1 text-sm leading-6 text-secondary">{dict.admin.allRatingsText}</p>
            </div>
            {items.length === 0 ? (
              <p className="p-8 text-center text-sm text-muted">{dict.finance.nothingToShow}</p>
            ) : (
              <ul className="divide-y divide-line">
                {items.map((row) => (
                  <RemarkRow
                    key={row.ratingId}
                    row={row}
                    dict={dict}
                    locale={locale}
                    onHide={(target) => {
                      setHiding(target);
                      setReason("");
                      setReasonError(null);
                    }}
                    hiding={unpublish.isPending && hiding?.remarkId === row.remarkId}
                  />
                ))}
              </ul>
            )}
          </Card>
        </>
      )}

      {hiding !== null ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="hide-remark-heading"
          className="fixed inset-0 z-50 grid place-items-center bg-navy-950/40 p-6"
        >
          <Card className="w-full max-w-lg p-6">
            <h3 id="hide-remark-heading" className="font-semibold text-navy">
              {dict.admin.remarkHideTitle}
            </h3>
            <p className="mt-2 text-sm leading-6 text-secondary">{dict.admin.remarkHideText}</p>
            <p className="mt-3 rounded-[9px] border border-line bg-slate-50 p-3 text-sm leading-6 text-secondary">
              {hiding.body}
            </p>

            <label className="mt-4 block text-sm font-medium leading-none text-navy" htmlFor="unpublish-reason">
              {dict.admin.remarkReason}
            </label>
            <Textarea
              id="unpublish-reason"
              rows={3}
              className={field}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              aria-describedby="unpublish-reason-count"
            />
            <p id="unpublish-reason-count" className="mt-1.5 text-xs text-muted tabular-nums">
              {formatNumber(trimmed.length, locale)} / {formatNumber(MAX_REASON, locale)}
            </p>

            {reasonError !== null ? (
              <p role="alert" className="mt-3 text-sm leading-6 text-rose-700">
                {reasonError}
              </p>
            ) : null}

            <div className="mt-5 flex gap-2">
              <Button
                type="button"
                disabled={!reasonValid || unpublish.isPending}
                onClick={() => {
                  if (hiding.remarkId !== null && reasonValid) unpublish.mutate({ remarkId: hiding.remarkId, reason: trimmed });
                }}
              >
                {unpublish.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                {dict.admin.remarkHideConfirm}
              </Button>
              <Button type="button" variant="secondary" disabled={unpublish.isPending} onClick={() => setHiding(null)}>
                {dict.common.cancel}
              </Button>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}