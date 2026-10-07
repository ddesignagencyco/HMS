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