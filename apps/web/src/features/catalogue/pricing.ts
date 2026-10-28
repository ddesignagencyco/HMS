import type { CatalogueService } from "@/features/catalogue/api";
import { formatNumber, type Locale } from "@/lib/utils";

/* How a price may be described, decided by `pricingModel` rather than by habit.

   A FLAT price is a price. A TIME_BASED price is a rate. INSPECTION_FIRST means
   the number is not the whole cost and the inspection decides — calling that
   "from" would understate it, and calling it "the price" would overstate it.
   The distinction is the difference between a quote and a promise. */

export type PriceUnit = "perHour" | "perDay";

export type PricePresentation = {
  /** The headline figure. */
  primary: string;
  /** What the headline figure is, in words. */
  basis: "flat" | "rate" | "estimate";
  /** The full range, when the service declares one that differs from the base. */
  range?: { from: string; to: string };
  /**
   * A dictionary KEY for the per-unit wording, not the wording itself — this
   * module stays independent of the dictionaries so it can be tested on its own.
   * The caller resolves it, e.g. `dict.catalogue[price.perUnit]`.
   *
   * It must never be rendered directly: doing so puts the literal text
   * "perHour" on the page instead of "per hour".
   */
  perUnit?: PriceUnit;
  /** A separate visit fee, only when it is non-zero. */
  visitFee?: string;
};

const UNIT_KEYS = { HOUR: "perHour", DAY: "perDay" } as const satisfies Record<string, PriceUnit>;

export const money = (paisa: number, locale: Locale): string => `Rs ${formatNumber(Math.round(paisa / 100), locale)}`;

export const presentPrice = (service: CatalogueService, locale: Locale): PricePresentation => {
  const base = money(service.basePricePaisa, locale);
  const timeBased = service.pricingModel === "TIME_BASED";
  const inspectionFirst = service.pricingModel === "INSPECTION_FIRST";

  const perUnit =
    timeBased && service.timeUnit !== null && service.timeUnit in UNIT_KEYS
      ? UNIT_KEYS[service.timeUnit as keyof typeof UNIT_KEYS]
      : undefined;

  const presentation: PricePresentation = {
    primary: base,
    basis: timeBased ? "rate" : inspectionFirst ? "estimate" : "flat",
    ...(service.minPricePaisa !== service.maxPricePaisa ? { range: { from: money(service.minPricePaisa, locale), to: money(service.maxPricePaisa, locale) } } : {}),
    ...(perUnit === undefined ? {} : { perUnit }),
    ...(service.visitFeePaisa > 0 ? { visitFee: money(service.visitFeePaisa, locale) } : {}),
  };

  return presentation;
};

export const hasRange = (service: CatalogueService): boolean => service.minPricePaisa !== service.maxPricePaisa;