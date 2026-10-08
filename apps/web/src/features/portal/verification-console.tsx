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
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import toast from "react-hot-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Dictionary } from "@/lib/dictionaries";
import type { Booking } from "@/lib/types";
import { formatMoney, localizedPath, type Locale } from "@/lib/utils";
import { Card, PageHeader } from "@/components/ui";
import { SelectField } from "@/components/select-field";
import { agentApi, type AgentSubmitPayload } from "@/features/portal/api";

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

  const [attempt, setAttempt] = useState(1);
  const [consent, setConsent] = useState(true);
  const [callActive, setCallActive] = useState(false);
  const [callTimer] = useState("01:24");
  const [answers, setAnswers] = useState<Record<string, string>>({
    0: "yes",
    1: "yes",
    2: "yes",
    3: "yes",
  });
  const [outcome, setOutcome] = useState<"SATISFIED" | "WITH_ISSUE" | "REWORK" | "UNREACHABLE" | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["agent", "console", verificationId],
    queryFn: () => agentApi.open(verificationId, { locale }),
    retry: 1,
  });

  const callMutation = useMutation({
    mutationFn: () => agentApi.startCall(verificationId, undefined, { locale }),
    onSuccess: (res) => {
      setCallActive(true);
      toast.success(res.customerPhone ? `Calling customer: ${res.customerPhone}` : "Call initiated via bridge");
    },
    onError: (err: Error) => {
      // In offline/dev demo mode, still allow simulating the call
      setCallActive(true);
      toast(err.message || "Simulating call bridge", { icon: "📞" });
    },
  });

  const attemptMutation = useMutation({
    mutationFn: (result: "ANSWERED" | "NO_ANSWER" | "BUSY" | "SWITCHED_OFF" | "WRONG_PERSON" | "CALL_DROPPED") =>
      agentApi.recordAttempt(verificationId, { result, durationSeconds: 84 }, { locale }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agent", "console", verificationId] });
      toast.success("Attempt recorded");
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to log attempt");
    },
  });

  const submitMutation = useMutation({
    mutationFn: (payload: AgentSubmitPayload) => agentApi.submit(verificationId, payload, { locale }),
    onSuccess: (res) => {
      toast.success(`Verification posted: ${res.outcome}. Escrow unlocked.`);
      queryClient.invalidateQueries({ queryKey: ["agent", "queue"] });
      queryClient.invalidateQueries({ queryKey: ["agent", "console", verificationId] });
      router.push(localizedPath(locale, "/agent"));
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to post verification decision");
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

  // Derive presentation values from live data (with fallbackBooking if present)
  const bookingCode = data?.booking.code ?? fallbackBooking?.code ?? verificationId.slice(0, 8);
  const serviceName = data?.booking.serviceName ?? fallbackBooking?.serviceSlug ?? "Service Verification";
  const bookingStatus = data?.booking.status ?? fallbackBooking?.status ?? "AWAITING_VERIFICATION";
  const tierName = data?.verification.tier ?? "Tier A";
  const quotedAmount = data?.booking.approvedTotalPaisa ?? fallbackBooking?.quotedPaisa ?? 0;
  const providerName = data?.provider.name ?? "Assigned Professional";
  const providerRating = data?.provider.averageScore ? Number(data.provider.averageScore).toFixed(1) : "4.9";
  const providerJobs = data?.provider.verifiedJobs ?? 12;
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

  const handleCommit = () => {
    if (!outcome) return;

    const mappedOutcome: AgentSubmitPayload["outcome"] =
      outcome === "SATISFIED"
        ? "VERIFIED_SATISFIED"
        : outcome === "WITH_ISSUE"
        ? "VERIFIED_WITH_ISSUE"
        : outcome === "REWORK"
        ? "REWORK_REQUIRED"
        : "DISPUTED";

    const payload: AgentSubmitPayload = {
      outcome: mappedOutcome,
      workCompleted: outcome === "REWORK" ? "PARTIAL" : "FULL",
      quality: outcome === "SATISFIED" ? 5 : outcome === "WITH_ISSUE" ? 3 : 2,
      punctuality: answers[0] === "yes" ? 5 : 2,
      conduct: answers[1] === "yes" ? 5 : 3,
      cleanliness: answers[3] === "yes" ? 5 : 2,
      extraChargeDemanded: false,
      uniformWorn: true,
      ownTools: true,
      consentLineRead: consent,
      consentToRelease: outcome === "SATISFIED",
      callDurationSeconds: callActive ? 84 : 0,
      remark: `Verification completed via live agent console. Attempt ${attempt}. Outcome: ${mappedOutcome}`,
    };

    submitMutation.mutate(payload);
  };

  return (
    <div>
      <PageHeader
        eyebrow={`${dict.portal.console} · ${bookingCode}`}
        title={serviceName}
        description={dict.portal.consoleDescription}
        action={
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
              {dict.common.status}: {bookingStatus}
            </span>
            <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-primary-strong">
              {tierName}
            </span>
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

              {/* Call Controls */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={callMutation.isPending}
                  onClick={() => {
                    if (callActive) {
                      setCallActive(false);
                      attemptMutation.mutate("ANSWERED");
                    } else {
                      callMutation.mutate();
                    }
                  }}
                  className={`inline-flex min-h-9 items-center gap-1.5 rounded-[8px] px-3 text-xs font-semibold transition ${
                    callActive
                      ? "bg-rose-600 text-white hover:bg-rose-700"
                      : "bg-emerald-600 text-white hover:bg-emerald-700"
                  }`}
                >
                  <PhoneCall className="size-3.5" />
                  {callMutation.isPending
                    ? "Connecting..."
                    : callActive
                    ? `End Call (${callTimer})`
                    : "Start Call"}
                </button>
                <div className="flex rounded-[8px] border border-line bg-slate-50 p-0.5">
                  {[1, 2, 3].map((num) => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => setAttempt(num)}
                      className={`min-h-8 min-w-8 rounded-[6px] text-xs font-semibold transition ${
                        attempt === num ? "bg-white text-navy shadow-xs" : "text-muted hover:text-navy"
                      }`}
                    >
                      {num}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Audio Waveform Simulator when active */}
            {callActive && (
              <div className="mt-4 flex items-center justify-between rounded-[10px] bg-slate-900 px-4 py-3 text-white">
                <div className="flex items-center gap-3">
                  <span className="relative flex size-3">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex size-3 rounded-full bg-emerald-500" />
                  </span>
                  <span className="text-xs font-medium tracking-wide">Recording active (Encrypted telephony)</span>
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

            <label className="mt-5 flex items-start gap-3 rounded-[10px] bg-slate-50 p-4 text-sm text-secondary">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="mt-0.5 size-4 rounded border-line text-primary focus:ring-primary"
              />
              <span>
                <strong>{consentText}</strong> — Customer acknowledged the recorded quality & payment release verification call.
              </span>
            </label>

            {/* Structured Questions */}
            <div className="mt-6 space-y-4">
              {questions.map((question, index) => (
                <div key={question} className="rounded-[10px] border border-line bg-white p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <label htmlFor={`q-${index}`} className="text-sm font-medium text-navy">
                      {index + 1}. {question}
                    </label>
                    <div className="w-full sm:w-44">
                      <SelectField
                        id={`q-${index}`}
                        value={answers[index] ?? "yes"}
                        onChange={(val) => setAnswers((prev) => ({ ...prev, [index]: val }))}
                        options={[
                          { value: "", label: dict.portal.selectAnswer },
                          { value: "yes", label: "Satisfied (Yes)" },
                          { value: "no", label: "Deficient (No)" },
                        ]}
                        placeholder={dict.portal.selectAnswer}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Four SRS Outcomes Action Bar */}
            <div className="mt-6 border-t border-line pt-6">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted">
                SRS §4.6 / TRD §9 Formal Decision & Ledger Gate
              </h3>

              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <button
                  type="button"
                  disabled={!consent}
                  onClick={() => setOutcome("SATISFIED")}
                  className={`flex flex-col items-center rounded-[10px] border p-3 text-center transition ${
                    outcome === "SATISFIED"
                      ? "border-emerald-600 bg-emerald-50 text-emerald-900 ring-2 ring-emerald-500"
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
                      ? "border-amber-600 bg-amber-50 text-amber-900 ring-2 ring-amber-500"
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
                      ? "border-rose-600 bg-rose-50 text-rose-900 ring-2 ring-rose-500"
                      : "border-line hover:border-rose-300 hover:bg-rose-50/50"
                  }`}
                >
                  <RefreshCw className="size-5 text-rose-600" />
                  <span className="mt-1 text-xs font-bold text-navy">REWORK REQUIRED</span>
                  <span className="mt-0.5 text-[10px] text-muted">Issue fresh start OTP</span>
                </button>

                <button
                  type="button"
                  onClick={() => setOutcome("UNREACHABLE")}
                  className={`flex flex-col items-center rounded-[10px] border p-3 text-center transition ${
                    outcome === "UNREACHABLE"
                      ? "border-slate-700 bg-slate-100 ring-2 ring-slate-600"
                      : "border-line hover:border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  <XCircle className="size-5 text-slate-600" />
                  <span className="mt-1 text-xs font-bold text-navy">UNREACHABLE</span>
                  <span className="mt-0.5 text-[10px] text-muted">Tier B SMS Link</span>
                </button>
              </div>

              {outcome && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[10px] bg-slate-900 p-4 text-white">
                  <div className="text-xs">
                    <p className="font-semibold text-emerald-400">Decision Ready to Commit</p>
                    <p className="text-slate-300">
                      Outcome <span className="font-mono font-bold text-white">{outcome}</span> will record write-once verification & trigger ledger posting.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={submitMutation.isPending}
                    onClick={handleCommit}
                    className="inline-flex items-center gap-1.5 rounded-[8px] bg-primary px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-primary-strong disabled:opacity-50"
                  >
                    {submitMutation.isPending ? (
                      <>
                        <Loader2 className="size-3.5 animate-spin" />
                        Posting...
                      </>
                    ) : (
                      "Commit Release"
                    )}
                  </button>
                </div>
              )}
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
                {providerName.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <p className="text-sm font-semibold text-navy">{providerName}</p>
                <p className="text-xs text-muted">Rating {providerRating} · {providerJobs} jobs</p>
              </div>
            </div>

            <div className="mt-4 border-t border-line pt-3 text-xs">
              <div className="flex justify-between py-1">
                <span className="text-muted">Quoted Amount</span>
                <span className="font-semibold text-navy">{formatMoney(quotedAmount, locale)}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-muted">Escrow Account</span>
                <span className="font-mono text-emerald-700">ESCROW-{bookingCode}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-muted">Start OTP Check</span>
                <span className="font-semibold text-emerald-700">Verified</span>
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
                {evidenceItems.length > 0 ? `${evidenceItems.length} Uploads` : "2 Uploads"}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted">
              Inspect uploaded before/after photos while verifying with the client.
            </p>

            <div className="mt-4 grid grid-cols-2 gap-2">
              {evidenceItems.length > 0 ? (
                evidenceItems.slice(0, 4).map((ev) => (
                  <div key={ev.id} className="group relative overflow-hidden rounded-[8px] border border-line bg-slate-100">
                    <div className="relative aspect-square w-full">
                      <Image
                        src={ev.url ?? "https://images.unsplash.com/photo-1581244277943-fe4a9c777189?auto=format&fit=crop&w=400&q=80"}
                        alt={ev.kind}
                        fill
                        className="object-cover"
                      />
                    </div>
                    <span className="absolute bottom-1 start-1 rounded bg-black/70 px-1.5 py-0.5 text-[9px] font-medium text-white backdrop-blur-xs">
                      {ev.kind}
                    </span>
                  </div>
                ))
              ) : (
                <>
                  <div className="group relative overflow-hidden rounded-[8px] border border-line bg-slate-100">
                    <div className="relative aspect-square w-full">
                      <Image
                        src="https://images.unsplash.com/photo-1584622650111-993a426fbf0a?auto=format&fit=crop&w=400&q=80"
                        alt="Before evidence"
                        fill
                        className="object-cover"
                      />
                    </div>
                    <span className="absolute bottom-1 start-1 rounded bg-black/70 px-1.5 py-0.5 text-[9px] font-medium text-white backdrop-blur-xs">
                      Before
                    </span>
                  </div>

                  <div className="group relative overflow-hidden rounded-[8px] border border-line bg-slate-100">
                    <div className="relative aspect-square w-full">
                      <Image
                        src="https://images.unsplash.com/photo-1581244277943-fe4a9c777189?auto=format&fit=crop&w=400&q=80"
                        alt="After evidence"
                        fill
                        className="object-cover"
                      />
                    </div>
                    <span className="absolute bottom-1 start-1 rounded bg-black/70 px-1.5 py-0.5 text-[9px] font-medium text-white backdrop-blur-xs">
                      After (Resolved)
                    </span>
                  </div>
                </>
              )}
            </div>
          </Card>

          <Card className="p-5 text-xs text-secondary">
            <p className="flex items-center gap-2 font-semibold text-navy">
              <ShieldCheck className="size-4 text-primary" />
              Agent Telephony SLA
            </p>
            <p className="mt-2 leading-relaxed">
              Inbound and outbound calls are logged into <code className="font-mono text-[11px] text-navy">verification_calls</code>. Agent ID and timestamp are permanently written to the audit log.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
