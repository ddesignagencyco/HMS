"use client";

import { useState } from "react";
import { CreditCard, AlertCircle, ExternalLink, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { money } from "@/features/catalogue/pricing";
import { bookingTotalPaisa } from "@/features/booking/status";
import { useCancelBooking } from "@/features/booking/queries";
import { useQueryClient } from "@tanstack/react-query";
import { bookingKeys } from "@/lib/api/keys";
import type { BookingDetail } from "@/features/booking/api";
import type { Dictionary } from "@/lib/dictionaries";
import { type Locale } from "@/lib/utils";

const PAYMENT_URL_STORAGE_KEY = "booking:paymentUrl";
const PAYMENT_ID_STORAGE_KEY = "booking:paymentId";

export function AwaitingPaymentCard({
  locale,
  dict,
  booking,
}: {
  locale: Locale;
  dict: Dictionary;
  booking: BookingDetail;
}) {
  const queryClient = useQueryClient();
  const cancelBooking = useCancelBooking(locale);
  const [cancelling, setCancelling] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Check if booking is in pending payment state
  const isPendingPayment = booking.status === "PENDING_PAYMENT" || (booking.paymentMode === "ONLINE" && booking.paymentStatus === "PENDING");
  if (!isPendingPayment) {
    return null;
  }

  // Attempt to read stored payment URLs
  let storedRedirectUrl: string | null = null;
  let storedPaymentId: string | null = null;
  try {
    if (typeof window !== "undefined") {
      storedRedirectUrl = sessionStorage.getItem(`${PAYMENT_URL_STORAGE_KEY}:${booking.id}`);
      storedPaymentId = sessionStorage.getItem(`${PAYMENT_ID_STORAGE_KEY}:${booking.id}`);
    }
  } catch {
    // SessionStorage unavailable
  }

  const effectivePaymentUrl =
    storedRedirectUrl ||
    (storedPaymentId
      ? `/api/v1/dev/payments/${storedPaymentId}?returnUrl=${encodeURIComponent(`/${locale}/checkout/return?bookingId=${booking.id}`)}`
      : `/api/v1/dev/payments/${booking.id}?returnUrl=${encodeURIComponent(`/${locale}/checkout/return?bookingId=${booking.id}`)}`);

  const payableAmount = bookingTotalPaisa(booking);

  const handleCancel = async () => {
    if (!window.confirm(locale === "ur" ? "کیا آپ واقعی یہ بکنگ منسوخ کرنا چاہتے ہیں؟" : "Are you sure you want to cancel this pending booking?")) {
      return;
    }
    setCancelling(true);
    try {
      await cancelBooking.mutateAsync({ id: booking.id, reason: "Cancelled during awaiting payment" });
    } catch {
      // Handled by query mutation
    } finally {
      setCancelling(false);
    }
  };

  return (
    <Card className="border-amber-300 bg-amber-50/50 p-6 shadow-sm">
      <div className="flex items-start gap-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700">
          <CreditCard className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-bold text-navy">
              {locale === "ur" ? "آن لائن ادائیگی درکار ہے" : "Payment Required to Confirm Booking"}
            </h2>
            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
              {dict.bookingStatus[booking.status] ?? "Awaiting Payment"}
            </span>
          </div>

          <p className="mt-1.5 text-sm leading-6 text-secondary">
            {locale === "ur"
              ? "آپ کا بکنگ سلاٹ عارضی طور پر روکا گیا ہے۔ تقرری کی تصدیق اور سروس پروفیشنلز کو بھیجنے کے لیے براہ کرم آن لائن ادائیگی مکمل کریں۔"
              : "Your appointment slot is currently held. Please complete your online payment to confirm this booking and dispatch it to available professionals."}
          </p>

          <div className="mt-4 flex flex-wrap items-baseline gap-x-6 gap-y-2 rounded-lg bg-white/80 p-3.5 border border-amber-200/60">
            <div>
              <span className="block text-xs text-muted">{dict.booking.total}</span>
              <span className="text-lg font-bold text-navy tabular-nums">
                {money(payableAmount, locale)}
              </span>
            </div>
            <div>
              <span className="block text-xs text-muted">{dict.booking.paymentMode}</span>
              <span className="text-sm font-semibold text-navy">
                {dict.booking.online} ({locale === "ur" ? "حفاظتی ایسکرو" : "Escrow Protection"})
              </span>
            </div>
            <div>
              <span className="block text-xs text-muted">{dict.common.status}</span>
              <span className="text-sm font-medium text-amber-800">
                {locale === "ur" ? "ادائیگی کا انتظار" : "Pending Capture"}
              </span>
            </div>
          </div>

          {feedback && (
            <div
              role="alert"
              className={`mt-4 flex items-center gap-2 rounded-lg p-3 text-xs font-medium ${
                feedback.type === "success"
                  ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                  : "bg-rose-100 text-rose-800 border border-rose-300"
              }`}
            >
              {feedback.type === "success" ? <CheckCircle2 className="size-4" /> : <AlertCircle className="size-4" />}
              <span>{feedback.message}</span>
            </div>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <a
              href={effectivePaymentUrl}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-[10px] bg-primary px-5 text-sm font-semibold text-white shadow-sm hover:bg-primary/95 focus:outline-none"
            >
              <span>{dict.booking.payNow}</span>
              <ExternalLink className="size-4" />
            </a>

            <Button
              type="button"
              variant="outline"
              onClick={handleCancel}
              disabled={cancelling}
              className="text-rose-700 hover:bg-rose-50 hover:text-rose-800"
            >
              {cancelling ? <Loader2 className="size-4 animate-spin" /> : <XCircle className="size-4" />}
              <span>{dict.common.cancel}</span>
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
