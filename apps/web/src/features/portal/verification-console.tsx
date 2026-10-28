"use client";

import {
  CheckCircle2,
  PhoneCall,
  RefreshCw,
  XCircle,
  AlertTriangle,
  ShieldCheck,
  Camera,
  Loader2,
  ArrowLeft,
  Check,
  Maximize2,
  X,
  PhoneOff,
  PhoneMissed,
  History,
  Clock,
  MessageSquareText,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Dictionary } from "@/lib/dictionaries";
import type { Booking } from "@/lib/types";
import { cn, formatMoney, localizedPath, type Locale } from "@/lib/utils";
import { Card, PageHeader } from "@/components/ui";
import { SelectField } from "@/components/select-field";
import { EvidenceImage, mediaLabels } from "@/components/evidence-image";
import { agentApi, type AgentSubmitPayload, type AttemptResult } from "@/features/portal/api";
import { buildSubmitPayload, extraChargeAmountToPaisa } from "@/features/portal/verification-payload";
import { detailOf } from "@/features/auth/auth-feedback";

type VerificationConsoleProps = {
  locale: Locale;
  dict: Dictionary;
  verificationId: string;
  booking?: Booking;
};

export function VerificationConsole({
  locale,
  dict,
  verificationId,
  booking: fallbackBooking,
}: VerificationConsoleProps) {
  const router = useRouter();
  const queryClient = useQueryClient();

  /* Whether the agent read the recorded-call consent line aloud. It is posted as
   * `consentLineRead` and the server refuses a submission without it, so it
   * starts unticked: pre-ticking it recorded a reading nobody had done. */
  const [consent, setConsent] = useState(false);
  const [callActive, setCallActive] = useState(false);
  /* The timer used to be a frozen `useState("01:24")` — a constant that never
   * ticked, displayed as a live call duration and posted to the API as
   * `durationSeconds: 84`. It now counts real elapsed seconds. */
  const [callSeconds, setCallSeconds] = useState(0);
  /* No question is pre-answered.
   *
   * This used to initialise all four answers to "yes" and the `<SelectField>`
   * fell back to `"yes"` as well, so an agent who opened a call and pressed
   * submit had, without deciding anything, recorded that the professional
   * arrived on time, explained the work, resolved the issue and cleaned up. */
  const [answers, setAnswers] = useState<Record<string, string>>({});

  /* `submitSchema` (verification.schemas.ts:28-49) requires all of these, and
   * the API's own `QUESTIONNAIRE` (verification-console.service.ts:17-25) asks
   * the agent for each one. This screen used to satisfy the schema with
   * constants — `extraChargeDemanded: false`, `uniformWorn: true`,
   * `ownTools: true`, scores derived from the outcome button, and a hardcoded
   * `callDurationSeconds: 84`. Every one of those became a permanent row in the
   * verification record, describing something nobody had established. They are
   * now answers the agent has to give, and the commit is blocked until they are. */
  const [workCompleted, setWorkCompleted] = useState<"FULL" | "PARTIAL" | "NONE" | null>(null);
  const [extraChargeDemanded, setExtraChargeDemanded] = useState<boolean | null>(null);
  const [uniformWorn, setUniformWorn] = useState<boolean | null>(null);
  const [ownTools, setOwnTools] = useState<boolean | null>(null);
  /* What the customer said when asked whether payment may be released. The
   * domain refuses VERIFIED_SATISFIED *and* VERIFIED_WITH_ISSUE without it, so
   * it is a question the agent answers, not something read off the outcome. */
  const [consentToRelease, setConsentToRelease] = useState<boolean | null>(null);
  /* How much was demanded beyond the approved price, in rupees as typed. The
   * submit schema wants integer paisa and refuses a "yes" without an amount. */
  const [extraChargeRupees, setExtraChargeRupees] = useState("");
  /* The customer's own words, transcribed. This becomes their public review, so
   * the console never fills it in for them — left empty, nothing is sent. */
  const [customerRemark, setCustomerRemark] = useState("");
  /* A bridged call's references, attached to the attempt and the submission. */
  const [bridge, setBridge] = useState<{ callRef: string; recordingRef: string } | null>(null);
  const [scores, setScores] = useState<Record<"quality" | "punctuality" | "conduct" | "cleanliness", number | null>>({
    quality: null,
    punctuality: null,
    conduct: null,
    cleanliness: null,
  });
  const [outcome, setOutcome] = useState<"SATISFIED" | "WITH_ISSUE" | "REWORK" | "DISPUTED" | null>(null);
  const [selectedEvidence, setSelectedEvidence] = useState<{
    id: string;
    kind: string;
    url?: string;
    contentType?: string | null;
    receivedAt?: string;
    checklistItemId?: number | null;
  } | null>(null);

  useEffect(() => {
    if (!selectedEvidence) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedEvidence(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedEvidence]);

  /* Counts only while a call is up. Interval state, not a `Date.now()` in the
   * render body, so it does not restart on every re-render. */
  useEffect(() => {
    if (!callActive) return;
    const id = window.setInterval(() => setCallSeconds((previous) => previous + 1), 1000);
    return () => window.clearInterval(id);
  }, [callActive]);

  const callTimer = `${String(Math.floor(callSeconds / 60)).padStart(2, "0")}:${String(callSeconds % 60).padStart(2, "0")}`;

  /* Everything `submitSchema` requires, minus the outcome, which has its own
   * control. `answered` is what the Commit button is gated on. */
  const extraChargeAmountPaisa = extraChargeAmountToPaisa(extraChargeRupees);
  const answered =
    workCompleted !== null &&
    extraChargeDemanded !== null &&
    (extraChargeDemanded === false || extraChargeAmountPaisa !== null) &&
    consentToRelease !== null &&
    uniformWorn !== null &&
    ownTools !== null &&
    scores.quality !== null &&
    scores.punctuality !== null &&
    scores.conduct !== null &&
    scores.cleanliness !== null;
  const missing = [
    workCompleted === null ? "was the work completed" : null,
    scores.quality === null ? "quality" : null,
    scores.punctuality === null ? "punctuality" : null,
    scores.conduct === null ? "conduct" : null,
    scores.cleanliness === null ? "cleanliness" : null,
    extraChargeDemanded === null ? "extra charge demanded" : null,
    extraChargeDemanded === true && extraChargeAmountPaisa === null ? "amount demanded" : null,
    uniformWorn === null ? "uniform" : null,
    ownTools === null ? "own tools" : null,
    consentToRelease === null ? "consent to release payment" : null,
  ].filter((item) => item !== null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["agent", "console", verificationId],
    queryFn: () => agentApi.open(verificationId, { locale }),
    retry: 1,
  });

  const callMutation = useMutation({
    mutationFn: () => agentApi.startCall(verificationId, undefined, { locale }),
    onSuccess: (res) => {
      setCallActive(true);
      if (res.mode === "BRIDGED") {
        setBridge({ callRef: res.callRef, recordingRef: res.recordingRef });
        toast.success("Call initiated via bridge");
      } else {
        setBridge(null);
        toast.success(`Dial the customer: ${res.customerPhone}`);
      }
    },
    /* No call is up when the server refused one (423 outside calling hours, a
     * customer with no number, a lost lock) — say why instead of pretending. */
    onError: (err: unknown) => {
      toast.error(detailOf(err, dict));
    },
  });

  const attemptMutation = useMutation({
    mutationFn: (result: AttemptResult) =>
      agentApi.recordAttempt(
        verificationId,
        {
          result,
          ...(callSeconds > 0 ? { durationSeconds: callSeconds } : {}),
          ...(bridge === null ? {} : { callRef: bridge.callRef, recordingRef: bridge.recordingRef }),
        },
        { locale },
      ),
    onSuccess: (res) => {
      setCallActive(false);
      if (res?.linkSent) {
        toast.success("3 call attempts recorded! Verification SMS and WhatsApp link sent to customer.");
        queryClient.invalidateQueries({ queryKey: ["agent", "queue"] });
        router.push(localizedPath(locale, "/agent"));
      } else if (res?.result === "ANSWERED") {
        queryClient.invalidateQueries({ queryKey: ["agent", "console", verificationId] });
        toast.success("Call answered. You can now complete the interview questionnaire below.");
      } else {
        toast.success(`Attempt logged: ${res?.result}. Call returned to queue for next time band.`);
        queryClient.invalidateQueries({ queryKey: ["agent", "queue"] });
        router.push(localizedPath(locale, "/agent"));
      }
    },
    onError: (err: unknown) => {
      toast.error(detailOf(err, dict));
    },
  });

  /* `POST .../release-lock` — the only way to hand a claimed call back before the
   * lock times out. The client had it (`agentApi.releaseLock`) and no screen
   * offered it, so a claimed call stayed with the agent who opened it. */
  const releaseMutation = useMutation({
    mutationFn: () => agentApi.releaseLock(verificationId, { locale }),
    onSuccess: () => {
      setCallActive(false);
      toast.success(dict.agent.callReleased);
      queryClient.invalidateQueries({ queryKey: ["agent", "queue"] });
      router.push(localizedPath(locale, "/agent"));
    },
    onError: (err: unknown) => {
      toast.error(`${dict.agent.releaseFailed} ${detailOf(err, dict)}`);
    },
  });

  const submitMutation = useMutation({
    mutationFn: (payload: AgentSubmitPayload) => agentApi.submit(verificationId, payload, { locale }),
    onSuccess: (res) => {
      toast.success(
        res.released
          ? `Verification posted: ${res.outcome}. Payment released.`
          : `Verification posted: ${res.outcome}. Booking is now ${res.bookingStatus}.`,
      );
      queryClient.invalidateQueries({ queryKey: ["agent", "queue"] });
      queryClient.invalidateQueries({ queryKey: ["agent", "console", verificationId] });
      router.push(localizedPath(locale, "/agent"));
    },
    onError: (err: unknown) => {
      toast.error(detailOf(err, dict));
    },
  });

  if (isLoading) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center p-12 text-sm text-muted">
        <Loader2 className="mb-3 size-8 animate-spin text-primary" />
        <p className="font-semibold text-navy">Loading verification console...</p>
        <p className="mt-1 text-xs">Fetching customer record, work evidence and checklist</p>
      </div>
    );
  }

  if (isError && !fallbackBooking) {
    return (
      <div className="p-8 text-center">
        <AlertTriangle className="mx-auto mb-2 size-10 text-amber-500" />
        <h2 className="text-base font-bold text-navy">Unable to Load Verification #{verificationId}</h2>
        <p className="mt-1 text-sm text-secondary">
          {(error as Error)?.message || "The verification session may have expired or been locked by another agent."}
        </p>
        <div className="mt-4 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => refetch()}
            className="rounded-[8px] bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary-strong"
          >
            Retry
          </button>
          <Link
            href={localizedPath(locale, "/agent")}
            className="inline-flex items-center gap-1.5 rounded-[8px] border border-line bg-white px-4 py-2 text-xs font-semibold text-navy hover:bg-slate-50"
          >
            <ArrowLeft className="size-3.5" />
            Back to Queue
          </Link>
        </div>
      </div>
    );
  }

  /* Presentation values come from the API or they are not shown.
   *
   * This screen used to invent a rating ("4.9"), a verified job count (12), an
   * escrow account id (`ESCROW-{code}`), a "Start OTP Check: Verified" verdict
   that was never checked, an upload count, and two Unsplash stock photographs
   captioned "Before" and "After (Resolved)" as work evidence. An agent uses
   * this screen to release a customer's held money, so a fabricated view here
   * is a fabricated basis for a payout. Each of those is now either the
   * server's value or an explicit "not provided". */
  const bookingCode = data?.booking.code ?? fallbackBooking?.code ?? verificationId.slice(0, 8);
  const serviceName = data?.booking.serviceName ?? fallbackBooking?.serviceSlug ?? "Service Verification";
  const bookingStatus = data?.booking.status ?? fallbackBooking?.status ?? "AWAITING_VERIFICATION";
  const tierName = data?.verification.tier ?? null;
  const quotedAmount = data?.booking.approvedTotalPaisa ?? fallbackBooking?.quotedPaisa ?? null;
  const providerName = data?.provider.name ?? null;
  const averageScore = data?.providerHistory?.averageScore ?? null;
  const providerRating = averageScore === null ? null : averageScore.toFixed(1);
  const providerJobs = data?.providerHistory?.verifiedJobs ?? null;
  const consentText = data?.consentLine ?? dict.portal.consentRecorded;

  const defaultQuestions = [
    "Did the professional arrive within the confirmed window?",
    "Did they explain the work and quote before starting?",
    "Is the reported issue completely resolved?",
    "Was the work area cleaned up before the professional departed?",
  ];

  const questions = data?.questionnaire && data.questionnaire.length > 0
    ? data.questionnaire.map((q) => q.label)
    : defaultQuestions;

  const evidenceItems = data?.evidence ?? [];
  const checklistItems = data?.checklist ?? [];

  const attempts = data?.verification.attempts ?? [];
  const hasAnswered = attempts.some((a) => a.result === "ANSWERED");
  const distinctBands = new Set(attempts.filter((a) => a.result !== "ANSWERED").map((a) => a.band)).size;
  const isExhausted = attempts.filter((a) => a.result !== "ANSWERED").length >= 3 && distinctBands >= 2;
  const attempt = attempts.length + (hasAnswered ? 0 : 1);

  const handleCommit = async () => {
    if (!consent) {
      toast.error(dict.portal.consentLineRequired);
      return;
    }
    if (!outcome) {
      toast.error("Please select a decision outcome below (e.g., VERIFIED SATISFIED) first.");
      return;
    }
    if (!hasAnswered) {
      toast.error("You must record an answered call before submitting verification.");
      return;
    }
    if (!answered || workCompleted === null || extraChargeDemanded === null || uniformWorn === null || ownTools === null || consentToRelease === null) {
      toast.error(`Please answer all questions before posting: ${missing.join(", ")}`);
      return;
    }
    if (scores.quality === null || scores.punctuality === null || scores.conduct === null || scores.cleanliness === null) {
      toast.error("Please rate quality, punctuality, conduct, and cleanliness (1-5 each).");
      return;
    }

    if (callActive) {
      setCallActive(false);
    }

    const mappedOutcome: AgentSubmitPayload["outcome"] =
      outcome === "SATISFIED"
        ? "VERIFIED_SATISFIED"
        : outcome === "WITH_ISSUE"
        ? "VERIFIED_WITH_ISSUE"
        : outcome === "REWORK"
        ? "REWORK_REQUIRED"
        : "DISPUTED";

    /* The same rules the domain applies (`submissionProblems`), said before the
     * 422 rather than after it. */
    if ((extraChargeDemanded || workCompleted === "NONE") && mappedOutcome !== "DISPUTED") {
      toast.error("With an extra charge demanded or no work done, the only allowed outcome is DISPUTED.");
      return;
    }
    if ((mappedOutcome === "VERIFIED_SATISFIED" || mappedOutcome === "VERIFIED_WITH_ISSUE") && !consentToRelease) {
      toast.error("Payment cannot be released without the customer's verbal consent. Choose REWORK REQUIRED or DISPUTED.");
      return;
    }

    const payload = buildSubmitPayload({
      outcome: mappedOutcome,
      workCompleted,
      scores: { quality: scores.quality, punctuality: scores.punctuality, conduct: scores.conduct, cleanliness: scores.cleanliness },
      extraChargeDemanded,
      extraChargeAmountPaisa,
      uniformWorn,
      ownTools,
      consentLineRead: consent,
      consentToRelease,
      remark: customerRemark,
      recordingRef: bridge?.recordingRef ?? null,
      callSeconds,
    });

    submitMutation.mutate(payload);
  };

  return (
    <div>
      <PageHeader
        eyebrow={`${dict.portal.console} · ${bookingCode}`}
        title={serviceName}
        description={dict.portal.consoleDescription}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
              {dict.common.status}: {bookingStatus}
            </span>
            <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-primary-strong">
              {tierName}
            </span>
            <button
              type="button"
              disabled={releaseMutation.isPending || submitMutation.isPending || attemptMutation.isPending}
              onClick={() => releaseMutation.mutate()}
              className="inline-flex min-h-8 items-center rounded-[8px] border border-line bg-white px-3 text-xs font-semibold text-navy transition hover:bg-slate-50 disabled:opacity-50"
            >
              {releaseMutation.isPending ? dict.agent.releasingCall : dict.agent.releaseCall}
            </button>
          </div>
        }
      />

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* Left Column: Verification Questionnaire & SRS Release Engine */}
        <div className="space-y-6">
          <Card className="p-6">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
              <div>
                <h2 className="text-base font-semibold text-navy">
                  Customer Interview · {dict.portal.attempt} {attempt} of 3
                </h2>
                <p className="mt-0.5 text-xs text-muted">
                  Calling Window: 08:00 – 22:00 PKT (Asia/Karachi) · {data?.customer.firstName ? `Customer: ${data.customer.firstName}` : ""}
                </p>
              </div>

              {/* Call Controls & Outcome Loggers */}
              <div className="flex flex-wrap items-center gap-2">
                {!callActive ? (
                  <button
                    type="button"
                    disabled={callMutation.isPending || attemptMutation.isPending}
                    onClick={() => callMutation.mutate()}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-[8px] bg-emerald-600 px-3.5 text-xs font-semibold text-white shadow-xs transition hover:bg-emerald-700 disabled:opacity-50"
                  >
                    <PhoneCall className="size-3.5" />
                    {callMutation.isPending ? "Connecting..." : "Start Call Bridge"}
                  </button>
                ) : (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      disabled={attemptMutation.isPending}
                      onClick={() => attemptMutation.mutate("ANSWERED")}
                      className="inline-flex min-h-9 items-center gap-1.5 rounded-[8px] bg-emerald-600 px-3 text-xs font-semibold text-white shadow-xs transition hover:bg-emerald-700"
                    >
                      <CheckCircle2 className="size-3.5" />
                      Answered ({callTimer})
                    </button>
                    <button
                      type="button"
                      disabled={attemptMutation.isPending}
                      onClick={() => attemptMutation.mutate("NO_ANSWER")}
                      className="inline-flex min-h-9 items-center gap-1.5 rounded-[8px] bg-amber-600 px-2.5 text-xs font-semibold text-white transition hover:bg-amber-700"
                    >
                      <PhoneMissed className="size-3.5" />
                      No Answer
                    </button>
                    <button
                      type="button"
                      disabled={attemptMutation.isPending}
                      onClick={() => attemptMutation.mutate("BUSY")}
                      className="inline-flex min-h-9 items-center gap-1.5 rounded-[8px] bg-slate-700 px-2.5 text-xs font-semibold text-white transition hover:bg-slate-800"
                    >
                      <PhoneOff className="size-3.5" />
                      Busy
                    </button>
                    <button
                      type="button"
                      disabled={attemptMutation.isPending}
                      onClick={() => attemptMutation.mutate("SWITCHED_OFF")}
                      className="inline-flex min-h-9 items-center gap-1.5 rounded-[8px] bg-slate-700 px-2.5 text-xs font-semibold text-white transition hover:bg-slate-800"
                    >
                      Off
                    </button>
                  </div>
                )}

                {/* Quick Log for manual phone dials */}
                {!callActive && (
                  <div className="flex items-center gap-1 rounded-[8px] border border-line bg-slate-50 p-1">
                    <span className="px-1 text-[10px] font-semibold uppercase text-muted">Log Call:</span>
                    <button
                      type="button"
                      disabled={attemptMutation.isPending}
                      onClick={() => attemptMutation.mutate("ANSWERED")}
                      title="Log as Answered"
                      className="rounded bg-white px-2 py-1 text-xs font-medium text-navy shadow-2xs hover:bg-emerald-50 hover:text-emerald-700 transition"
                    >
                      Answered
                    </button>
                    <button
                      type="button"
                      disabled={attemptMutation.isPending}
                      onClick={() => attemptMutation.mutate("NO_ANSWER")}
                      title="Log as No Answer"
                      className="rounded px-2 py-1 text-xs font-medium text-secondary hover:bg-amber-50 hover:text-amber-800 transition"
                    >
                      No Answer
                    </button>
                    <button
                      type="button"
                      disabled={attemptMutation.isPending}
                      onClick={() => attemptMutation.mutate("BUSY")}
                      title="Log as Busy"
                      className="rounded px-2 py-1 text-xs font-medium text-secondary hover:bg-slate-100 hover:text-navy transition"
                    >
                      Busy
                    </button>
                    <button
                      type="button"
                      disabled={attemptMutation.isPending}
                      onClick={() => attemptMutation.mutate("SWITCHED_OFF")}
                      title="Log as Switched Off"
                      className="rounded px-2 py-1 text-xs font-medium text-secondary hover:bg-slate-100 hover:text-navy transition"
                    >
                      Off
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Call in progress. */}
            {callActive && (
              <div className="mt-4 flex items-center justify-between rounded-[10px] bg-slate-900 px-4 py-3 text-white">
                <div className="flex items-center gap-3">
                  <span className="relative flex size-3">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex size-3 rounded-full bg-emerald-500" />
                  </span>
                  <span className="text-xs font-medium tracking-wide">
                    Call in progress · {callTimer} · Choose an outcome button above when finished
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="h-4 w-1 animate-pulse rounded bg-emerald-400" />
                  <div className="h-6 w-1 animate-pulse rounded bg-emerald-400" />
                  <div className="h-3 w-1 animate-pulse rounded bg-emerald-400" />
                  <div className="h-5 w-1 animate-pulse rounded bg-emerald-400" />
                  <div className="h-2 w-1 animate-pulse rounded bg-emerald-400" />
                </div>
              </div>
            )}

            {/* Attempt History & Unreachable Protocol Card */}
            {attempts.length > 0 && (
              <div className="mt-4 rounded-[10px] border border-line bg-slate-50 p-4">
                <div className="flex items-center justify-between text-xs font-semibold text-navy">
                  <span className="flex items-center gap-1.5">
                    <History className="size-3.5 text-primary" />
                    Call Attempts History ({attempts.length} of 3 recorded)
                  </span>
                  {isExhausted && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-0.5 text-[10px] font-bold text-indigo-700 border border-indigo-200">
                      <MessageSquareText className="size-3" />
                      Fallback Link Sent (SMS & WhatsApp)
                    </span>
                  )}
                </div>

                <div className="mt-2.5 space-y-1.5 text-xs">
                  {attempts.map((att) => (
                    <div key={att.id} className="flex items-center justify-between rounded bg-white px-3 py-1.5 border border-line text-secondary">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-navy">Attempt #{att.attemptNo}</span>
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-muted">{att.band}</span>
                        <span className="text-[11px] text-muted">{new Date(att.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                      </div>
                      <span className={cn(
                        "rounded px-2 py-0.5 text-[10px] font-bold",
                        att.result === "ANSWERED" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"
                      )}>
                        {att.result.replace("_", " ")}
                      </span>
                    </div>
                  ))}
                </div>

                {isExhausted && (
                  <div className="mt-3 rounded-[8px] border border-indigo-200 bg-indigo-50/70 p-3 text-xs text-indigo-900">
                    <p className="flex items-center gap-1.5 font-semibold">
                      <Clock className="size-3.5 text-indigo-600" />
                      Unreachable Customer Protocol Active
                    </p>
                    <p className="mt-1 leading-relaxed text-indigo-800">
                      Customer did not answer calls across 3 time bands. A 1-tap confirmation link and OTP have been texted to the customer via SMS and WhatsApp. If the customer does not respond within 72 hours, the platform will automatically release payment (for online) or authorise collection (for cash).
                    </p>
                    <div className="mt-3">
                      <Link
                        href={localizedPath(locale, "/agent")}
                        className="inline-flex items-center gap-1.5 rounded bg-indigo-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-800"
                      >
                        <ArrowLeft className="size-3" />
                        Return to Verification Queue
                      </Link>
                    </div>
                  </div>
                )}
              </div>
            )}

            {!hasAnswered && (
              <div className="mt-4 rounded-[8px] border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 flex items-start gap-2">
                <PhoneMissed className="size-4 text-amber-700 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">Customer Has Not Answered Yet</p>
                  <p className="mt-0.5 leading-relaxed text-amber-800">
                    Please use the call controls above to connect with the customer. If the customer does not pick up, log &quot;No Answer&quot;, &quot;Busy&quot;, or &quot;Off&quot; to schedule the next time band attempt. An answered call is required before posting a verification decision.
                  </p>
                </div>
              </div>
            )}

            <label className="mt-5 flex items-start gap-3 rounded-[10px] bg-slate-50 p-4 text-sm text-secondary">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => {
                  setConsent(e.target.checked);
                  /* The outcome buttons are gated on consent; an outcome chosen
                   * before unticking must not survive it. */
                  if (!e.target.checked) setOutcome(null);
                }}
                className="mt-0.5 size-4 rounded border-line text-primary focus:ring-primary"
              />
              <span>
                <strong>{consentText}</strong> — Customer acknowledged the recorded quality & payment release verification call.
              </span>
            </label>

            {/* Customer Interview & Quality Verification Form */}
            <div className="mt-6 space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted">
                Customer Phone Interview Questions
              </h3>

              {/* 1. Work Completion */}
              <div
                className={cn(
                  "rounded-[10px] border p-4 transition-all",
                  workCompleted === null ? "border-line bg-white" : "border-emerald-200 bg-emerald-50/20"
                )}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-navy">1. Was the service completed?</p>
                    <p className="text-xs text-muted">Confirm with the customer whether the booked work is finished.</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { value: "FULL", label: "Fully completed" },
                      { value: "PARTIAL", label: "Partially completed" },
                      { value: "NONE", label: "Not completed" },
                    ].map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        aria-pressed={workCompleted === opt.value}
                        onClick={() => setWorkCompleted(opt.value as "FULL" | "PARTIAL" | "NONE")}
                        className={cn(
                          "min-h-9 rounded-[8px] border px-3 text-xs font-semibold transition",
                          workCompleted === opt.value
                            ? "border-primary bg-primary text-white shadow-xs"
                            : "border-line bg-white text-secondary hover:bg-slate-50"
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* 2. Customer Ratings (1-5) */}
              <div
                className={cn(
                  "rounded-[10px] border p-4 transition-all",
                  scores.quality && scores.punctuality && scores.conduct && scores.cleanliness
                    ? "border-emerald-200 bg-emerald-50/20"
                    : "border-line bg-white"
                )}
              >
                <div>
                  <p className="text-sm font-semibold text-navy">2. Rate Quality & Conduct (1 to 5 Stars)</p>
                  <p className="text-xs text-muted">Ask the customer to rate their experience in each dimension.</p>
                </div>
                <div className="mt-3 space-y-2.5">
                  {(["quality", "punctuality", "conduct", "cleanliness"] as const).map((key) => (
                    <div key={key} className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
                      <span className="text-xs font-medium capitalize text-navy">{key}</span>
                      <div className="flex gap-1.5" role="group" aria-label={`${key} rating`}>
                        {[1, 2, 3, 4, 5].map((val) => (
                          <button
                            key={val}
                            type="button"
                            aria-pressed={scores[key] === val}
                            onClick={() => setScores((prev) => ({ ...prev, [key]: val }))}
                            className={cn(
                              "size-8 rounded-[6px] border text-xs font-bold transition",
                              scores[key] === val
                                ? "border-primary bg-primary text-white shadow-xs"
                                : "border-line bg-white text-secondary hover:bg-slate-50"
                            )}
                          >
                            {val}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* 3. Extra Charge Demanded */}
              <div
                className={cn(
                  "rounded-[10px] border p-4 transition-all",
                  extraChargeDemanded !== null ? "border-emerald-200 bg-emerald-50/20" : "border-line bg-white"
                )}
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-navy">3. Was any extra charge demanded beyond approved quote?</p>
                    <p className="text-xs text-muted">Customer should not be charged anything outside the platform approved quote.</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      aria-pressed={extraChargeDemanded === true}
                      onClick={() => setExtraChargeDemanded(true)}
                      className={cn(
                        "min-h-8 min-w-14 rounded-[8px] border px-3 text-xs font-semibold transition",
                        extraChargeDemanded === true
                          ? "border-rose-600 bg-rose-600 text-white shadow-xs"
                          : "border-line bg-white text-secondary hover:bg-slate-50"
                      )}
                    >
                      {dict.common.yes}
                    </button>
                    <button
                      type="button"
                      aria-pressed={extraChargeDemanded === false}
                      onClick={() => setExtraChargeDemanded(false)}
                      className={cn(
                        "min-h-8 min-w-14 rounded-[8px] border px-3 text-xs font-semibold transition",
                        extraChargeDemanded === false
                          ? "border-primary bg-primary text-white shadow-xs"
                          : "border-line bg-white text-secondary hover:bg-slate-50"
                      )}
                    >
                      {dict.common.no}
                    </button>
                  </div>
                </div>
                {extraChargeDemanded === true ? (
                  <div className="mt-3">
                    <label htmlFor="extra-charge-amount" className="text-xs font-semibold text-navy">
                      How much was demanded? (Rs)
                    </label>
                    <input
                      id="extra-charge-amount"
                      type="number"
                      inputMode="decimal"
                      min={1}
                      step="0.01"
                      value={extraChargeRupees}
                      onChange={(e) => setExtraChargeRupees(e.target.value)}
                      className="mt-1 min-h-9 w-full max-w-48 rounded-[8px] border border-line bg-white px-3 text-sm text-navy outline-none focus:border-primary"
                    />
                  </div>
                ) : null}
              </div>

              {/* 4. Uniform & Tools */}
              <div
                className={cn(
                  "rounded-[10px] border p-4 transition-all",
                  uniformWorn !== null && ownTools !== null ? "border-emerald-200 bg-emerald-50/20" : "border-line bg-white"
                )}
              >
                <p className="text-sm font-semibold text-navy">4. Professional Standards & Compliance</p>
                <div className="mt-3 space-y-2.5">
                  {[
                    ["Did the professional arrive in uniform?", uniformWorn, setUniformWorn],
                    ["Did they bring their own equipment & tools?", ownTools, setOwnTools],
                  ].map(([label, val, setter], idx) => (
                    <div key={idx} className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
                      <span className="text-xs text-secondary">{label as string}</span>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          aria-pressed={val === true}
                          onClick={() => (setter as (v: boolean) => void)(true)}
                          className={cn(
                            "min-h-8 min-w-14 rounded-[8px] border px-3 text-xs font-semibold transition",
                            val === true
                              ? "border-primary bg-primary text-white shadow-xs"
                              : "border-line bg-white text-secondary hover:bg-slate-50"
                          )}
                        >
                          {dict.common.yes}
                        </button>
                        <button
                          type="button"
                          aria-pressed={val === false}
                          onClick={() => (setter as (v: boolean) => void)(false)}
                          className={cn(
                            "min-h-8 min-w-14 rounded-[8px] border px-3 text-xs font-semibold transition",
                            val === false
                              ? "border-primary bg-primary text-white shadow-xs"
                              : "border-line bg-white text-secondary hover:bg-slate-50"
                          )}
                        >
                          {dict.common.no}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* 5. Consent to release */}
              <div
                className={cn(
                  "rounded-[10px] border p-4 transition-all",
                  consentToRelease !== null ? "border-emerald-200 bg-emerald-50/20" : "border-line bg-white"
                )}
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-navy">5. Does the customer agree to release payment to the provider?</p>
                    <p className="text-xs text-muted">Record only what the customer said in words. Without a yes, payment is not released.</p>
                  </div>
                  <div className="flex gap-2" role="group" aria-label="Customer consented to release">
                    <button
                      type="button"
                      aria-pressed={consentToRelease === true}
                      onClick={() => setConsentToRelease(true)}
                      className={cn(
                        "min-h-8 min-w-14 rounded-[8px] border px-3 text-xs font-semibold transition",
                        consentToRelease === true
                          ? "border-primary bg-primary text-white shadow-xs"
                          : "border-line bg-white text-secondary hover:bg-slate-50"
                      )}
                    >
                      {dict.common.yes}
                    </button>
                    <button
                      type="button"
                      aria-pressed={consentToRelease === false}
                      onClick={() => setConsentToRelease(false)}
                      className={cn(
                        "min-h-8 min-w-14 rounded-[8px] border px-3 text-xs font-semibold transition",
                        consentToRelease === false
                          ? "border-rose-600 bg-rose-600 text-white shadow-xs"
                          : "border-line bg-white text-secondary hover:bg-slate-50"
                      )}
                    >
                      {dict.common.no}
                    </button>
                  </div>
                </div>
              </div>

              {/* 6. The customer's remark, in their words (optional) */}
              <div className="rounded-[10px] border border-line bg-white p-4">
                <label htmlFor="customer-remark" className="text-sm font-semibold text-navy">
                  6. Customer&apos;s remark, in their own words (optional)
                </label>
                <p className="text-xs text-muted">
                  Published as the customer&apos;s review under their first name and initial. Type only what the customer said; leave it empty if they said nothing.
                </p>
                <textarea
                  id="customer-remark"
                  rows={3}
                  maxLength={1000}
                  value={customerRemark}
                  onChange={(e) => setCustomerRemark(e.target.value)}
                  className="mt-2 w-full rounded-[8px] border border-line bg-white p-3 text-sm text-navy outline-none focus:border-primary"
                />
              </div>

              {answered ? (
                <div className="flex items-center gap-2 rounded-lg bg-emerald-50 p-3 text-xs font-medium text-emerald-800">
                  <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
                  All interview questions answered. Select an outcome below to finalize.
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-lg bg-amber-50 p-3 text-xs font-medium text-amber-800">
                  <AlertTriangle className="size-4 shrink-0 text-amber-600" />
                  Still to complete: <span className="font-semibold">{missing.join(", ")}</span>
                </div>
              )}
            </div>

            {/* Four SRS Outcomes Action Bar */}
            <div className="mt-8 border-t border-line pt-6">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-muted">
                  SRS §4.6 / TRD §9 Formal Decision &amp; Ledger Gate
                </h3>
                <span className="text-xs text-muted">Step 2: Choose Decision</span>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <button
                  type="button"
                  disabled={!consent}
                  onClick={() => setOutcome("SATISFIED")}
                  className={`flex flex-col items-center rounded-[10px] border p-3 text-center transition ${
                    outcome === "SATISFIED"
                      ? "border-emerald-600 bg-emerald-50 text-emerald-900 ring-2 ring-emerald-500 shadow-sm"
                      : "border-line hover:border-emerald-300 hover:bg-emerald-50/50"
                  }`}
                >
                  <CheckCircle2 className="size-5 text-emerald-600" />
                  <span className="mt-1 text-xs font-bold text-navy">VERIFIED SATISFIED</span>
                  <span className="mt-0.5 text-[10px] text-muted">Release 100% Escrow</span>
                </button>

                <button
                  type="button"
                  disabled={!consent}
                  onClick={() => setOutcome("WITH_ISSUE")}
                  className={`flex flex-col items-center rounded-[10px] border p-3 text-center transition ${
                    outcome === "WITH_ISSUE"
                      ? "border-amber-600 bg-amber-50 text-amber-900 ring-2 ring-amber-500 shadow-sm"
                      : "border-line hover:border-amber-300 hover:bg-amber-50/50"
                  }`}
                >
                  <AlertTriangle className="size-5 text-amber-600" />
                  <span className="mt-1 text-xs font-bold text-navy">WITH ISSUE</span>
                  <span className="mt-0.5 text-[10px] text-muted">Partial Hold / Review</span>
                </button>

                <button
                  type="button"
                  disabled={!consent}
                  onClick={() => setOutcome("REWORK")}
                  className={`flex flex-col items-center rounded-[10px] border p-3 text-center transition ${
                    outcome === "REWORK"
                      ? "border-rose-600 bg-rose-50 text-rose-900 ring-2 ring-rose-500 shadow-sm"
                      : "border-line hover:border-rose-300 hover:bg-rose-50/50"
                  }`}
                >
                  <RefreshCw className="size-5 text-rose-600" />
                  <span className="mt-1 text-xs font-bold text-navy">REWORK REQUIRED</span>
                  <span className="mt-0.5 text-[10px] text-muted">Issue fresh start OTP</span>
                </button>

                <button
                  type="button"
                  onClick={() => setOutcome("DISPUTED")}
                  className={`flex flex-col items-center rounded-[10px] border p-3 text-center transition ${
                    outcome === "DISPUTED"
                      ? "border-rose-700 bg-rose-50 ring-2 ring-rose-600 shadow-sm"
                      : "border-line hover:border-rose-300 hover:bg-rose-50"
                  }`}
                >
                  <XCircle className="size-5 text-rose-600" />
                  <span className="mt-1 text-xs font-bold text-navy">DISPUTED</span>
                  <span className="mt-0.5 text-[10px] text-muted">Freeze & Escalate</span>
                </button>
              </div>

              {/* Prominent Submission Action Card */}
              <div className="mt-5 rounded-xl border border-line bg-slate-900 p-5 text-white shadow-md">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div className="text-xs">
                    <p className="text-sm font-bold text-white flex items-center gap-2">
                      {outcome ? (
                        <>
                          <span className="inline-block size-2.5 rounded-full bg-emerald-400" />
                          Decision: {outcome === "SATISFIED" ? "VERIFIED SATISFIED (Release 100% Escrow)" : outcome === "WITH_ISSUE" ? "VERIFIED WITH ISSUE" : outcome === "REWORK" ? "REWORK REQUIRED" : "DISPUTED (Freeze & Escalate)"}
                        </>
                      ) : (
                        <>
                          <span className="inline-block size-2.5 rounded-full bg-amber-400 animate-pulse" />
                          Select a Decision Outcome Above
                        </>
                      )}
                    </p>
                    <p className="mt-1 text-slate-300 leading-relaxed">
                      {!outcome
                        ? "Click one of the 4 outcome cards above (e.g. VERIFIED SATISFIED) to authorize payment and unlock escrow."
                        : answered
                        ? "All questions answered. Click the submit button to post write-once record and trigger ledger posting."
                        : `Please complete remaining questions: ${missing.join(", ")}`}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={handleCommit}
                    disabled={submitMutation.isPending}
                    className={cn(
                      "inline-flex shrink-0 items-center justify-center gap-2 rounded-lg px-6 py-3 text-xs font-bold uppercase tracking-wider text-white shadow-md transition",
                      outcome && answered
                        ? "bg-emerald-600 hover:bg-emerald-500 cursor-pointer shadow-emerald-900/40"
                        : "bg-primary hover:bg-primary-strong cursor-pointer"
                    )}
                  >
                    {submitMutation.isPending ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        Posting...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="size-4" />
                        {outcome
                          ? `Submit ${outcome.replace("_", " ")}`
                          : "Submit Verification Decision"}
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </Card>

          {/* Checklist View if available */}
          {checklistItems.length > 0 && (
            <Card className="p-5">
              <h3 className="font-semibold text-navy">Service Checklist Requirements</h3>
              <div className="mt-3 divide-y divide-line text-sm">
                {checklistItems.map((item) => (
                  <div key={item.id} className="flex items-center justify-between py-2.5">
                    <span className="text-secondary">{item.label}</span>
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                      item.done ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-muted"
                    }`}>
                      {item.done ? <Check className="size-3" /> : null}
                      {item.done ? "Completed" : "Pending"}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        {/* Right Column: Work Evidence Floor & Provider Summary */}
        <div className="space-y-4">
          <Card className="p-5">
            <h3 className="font-semibold text-navy">{dict.common.professional}</h3>
            <div className="mt-3 flex items-center gap-3">
              <div className="grid size-10 place-items-center rounded-full bg-blue-50 text-sm font-bold text-primary-strong">
                {providerName === null ? "—" : providerName.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <p className="text-sm font-semibold text-navy">{providerName ?? "Not provided"}</p>
                {/* A rating and a job count the API did not send are not shown
                    as zeroes or dashes that read like a real figure — they are
                    omitted, so the absence is visible as absence. */}
                <p className="text-xs text-muted">
                  {providerRating === null && providerJobs === null
                    ? "No rating or job history provided"
                    : [
                        providerRating === null ? null : `Rating ${providerRating}`,
                        providerJobs === null ? null : `${providerJobs} jobs`,
                      ]
                        .filter((part) => part !== null)
                        .join(" · ")}
                </p>
              </div>
            </div>

            <div className="mt-4 border-t border-line pt-3 text-xs">
              <div className="flex justify-between py-1">
                <span className="text-muted">Quoted Amount</span>
                <span className="font-semibold text-navy">{quotedAmount === null ? "Not provided" : formatMoney(quotedAmount, locale)}</span>
              </div>
              {/* An escrow account id was invented by pasting the booking code
                  into a fake "ESCROW-" prefix. There is no such account, and an
                  agent reconciling against it would find nothing. */}
              <div className="flex justify-between py-1">
                <span className="text-muted">Escrow Account</span>
                <span className="text-muted">Not provided by the API</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-muted">Start OTP Check</span>
                {/* Was hardcoded to "Verified" on a screen whose whole purpose is
                    deciding whether to release escrow. It is now reported only
                    if the payload carries the verdict. */}
                <span className="font-semibold text-muted">Not reported by the API</span>
              </div>
            </div>
          </Card>

          {/* Evidence Floor Photos */}
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 font-semibold text-navy">
                <Camera className="size-4 text-primary" />
                Work Evidence Photos
              </h3>
              <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-muted">
                {evidenceItems.length > 0 ? `${evidenceItems.length} Uploads` : "None uploaded"}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted">
              Inspect uploaded before/after photos while verifying with the client.
            </p>

            <div className="mt-4 grid grid-cols-2 gap-2.5">
              {evidenceItems.length > 0 ? (
                evidenceItems.map((ev) => {
                  const badgeColor =
                    ev.kind === "BEFORE"
                      ? "bg-amber-600/90 text-white"
                      : ev.kind === "AFTER"
                        ? "bg-emerald-600/90 text-white"
                        : ev.kind === "CHECKLIST"
                          ? "bg-indigo-600/90 text-white"
                          : "bg-black/70 text-white";

                  return (
                    <button
                      key={ev.id}
                      type="button"
                      onClick={() => setSelectedEvidence(ev)}
                      className="group relative overflow-hidden rounded-[8px] border border-line bg-slate-100 text-left transition-all hover:border-primary/50 hover:shadow-sm focus:outline-hidden focus:ring-2 focus:ring-primary/40"
                    >
                      <div className="relative aspect-square w-full overflow-hidden bg-slate-100">
                        {typeof ev.url === "string" && ev.url !== "" ? (
                          <EvidenceImage
                            url={ev.url}
                            contentType={ev.contentType}
                            labels={mediaLabels(dict)}
                            alt={ev.kind}
                            className="size-full object-cover transition-transform duration-200 group-hover:scale-105"
                          />
                        ) : (
                          <div className="grid size-full place-items-center text-[10px] text-muted">No image</div>
                        )}
                        <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition-opacity group-hover:opacity-100">
                          <span className="flex items-center gap-1 rounded bg-black/60 px-2 py-1 text-[11px] font-medium text-white backdrop-blur-xs">
                            <Maximize2 className="size-3" />
                            Inspect
                          </span>
                        </div>
                      </div>
                      <span
                        className={cn(
                          "absolute bottom-1.5 start-1.5 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider backdrop-blur-xs",
                          badgeColor
                        )}
                      >
                        {ev.kind}
                      </span>
                    </button>
                  );
                })
              ) : (
                /* Nothing was uploaded. This used to render two Unsplash stock
                   photographs captioned "Before" and "After (Resolved)" — an
                   agent could have released escrow against a picture of someone
                   else's bathroom. */
                <div className="col-span-2 rounded-[8px] border border-dashed border-line bg-slate-50 p-6 text-center">
                  <p className="text-xs font-medium text-navy">No evidence photos were uploaded</p>
                  <p className="mt-1 text-xs text-muted">
                    Nothing has been sent for this job. Do not treat this job as evidenced.
                  </p>
                </div>
              )}
            </div>
          </Card>

          <Card className="p-5 text-xs text-secondary">
            <p className="flex items-center gap-2 font-semibold text-navy">
              <ShieldCheck className="size-4 text-primary" />
              Agent Telephony SLA
            </p>
            <p className="mt-2 leading-relaxed">
              {/* Was written as a statement of fact about a system this screen
                  cannot observe. Attempts and the posted decision are written to
                  <code className="font-mono text-[11px] text-navy">verification_calls</code> by the
                  API; whether a telephony provider captured audio is not reported
                  back here, so it is not claimed. */}
              Attempt outcomes and the posted decision are written to{" "}
              <code className="font-mono text-[11px] text-navy">verification_calls</code> by the API, with the agent id
              and timestamp. This screen does not confirm whether the call itself was recorded — ask the
              telephony provider for the recording reference.
            </p>
          </Card>
        </div>
      </div>

      {/* Lightbox / Full-size photo inspection modal */}
      {selectedEvidence && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-xs"
          onClick={() => setSelectedEvidence(null)}
        >
          <div
            className="relative flex max-h-[90vh] max-w-3xl w-full flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "rounded px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-white",
                    selectedEvidence.kind === "BEFORE"
                      ? "bg-amber-600"
                      : selectedEvidence.kind === "AFTER"
                        ? "bg-emerald-600"
                        : selectedEvidence.kind === "CHECKLIST"
                          ? "bg-indigo-600"
                          : "bg-slate-700"
                  )}
                >
                  {selectedEvidence.kind} Photo
                </span>
                {selectedEvidence.checklistItemId && (
                  <span className="text-xs text-secondary">
                    Checklist: {checklistItems.find((c) => c.id === selectedEvidence.checklistItemId)?.label ?? `#${selectedEvidence.checklistItemId}`}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setSelectedEvidence(null)}
                aria-label="Close photo preview"
                className="rounded-lg p-1.5 text-secondary hover:bg-slate-100 hover:text-navy"
              >
                <X className="size-5" />
              </button>
            </div>

            {/* Modal Body / Photo */}
            <div className="relative flex max-h-[72vh] min-h-[300px] items-center justify-center bg-slate-950 p-2">
              {selectedEvidence.url ? (
                <EvidenceImage
                  url={selectedEvidence.url}
                  contentType={selectedEvidence.contentType}
                  labels={mediaLabels(dict)}
                  controls
                  alt={selectedEvidence.kind}
                  className="max-h-[70vh] w-auto max-w-full object-contain"
                />
              ) : (
                <p className="p-12 text-sm text-slate-400">No image URL available</p>
              )}
            </div>

            {/* Modal Footer */}
            {selectedEvidence.receivedAt && (
              <div className="flex items-center justify-between border-t border-line bg-surface-2 px-5 py-2.5 text-xs text-muted">
                <span>Submitted by provider</span>
                <span>{new Date(selectedEvidence.receivedAt).toLocaleString()}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
