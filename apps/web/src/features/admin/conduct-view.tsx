'use client';

import { useState } from 'react';
import { Gavel, Loader2, Scale, ShieldAlert } from 'lucide-react';
import { Button, Card, PageHeader } from '@/components/ui';
import type { AppealStatus, PenaltyStatus } from '@/features/admin/cases-api';
import { useAppeals, useApplyPenalty, useDecideAppeal, usePenalties, useWithdrawPenalty } from '@/features/admin/cases-queries';
import { detailOf, toastSuccess } from '@/features/auth/auth-feedback';
import { ApiError } from '@/lib/api/problem';
import type { Dictionary } from '@/lib/dictionaries';
import { cn, formatDateTime, formatMoney, type Locale } from '@/lib/utils';

/* Penalties and appeals — `GET/POST /admin/penalties`, `/apply`, `/withdraw`, and
 * `GET /admin/appeals` with `/decide`.
 *
 * **`apply` is refused with 409 until the professional has replied or 48 hours have
 * passed.** That right of reply is the whole reason a proposed penalty is not a
 * punishment yet, so the Apply control is *gated in the UI* rather than offered and
 * left to fail: an admin who is told "you cannot do this yet, and here is why" is
 * in a different position from one who fills in a form and gets a rejection.
 *
 * **`PARTIAL` on an appeal is the only decision that moves money**, and it moves it
 * back to the professional while keeping the demerit points. `UPHELD` changes
 * nothing and `REVERSED` undoes the penalty exactly — so the three are described
 * differently on screen, because they are not three flavours of the same thing.
 *
 * **The fine is not invented.** `finePaisa` is computed by the server from the
 * breach's own rule, and `evidence` is free-form JSON the proposing admin recorded.
 * Both are printed as they arrived. */

const PENALTY_STATUSES: PenaltyStatus[] = ['PROPOSED', 'APPLIED', 'APPEALED', 'UPHELD', 'REVERSED', 'WITHDRAWN'];
const APPEAL_STATUSES: AppealStatus[] = ['OPEN', 'UPHELD', 'REVERSED', 'PARTIAL'];

