import { describe, expect, it } from "vitest";
import { money, presentPrice } from "@/features/catalogue/pricing";
import type { CatalogueService } from "@/features/catalogue/api";

/* Pricing is the one place where a wrong word is a wrong promise. `FLAT` is a
   price, `TIME_BASED` is a rate, `INSPECTION_FIRST` is an estimate, and none of
   them may be described as "from" when the API did not say so. */

const service = (overrides: Partial<CatalogueService>): CatalogueService => ({
  id: 1,
  categoryId: 1,
  slug: "leak-repair",
  nameEn: "Leak Repair",
  nameUr: "لیک کی مرمت",
  description: "d",
  pricingModel: "FLAT",
  timeUnit: null,
  basePricePaisa: 250000,
  minPricePaisa: 100000,
  maxPricePaisa: 500000,
  visitFeePaisa: 0,
  expectedDurationMin: 90,
  isEmergencyEligible: false,
  isPlanEligible: false,
  warrantyDays: 30,
  isHighRisk: false,
  isActive: true,
  ...overrides,
});

describe("money", () => {
  it("converts paisa to rupees and never floats", () => {
    expect(money(250000, "en")).toBe("Rs 2,500");
    expect(money(1, "en")).toBe("Rs 0");
    expect(money(0, "en")).toBe("Rs 0");
  });
});

describe("presentPrice", () => {
  it("calls a FLAT service a fixed price", () => {
    const price = presentPrice(service({}), "en");
    expect(price.basis).toBe("flat");
    expect(price.primary).toBe("Rs 2,500");
    expect(price.perUnit).toBeUndefined();
    /* A range only appears when the service actually declares one. */
    expect(price.range).toEqual({ from: "Rs 1,000", to: "Rs 5,000" });
  });

  it("omits the range when min and max are the same", () => {
    const price = presentPrice(service({ minPricePaisa: 250000, maxPricePaisa: 250000 }), "en");
    expect(price.range).toBeUndefined();
  });

  it("calls a TIME_BASED service a rate and names its unit", () => {
    const hourly = presentPrice(service({ pricingModel: "TIME_BASED", timeUnit: "HOUR" }), "en");
    expect(hourly.basis).toBe("rate");
    expect(hourly.perUnit).toBe("perHour");

    const daily = presentPrice(service({ pricingModel: "TIME_BASED", timeUnit: "DAY" }), "en");
    expect(daily.perUnit).toBe("perDay");
  });

  it("never calls INSPECTION_FIRST a flat price", () => {
    const price = presentPrice(service({ pricingModel: "INSPECTION_FIRST" }), "en");
    expect(price.basis).toBe("estimate");
  });

  it("shows a visit fee only when there is one", () => {
    expect(presentPrice(service({ visitFeePaisa: 0 }), "en").visitFee).toBeUndefined();
    expect(presentPrice(service({ visitFeePaisa: 50000 }), "en").visitFee).toBe("Rs 500");
  });
});