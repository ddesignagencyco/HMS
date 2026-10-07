/* Choosing a professional, or letting the platform choose one.

   `POST /bookings` treats a missing `providerId` as a real product choice, not
   an omission: the booking is auto-assigned, offered to ranked professionals one
   at a time until one accepts (FR-SR-07), and goes UNFULFILLED — with any
   captured money refunded — if nobody does within the platform's window.

   The two paths differ in what the customer can be told, and that difference is
   the reason this is one screen rather than a checkbox:

   · Choosing a professional means a **slot**, which only exists for a named
     professional: `/search/providers/:id/slots` is keyed on a provider. So a
     chosen professional gets real availability and a real price.
   · Auto-assign means **no slot can be shown at all** — there is no provider to
     ask. So the customer picks a preferred time window and is told plainly that
     the exact professional and start time are confirmed when somebody accepts,
     and that the platform offers it to the nearest eligible professionals in
     turn.

   Pretending an auto-assign booking has a confirmed slot would be the single
   most misleading thing this flow could do, so it says so on screen instead. */

import { CalendarDays, Sparkles, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Dictionary } from "@/lib/dictionaries";
import { cn, type Locale } from "@/lib/utils";
import { formatDistance, ratingOf } from "@/features/search/location";
import { RadioGroup, RadioGroupItem } from "@/components/ui";
import { money } from "@/features/catalogue/pricing";
import type { ProviderSearchResult } from "@/features/search/api";

export type ProviderChoice = { kind: "provider"; providerId: string } | { kind: "auto" };

export const AUTO_ASSIGN: ProviderChoice = { kind: "auto" };

export const isAutoAssign = (choice: ProviderChoice | null): boolean => choice?.kind === "auto";

/**
 * A day the customer can ask for. The API's availability window is 14 days
 * ahead for a named professional, and auto-assign has no such limit, so the
 * picker offers the same 14 days either way and the server has the final word.
 */
export type ScheduleRequest = {
  /** Local Asia/Karachi day, `YYYY-MM-DD`. */
  date: string;
  /** Half-hour start the customer asked for, as an ISO instant. */
  start: string;
  end: string;
};

const SLOT_MINUTES = 90;

export const slotEndFrom = (startIso: string, minutes = SLOT_MINUTES): string =>
  new Date(new Date(startIso).getTime() + minutes * 60_000).toISOString();

/**
 * The half-hour starts offered for a day, built from the service's expected
 * duration rather than from the provider's calendar — because for auto-assign
 * there is no provider calendar to read.
 *
 * These are *requested* times, and the UI labels them that way. For a named
 * professional the flow uses `/slots` instead and this list is not shown.
 */
/**
 * Checkout refuses a start inside `booking.min_notice_min` (seeded at 30) with
 * 400 "This service needs at least 30 minutes' notice". The slot listing and
 * checkout both read that setting so a listed time is always bookable, but this
 * list is built here rather than fetched, so without this filter the customer is
 * offered 09:00 at 15:30 and then told the time is in the past. Matches
 * `windowRefusal` in packages/domain/src/sameDay.ts.
 */
export const MIN_NOTICE_MINUTES = 30;

export const requestedWindows = (
  date: string,
  durationMin: number,
  now: Date = new Date(),
): { start: string; end: string }[] => {
  const windows: { start: string; end: string }[] = [];
  const earliest = now.getTime() + MIN_NOTICE_MINUTES * 60_000;
  /* A working day in Asia/Karachi, which is UTC+5 with no daylight saving, so
     the offset is fixed and the local hour can be converted exactly. */
  for (let hour = 9; hour + Math.ceil(durationMin / 60) <= 20; hour += 1) {
    const localMinutes = hour * 60;
    const start = new Date(`${date}T00:00:00+05:00`);
    start.setMinutes(localMinutes);
    /* Today, the hours that have gone — and the one inside the notice period —
       are not choices. They are removed rather than disabled so the step cannot
       be completed into a refusal. */
    if (start.getTime() < earliest) continue;
    windows.push({ start: start.toISOString(), end: new Date(start.getTime() + durationMin * 60_000).toISOString() });
  }
  return windows;
};

const labelTag = (locale: Locale): string => (locale === "ur" ? "ur-PK" : "en-PK");

