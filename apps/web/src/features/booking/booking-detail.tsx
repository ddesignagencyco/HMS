'use client';

import { AlertTriangle, CalendarDays, CheckCircle2, Image as ImageIcon, Info, ShieldCheck, XCircle } from 'lucide-react';
import { useState } from 'react';
import type { Dictionary } from '@/lib/dictionaries';
import { cn, formatDateTime, localizedPath, type Locale } from '@/lib/utils';
import { Button, ButtonLink, Card, Label, PageHeader, Textarea } from '@/components/ui';
import { money } from '@/features/catalogue/pricing';
import { InlineError, NotFoundState } from '@/features/discovery/states';
import { bookingTotalPaisa, canCancel, canReschedule, hasPendingRevision, isAwaitingProvider, isHeldPayment, rescheduleBlockReason } from '@/features/booking/status';
import {
  MAX_PROBLEM_PHOTOS,
  useApproveRevision,
  useBooking,
  useAddEvidence,
  useCancelBooking,
  useRejectRevision,
  useReportNoShow,
  useRescheduleBooking,
  useWarrantyClaim
} from '@/features/booking/queries';
import { useServiceNames } from '@/features/booking/service-names';
import type { Booking } from '@/features/booking/api';
import { BookingChat } from '@/features/booking/booking-chat';
import { isNotFoundError } from '@/lib/api/keys';
import { useProviderSlots } from '@/features/search/queries';
import { formatSlotTime } from '@/features/search/location';
import { addDays, SLOT_WINDOW_DAYS, toApiDate } from '@/features/search/types';
import { prepareEvidenceImage } from '@/features/uploads/image';

/* `GET /bookings/:id` ’ one booking, its live state, and everything the
   customer can do about it.

   Which actions appear is decided by `booking/status.ts`, which mirrors the
   API's own transition table, and every action is re-checked server-side: a
   booking that moved on between reading and clicking answers 409 and the page
   says so rather than pretending the button worked.

   The 404 is load-bearing. The API answers 404 for a booking that belongs to
   someone else *and* for one that does not exist, so this page can only ever
   say "not found" ’ never "this is not yours", which would confirm it exists. */

/* Every action on this page reports its own failure through the mutation's
   `isError`, which the cards below render. This handler exists so a refused
   action does not also become an unhandled promise rejection in the console ’
   `void promise` discards the value but attaches no rejection handler, so a 409
   would be reported by the browser as a fault in the product. */
const reportFailure = (): void => {
  /* The mutation state is the report. Nothing to do but swallow the rejection. */
};

