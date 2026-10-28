"use client";

import { useEffect, useState, type ReactNode } from "react";
import { CheckCircle2, Clock, Info, RotateCcw, XCircle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import type { Dictionary } from "@/lib/dictionaries";
import { localizedPath, type Locale } from "@/lib/utils";
import { Button, ButtonLink, Card, Container, PageBanner, Section } from "@/components/ui";
import { useBooking } from "@/features/booking/queries";
import { bookingKeys } from "@/lib/api/keys";
import { money } from "@/features/catalogue/pricing";
import { bookingTotalPaisa } from "@/features/booking/status";
import type { Booking, BookingStatus } from "@/features/booking/api";

const SETTLE_MS = 2_500;

/**
 * What the return leg can honestly say about a booking it has just re-read.
 *
 * · `confirmed` — the booking is REQUESTED or further along a live path *and*
 *   its money is HELD in escrow. A status alone is not enough: ABANDONED and
 *   UNFULFILLED are past PENDING_PAYMENT too, and neither is a paid booking.
 * · `abandoned` / `unfulfilled` / `cancelled` — the booking will not go ahead.
 * · `topupPending` / `topupSettled` — an ONLINE quote-revision top-up returns
 *   here as well (`approveQuoteRevision` uses the same return URL). The booking
 *   stays in QUOTE_REVISION until the top-up is captured, then goes back to
 *   IN_PROGRESS — which a rejected revision also does, so "settled" does not
 *   claim the extra work was approved.
 * · `pending` — still PENDING_PAYMENT, or live but not yet HELD.
 * · `movedOn` — the job is finished or closed; this page has nothing to add.
 */
export type CheckoutOutcome =
  | "pending"
  | "confirmed"
  | "abandoned"
  | "unfulfilled"
  | "cancelled"
  | "topupPending"
  | "topupSettled"
  | "movedOn";

/** Live statuses at or after REQUESTED where an initial payment is still escrowed. */
const LIVE_PAID_STATUSES: readonly BookingStatus[] = [
  "REQUESTED",
  "ACCEPTED",
  "SCHEDULED",
  "EN_ROUTE",
  "WORK_COMPLETED",
  "AWAITING_VERIFICATION",
  "REWORK_REQUIRED",
  "VERIFIED",
  "AUTO_RELEASED",
  "DISPUTED",
];

export const checkoutOutcome = (booking: Pick<Booking, "status" | "paymentStatus">): CheckoutOutcome => {
  switch (booking.status) {
    case "PENDING_PAYMENT":
      return "pending";
    case "ABANDONED":
      return "abandoned";
    case "UNFULFILLED":
      return "unfulfilled";
    case "CANCELLED_CUSTOMER":
    case "CANCELLED_PROVIDER":
      return "cancelled";
    case "QUOTE_REVISION":
      return "topupPending";
    case "IN_PROGRESS":
      return "topupSettled";
    default:
      if (LIVE_PAID_STATUSES.includes(booking.status)) return booking.paymentStatus === "HELD" ? "confirmed" : "pending";
      return "movedOn";
  }
};

export function CheckoutReturn({ locale, dict, bookingId }: { locale: Locale; dict: Dictionary; bookingId: string }) {
  const queryClient = useQueryClient();
  const booking = useBooking(bookingId, locale);
  const [waited, setWaited] = useState(false);
  const { refetch } = booking;

  useEffect(() => {
    // Invalidate details immediately upon return to observe freshly ingested webhooks
    void queryClient.invalidateQueries({ queryKey: bookingKeys.detail(bookingId) });
    void queryClient.invalidateQueries({ queryKey: bookingKeys.list() });

    const timer = setTimeout(() => {
      setWaited(true);
      void refetch();
    }, SETTLE_MS);

    return () => clearTimeout(timer);
  }, [bookingId, queryClient, refetch]);

  const target = localizedPath(locale, `/account/bookings/${bookingId}`);
  const current = booking.data;
  const outcome: CheckoutOutcome = current === undefined ? "pending" : checkoutOutcome(current);
  const b = dict.booking;

  const viewBooking = (
    <ButtonLink href={target}>{b.viewBooking}</ButtonLink>
  );
  const refresh = (
    <Button
      type="button"
      variant="secondary"
      onClick={() => void booking.refetch()}
      disabled={booking.isFetching}
      className="gap-1.5"
    >
      <RotateCcw className={`size-3.5 ${booking.isFetching ? "animate-spin" : ""}`} />
      <span>{b.checkoutRefresh}</span>
    </Button>
  );
  const browse = (
    <ButtonLink href={localizedPath(locale, "/services")} variant="secondary">
      {dict.search.browseCatalogue}
    </ButtonLink>
  );

  const bannerTitle: Record<CheckoutOutcome, string> = {
    pending: b.checkoutReturnTitle,
    confirmed: b.successTitle,
    abandoned: b.checkoutAbandonedTitle,
    unfulfilled: b.checkoutUnfulfilledTitle,
    cancelled: b.checkoutCancelledTitle,
    topupPending: b.checkoutTopupTitle,
    topupSettled: b.checkoutTopupTitle,
    movedOn: b.checkoutReturnAction,
  };

  let body: ReactNode;
  switch (outcome) {
    case "confirmed":
      body = (
        <Panel tone="success" title={b.checkoutPaidTitle} text={b.checkoutPaidText}>
          {current ? (
            <dl className="mt-6 grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-4 text-xs text-left">
              <div>
                <dt className="text-muted">{dict.common.service}</dt>
                <dd className="font-semibold text-navy truncate">
                  {(locale === "ur" ? (current.serviceNameUr ?? current.serviceName) : current.serviceName) ?? dict.common.service}
                </dd>
              </div>
              <div>
                <dt className="text-muted">{b.total}</dt>
                <dd className="font-semibold text-navy tabular-nums">{money(bookingTotalPaisa(current), locale)}</dd>
              </div>
            </dl>
          ) : null}
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            {viewBooking}
            <ButtonLink href={localizedPath(locale, "/account/bookings")} variant="secondary">
              {dict.portal.bookings}
            </ButtonLink>
          </div>
        </Panel>
      );
      break;
    case "abandoned":
    case "unfulfilled":
    case "cancelled": {
      const copy = {
        abandoned: [b.checkoutAbandonedTitle, b.checkoutAbandonedText],
        unfulfilled: [b.checkoutUnfulfilledTitle, b.checkoutUnfulfilledText],
        cancelled: [b.checkoutCancelledTitle, b.checkoutCancelledText],
      }[outcome];
      body = (
        <Panel tone="failed" title={copy[0]} text={copy[1]}>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            {viewBooking}
            {browse}
          </div>
        </Panel>
      );
      break;
    }
    case "topupPending":
    case "topupSettled":
      body = (
        <Panel
          tone={outcome === "topupPending" ? "pending" : "info"}
          title={b.checkoutTopupTitle}
          text={outcome === "topupPending" ? b.checkoutTopupPendingText : b.checkoutTopupSettledText}
        >
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            {viewBooking}
            {outcome === "topupPending" ? refresh : null}
          </div>
        </Panel>
      );
      break;
    case "movedOn":
      body = (
        <Panel tone="info" title={b.checkoutReturnAction} text={b.checkoutMovedOnText}>
          <div className="mt-6 flex flex-wrap justify-center gap-3">{viewBooking}</div>
        </Panel>
      );
      break;
    default:
      body = (
        <Panel tone="pending" title={b.checkoutReturnTitle} text={b.checkoutReturnText}>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <ButtonLink href={target}>{b.checkoutReturnAction}</ButtonLink>
            {refresh}
          </div>
          {!waited ? <p className="mt-4 text-xs text-muted">{b.checkoutReturnWaiting}</p> : null}
        </Panel>
      );
  }

  return (
    <>
      <PageBanner eyebrow={b.reference} title={bannerTitle[outcome]} titleAccent={current?.code} />
      <Section tone="surface" size="default">
        <Container>
          <Card className="mx-auto max-w-xl p-8 text-center" aria-live="polite">
            {body}
          </Card>
        </Container>
      </Section>
    </>
  );
}

const PANEL_TONES = {
  success: { className: "bg-emerald-50 text-emerald-700", Icon: CheckCircle2 },
  failed: { className: "bg-rose-50 text-rose-700", Icon: XCircle },
  pending: { className: "bg-amber-50 text-amber-700 animate-pulse", Icon: Clock },
  info: { className: "bg-sky-50 text-sky-700", Icon: Info },
} as const;

function Panel({
  tone,
  title,
  text,
  children,
}: {
  tone: keyof typeof PANEL_TONES;
  title: string;
  text: string;
  children?: ReactNode;
}) {
  const { className, Icon } = PANEL_TONES[tone];
  return (
    <>
      <span className={`mx-auto grid size-14 place-items-center rounded-full ${className}`}>
        <Icon className="size-7" />
      </span>
      <h2 className="mt-4 text-xl font-bold text-navy">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-secondary">{text}</p>
      {children}
    </>
  );
}