export function AdminPenalties({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const [status, setStatus] = useState<PenaltyStatus | undefined>(undefined);
  const penalties = usePenalties({ ...(status === undefined ? {} : { status }) }, locale);

  const rows = penalties.data?.items ?? [];
  const proposed = rows.filter((row) => row.status === 'PROPOSED').length;
  const forbidden = penalties.error instanceof ApiError && penalties.error.status === 403;

  return (
    <div>
      <PageHeader eyebrow={dict.portal.admin} title={dict.admin.penalties} description={dict.admin.penaltiesText} />

      <div className="mt-6 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="penalty-status" className="text-[11.5px] font-semibold text-slate-800">
            {dict.common.status}
          </label>
          <select
            id="penalty-status"
            value={status ?? ''}
            onChange={(event) => setStatus(event.target.value === '' ? undefined : (event.target.value as PenaltyStatus))}
            className="mt-1 min-h-11 rounded-[9px] border border-line bg-white px-3 text-sm text-navy outline-none focus:border-primary"
          >
            <option value="">{dict.admin.anyStatus}</option>
            {PENALTY_STATUSES.map((value) => (
              <option key={value} value={value}>
                {dict.admin.penaltyStates[value]}
              </option>
            ))}
          </select>
        </div>
        <p className="text-sm text-secondary">{dict.admin.proposedCount.replace('{count}', String(proposed))}</p>
      </div>

      <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-muted">
        <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        {dict.admin.penaltyWindowNote}
      </p>

      {penalties.isPending ? (
        <Card className="mt-6 p-8 text-center text-sm text-muted" aria-busy="true">
          {dict.admin.loadingPenalties}
        </Card>
      ) : penalties.isError ? (
        <div role="alert" className="mt-6 rounded-[14px] border border-rose-200 bg-rose-50 p-5">
          <p className="text-sm font-medium leading-6 text-rose-800">{dict.admin.penaltiesLoadError}</p>
          {forbidden ? <p className="mt-2 text-sm leading-6 text-rose-800">{dict.admin.adminTotpRequired}</p> : null}
          <Button type="button" variant="secondary" size="sm" className="mt-4" onClick={() => void penalties.refetch()}>
            {dict.catalogue.retry}
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <Card className="mt-6 border-dashed px-6 py-14 text-center">
          <h2 className="font-semibold text-navy">{dict.admin.noPenalties}</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-secondary">{dict.admin.noPenaltiesText}</p>
        </Card>
      ) : (
        <ul className="mt-6 grid gap-4">
          {rows.map((row) => (
            <li key={row.id}>
              <PenaltyCard locale={locale} dict={dict} row={row} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PenaltyCard({
  locale,
  dict,
  row
}: {
  locale: Locale;
  dict: Dictionary;
  row: {
    id: string;
    providerId: string;
    breachCode: string;
    breachName: string;
    category: string;
    points: number;
    status: string;
    bookingCode: string | null;
    finePaisa: number;
    replyDueAt: string;
    providerReply: string | null;
    repliedAt: string | null;
    evidence: unknown;
    appliedAt: string | null;
    createdAt: string;
  };
}) {
  const apply = useApplyPenalty(locale);
  const withdraw = useWithdrawPenalty(locale);
  const [reason, setReason] = useState('');
  const [withdrawing, setWithdrawing] = useState(false);
  const [error, setError] = useState('');

  /* The clock, captured once — see the note in disputes-view.tsx. */
  const [now] = useState(() => Date.now());
  const replyWindowOpen = new Date(row.replyDueAt).getTime() > now;
  /* `conduct.service.ts` refuses `apply` until `repliedAt` is set or the deadline
      has passed. Both are published, so both can be stated. */
  const canApply = row.status === 'PROPOSED' && (row.repliedAt !== null || !replyWindowOpen);

  const doApply = async (): Promise<void> => {
    try {
      await apply.mutateAsync(row.id);
      toastSuccess(dict.admin.penaltyApplied);
    } catch (caught) {
      setError(detailOf(caught, dict));
    }
  };

  const doWithdraw = async (): Promise<void> => {
    setError('');
    if (reason.trim().length < 3) {
      setError(dict.admin.withdrawReasonRequired);
      return;
    }
    try {
      await withdraw.mutateAsync({ id: row.id, reason: reason.trim() });
      toastSuccess(dict.admin.penaltyWithdrawn);
      setWithdrawing(false);
      setReason('');
    } catch (caught) {
      setError(detailOf(caught, dict));
    }
  };

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 font-semibold text-navy">
            <ShieldAlert className="size-4 shrink-0 text-muted" aria-hidden="true" />
            {row.breachName}
          </h2>
          <p className="mt-1 font-mono text-xs text-muted">{row.breachCode}</p>
          <p className="mt-1 text-xs text-muted">
            {dict.admin.category}: {dict.admin.penaltyCategories[row.category as keyof typeof dict.admin.penaltyCategories] ?? row.category} ·{' '}
            {dict.admin.demeritPoints.replace('{points}', String(row.points))}
          </p>
          {row.bookingCode === null ? null : <p className="mt-1 font-mono text-xs text-secondary">{row.bookingCode}</p>}
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className={cn('rounded-full px-2.5 py-1 text-[11px] font-semibold', row.status === 'APPLIED' ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-700')}>
            {dict.admin.penaltyStates[row.status as PenaltyStatus] ?? row.status}
          </span>
          <p className="text-sm font-semibold text-navy tabular-nums">{formatMoney(row.finePaisa, locale)}</p>
        </div>
      </div>

      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted">{dict.admin.proposedOn}</dt>
          <dd className="mt-0.5 text-secondary">{formatDateTime(row.createdAt, locale)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{dict.admin.replyDue}</dt>
          <dd className="mt-0.5 text-secondary">{formatDateTime(row.replyDueAt, locale)}</dd>
        </div>
      </dl>

      {row.providerReply === null ? (
        <p className="mt-4 rounded-[9px] border border-line bg-surface-2 p-3 text-sm leading-6 text-secondary">{replyWindowOpen ? dict.admin.awaitingReply : dict.admin.replyWindowClosed}</p>
      ) : (
        <div className="mt-4 rounded-[9px] border border-line bg-surface-2 p-3">
          <p className="text-xs font-semibold text-muted">{dict.admin.providerReplyLabel}</p>
          <p className="mt-1 text-sm leading-6 text-secondary">{row.providerReply}</p>
          {row.repliedAt === null ? null : <p className="mt-1 text-[11px] text-muted">{formatDateTime(row.repliedAt, locale)}</p>}
        </div>
      )}

      {/* `evidence` is whatever the proposing admin recorded, so it is printed as
          JSON rather than being read for fields that may not be there. */}
      {row.evidence === null || row.evidence === undefined ? null : (
        <details className="mt-4 rounded-[9px] border border-line bg-surface-2 p-3">
          <summary className="cursor-pointer text-[13px] font-semibold text-secondary">{dict.admin.evidence}</summary>
          <p className="mt-2 font-mono text-[11px] leading-5 break-words text-secondary">{json(row.evidence)}</p>
        </details>
      )}

      <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
        {row.status === 'PROPOSED' ? (
          <Button type="button" disabled={!canApply || apply.isPending} onClick={() => void doApply()}>
            {apply.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            {dict.admin.applyPenalty}
          </Button>
        ) : null}
        {row.status === 'PROPOSED' ? (
          <Button type="button" variant="secondary" onClick={() => setWithdrawing((value) => !value)} aria-expanded={withdrawing}>
            {dict.admin.withdrawPenalty}
          </Button>
        ) : null}
      </div>

      {row.status === 'PROPOSED' && !canApply ? <p className="mt-2 text-xs leading-5 text-amber-800">{dict.admin.applyBlockedUntilReply}</p> : null}

      {withdrawing ? (
        <div className="mt-3 grid gap-2 rounded-[9px] border border-line bg-surface-2 p-3">
          <label htmlFor={`withdraw-${row.id}`} className="text-[11.5px] font-semibold text-slate-800">
            {dict.admin.withdrawReason}
          </label>
          <input
            id={`withdraw-${row.id}`}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="min-h-11 rounded-[9px] border border-line bg-white px-3 text-sm text-navy outline-none focus:border-primary"
          />
          <Button type="button" size="sm" disabled={withdraw.isPending} onClick={() => void doWithdraw()}>
            {dict.admin.withdrawPenalty}
          </Button>
        </div>
      ) : null}

      {error !== '' ? (
        <p role="alert" className="mt-3 rounded-[9px] bg-rose-50 p-3 text-sm text-rose-700">
          {error}
        </p>
      ) : null}
    </Card>
  );
}

/* ---- appeals ------------------------------------------------------------ */

export function AdminAppeals({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const [status, setStatus] = useState<AppealStatus | undefined>(undefined);
  const appeals = useAppeals(status, locale);

  const rows = appeals.data?.items ?? [];
  const forbidden = appeals.error instanceof ApiError && appeals.error.status === 403;
  const open = rows.filter((row) => row.status === 'OPEN').length;

  return (
    <div>
      <PageHeader eyebrow={dict.portal.admin} title={dict.admin.appeals} description={dict.admin.appealsText} />

      <div className="mt-6 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="appeal-status" className="text-[11.5px] font-semibold text-slate-800">
            {dict.common.status}
          </label>
          <select
            id="appeal-status"
            value={status ?? ''}
            onChange={(event) => setStatus(event.target.value === '' ? undefined : (event.target.value as AppealStatus))}
            className="mt-1 min-h-11 rounded-[9px] border border-line bg-white px-3 text-sm text-navy outline-none focus:border-primary"
          >
            <option value="">{dict.admin.anyStatus}</option>
            {APPEAL_STATUSES.map((value) => (
              <option key={value} value={value}>
                {dict.admin.appealStates[value]}
              </option>
            ))}
          </select>
        </div>
        <p className="text-sm text-secondary">{dict.admin.openAppeals.replace('{count}', String(open))}</p>
      </div>

      {appeals.isPending ? (
        <Card className="mt-6 p-8 text-center text-sm text-muted" aria-busy="true">
          {dict.admin.loadingAppeals}
        </Card>
      ) : appeals.isError ? (
        <div role="alert" className="mt-6 rounded-[14px] border border-rose-200 bg-rose-50 p-5">
          <p className="text-sm font-medium leading-6 text-rose-800">{dict.admin.appealsLoadError}</p>
          {forbidden ? <p className="mt-2 text-sm leading-6 text-rose-800">{dict.admin.adminTotpRequired}</p> : null}
          <Button type="button" variant="secondary" size="sm" className="mt-4" onClick={() => void appeals.refetch()}>
            {dict.catalogue.retry}
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <Card className="mt-6 border-dashed px-6 py-14 text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-full bg-surface-2 text-muted" aria-hidden="true">
            <Scale className="size-6" />
          </span>
          <h2 className="mt-4 font-semibold text-navy">{dict.admin.noAppeals}</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-secondary">{dict.admin.noAppealsText}</p>
        </Card>
      ) : (
        <ul className="mt-6 grid gap-4">
          {rows.map((row) => (
            <li key={row.id}>
              <AppealCard locale={locale} dict={dict} row={row} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AppealCard({
  locale,
  dict,
  row
}: {
  locale: Locale;
  dict: Dictionary;
  row: {
    id: string;
    penaltyId: string;
    providerId: string;
    grounds: string;
    status: string;
    decisionNote: string | null;
    createdAt: string;
    decidedAt: string | null;
    breachCode: string;
    finePaisa: number;
  };
}) {
  const decide = useDecideAppeal(locale);
  const [decision, setDecision] = useState<'UPHELD' | 'REVERSED' | 'PARTIAL'>('UPHELD');
  const [note, setNote] = useState('');
  const [refundFinePaisa, setRefundFinePaisa] = useState('');
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');

  const submit = async (): Promise<void> => {
    setError('');
    if (note.trim().length < 3) {
      setError(dict.admin.noteRequired);
      return;
    }
    try {
      await decide.mutateAsync({
        id: row.id,
        decision: {
          decision,
          note: note.trim(),
          /* Only PARTIAL moves money, so only PARTIAL sends an amount — a key the
             schema would accept from any decision, and one that would be ignored. */
          ...(decision === 'PARTIAL' ? { refundFinePaisa: paisa(refundFinePaisa) } : {})
        }
      });
      toastSuccess(dict.admin.appealDecided);
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
            {row.breachCode}
          </h2>
          <p className="mt-1 text-xs text-muted">{formatDateTime(row.createdAt, locale)}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700">{dict.admin.appealStates[row.status as AppealStatus] ?? row.status}</span>
          <p className="text-sm font-semibold text-navy tabular-nums">{formatMoney(row.finePaisa, locale)}</p>
        </div>
      </div>

      <div className="mt-4 rounded-[9px] border border-line bg-surface-2 p-3">
        <p className="text-xs font-semibold text-muted">{dict.admin.grounds}</p>
        <p className="mt-1 text-sm leading-6 text-secondary">{row.grounds}</p>
      </div>

      {row.decisionNote === null ? null : (
        <div className="mt-3 rounded-[9px] border border-line bg-surface-2 p-3">
          <p className="text-xs font-semibold text-muted">{dict.admin.decisionNoteLabel}</p>
          <p className="mt-1 text-sm leading-6 text-secondary">{row.decisionNote}</p>
          {row.decidedAt === null ? null : <p className="mt-1 text-[11px] text-muted">{formatDateTime(row.decidedAt, locale)}</p>}
        </div>
      )}

      {row.status === 'OPEN' ? (
        open ? (
          <div className="mt-4 grid gap-3 border-t border-line pt-4">
            <div>
              <label htmlFor={`decision-${row.id}`} className="text-[11.5px] font-semibold text-slate-800">
                {dict.admin.decision}
              </label>
              <select
                id={`decision-${row.id}`}
                value={decision}
                onChange={(event) => setDecision(event.target.value as 'UPHELD' | 'REVERSED' | 'PARTIAL')}
                className="mt-1 min-h-11 w-full rounded-[9px] border border-line bg-white px-3 text-sm text-navy outline-none focus:border-primary"
              >
                <option value="UPHELD">{dict.admin.appealDecisions.UPHELD}</option>
                <option value="REVERSED">{dict.admin.appealDecisions.REVERSED}</option>
                <option value="PARTIAL">{dict.admin.appealDecisions.PARTIAL}</option>
              </select>
              {/* The three are not flavours of one thing, so the consequence is
                  spelled out before the button rather than after the 200. */}
              <p className="mt-1 text-[11px] leading-5 text-muted">{dict.admin.appealDecisionEffects[decision]}</p>
            </div>

            {decision === 'PARTIAL' ? (
              <div>
                <label htmlFor={`refund-${row.id}`} className="text-[11.5px] font-semibold text-slate-800">
                  {dict.admin.refundFine}
                </label>
                <input
                  id={`refund-${row.id}`}
                  type="number"
                  min={1}
                  step={100}
                  value={refundFinePaisa}
                  onChange={(event) => setRefundFinePaisa(event.target.value)}
                  className="mt-1 min-h-11 w-full rounded-[9px] border border-line bg-white px-3 text-sm text-navy outline-none focus:border-primary"
                />
              </div>
            ) : null}

            <div>
              <label htmlFor={`appeal-note-${row.id}`} className="text-[11.5px] font-semibold text-slate-800">
                {dict.admin.note}
              </label>
              <textarea
                id={`appeal-note-${row.id}`}
                rows={2}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                className="mt-1 w-full rounded-[9px] border border-line bg-white p-3 text-sm text-navy outline-none focus:border-primary"
              />
            </div>

            {error !== '' ? (
              <p role="alert" className="rounded-[9px] bg-rose-50 p-3 text-sm text-rose-700">
                {error}
              </p>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button type="button" disabled={decide.isPending} onClick={() => void submit()}>
                {decide.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                {dict.admin.recordDecision}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                {dict.common.cancel}
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
            <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
              {dict.admin.decideAppeal}
            </Button>
            <p className="text-xs leading-5 text-muted">{dict.admin.appealDecisionNote}</p>
          </div>
        )
      ) : null}
    </Card>
  );
}

const json = (value: unknown): string => {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const paisa = (value: string): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
};
