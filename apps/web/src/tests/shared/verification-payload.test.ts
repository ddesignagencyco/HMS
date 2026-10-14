import { describe, expect, it } from "vitest";
import { buildSubmitPayload, extraChargeAmountToPaisa, type SubmitAnswers } from "@/features/portal/verification-payload";
import { bankResultsFrom } from "@/features/portal/payout-batches-view";
import { cappedCount } from "@/features/admin/ops-view";

/* `submitSchema` in apps/api/src/verification/verification.schemas.ts is
   `.strict()`, so these are exactly its keys. */
const SCHEMA_KEYS = new Set([
  "workCompleted",
  "quality",
  "punctuality",
  "conduct",
  "cleanliness",
  "extraChargeDemanded",
  "extraChargeAmountPaisa",
  "uniformWorn",
  "ownTools",
  "consentLineRead",
  "consentToRelease",
  "outcome",
  "remark",
  "recordingRef",
  "callDurationSeconds",
]);

const answers = (overrides: Partial<SubmitAnswers> = {}): SubmitAnswers => ({
  outcome: "VERIFIED_SATISFIED",
  workCompleted: "FULL",
  scores: { quality: 5, punctuality: 4, conduct: 5, cleanliness: 4 },
  extraChargeDemanded: false,
  extraChargeAmountPaisa: null,
  uniformWorn: true,
  ownTools: true,
  consentLineRead: true,
  consentToRelease: true,
  remark: "",
  recordingRef: null,
  callSeconds: 0,
  ...overrides,
});

describe("agent verification submit payload", () => {
  it("sends the customer's recorded consent for VERIFIED_WITH_ISSUE, not one derived from the outcome", () => {
    const payload = buildSubmitPayload(answers({ outcome: "VERIFIED_WITH_ISSUE", consentToRelease: true }));
    expect(payload.outcome).toBe("VERIFIED_WITH_ISSUE");
    expect(payload.consentToRelease).toBe(true);
  });

  it("sends a 'no' consent as given", () => {
    expect(buildSubmitPayload(answers({ outcome: "REWORK_REQUIRED", consentToRelease: false })).consentToRelease).toBe(false);
  });

  it("carries the demanded amount in integer paisa when an extra charge was demanded", () => {
    const payload = buildSubmitPayload(
      answers({ outcome: "DISPUTED", extraChargeDemanded: true, extraChargeAmountPaisa: extraChargeAmountToPaisa("1500.50") }),
    );
    expect(payload.extraChargeDemanded).toBe(true);
    expect(payload.extraChargeAmountPaisa).toBe(150_050);
    expect(Number.isInteger(payload.extraChargeAmountPaisa)).toBe(true);
  });

  it("omits the amount when no extra charge was demanded", () => {
    const payload = buildSubmitPayload(answers({ extraChargeAmountPaisa: 5000 }));
    expect("extraChargeAmountPaisa" in payload).toBe(false);
  });

  it("never invents a remark: an empty transcription sends no remark at all", () => {
    const payload = buildSubmitPayload(answers({ remark: "   " }));
    expect("remark" in payload).toBe(false);
    expect(JSON.stringify(payload)).not.toMatch(/agent console/i);
  });

  it("sends only the customer's own words as the remark", () => {
    expect(buildSubmitPayload(answers({ remark: "  Fixed the leak, tidy work. " })).remark).toBe("Fixed the leak, tidy work.");
  });

  it("does not fabricate a call duration, and attaches a bridged recording ref", () => {
    expect("callDurationSeconds" in buildSubmitPayload(answers())).toBe(false);
    const bridged = buildSubmitPayload(answers({ callSeconds: 95, recordingRef: "calls/abc.mp3" }));
    expect(bridged.callDurationSeconds).toBe(95);
    expect(bridged.recordingRef).toBe("calls/abc.mp3");
  });

  it("sends nothing the strict schema would reject", () => {
    const payload = buildSubmitPayload(
      answers({ extraChargeDemanded: true, extraChargeAmountPaisa: 100, remark: "ok", recordingRef: "r", callSeconds: 3 }),
    );
    for (const key of Object.keys(payload)) expect(SCHEMA_KEYS.has(key)).toBe(true);
  });
});

describe("extraChargeAmountToPaisa", () => {
  it("converts rupees to integer paisa", () => {
    expect(extraChargeAmountToPaisa("500")).toBe(50_000);
    expect(extraChargeAmountToPaisa("0.01")).toBe(1);
    expect(extraChargeAmountToPaisa("19.99")).toBe(1999);
  });

  it("refuses an amount the schema's positive-int check would refuse", () => {
    for (const bad of ["", " ", "0", "0.00", "-5", "abc", "1.234", "1e3"]) expect(extraChargeAmountToPaisa(bad)).toBeNull();
  });
});

describe("payout batch bank results", () => {
  const payouts = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("sends one result per decided payout, with the failure reason on a failed one", () => {
    expect(
      bankResultsFrom(payouts, {
        a: { status: "PAID", reason: "" },
        b: { status: "FAILED", reason: " Account closed " },
        c: { status: null, reason: "" },
      }),
    ).toEqual([
      { payoutId: "a", status: "PAID" },
      { payoutId: "b", status: "FAILED", failureReason: "Account closed" },
    ]);
  });

  it("never turns 'no decision' into 'paid'", () => {
    expect(bankResultsFrom(payouts, {})).toEqual([]);
  });
});

describe("admin landing capped counts", () => {
  it("is exact below the list limit and a lower bound at it", () => {
    expect(cappedCount(12, "en")).toBe("12");
    expect(cappedCount(50, "en")).toBe("50+");
  });
});
