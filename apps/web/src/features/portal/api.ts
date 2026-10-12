/* Agent verification API surface — mirrors routes on the verification controller.
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
  bookingId: string;
  bookingCode: string;
  serviceName: string;
  paymentMode: string;
  visitNo: number;
  tier: string;
  routingReasons: string[];
  priority: number;
  status: string;
  slaDueAt: string;
  slaRemainingMinutes: number;
  slaBreached: boolean;
  nextAttemptAt: string;
  lockedByMe: boolean;
  lockedAt: string | null;
  attempts: number;
};

/** Single attempt recorded by the agent. */
export type AgentAttempt = {
  id: string;
  attempt: number;
  band: "BAND_A" | "BAND_B" | "BAND_C";
  result: "ANSWERED" | "NO_ANSWER" | "BUSY" | "SWITCHED_OFF" | "WRONG_PERSON" | "CALL_DROPPED";
  startedAt: string;
  durationSeconds?: number;
  notes?: string;
};

export type AgentAttemptInput = {
  result: "ANSWERED" | "NO_ANSWER" | "BUSY" | "SWITCHED_OFF" | "WRONG_PERSON" | "CALL_DROPPED";
  startedAt?: string;
  durationSeconds?: number;
  callRef?: string;
  recordingRef?: string;
  notes?: string;
};

/** Submission payload — the final decision after attempt(s). */
export type AgentSubmitPayload = {
  workCompleted: "FULL" | "PARTIAL" | "NONE";
  quality: number;
  punctuality: number;
  conduct: number;
  cleanliness: number;
  extraChargeDemanded: boolean;
  extraChargeAmountPaisa?: number;
  uniformWorn: boolean;
  ownTools: boolean;
  consentLineRead: boolean;
  consentToRelease: boolean;
  outcome: "VERIFIED_SATISFIED" | "VERIFIED_WITH_ISSUE" | "REWORK_REQUIRED" | "DISPUTED";
  remark?: string;
  recordingRef?: string;
  callDurationSeconds?: number;
};

/** Verification console full response from `GET /agent/verifications/:id`. */
export type VerificationConsoleData = {
  verification: {
    id: string;
    visitNo: number;
    tier: string;
    routingReasons: string[];
    priority: number;
    slaDueAt: string;
    attempts: {
      id: string;
      attempt: number;
      band: string;
      result: string;
      durationSeconds: number | null;
      notes: string | null;
      recordedAt: string;
    }[];
  };
  booking: {
    id: string;
    code: string;
    status: string;
    serviceName: string;
    paymentMode: string;
    scheduledStart: string;
    scheduledEnd: string;
    problemText: string | null;
    approvedTotalPaisa: number;
    finalAmountPaisa: number | null;
    completedAt: string | null;
    startedAt: string | null;
    checkinDistanceM: number | null;
    checkoutDistanceM: number | null;
    expectedDurationMin: number;
  };
  customer: {
    firstName: string;
    phone: string | null;
  };
  provider: {
    id: string;
    name: string;
    phone: string | null;
    verifiedJobs: number;
    ratingCount: number;
    averageScore: string | null;
    openComplaints: number;
    flags90d: number;
    demeritPoints: number;
  };
  invoice: {
    number: string;
    subtotal: number;
    surcharge: number;
    discount: number;
    total: number;
    lines: { kind: string; description: string; amountPaisa: number }[];
  } | null;
  evidence: {
    id: string;
    kind: string;
    checklistItemId: number | null;
    receivedAt: string;
    storageKey: string;
    url?: string;
  }[];
  checklist: {
    id: number;
    label: string;
    requiresPhoto: boolean;
    done: boolean | null;
    evidenceId: string | null;
  }[];
  complaints: {
    id: string;
    category: string;
    severity: string;
    status: string;
    description: string;
    bookingCode: string | null;
  }[];
  consentLine: string;
  questionnaire: readonly {
    key: string;
    label: string;
    answers?: readonly unknown[];
    followUp?: string;
    optional?: boolean;
  }[];
};

/** Verification record — returned after submit. */
export type VerificationRecord = {
  id: string;
  bookingId: string;
  outcome: string;
  recordedAt: string;
  releasedPaisa?: number;
};

/* ----- API call helpers ----- */

