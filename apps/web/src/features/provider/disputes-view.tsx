'use client';

import { Gavel } from 'lucide-react';
import { useState } from 'react';
import { Button, Card, Label, PageHeader, Textarea } from '@/components/ui';
import { useDispute, useDisputes, useReplyToDispute } from '@/features/provider/queries';
import type { ProviderDispute, ProviderDisputeDetail } from '@/features/provider/api';
import type { Dictionary } from '@/lib/dictionaries';
import { cn, formatDateTime, formatMoney, formatNumber, type Locale } from '@/lib/utils';

/* Disputes on the signed-in professional's jobs.

   `GET /provider/disputes` is a flat list; opening one returns the **evidence
   floor** — the same record the admin rules from, minus the agent and the call
   recordings. The professional's one lever is the right of reply
   (`POST /provider/disputes/:id/reply`, `{ reply }`): once, before the ruling,
   and replying moves the dispute to READY so the admin no longer needs an
   override to rule. */

const STATUS_TONE: Record<ProviderDispute['status'], string> = {
  OPEN: 'bg-amber-50 text-amber-700',
  AWAITING_PROVIDER_REPLY: 'bg-amber-50 text-amber-700',
  READY: 'bg-blue-50 text-primary-strong',
  RESOLVED: 'bg-slate-100 text-slate-700'
};