export function BookingDetail({ locale, dict, bookingId }: { locale: Locale; dict: Dictionary; bookingId: string }) {
  const booking = useBooking(bookingId, locale);
  const names = useServiceNames(locale);

  if (booking.isPending) {
    return (
      <div aria-busy="true" aria-live="polite" className="grid gap-4">
        <span className="skeleton block h-9 w-72 rounded-[9px]" />
        <span className="skeleton block h-4 w-full max-w-lg rounded-[9px]" />
        <span className="skeleton mt-4 block h-64 w-full rounded-[14px]" />
      </div>
    );
  }

  if (booking.isError) {
    /* 404 is the API refusing to confirm that this booking exists at all ’ the
       same answer it gives for a booking that belongs to somebody else. */
    if (isNotFoundError(booking.error)) {
      return (
        <NotFoundState
          title={dict.portal.bookingNotFoundTitle}
          body={dict.portal.bookingNotFoundBody}
          action={
            <ButtonLink href={localizedPath(locale, '/account/bookings')} variant="secondary">
              {dict.portal.bookings}
            </ButtonLink>
          }
        />
      );
    }
    return <InlineError title={dict.portal.bookingError} actionLabel={dict.catalogue.retry} onRetry={() => void booking.refetch()} />;
  }

  const record = booking.data;
  const serviceName = names[record.serviceId] ?? dict.portal.unknownService;

  return (
    <div>
      <PageHeader eyebrow={record.code} title={serviceName} description={record.problemText ?? undefined} action={<StatusPill dict={dict} status={record.status} />} />

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="grid gap-6">
          <StageTimeline dict={dict} booking={record} />
          {hasPendingRevision(record) ? <RevisionCard locale={locale} dict={dict} booking={record} /> : null}
          <ActionsCard locale={locale} dict={dict} booking={record} />
          <BookingChat locale={locale} dict={dict} booking={record} />
          <ProblemPhotos locale={locale} dict={dict} bookingId={record.id} canUpload={canAttachProblemPhotos(record)} />
        </div>

        <div className="grid content-start gap-6">
          <Card className="p-5">
            <h2 className="font-semibold text-navy">{dict.booking.detailsSummaryTitle}</h2>
            <dl className="mt-4 grid gap-3 text-sm">
              <Row label={dict.booking.professional}>{isAwaitingProvider(record) ? dict.booking.awaitingAssignment : dict.booking.assignedProfessional}</Row>
              <Row label={dict.booking.slot}>{formatDateTime(record.scheduledStart, locale)}</Row>
              <Row label={dict.booking.paymentMode}>{record.paymentMode === 'ONLINE' ? dict.booking.online : dict.booking.cash}</Row>
              <Row label={dict.booking.total}>
                <span className="font-semibold tabular-nums">{money(bookingTotalPaisa(record), locale)}</span>
              </Row>
              {record.finalAmountPaisa !== null ? (
                <Row label={dict.booking.finalAmount}>
                  <span className="font-semibold tabular-nums">{money(record.finalAmountPaisa, locale)}</span>
                </Row>
              ) : null}
              {record.discountPaisa > 0 ? (
                <Row label={dict.booking.discount}>
                  <span className="text-emerald-700 tabular-nums">-{money(record.discountPaisa, locale)}</span>
                </Row>
              ) : null}
              {record.isEmergency ? <Row label={dict.common.emergency}>{dict.common.yes}</Row> : null}
            </dl>
            {isHeldPayment(record) ? (
              <p className="mt-4 flex items-start gap-2 rounded-[9px] bg-surface-2 p-3.5 text-xs leading-5 text-secondary">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden="true" />
                {dict.booking.heldNote}
              </p>
            ) : null}
            {record.cancelReason !== null ? (
              <p className="mt-4 rounded-[9px] bg-slate-50 p-3.5 text-xs leading-5 text-secondary">
                <span className="font-semibold text-navy">{dict.booking.cancelReasonLabel}: </span>
                {record.cancelReason}
              </p>
            ) : null}
          </Card>

          <WarrantyCard locale={locale} dict={dict} booking={record} />
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="text-end text-navy">{children}</dd>
    </div>
  );
}

function StatusPill({ dict, status }: { dict: Dictionary; status: Booking['status'] }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold',
        status === 'VERIFIED' || status === 'AUTO_RELEASED' || status === 'PAYMENT_RELEASED' || status === 'CLOSED'
          ? 'bg-emerald-50 text-emerald-700'
          : status === 'DISPUTED' || status === 'CANCELLED_CUSTOMER' || status === 'CANCELLED_PROVIDER' || status === 'NO_SHOW'
            ? 'bg-rose-50 text-rose-700'
            : status === 'AWAITING_VERIFICATION' || status === 'REWORK_REQUIRED'
              ? 'bg-amber-50 text-amber-800'
              : 'bg-blue-50 text-blue-700'
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {dict.bookingStatus[status] ?? status}
    </span>
  );
}

/**
 * The stages a booking has actually passed, read off the status rather than a
 * fixed list of four.
 *
 * The previous mock version rendered the same four steps for every booking and
 * labelled the last one "Current live stage" whatever the status was ’ so a
 * cancelled booking showed a progress bar that looked like it was advancing.
 */
