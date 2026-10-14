'use client';

import { AlertTriangle, ArrowRight, Camera, CheckCircle2, CircleDollarSign, ClipboardList, Clock3, LogIn, LogOut, MapPin, Navigation, PhoneCall, TrendingUp, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Button, Card, FileInput, Input, Label, PageHeader, Textarea } from '@/components/ui';
import { useAllServices } from '@/features/catalogue/queries';
import { BookingInvoiceCard, InvoiceDownload, isInvoiceReady } from '@/features/booking/invoice-download';
import {
  useAcceptBooking,
  useAddEvidence,
  useBooking,
  useCancelBooking,
  useCashReceived,
  useChecklist,
  useCompleteBooking,
  useCreateRevision,
  useDeclineBooking,
  useDepartBooking,
  useEvidenceList,
  useMarkChecklistDone,
  useOnBehalfContact,
  useReportNoShow,
  useServiceAddress,
  useStartBooking
} from '@/features/booking/queries';
import type { Booking, BookingStatus, Evidence, EvidenceKind } from '@/features/booking/api';
import { prepareEvidenceImage } from '@/features/uploads/image';
import { EvidenceImage, mediaLabels } from '@/components/evidence-image';
import { BookingChat } from '@/features/booking/booking-chat';
import type { Dictionary } from '@/lib/dictionaries';
import { ApiError } from '@/lib/api/problem';
import { cn, formatDateTime, formatMoney, type Locale } from '@/lib/utils';

/* One job, for the professional who has it.
 *
 * The previous version of this screen kept the whole job in `useState` — a
 * `stage` index, `beforePhotos`, `ticked`, `collected`, `rejected` — and compared
 * the start code against a literal `"482913"`. Every one of those was a local
 * fiction: reload the page and the job appeared to reset, and the code was a
 * constant anyone could read.
 *
 * **The server owns the state machine.** This screen derives everything from
 * `booking.status` and offers exactly the actions that are legal from there. The
 * status set is:
 *
 *   REQUESTED → SCHEDULED → EN_ROUTE → IN_PROGRESS ⇄ QUOTE_REVISION
 *             → WORK_COMPLETED → AWAITING_VERIFICATION → VERIFIED
 *             → PAYMENT_RELEASED
 *
 * with UNFULFILLED, CANCELLED_CUSTOMER, CANCELLED_PROVIDER, NO_SHOW, REFUNDED and
 * CLOSED off to the side. Anything illegal is a 409 ILLEGAL_TRANSITION, and the
 * server's own sentence is shown rather than a paraphrase.
 *
 * The address and the checklist both used to be on the list of things this screen
 * would not do, because no provider-reachable route returned them. Two routes have
 * since been added, and both are provider-reachable:
 *
 *   • `GET /bookings/:id/service-address` — the address, opened once the job has
 *     left REQUESTED. Before acceptance the server withholds it, so the screen asks
 *     only when it is allowed to and does not fetch it while the job is still an
 *     open offer.
 *   • `GET /bookings/:id/checklist` — the steps with the `itemId` that
 *     `POST /bookings/:id/checklist/:itemId/done` needs, plus each step's own
 *     `evidenceId` for the ones that require a photo.
 *
 * One thing this screen still deliberately does **not** do, because no endpoint
 * should support it:
 *
 * **It has no start code.** The 6-digit code was texted to the customer when the
 * job was accepted. It is never returned by any endpoint — correctly. The provider
 * types what the customer reads out, and this screen never compares it against a
 * constant in the bundle.
 */

/** What is still open, in the order the professional meets it. */
type Step = { key: string; label: string; done: boolean };

/** Statuses from which no further action is offered — the job is settled. */
const TERMINAL: ReadonlySet<BookingStatus> = new Set<BookingStatus>(['UNFULFILLED', 'CANCELLED_CUSTOMER', 'CANCELLED_PROVIDER', 'NO_SHOW', 'REFUNDED', 'PARTIALLY_REFUNDED', 'CLOSED']);

