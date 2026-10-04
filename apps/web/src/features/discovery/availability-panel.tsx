"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CalendarDays, Timer, Wrench } from "lucide-react";
import type { Dictionary } from "@/lib/dictionaries";
import { cn, localizedPath, type Locale } from "@/lib/utils";
import { buttonStyles } from "@/components/ui";
import { money } from "@/features/catalogue/pricing";
import { useProviderSlots } from "@/features/search/queries";
import { formatSlotTime } from "@/features/search/location";
import { addDays, SLOT_WINDOW_DAYS, toApiDate } from "@/features/search/types";
import { InlineError, LoadingSkeleton } from "./states";

import { SelectField } from "@/components/select-field";

/* Availability, from `GET /search/providers/:providerId/slots`.

   The endpoint needs a `serviceId` and a local (Asia/Karachi) day, so neither is
   requested until both exist. Slots are the API's current availability, never a
   reservation, and the panel says so rather than implying a held time. */

type Offer = { serviceId: number; slug: string; nameEn: string; pricePaisa: number };

export function AvailabilityPanel({
  locale,
  dict,
  providerId,
  services,
}: {
  locale: Locale;
  dict: Dictionary;
  providerId: string;
  services: Offer[];
}) {
  const [serviceSlug, setServiceSlug] = useState<string>(services[0]?.slug ?? "");
  const [selectedDate, setSelectedDate] = useState<string>(() => toApiDate(new Date()));
  const [start, setStart] = useState<string | null>(null);

  const tag = locale === "ur" ? "ur-PK" : "en-PK";
  const chosen = useMemo(() => services.find((item) => item.slug === serviceSlug) ?? null, [services, serviceSlug]);

  const days = useMemo(() => {
    const today = new Date();
    return Array.from({ length: SLOT_WINDOW_DAYS }, (_, index) => {
      const date = addDays(today, index);
      return { value: toApiDate(date), label: new Intl.DateTimeFormat(tag, { weekday: "short", day: "numeric", month: "short" }).format(date) };
    });
  }, [tag]);

  const slots = useProviderSlots(
    chosen === null ? null : providerId,
    chosen?.serviceId ?? null,
    chosen === null ? null : selectedDate,
    locale,
  );

  const selectedSlot = slots.data?.items.find((slot) => slot.start === start) ?? null;
  const canContinue = chosen !== null && selectedSlot !== null;
  /* `/book/[slug]` accepts a service slug and nothing else, so the hand-off is
     the service. Carrying the professional and the exact time needs that flow
     to accept them — see docs/PROJECT_PROGRESS.md §3.6. */
  const bookingHref = chosen === null ? localizedPath(locale, "/services") : localizedPath(locale, `/book/${chosen.slug}`);

  return (
    <div className="grid gap-5">
      <div className="grid gap-2">
        <label htmlFor="slot-service" className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-muted">
          <Wrench className="size-3.5" aria-hidden="true" />
          {dict.profile.chooseService}
        </label>
        <SelectField
          id="slot-service"
          value={serviceSlug}
          onChange={(val) => {
            setServiceSlug(val);
            setStart(null);
          }}
          isDisabled={services.length === 0}
          options={services.map((item) => ({
            value: item.slug,
            label: item.nameEn,
          }))}
          placeholder={dict.profile.chooseService}
        />
        {services.length === 0 ? <p className="text-xs text-muted">{dict.profile.bookingNone}</p> : null}
      </div>

      {chosen !== null ? (
        <div className="grid gap-2">
          <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-muted">
            <CalendarDays className="size-3.5" aria-hidden="true" />
            {dict.profile.chooseDate}
          </span>
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {days.map((day) => (
              <button
                key={day.value}
                type="button"
                onClick={() => {
                  setSelectedDate(day.value);
                  setStart(null);
                }}
                aria-pressed={day.value === selectedDate}
                className={cn(
                  "min-h-11 shrink-0 rounded-[9px] border px-3 text-xs font-semibold transition-colors duration-200",
                  day.value === selectedDate ? "border-primary bg-blue-50 text-primary-strong" : "border-line bg-white text-secondary hover:bg-slate-50",
                )}
              >
                {day.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {chosen === null ? null : slots.isPending ? (
        <div className="grid gap-2" aria-busy="true" aria-live="polite">
          <span className="text-xs text-muted">{dict.profile.slotsLoading}</span>
          <div className="grid grid-cols-3 gap-2">
            {Array.from({ length: 6 }, (_, index) => (
              <LoadingSkeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        </div>
      ) : slots.isError ? (
        <InlineError title={dict.profile.slotsError} actionLabel={dict.catalogue.retry} onRetry={() => void slots.refetch()} />
      ) : slots.data.items.length === 0 ? (
        <p className="rounded-[9px] border border-line bg-surface-2 p-4 text-sm leading-6 text-secondary">{dict.profile.slotsNone}</p>
      ) : (
        <div className="grid gap-2">
          {/* Two columns in the sticky panel and three once it has the full page
             width: at four columns "12:00 am" wrapped onto two lines, which made
             every start time harder to read than it needed to be. */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {slots.data.items.map((slot) => (
              <button
                key={slot.start}
                type="button"
                onClick={() => setStart(slot.start)}
                aria-pressed={slot.start === start}
                className={cn(
                  "min-h-10 whitespace-nowrap rounded-[9px] border px-2 text-sm font-semibold tabular-nums transition-colors duration-200",
                  slot.start === start ? "border-primary bg-blue-50 text-primary-strong" : "border-line bg-white text-navy hover:bg-slate-50",
                )}
              >
                {formatSlotTime(slot.start, tag)}
              </button>
            ))}
          </div>
          <p className="text-xs leading-5 text-muted">
            <Timer className="me-1 inline size-3" aria-hidden="true" />
            {dict.profile.availabilityNote}
          </p>
        </div>
      )}

      <div className="grid gap-3 border-t border-line pt-4">
        <dl className="grid gap-2 text-sm">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted">{dict.profile.bookingServiceLabel}</dt>
            <dd className="text-end font-medium text-navy">{chosen?.nameEn ?? dict.profile.bookingNone}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted">{dict.profile.bookingSlotLabel}</dt>
            <dd className="text-end font-medium text-navy tabular-nums">
              {selectedSlot === null ? dict.profile.bookingNone : formatSlotTime(selectedSlot.start, tag)}
            </dd>
          </div>
          {chosen !== null ? (
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted">{dict.catalogue.pricingHeading}</dt>
              <dd className="text-end font-medium text-navy tabular-nums">{money(chosen.pricePaisa, locale)}</dd>
            </div>
          ) : null}
        </dl>

        {canContinue ? (
          <Link href={bookingHref} className={buttonStyles({ className: "w-full" })}>
            {dict.profile.bookingAction}
          </Link>
        ) : (
          <button type="button" disabled className={buttonStyles({ className: "w-full" })}>
            {dict.profile.bookingAction}
          </button>
        )}
        <p className="text-xs leading-5 text-muted">{dict.profile.bookingHandoffNote}</p>
      </div>
    </div>
  );
}