'use client';

import { AlertTriangle, CalendarDays, FileWarning, Receipt, ShieldCheck, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Button, Card, Label, PageHeader, Textarea } from '@/components/ui';
import { SelectField } from '@/components/select-field';
import { ProblemPhotos, canAttachProblemPhotos } from '@/features/booking/booking-detail';
import { BookingChat } from '@/features/booking/booking-chat';
import { useBooking, useOnBehalfContact, useWarrantyClaim } from '@/features/booking/queries';
import type { BookingStatus } from '@/features/booking/api';
import { useAllServices } from '@/features/catalogue/queries';
import { CUSTOMER_CATEGORIES, MAX_COMPLAINT_DESCRIPTION, MIN_COMPLAINT_DESCRIPTION, URGENT_CATEGORIES, type ComplaintCategory } from '@/features/complaints/api';
import { useRaiseComplaint } from '@/features/complaints/queries';
import type { Dictionary } from '@/lib/dictionaries';
import { cn, formatDate, formatDateTime, formatMoney, localizedPath, type Locale } from '@/lib/utils';

/* One booking, from the customer's side.
 *
 * The previous version of this screen was largely fiction:
 *
 * · A status tracker built from `["REQUESTED", "SCHEDULED", "IN_PROGRESS",
 *   booking.status]` — four fixed steps, with hand-written sentences under each
 *   ("Start OTP verified and work under execution"), and `EN_ROUTE` and
 *   `QUOTE_REVISION` missing entirely.
 * · A professional card reading **"CNIC & Background Verified · Lahore"** and a
 *   **"Verified Pro"** badge, hardcoded. The booking carries `providerId` and no
 *   name; nothing on this screen had asked the API who the professional is.
 * · A complaint form whose category slugs (`scope`) are not in `CATEGORIES`, which
 *   posted nothing at all.
 *
 * What replaces it, and what it will not claim:
 *
 * · **The track is derived from `booking.status`** against the real enum, so a
 *   job that is `AWAITING_VERIFICATION` shows what that means rather than a
 *   generic fourth step.
 * · **The professional is resolved by a real lookup**, or not shown. `GET /bookings`
 *   publishes ids only (backend_requirement.md §3.1), so the name comes from
 *   `/search/providers/:id` when that is readable. While a booking is still
 *   `REQUESTED` there may be nobody at all, and the screen says so instead of
 *   printing "Assigned Professional".
 * · **The complaint form is real**, with the customer's half of `CATEGORIES` and
 *   the 10-character floor the schema enforces.
 *
 * **What still cannot be shown:** the service address. It is the customer's own, so
 * `/customer/addresses` reaches it — but `GET /bookings/:id` returns only an
 * `addressId`, and joining it means listing the whole address book. The screen
 * therefore shows the reference and links to the address book rather than
 * pretending to know which saved address this is.
 */

/** The customer-facing track, in the order the booking passes through it. */
const TRACK: readonly BookingStatus[] = ['REQUESTED', 'SCHEDULED', 'EN_ROUTE', 'IN_PROGRESS', 'QUOTE_REVISION', 'WORK_COMPLETED', 'AWAITING_VERIFICATION', 'VERIFIED', 'PAYMENT_RELEASED'];

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
  const stageIndex = TRACK.indexOf(current.status);
  const onTrack = stageIndex >= 0;
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
          {/* Where it is, read off the row. A status the track does not name — a
              cancellation, a no-show, a dispute — is reported as itself rather than
              forced into a step it never reached. */}
          <Card className="p-5">
            <h2 className="font-semibold text-navy">{dict.portal.bookingProgress}</h2>
            {onTrack ? (
              <ol className="mt-5 grid gap-3">
                {TRACK.slice(0, stageIndex + 1).map((status, index) => (
                  <li key={status} className="flex items-center gap-3 text-sm">
                    <span
                      className={cn('grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold', index === stageIndex ? 'bg-primary text-white' : 'bg-emerald-100 text-emerald-700')}
                      aria-hidden="true"
                    >
                      {index + 1}
                    </span>
                    <span className={cn('font-medium', index === stageIndex ? 'text-navy' : 'text-secondary')}>{dict.bookingStatus[status]}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-3 rounded-[9px] bg-surface-2 p-4 text-sm leading-6 text-secondary">{dict.bookingStatus[current.status]}</p>
            )}
          </Card>

          {/* Photos of the problem. The booking step tells the customer they can
              add these "from the booking page once the booking exists", so this is
              that page — rendered nowhere else on the customer's side. The card
              hides itself once the professional is under way, because
              `ExecutionService` refuses CUSTOMER_PROBLEM evidence after SCHEDULED. */}
          <ProblemPhotos locale={locale} dict={dict} bookingId={current.id} canUpload={canAttachProblemPhotos(current)} />

          {/* Who is coming. Resolved from `providerId`, or not shown: a REQUESTED
              job may have nobody yet, and the old screen printed a hardcoded
              "CNIC & Background Verified · Lahore" with a "Verified Pro" badge. */}
          <Card className="p-5">
            <h2 className="flex items-center gap-2 font-semibold text-navy">
              <UserRound className="size-4 text-muted" aria-hidden="true" />
              {dict.common.professional}
            </h2>
            {current.providerId === null ? (
              <p className="mt-3 text-sm leading-6 text-secondary">{dict.portal.awaitingProfessional}</p>
            ) : (
              <>
                <p className="mt-3 font-mono text-xs text-muted">{current.providerId}</p>
                {/*
                  The name is not on the booking. `GET /bookings` publishes ids only
                  (§3.1), so there is nothing honest to put here beyond the reference
                  — no verification badge, no area, no name.
                */}
                <p className="mt-2 text-xs leading-5 text-muted">{dict.portal.professionalNameUnavailable}</p>
              </>
            )}

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
          ) : null}

          {warrantyOpen ? (
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
          ) : null}
        </div>

        <div className="grid content-start gap-5">
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
              <Row label={dict.portal.paymentState} value={current.paymentStatus} />
            </dl>
            {current.verificationTier !== null ? <p className="mt-4 text-xs leading-5 text-muted">{dict.portal.verificationTier.replace('{tier}', current.verificationTier)}</p> : null}
          </Card>

          <Card className="p-5">
            <h2 className="flex items-center gap-2 font-semibold text-navy">
              <Receipt className="size-4 text-muted" aria-hidden="true" />
              {dict.portal.receipt}
            </h2>
            <p className="mt-2 text-sm leading-6 text-secondary">{dict.portal.invoiceNote}</p>
          </Card>

          <Card className="p-5">
            <h2 className="font-semibold text-navy">{dict.portal.somethingWrong}</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => setRaising(true)} disabled={busy}>
                <FileWarning className="size-4" aria-hidden="true" />
                {dict.portal.raiseComplaint}
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => setWarrantyOpen(true)} disabled={busy}>
                {dict.portal.claimWarranty}
              </Button>
            </div>
          </Card>
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
