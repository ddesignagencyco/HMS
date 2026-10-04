import { apiRequest, type SessionResult } from "@/lib/api/client";
import type { Locale } from "@/lib/utils";

/* One typed function per route the API publishes (auth.controller.ts). Request
   bodies mirror the Zod schemas in auth.schemas.ts field for field, and every
   authentication submission passes refreshOnExpiry: false so a 401 is reported
   to the form instead of turning into a silent refresh. */

export type ActorRole = "CUSTOMER" | "PROVIDER" | "AGENT" | "FINANCE" | "ADMIN";
export type StaffRole = "AGENT" | "FINANCE" | "ADMIN";
export type SelfRegisterRole = "CUSTOMER" | "PROVIDER";
export type OtpPurpose = "REGISTER" | "LOGIN" | "PASSWORD_RESET" | "PHONE_CHANGE";

export type AuthUser = SessionResult["user"];

export const STAFF_ROLES: readonly ActorRole[] = ["AGENT", "FINANCE", "ADMIN"];

export const isStaffRole = (role: ActorRole): role is StaffRole => (STAFF_ROLES as readonly string[]).includes(role);

export const isActorRole = (value: string): value is ActorRole =>
  ["CUSTOMER", "PROVIDER", "AGENT", "FINANCE", "ADMIN"].includes(value);

export type RegisterInput = {
  role: SelfRegisterRole;
  phoneE164: string;
  email?: string;
  password: string;
  firstName: string;
  lastName?: string;
  locale?: Locale;
};

export type LoginInput = { identifier: string; password: string; totpCode?: string };

export type OtpRequestResult = { sent: true; purpose: OtpPurpose; expiresAt: string; resendAfterSeconds: number };

export type MeResult = { user: AuthUser };

export type TotpSetupResult = { secret: string; otpauthUri: string };

export type AuthApiOptions = { signal?: AbortSignal; locale?: Locale };

const submit = <T>(path: string, body: unknown, options: AuthApiOptions = {}) =>
  apiRequest<T>(path, {
    method: "POST",
    body,
    locale: options.locale,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    /* A rejection here is the answer to "are these credentials right?", not an
       expired session. Retrying it after a refresh would hide the answer and
       could loop. */
    refreshOnExpiry: false,
  });

const authorised = <T>(path: string, options: AuthApiOptions & { method?: "GET" | "POST" | "DELETE"; body?: unknown } = {}) =>
  apiRequest<T>(path, {
    method: options.method ?? "GET",
    locale: options.locale,
    ...(options.body === undefined ? {} : { body: options.body }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });

export const authApi = {
  /** Creates the account and issues the REGISTER code. No session yet. */
  register: (input: RegisterInput, options?: AuthApiOptions) =>
    submit<{ userId: string; requiresOtp: true }>("/auth/register", input, options),

  /** Sends a code. Returns the server's own expiry and resend cooldown. */
  requestOtp: (target: string, purpose: OtpPurpose, options?: AuthApiOptions) =>
    submit<OtpRequestResult>("/auth/otp/request", { target, purpose }, options),

  /** Redeems a code. REGISTER and LOGIN both return a full session. */
  verifyOtp: (target: string, purpose: OtpPurpose, code: string, options?: AuthApiOptions) =>
    submit<SessionResult>("/auth/otp/verify", { target, purpose, code }, options),

  /** 401 TOTP_REQUIRED means a staff account must add totpCode. */
  login: (input: LoginInput, options?: AuthApiOptions) => submit<SessionResult>("/auth/login", input, options),

  /** Revokes the refresh token and clears the cookie. 204 either way. */
  logout: (options?: AuthApiOptions) => submit<undefined>("/auth/logout", undefined, options),

  /** Always answers { sent: true }, so it never discloses whether the account exists. */
  forgotPassword: (identifier: string, options?: AuthApiOptions) =>
    submit<{ sent: true }>("/auth/password/forgot", { identifier }, options),

  /** Consumes the reset code, revokes other sessions and returns a new session. */
  resetPassword: (input: { identifier: string; code: string; newPassword: string }, options?: AuthApiOptions) =>
    submit<SessionResult>("/auth/password/reset", input, options),

  me: (options?: AuthApiOptions) => authorised<MeResult>("/auth/me", options),

  /** Returns the secret exactly once; it is never readable again. */
  totpSetup: (options?: AuthApiOptions) => authorised<TotpSetupResult>("/auth/totp/setup", { ...options, method: "POST" }),

  /** Enrollment only. A login challenge is totpCode on /auth/login. */
  totpVerify: (code: string, options?: AuthApiOptions) =>
    authorised<{ totpEnabled: true }>("/auth/totp/verify", { ...options, method: "POST", body: { code } }),

  totpDisable: (options?: AuthApiOptions) =>
    authorised<{ totpEnabled: false }>("/auth/totp", { ...options, method: "DELETE" }),
};