export function ProviderDisputesScreen({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const disputes = useDisputes(locale);
  const [selected, setSelected] = useState<string | null>(null);

  if (disputes.isPending) {
    return (
      <div aria-busy="true" aria-live="polite" className="grid gap-3">
        <span className="skeleton h-8 w-56 rounded-[9px]" />
        <span className="skeleton h-48 w-full rounded-[12px]" />
      </div>
    );
  }

  if (disputes.isError) {
    return (
      <div>
        <PageHeader eyebrow={dict.portal.provider} title={dict.portal.disputes} />
        <div role="alert" className="mt-6 rounded-[14px] border border-rose-200 bg-rose-50 p-5">
          <p className="text-sm font-medium leading-6 text-rose-800">{dict.portal.myDisputesLoadError}</p>
          <Button type="button" variant="secondary" size="sm" className="mt-4" onClick={() => void disputes.refetch()}>
            {dict.catalogue.retry}
          </Button>
        </div>
      </div>
    );
  }

  const rows = disputes.data.items;

  return (
    <div>
      <PageHeader eyebrow={dict.portal.provider} title={dict.portal.disputes} description={dict.portal.myDisputesText} />

      {rows.length === 0 ? (
        <Card className="mt-6 p-8 text-center text-sm text-secondary">{dict.portal.noMyDisputes}</Card>
      ) : (
        <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <ul className="grid content-start gap-2">
            {rows.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => setSelected(row.id)}
                  aria-pressed={selected === row.id}
                  className={cn('w-full rounded-[12px] border p-4 text-start transition', selected === row.id ? 'border-primary bg-surface-2' : 'border-line bg-white hover:bg-surface-2')}
                >
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-navy">{row.bookingCode}</span>
                    <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', STATUS_TONE[row.status])}>{dict.admin.disputeStates[row.status]}</span>
                  </span>
                  <span className="mt-1 block text-xs text-muted">
                    {row.status === 'RESOLVED' && row.resolution !== null
                      ? dict.admin.rulings[row.resolution]
                      : row.providerReplied
                        ? dict.portal.disputeReplied
                        : row.replyDueAt !== null
                          ? dict.portal.disputeReplyBy.replace('{date}', formatDateTime(row.replyDueAt, locale))
                          : formatDateTime(row.createdAt, locale)}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {selected === null ? (
            <Card className="p-6 text-sm text-secondary">{dict.portal.disputeChoose}</Card>
          ) : (
            <DisputeDetail key={selected} id={selected} locale={locale} dict={dict} />
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-line py-2 last:border-b-0">
      <dt className="text-muted">{label}</dt>
      <dd className="text-end font-medium text-navy">{value}</dd>
    </div>
  );
}

function DisputeDetail({ id, locale, dict }: { id: string; locale: Locale; dict: Dictionary }) {
  const detail = useDispute(id, locale);
  const reply = useReplyToDispute(locale);
  const [text, setText] = useState('');
  const [localError, setLocalError] = useState('');
  const [sent, setSent] = useState(false);

  if (detail.isPending) return <span className="skeleton h-64 w-full rounded-[12px]" aria-busy="true" />;

  if (detail.isError) {
    return (
      <div role="alert" className="rounded-[14px] border border-rose-200 bg-rose-50 p-5">
        <p className="text-sm font-medium leading-6 text-rose-800">{dict.portal.disputeLoadError}</p>
        <Button type="button" variant="secondary" size="sm" className="mt-4" onClick={() => void detail.refetch()}>
          {dict.catalogue.retry}
        </Button>
      </div>
    );
  }

  const { dispute, booking, money, evidenceFloor, complaints }: ProviderDisputeDetail = detail.data;
  const notRecorded = dict.portal.disputeNotRecorded;
  const checklistDone = evidenceFloor.checklist.filter((step) => step.done === true).length;
  const canReply = dispute.status !== 'RESOLVED' && dispute.providerReply === null && !sent;

  const send = async (): Promise<void> => {
    setLocalError('');
    const body = text.trim();
    if (body === '') {
      setLocalError(dict.portal.disputeReplyRequired);
      return;
    }
    try {
      await reply.mutateAsync({ disputeId: dispute.id, reply: body });
      setSent(true);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : dict.portal.disputeLoadError);
    }
  };

  return (
    <div className="grid content-start gap-5">
      <Card className="p-6">
        <p className="text-xs font-semibold text-muted">{booking.code}</p>
        <h2 className="mt-1 text-lg font-semibold text-navy">{booking.serviceName}</h2>
        <p className="mt-1 text-sm text-secondary">{formatDateTime(booking.scheduledStart, locale)}</p>
        {booking.problemText !== null && booking.problemText !== '' ? <p className="mt-3 text-sm leading-6 text-secondary">{booking.problemText}</p> : null}

        <h3 className="mt-5 text-sm font-semibold text-navy">{dict.portal.disputeEvidenceTitle}</h3>
        <dl className="mt-2 text-sm">
          <Row label={dict.portal.disputeHeld} value={formatMoney(money.escrowHeldPaisa, locale)} />
          <Row label={dict.portal.disputeFinalAmount} value={formatMoney(money.finalAmountPaisa, locale)} />
          <Row label={dict.portal.disputeStartCode} value={evidenceFloor.startCodeVerifiedAt === null ? notRecorded : formatDateTime(evidenceFloor.startCodeVerifiedAt, locale)} />
          <Row label={dict.portal.disputeCompletedAt} value={evidenceFloor.completedAt === null ? notRecorded : formatDateTime(evidenceFloor.completedAt, locale)} />
          <Row label={dict.portal.disputeMinutesOnSite} value={evidenceFloor.minutesOnSite === null ? notRecorded : formatNumber(evidenceFloor.minutesOnSite, locale)} />
          <Row label={dict.portal.disputePhotos} value={formatNumber(evidenceFloor.photos.length, locale)} />
          <Row label={dict.portal.disputeChecklistDone} value={`${formatNumber(checklistDone, locale)} / ${formatNumber(evidenceFloor.checklist.length, locale)}`} />
          <Row label={dict.portal.disputeInvoice} value={evidenceFloor.invoice === null ? notRecorded : `${evidenceFloor.invoice.number} · ${formatMoney(evidenceFloor.invoice.totalPaisa, locale)}`} />
        </dl>

        {complaints.length > 0 ? (
          <>
            <h3 className="mt-5 text-sm font-semibold text-navy">{dict.portal.disputeComplaints}</h3>
            <ul className="mt-2 grid gap-2">
              {complaints.map((complaint) => (
                <li key={complaint.id} className="rounded-[9px] bg-surface-2 p-3 text-sm leading-6 text-secondary">
                  {complaint.description}
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </Card>

      {dispute.status === 'RESOLVED' && dispute.resolution !== null ? (
        <Card className="p-6">
          <h3 className="flex items-center gap-2 font-semibold text-navy">
            <Gavel className="size-4 text-muted" aria-hidden="true" />
            {dict.portal.disputeRuling}
          </h3>
          <p className="mt-2 text-sm text-navy">{dict.admin.rulings[dispute.resolution]}</p>
          {dispute.note !== null && dispute.note !== '' ? (
            <p className="mt-2 text-sm leading-6 text-secondary">
              {dict.portal.disputeRulingNote}: {dispute.note}
            </p>
          ) : null}
        </Card>
      ) : null}

      <Card className="p-6">
        <h3 className="font-semibold text-navy">{dict.portal.disputeYourReply}</h3>
        {dispute.providerReply !== null ? <p className="mt-3 whitespace-pre-line rounded-[9px] bg-surface-2 p-3 text-sm leading-6 text-navy">{dispute.providerReply}</p> : null}
        {sent ? (
          <p role="status" className="mt-3 rounded-[9px] bg-emerald-50 p-3 text-sm text-emerald-800">
            {dict.portal.disputeReplySent}
          </p>
        ) : null}
        {sent || dispute.providerReply !== null ? null : !canReply ? (
          <p className="mt-3 text-sm text-secondary">{dict.portal.disputeRuledNoReply}</p>
        ) : (
          <div className="mt-3 grid gap-3">
            {dispute.replyDueAt !== null ? (
              <p className="text-sm font-medium text-amber-700">{dict.portal.disputeReplyBy.replace('{date}', formatDateTime(dispute.replyDueAt, locale))}</p>
            ) : null}
            <div className="grid gap-2">
              <Label htmlFor="dispute-reply">{dict.portal.disputeReplyLabel}</Label>
              <Textarea id="dispute-reply" value={text} maxLength={3000} onChange={(event) => setText(event.target.value)} />
              <p className="text-xs leading-5 text-muted">{dict.portal.disputeReplyOnce}</p>
            </div>
            {localError !== '' ? (
              <p role="alert" className="rounded-[9px] bg-rose-50 p-3 text-sm text-rose-700">
                {localError}
              </p>
            ) : null}
            <div>
              <Button type="button" onClick={() => void send()} disabled={reply.isPending}>
                {dict.portal.disputeSendReply}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
