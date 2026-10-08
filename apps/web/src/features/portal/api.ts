/* Agent verification API surface — mirrors the 11 paths from OpenAPI spec.
   All calls are authenticated; the portal reads the queue, claims a call,
   records attempts, and submits the final decision.

   Usage: `import { agentApi } from "@/features/portal/api"`.
*/

import { apiRequest, type ApiRequest } from "@/lib/api/client";
import type { Locale } from "@/lib/utils";

/* ----- Response types (mirror the API schemas) ----- */

/** Queue entry — one job waiting for an agent to claim it. */
export type AgentQueueEntry = {
  id: string;
  serviceSlug: string;
  providerId: string;
  customerId: string;
  code: string;
  scheduledStart: string;
  scheduledEnd: string;
  status: "AWAITING_VERIFICATION" | "DISPUTED" | "VERIFIED";
  quotedPaisa: number;
};

/** Single attempt recorded by the agent. */
export type AgentAttempt = {
  id: string;
  attempt: number;
  band: "BAND_A" | "BAND_B" | "BAND_C";
  outcome:
    | "connected"
    | "noAnswer"
    | "linkSent"
    | "wrongNumber";
  startedAt: string;
  durationSeconds?: number;
  notes?: string;
};

/** Submission payload — the final decision after up to 3 attempts. */
export type AgentSubmitPayload = {
  outcome: "SATISFIED" | "WITH_ISSUE" | "REWORK" | "UNREACHABLE";
  consentRecorded: boolean;
  finalNotes?: string;
};

/** Verification record — returned after `POST /v/{token}` or after submit. */
export type VerificationRecord = {
  id: string;
  bookingId: string;
  outcome: "SATISFIED" | "WITH_ISSUE" | "REWORK" | "UNREACHABLE";
  recordedAt: string;
  releasedPaisa?: number;
};

/* ----- API call helpers ----- */

const call = <T>(
  path: string,
  request: ApiRequest = {},
  options?: { locale?: Locale; signal?: AbortSignal }
) => apiRequest<T>(path, {
  ...request,
  ...(options?.locale === undefined ? {} : { locale: options.locale }),
  ...(options?.signal === undefined ? {} : { signal: options.signal }),
});

/* ----- Exported API ----- */

/**
 * `GET /api/v1/agent/queue`
 *
 * Returns the list of bookings currently in the verification queue:
 * `AWAITING_VERIFICATION`, `DISPUTED`, `VERIFIED`.
 * Sorted by `scheduledStart` descending (most recent first).
 */