function StageTimeline({ dict, booking }: { dict: Dictionary; booking: Booking }) {
  /* Typed against the notes object itself, so a stage added to the ladder
     without copy fails typecheck rather than rendering an empty line. */
  type Stage = keyof Dictionary['booking']['bookingStageNotes'];

  const order: Stage[] = ['REQUESTED', 'SCHEDULED', 'EN_ROUTE', 'IN_PROGRESS', 'WORK_COMPLETED', 'AWAITING_VERIFICATION', 'PAYMENT_RELEASED'];

  const isCancelled = booking.status === 'CANCELLED_CUSTOMER' || booking.status === 'CANCELLED_PROVIDER';
  const isVoid = isCancelled || booking.status === 'NO_SHOW' || booking.status === 'UNFULFILLED' || booking.status === 'ABANDONED';

  const reached = (status: Stage): boolean => {
    if (isVoid) return status === 'REQUESTED';
    const now = order.indexOf(booking.status as Stage);
    /* A status outside the ladder (REWORK_REQUIRED, DISPUTED, CLOSED) is
       reported on its own rather than being forced into a position. */
    if (now === -1) return false;
    return order.indexOf(status) <= now;
  };

  const steps = order.filter((status) => reached(status));
  const current = isVoid ? null : (dict.bookingStatus[booking.status] ?? booking.status);

  return (
    <Card className="p-5">
      <h2 className="font-semibold text-navy">{dict.booking.stageTitle}</h2>
      <ol className="mt-5 grid gap-4">
        {steps.map((status, index) => (
          <li key={status} className="flex items-start gap-3 text-sm">
            <span
              className={cn('grid size-8 shrink-0 place-items-center rounded-full text-xs font-bold', index === steps.length - 1 ? 'bg-blue-50 text-primary-strong' : 'bg-emerald-50 text-emerald-700')}
            >
              {index === steps.length - 1 && !isVoid ? <CheckCircle2 className="size-4" aria-hidden="true" /> : index + 1}
            </span>
            <div>
              <span className="font-medium text-navy">{dict.bookingStatus[status] ?? status}</span>
              <p className="text-xs text-muted">{dict.booking.bookingStageNotes[status] ?? ''}</p>
            </div>
          </li>
        ))}
      </ol>
      {current !== null ? (
        <p className="mt-4 border-t border-line pt-4 text-sm text-secondary">
          <span className="font-semibold text-navy">{dict.common.status}: </span>
          {current}
        </p>
      ) : null}
      {isVoid ? (
        <p className="mt-4 flex items-start gap-2 rounded-[9px] bg-rose-50 p-3.5 text-sm leading-6 text-rose-700">
          <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {dict.bookingStatus[booking.status] ?? booking.status}
        </p>
      ) : null}
    </Card>
  );
}

function ActionsCard({ locale, dict, booking }: { locale: Locale; dict: Dictionary; booking: Booking }) {
  const cancel = useCancelBooking(locale);
  const reschedule = useRescheduleBooking(locale);
  const noShow = useReportNoShow(locale);
  const [cancelReason, setCancelReason] = useState('');
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  const cancelAllowed = canCancel(booking);
  const rescheduleReason = rescheduleBlockReason(booking);
  const rescheduleAllowed = canReschedule(booking);
  const noShowAllowed = booking.status === 'EN_ROUTE';
  const nothingToDo = !cancelAllowed && !rescheduleAllowed && !hasPendingRevision(booking) && !noShowAllowed;

  const errorText = (cancel.isError ? dict.booking.actionFailed : null) ?? (reschedule.isError ? dict.booking.actionFailed : null) ?? (noShow.isError ? dict.booking.actionFailed : null);

  return (
    <Card className="p-5">
      <h2 className="font-semibold text-navy">{dict.booking.actionsTitle}</h2>

      {nothingToDo ? (
        <p className="mt-3 text-sm leading-6 text-secondary">{dict.booking.noActionsAvailable}</p>
      ) : (
        <div className="mt-4 grid gap-4">
          {cancelAllowed ? (
            <div className="rounded-[10px] border border-line p-4">
              <p className="text-sm font-semibold text-navy">{dict.booking.cancelTitle}</p>
              {/* FR-BK-06 is not applied by the API yet, so no fee is quoted
                  here ’ claiming one would name a rule that does not run. */}
              <p className="mt-1 text-sm leading-6 text-secondary">{dict.booking.cancelNote}</p>
              {confirmingCancel ? (
                <div className="mt-3 grid gap-3">
                  <div className="grid gap-2">
                    <Label htmlFor="cancel-reason">{dict.booking.cancelReasonLabel}</Label>
                    <Textarea id="cancel-reason" value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder={dict.booking.cancelReasonPlaceholder} />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={cancel.isPending}
                      onClick={() => void cancel.mutateAsync({ id: booking.id, ...(cancelReason.trim() === '' ? {} : { reason: cancelReason.trim() }) }).catch(reportFailure)}
                    >
                      {cancel.isPending ? dict.booking.working : dict.booking.confirmCancel}
                    </Button>
                    <Button type="button" variant="secondary" size="sm" onClick={() => setConfirmingCancel(false)} disabled={cancel.isPending}>
                      {dict.common.cancel}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button type="button" variant="secondary" size="sm" className="mt-3" onClick={() => setConfirmingCancel(true)}>
                  <XCircle className="size-4" aria-hidden="true" />
                  {dict.booking.cancelAction}
                </Button>
              )}
            </div>
          ) : null}

          {rescheduleReason !== null ? (
            <p className="rounded-[9px] bg-surface-2 p-3.5 text-sm leading-6 text-secondary">
              {rescheduleReason === 'status' ? dict.booking.rescheduleWrongStatus : rescheduleReason === 'used' ? dict.booking.rescheduleAlreadyUsed : dict.booking.rescheduleTooLate}
            </p>
          ) : (
            <ReschedulePanel locale={locale} dict={dict} booking={booking} reschedule={reschedule} />
          )}

          {noShowAllowed ? (
            <div className="rounded-[10px] border border-line p-4">
              <p className="text-sm font-semibold text-navy">{dict.booking.noShowTitle}</p>
              <p className="mt-1 text-sm leading-6 text-secondary">{dict.booking.noShowNote}</p>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="mt-3"
                disabled={noShow.isPending}
                onClick={() => void noShow.mutateAsync({ id: booking.id, party: 'PROVIDER' }).catch(reportFailure)}
              >
                <AlertTriangle className="size-4" aria-hidden="true" />
                {dict.booking.noShowAction}
              </Button>
            </div>
          ) : null}
        </div>
      )}

      {errorText !== null ? (
        <p role="alert" className="mt-4 rounded-[9px] bg-rose-50 p-3 text-sm text-rose-700">
          {errorText}
        </p>
      ) : null}
    </Card>
  );
}