const formatTime = (iso: string, locale: Locale): string =>
  new Intl.DateTimeFormat(labelTag(locale), {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Karachi",
    hour12: undefined,
  }).format(new Date(iso));

const formatDay = (date: string, locale: Locale): string =>
  new Intl.DateTimeFormat(labelTag(locale), { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Karachi" }).format(
    new Date(`${date}T00:00:00+05:00`),
  );

export function ProviderChoiceStep({
  locale,
  dict,
  choice,
  onChange,
  providers,
  searching,
  hasLocation,
}: {
  locale: Locale;
  dict: Dictionary;
  choice: ProviderChoice | null;
  onChange: (choice: ProviderChoice) => void;
  providers: ProviderSearchResult[];
  searching: boolean;
  hasLocation: boolean;
}) {
  const canAuto = true;
  const nothingToOffer = !searching && hasLocation && providers.length === 0;

  return (
    <div>
      <h2 className="text-xl font-semibold text-navy">{dict.booking.providerTitle}</h2>
      <p className="mt-1 text-sm text-secondary">{dict.booking.providerText}</p>

      <RadioGroup value={choice?.kind ?? ""} onValueChange={(value) => onChange(value === "auto" ? AUTO_ASSIGN : { kind: "provider", providerId: "" })} className="mt-6 grid gap-3">
        {canAuto ? (
          <label
            className={cn(
              "flex cursor-pointer items-start gap-4 rounded-[12px] border p-4 transition",
              choice?.kind === "auto" ? "border-primary bg-blue-50" : "border-line hover:border-slate-300",
            )}
          >
            <RadioGroupItem value="auto" className="mt-1" />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 font-semibold text-navy">
                <Sparkles className="size-4 text-amber-500" aria-hidden="true" />
                {dict.booking.autoAssignTitle}
              </span>
              <span className="mt-1 block text-sm leading-6 text-secondary">{dict.booking.autoAssignText}</span>
              <span className="mt-2 block text-xs font-medium text-primary-strong">{dict.booking.autoAssignAction}</span>
            </span>
          </label>
        ) : null}
      </RadioGroup>

      {providers.length > 0 ? (
        <div className="mt-6">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted">
            <Users className="size-3.5" aria-hidden="true" />
            {dict.booking.chooseProvider}
          </p>
          <RadioGroup
            value={choice?.kind === "provider" ? choice.providerId : ""}
            onValueChange={(value) => onChange({ kind: "provider", providerId: value })}
            className="mt-3 grid gap-3"
          >
            {providers.map((provider) => {
              const selected = choice?.kind === "provider" && choice.providerId === provider.providerId;
              const rating = ratingOf(provider.ratingScore);
              return (
                <label
                  key={provider.providerId}
                  className={cn(
                    "flex cursor-pointer items-start gap-4 rounded-[12px] border p-4 transition",
                    selected ? "border-primary bg-blue-50" : "border-line hover:border-slate-300",
                  )}
                >
                  {/* Relative, because the stretched link inside needs an anchor —
                      without it the overlay covers unrelated UI. See
                      PROJECT_PROGRESS.md §9 trap 5. */}
                  <RadioGroupItem value={provider.providerId} className="mt-1" />
                  <span className="relative min-w-0 flex-1">
                    <span className="block font-semibold text-navy">{provider.qualification ?? dict.booking.professionalFallback}</span>
                    <span className="mt-1 block text-xs text-secondary">
                      {provider.bio ?? dict.booking.noBio}
                    </span>
                    <span className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-medium text-muted">
                      {provider.experienceYears !== null ? (
                        <span>
                          {dict.booking.yearsExperience} · {provider.experienceYears}
                        </span>
                      ) : null}
                      <span>{formatDistance(provider.distanceM, labelTag(locale))}</span>
                      <span className="font-semibold text-navy">{money(provider.pricePaisa, locale)}</span>
                    </span>
                    {rating.rated ? (
                      <span className="mt-1 block text-xs text-muted">
                        {dict.booking.ratingSummary} · {rating.score.toFixed(1)} / 5 ({provider.ratingCount})
                      </span>
                    ) : (
                      /* `ratingScore` is null for an unrated professional and the
                         API still ranks them on it, so there is no score to print
                         here — not 0, and not the ranking prior. */
                      <span className="mt-1 block text-xs text-muted">{dict.booking.noRatingsYet}</span>
                    )}
                  </span>
                </label>
              );
            })}
          </RadioGroup>
        </div>
      ) : null}

      {searching ? <p className="mt-4 text-sm text-secondary" aria-busy="true">{dict.booking.searchingProviders}</p> : null}
      {nothingToOffer ? (
        <p className="mt-4 rounded-[9px] border border-line bg-surface-2 p-4 text-sm leading-6 text-secondary">{dict.booking.noProviders}</p>
      ) : null}
      {!hasLocation ? <p className="mt-4 text-sm text-secondary">{dict.booking.providersNeedLocation}</p> : null}
    </div>
  );
}

/**
 * The day picker, shared by both paths.
 *
 * A named professional's days come from `/slots` and are refetched per provider
 * and per service; auto-assign has no such source, so this offers the platform's
 * 14-day window and says the time is requested rather than held.
 */
export function DayPicker({
  dict,
  days,
  selected,
  onSelect,
}: {
  dict: Dictionary;
  days: { value: string; label: string }[];
  selected: string;
  onSelect: (date: string) => void;
}) {
  return (
    <div className="grid gap-2">
      <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-muted">
        <CalendarDays className="size-3.5" aria-hidden="true" />
        {dict.booking.scheduleTitle}
      </span>
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {days.map((day) => (
          <button
            key={day.value}
            type="button"
            onClick={() => onSelect(day.value)}
            aria-pressed={day.value === selected}
            className={cn(
              "min-h-11 shrink-0 rounded-[9px] border px-3 text-xs font-semibold transition-colors duration-200",
              day.value === selected ? "border-primary bg-blue-50 text-primary-strong" : "border-line bg-white text-secondary hover:bg-slate-50",
            )}
          >
            {day.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Start times for an auto-assign request.
 *
 * Deliberately a *request*: no slot is held and none can be, because the
 * professional is not chosen yet. The API's own answer to a clash — 409
 * `SLOT_TAKEN` — is handled by the caller, never hidden here.
 */
export function RequestedWindowPicker({
  locale,
  dict,
  date,
  durationMin,
  selected,
  onSelect,
}: {
  locale: Locale;
  dict: Dictionary;
  date: string;
  durationMin: number;
  selected: ScheduleRequest | null;
  onSelect: (window: ScheduleRequest) => void;
}) {
  /* The list depends on "now": a start inside the notice period has to stop
     being on offer by itself rather than sit there until checkout refuses it.
     Reading the clock during render would be impure, so it is sampled in an
     effect and held in state — one re-render a minute is plenty of resolution
     for a 30-minute rule. */
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const windows = useMemo(() => requestedWindows(date, durationMin, now), [date, durationMin, now]);
  const hasDuration = windows.length > 0;

  return (
    <div className="grid gap-3">
      <p className="text-sm font-semibold text-navy">{dict.booking.requestedTimeTitle}</p>
      <p className="text-sm leading-6 text-secondary">{dict.booking.requestedTimeText}</p>
      {hasDuration ? (
        <div className="mt-1 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {windows.map((window) => {
            const active = selected?.start === window.start;
            return (
              <button
                key={window.start}
                type="button"
                onClick={() => onSelect({ date, ...window })}
                aria-pressed={active}
                className={cn(
                  "min-h-11 whitespace-nowrap rounded-[9px] border px-3 text-sm font-semibold tabular-nums transition-colors duration-200",
                  active ? "border-primary bg-blue-50 text-primary-strong" : "border-line bg-white text-navy hover:bg-slate-50",
                )}
              >
                {formatTime(window.start, locale)}
              </button>
            );
          })}
        </div>
      ) : (
        <p className="rounded-[9px] border border-line bg-surface-2 p-4 text-sm leading-6 text-secondary">{dict.booking.noWindowsThatDay}</p>
      )}
      {selected !== null ? (
        <p className="rounded-[9px] border border-amber-200 bg-amber-50 p-3.5 text-sm leading-6 text-amber-900">
          {dict.booking.requestedWindowChosen} · {formatDay(selected.date, locale)}, {formatTime(selected.start, locale)}–{formatTime(selected.end, locale)}
        </p>
      ) : null}
    </div>
  );
}

export { formatDay, formatTime };