export function ProviderJobScreen({ locale, bookingId, dict }: { locale: Locale; bookingId: string; dict: Dictionary }) {
  const booking = useBooking(bookingId, locale);
  const services = useAllServices(locale);
  const evidence = useEvidenceList(bookingId, locale);
  const contact = useOnBehalfContact(bookingId, locale);

  const accept = useAcceptBooking(locale);
  const decline = useDeclineBooking(locale);
  const depart = useDepartBooking(locale);
  const start = useStartBooking(locale);
  const complete = useCompleteBooking(locale);
  const cashReceived = useCashReceived(locale);
  const raiseRevision = useCreateRevision(locale);
  const addEvidence = useAddEvidence(locale);

  const [otp, setOtp] = useState('');
  const [finalAmount, setFinalAmount] = useState('');
  const [revision, setRevision] = useState({ reason: '', delta: '' });
  const [localError, setLocalError] = useState('');
  const [busy, setBusy] = useState(false);

  const row = booking.data;

  /** The service behind `serviceId`, by real lookup — never a mock catalogue. */
  const service = useMemo(() => services.data?.items.find((entry) => entry.id === row?.serviceId), [services.data, row?.serviceId]);

  /**
   * What the completion gate can actually check from the provider's side.
   *
   * `POST /bookings/:id/complete` needs a BEFORE and an AFTER photo on file, and
   * the server stamps the time — so `receivedAt` is the authority, not the device
   * clock. It also needs every checklist step done, which `ChecklistCard` now shows
   * and ticks; the photos half of the gate is what gates the button itself.
   */
  const photos = useMemo(() => evidence.data?.items ?? [], [evidence.data]);
  const hasBefore = photos.some((photo) => photo.kind === 'BEFORE');
  const hasAfter = photos.some((photo) => photo.kind === 'AFTER');

  const steps: Step[] = row === undefined ? [] : buildSteps(row, dict, { hasBefore, hasAfter });

  /**
   * Runs one action and surfaces the server's refusal verbatim.
   *
   * Every one of these can legitimately 409 — another party moved the booking, the
   * slot went, the code expired — and the server's sentence names the reason
   * precisely. Replacing it with "something went wrong" would throw away the only
   * useful information in the response.
   */
  const attempt = async (perform: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    setLocalError('');
    try {
      await perform();
    } catch (error) {
      const msg = error instanceof Error ? error.message : dict.job.actionFailed;
      setLocalError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const submitStart = async (): Promise<void> => {
    const code = otp.trim();
    if (!/^\d{6}$/.test(code)) {
      setLocalError(dict.job.otpSixDigits);
      toast.error(dict.job.otpSixDigits);
      return;
    }
    await attempt(async () => {
      await start.mutateAsync({ id: bookingId, code });
      setOtp('');
    });
  };

  const submitComplete = async (): Promise<void> => {
    const typed = finalAmount.trim();
    const paisa = typed === '' ? undefined : Math.round(Number(typed) * 100);
    if (paisa !== undefined && (!Number.isFinite(paisa) || paisa < 0)) {
      setLocalError(dict.job.finalAmountInvalid);
      toast.error(dict.job.finalAmountInvalid);
      return;
    }
    await attempt(async () => {
      await complete.mutateAsync({
        id: bookingId,
        ...(paisa === undefined ? {} : { finalAmountPaisa: paisa })
      });
    });
  };

  const submitRevision = async (): Promise<void> => {
    const delta = Math.round(Number(revision.delta) * 100);
    if (revision.reason.trim() === '' || !Number.isFinite(delta) || delta <= 0) {
      setLocalError(dict.job.revisionIncomplete);
      toast.error(dict.job.revisionIncomplete);
      return;
    }
    await attempt(async () => {
      await raiseRevision.mutateAsync({ id: bookingId, deltaPaisa: delta, reason: revision.reason.trim() });
      setRevision({ reason: '', delta: '' });
    });
  };

  /**
   * One photo, downscaled, with a `clientUuid` minted when the file is chosen.
   *
   * The uuid is the retry story: `POST /bookings/:id/evidence` stores a given
   * `clientUuid` once and returns the original with `duplicate: true` on the second
   * attempt. Minting a fresh one per attempt — as an earlier version did — would
   * leave an orphan photo per retry on insert-only evidence that can never be
   * deleted. `receivedAt` is the server's, so a retried upload is not double-counted
   * against the completion gate.
   *
   * `prepareEvidenceImage` does the downscaling and returns either a base64 payload
   * or a `rejected` sentence for a file it cannot get under the limit. Taking its
   * `rejected` branch at face value is deliberate: it has already tried resizing and
   * re-encoding, so there is nothing left to attempt here.
   *
   * A BEFORE or AFTER photo is only that. It is not re-filed as CHECKLIST evidence
   * and does not tick a step: guessing which step a photo belongs to from label
   * keywords or position recorded steps the professional never did. Steps are
   * ticked one by one in `ChecklistCard`, each with its own photo.
   */
  const attachPhoto = async (file: File, kind: EvidenceKind, checklistItemId?: number): Promise<void> => {
    setBusy(true);
    const clientUuid = crypto.randomUUID();
    try {
      const prepared = await prepareEvidenceImage(file);
      if (prepared.rejected !== undefined) {
        toast.error(prepared.rejected);
        return;
      }
      await addEvidence.mutateAsync({
        id: bookingId,
        payload: {
          kind,
          clientUuid,
          contentType: prepared.contentType,
          contentBase64: prepared.base64,
          ...(checklistItemId === undefined ? {} : { checklistItemId })
        }
      });
      toast.success(locale === 'ur' ? 'تصویر کامیابی سے محفوظ ہو گئی' : 'Photo recorded successfully');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : (locale === 'ur' ? 'تصویر محفوظ کرنے میں مسئلہ پیش آیا' : 'Failed to record photo'));
    } finally {
      setBusy(false);
    }
  };

  if (booking.isPending) {
    return (
      <div aria-busy="true" aria-live="polite" className="grid gap-3">
        <span className="skeleton h-8 w-56 rounded-[9px]" />
        <span className="skeleton h-64 w-full rounded-[12px]" />
      </div>
    );
  }

  if (booking.isError) {
    /* `getOwned` 404s both "does not exist" and "not yours", so the screen must not
       claim it is the latter — the API deliberately hides existence from non-owners. */
    return (
      <div>
        <PageHeader eyebrow={dict.portal.provider} title={dict.job.title} />
        <div role="alert" className="mt-6 rounded-[14px] border border-rose-200 bg-rose-50 p-5">
          <p className="text-sm font-medium leading-6 text-rose-800">{dict.job.notFound}</p>
          <Button type="button" variant="secondary" size="sm" className="mt-4" onClick={() => void booking.refetch()}>
            {dict.catalogue.retry}
          </Button>
        </div>
      </div>
    );
  }

  /* `isPending` and `isError` are both false only once the row has landed, so this
     is a real narrowing rather than a hopeful assertion — TypeScript cannot infer it
     from the two flags on their own. */
  if (row === undefined) {
    return (
      <div aria-busy="true" aria-live="polite" className="grid gap-3">
        <span className="skeleton h-8 w-56 rounded-[9px]" />
        <span className="skeleton h-64 w-full rounded-[12px]" />
      </div>
    );
  }

  const current: Booking = row;
  const pending = busy || accept.isPending || decline.isPending || depart.isPending || start.isPending || complete.isPending;
  const serviceName = service === undefined ? dict.job.serviceUnknown : locale === 'ur' ? service.nameUr : service.nameEn;

  return (
    <div>
      <PageHeader eyebrow={dict.portal.provider} title={serviceName} description={dict.job.codeLabel.replace('{code}', current.code)} action={<StatusPill status={current.status} dict={dict} />} />

      {localError !== '' ? <span className="sr-only" role="status">{localError}</span> : null}

      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="grid gap-5">
          {/* Where it stands, as a track. Each tick is a fact from the row, not a
              step counter the screen is keeping for itself. */}
          <Card className="p-6">
            <h2 className="font-semibold text-navy">{dict.job.progressTitle}</h2>
            <ol className="mt-4 grid gap-2">
              {steps.map((step) => (
                <li key={step.key} className="flex items-center gap-3">
                  <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-full', step.done ? 'bg-emerald-100 text-emerald-700' : 'bg-surface-2 text-muted')} aria-hidden="true">
                    {step.done ? <CheckCircle2 className="size-4" /> : <Clock3 className="size-3.5" />}
                  </span>
                  <span className={cn('text-sm', step.done ? 'text-navy' : 'text-muted')}>
                    {step.label}
                    <span className="sr-only">{step.done ? ` — ${dict.job.stepDone}` : ` — ${dict.job.stepWaiting}`}</span>
                  </span>
                </li>
              ))}
            </ol>
          </Card>

          {/* What the customer actually asked for. */}
          <Card className="p-6">
            <h2 className="font-semibold text-navy">{dict.job.detailsTitle}</h2>
            <dl className="mt-4 grid gap-3 text-sm">
              <Row label={dict.job.whenLabel} value={formatDateTime(current.scheduledStart, locale)} />
              <Row label={dict.job.endsLabel} value={formatDateTime(current.scheduledEnd, locale)} />
              <Row label={dict.job.paymentLabel} value={dict.job.paymentModes[current.paymentMode]} />
              <Row label={dict.job.approvedLabel} value={formatMoney(current.approvedTotalPaisa, locale)} />
              {current.discountPaisa > 0 ? <Row label={dict.job.discountLabel} value={`− ${formatMoney(current.discountPaisa, locale)}`} /> : null}
              {current.finalAmountPaisa !== null ? <Row label={dict.job.finalAmountLabel} value={formatMoney(current.finalAmountPaisa, locale)} /> : null}
              {current.isEmergency ? <Row label={dict.job.emergencyLabel} value={dict.common.yes} /> : null}
            </dl>

            {current.problemText !== null && current.problemText !== '' ? (
              <div className="mt-4 border-t border-line pt-4">
                <p className="text-xs font-medium text-muted">{dict.job.problemLabel}</p>
                <p className="mt-1.5 text-sm leading-6 text-secondary">{current.problemText}</p>
              </div>
            ) : null}

            {current.cancelReason !== null && current.cancelReason !== '' ? (
              <p className="mt-4 rounded-[9px] bg-surface-2 p-3 text-sm leading-6 text-secondary">
                {dict.job.cancelReasonLabel}: {current.cancelReason}
              </p>
            ) : null}
          </Card>

          <PhotosCard locale={locale} dict={dict} bookingId={current.id} status={current.status} photos={photos} loading={evidence.isPending} pending={pending} onAttach={attachPhoto} />

          {/*
            The checklist, read from `GET /bookings/:id/checklist`.

            This panel used to say the steps could not be shown at all, on the
            grounds that nothing published them or their `itemId` — while this same
            screen already had `POST /bookings/:id/checklist/:itemId` wired, so it
            could tick a step whose id it had no way to learn. The reader exists now:
            every step carries its own `itemId`, and `outstanding` is the same count
            `complete` refuses on, so the list and the 409 cannot disagree.

            It is shown once the job is under way. Before that the steps are not
            actionable, and an un-actionable list of four ticks on a job that has
            not started is just noise.
          */}
          {current.status === 'IN_PROGRESS' || current.status === 'WORK_COMPLETED' || current.status === 'AWAITING_VERIFICATION' ? (
            <ChecklistCard locale={locale} dict={dict} bookingId={current.id} canTick={current.status === 'IN_PROGRESS'} />
          ) : null}

          {isInvoiceReady(current.status) ? (
            <BookingInvoiceCard booking={{ ...current, serviceName }} locale={locale} dict={dict} />
          ) : null}
        </div>

        <div className="grid content-start gap-5">
          {/* Where the job is, from `GET /bookings/:id/service-address`. */}
          <AddressCard locale={locale} dict={dict} booking={current} />

          {contact.data?.contact != null ? (
            <Card className="p-6">
              <h2 className="flex items-center gap-2 font-semibold text-navy">
                <PhoneCall className="size-4 text-muted" aria-hidden="true" />
                {dict.job.whoToSee}
              </h2>
              <p className="mt-2 font-medium text-navy">{contact.data.contact.name}</p>
              <p className="mt-1 font-mono text-sm text-secondary">{contact.data.contact.phone}</p>
              {/* The masking is deliberate — a provider who has not accepted must
                  not collect contact details for jobs they may still decline. */}
              {!contact.data.contact.revealed ? <p className="mt-2 text-xs leading-5 text-muted">{dict.job.contactMaskedNote}</p> : null}
            </Card>
          ) : null}

          <ActionsCard
            locale={locale}
            booking={current}
            dict={dict}
            pending={pending}
            otp={otp}
            setOtp={setOtp}
            finalAmount={finalAmount}
            setFinalAmount={setFinalAmount}
            revision={revision}
            setRevision={setRevision}
            hasBefore={hasBefore}
            hasAfter={hasAfter}
            onAccept={() => void attempt(() => accept.mutateAsync(current.id))}
            onDecline={() => void attempt(() => decline.mutateAsync(current.id))}
            onDepart={() => void attempt(() => depart.mutateAsync(current.id))}
            onStart={() => void submitStart()}
            onComplete={() => void submitComplete()}
            onCash={() => void attempt(() => cashReceived.mutateAsync(current.id))}
            onRevision={() => void submitRevision()}
          />

          {/* Live customer communication for this job */}
          <BookingChat locale={locale} dict={dict} booking={current} />
        </div>
      </div>
    </div>
  );
}

/* ---- The track ----------------------------------------------------------
   Derived entirely from the booking row. `requestAccepted` is `status !==
   REQUESTED`, which is true for every later state including the terminal ones —
   a cancelled job was still accepted, and pretending otherwise would be a small
   lie about what happened. */

function buildSteps(booking: Booking, dict: Dictionary, photos: { hasBefore: boolean; hasAfter: boolean }): Step[] {
  /* Every step below is a fact read off the booking row or the photo list. The
     previous version kept a `stage` counter in `useState`, which meant the screen
     disagreed with the server after any refetch, and reset entirely on reload. */
  const started = ['IN_PROGRESS', 'QUOTE_REVISION', 'WORK_COMPLETED', 'AWAITING_VERIFICATION', 'VERIFIED', 'AUTO_RELEASED', 'PAYMENT_RELEASED', 'PARTIALLY_REFUNDED', 'CLOSED'].includes(booking.status);
  const completed = ['WORK_COMPLETED', 'AWAITING_VERIFICATION', 'VERIFIED', 'AUTO_RELEASED', 'PAYMENT_RELEASED', 'PARTIALLY_REFUNDED', 'CLOSED'].includes(booking.status);
  return [
    { key: 'accept', label: dict.job.stepAccept, done: booking.status !== 'REQUESTED' },
    { key: 'arrive', label: dict.job.stepArrive, done: started || booking.status === 'EN_ROUTE' },
    { key: 'start', label: dict.job.stepStart, done: started },
    { key: 'before', label: dict.job.stepBefore, done: photos.hasBefore },
    { key: 'after', label: dict.job.stepAfter, done: photos.hasAfter },
    { key: 'complete', label: dict.job.stepComplete, done: completed }
  ];
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-2 last:border-0">
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium text-navy">{value}</dd>
    </div>
  );
}

