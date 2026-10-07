'use client';

import { useState } from 'react';
import { Gavel, Loader2, Scale } from 'lucide-react';
import { Button, Card, PageHeader } from '@/components/ui';
import type { DisputeRuling, DisputeStatus } from '@/features/admin/cases-api';
import { useDisputes, useResolveDispute } from '@/features/admin/cases-queries';
import { detailOf, toastSuccess } from '@/features/auth/auth-feedback';
import { ApiError } from '@/lib/api/problem';
import type { Dictionary } from '@/lib/dictionaries';
import { cn, formatDateTime, type Locale } from '@/lib/utils';

/* The dispute queue — `GET /admin/disputes` and `POST /admin/disputes/:id/resolve`.
 *
 * **The order is the server's**: open first, then oldest, because the queue is
 * about how long money has been held. Not re-sorted here.
 *
 * **`replyDueAt` and `providerReplied` are the right of reply, and the ruling form
 * is built around them.** The API refuses a ruling made before the reply window
 * closes without a reply unless `overrideReason` is given (409). So the override
 * box appears only in exactly that state — a free-text override sitting on every
 * ruling would invite an admin to type a reason for a decision that does not need
 * one, and to think the override is the normal path.
 *
 * **`PARTIAL_RELEASE` is the only ruling with an amount, and the split has to add up
 * to exactly what was held.** The amount input is therefore bounded by nothing this
 * screen can know — the held figure lives on the evidence-floor route, not the list
 * — so the screen says so and lets the server be the judge. Guessing a ceiling from
 * a row that does not carry the money would be inventing a constraint. */

const STATUSES: DisputeStatus[] = ['OPEN', 'AWAITING_PROVIDER_REPLY', 'READY', 'RESOLVED'];
const RULINGS: DisputeRuling[] = ['FULL_RELEASE', 'PARTIAL_RELEASE', 'FULL_REFUND', 'REFUND_WITH_PENALTY'];

