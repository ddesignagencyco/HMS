/* The customer's one-tap verification link.

   `GET /v/:token` and `POST /v/:token` (verification-link.controller.ts). Both are
   `@Public()`: the customer opens a link from an SMS and has no session, and the
   token itself is the credential.

   This module previously asked for a consent box, one 1–5 score and a note, then
   set a local "thank you" flag and called nothing. A customer confirming a job —
   the moment money is released — was told it was recorded when nothing had been
   recorded at all. The real contract asks for a one-time code from the text, four
   separate scores, whether the work was completed, whether extra money was
   demanded, and consent to release; and it answers `CONFIRMED` or `ESCALATED`.

   Both shapes are pinned here rather than assumed: the questionnaire comes from
   the server's own `questions`, so a change to what it asks is a server change
   rather than a frontend one that silently collects the wrong answers. */

import { apiRequest } from "@/lib/api/client";
import type { Locale } from "@/lib/utils";
import type { Booking } from "@/features/booking/api";

export type VerificationQuestion =
  | { key: "workCompleted"; label: string; answers: string[] }
  | { key: "ratings"; label: string }
  | { key: "extraChargeDemanded"; label: string; answers: boolean[] }
  | { key: "consentToRelease"; label: string; answers: boolean[] };

export type VerificationLink = {
  bookingCode: string;
  serviceName: string;
  providerFirstName: string;
  /** Null while the job's final figure has not been set. */
  amountPaisa: number | null;
  expiresAt: string;
  questions: VerificationQuestion[];
};

export type VerificationAnswers = {
  otp: string;
  workCompleted: "FULL" | "PARTIAL" | "NONE";
  quality: number;
  punctuality: number;
  conduct: number;
  cleanliness: number;
  extraChargeDemanded: boolean;
  consentToRelease: boolean;
};

export type VerificationOutcome = { status: "CONFIRMED" | "ESCALATED" };

const publicRead = <T>(path: string, locale?: Locale, signal?: AbortSignal) =>
  apiRequest<T>(path, {
    method: "GET",
    locale,
    ...(signal === undefined ? {} : { signal }),
    /* Public by design — the token is the credential — and a 401 here must never
       start a refresh for a visitor who has no session to refresh. */
    auth: false,
    refreshOnExpiry: false,
  });

export const verificationApi = {
  /** 404 for an unknown link, 410 once expired or already used. */
  describe: (token: string, options?: { locale?: Locale; signal?: AbortSignal }) =>
    publicRead<VerificationLink>(`/v/${encodeURIComponent(token)}`, options?.locale, options?.signal),

  /**
   * Records the answer permanently.
   *
   * `.strict()` on the server, so only the documented keys are sent. 422 for a
   * wrong code (the fifth returns 423 and locks the link), 410 once used.
   */
  respond: (token: string, answers: VerificationAnswers, locale?: Locale) =>
    apiRequest<VerificationOutcome>(`/v/${encodeURIComponent(token)}`, {
      method: "POST",
      body: answers,
      locale,
      refreshOnExpiry: false,
    }),
};
/* ---- FR-VC-16: the customer confirms their own job, signed in -------------

   `GET`/`POST /bookings/:bookingId/verification/confirmation`
   (verification-self.controller.ts). Bearer auth, CUSTOMER role, no OTP and no
   token — the session is the credential.

   This is not the texted link above with the code removed. It answers three ways
   rather than two, it takes the customer's own choice of outcome (which the
   server may overrule), and its GET is **always 200 for your own booking**: the
   form being unavailable comes back as `canSubmit: false` plus a sentence written
   for the customer, never as an error. */

export type WorkCompleted = "FULL" | "PARTIAL" | "NONE";
export type SelfConfirmationChoice = "SATISFIED" | "WITH_ISSUE" | "NOT_ACCEPTABLE";
export type SelfConfirmationOutcome = "CONFIRMED" | "CONFIRMED_WITH_ISSUE" | "ESCALATED";

/**
 * The server's questionnaire. Same idea as the link's `questions`, with one
 * difference worth knowing: the outcome question is keyed `choice` here but the
 * body field it fills is `outcome`.
 */
export type SelfConfirmationQuestion =
  | { key: "workCompleted"; label: string; answers: WorkCompleted[] }
  | { key: "ratings"; label: string }
  | { key: "extraChargeDemanded"; label: string; answers: boolean[] }
  | { key: "choice"; label: string; answers: SelfConfirmationChoice[] };

export type SelfConfirmationForm = {
  bookingCode: string;
  serviceName: string;
  /** Null while the job has no provider name on file. */
  providerFirstName: string | null;
  paymentMode: "ONLINE" | "CASH";
  /** Integer paisa. Null until the job's final figure is set. */
  amountPaisa: number | null;
  canSubmit: boolean;
  /** Written for the customer to read. Rendered, never pattern-matched. */
  blockedReason: string | null;
  questions: SelfConfirmationQuestion[];
};

export type SelfConfirmationAnswers = {
  workCompleted: WorkCompleted;
  quality: number;
  punctuality: number;
  conduct: number;
  cleanliness: number;
  extraChargeDemanded: boolean;
  consentToRelease: boolean;
  outcome: SelfConfirmationChoice;
  /** Optional, max 1000. Published under first name and initial only (FR-RT-06). */
  remark?: string;
};

export type SelfConfirmationResult = {
  outcome: SelfConfirmationOutcome;
  bookingId: string;
  bookingStatus: string;
  /** Rendered verbatim — the only wording checked against what happened to the money. */
  message: string;
  booking: Booking;
};

/** The cap the server's schema enforces on `remark`. */
export const MAX_SELF_CONFIRMATION_REMARK = 1000;

const confirmationPath = (bookingId: string) => `/bookings/${encodeURIComponent(bookingId)}/verification/confirmation`;

export const selfConfirmationApi = {
  /** Always 200 for your own booking; 404 for one that is not yours. */
  describe: (bookingId: string, options?: { locale?: Locale; signal?: AbortSignal }) =>
    apiRequest<SelfConfirmationForm>(confirmationPath(bookingId), {
      method: "GET",
      locale: options?.locale,
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
    }),

  /**
   * `.strict()` on the server, so the body is built key by key rather than spread
   * — an empty remark is left out rather than sent as `""`.
   *
   * 422 names the contradicting field in `errors[].path`; 409 means the state
   * moved (an agent picked up, the job settled, the switch is off) and the
   * reason is in `detail`.
   */
  submit: (bookingId: string, answers: SelfConfirmationAnswers, locale?: Locale) => {
    const remark = answers.remark?.trim();
    return apiRequest<SelfConfirmationResult>(confirmationPath(bookingId), {
      method: "POST",
      locale,
      body: {
        workCompleted: answers.workCompleted,
        quality: answers.quality,
        punctuality: answers.punctuality,
        conduct: answers.conduct,
        cleanliness: answers.cleanliness,
        extraChargeDemanded: answers.extraChargeDemanded,
        consentToRelease: answers.consentToRelease,
        outcome: answers.outcome,
        ...(remark === undefined || remark === "" ? {} : { remark }),
      },
    });
  },
};
