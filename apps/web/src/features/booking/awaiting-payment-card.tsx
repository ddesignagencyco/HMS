"use client";

import { useState } from "react";
import { AlertCircle, CreditCard, ExternalLink, Info, Loader2, XCircle } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { money } from "@/features/catalogue/pricing";
import { bookingTotalPaisa } from "@/features/booking/status";
import { useCancelBooking } from "@/features/booking/queries";
import { readPaymentLink } from "@/features/booking/payment-link";
import type { BookingDetail } from "@/features/booking/api";
import { ApiError } from "@/lib/api/problem";
import type { Dictionary } from "@/lib/dictionaries";
import { type Locale } from "@/lib/utils";

/** Recorded on the booking for staff, so it is not translated. */
const CANCEL_REASON = "Cancelled by the customer before payment";

/* An online booking whose slot is held until the gateway confirms payment.

   **The only payment link this card offers is the one the API issued.**
   `POST /bookings` returns `payment.redirectUrl` exactly once, and the booking
   flow keeps it (`payment-link.ts`). This card used to fall back to a
   hand-built `/api/v1/dev/payments/<bookingId>` when that was missing — the dev
   mock's gateway, given a *booking* id where it wants a *payment* id. Against a
   real gateway that link cannot work, and even against the mock it was wrong.

   When the link is not kept there is no API to ask for it again
   (`backend_requirement.md` §2.3), so the card says so plainly and offers the
   one thing that does work: cancelling, which frees the slot to book again. */
export function AwaitingPaymentCard({ locale, dict, booking }: { locale: Locale; dict: Dictionary; booking: BookingDetail }) {
  const cancelBooking = useCancelBooking(locale);
  const [confirming, setConfirming] = useState(false);

  if (booking.status !== "PENDING_PAYMENT" || booking.paymentMode !== "ONLINE") return null;

  const paymentUrl = readPaymentLink(booking.id);

  const cancelError =
    cancelBooking.error === null
      ? null
      : cancelBooking.error instanceof ApiError && cancelBooking.error.problem.detail !== ""
        ? cancelBooking.error.problem.detail
        : dict.booking.actionFailed;

  return (
    <Card className="border-amber-300 bg-amber-50/50 p-6 shadow-sm">
      <div className="flex items-start gap-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700" aria-hidden="true">
          <CreditCard className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-bold text-navy">{dict.booking.awaitingPaymentTitle}</h2>
            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">{dict.bookingStatus[booking.status]}</span>
          </div>

          <p className="mt-1.5 text-sm leading-6 text-secondary">{dict.booking.awaitingPaymentText}</p>

          <dl className="mt-4 flex flex-wrap items-baseline gap-x-6 gap-y-2 rounded-lg border border-amber-200/60 bg-white/80 p-3.5">
            <div>
              <dt className="text-xs text-muted">{dict.booking.total}</dt>
              <dd className="text-lg font-bold tabular-nums text-navy">{money(bookingTotalPaisa(booking), locale)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">{dict.booking.paymentMode}</dt>
              <dd className="text-sm font-semibold text-navy">
                {dict.booking.online} · {dict.booking.awaitingPaymentEscrow}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">{dict.common.status}</dt>
              <dd className="text-sm font-medium text-amber-800">{dict.booking.awaitingPaymentState}</dd>
            </div>
          </dl>

          {paymentUrl === null ? (
            <p role="status" className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-white p-3 text-sm leading-6 text-amber-900">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {dict.booking.payLinkMissing}
            </p>
          ) : null}

          {cancelError !== null ? (
            <p role="alert" className="mt-4 flex items-start gap-2 rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm leading-6 text-rose-800">
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {cancelError}
            </p>
          ) : null}

          {confirming ? (
            <div className="mt-5 grid gap-3 rounded-lg border border-line bg-white p-3.5">
              <p className="text-sm font-medium text-navy">{dict.booking.cancelPendingConfirm}</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={cancelBooking.isPending}
                  onClick={() => void cancelBooking.mutateAsync({ id: booking.id, reason: CANCEL_REASON }).catch(() => undefined)}
                  className="text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                >
                  {cancelBooking.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <XCircle className="size-4" aria-hidden="true" />}
                  {cancelBooking.isPending ? dict.booking.working : dict.booking.cancelPendingYes}
                </Button>
                <Button type="button" variant="secondary" size="sm" disabled={cancelBooking.isPending} onClick={() => setConfirming(false)}>
                  {dict.common.cancel}
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-5 flex flex-wrap items-center gap-3">
              {paymentUrl !== null ? (
                <a
                  href={paymentUrl}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-[10px] bg-primary px-5 text-sm font-semibold text-white shadow-sm hover:bg-primary/95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100"
                >
                  <span>{dict.booking.payNow}</span>
                  <ExternalLink className="size-4" aria-hidden="true" />
                </a>
              ) : null}
              <Button type="button" variant="outline" onClick={() => setConfirming(true)} className="text-rose-700 hover:bg-rose-50 hover:text-rose-800">
                <XCircle className="size-4" aria-hidden="true" />
                <span>{dict.booking.cancelAction}</span>
              </Button>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
