"use client";

/* The five server-side search filters.
 *
 * **These were reachable in the API and in no screen.** `providerSearchQuerySchema`
 * accepts `minExperienceYears`, `minCompletedJobs`, `minPricePaisa`, `maxPricePaisa`,
 * `availableToday` and `verifiedDocsOnly`, and every one of them has been there
 * since the endpoint was written. What the search screen had instead was a filter
 * bar that re-filtered the *returned array* by rating and badge — which cannot
 * answer "who is free today" or "who charges under two thousand", because the
 * response carries neither availability nor a price for a different service. The
 * questions were not answerable at any level of client effort.
 *
 * Two conversions this component owns, both of which are quiet ways to get a
 * confidently wrong answer:
 *
 * · **Rupees on screen, paisa on the wire.** The inputs are in rupees because that
 *   is what a person types; `minPricePaisa` is compared against
 *   `provider_services.price_paisa`, so `500` sent where the schema wants `50000`
 *   would return nobody and read as "nobody under five hundred rupees".
 *
 * · **An inverted band is never sent.** `minPricePaisa` above `maxPricePaisa` is a
 *   422 from the schema's own `refine`. The screen says so inline rather than
 *   firing a request that cannot succeed.
 *
 * All state is local and nothing is written to the URL — see the note on
 * `providers-search.tsx`.
 */

