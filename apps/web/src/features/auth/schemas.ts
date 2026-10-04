import { z } from "zod";
import type { Locale } from "@/lib/utils";

/* These mirror the API's own schemas (apps/api/src/identity/auth.schemas.ts and
   password.ts) so the form can reject what the server would reject without a
   round trip, and speak its exact field names. Anything the server reports
   comes back through ApiError.fieldErrors and is set on the same names. */

/** The API's MIN_PASSWORD_LENGTH. */
export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 200;

/** apps/api/src/identity/password.ts */
const COMMON_PASSWORDS = new Set(["password12", "password123", "1234567890", "qwerty12345", "adminadmin1", "smarthome12"]);

/** The E.164 shape the API requires for registration. */
export const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

/* `path` on a refine is not an option in Zod 3, so every rule below is a plain
   predicate. These run against the value under the cursor, which is what the
   API checks, so a rule here and a rejection there agree. */
export const passwordRule = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters`)
  .max(MAX_PASSWORD_LENGTH, `Use at most ${MAX_PASSWORD_LENGTH} characters`)
  .refine((value) => /[a-z]/.test(value), "Add a lowercase letter")
  .refine((value) => /[A-Z]/.test(value), "Add an uppercase letter")
  .refine((value) => /\d/.test(value), "Add a number")
  .refine((value) => !COMMON_PASSWORDS.has(value.toLowerCase()), "That password is too common");

/** Strips the punctuation the API's normaliseTarget ignores, then puts a local
    Pakistani number into the E.164 form it stores. Returns null when the input
    cannot become a valid E.164 number. */
export const toE164 = (input: string): string | null => {
  const cleaned = input.replace(/[\s()-]/g, "");
  if (cleaned === "") return null;
  if (cleaned.startsWith("+")) return E164_PATTERN.test(cleaned) ? cleaned : null;
  if (cleaned.startsWith("0092")) return E164_PATTERN.test(`+${cleaned.slice(2)}`) ? `+${cleaned.slice(2)}` : null;
  if (cleaned.startsWith("92") && cleaned.length === 12) return E164_PATTERN.test(`+${cleaned}`) ? `+${cleaned}` : null;
  if (/^03\d{9}$/.test(cleaned)) return `+92${cleaned.slice(1)}`;
  return null;
};

/** What the API does to an identifier before matching: emails are lowercased,
    anything else only loses whitespace and the grouping characters people type. */
export const normaliseTarget = (input: string): string =>
  input.includes("@") ? input.trim().toLowerCase() : input.replace(/[\s()-]/g, "");

export const isEmailTarget = (input: string): boolean => input.includes("@");

const identifierField = z
  .string()
  .trim()
  .min(3, "Enter your mobile number or email address")
  .max(320, "That is too long")
  .refine((value) => (isEmailTarget(value) ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) : toE164(value) !== null), {
    message: "Enter a mobile number or an email address",
  });

export const identifierOnlySchema = z.object({ identifier: identifierField });

export const localeSchema = z.enum(["en", "ur"]);

export const registerSchema = z
  .object({
    role: z.enum(["CUSTOMER", "PROVIDER"], { required_error: "Choose whether you are booking or offering services" }),
    firstName: z.string().trim().min(1, "Enter your first name").max(80, "That is too long"),
    lastName: z.string().trim().max(80, "That is too long").optional(),
    phoneE164: z.string().refine((value) => E164_PATTERN.test(value), "Enter a mobile number such as 0300 1234567"),
    email: z
      .string()
      .trim()
      .email("Enter a valid email address")
      .max(320, "That is too long")
      .optional()
      .or(z.literal("")),
    password: passwordRule,
    confirmPassword: z.string().min(1, "Enter your password again"),
    acceptTerms: z.boolean().refine((value) => value, "Accept the terms to continue"),
  })
  .superRefine((value, context) => {
    if (value.confirmPassword !== value.password) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["confirmPassword"], message: "The two passwords do not match" });
    }
  });

export type RegisterValues = z.input<typeof registerSchema>;
export type RegisterPayload = z.output<typeof registerSchema>;

export const loginSchema = z.object({
  identifier: identifierField,
  password: z.string().min(1, "Enter your password").max(MAX_PASSWORD_LENGTH),
});

export type LoginValues = z.infer<typeof loginSchema>;

export const totpCodeSchema = z.string().trim().regex(/^\d{6}$/, "Enter the six digit code");

/** The API accepts 4–8 digits; the codes it issues are six. */
export const otpCodeSchema = z.string().trim().regex(/^\d{4,8}$/, "Enter the numeric code from your message");

export const verifyOtpSchema = z.object({
  target: z.string().trim().min(3).max(320),
  purpose: z.enum(["REGISTER", "LOGIN", "PASSWORD_RESET", "PHONE_CHANGE"]),
  code: otpCodeSchema,
});

export const requestOtpSchema = z.object({
  target: identifierField,
  purpose: z.enum(["REGISTER", "LOGIN", "PASSWORD_RESET", "PHONE_CHANGE"]),
});

export const forgotPasswordSchema = z.object({ identifier: identifierField });

/**
 * POST /auth/otp/request reports the cooldown it applied, and that is what the
 * resend button counts down. The only case the client cannot ask about is a code
 * issued by POST /auth/register, whose response carries no timing — so the
 * server's own default is used for that one screen until a resend answers with
 * the real value. From DEFAULT_AUTH_SETTINGS.otpResendCooldownSeconds in
 * apps/api/src/identity/otp.service.ts; deployments may override it there.
 */
export const DEFAULT_OTP_RESEND_SECONDS = 60;

/**
 * The identifier is not a form field: it is whatever the person asked the code
 * for, carried on the query string from /auth/forgot. It is the account that is
 * being reset, not something they retype, and the API matches on it exactly.
 */
export const resetPasswordSchema = z
  .object({
    code: otpCodeSchema,
    newPassword: passwordRule,
    confirmPassword: z.string().min(1, "Enter your password again"),
  })
  .superRefine((value, context) => {
    if (value.confirmPassword !== value.newPassword) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["confirmPassword"], message: "The two passwords do not match" });
    }
  });

export type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;

/** The API body for POST /auth/password/reset. */
export const resetPasswordRequest = (
  identifier: string,
  values: ResetPasswordValues,
): { identifier: string; code: string; newPassword: string } => ({
  identifier: normaliseTarget(identifier),
  code: values.code,
  newPassword: values.newPassword,
});

/** The sign-in identifier is sent exactly as the API normalises it. */
export const loginIdentifier = (values: { identifier: string }): string => normaliseTarget(values.identifier);

export const forgotIdentifier = loginIdentifier;

export const localeOrDefault = (value: string | undefined, fallback: Locale): Locale => (value === "ur" ? "ur" : fallback);