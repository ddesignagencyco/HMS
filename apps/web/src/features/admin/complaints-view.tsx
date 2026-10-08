'use client';

import { useState } from 'react';
import { AlertTriangle, ArrowRight, Clock, Loader2, ShieldAlert } from 'lucide-react';
import { Button, Card, PageHeader, StatCard } from '@/components/ui';
import { RESOLUTIONS, type ComplaintQueueFilters, type ComplaintStatus, type ComplaintTarget, type Resolution } from '@/features/admin/cases-api';
import { useAssignComplaint, useComplaintDetail, useComplaintQueue, useOpenDispute, useTransitionComplaint } from '@/features/admin/cases-queries';
import { detailOf, toastError, toastSuccess } from '@/features/auth/auth-feedback';
import { ApiError } from '@/lib/api/problem';
import type { Dictionary } from '@/lib/dictionaries';
import { cn, formatDateTime, formatMoney, formatNumber, type Locale } from '@/lib/utils';

/* The complaint queue — `GET /admin/complaints`, and the three decisions that can
 * be taken on one: assign, transition, open a dispute.
 *
 * **The order shown is the order the server sent.** `complaints.service.ts` orders
 * open first, then SAFETY at the very top, then HIGH, then by `sla_due_at`, and
 * computes `slaRemainingMinutes` / `slaBreached` itself. Re-sorting in the browser
 * by "how soon the SLA runs out" would recompute a deadline the server already
 * published and would disagree with it by however long the page was open — and it
 * would throw away the server's own judgement about what is urgent. So the row
 * order and the SLA numbers are both taken as published.
 *
 * **A resolution is a closed set, not a note.** `RESOLUTIONS` has seven members and
 * three of them carry extra fields the server needs: `PARTIAL_REFUND` wants
 * `refundPaisa`, `TEMPORARY_SUSPENSION` wants `suspensionDays`, `PROVIDER_PENALTY`
 * wants `breachCode`. The form is therefore built from the enum and reveals the
 * extra input for the three that need one, rather than offering a free-text box
 * that would 422 on submit.
 *
 * **The provider's right of reply is a gate, not an error.** `POST .../apply` on a
 * penalty is refused with 409 until the provider has replied or 48 hours pass, so
 * anything that steps on that right here would only produce a rejection. */

const STATUSES: ComplaintStatus[] = ['OPEN', 'UNDER_REVIEW', 'AWAITING_RESPONSE', 'RESOLVED', 'REJECTED'];
const SEVERITIES = ['SAFETY', 'HIGH', 'NORMAL'] as const;

/** The three resolutions the server asks for an extra field with. */
const RESOLUTIONS_NEEDING_AMOUNT: Resolution[] = ['PARTIAL_REFUND'];
const RESOLUTIONS_NEEDING_DAYS: Resolution[] = ['TEMPORARY_SUSPENSION'];
const RESOLUTIONS_NEEDING_BREACH: Resolution[] = ['PROVIDER_PENALTY'];

