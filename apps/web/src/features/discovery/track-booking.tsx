"use client";

import { useMemo, useState } from "react";
import { ArrowRight, CheckCircle2, Clock3, MapPin, ReceiptText, Search, ShieldCheck } from "lucide-react";
import type { Dictionary } from "@/lib/dictionaries";
import type { Booking } from "@/lib/types";
import { areas, getService, providers } from "@/lib/data";
import { formatDateTime, formatMoney, localizedPath, type Locale } from "@/lib/utils";
import { ButtonLink, Card, StatusBadge } from "@/components/ui";

const flow = ["REQUESTED", "SCHEDULED", "EN_ROUTE", "IN_PROGRESS", "AWAITING_VERIFICATION", "VERIFIED", "COMPLETED"] as const;

type FlowStatus = (typeof flow)[number];

function moneyState(booking: Booking, label: string) {
  if (booking.paymentStatus === "RELEASED") return { tone: "done" as const, label };
  if (booking.paymentStatus === "REFUNDED") return { tone: "warn" as const, label: "Refunded to the original method" };
  return { tone: "held" as const, label: "Held in escrow until a passing outcome" };
}

export function TrackBooking({ locale, dict, bookings }: { locale: Locale; dict: Dictionary; bookings: Booking[] }) {
  const [query, setQuery] = useState("");
  const [code, setCode] = useState<string | null>(null);

  const booking = useMemo(() => {
    const needle = (code ?? query).trim().toUpperCase();
    if (!needle) return null;
    return bookings.find((item) => item.code.toUpperCase() === needle) ?? null;
  }, [bookings, code, query]);

  const notFoundYet = (code ?? query).trim().length > 3 && !booking;

  return (
    <div>
      <Card className="p-6 sm:p-8">
        <label htmlFor="track-code" className="text-sm font-semibold text-navy">{dict.trackPage.label}</label>
        <p className="mt-1.5 text-sm text-secondary">{dict.trackPage.hint}</p>
        <form
          className="mt-5 flex flex-col gap-3 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            setCode(query);
          }}
        >
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
        </form>

        {notFoundYet ? (
          <p className="mt-5 rounded-[9px] border border-dashed border-line bg-slate-50 px-4 py-3 text-sm text-secondary">
            {dict.trackPage.notFound.replace("{code}", (code ?? query).trim().toUpperCase())}
          </p>
        ) : null}
      </Card>

      {booking ? <Result locale={locale} dict={dict} booking={booking} /> : null}
    </div>
  );
}

function Result({ locale, dict, booking }: { locale: Locale; dict: Dictionary; booking: Booking }) {
  const service = getService(booking.serviceSlug);
  const provider = booking.providerId ? providers.find((item) => item.id === booking.providerId) : null;
  const area = areas.find((item) => item.slug === booking.areaSlug);
  const reachedIndex = flow.indexOf(booking.status as FlowStatus);
  const offTrack = booking.status === "CANCELLED" || booking.status === "DISPUTED";
  const money = moneyState(booking, "Released to the professional");

  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
      <Card className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-mono text-xs tracking-[0.1em] text-muted">{booking.code}</p>
            <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em] text-navy">{service?.name[locale] ?? booking.serviceSlug}</h2>
          </div>
          <StatusBadge status={booking.status} label={dict.status[booking.status]} />
        </div>

        <ol className="mt-7 grid gap-0">
          {offTrack ? (
            <li className="flex items-start gap-3 rounded-[9px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              {dict.status[booking.status as "CANCELLED" | "DISPUTED"]}
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
                  <span className={done ? "font-medium text-navy" : "text-muted"}>{dict.status[status as FlowStatus]}</span>
                </span>
              </li>
            );
          })}
        </ol>
      </Card>

      <div className="grid content-start gap-6">
        <Card className="p-5">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-primary-strong">{dict.common.status}</p>
          <dl className="mt-4 grid gap-3 text-sm">
            <div className="flex items-start gap-2.5"><Clock3 className="mt-0.5 size-4 shrink-0 text-slate-400" /><span className="text-secondary">{formatDateTime(booking.scheduledStart, locale)}</span></div>
            <div className="flex items-start gap-2.5"><MapPin className="mt-0.5 size-4 shrink-0 text-slate-400" /><span className="text-secondary">{area?.name[locale] ?? booking.areaSlug}</span></div>
            <div className="flex items-start gap-2.5"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-slate-400" /><span className="text-secondary">{provider?.name ?? dict.portal.newRequest}</span></div>
          </dl>
        </Card>

        <Card className="p-5">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-primary-strong">{dict.common.amount}</p>
          <p className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-navy">{formatMoney(booking.finalPaisa ?? booking.quotedPaisa, locale)}</p>
          <p className="mt-2 flex items-start gap-2 text-xs leading-5">
            {money.tone === "done" ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600" /> : <ReceiptText className="mt-0.5 size-3.5 shrink-0 text-slate-400" />}
            <span className={money.tone === "done" ? "text-emerald-700" : money.tone === "warn" ? "text-amber-700" : "text-muted"}>{money.label}</span>
          </p>
        </Card>

        <ButtonLink href={localizedPath(locale, "/how-verification-works")} variant="secondary" className="w-full">
          {dict.nav.howWeVerify}
        </ButtonLink>
      </div>
    </div>
  );
}
