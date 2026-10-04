import { describe, expect, it } from "vitest";
import {
  forgotIdentifier,
  loginIdentifier,
  loginSchema,
  normaliseTarget,
  otpCodeSchema,
  registerSchema,
  resetPasswordRequest,
  resetPasswordSchema,
  toE164,
  totpCodeSchema,
} from "@/features/auth/schemas";

/* The rules here exist so the form rejects what the API would reject, and sends
   it the exact shape the API parses. The expectations are the API's, read off
   auth.schemas.ts and password.ts. */

describe("toE164", () => {
  it("puts a local Pakistani number into the E.164 form the API stores", () => {
    expect(toE164("03001234567")).toBe("+923001234567");
    expect(toE164("0300 1234567")).toBe("+923001234567");
    expect(toE164("+923001234567")).toBe("+923001234567");
    expect(toE164("00923001234567")).toBe("+923001234567");
    expect(toE164("923001234567")).toBe("+923001234567");
  });

  it("refuses anything that is not a valid E.164 number rather than guessing", () => {
    expect(toE164("0300123456")).toBeNull();
    expect(toE164("030012345678")).toBeNull();
    expect(toE164("+0923001234567")).toBeNull();
    expect(toE164("abcdefghijk")).toBeNull();
    expect(toE164("")).toBeNull();
  });
});

describe("normaliseTarget", () => {
  it("does exactly what the API does: lowercase emails, strip punctuation from numbers", () => {
    expect(normaliseTarget("  Person@Smart-Home.Local ")).toBe("person@smart-home.local");
    expect(normaliseTarget("+92 (300) 123-4567")).toBe("+923001234567");
    expect(normaliseTarget("0300 1234567")).toBe("03001234567");
  });
});

describe("registerSchema", () => {
  const valid = {
    role: "CUSTOMER",
    firstName: "Ayesha",
    lastName: "",
    phoneE164: "+923001234567",
    email: "",
    password: "CorrectHorse9Battery",
    confirmPassword: "CorrectHorse9Battery",
    acceptTerms: true,
  } as const;

  it("accepts the API's own example payload", () => {
    expect(registerSchema.safeParse(valid).success).toBe(true);
  });

  it("enforces the API password policy, not the old eight-character rule", () => {
    const short = registerSchema.safeParse({ ...valid, password: "Sh0rt", confirmPassword: "Sh0rt" });
    expect(short.success).toBe(false);

    const noUpper = registerSchema.safeParse({ ...valid, password: "nouppercase9x", confirmPassword: "nouppercase9x" });
    expect(noUpper.success).toBe(false);

    const noNumber = registerSchema.safeParse({ ...valid, password: "NoNumbersHere", confirmPassword: "NoNumbersHere" });
    expect(noNumber.success).toBe(false);

    /* Exactly the list the API refuses. */
    const common = registerSchema.safeParse({ ...valid, password: "password123", confirmPassword: "password123" });
    expect(common.success).toBe(false);
  });

  it("reports the mismatch on the confirmation, not on the password", () => {
    const result = registerSchema.safeParse({ ...valid, confirmPassword: "Different9Battery" });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((issue) => issue.path[0])).toContain("confirmPassword");
    expect(result.error.issues.map((issue) => issue.path[0])).not.toContain("password");
  });

  it("rejects a number that is not E.164 and a role the API does not self-register", () => {
    expect(registerSchema.safeParse({ ...valid, phoneE164: "03001234567" }).success).toBe(false);
    expect(registerSchema.safeParse({ ...valid, role: "ADMIN" }).success).toBe(false);
  });

  it("requires the terms to be accepted", () => {
    expect(registerSchema.safeParse({ ...valid, acceptTerms: false }).success).toBe(false);
  });
});

describe("loginSchema", () => {
  it("takes either a mobile number or an email as the identifier", () => {
    expect(loginSchema.safeParse({ identifier: "0300 1234567", password: "x" }).success).toBe(true);
    expect(loginSchema.safeParse({ identifier: "person@smart-home.local", password: "x" }).success).toBe(true);
    expect(loginSchema.safeParse({ identifier: "not-an-identifier", password: "x" }).success).toBe(false);
    expect(loginSchema.safeParse({ identifier: "a@b", password: "x" }).success).toBe(false);
  });

  it("rejects fields the API's strict schema would reject", () => {
    expect(loginSchema.safeParse({ identifier: "a@b.co", password: "x", totpCode: "12345" }).success).toBe(true);
    expect(loginSchema.safeParse({ identifier: "a@b.co", password: "" }).success).toBe(false);
  });

  it("sends the identifier normalised, and never the trimmed raw input", () => {
    expect(loginIdentifier({ identifier: "  Person@Smart-Home.Local " })).toBe("person@smart-home.local");
    expect(forgotIdentifier({ identifier: "+92 (300) 123-4567" })).toBe("+923001234567");
  });
});

describe("codes", () => {
  it("accepts the four to eight digits the API accepts, and six for TOTP", () => {
    expect(otpCodeSchema.safeParse("1234").success).toBe(true);
    expect(otpCodeSchema.safeParse("12345678").success).toBe(true);
    expect(otpCodeSchema.safeParse("123").success).toBe(false);
    expect(otpCodeSchema.safeParse("12a456").success).toBe(false);
    expect(totpCodeSchema.safeParse("12345").success).toBe(false);
    expect(totpCodeSchema.safeParse("123456").success).toBe(true);
  });
});

describe("resetPasswordSchema", () => {
  const valid = { code: "123456", newPassword: "BrandNewPass9", confirmPassword: "BrandNewPass9" } as const;

  it("keeps the account out of the form and puts it on the request body", () => {
    expect(resetPasswordSchema.safeParse(valid).success).toBe(true);
    expect(resetPasswordRequest("  Person@Smart-Home.Local ", valid)).toEqual({
      identifier: "person@smart-home.local",
      code: "123456",
      newPassword: "BrandNewPass9",
    });
  });

  it("reports a mismatch on the confirmation", () => {
    const result = resetPasswordSchema.safeParse({ ...valid, confirmPassword: "Something9Else" });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path[0]).toBe("confirmPassword");
  });
});