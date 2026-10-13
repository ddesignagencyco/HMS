"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Clock, Loader2, RotateCcw, XCircle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import type { Dictionary } from "@/lib/dictionaries";
import { localizedPath, type Locale } from "@/lib/utils";
import { Button, ButtonLink, Card, Container, PageBanner, Section } from "@/components/ui";
import { useBooking } from "@/features/booking/queries";
import { bookingKeys } from "@/lib/api/keys";
import { money } from "@/features/catalogue/pricing";
import { bookingTotalPaisa } from "@/features/booking/status";

const SETTLE_MS = 2_500;
const PAYMENT_ID_STORAGE_KEY = "booking:paymentId";

export function CheckoutReturn({ locale, dict, bookingId }: { locale: Locale; dict: Dictionary; bookingId: string }) {
  const queryClient = useQueryClient();
  const booking = useBooking(bookingId, locale);
  const [waited, setWaited] = useState(false);
  const [completingDev, setCompletingDev] = useState(false);

  useEffect(() => {
    // Invalidate details immediately upon return to observe freshly ingested webhooks
    void queryClient.invalidateQueries({ queryKey: bookingKeys.detail(bookingId) });
    void queryClient.invalidateQueries({ queryKey: bookingKeys.list() });

    const timer = setTimeout(() => {
      setWaited(true);
      void booking.refetch();
    }, SETTLE_MS);

    return () => clearTimeout(timer);
  }, [bookingId, queryClient]);

  const target = localizedPath(locale, `/account/bookings/${bookingId}`);
  const current = booking.data;

  const isConfirmed =
    current !== undefined &&
    current.status !== "PENDING_PAYMENT" &&
    current.status !== "CANCELLED_CUSTOMER" &&
    current.status !== "CANCELLED_PROVIDER";

  const isCancelled =
    current !== undefined &&
    (current.status === "CANCELLED_CUSTOMER" || current.status === "CANCELLED_PROVIDER");

  const isStillPending = current?.status === "PENDING_PAYMENT";

  const handleDevComplete = async () => {
    setCompletingDev(true);
    try {
      let paymentId: string | null = null;
      try {
        paymentId = sessionStorage.getItem(`${PAYMENT_ID_STORAGE_KEY}:${bookingId}`);
      } catch {
        // Ignore
      }
      const effectiveId = paymentId || bookingId;
      const res = await fetch(`/api/v1/dev/payments/${effectiveId}/complete?outcome=captured`, {
        method: "GET",
      });
      if (res.ok) {
        await queryClient.invalidateQueries({ queryKey: bookingKeys.all });
        await booking.refetch();
      }
    } finally {
      setCompletingDev(false);
    }
  };

  return (
    <>
      <PageBanner
        eyebrow={dict.booking.reference}
        title={
          isConfirmed
            ? dict.booking.successTitle
            : isCancelled
              ? (locale === "ur" ? "بکنگ منسوخ کر دی گئی" : "Booking Cancelled")
              : dict.booking.checkoutReturnTitle
        }
        titleAccent={current?.code}
      />
      <Section tone="surface" size="default">
        <Container>
          <Card className="mx-auto max-w-xl p-8 text-center" aria-live="polite">
            {isConfirmed ? (
              <>
                <span className="mx-auto grid size-14 place-items-center rounded-full bg-emerald-50 text-emerald-700">
                  <CheckCircle2 className="size-7" />
                </span>
                <h2 className="mt-4 text-xl font-bold text-navy">
                  {locale === "ur" ? "ادائیگی کی تصدیق ہو گئی!" : "Payment Confirmed!"}
                </h2>
                <p className="mt-2 text-sm leading-6 text-secondary">
                  {locale === "ur"
                    ? "آپ کی ادائیگی وصول ہو گئی ہے اور بکنگ کی حیثیت منظور ہو چکی ہے۔"
                    : "Your payment has been captured and your booking is confirmed and dispatched to professionals."}
                </p>
                {current ? (
                  <dl className="mt-6 grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-4 text-xs text-left">
                    <div>
                      <dt className="text-muted">{dict.common.service}</dt>
                      <dd className="font-semibold text-navy truncate">
                        {locale === "ur" ? (current.serviceNameUr ?? current.serviceName) : (current.serviceName ?? "Service")}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted">{dict.booking.total}</dt>
                      <dd className="font-semibold text-navy tabular-nums">
                        {money(bookingTotalPaisa(current), locale)}
                      </dd>
                    </div>
                  </dl>
                ) : null}
                <div className="mt-6 flex flex-wrap justify-center gap-3">
                  <ButtonLink href={target}>
                    {dict.booking.viewBooking}
                  </ButtonLink>
                  <ButtonLink href={localizedPath(locale, "/account/bookings")} variant="secondary">
                    {dict.portal.bookings}
                  </ButtonLink>
                </div>
              </>
            ) : isCancelled ? (
              <>
                <span className="mx-auto grid size-14 place-items-center rounded-full bg-rose-50 text-rose-700">
                  <XCircle className="size-7" />
                </span>
                <h2 className="mt-4 text-xl font-bold text-navy">
                  {locale === "ur" ? "بکنگ منسوخ ہے" : "Booking Cancelled"}
                </h2>
                <p className="mt-2 text-sm leading-6 text-secondary">
                  {locale === "ur"
                    ? "ادائیگی مکمل نہ ہونے کی وجہ سے بکنگ منسوخ کر دی گئی ہے۔"
                    : "This booking was cancelled because payment was interrupted or refused."}
                </p>
                <div className="mt-6 flex flex-wrap justify-center gap-3">
                  <ButtonLink href={localizedPath(locale, "/services")}>
                    {dict.search.browseCatalogue}
                  </ButtonLink>
                </div>
              </>
            ) : (
              <>
                <span className="mx-auto grid size-14 place-items-center rounded-full bg-amber-50 text-amber-700 animate-pulse">
                  <Clock className="size-7" />
                </span>
                <h2 className="mt-4 text-xl font-bold text-navy">
                  {dict.booking.checkoutReturnTitle}
                </h2>
                <p className="mt-2 text-sm leading-6 text-secondary">
                  {dict.booking.checkoutReturnText}
                </p>

                <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                  <ButtonLink href={target}>
                    {dict.booking.checkoutReturnAction}
                  </ButtonLink>

                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => void booking.refetch()}
                    disabled={booking.isFetching}
                    className="gap-1.5"
                  >
                    <RotateCcw className={`size-3.5 ${booking.isFetching ? "animate-spin" : ""}`} />
                    <span>{locale === "ur" ? "حالت تازہ کریں" : "Refresh Status"}</span>
                  </Button>

                  {isStillPending ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void handleDevComplete()}
                      disabled={completingDev}
                      className="gap-1.5 text-xs text-primary"
                    >
                      {completingDev ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
                      <span>{locale === "ur" ? "ڈیمو ادائیگی کی تصدیق" : "Confirm Demo Payment"}</span>
                    </Button>
                  ) : null}
                </div>

                {!waited ? (
                  <p className="mt-4 text-xs text-muted">
                    {dict.booking.checkoutReturnWaiting}
                  </p>
                ) : null}
              </>
            )}
          </Card>
        </Container>
      </Section>
    </>
  );
}