/**
 * FR-BK-05: pick a new start from the same professional's live availability and
 * send both instants.
 *
 * The slot list is the same `/slots` endpoint the booking flow uses, refetched
 * per day and never cached ’ the whole point of a reschedule is a time that is
 * still free. Only a slot that is actually free is offered; there is no free-text
 * time field, because the API would reject it and the customer would be the one
 * explaining why.
 */
function ReschedulePanel({ locale, dict, booking, reschedule }: { locale: Locale; dict: Dictionary; booking: Booking; reschedule: ReturnType<typeof useRescheduleBooking> }) {
  const [date, setDate] = useState(() => toApiDate(new Date()));
  const [picked, setPicked] = useState<{ start: string; end: string } | null>(null);
  /* An auto-assign booking that a provider later took has a provider; one that
     nobody took cannot be rescheduled at all, which `rescheduleBlockReason`
     has already accounted for by the SCHEDULED requirement. */
  const slots = useProviderSlots(booking.providerId, booking.serviceId, booking.providerId === null ? null : date, locale);
  const tag = locale === 'ur' ? 'ur-PK' : 'en-PK';

  const days = Array.from({ length: SLOT_WINDOW_DAYS }, (_, index) => {
    const value = addDays(new Date(), index);
    return { value: toApiDate(value), label: new Intl.DateTimeFormat(tag, { weekday: 'short', day: 'numeric', month: 'short' }).format(value) };
  });

  return (
    <div className="rounded-[10px] border border-line p-4">
      <p className="text-sm font-semibold text-navy">{dict.booking.rescheduleTitle}</p>
      <p className="mt-1 text-sm leading-6 text-secondary">{dict.booking.rescheduleNote}</p>

      <div className="-mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1">
        {days.map((day) => (
          <button
            key={day.value}
            type="button"
            aria-pressed={day.value === date}
            onClick={() => {
              setDate(day.value);
              setPicked(null);
            }}
            className={cn(
              'min-h-10 shrink-0 rounded-[9px] border px-3 text-xs font-semibold transition-colors',
              day.value === date ? 'border-primary bg-blue-50 text-primary-strong' : 'border-line bg-white text-secondary hover:bg-slate-50'
            )}
          >
            {day.label}
          </button>
        ))}
      </div>

      {slots.isPending ? (
        <p className="mt-3 text-sm text-secondary" aria-busy="true">
          {dict.booking.slotsLoading}
        </p>
      ) : slots.isError ? (
        <p role="alert" className="mt-3 text-sm text-rose-700">
          {dict.booking.slotsError}
        </p>
      ) : slots.data.items.length === 0 ? (
        <p className="mt-3 rounded-[9px] border border-line bg-surface-2 p-3.5 text-sm leading-6 text-secondary">{dict.booking.slotsNone}</p>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {slots.data.items.map((slot) => (
            <button
              key={slot.start}
              type="button"
              aria-pressed={picked?.start === slot.start}
              onClick={() => setPicked(slot)}
              className={cn(
                'min-h-10 whitespace-nowrap rounded-[9px] border px-2 text-sm font-semibold tabular-nums transition-colors',
                picked?.start === slot.start ? 'border-primary bg-blue-50 text-primary-strong' : 'border-line bg-white text-navy hover:bg-slate-50'
              )}
            >
              {formatSlotTime(slot.start, tag)}
            </button>
          ))}
        </div>
      )}

      <Button
        type="button"
        size="sm"
        className="mt-3"
        disabled={picked === null || reschedule.isPending}
        onClick={() => {
          if (picked !== null) void reschedule.mutateAsync({ id: booking.id, scheduledStart: picked.start, scheduledEnd: picked.end }).catch(reportFailure);
        }}
      >
        <CalendarDays className="size-4" aria-hidden="true" />
        {reschedule.isPending ? dict.booking.working : dict.booking.rescheduleAction}
      </Button>
    </div>
  );
}