const call = <T>(
  path: string,
  request: ApiRequest = {},
  options?: { locale?: Locale; signal?: AbortSignal }
) =>
  apiRequest<T>(path, {
    ...request,
    ...(options?.locale === undefined ? {} : { locale: options.locale }),
    ...(options?.signal === undefined ? {} : { signal: options.signal }),
  });

/* ----- Exported API ----- */

export const agentApi = {
  /**
   * `GET /agent/queue`
   * Returns Tier A verification calls currently in the queue.
   */
  queue: (options?: { locale?: Locale; signal?: AbortSignal }) =>
    call<{ items: AgentQueueEntry[] }>("/agent/queue", { method: "GET" }, options),

  /**
   * `POST /agent/queue/claim`
   * Claim the next unclaimed job from the queue (or a specific verificationId).
   */
  claim: (verificationId?: string, options?: { locale?: Locale; signal?: AbortSignal }) =>
    call<{ item: AgentQueueEntry | null }>(
      "/agent/queue/claim",
      { method: "POST", body: verificationId ? { verificationId } : {} },
      options,
    ),

  /**
   * `POST /agent/verifications/:id/release-lock`
   * Release a previously claimed verification call lock so another agent can claim it.
   */
  releaseLock: (verificationId: string, options?: { locale?: Locale; signal?: AbortSignal }) =>
    call<{ released: boolean }>(
      `/agent/verifications/${verificationId}/release-lock`,
      { method: "POST" },
      options,
    ),

  /**
   * `GET /agent/verifications/:id`
   * Open the console for a claimed verification call. Returns full booking details,
   * customer, provider history, checklist, and questionnaire.
   */
  open: (verificationId: string, options?: { locale?: Locale; signal?: AbortSignal }) =>
    call<VerificationConsoleData>(
      `/agent/verifications/${verificationId}`,
      { method: "GET" },
      options,
    ),

  /**
   * `POST /agent/verifications/:id/call`
   * Initiate click-to-call bridge, or retrieve customer number for manual calling.
   */
  startCall: (verificationId: string, agentEndpoint?: string, options?: { locale?: Locale; signal?: AbortSignal }) =>
    call<{ agentEndpoint?: string; customerPhone?: string }>(
      `/agent/verifications/${verificationId}/call`,
      { method: "POST", body: agentEndpoint ? { agentEndpoint } : {} },
      options,
    ),

  /**
   * `GET /agent/verifications/:id/attempts`
   * List all attempts recorded for this verification.
   */
  listAttempts: (verificationId: string, options?: { locale?: Locale; signal?: AbortSignal }) =>
    call<{ items: AgentAttempt[] }>(
      `/agent/verifications/${verificationId}/attempts`,
      { method: "GET" },
      options,
    ),

  /**
   * `POST /agent/verifications/:id/attempts`
   * Log an attempt result.
   */
  recordAttempt: (
    verificationId: string,
    input: AgentAttemptInput,
    options?: { locale?: Locale; signal?: AbortSignal }
  ) =>
    call<AgentAttempt>(
      `/agent/verifications/${verificationId}/attempts`,
      { method: "POST", body: input },
      options,
    ),

  /**
   * `POST /agent/verifications/:id/submit`
   * Submit the final verification decision with questionnaire answers.
   */
  submit: (verificationId: string, input: AgentSubmitPayload, options?: { locale?: Locale; signal?: AbortSignal }) =>
    call<VerificationRecord>(
      `/agent/verifications/${verificationId}/submit`,
      { method: "POST", body: input },
      options,
    ),

  /**
   * `GET /v/:token`
   * Customer-facing verification link.
   */
  customerLink: (token: string, options?: { locale?: Locale }) =>
    call<{ url: string }>(`/v/${token}`, { method: "GET" }, options),

  /**
   * `POST /v/:token`
   * Answer verification link from customer side.
   */
  customerAnswer: (
    token: string,
    input: { outcome: "SATISFIED" | "WITH_ISSUE" | "REWORK" | "UNREACHABLE"; consent: boolean },
    options?: { locale?: Locale }
  ) =>
    call<{ acknowledged: boolean }>(`/v/${token}`, { method: "POST", body: input }, options),

  /**
   * `GET /finance/recordings/:attemptId`
   * Short-lived signed link to play call recording.
   */
  recording: (attemptId: string, options?: { locale?: Locale; signal?: AbortSignal }) =>
    call<{ url: string; durationSeconds: number }>(
      `/finance/recordings/${attemptId}`,
      { method: "GET" },
      options,
    ),
};