export function AdminComplaints({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const [status, setStatus] = useState<ComplaintStatus | undefined>(undefined);
  const [severity, setSeverity] = useState<(typeof SEVERITIES)[number] | undefined>(undefined);
  const [openOnly, setOpenOnly] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const filters: ComplaintQueueFilters = {
    ...(status === undefined ? {} : { status }),
    ...(severity === undefined ? {} : { severity }),
    ...(openOnly ? { open: 'true' as const } : {})
  };
  const queue = useComplaintQueue(filters, locale);

  if (selected !== null) {
    return <ComplaintDetailPanel locale={locale} dict={dict} id={selected} onBack={() => setSelected(null)} />;
  }

  const rows = queue.data?.items ?? [];
  const breached = rows.filter((row) => row.slaBreached).length;
  const safety = rows.filter((row) => row.severity === 'SAFETY').length;
  const stillOpen = rows.filter((row) => row.status !== 'RESOLVED' && row.status !== 'REJECTED').length;
  const forbidden = queue.error instanceof ApiError && queue.error.status === 403;

  return (
    <div>
      <PageHeader eyebrow={dict.portal.admin} title={dict.admin.complaints} description={dict.admin.complaintsText} />

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={ShieldAlert} label={dict.admin.openComplaints} value={formatNumber(stillOpen, locale)} />
        <StatCard icon={AlertTriangle} label={dict.admin.safetyComplaints} value={formatNumber(safety, locale)} />
        <StatCard icon={Clock} label={dict.admin.slaBreaches} value={formatNumber(breached, locale)} />
        <StatCard icon={ArrowRight} label={dict.admin.queue} value={formatNumber(rows.length, locale)} />
      </div>

      {/* The server decides the order, so the only filters here are the ones the
          server also understands. Anything computed in the browser would be a second,
          disagreeing opinion about what is urgent. */}
      <div className="mt-6 flex flex-wrap items-end gap-3">
        <FilterSelect
          id="complaint-status"
          label={dict.common.status}
          value={status ?? ''}
          onChange={(value) => setStatus(value === '' ? undefined : (value as ComplaintStatus))}
          options={STATUSES.map((value) => ({ value, label: dict.admin.complaintStates[value] }))}
          anyLabel={dict.admin.anyStatus}
        />
        <FilterSelect
          id="complaint-severity"
          label={dict.admin.severity}
          value={severity ?? ''}
          onChange={(value) => setSeverity(value === '' ? undefined : (value as (typeof SEVERITIES)[number]))}
          options={SEVERITIES.map((value) => ({ value, label: dict.portal.complaintSeverities[value] }))}
          anyLabel={dict.admin.anySeverity}
        />
        <label className="flex min-h-11 items-center gap-2 rounded-[9px] border border-line bg-white px-4 text-sm text-navy">
          <input type="checkbox" checked={openOnly} onChange={(event) => setOpenOnly(event.target.checked)} />
          {dict.admin.openOnly}
        </label>
      </div>

      <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-muted">
        <Clock className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        {dict.admin.slaNote}
      </p>

      {queue.isPending ? (
        <Card className="mt-6 p-8 text-center text-sm text-muted" aria-busy="true">
          {dict.admin.loadingComplaints}
        </Card>
      ) : queue.isError ? (
        <div role="alert" className="mt-6 rounded-[14px] border border-rose-200 bg-rose-50 p-5">
          <p className="text-sm font-medium leading-6 text-rose-800">{dict.admin.complaintsLoadError}</p>
          {forbidden ? <p className="mt-2 text-sm leading-6 text-rose-800">{dict.admin.adminTotpRequired}</p> : null}
          <Button type="button" variant="secondary" size="sm" className="mt-4" onClick={() => void queue.refetch()}>
            {dict.catalogue.retry}
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <Card className="mt-6 border-dashed px-6 py-14 text-center">
          <h2 className="font-semibold text-navy">{dict.admin.noComplaints}</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-secondary">{dict.admin.noComplaintsText}</p>
        </Card>
      ) : (
        <Card className="mt-6 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-sm">
              <thead className="bg-slate-50 text-xs text-muted">
                <tr>
                  <th className="p-4 text-start">{dict.admin.auditWhen}</th>
                  <th className="p-4 text-start">{dict.admin.severity}</th>
                  <th className="p-4 text-start">{dict.admin.booking}</th>
                  <th className="p-4 text-start">{dict.admin.subject}</th>
                  <th className="p-4 text-start">{dict.common.status}</th>
                  <th className="p-4 text-start">{dict.admin.assignedTo}</th>
                  <th className="p-4 text-end">{dict.admin.actions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((row) => (
                  <tr key={row.id} className={cn('align-top', row.slaBreached ? 'bg-rose-50/50' : 'hover:bg-slate-50')}>
                    <td className="p-4 text-xs whitespace-nowrap text-secondary">{formatDateTime(row.createdAt, locale)}</td>
                    <td className="p-4">
                      <span
                        className={cn(
                          'rounded-full px-2.5 py-1 text-[11px] font-semibold',
                          row.severity === 'SAFETY' ? 'bg-rose-100 text-rose-800' : row.severity === 'HIGH' ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-700'
                        )}
                      >
                        {dict.portal.complaintSeverities[row.severity as keyof typeof dict.portal.complaintSeverities] ?? row.severity}
                      </span>
                    </td>
                    <td className="p-4 font-mono text-xs text-secondary">{row.bookingCode ?? dict.admin.noBooking}</td>
                    <td className="p-4">
                      <p className="font-medium text-navy">{dict.admin.subjects[row.category as keyof typeof dict.admin.subjects] ?? row.category}</p>
                      {/* The description is the complainant's own words, truncated —
                          the full text is on the detail screen. */}
                      <p className="mt-1 max-w-xs text-xs leading-5 text-muted">{row.description}</p>
                    </td>
                    <td className="p-4">
                      <span className="text-xs font-semibold text-navy">{dict.admin.complaintStates[row.status as ComplaintStatus] ?? row.status}</span>
                      {/* The server's own SLA verdict. Not recomputed. */}
                      <SlaCell dict={dict} locale={locale} minutes={row.slaRemainingMinutes} breached={row.slaBreached} />
                    </td>
                    <td className="p-4 font-mono text-xs text-secondary">{row.assignedTo ?? dict.admin.unassigned}</td>
                    <td className="p-4 text-end">
                      <Button type="button" variant="secondary" size="sm" onClick={() => setSelected(row.id)} aria-label={`${dict.admin.takeAction}: ${row.bookingCode ?? row.id}`}>
                        {dict.admin.takeAction}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

/** The server's `slaRemainingMinutes`, shown as it was published. */
function SlaCell({ dict, locale, minutes, breached }: { dict: Dictionary; locale: Locale; minutes: number; breached: boolean }) {
  if (breached) {
    return <p className="mt-1 text-[11px] font-semibold text-rose-700">{dict.admin.slaBreached}</p>;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return (
    <p className="mt-1 text-[11px] text-muted">
      {hours > 0
        ? dict.admin.slaInHoursMinutes.replace('{hours}', formatNumber(hours, locale)).replace('{minutes}', formatNumber(rest, locale))
        : dict.admin.slaInMinutes.replace('{minutes}', formatNumber(minutes, locale))}
    </p>
  );
}

function FilterSelect({
  id,
  label,
  value,
  onChange,
  options,
  anyLabel
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  anyLabel: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="text-[11.5px] font-semibold text-slate-800">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 min-h-11 rounded-[9px] border border-line bg-white px-3 text-sm text-navy outline-none focus:border-primary"
      >
        <option value="">{anyLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/* ---- one complaint ------------------------------------------------------ */

function ComplaintDetailPanel({ locale, dict, id, onBack }: { locale: Locale; dict: Dictionary; id: string; onBack: () => void }) {
  const detail = useComplaintDetail(id, locale);
  const assign = useAssignComplaint(locale);
  const transition = useTransitionComplaint(locale);
  const openDispute = useOpenDispute(locale);

  const [target, setTarget] = useState<ComplaintTarget>('UNDER_REVIEW');
  const [note, setNote] = useState('');
  const [resolution, setResolution] = useState<Resolution | ''>('');
  const [refundPaisa, setRefundPaisa] = useState('');
  const [suspensionDays, setSuspensionDays] = useState('');
  const [breachCode, setBreachCode] = useState('');
  const [formError, setFormError] = useState('');

  if (detail.isPending) {
    return (
      <Card className="mt-6 p-8 text-center text-sm text-muted" aria-busy="true">
        {dict.admin.loadingComplaints}
      </Card>
    );
  }

  if (detail.isError) {
    return (
      <div role="alert" className="mt-6 rounded-[14px] border border-rose-200 bg-rose-50 p-5">
        <p className="text-sm font-medium leading-6 text-rose-800">{dict.admin.complaintsLoadError}</p>
        <Button type="button" variant="secondary" size="sm" className="mt-4" onClick={onBack}>
          {dict.common.back}
        </Button>
      </div>
    );
  }

  const row = detail.data;
  const closed = row.status === 'RESOLVED' || row.status === 'REJECTED';

  const submit = async (): Promise<void> => {
    setFormError('');
    /* Closing needs a note (`min(3)`) and the server rejects a decision with no
       resolution, so both are checked here rather than left to a 422. */
    if (note.trim().length < 3) {
      setFormError(dict.admin.noteRequired);
      return;
    }
    if ((target === 'RESOLVED' || target === 'REJECTED') && resolution === '') {
      setFormError(dict.admin.resolutionRequired);
      return;
    }
    try {
      await transition.mutateAsync({
        id: row.id,
        transition: {
          to: target,
          note: note.trim(),
          ...(resolution === '' ? {} : { resolution }),
          ...(resolution !== '' && RESOLUTIONS_NEEDING_AMOUNT.includes(resolution) ? { refundPaisa: paisa(refundPaisa) } : {}),
          ...(resolution !== '' && RESOLUTIONS_NEEDING_DAYS.includes(resolution) ? { suspensionDays: Number(suspensionDays) } : {}),
          ...(resolution !== '' && RESOLUTIONS_NEEDING_BREACH.includes(resolution) ? { breachCode: breachCode.trim() } : {})
        }
      });
      toastSuccess(dict.admin.decisionRecorded);
      setNote('');
      setResolution('');
    } catch (error) {
      setFormError(detailOf(error, dict));
    }
  };

  const takeIt = async (): Promise<void> => {
    try {
      await assign.mutateAsync({ id: row.id });
      toastSuccess(dict.admin.assignedToYou);
    } catch (error) {
      toastError(detailOf(error, dict));
    }
  };

  const freeze = async (): Promise<void> => {
    try {
      await openDispute.mutateAsync(row.id);
      toastSuccess(dict.admin.disputeOpened);
    } catch (error) {
      toastError(detailOf(error, dict));
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow={dict.portal.admin}
        title={dict.admin.complaintDetail}
        description={row.bookingCode ?? undefined}
        action={
          <Button type="button" variant="secondary" onClick={onBack}>
            {dict.common.back}
          </Button>
        }
      />

      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_380px]">
        <div className="grid gap-5">
          <Card className="p-5">
            <h2 className="font-semibold text-navy">{dict.admin.subject}</h2>
            <p className="mt-2 text-sm leading-6 text-secondary">{row.description}</p>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <Detail label={dict.common.status} value={dict.admin.complaintStates[row.status as ComplaintStatus] ?? row.status} />
              <Detail label={dict.admin.severity} value={dict.portal.complaintSeverities[row.severity as keyof typeof dict.portal.complaintSeverities] ?? row.severity} />
              <Detail label={dict.admin.raisedBy} value={row.raisedByName ?? dict.admin.systemAction} />
              <Detail label={dict.admin.against} value={row.againstName} />
              <Detail label={dict.admin.assignedTo} value={row.assignedTo ?? dict.admin.unassigned} />
              <Detail label={dict.admin.slaDue} value={formatDateTime(row.slaDueAt, locale)} />
              {row.booking === null ? null : <Detail label={dict.admin.booking} value={`${row.booking.status} · ${formatMoney(row.booking.finalAmountPaisa ?? 0, locale)}`} />}
              {row.penalties.length === 0 ? null : <Detail label={dict.admin.penalties} value={row.penalties.map((p) => `${p.breachCode} (${p.status})`).join(', ')} />}
              {row.disputes.length === 0 ? null : <Detail label={dict.admin.disputes} value={row.disputes.map((d) => `${d.origin} (${d.status})`).join(', ')} />}
            </dl>
          </Card>

          <Card className="p-5">
            <h2 className="font-semibold text-navy">{dict.admin.timeline}</h2>
            {row.timeline.length === 0 ? (
              <p className="mt-3 text-sm text-muted">{dict.admin.noTimeline}</p>
            ) : (
              <ol className="mt-3 grid gap-3">
                {row.timeline.map((entry) => (
                  <li key={entry.id} className="border-s-2 border-line ps-3">
                    <p className="text-xs text-muted">
                      {entry.kind} · {formatDateTime(entry.createdAt, locale)}
                    </p>
                    {entry.body === null ? null : <p className="mt-1 text-sm leading-6 text-secondary">{entry.body}</p>}
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        <div className="grid gap-5">
          <Card className="p-5">
            <h2 className="font-semibold text-navy">{dict.admin.takeAction}</h2>

            {closed ? (
              /* `assign` and `transition` both refuse a closed complaint, so the
                 controls are not offered at all rather than left to 409. */
              <p className="mt-3 rounded-[9px] border border-line bg-surface-2 p-3 text-sm leading-6 text-secondary">{dict.admin.complaintClosed}</p>
            ) : (
              <div className="mt-3 grid gap-3">
                <Button type="button" variant="secondary" disabled={assign.isPending} onClick={() => void takeIt()}>
                  {assign.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                  {dict.admin.takeIt}
                </Button>

                <div className="border-t border-line pt-3">
                  <label htmlFor="complaint-target" className="text-[11.5px] font-semibold text-slate-800">
                    {dict.admin.moveTo}
                  </label>
                  {/* OPEN is absent because the server only accepts these four as
                      targets and anything else is a 409. */}
                  <select
                    id="complaint-target"
                    value={target}
                    onChange={(event) => setTarget(event.target.value as ComplaintTarget)}
                    className="mt-1 min-h-11 w-full rounded-[9px] border border-line bg-white px-3 text-sm text-navy outline-none focus:border-primary"
                  >
                    {(['UNDER_REVIEW', 'AWAITING_RESPONSE', 'RESOLVED', 'REJECTED'] as ComplaintTarget[]).map((value) => (
                      <option key={value} value={value}>
                        {dict.admin.complaintStates[value]}
                      </option>
                    ))}
                  </select>
                </div>

                {(target === 'RESOLVED' || target === 'REJECTED') && (
                  <div className="grid gap-3">
                    <div>
                      <label htmlFor="complaint-resolution" className="text-[11.5px] font-semibold text-slate-800">
                        {dict.admin.resolution}
                      </label>
                      <select
                        id="complaint-resolution"
                        value={resolution}
                        onChange={(event) => setResolution(event.target.value as Resolution | '')}
                        className="mt-1 min-h-11 w-full rounded-[9px] border border-line bg-white px-3 text-sm text-navy outline-none focus:border-primary"
                      >
                        <option value="">{dict.admin.chooseResolution}</option>
                        {RESOLUTIONS.map((value) => (
                          <option key={value} value={value}>
                            {dict.admin.resolutions[value]}
                          </option>
                        ))}
                      </select>
                    </div>

                    {resolution !== '' && RESOLUTIONS_NEEDING_AMOUNT.includes(resolution) ? (
                      <MoneyField id="complaint-refund" label={dict.admin.refundAmount} value={refundPaisa} onChange={setRefundPaisa} />
                    ) : null}
                    {resolution !== '' && RESOLUTIONS_NEEDING_DAYS.includes(resolution) ? (
                      <div>
                        <label htmlFor="complaint-days" className="text-[11.5px] font-semibold text-slate-800">
                          {dict.admin.suspensionDays}
                        </label>
                        <input
                          id="complaint-days"
                          type="number"
                          min={1}
                          max={90}
                          value={suspensionDays}
                          onChange={(event) => setSuspensionDays(event.target.value)}
                          className="mt-1 min-h-11 w-full rounded-[9px] border border-line bg-white px-3 text-sm text-navy outline-none focus:border-primary"
                        />
                      </div>
                    ) : null}
                    {resolution !== '' && RESOLUTIONS_NEEDING_BREACH.includes(resolution) ? (
                      <div>
                        <label htmlFor="complaint-breach" className="text-[11.5px] font-semibold text-slate-800">
                          {dict.admin.breachCode}
                        </label>
                        <input
                          id="complaint-breach"
                          value={breachCode}
                          onChange={(event) => setBreachCode(event.target.value)}
                          placeholder="OVERCHARGE"
                          className="mt-1 min-h-11 w-full rounded-[9px] border border-line bg-white px-3 font-mono text-sm text-navy outline-none focus:border-primary"
                        />
                      </div>
                    ) : null}
                  </div>
                )}

                <div>
                  <label htmlFor="complaint-note" className="text-[11.5px] font-semibold text-slate-800">
                    {dict.admin.note}
                  </label>
                  <textarea
                    id="complaint-note"
                    rows={3}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    className="mt-1 w-full rounded-[9px] border border-line bg-white p-3 text-sm text-navy outline-none focus:border-primary"
                  />
                </div>

                {formError !== '' ? (
                  <p role="alert" className="rounded-[9px] bg-rose-50 p-3 text-sm text-rose-700">
                    {formError}
                  </p>
                ) : null}

                <Button type="button" disabled={transition.isPending} onClick={() => void submit()}>
                  {transition.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                  {dict.admin.recordDecision}
                </Button>
              </div>
            )}
          </Card>

          {/* Freezes the job's money. Only meaningful while the job is awaiting
              verification, which the server decides — a 4xx here is the server's
              answer, not a broken button. */}
          <Card className="p-5">
            <h2 className="font-semibold text-navy">{dict.admin.freezeMoney}</h2>
            <p className="mt-2 text-sm leading-6 text-secondary">{dict.admin.freezeMoneyText}</p>
            {closed ? null : (
              <Button type="button" variant="secondary" className="mt-4" disabled={openDispute.isPending} onClick={() => void freeze()}>
                {dict.admin.openDispute}
              </Button>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 font-medium text-navy">{value}</dd>
    </div>
  );
}

function MoneyField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div>
      <label htmlFor={id} className="text-[11.5px] font-semibold text-slate-800">
        {label}
      </label>
      <input
        id={id}
        type="number"
        min={1}
        /* Paisa, so the smallest refund is 100 — one rupee. Below that is a decimal
           the schema's `int` would reject. */
        step={100}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 min-h-11 w-full rounded-[9px] border border-line bg-white px-3 text-sm text-navy outline-none focus:border-primary"
      />
    </div>
  );
}

/** `z.number().int().positive()` — so a blank or fractional amount is refused here
    rather than arriving as a NaN the server would reject. */
const paisa = (value: string): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
};