export const agentApi = {
  queue: (options?: { locale?: Locale; signal?: AbortSignal }) =>
    call<{ items: AgentQueueEntry[] }>("/api/v1/agent/queue", { method: "GET" }, options),

  /**
   * `POST /api/v1/agent/queue/claim`
   *
   * Claim the next unclaimed job from the queue. Once claimed it is
   * reserved for this agent session and will no longer appear in the
   * general queue list.
   */
  claim: (bookingId: string, options?: { locale?: Locale; signal?: AbortSignal }) =>
    call<{ id: string; bookedAt: string }>(
      `/api/v1/agent/queue/claim`,
      { method: "POST", body: { bookingId } },
      options,
    ),

  /**
   * `POST /api/v1/agent/verifications/{id}/release-lock`
   *
   * Release a previously claimed verification call lock so another agent
   * can claim it. Useful for handover between shifts.
   */
  releaseLock: (verificationId: string, options?: { locale?: Locale; signal?: AbortSignal }) =>
    call<{ released: boolean }>(
      `/api/v1/agent/verifications/${verificationId}/release-lock`,
      { method: "POST" },
      options,
    ),

  /**
   * `GET /api/v1/agent/verifications/{id}`
   *
   * Open the console for a claimed verification call. Returns the booking
   * details, the current attempt number, and any attempts already recorded.
   */
  open: (verificationId: string, options?: { locale?: Locale; signal?: AbortSignal }) =>
    call<{
      booking: {
        id: string;
        code: string;
        serviceSlug: string;
        providerId: string;
        status: string;
        quotedPaisa: number;
      };
      attempt: number;
      attempts: AgentAttempt[];
    }>(
      `/api/v1/agent/verifications/${verificationId}`,
      { method: "GET" },
      options,
    ),

  /**
   * `POST /api/v1/agent/verifications/{id}/call`
   *
   * Mark that the agent has started a call attempt. Resets the attempt counter
   * for this verification session and records the start timestamp. The UI should
   * then show the call timer and interview questions.
   */
  startCall: (verificationId: string, options?: { locale?: Locale; signal?: AbortSignal }) =>
    call<{ attempt: number; startedAt: string }>(
      `/api/v1/agent/verifications/${verificationId}/call`,
      { method: "POST" },
      options,
    ),

  /**
   * `GET /api/v1/agent/verifications/{id}/attempts`
   *
   * List all attempts already recorded for this verification. The UI uses this
   * to display the time-band, outcome, and attempt number in the right column
   * of the verification console.
   */
  listAttempts: (verificationId: string, options?: { locale?: Locale; signal?: AbortSignal }) =>
    call<{ attempts: AgentAttempt[] }>(
      `/api/v1/agent/verifications/${verificationId}/attempts`,
      { method: "GET" },
      options,
    ),

  /**
   * `POST /api/v1/agent/verifications/{id}/attempts`
   *
   * Record a single attempt outcome. The body should contain at minimum:
   *   - `band`: "BAND_A" | "BAND_B" | "BAND_C"
   *   - `outcome`: "connected" | "noAnswer" | "linkSent" | "wrongNumber"
   *   - `notes`: optional free‑text
   *
   * The API returns the updated attempt object so the UI can immediately
   * reflect the new row.
   */
  recordAttempt: (
    verificationId: string,
    input: { band: "BAND_A" | "BAND_B" | "BAND_C"; outcome: "connected" | "noAnswer" | "linkSent" | "wrongNumber"; notes?: string },
    options?: { locale?: Locale; signal?: AbortSignal }
  ) =>
    call<AgentAttempt>(
      `/api/v1/agent/verifications/${verificationId}/attempts`,
      { method: "POST", body: input },
      options,
    ),

  /**
   * `POST /api/v1/agent/verifications/{id}/submit`
   *
   * Submit the final decision after all attempt(s) have been recorded. The
   * payload includes the outcome and whether customer consent was recorded
   * for the call recording / escrow release.
   */
  submit: (verificationId: string, input: AgentSubmitPayload, options?: { locale?: Locale; signal?: AbortSignal }) =>
    call<VerificationRecord>(
      `/api/v1/agent/verifications/${verificationId}/submit`,
      { method: "POST", body: input },
      options,
    ),

  /**
   * `GET /api/v1/v/{token}` / `POST /api/v1/v/{token}`
   *
   * Customer-facing verification link — the one-tap SMS/WhatsApp link that
   * the customer can tap to confirm the verification outcome, or to decline
   * and hand back to Tier B SMS flow. The token is the credential published
   * in the SMS; this pair of endpoints is `@Public()`.
   */
  customerLink: (token: string, options?: { locale?: Locale }) =>
    call<{ url: string }>(
      `/api/v1/v/${token}`,
      { method: "GET" },
      options,
    ),

  /**
   * `POST /api/v1/v/{token}` — answer the verification link from the customer
   * side (e.g. a POST from a web view that intercepts the deep link).
   */
  customerAnswer: (token: string, input: { outcome: "SATISFIED" | "WITH_ISSUE" | "REWORK" | "UNREACHABLE"; consent: boolean }, options?: { locale?: Locale }) =>
    call<{ acknowledged: boolean }>(
      `/api/v1/v/${token}`,
      { method: "POST", body: input },
      options,
    ),

  /**
   * `GET /api/v1/finance/recordings/{attemptId}` / `POST /api/v1/finance/recordings/{attemptId}`
   *
   * Play / download a call recording for a given attempt. The UI in the
   * verification console can invoke this to let the agent listen to the
   * recorded call before making a decision.
   */
  recording: (attemptId: string, options?: { locale?: Locale; signal?: AbortSignal }) =>
    call<{ url: string; durationSeconds: number }>(
      `/api/v1/finance/recordings/${attemptId}`,
      { method: "GET" },
      options,
    ),
};