function RevisionCard({ locale, dict, booking }: { locale: Locale; dict: Dictionary; booking: Booking }) {
  const approve = useApproveRevision(locale);
  const reject = useRejectRevision(locale);
  const failed = approve.isError || reject.isError;

  return (
    <Card className="border-amber-300 bg-amber-50 p-5">
      <h2 className="flex items-center gap-2 font-semibold text-navy">
        <Info className="size-4 text-amber-600" aria-hidden="true" />
        {dict.booking.revisionTitle}
      </h2>
      <p className="mt-2 text-sm leading-6 text-amber-900">{dict.booking.revisionText}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={approve.isPending || reject.isPending} onClick={() => void approve.mutateAsync(booking.id).catch(reportFailure)}>
          {dict.booking.revisionApprove}
        </Button>
        <Button type="button" variant="secondary" size="sm" disabled={approve.isPending || reject.isPending} onClick={() => void reject.mutateAsync(booking.id).catch(reportFailure)}>
          {dict.booking.revisionReject}
        </Button>
      </div>
      {failed ? (
        <p role="alert" className="mt-3 text-sm text-rose-700">
          {dict.booking.actionFailed}
        </p>
      ) : null}
    </Card>
  );
}

/**
 * FR-EX-07, seen from the customer side: a paid job can be reopened as rework
 * while the service's warranty lasts. It shows only for a released job, because
 * the API refuses it before then and an always-visible button that 409s is
 * worse than none.
 */
function WarrantyCard({ locale, dict, booking }: { locale: Locale; dict: Dictionary; booking: Booking }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const claim = useWarrantyClaim(locale);

  /* FR-EX-07 only reopens a *released* job. Offering it earlier would produce a
     409 the customer cannot act on. */
  const released = booking.status === 'PAYMENT_RELEASED' || booking.status === 'PARTIALLY_REFUNDED' || booking.status === 'REFUNDED';
  if (!released) return null;

  return (
    <Card className="p-5">
      <h2 className="font-semibold text-navy">{dict.booking.warrantyTitle}</h2>
      <p className="mt-2 text-sm leading-6 text-secondary">{dict.booking.warrantyText}</p>

      {open ? (
        <div className="mt-3 grid gap-3">
          <div className="grid gap-2">
            <Label htmlFor="warranty-reason">{dict.booking.warrantyReasonLabel}</Label>
            <Textarea id="warranty-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder={dict.booking.warrantyReasonPlaceholder} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={reason.trim() === '' || claim.isPending} onClick={() => void claim.mutateAsync({ id: booking.id, reason: reason.trim() }).catch(reportFailure)}>
              {claim.isPending ? dict.booking.working : dict.booking.warrantySubmit}
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={claim.isPending}>
              {dict.common.cancel}
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" variant="secondary" size="sm" className="mt-3" onClick={() => setOpen(true)}>
          {dict.booking.warrantyAction}
        </Button>
      )}
      {claim.isError ? (
        <p role="alert" className="mt-3 text-sm text-rose-700">
          {dict.booking.actionFailed}
        </p>
      ) : null}
    </Card>
  );
}

/* FR-BK-03: up to five photos of the problem, and only before the job starts ’
   `ExecutionService` refuses them afterwards. The count in the copy is the
   server's limit, not a client-side guess. */
/**
 * FR-BK-03: up to five photos of the problem.
 *
 * `ExecutionService` accepts CUSTOMER_PROBLEM photos only while the booking is
 * PENDING_PAYMENT, REQUESTED or SCHEDULED ’ after the professional is under way
 * they are refused. The card is not rendered at all outside those states, so the
 * five-photo limit and the upload button never appear where they would 409.
 */
