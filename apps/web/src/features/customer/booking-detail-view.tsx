'use client';

import { AlertTriangle, ArrowRight, CalendarDays, FileWarning, Receipt, ShieldCheck, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, Label, PageHeader, Textarea } from '@/components/ui';
import { SelectField } from '@/components/select-field';
import { BookingActionsCard, ProblemPhotos, canAttachProblemPhotos } from '@/features/booking/booking-detail';
import { InvoiceDownload, isInvoiceReady } from '@/features/booking/invoice-download';
import { BookingChat } from '@/features/booking/booking-chat';
import { StartCodeCard } from '@/features/booking/start-code-card';
import { RevisionCard } from '@/features/booking/revision-card';
import { AwaitingPaymentCard } from '@/features/booking/awaiting-payment-card';
import { ConfirmWorkSection } from '@/features/verification/confirm-work-card';
import { useBooking, useOnBehalfContact, useWarrantyClaim } from '@/features/booking/queries';
import type { BookingStatus, PaymentMode } from '@/features/booking/api';
import { useAllServices } from '@/features/catalogue/queries';
import { CUSTOMER_CATEGORIES, MAX_COMPLAINT_DESCRIPTION, MIN_COMPLAINT_DESCRIPTION, URGENT_CATEGORIES, type ComplaintCategory } from '@/features/complaints/api';
import { useRaiseComplaint } from '@/features/complaints/queries';
import type { Dictionary } from '@/lib/dictionaries';
import { cn, formatDate, formatDateTime, formatMoney, localizedPath, type Locale } from '@/lib/utils';

/* Customer booking detail view: tracks status progression, awaiting payment resolution,
   problem photos, start codes, revision approvals, in-job messaging, and complaints. */

/** The customer-facing tracks for online vs cash bookings. */
const ONLINE_TRACK: readonly BookingStatus[] = ['PENDING_PAYMENT', 'REQUESTED', 'SCHEDULED', 'EN_ROUTE', 'IN_PROGRESS', 'QUOTE_REVISION', 'WORK_COMPLETED', 'AWAITING_VERIFICATION', 'VERIFIED', 'PAYMENT_RELEASED'];
const CASH_TRACK: readonly BookingStatus[] = ['REQUESTED', 'SCHEDULED', 'EN_ROUTE', 'IN_PROGRESS', 'QUOTE_REVISION', 'WORK_COMPLETED', 'AWAITING_VERIFICATION', 'VERIFIED', 'PAYMENT_RELEASED'];

/**
 * The steps the progress card prints: every stage up to the current one.
 *
 * QUOTE_REVISION is a detour, not a stage every job passes through, and the row
 * carries no history saying whether this one did. Printing it as a completed
 * step told every customer they had "decided" on a revision that never existed,
 * so it is shown only while it is the booking's actual status.
 */
export const progressSteps = (paymentMode: PaymentMode, status: BookingStatus): readonly BookingStatus[] => {
  const track = paymentMode === 'ONLINE' ? ONLINE_TRACK : CASH_TRACK;
  const stageIndex = track.indexOf(status);
  if (stageIndex < 0) return [];
  return track.slice(0, stageIndex + 1).filter((step) => step !== 'QUOTE_REVISION' || step === status);
};