import { Check, RotateCcw, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui";
import { isPriceBandValid } from "@/features/search/api";
import type { ProviderRefinement } from "@/features/search/types";
import type { Dictionary } from "@/lib/dictionaries";
import { formatNumber, type Locale } from "@/lib/utils";

const RUPEES_PER_100 = 100;

/** rupees in the box → paisa for the query. `null` for anything not a number,
 *  and for zero: `minPricePaisa`/`maxPricePaisa` are `.int().positive()`, so a 0
 *  would be a 422 — and "at least Rs 0" is no filter anyway. */
export const rupeesToPaisa = (raw: string): number | null => {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const rupees = Number(trimmed);
  if (!Number.isFinite(rupees)) return null;
  const paisa = Math.round(rupees * RUPEES_PER_100);
  return paisa > 0 ? paisa : null;
};

/** Upper bounds from `providerSearchQuerySchema` (`.int().min(0).max(n)`). */
export const MAX_EXPERIENCE_YEARS = 60;
export const MAX_COMPLETED_JOBS = 10_000;

/** A whole-number minimum for the query. Empty, non-numeric, zero or negative is
 *  "no filter" (`null`); a decimal is floored (the schema is `.int()`); anything
 *  above the schema's maximum is clamped to it rather than sent as a 422. */
export const parseWholeMinimum = (raw: string, max: number): number | null => {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return null;
  const whole = Math.min(Math.floor(parsed), max);
  return whole > 0 ? whole : null;
};

/** paisa on the wire → rupees in the box, so the two never drift apart. */
const paisaToRupees = (paisa: number | undefined): string => (paisa === undefined ? "" : String(paisa / RUPEES_PER_100));

export const hasAnyRefinement = (refinement: ProviderRefinement): boolean =>
  refinement.minExperienceYears !== undefined ||
  refinement.minCompletedJobs !== undefined ||
  refinement.minPricePaisa !== undefined ||
  refinement.maxPricePaisa !== undefined ||
  refinement.availableToday !== undefined ||
  refinement.verifiedDocsOnly !== undefined;

export function SearchRefinements({
  locale,
  dict,
  value,
  onChange,
  disabled
}: {
  locale: Locale;
  dict: Dictionary;
  value: ProviderRefinement;
  onChange: (next: ProviderRefinement) => void;
  /** True before a service and a point exist — the API cannot be asked yet. */
  disabled: boolean;
}) {
  const minRupees = paisaToRupees(value.minPricePaisa);
  const maxRupees = paisaToRupees(value.maxPricePaisa);
  const bandValid = isPriceBandValid(value);

  const field =
    "mt-1.5 w-full rounded-[9px] border border-line bg-white px-3 py-2.5 text-sm text-navy outline-none focus:border-primary focus:ring-4 focus:ring-blue-100 disabled:opacity-55";

  const update = (next: Partial<ProviderRefinement>) => onChange({ ...value, ...next });

  /** An empty number box means "no bound", not "zero" — sending 0 as a minimum
   *  price would exclude every free job and look like a filter that worked. */
  const onNumber = (key: "minPricePaisa" | "maxPricePaisa", raw: string) => {
    const paisa = rupeesToPaisa(raw);
    if (paisa === null) {
      const { [key]: _removed, ...rest } = value;
      onChange(rest);
      return;
    }
    update({ [key]: paisa } as Partial<ProviderRefinement>);
  };

  return (
    <div className={disabled ? "pointer-events-none opacity-55" : undefined}>
      <div className="flex items-center justify-between gap-2 border-t border-line pt-4">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-muted">
          <SlidersHorizontal className="size-3.5" aria-hidden="true" />
          {dict.search.refineHeading}
        </p>
        {hasAnyRefinement(value) ? (
          <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onChange({})}>
            <RotateCcw className="size-3" aria-hidden="true" />
            {dict.search.refineClear}
          </Button>
        ) : null}
      </div>

      {disabled ? <p className="mt-2 text-xs leading-5 text-muted">{dict.search.refineNeedsLocation}</p> : null}

      <label className="mt-4 flex items-start gap-3 text-sm leading-5 text-secondary">
        <input
          type="checkbox"
          checked={value.availableToday === true}
          onChange={(event) => update(event.target.checked ? { availableToday: true } : { availableToday: undefined })}
          className="mt-0.5 size-4 shrink-0 rounded border-line text-primary focus:ring-4 focus:ring-blue-100"
        />
        <span>
          {dict.search.refineAvailableToday}
          <span className="block text-xs text-muted">{dict.search.refineAvailableTodayHint}</span>
        </span>
      </label>

      <label className="mt-3 flex items-start gap-3 text-sm leading-5 text-secondary">
        <input
          type="checkbox"
          checked={value.verifiedDocsOnly === true}
          onChange={(event) => update(event.target.checked ? { verifiedDocsOnly: true } : { verifiedDocsOnly: undefined })}
          className="mt-0.5 size-4 shrink-0 rounded border-line text-primary focus:ring-4 focus:ring-blue-100"
        />
        <span>
          {dict.search.refineVerifiedDocs}
          <span className="block text-xs text-muted">{dict.search.refineVerifiedDocsHint}</span>
        </span>
      </label>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="refine-min-experience" className="text-xs font-semibold text-secondary">
            {dict.search.refineMinExperience}
          </label>
          <input
            id="refine-min-experience"
            type="number"
            inputMode="numeric"
            min={0}
            max={MAX_EXPERIENCE_YEARS}
            step={1}
            className={field}
            value={value.minExperienceYears ?? ""}
            onChange={(event) => {
              const parsed = parseWholeMinimum(event.target.value, MAX_EXPERIENCE_YEARS);
              update({ minExperienceYears: parsed ?? undefined });
            }}
          />
        </div>
        <div>
          <label htmlFor="refine-min-jobs" className="text-xs font-semibold text-secondary">
            {dict.search.refineMinJobs}
          </label>
          <input
            id="refine-min-jobs"
            type="number"
            inputMode="numeric"
            min={0}
            max={MAX_COMPLETED_JOBS}
            step={1}
            className={field}
            value={value.minCompletedJobs ?? ""}
            onChange={(event) => {
              const parsed = parseWholeMinimum(event.target.value, MAX_COMPLETED_JOBS);
              update({ minCompletedJobs: parsed ?? undefined });
            }}
          />
        </div>
      </div>

      <p className="mt-4 text-xs font-semibold text-secondary">{dict.search.refinePriceBand}</p>
      <div className="mt-1.5 grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="refine-min-price" className="sr-only">
            {dict.search.refineMinPrice}
          </label>
          <input
            id="refine-min-price"
            type="number"
            inputMode="decimal"
            min={0}
            className={field}
            value={minRupees}
            onChange={(event) => onNumber("minPricePaisa", event.target.value)}
            placeholder={dict.search.refineMinPrice}
          />
        </div>
        <div>
          <label htmlFor="refine-max-price" className="sr-only">
            {dict.search.refineMaxPrice}
          </label>
          <input
            id="refine-max-price"
            type="number"
            inputMode="decimal"
            min={0}
            className={field}
            value={maxRupees}
            onChange={(event) => onNumber("maxPricePaisa", event.target.value)}
            placeholder={dict.search.refineMaxPrice}
          />
        </div>
      </div>

      {/* Said here, not as a 422 after the fact. The screen stops querying while
          the band is inverted (see `providers-search.tsx`) — so without this line
          the results would simply stop updating with no explanation. */}
      {!bandValid ? (
        <p role="alert" className="mt-2 text-xs leading-5 text-rose-700">
          {dict.search.refinePriceBandInvalid}
        </p>
      ) : null}

      {hasAnyRefinement(value) && bandValid ? (
        <p className="mt-3 flex items-start gap-1.5 text-xs leading-5 text-muted">
          <Check className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>
            {dict.search.refineActiveCount.replace("{count}", formatNumber(Object.values(value).filter((v) => v !== undefined).length, locale))}
          </span>
        </p>
      ) : null}
    </div>
  );
}