const canAttachProblemPhotos = (booking: Pick<Booking, 'status'>): boolean => booking.status === 'PENDING_PAYMENT' || booking.status === 'REQUESTED' || booking.status === 'SCHEDULED';

function ProblemPhotos({ locale, dict, bookingId, canUpload }: { locale: Locale; dict: Dictionary; bookingId: string; canUpload: boolean }) {
  const upload = useAddEvidence(locale);
  const [files, setFiles] = useState<File[]>([]);
  const [results, setResults] = useState<{ url: string }[]>([]);
  const [failed, setFailed] = useState('');
  /* One uuid per *chosen file*, generated when the file is picked and reused for
     every attempt at uploading it.

     The previous version called `crypto.randomUUID()` inside the loop, so a retry
     after a dropped connection produced a **different** key ’ and the
     `(booking_id, client_uuid)` dedupe could not recognise it, storing the photo
     twice. The comment above it claimed the opposite. The API's own rule is one
     key per user intent, not per attempt. */
  const [intent, setIntent] = useState<Record<string, string>>({});

  if (!canUpload) return null;

  const send = async (): Promise<void> => {
    setFailed('');
    const stored: { url: string }[] = [];
    for (const file of files.slice(0, MAX_PROBLEM_PHOTOS)) {
      try {
        /* The API caps evidence at `evidence.photo_max_bytes` (5 MB) and
           `evidence.photo_max_edge_px` (1600px). Compressing here rather than
           rejecting the file means a 12 MB phone photo actually uploads on a
           rural 3G connection. */
        const prepared = await prepareEvidenceImage(file);
        if (prepared.rejected !== undefined) {
          setFailed(prepared.rejected);
          break;
        }
        const result = await upload.mutateAsync({
          id: bookingId,
          payload: {
            clientUuid: intent[file.name + file.size] ?? crypto.randomUUID(),
            kind: 'CUSTOMER_PROBLEM',
            contentType: prepared.contentType,
            contentBase64: prepared.base64
          }
        });
        stored.push({ url: result.url });
      } catch (error) {
        setFailed(error instanceof Error ? error.message : dict.booking.photoFailed);
        break;
      }
    }
    setResults(stored);
    /* The selection is deliberately kept on failure: the whole point of a stable
       clientUuid is that the customer can press Upload again, and clearing the
       list would throw away the files they had already chosen. */
    if (stored.length === files.length) setFiles([]);
  };

  return (
    <Card className="p-5">
      <h2 className="flex items-center gap-2 font-semibold text-navy">
        <ImageIcon className="size-4 text-muted" aria-hidden="true" />
        {dict.booking.photosTitle}
      </h2>
      <p className="mt-2 text-sm leading-6 text-secondary">{dict.booking.photosText}</p>

      {results.length > 0 ? (
        <ul className="mt-3 grid grid-cols-3 gap-2">
          {results.map((item) => (
            <li key={item.url} className="relative aspect-square overflow-hidden rounded-[9px] bg-slate-100">
              {/* eslint-disable-next-line @next/next/no-img-element -- a dev-storage object URL, not a static asset, and next/image would need a configured loader for it */}
              <img src={item.url} alt="" className="size-full object-cover" />
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-3 grid gap-2">
        <Label htmlFor="problem-photos">{dict.booking.photosChoose}</Label>
        <input
          id="problem-photos"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="text-sm text-secondary"
          onChange={(event) => {
            const chosen = Array.from(event.target.files ?? []).slice(0, MAX_PROBLEM_PHOTOS);
            /* Mint the intent key here, at selection time, so every later attempt
               at the same file reuses it. */
            setIntent((previous) => {
              const next = { ...previous };
              for (const file of chosen) {
                const key = file.name + file.size;
                next[key] ??= crypto.randomUUID();
              }
              return next;
            });
            setFiles(chosen);
          }}
        />
        <p className="text-xs text-muted">{dict.booking.photosCount}</p>
      </div>

      {files.length > 0 ? (
        <Button type="button" size="sm" className="mt-3" disabled={upload.isPending} onClick={() => void send()}>
          {upload.isPending ? dict.booking.working : dict.booking.photosUpload}
        </Button>
      ) : null}
      {failed !== '' ? (
        <p role="alert" className="mt-3 text-sm text-rose-700">
          {failed}
        </p>
      ) : null}
    </Card>
  );
}