export function CustomerBookingDetailScreen({ locale, bookingId, dict }: { locale: Locale; bookingId: string; dict: Dictionary }) {
  const booking = useBooking(bookingId, locale);
  const contact = useOnBehalfContact(bookingId, locale);
  const services = useAllServices(locale);

  const [raising, setRaising] = useState(false);
  const [warrantyOpen, setWarrantyOpen] = useState(false);

  const warranty = useWarrantyClaim(locale);
  const complaint = useRaiseComplaint(locale);

  const [category, setCategory] = useState<ComplaintCategory>('QUALITY');
  const [description, setDescription] = useState('');
  const [warrantyReason, setWarrantyReason] = useState('');
  const [localError, setLocalError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  /* Both panels open at the foot of the main column while their buttons sit in
     the side column, so on a long page opening one used to change nothing the
     customer could see. Bring the panel to them. */
  const complaintRef = useRef<HTMLDivElement>(null);
  const warrantyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (raising) complaintRef.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }, [raising]);
  useEffect(() => {
    if (warrantyOpen) warrantyRef.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }, [warrantyOpen]);

  const service = useMemo(() => services.data?.items.find((entry) => entry.id === booking.data?.serviceId), [services.data, booking.data?.serviceId]);

  const serviceName = service === undefined ? dict.portal.serviceUnknown : locale === 'ur' ? service.nameUr : service.nameEn;

  if (booking.isPending) {
    return (
      <div aria-busy="true" aria-live="polite" className="grid gap-3">
        <span className="skeleton h-8 w-56 rounded-[9px]" />
        <span className="skeleton h-64 w-full rounded-[12px]" />
      </div>
    );
  }

  if (booking.isError) {
    /* `getOwned` 404s both "missing" and "not yours", so the screen must not guess
       which — that would confirm a booking exists. */
    return (
      <div>
        <PageHeader eyebrow={dict.portal.customer} title={dict.portal.booking} />
        <div role="alert" className="mt-6 rounded-[14px] border border-rose-200 bg-rose-50 p-5">
          <p className="text-sm font-medium leading-6 text-rose-800">{dict.portal.bookingNotFound}</p>
          <Link href={localizedPath(locale, '/account/bookings')} className="mt-4 inline-block text-sm font-semibold text-primary-strong underline">
            {dict.portal.dashboardSeeAll}
          </Link>
        </div>
      </div>
    );
  }

  const current = booking.data;
  const steps = progressSteps(current.paymentMode, current.status);
  const stageIndex = steps.length - 1;
  const onTrack = steps.length > 0;
  const urgent = URGENT_CATEGORIES.includes(category);

  const submitComplaint = async (): Promise<void> => {
    setLocalError('');
    setNotice('');
    const text = description.trim();
    /* `complaintCreateSchema` requires 10 characters. Saying so beats a 422 on the
       one form a customer uses when something has gone wrong. */
    if (text.length < MIN_COMPLAINT_DESCRIPTION) {
      setLocalError(dict.portal.complaintTooShort.replace('{min}', String(MIN_COMPLAINT_DESCRIPTION)));
      return;
    }
    setBusy(true);
    try {
      await complaint.mutateAsync({ bookingId: current.id, category, description: text });
      setDescription('');
      setRaising(false);
      setNotice(dict.portal.complaintFiled);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : dict.portal.complaintFailed);
    } finally {
      setBusy(false);
    }
  };

  const submitWarranty = async (): Promise<void> => {
    setLocalError('');
    setNotice('');
    const text = warrantyReason.trim();
    if (text.length < MIN_COMPLAINT_DESCRIPTION) {
      setLocalError(dict.portal.warrantyReasonTooShort.replace('{min}', String(MIN_COMPLAINT_DESCRIPTION)));
      return;
    }
    setBusy(true);
    try {
      await warranty.mutateAsync({ id: current.id, reason: text });
      setWarrantyReason('');
      setWarrantyOpen(false);
      setNotice(dict.portal.warrantyFiled);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : dict.portal.warrantyFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow={current.code}
        title={serviceName}
        description={current.problemText ?? undefined}
        action={<span className={cn('rounded-full px-3 py-1 text-xs font-semibold', tone(current.status))}>{dict.bookingStatus[current.status]}</span>}
      />

      {notice !== '' ? (
        <p role="status" className="mt-5 rounded-[10px] bg-emerald-50 p-4 text-sm text-emerald-800">
          {notice}
        </p>
      ) : null}
      {localError !== '' ? (
        <p role="alert" className="mt-5 flex items-start gap-2 rounded-[10px] bg-rose-50 p-4 text-sm leading-6 text-rose-800">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {localError}
        </p>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <div className="grid gap-5">
          {/* Awaiting online payment action card */}
          <AwaitingPaymentCard locale={locale} dict={dict} booking={current} />

          {/* FR-VC-16: the customer confirms and rates their own finished job. First
              in the column because it is the one thing on the page waiting on
              them, and it is the only way some jobs ever get paid out. */}
          <ConfirmWorkSection locale={locale} dict={dict} booking={current} onRaiseComplaint={() => setRaising(true)} />

          {/* Where it is, read off the row. A status the track does not name — a
              cancellation, a no-show, a dispute — is reported as itself rather than
              forced into a step it never reached. */}
          <Card className="p-5">
            <h2 className="font-semibold text-navy">{dict.portal.bookingProgress}</h2>
            {onTrack ? (
              <ol className="mt-5 grid gap-3">
                {steps.map((status, index) => (
                  <li key={status} className="flex items-center gap-3 text-sm">
                    <span
                      className={cn('grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold', index === stageIndex ? 'bg-primary text-white' : 'bg-emerald-100 text-emerald-700')}
                      aria-hidden="true"
                    >
                      {index + 1}
                    </span>
                    <span className={cn('font-medium', index === stageIndex ? 'text-navy' : 'text-secondary')}>{dict.bookingStatus[status] ?? status}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-3 rounded-[9px] bg-surface-2 p-4 text-sm leading-6 text-secondary">{dict.bookingStatus[current.status] ?? current.status}</p>
            )}
          </Card>

          {/* Pending quote revision (extra charges proposal) from provider */}
          <RevisionCard locale={locale} dict={dict} booking={current} />

          {/* Start code for the customer to give the provider at arrival */}
          <StartCodeCard locale={locale} dict={dict} booking={current} />

          {/* Photos of the problem. The booking step tells the customer they can
              add these "from the booking page once the booking exists", so this is
              that page — rendered nowhere else on the customer's side. The card
              hides itself once the professional is under way, because
              `ExecutionService` refuses CUSTOMER_PROBLEM evidence after SCHEDULED. */}
          <ProblemPhotos locale={locale} dict={dict} bookingId={current.id} canUpload={canAttachProblemPhotos(current)} />

          {/* Who is coming. Assigned professional details. */}
          <Card className="p-5">
            {(() => {
              /* The API publishes no professional's name on this row, only their
                 qualification. Showing a name derived from the id would put a
                 person on screen who may not exist, so the label is what is known. */
              const providerLabel = current.providerQualification ?? dict.common.professional;
              return (
                <div className="flex items-start gap-3.5">
                  <span
                    aria-hidden="true"
                    className="grid size-10 shrink-0 place-items-center rounded-lg bg-navy text-sm font-bold text-white shadow-sm"
                  >
                    {current.providerId ? providerLabel.charAt(0).toUpperCase() : '•'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="flex items-center gap-2 font-semibold text-navy">
                      <UserRound className="size-4 text-muted" aria-hidden="true" />
                      {current.providerId ? providerLabel : dict.common.professional}
                    </h2>
                    {current.providerId === null ? (
                      <p className="mt-2 text-sm leading-6 text-secondary">{dict.portal.awaitingProfessional}</p>
                    ) : (
                      <div className="mt-1.5 space-y-1">
                        <span className="sr-only">{dict.portal.professionalNameUnavailable}</span>
                        <Link
                          href={localizedPath(locale, `/providers/${current.providerId}`)}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:text-primary-strong hover:underline pt-0.5"
                        >
                          <span>{dict.portal.viewProfileReviews}</span>
                          <ArrowRight className="size-3" aria-hidden="true" />
                        </Link>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            {contact.data?.contact != null ? (
              <div className="mt-4 rounded-[9px] bg-surface-2 p-3">
                <p className="text-xs font-medium text-muted">{dict.portal.jobForSomeoneElse}</p>
                <p className="mt-1 font-medium text-navy">{contact.data.contact.name}</p>
                <p className="mt-0.5 font-mono text-sm text-secondary">{contact.data.contact.phone}</p>
              </div>
            ) : null}
          </Card>

          {/* Real-time booking messages thread */}
          <BookingChat locale={locale} dict={dict} booking={current} />

          {/* Raising a complaint. Real categories, real floor, real endpoint. */}
          {raising ? (
            <div ref={complaintRef} className="scroll-mt-24">
            <Card className="p-5">
              <h2 className="font-semibold text-navy">{dict.portal.raiseComplaint}</h2>
              <p className="mt-1.5 text-sm leading-6 text-secondary">{dict.portal.raiseComplaintText}</p>

              <div className="mt-4 grid gap-3">
                <div className="grid gap-2">
                  <Label htmlFor="complaint-category">{dict.portal.complaintCategoryLabel}</Label>
                  <SelectField
                    id="complaint-category"
                    value={category}
                    onChange={(value) => setCategory(value as ComplaintCategory)}
                    options={CUSTOMER_CATEGORIES.map((option) => ({ value: option, label: dict.portal.complaintCategories[option] }))}
                    placeholder={dict.portal.complaintCategoryLabel}
                  />
                </div>

                {/* Safety carries a one-hour SLA and alerts the admins at once.
                    Said here, because the alternative is finding out from a clock. */}
                {urgent ? (
                  <p className="flex items-start gap-2 rounded-[9px] bg-rose-50 p-3 text-sm leading-6 text-rose-800">
                    <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                    {dict.portal.complaintUrgent}
                  </p>
                ) : null}

                <div className="grid gap-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <Label htmlFor="complaint-description">{dict.portal.complaintDescriptionLabel}</Label>
                    <span className="text-xs text-muted">{dict.portal.charCount.replace('{count}', String(description.trim().length)).replace('{max}', String(MAX_COMPLAINT_DESCRIPTION))}</span>
                  </div>
                  <Textarea
                    id="complaint-description"
                    value={description}
                    maxLength={MAX_COMPLAINT_DESCRIPTION}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder={dict.portal.complaintDescriptionPlaceholder}
                  />
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button type="button" onClick={() => void submitComplaint()} disabled={busy}>
                    {dict.portal.submitComplaint}
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => setRaising(false)} disabled={busy}>
                    {dict.common.cancel}
                  </Button>
                </div>
              </div>
            </Card>
            </div>
          ) : null}

          {warrantyOpen ? (
            <div ref={warrantyRef} className="scroll-mt-24">
            <Card className="p-5">
              <h2 className="font-semibold text-navy">{dict.portal.claimWarranty}</h2>
              <p className="mt-1.5 text-sm leading-6 text-secondary">{dict.portal.claimWarrantyText}</p>
              <div className="mt-4 grid gap-3">
                <div className="grid gap-2">
                  <Label htmlFor="warranty-reason">{dict.portal.warrantyReasonLabel}</Label>
                  <Textarea id="warranty-reason" value={warrantyReason} onChange={(event) => setWarrantyReason(event.target.value)} placeholder={dict.portal.warrantyReasonPlaceholder} />
                </div>
                <div className="flex flex-wrap gap-2">
                  {/* Not the same label as the button that opened the panel: two
                      buttons reading "Claim under warranty" on one screen leave the
                      reader unable to tell which submits. */}
                  <Button type="button" onClick={() => void submitWarranty()} disabled={busy}>
                    {dict.portal.submitWarrantyClaim}
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => setWarrantyOpen(false)} disabled={busy}>
                    {dict.common.cancel}
                  </Button>
                </div>
              </div>
            </Card>
            </div>
          ) : null}
        </div>

        <div className="grid content-start gap-5">
          {/* Cancel (with the server-quoted fee), reschedule from live slots, and
              report a provider who never arrived. An unpaid booking's pay/cancel
              stays with `AwaitingPaymentCard`, so it is not offered twice. */}
          <BookingActionsCard locale={locale} dict={dict} booking={current} hidePayment hideWhenEmpty />

          <Card className="p-5">
            <h2 className="flex items-center gap-2 font-semibold text-navy">
              <CalendarDays className="size-4 text-muted" aria-hidden="true" />
              {dict.portal.schedule}
            </h2>
            <dl className="mt-4 grid gap-3 text-sm">
              <Row label={dict.portal.starts} value={formatDateTime(current.scheduledStart, locale)} />
              <Row label={dict.portal.ends} value={formatDateTime(current.scheduledEnd, locale)} />
              <Row label={dict.portal.bookedOn} value={formatDate(current.createdAt, locale)} />
              {current.isEmergency ? <Row label={dict.portal.emergency} value={dict.common.yes} /> : null}
            </dl>
          </Card>

          <Card className="p-5">
            <h2 className="font-semibold text-navy">{dict.portal.money}</h2>
            <dl className="mt-4 grid gap-3 text-sm">
              <Row label={dict.portal.quoted} value={formatMoney(current.quotedAmountPaisa, locale)} />
              <Row label={dict.portal.approved} value={formatMoney(current.approvedTotalPaisa, locale)} />
              {current.discountPaisa > 0 ? <Row label={dict.portal.discount} value={`− ${formatMoney(current.discountPaisa, locale)}`} /> : null}
              {/* Null until the job is completed — shown as such rather than as zero,
                  which would read as "the work was free". */}
              <Row label={dict.portal.finalAmount} value={current.finalAmountPaisa === null ? dict.portal.notYetCharged : formatMoney(current.finalAmountPaisa, locale)} />
              <Row label={dict.portal.paymentMode} value={dict.job.paymentModes[current.paymentMode]} />
              <Row label={dict.portal.paymentState} value={dict.portal.paymentStatuses[current.paymentStatus] ?? current.paymentStatus} />
            </dl>
            {current.verificationTier !== null ? <p className="mt-4 text-xs leading-5 text-muted">{dict.portal.verificationTier.replace('{tier}', current.verificationTier)}</p> : null}
          </Card>

          <Card className="p-5">
            <h2 className="flex items-center gap-2 font-semibold text-navy">
              <Receipt className="size-4 text-muted" aria-hidden="true" />
              {dict.portal.receipt}
            </h2>
            <p className="mt-2 text-sm leading-6 text-secondary">{dict.portal.invoiceNote}</p>
            {isInvoiceReady(current.status) ? (
              <div className="mt-4">
                <InvoiceDownload bookingId={current.id} locale={locale} dict={dict} />
              </div>
            ) : null}
          </Card>

          {/* `POST /complaints` is a 404 on a booking nobody has taken yet — there is
              no provider to complain about — so the card waits for an assignment.
              The warranty claim below needs PAYMENT_RELEASED, which implies one. */}
          {current.providerId !== null ? (
          <Card className="p-5">
            <h2 className="font-semibold text-navy">{dict.portal.somethingWrong}</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => setRaising(true)} disabled={busy}>
                <FileWarning className="size-4" aria-hidden="true" />
                {dict.portal.raiseComplaint}
              </Button>
              {/* `warrantyClaim` is legal from PAYMENT_RELEASED only; offering it on a
                  job still in progress only led to a 409. */}
              {current.status === 'PAYMENT_RELEASED' ? (
                <Button type="button" variant="secondary" size="sm" onClick={() => setWarrantyOpen(true)} disabled={busy}>
                  {dict.portal.claimWarranty}
                </Button>
              ) : null}
            </div>
          </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-2 last:border-0">
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium text-navy">{value}</dd>
    </div>
  );
}

const TONE: Partial<Record<BookingStatus, string>> = {
  VERIFIED: 'bg-emerald-50 text-emerald-700',
  PAYMENT_RELEASED: 'bg-emerald-50 text-emerald-700',
  WORK_COMPLETED: 'bg-emerald-50 text-emerald-700',
  AWAITING_VERIFICATION: 'bg-teal-50 text-teal-800',
  IN_PROGRESS: 'bg-amber-50 text-amber-800',
  EN_ROUTE: 'bg-amber-50 text-amber-800',
  QUOTE_REVISION: 'bg-violet-50 text-violet-800',
  DISPUTED: 'bg-rose-50 text-rose-700',
  CANCELLED_CUSTOMER: 'bg-rose-50 text-rose-700',
  CANCELLED_PROVIDER: 'bg-rose-50 text-rose-700',
  NO_SHOW: 'bg-rose-50 text-rose-700',
  REFUNDED: 'bg-rose-50 text-rose-700'
};

const tone = (status: BookingStatus): string => TONE[status] ?? 'bg-slate-100 text-slate-700';
