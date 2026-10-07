"use client";

import { useMemo, useState } from "react";
import { ArrowRight, CheckCircle2, Clock3, ReceiptText, Search, ShieldCheck } from "lucide-react";
import Link from "next/link";
import type { Dictionary } from "@/lib/dictionaries";
import { formatDateTime, formatMoney, localizedPath, type Locale } from "@/lib/utils";
import { ButtonLink, Card, StatusBadge } from "@/components/ui";
import { useMyBookings } from "@/features/booking/queries";
import { bookingTotalPaisa } from "@/features/booking/status";
import type { Booking, BookingStatus } from "@/features/booking/api";
import { useSession } from "@/features/auth/session";
import { signInPath } from "@/features/auth/routing";

/* Where a customer checks on a booking.
 *
   This used to search a hardcoded array and, for any code typed into it, print a
   professional's name, a service name and an area drawn from that file. That is
   worse than no page: it answers a real question with a fabricated job, to a
   customer who has just paid for something.
   The API deliberately has no public lookup by code — `GET /bookings` and
   `GET /bookings/:id` are both scoped to the booking's own customer or provider,
   and 404 for anyone else — so an anonymous tracker cannot be built honestly
   here. What the API *does* support is the signed-in customer listing their own
   bookings, so this screen does that and says plainly why sign-in is needed. */

const flow = ["REQUESTED", "ACCEPTED", "SCHEDULED", "EN_ROUTE", "IN_PROGRESS", "WORK_COMPLETED", "AWAITING_VERIFICATION", "VERIFIED"] as const;

type FlowStatus = (typeof flow)[number];

function moneyState(paymentStatus: string, label: string) {
  if (paymentStatus === "RELEASED") return { tone: "done" as const, label };
  if (paymentStatus === "REFUNDED" || paymentStatus === "PARTIALLY_REFUNDED") return { tone: "warn" as const, label: "Refunded to the original method" };
  return { tone: "held" as const, label: "Held in escrow until a passing outcome" };
}

export function TrackBooking({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const { status: sessionStatus } = useSession();
  const bookings = useMyBookings(undefined, locale);
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    const sorted = [...(bookings.data?.items ?? [])].sort((a, b) => b.scheduledStart.localeCompare(a.scheduledStart));
    const needle = query.trim().toUpperCase();
    /* Filtering the real list by the code the customer typed. An empty box shows
       the newest few rather than nothing, so the page is useful before typing. */
    return needle === "" ? sorted.slice(0, 5) : sorted.filter((item) => item.code.toUpperCase().includes(needle));
  }, [bookings.data, query]);

  /* An anonymous visitor cannot be answered here at all. Saying so beats a
     search box that always comes up empty and looks broken. */
  if (sessionStatus === "anonymous") {
    return (
      <Card className="p-6 sm:p-8">
        <h2 className="text-xl font-semibold text-navy">{dict.trackPage.signInRequiredTitle}</h2>
        <p className="mt-2 max-w-prose text-sm leading-6 text-secondary">{dict.trackPage.signInRequiredText}</p>
        <ButtonLink href={signInPath(locale, localizedPath(locale, "/track"))} className="mt-5">
          {dict.nav.signIn}
          <ArrowRight className="size-4 rtl:rotate-180" aria-hidden="true" />
        </ButtonLink>
      </Card>
    );
  }

  if (sessionStatus === "loading") {
    return (
      <Card className="p-6 sm:p-8" aria-busy="true">
        <span className="skeleton block h-6 w-64 rounded-[9px]" />
        <span className="skeleton mt-3 block h-4 w-full max-w-lg rounded-[9px]" />
      </Card>
    );
  }

  if (bookings.isError) {
    return (
      <div role="alert" className="rounded-[12px] bg-rose-50 p-5 text-sm text-rose-800">
        {dict.trackPage.loadError}
        <ButtonLink href={localizedPath(locale, "/track")} variant="secondary" size="sm" className="ms-3">
          {dict.catalogue.retry}
        </ButtonLink>
      </div>
    );
  }

  const searched = query.trim() !== "";

  return (
    <div>
      <Card className="p-6 sm:p-8">
        <label htmlFor="track-code" className="text-sm font-semibold text-navy">{dict.trackPage.label}</label>
        <p className="mt-1.5 text-sm text-secondary">{dict.trackPage.hint}</p>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          <span className="flex min-h-12 flex-1 items-center gap-2 rounded-[9px] border border-line px-3">
            <Search className="size-4 shrink-0 text-slate-400" />
            <input
              id="track-code"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={dict.trackPage.placeholder}
              className="focus-none w-full bg-transparent font-mono text-sm tracking-[0.08em] text-navy"
            />
          </span>
          <button type="submit" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-[9px] bg-primary px-6 text-sm font-semibold text-white transition hover:bg-primary-strong">
            {dict.trackPage.submit}
            <ArrowRight className="size-4 rtl:rotate-180" aria-hidden="true" />
          </button>
        </div>

        {searched && rows.length === 0 && bookings.isSuccess ? (
          <p className="mt-5 rounded-[9px] border border-dashed border-line bg-slate-50 px-4 py-3 text-sm text-secondary">
            {dict.trackPage.notFound.replace("{code}", query.trim().toUpperCase())}
          </p>
        ) : null}
      </Card>

      {rows.length === 0 && !searched && bookings.isSuccess ? (
        <p className="mt-6 rounded-[12px] border border-line bg-white p-6 text-sm leading-6 text-secondary">{dict.trackPage.noBookingsYet}</p>
      ) : null}

      <div className="mt-6 grid gap-6">
        {rows.map((booking) => (
          <Result key={booking.id} locale={locale} dict={dict} booking={booking} />
        ))}
      </div>

      {bookings.isSuccess && (bookings.data?.items.length ?? 0) > 5 ? (
        <p className="mt-6 text-sm text-secondary">
          <Link href={localizedPath(locale, "/account/bookings")} className="font-semibold text-primary-strong hover:underline">
            {dict.portal.bookings}
          </Link>
        </p>
      ) : null}
    </div>
  );
}