const STATUS_TONE: Partial<Record<BookingStatus, string>> = {
  REQUESTED: 'bg-blue-50 text-primary-strong',
  SCHEDULED: 'bg-blue-50 text-primary-strong',
  EN_ROUTE: 'bg-amber-50 text-amber-800',
  IN_PROGRESS: 'bg-amber-50 text-amber-800',
  QUOTE_REVISION: 'bg-violet-50 text-violet-800',
  WORK_COMPLETED: 'bg-emerald-50 text-emerald-700',
  AWAITING_VERIFICATION: 'bg-teal-50 text-teal-800',
  VERIFIED: 'bg-emerald-50 text-emerald-700',
  AUTO_RELEASED: 'bg-emerald-50 text-emerald-700',
  PAYMENT_RELEASED: 'bg-emerald-50 text-emerald-700',
  CANCELLED_CUSTOMER: 'bg-rose-50 text-rose-700',
  CANCELLED_PROVIDER: 'bg-rose-50 text-rose-700',
  UNFULFILLED: 'bg-slate-100 text-slate-700',
  NO_SHOW: 'bg-rose-50 text-rose-700'
};

function StatusPill({ status, dict }: { status: BookingStatus; dict: Dictionary }) {
  return <span className={cn('rounded-full px-3 py-1 text-xs font-semibold', STATUS_TONE[status] ?? 'bg-slate-100 text-slate-700')}>{dict.job.statuses[status]}</span>;
}

