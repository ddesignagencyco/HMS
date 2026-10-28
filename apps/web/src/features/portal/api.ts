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

export type TimeBand = "MORNING" | "AFTERNOON" | "EVENING";
export type AttemptResult = "ANSWERED" | "NO_ANSWER" | "BUSY" | "SWITCHED_OFF" | "WRONG_PERSON" | "CALL_DROPPED";

/** One attempt as `GET .../attempts` (and the console's `verification.attempts`)
    returns it — `VerificationConsoleService.attempts`. */
export type AgentAttempt = {
  id: string;
  attemptNo: number;
  agentId: string;
  band: TimeBand;
  startedAt: string;
  durationSeconds: number | null;
  result: AttemptResult;
  callRef: string | null;
  notes: string | null;
};

/** What `POST .../attempts` returns. An unanswered attempt hands the call back to
    the queue (`nextAttemptAt`); the last one sends the customer the link. */
export type RecordedAttempt = {
  id: string;
  attemptNo: number;
  band: TimeBand;
  result: AttemptResult;
  nextAttemptAt: string | null;
  linkSent: boolean;
};

/** `POST .../call`. Without an agent endpoint the agent dials by hand; with one
    the telephony adapter bridges and records, and the refs go on the attempt. */
export type CallStart =
  | { mode: "MANUAL"; customerPhone: string; consentLine: string }
  | { mode: "BRIDGED"; callRef: string; status: string; recordingRef: string; consentLine: string };

export type AgentAttemptInput = {
  result: AttemptResult;
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
  outcome: AgentOutcome;
  /** The customer's own words, transcribed. Published as their review — never agent text. */
  remark?: string;
  recordingRef?: string;
  callDurationSeconds?: number;
};

export type AgentOutcome = "VERIFIED_SATISFIED" | "VERIFIED_WITH_ISSUE" | "REWORK_REQUIRED" | "DISPUTED";

/** Verification console full response from `GET /agent/verifications/:id` —
    `VerificationConsoleService.console`. */
export type VerificationConsoleData = {
  verification: {
    id: string;
    visitNo: number;
    tier: string;
    routingReasons: string[];
    priority: number;
    slaDueAt: string;
    attempts: AgentAttempt[];
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
    minutesOnSite: number | null;
    expectedDurationMin: number;
    checkinDistanceM: number | null;
    checkoutDistanceM: number | null;
  };
  customer: {
    firstName: string;
    phone: string | null;
  };
  /** Just who it is — the track record is `providerHistory`. */
  provider: {
    id: string;
    name: string;
  };
  providerHistory: {
    verifiedJobs: number;
    ratingCount: number;
    averageScore: number | null;
    openComplaints: number;
    flags90d: number;
    demeritPoints: number;
  } | null;
  invoice: {
    number: string;
    subtotalPaisa: number;
    surchargePaisa: number;
    discountPaisa: number;
    totalPaisa: number;
    lines: { kind: string; description: string; amountPaisa: number }[];
  } | null;
  evidence: {
    id: string;
    kind: string;
    checklistItemId: number | null;
    receivedAt: string;
    /** A stored-media URL; the storage key itself is never sent. */
    url: string;
    /** The stored type when the server includes it — evidence may be a photo, a short video or a PDF. */
    contentType?: string | null;
  }[];
  checklist: {
    id: number;
    label: string;
    requiresPhoto: boolean;
    done: boolean | null;
    evidenceId: string | null;
  }[];
  /** Open complaints on this booking or against this provider. */
  openComplaints: {
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
  outcomes: AgentOutcome[];
};

/** `VerificationSubmitService.submit`'s result. */
export type VerificationSubmitResult = {
  verificationId: string;
  outcome: string;
  bookingStatus: string;
  released: boolean;
  reworkStarted?: boolean;
  disputeOpened?: boolean;
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
    call<CallStart>(
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
    call<RecordedAttempt>(
      `/agent/verifications/${verificationId}/attempts`,
      { method: "POST", body: input },
      options,
    ),

  /**
   * `POST /agent/verifications/:id/submit`
   * Submit the final verification decision with questionnaire answers.
   */
  submit: (verificationId: string, input: AgentSubmitPayload, options?: { locale?: Locale; signal?: AbortSignal }) =>
    call<VerificationSubmitResult>(
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
    call<{ url: string; expiresAt: string }>(
      `/finance/recordings/${attemptId}`,
      { method: "GET" },
      options,
    ),
};