function Result({ locale, dict, booking }: { locale: Locale; dict: Dictionary; booking: Booking }) {
  const reachedIndex = flow.indexOf(booking.status as FlowStatus);
  const offTrack = booking.status === "CANCELLED_CUSTOMER" || booking.status === "CANCELLED_PROVIDER" || booking.status === "ABANDONED" || booking.status === "UNFULFILLED";
  const money = moneyState(booking.paymentStatus, "Released to the professional");

  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs tracking-[0.1em] text-muted">{booking.code}</p>
          {/* The service is an id on the row; the account's own booking pages join
              the name from the catalogue, and the detail link is where the real
              names live rather than being invented here. */}
          <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em] text-navy">{dict.common.service}</h2>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={booking.status} label={dict.bookingStatus[booking.status as BookingStatus] ?? booking.status} />
          <ButtonLink href={localizedPath(locale, `/account/bookings/${booking.id}`)} variant="secondary" size="sm">
            {dict.booking.viewBooking}
          </ButtonLink>
        </div>
      </div>

      <ol className="mt-7 grid gap-0">
        {offTrack ? (
          <li className="flex items-start gap-3 rounded-[9px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {dict.bookingStatus[booking.status as BookingStatus] ?? booking.status}
          </li>
        ) : null}
        {flow.map((status, index) => {
          const done = reachedIndex >= 0 && index <= reachedIndex;
          return (
            <li key={status} className="relative flex gap-4 pb-6 last:pb-0">
              {index < flow.length - 1 ? <span aria-hidden="true" className={`absolute start-[15px] top-8 h-full w-px ${done ? "bg-primary" : "bg-line"}`} /> : null}
              <span className={`relative z-10 grid size-8 shrink-0 place-items-center rounded-full text-[11px] font-bold tabular-nums ${done ? "bg-primary text-white" : "bg-slate-100 text-muted"}`}>
                {done ? <CheckCircle2 className="size-4" aria-hidden="true" /> : index + 1}
              </span>
              <span className="pt-1.5 text-sm">
                <span className={done ? "font-medium text-navy" : "text-muted"}>{dict.bookingStatus[status as BookingStatus] ?? status}</span>
              </span>
            </li>
          );
        })}
      </ol>

      <div className="mt-6 grid gap-6 sm:grid-cols-2">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-primary-strong">{dict.common.status}</p>
          <dl className="mt-4 grid gap-3 text-sm">
            <div className="flex items-start gap-2.5"><Clock3 className="mt-0.5 size-4 shrink-0 text-slate-400" /><span className="text-secondary">{formatDateTime(booking.scheduledStart, locale)}</span></div>
            {/* No professional name and no area here: neither is on the list row,
                and printing the ID in place of a name helps nobody. The booking
                page carries both. */}
            <div className="flex items-start gap-2.5"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-slate-400" /><span className="text-secondary">{isAwaitingProvider(booking) ? dict.booking.awaitingAssignment : dict.portal.professionalNameUnavailable}</span></div>
          </dl>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-primary-strong">{dict.common.amount}</p>
          <p className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-navy">{formatMoney(bookingTotalPaisa(booking), locale)}</p>
          <p className="mt-2 flex items-start gap-2 text-xs leading-5">
            {money.tone === "done" ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600" /> : <ReceiptText className="mt-0.5 size-3.5 shrink-0 text-slate-400" />}
            <span className={money.tone === "done" ? "text-emerald-700" : money.tone === "warn" ? "text-amber-700" : "text-muted"}>{money.label}</span>
          </p>
        </div>
      </div>
    </Card>
  );
}

const isAwaitingProvider = (booking: { isAutoAssign: boolean; providerId: string | null }): boolean =>
  booking.isAutoAssign && booking.providerId === null;