/* ---- Address ---------------------------------------------------------------
   `GET /bookings/:id/service-address`.

   The booking row carries only an `addressId`, and that is deliberate: every
   provider-facing endpoint returns the row, so an address on it would travel with
   the offer list before anyone had committed to the job. This dedicated route is
   the way out, and it opens only once the job has left REQUESTED — so the screen
   asks for it exactly then, and a provider still deciding is told why it is not
   shown rather than shown a blank. */

function AddressCard({ locale, dict, booking }: { locale: Locale; dict: Dictionary; booking: Booking }) {
  const available = booking.status !== 'REQUESTED';
  const address = useServiceAddress(booking.id, available, locale);

  if (!available) {
    return (
      <Card className="border-dashed p-6">
        <h2 className="flex items-center gap-2 font-semibold text-navy">
          <MapPin className="size-4 text-muted" aria-hidden="true" />
          {dict.job.addressTitle}
        </h2>
        <p className="mt-2 text-sm leading-6 text-secondary">{dict.job.addressPendingAcceptText}</p>
      </Card>
    );
  }

  if (address.isPending) {
    return (
      <Card className="p-6" aria-busy="true">
        <span className="skeleton block h-5 w-32 rounded-[9px]" />
        <span className="skeleton mt-3 block h-4 w-full max-w-xs rounded-[9px]" />
      </Card>
    );
  }

  if (address.isError || address.data === null) {
    /* A 404 here is the API withholding the address, not a failure to report. */
    return (
      <Card className="border-dashed p-6">
        <h2 className="flex items-center gap-2 font-semibold text-navy">
          <MapPin className="size-4 text-muted" aria-hidden="true" />
          {dict.job.addressTitle}
        </h2>
        <p className="mt-2 text-sm leading-6 text-secondary">{dict.job.addressUnavailableText}</p>
        <p className="mt-3 text-xs leading-5 text-muted">{dict.job.addressReference.replace('{id}', booking.addressId)}</p>
      </Card>
    );
  }

  const place = address.data;
  const lines = [place.line1, place.line2].filter((line): line is string => line !== null && line !== '');

  return (
    <Card className="p-6">
      <h2 className="flex items-center gap-2 font-semibold text-navy">
        <MapPin className="size-4 text-muted" aria-hidden="true" />
        {dict.job.addressTitle}
      </h2>
      {place.label !== null ? <p className="mt-3 font-medium text-navy">{place.label}</p> : null}
      {lines.length > 0 ? (
        <address className="mt-1 text-sm not-italic leading-6 text-secondary">
          {lines.map((line) => (
            <span key={line} className="block">{line}</span>
          ))}
        </address>
      ) : null}
      {place.areaName !== null ? <p className="mt-1 text-sm leading-6 text-secondary">{place.areaName}</p> : null}
      {place.lat !== null && place.lng !== null ? (
        <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
          <span className="text-muted font-mono">
            {place.lat.toFixed(5)}, {place.lng.toFixed(5)}
          </span>
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lng}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 font-semibold text-primary hover:underline"
          >
            <Navigation className="size-3.5" aria-hidden="true" />
            {locale === "ur" ? "گوگل میپس میں کھولیں" : "Open in Google Maps"}
          </a>
        </div>
      ) : null}
    </Card>
  );
}

/* ---- Checklist -------------------------------------------------------------
   `GET /bookings/:id/checklist` plus `POST /bookings/:id/checklist/:itemId`.

   A step that `requiresPhoto` needs the `evidenceId` of a CHECKLIST photo already
   uploaded for that step, or the server answers 422. That photo has to be chosen
   here rather than derived, because the evidence list is keyed by kind and two
   photo steps would otherwise be indistinguishable from each other. */