export function AdminDisputes({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const [status, setStatus] = useState<DisputeStatus | undefined>(undefined);
  const disputes = useDisputes(status, locale);

  const rows = disputes.data?.items ?? [];
  const forbidden = disputes.error instanceof ApiError && disputes.error.status === 403;
  const open = rows.filter((row) => row.status !== 'RESOLVED').length;

  return (
    <div>
      <PageHeader eyebrow={dict.portal.admin} title={dict.admin.disputes} description={dict.admin.disputesText} />

      <div className="mt-6 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="dispute-status" className="text-[11.5px] font-semibold text-slate-800">
            {dict.common.status}
          </label>
          <select
            id="dispute-status"
            value={status ?? ''}
            onChange={(event) => setStatus(event.target.value === '' ? undefined : (event.target.value as DisputeStatus))}
            className="mt-1 min-h-11 rounded-[9px] border border-line bg-white px-3 text-sm text-navy outline-none focus:border-primary"
          >
            <option value="">{dict.admin.anyStatus}</option>
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {dict.admin.disputeStates[value]}
              </option>
            ))}
          </select>
        </div>
        <p className="text-sm text-secondary">{dict.admin.openDisputes.replace('{count}', String(open))}</p>
      </div>

      {disputes.isPending ? (
        <Card className="mt-6 p-8 text-center text-sm text-muted" aria-busy="true">
          {dict.admin.loadingDisputes}
        </Card>
      ) : disputes.isError ? (
        <div role="alert" className="mt-6 rounded-[14px] border border-rose-200 bg-rose-50 p-5">
          <p className="text-sm font-medium leading-6 text-rose-800">{dict.admin.disputesLoadError}</p>
          {forbidden ? <p className="mt-2 text-sm leading-6 text-rose-800">{dict.admin.adminTotpRequired}</p> : null}
          <Button type="button" variant="secondary" size="sm" className="mt-4" onClick={() => void disputes.refetch()}>
            {dict.catalogue.retry}
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <Card className="mt-6 border-dashed px-6 py-14 text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-full bg-surface-2 text-muted" aria-hidden="true">
            <Scale className="size-6" />
          </span>
          <h2 className="mt-4 font-semibold text-navy">{dict.admin.noDisputes}</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-secondary">{dict.admin.noDisputesText}</p>
        </Card>
      ) : (
        <ul className="mt-6 grid gap-4">
          {rows.map((row) => (
            <li key={row.id}>
              <DisputeCard locale={locale} dict={dict} row={row} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DisputeCard({
  locale,
  dict,
  row
}: {
  locale: Locale;
  dict: Dictionary;
  row: { id: string; bookingCode: string; origin: string; status: string; replyDueAt: string | null; providerReplied: boolean; createdAt: string; resolution: string | null; provider: string | null };
}) {
  const resolve = useResolveDispute(locale);
  const [open, setOpen] = useState(false);
  const [ruling, setRuling] = useState<DisputeRuling>('FULL_RELEASE');
  const [note, setNote] = useState('');
  const [releasePaisa, setReleasePaisa] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [breachCode, setBreachCode] = useState('');
  const [error, setError] = useState('');

  const resolved = row.status === 'RESOLVED';
  /* Captured once per mount rather than read during render. `Date.now()` in a render
     body is an impure read: two renders of the same row could disagree, and the
     row would appear to flip between "reply window open" and "closed" with nothing
     having changed. */
  const [now] = useState(() => Date.now());
  /* The API's 409 condition, stated rather than discovered: the window has closed
     and the professional has not replied. */
  const replyWindowOpen = row.replyDueAt !== null && new Date(row.replyDueAt).getTime() > now;
  const needsOverride = replyWindowOpen && !row.providerReplied;

  const submit = async (): Promise<void> => {
    setError('');
    if (note.trim().length < 3) {
      setError(dict.admin.noteRequired);
      return;
    }
    if (needsOverride && overrideReason.trim().length < 5) {
      setError(dict.admin.overrideRequired);
      return;
    }
    try {
      await resolve.mutateAsync({
        id: row.id,
        resolution: {
          resolution: ruling,
          note: note.trim(),
          ...(ruling === 'PARTIAL_RELEASE' ? { releasePaisa: paisa(releasePaisa) } : {}),
          ...(ruling === 'REFUND_WITH_PENALTY' ? { breachCode: breachCode.trim() } : {}),
          ...(needsOverride ? { overrideReason: overrideReason.trim() } : {})
        }
      });
      toastSuccess(dict.admin.rulingRecorded);
      setOpen(false);
      setNote('');
    } catch (caught) {
      setError(detailOf(caught, dict));
    }
  };

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 font-semibold text-navy">
            <Gavel className="size-4 shrink-0 text-muted" aria-hidden="true" />
            {row.bookingCode}
          </h2>
          <p className="mt-1 text-xs text-muted">
            {dict.admin.origin}: {dict.admin.disputeOrigins[row.origin as keyof typeof dict.admin.disputeOrigins] ?? row.origin} · {formatDateTime(row.createdAt, locale)}
          </p>
          {row.provider === null ? null : (
            <p className="mt-1 text-xs text-muted">
              {dict.admin.professional}: {row.provider}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700">{dict.admin.disputeStates[row.status as DisputeStatus] ?? row.status}</span>
          {/* The right of reply, stated in both directions. `replyDueAt: null`
              means the professional was never asked, which is not the same as
              "not yet due". */}
          {row.providerReplied ? (
            <span className="text-[11px] font-semibold text-emerald-700">{dict.admin.providerReplied}</span>
          ) : row.replyDueAt === null ? (
            <span className="text-[11px] text-muted">{dict.admin.noReplyRequested}</span>
          ) : (
            <span className={cn('text-[11px]', replyWindowOpen ? 'text-amber-700' : 'text-muted')}>{dict.admin.replyDue.replace('{date}', formatDateTime(row.replyDueAt, locale))}</span>
          )}
        </div>
      </div>

      {resolved ? (
        <p className="mt-4 rounded-[9px] border border-line bg-surface-2 p-3 text-sm leading-6 text-secondary">
          {dict.admin.disputeResolvedWith.replace('{resolution}', dict.admin.rulings[row.resolution as DisputeRuling] ?? String(row.resolution))}
        </p>
      ) : open ? (
        <div className="mt-4 grid gap-3 border-t border-line pt-4">
          <div>
            <label htmlFor={`ruling-${row.id}`} className="text-[11.5px] font-semibold text-slate-800">
              {dict.admin.ruling}
            </label>
            <select
              id={`ruling-${row.id}`}
              value={ruling}
              onChange={(event) => setRuling(event.target.value as DisputeRuling)}
              className="mt-1 min-h-11 w-full rounded-[9px] border border-line bg-white px-3 text-sm text-navy outline-none focus:border-primary"
            >
              {RULINGS.map((value) => (
                <option key={value} value={value}>
                  {dict.admin.rulings[value]}
                </option>
              ))}
            </select>
          </div>

          {ruling === 'PARTIAL_RELEASE' ? (
            <div>
              <label htmlFor={`release-${row.id}`} className="text-[11.5px] font-semibold text-slate-800">
                {dict.admin.releaseAmount}
              </label>
              <input
                id={`release-${row.id}`}
                type="number"
                min={1}
                step={100}
                value={releasePaisa}
                onChange={(event) => setReleasePaisa(event.target.value)}
                className="mt-1 min-h-11 w-full rounded-[9px] border border-line bg-white px-3 text-sm text-navy outline-none focus:border-primary"
              />
              {/* The honest caveat rather than a invented ceiling: this list does not
                  carry the held amount. It is on the evidence-floor route. */}
              <p className="mt-1 text-[11px] leading-5 text-muted">{dict.admin.releaseAmountNote}</p>
            </div>
          ) : null}

          {ruling === 'REFUND_WITH_PENALTY' ? (
            <div>
              <label htmlFor={`breach-${row.id}`} className="text-[11.5px] font-semibold text-slate-800">
                {dict.admin.breachCode}
              </label>
              <input
                id={`breach-${row.id}`}
                value={breachCode}
                onChange={(event) => setBreachCode(event.target.value)}
                placeholder="OVERCHARGE"
                className="mt-1 min-h-11 w-full rounded-[9px] border border-line bg-white px-3 font-mono text-sm text-navy outline-none focus:border-primary"
              />
            </div>
          ) : null}

          <div>
            <label htmlFor={`note-${row.id}`} className="text-[11.5px] font-semibold text-slate-800">
              {dict.admin.note}
            </label>
            <textarea
              id={`note-${row.id}`}
              rows={2}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className="mt-1 w-full rounded-[9px] border border-line bg-white p-3 text-sm text-navy outline-none focus:border-primary"
            />
          </div>

          {/* Only shown in the one state the API demands it. */}
          {needsOverride ? (
            <div>
              <label htmlFor={`override-${row.id}`} className="text-[11.5px] font-semibold text-slate-800">
                {dict.admin.overrideReason}
              </label>
              <textarea
                id={`override-${row.id}`}
                rows={2}
                value={overrideReason}
                onChange={(event) => setOverrideReason(event.target.value)}
                placeholder={dict.admin.overridePlaceholder}
                className="mt-1 w-full rounded-[9px] border border-line bg-white p-3 text-sm text-navy outline-none focus:border-primary"
              />
              <p className="mt-1 text-[11px] leading-5 text-muted">{dict.admin.overrideNote}</p>
            </div>
          ) : null}

          {error !== '' ? (
            <p role="alert" className="rounded-[9px] bg-rose-50 p-3 text-sm text-rose-700">
              {error}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={resolve.isPending} onClick={() => void submit()}>
              {resolve.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              {dict.admin.recordRuling}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {dict.common.cancel}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
            {dict.admin.ruleOnDispute}
          </Button>
          <p className="text-xs leading-5 text-muted">{dict.admin.rightOfReplyNote}</p>
        </div>
      )}
    </Card>
  );
}

const paisa = (value: string): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
};