function ChecklistCard({ locale, dict, bookingId, canTick }: { locale: Locale; dict: Dictionary; bookingId: string; canTick: boolean }) {
  const checklist = useChecklist(bookingId, locale);
  const mark = useMarkChecklistDone(locale);
  const addEvidence = useAddEvidence(locale);
  const evidence = useEvidenceList(bookingId, locale);
  const [photoFor, setPhotoFor] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /* Only photos taken against a specific step can satisfy a photo step, so this
     filters on `checklistItemId` rather than on kind alone. */
  const checklistPhotos = (evidence.data?.items ?? []).filter((photo) => photo.kind === 'CHECKLIST');

  /* Prepare, store, then tick — in that order, because the tick is only accepted
     with the `evidenceId` the upload just produced. Reversed, the first attempt
     422s and leaves an orphan photo behind. */
  const uploadFor = async (itemId: number, file: File): Promise<void> => {
    setError(null);
    setBusy(true);
    const clientUuid = crypto.randomUUID();
    try {
      const prepared = await prepareEvidenceImage(file);
      if (prepared.rejected !== undefined) {
        toast.error(prepared.rejected);
        setError(prepared.rejected);
        return;
      }
      const added = await addEvidence.mutateAsync({
        id: bookingId,
        payload: { kind: 'CHECKLIST', clientUuid, checklistItemId: itemId, contentType: prepared.contentType, contentBase64: prepared.base64 }
      });
      await mark.mutateAsync({ id: bookingId, itemId, evidenceId: added.id });

      setPhotoFor(null);
      toast.success(locale === 'ur' ? 'تصویر کامیابی سے محفوظ ہو گئی' : 'Photo recorded successfully');
    } catch (caught) {
      const msg = caught instanceof Error && caught.message !== '' ? caught.message : dict.job.checklistPhotoFailed;
      toast.error(msg);
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  if (checklist.isPending) {
    return (
      <Card className="p-6" aria-busy="true">
        <span className="skeleton block h-5 w-48 rounded-[9px]" />
        <span className="skeleton mt-4 block h-6 w-full rounded-[9px]" />
        <span className="skeleton mt-2 block h-6 w-4/5 rounded-[9px]" />
      </Card>
    );
  }

  /* Ordered by `position` rather than by whatever order the response arrived in —
     a checklist is a sequence, and the sequence is a field on each item. */
  const items = [...(checklist.data?.items ?? [])].sort((a, b) => a.position - b.position);

  if (items.length === 0) {
    return (
      <Card className="p-6">
        <h2 className="flex items-center gap-2 font-semibold text-navy">
          <ClipboardList className="size-4 text-muted" aria-hidden="true" />
          {dict.job.checklistTitle}
        </h2>
        <p className="mt-2 text-sm leading-6 text-secondary">{dict.job.checklistEmpty}</p>
      </Card>
    );
  }

  const outstanding = checklist.data?.outstanding ?? 0;

  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-semibold text-navy">
          <ClipboardList className="size-4 text-muted" aria-hidden="true" />
          {dict.job.checklistTitle}
        </h2>
        {/* The server's own count, which is what `complete` will check. */}
        {outstanding > 0 ? (
          <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
            {dict.job.checklistRemaining.replace('{count}', String(outstanding))}
          </span>
        ) : (
          <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
            {dict.job.checklistAllDone}
          </span>
        )}
      </div>

      <ol className="mt-4 grid gap-2">
        {items.map((item) => {
          const label = locale === 'ur' ? item.labelUr : item.labelEn;
          /* A photo already uploaded against this step. Its id is what the tick
             needs, and finding it here is what stops the provider being asked for
             a second, identical photograph. */
          const onFile = checklistPhotos.find((photo) => photo.checklistItemId === item.itemId);
          return (
            <li key={item.itemId} className="rounded-[10px] border border-line p-3">
              <div className="flex items-start gap-3">
                <button
                  type="button"
                  disabled={!canTick || item.done || mark.isPending}
                  onClick={() => void mark.mutateAsync({ id: bookingId, itemId: item.itemId, evidenceId: onFile?.id }).catch(() => setError(dict.job.checklistStepFailed))}
                  aria-pressed={item.done}
                  className={cn(
                    'mt-0.5 grid size-6 shrink-0 place-items-center rounded-[7px] border transition',
                    item.done
                      ? 'border-emerald-600 bg-emerald-600 text-white'
                      : canTick
                        ? 'border-line hover:border-primary'
                        : 'border-line opacity-60'
                  )}
                >
                  {item.done ? <CheckCircle2 className="size-4" aria-hidden="true" /> : null}
                  <span className="sr-only">{item.done ? dict.job.checklistDone : dict.job.checklistTick}</span>
                </button>
                <div className="min-w-0 flex-1">
                  <p className={cn('text-sm leading-6', item.done ? 'text-secondary line-through' : 'font-medium text-navy')}>
                    <span className="me-1.5 font-mono text-xs text-muted tabular-nums">{item.position}.</span>
                    {label}
                  </p>
                  {item.requiresPhoto && !item.done ? (
                    <p className="mt-1 text-xs text-muted">{dict.job.checklistNeedsPhoto}</p>
                  ) : null}
                </div>
              </div>

              {/* A photo step: the evidence has to exist before the step can be
                  ticked, so the button and the evidence are the same control. With
                  a photo already on file the tick button above is enough, so no
                  second picker is offered. */}
              {item.requiresPhoto && !item.done && canTick ? (
                <div className="mt-2 ps-9">
                  {onFile ? (
                    <p className="text-xs text-muted">{dict.job.checklistPhotoOnFile}</p>
                  ) : photoFor === item.itemId ? (
                    <PhotoPicker
                      id={`checklist-photo-${item.itemId}`}
                      label={dict.job.checklistPhotoLabel}
                      chooseLabel={dict.common.chooseFile}
                      selectedLabel={dict.common.chosenFile}
                      disabled={busy || mark.isPending}
                      onPick={(file) => void uploadFor(item.itemId, file)}
                    />
                  ) : (
                    <Button type="button" variant="secondary" size="sm" onClick={() => setPhotoFor(item.itemId)}>
                      <Camera className="size-4" aria-hidden="true" />
                      {dict.job.checklistPhotoLabel}
                    </Button>
                  )}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>

      {error ? <p role="alert" className="mt-4 rounded-[9px] bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
    </Card>
  );
}

/* ---- Photos --------------------------------------------------------------
   Insert-only, and the only photos the API will let a provider record are BEFORE,
   AFTER and CHECKLIST. A photo can never be edited or deleted, so the two the
   completion gate needs are added before the job is finished — not after. */

function PhotosCard({
  locale,
  dict,
  bookingId,
  status,
  photos,
  loading,
  pending,
  onAttach
}: {
  locale: Locale;
  dict: Dictionary;
  bookingId: string;
  status: BookingStatus;
  photos: Evidence[];
  loading: boolean;
  pending: boolean;
  onAttach: (file: File, kind: EvidenceKind) => Promise<void>;
}) {
  const mine = photos.filter((photo) => photo.kind !== 'CUSTOMER_PROBLEM');
  /* `POST /bookings/:id/evidence` accepts a provider's photos only while the job
     is IN_PROGRESS or QUOTE_REVISION (`PROVIDER_EVIDENCE_STATUSES` in
     execution.service.ts). A picker shown EN_ROUTE was a guaranteed 409, so the
     BEFORE photo is taken once the start code has opened the job. */
  const canTakePhotos = status === 'IN_PROGRESS' || status === 'QUOTE_REVISION';

  return (
    <Card className="p-6">
      <h2 className="flex items-center gap-2 font-semibold text-navy">
        <Camera className="size-4 text-muted" aria-hidden="true" />
        {dict.job.photosTitle}
      </h2>
      <p className="mt-2 text-sm leading-6 text-secondary">{dict.job.photosText}</p>

      {loading ? (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {[0, 1].map((index) => (
            <span key={index} className="skeleton aspect-4/3 w-full rounded-[10px]" />
          ))}
        </div>
      ) : mine.length === 0 ? (
        <p className="mt-4 rounded-[9px] border border-line bg-surface-2 p-4 text-sm text-secondary">{dict.job.noPhotos}</p>
      ) : (
        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {mine.map((photo) => (
            <li key={photo.id} className="overflow-hidden rounded-[10px] border border-line">
              {/* Signed, short-lived object-store URLs in production, which next/image's
                  loader has nothing to optimise; `EvidenceImage` also unwraps the
                  mock storage's JSON envelope in development. */}
              <EvidenceImage url={photo.url} contentType={photo.contentType} alt={dict.job.photoAlt.replace('{kind}', dict.job.photoKinds[photo.kind])} className="aspect-4/3 w-full" labels={mediaLabels(dict)} />
              <p className="px-2.5 py-2 text-xs text-muted">
                {dict.job.photoKinds[photo.kind]} · {formatDateTime(photo.receivedAt, locale)}
              </p>
            </li>
          ))}
        </ul>
      )}

      {canTakePhotos ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <PhotoPicker id={`before-${bookingId}`} label={dict.job.addBeforePhoto} chooseLabel={dict.common.chooseFile} selectedLabel={dict.common.chosenFile} disabled={pending} onPick={(file) => void onAttach(file, 'BEFORE')} />
          <PhotoPicker id={`after-${bookingId}`} label={dict.job.addAfterPhoto} chooseLabel={dict.common.chooseFile} selectedLabel={dict.common.chosenFile} disabled={pending} onPick={(file) => void onAttach(file, 'AFTER')} />
        </div>
      ) : null}
    </Card>
  );
}

function PhotoPicker({ id, label, disabled, chooseLabel, selectedLabel, onPick }: { id: string; label: string; disabled: boolean; chooseLabel: string; selectedLabel: string; onPick: (file: File) => void }) {
  return (
    <FileInput
      id={id}
      label={label}
      accept="image/jpeg,image/png,image/webp"
      disabled={disabled}
      chooseLabel={chooseLabel}
      selectedLabel={selectedLabel}
      onPick={(chosen) => {
        const file = chosen[0];
        if (file !== undefined) onPick(file);
      }}
    />
  );
}

/* ---- What can be done ---------------------------------------------------
   One card per status, offering only what the server will accept from it. Every
   other action from that state is a 409, and offering it would be teaching the
   professional to expect an error. */

function ActionsCard({
  locale,
  booking,
  dict,
  pending,
  otp,
  setOtp,
  finalAmount,
  setFinalAmount,
  revision,
  setRevision,
  hasBefore,
  hasAfter,
  onAccept,
  onDecline,
  onDepart,
  onStart,
  onComplete,
  onCash,
  onRevision
}: {
  locale: Locale;
  booking: Booking;
  dict: Dictionary;
  pending: boolean;
  otp: string;
  setOtp: (value: string) => void;
  finalAmount: string;
  setFinalAmount: (value: string) => void;
  revision: { reason: string; delta: string };
  setRevision: (value: { reason: string; delta: string }) => void;
  hasBefore: boolean;
  hasAfter: boolean;
  onAccept: () => void;
  onDecline: () => void;
  onDepart: () => void;
  onStart: () => void;
  onComplete: () => void;
  onCash: () => void;
  onRevision: () => void;
}) {
  /* Seeded once: reading the clock in the render body is impure, and a
     half-hour threshold needs no ticker. */
  const [now] = useState(() => Date.now());

  if (TERMINAL.has(booking.status)) {
    return (
      <Card className="p-6">
        <h2 className="font-semibold text-navy">{dict.job.noActionsTitle}</h2>
        <p className="mt-2 text-sm leading-6 text-secondary">{dict.job.noActionsText}</p>
        {booking.status === 'CANCELLED_PROVIDER' && booking.cancelReason !== null ? (
          <p className="mt-3 rounded-[9px] bg-surface-2 p-3 text-sm leading-6 text-secondary">{booking.cancelReason}</p>
        ) : null}
      </Card>
    );
  }

  /* `POST /bookings/:id/complete` refuses with 409 unless a BEFORE and an AFTER photo
     are on file. That is the one gate the provider can both see and satisfy, so the
     button is gated on it. The checklist gate is separate and invisible to them
     (§3.11), which the screen says rather than hides. */
  const photosReady = hasBefore && hasAfter;
  const isTooEarly = new Date(booking.scheduledStart).getTime() > now + 30 * 60 * 1000;
  const startTooEarly = isTooEarly && booking.status === 'EN_ROUTE';

  return (
    <Card className="p-6">
      <h2 className="font-semibold text-navy">{dict.job.actionsTitle}</h2>

      {booking.status === 'IN_PROGRESS' ? <p className="mt-2 text-xs leading-5 text-muted">{photosReady ? dict.job.photosReadyNote : dict.job.photosNotReadyNote}</p> : null}

      {booking.status === 'REQUESTED' ? (
        <div className="mt-4 grid gap-3">
          <p className="text-sm leading-6 text-secondary">{dict.job.acceptExplainer}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={onAccept} disabled={pending}>
              <ArrowRight className="size-4" aria-hidden="true" />
              {dict.job.acceptJob}
            </Button>
            <Button type="button" variant="secondary" onClick={onDecline} disabled={pending}>
              <LogOut className="size-4" aria-hidden="true" />
              {dict.job.declineJob}
            </Button>
          </div>
        </div>
      ) : null}

      {booking.status === 'SCHEDULED' ? (
        <div className="mt-4 grid gap-3">
          <p className="text-sm leading-6 text-secondary">{dict.job.departExplainer}</p>
          {isTooEarly ? (
            <p className="rounded-[9px] border border-blue-200 bg-blue-50 p-3 text-xs leading-5 text-blue-900">
              {locale === 'ur'
                ? `یہ بکنگ ${formatDateTime(booking.scheduledStart, locale)} کے لیے مقرر ہے۔ آپ وقت آنے پر روانگی درج کر سکتے ہیں۔`
                : `This job is scheduled for ${formatDateTime(booking.scheduledStart, locale)}. You can mark en route once the appointment window arrives.`}
            </p>
          ) : null}
          <Button type="button" onClick={onDepart} disabled={pending || isTooEarly}>
            <LogOut className="size-4" aria-hidden="true" />
            {dict.job.markEnRoute}
          </Button>
        </div>
      ) : null}

      {/* `start` is legal from EN_ROUTE and from REWORK_REQUIRED (T12: the rework
          visit needs a fresh start code). The original slot is in the past on a
          rework, so the too-early gate only applies to a first visit. */}
      {booking.status === 'EN_ROUTE' || booking.status === 'REWORK_REQUIRED' ? (
        <div className="mt-4 grid gap-3">
          <p className="text-sm leading-6 text-secondary">{booking.status === 'REWORK_REQUIRED' ? dict.job.reworkExplainer : dict.job.otpExplainer}</p>
          {startTooEarly ? (
            <p className="rounded-[9px] border border-blue-200 bg-blue-50 p-3 text-xs leading-5 text-blue-900">
              {locale === 'ur'
                ? `یہ بکنگ ابھی کے لیے نہیں ہے۔ آپ وقت آنے پر اسٹارٹ کوڈ درج کر سکتے ہیں۔`
                : `This job cannot be started ahead of its scheduled appointment time (${formatDateTime(booking.scheduledStart, locale)}).`}
            </p>
          ) : null}
          <div className="grid gap-2">
            <Label htmlFor="start-code">{dict.job.otpLabel}</Label>
            <Input
              id="start-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={otp}
              onChange={(event) => setOtp(event.target.value.replace(/\D/g, ''))}
              placeholder="••••••"
              className="font-mono tracking-[0.4em]"
              disabled={startTooEarly}
            />
          </div>
          <Button type="button" onClick={onStart} disabled={pending || startTooEarly}>
            <LogIn className="size-4" aria-hidden="true" />
            {dict.job.startJob}
          </Button>
        </div>
      ) : null}

      {booking.status === 'SCHEDULED' || booking.status === 'EN_ROUTE' ? <ProviderExitActions locale={locale} dict={dict} booking={booking} now={now} /> : null}

      {booking.status === 'IN_PROGRESS' ? (
        <div className="mt-4 grid gap-5">
          <div className="grid gap-2">
            <div className="flex items-baseline justify-between gap-2">
              <Label htmlFor="final-amount">{dict.job.finalAmountInputLabel}</Label>
              <span className="text-xs text-muted">{formatMoney(booking.approvedTotalPaisa, locale)}</span>
            </div>
            <Input id="final-amount" inputMode="numeric" value={finalAmount} onChange={(event) => setFinalAmount(event.target.value)} placeholder={String(booking.approvedTotalPaisa / 100)} />
            <p className="text-xs leading-5 text-muted">{dict.job.finalAmountHint}</p>
          </div>

          <Button type="button" onClick={onComplete} disabled={pending || !photosReady}>
            <CheckCircle2 className="size-4" aria-hidden="true" />
            {dict.job.completeJob}
          </Button>
          {!photosReady ? (
            /* Naming the specific missing photo is the difference between a
               professional fixing the problem and guessing. */
            <p className="rounded-[9px] bg-amber-50 p-3 text-sm leading-6 text-amber-900">{!hasBefore ? dict.job.needBeforePhoto : dict.job.needAfterPhoto}</p>
          ) : null}

          <div className="border-t border-line pt-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-navy">
              <TrendingUp className="size-3.5 text-muted" aria-hidden="true" />
              {dict.job.revisionTitle}
            </h3>
            <p className="mt-1.5 text-xs leading-5 text-muted">{dict.job.revisionText}</p>
            <div className="mt-3 grid gap-2">
              <div className="grid gap-2">
                <Label htmlFor="revision-reason">{dict.job.revisionReasonLabel}</Label>
                <Textarea
                  id="revision-reason"
                  value={revision.reason}
                  onChange={(event) => setRevision({ ...revision, reason: event.target.value })}
                  placeholder={dict.job.revisionReasonPlaceholder}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="revision-delta">{dict.job.revisionDeltaLabel}</Label>
                <Input id="revision-delta" inputMode="numeric" value={revision.delta} onChange={(event) => setRevision({ ...revision, delta: event.target.value })} />
              </div>
              <div>
                <Button type="button" variant="secondary" size="sm" onClick={onRevision} disabled={pending}>
                  {dict.job.raiseRevision}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {booking.status === 'QUOTE_REVISION' ? <p className="mt-4 rounded-[9px] bg-violet-50 p-3 text-sm leading-6 text-violet-900">{dict.job.revisionPending}</p> : null}

      {(booking.status === 'WORK_COMPLETED' || booking.status === 'AWAITING_VERIFICATION' || booking.status === 'VERIFIED' || booking.status === 'AUTO_RELEASED') && booking.paymentMode === 'CASH' ? (
        <div className="mt-4 grid gap-3">
          <p className="text-sm leading-6 text-secondary">{dict.job.cashExplainer}</p>
          {booking.status === 'AUTO_RELEASED' ? (
            <p className="rounded-[6px] border border-emerald-200 bg-emerald-50 p-2.5 text-xs leading-5 text-emerald-800">
              {dict.job.cashAutoReleased}
            </p>
          ) : null}
          <Button type="button" onClick={onCash} disabled={pending || !booking.canConfirmCashReceived}>
            <CircleDollarSign className="size-4" aria-hidden="true" />
            {dict.job.cashReceived}
          </Button>
          {booking.status === 'AWAITING_VERIFICATION' ? (
            /* The API refuses this before verification has authorised collection;
               saying so beats letting a professional discover it as a 409. */
            <p className="text-xs leading-5 text-amber-800 bg-amber-50 rounded-[6px] p-2 border border-amber-200">{dict.job.cashNeedsVerification}</p>
          ) : null}
        </div>
      ) : null}

      {isInvoiceReady(booking.status) ? (
        /* This was an `<a href="/api/v1/bookings/:id/invoice.pdf">`, which cannot
           work: the route needs the bearer token and the refresh cookie is scoped
           to `/api/v1/auth`, so following it returned a 401 problem document
           rendered as JSON. `InvoiceDownload` fetches it properly. It also appears
           once the invoice actually exists rather than at the old fixed status. */
        <InvoiceDownload bookingId={booking.id} locale={locale} dict={dict} />
      ) : null}
    </Card>
  );
}

/* ---- Leaving a job ---------------------------------------------------------
   The two ways a professional can end a job before it starts:

   · `POST /bookings/:id/cancel` — legal for a provider only from SCHEDULED.
     Free in money, but cancelling inside `booking.free_cancel_hours` proposes a
     LATE_CANCEL breach, so it sits behind a confirm step.
   · `POST /bookings/:id/no-show` with `party: CUSTOMER` — legal from SCHEDULED and
     EN_ROUTE once `booking.no_show_grace_min` has passed after the start. The
     grace is an admin setting this screen cannot read, so the option appears from
     the start time and the server's own sentence explains a report that is still
     too early.

   Each refusal shows the server's `problem.detail`, which names the reason. */

function ProviderExitActions({ locale, dict, booking, now }: { locale: Locale; dict: Dictionary; booking: Booking; now: number }) {
  const cancel = useCancelBooking(locale);
  const noShow = useReportNoShow(locale);
  const [confirming, setConfirming] = useState<'cancel' | 'noShow' | null>(null);
  const [reason, setReason] = useState('');

  const cancelAllowed = booking.status === 'SCHEDULED';
  const noShowAllowed = now >= new Date(booking.scheduledStart).getTime();
  if (!cancelAllowed && !noShowAllowed) return null;

  const failed = cancel.error ?? noShow.error;
  const errorText = failed === null ? null : failed instanceof ApiError && failed.problem.detail !== '' ? failed.problem.detail : dict.job.actionFailed;
  const working = cancel.isPending || noShow.isPending;
  /* The error stays on the mutation and is rendered below. */
  const ignore = (): void => undefined;

  return (
    <div className="mt-5 grid gap-3 border-t border-line pt-4">
      {cancelAllowed ? (
        <div className="rounded-[10px] border border-line p-4">
          <p className="text-sm font-semibold text-navy">{dict.job.providerCancelTitle}</p>
          <p className="mt-1 text-sm leading-6 text-secondary">{dict.job.providerCancelNote}</p>
          {confirming === 'cancel' ? (
            <div className="mt-3 grid gap-3">
              <div className="grid gap-2">
                <Label htmlFor="provider-cancel-reason">{dict.job.providerCancelReasonLabel}</Label>
                <Textarea id="provider-cancel-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder={dict.job.providerCancelReasonPlaceholder} maxLength={500} />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={working}
                  onClick={() => void cancel.mutateAsync({ id: booking.id, ...(reason.trim() === '' ? {} : { reason: reason.trim() }) }).catch(ignore)}
                >
                  {cancel.isPending ? dict.job.exitActionWorking : dict.job.providerCancelConfirm}
                </Button>
                <Button type="button" variant="secondary" size="sm" disabled={working} onClick={() => setConfirming(null)}>
                  {dict.job.keepJob}
                </Button>
              </div>
            </div>
          ) : (
            <Button type="button" variant="secondary" size="sm" className="mt-3" disabled={working} onClick={() => setConfirming('cancel')}>
              <XCircle className="size-4" aria-hidden="true" />
              {dict.job.providerCancelAction}
            </Button>
          )}
        </div>
      ) : null}

      {noShowAllowed ? (
        <div className="rounded-[10px] border border-line p-4">
          <p className="text-sm font-semibold text-navy">{dict.job.customerNoShowTitle}</p>
          <p className="mt-1 text-sm leading-6 text-secondary">{dict.job.customerNoShowNote}</p>
          {confirming === 'noShow' ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" variant="secondary" size="sm" disabled={working} onClick={() => void noShow.mutateAsync({ id: booking.id, party: 'CUSTOMER' }).catch(ignore)}>
                {noShow.isPending ? dict.job.exitActionWorking : dict.job.customerNoShowConfirm}
              </Button>
              <Button type="button" variant="secondary" size="sm" disabled={working} onClick={() => setConfirming(null)}>
                {dict.job.keepJob}
              </Button>
            </div>
          ) : (
            <Button type="button" variant="secondary" size="sm" className="mt-3" disabled={working} onClick={() => setConfirming('noShow')}>
              <AlertTriangle className="size-4" aria-hidden="true" />
              {dict.job.customerNoShowAction}
            </Button>
          )}
        </div>
      ) : null}

      {errorText !== null ? (
        <p role="alert" className="rounded-[9px] bg-rose-50 p-3 text-sm text-rose-700">
          {errorText}
        </p>
      ) : null}
    </div>
  );
}
