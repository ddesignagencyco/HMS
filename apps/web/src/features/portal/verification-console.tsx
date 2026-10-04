"use client";

import { CheckCircle2, PhoneCall, RefreshCw, XCircle, AlertTriangle, ShieldCheck, Camera } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import type { Dictionary } from "@/lib/dictionaries";
import type { Booking } from "@/lib/types";
import { getService, providers } from "@/lib/data";
import { formatMoney, type Locale } from "@/lib/utils";
import { Card, PageHeader } from "@/components/ui";
import { SelectField } from "@/components/select-field";

export function VerificationConsole({ locale, dict, booking }: { locale: Locale; dict: Dictionary; booking: Booking }) {
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

  const service = getService(booking.serviceSlug);
  const provider = providers.find((item) => item.id === booking.providerId);

  const questions = [
    "Did the professional arrive within the confirmed window?",
    "Did they explain the work and quote before starting?",
    "Is the reported issue completely resolved?",
    "Was the work area cleaned up before the professional departed?",
  ];

  return (
    <div>
      <PageHeader
        eyebrow={`${dict.portal.console} · ${booking.code}`}
        title={service?.name[locale] ?? booking.serviceSlug}
        description={dict.portal.consoleDescription}
        action={
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
              {dict.common.status}: {booking.status}
            </span>
            <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-primary-strong">
              Tier A Call
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
                  Calling Window: 08:00 – 22:00 PKT (Asia/Karachi)
                </p>
              </div>

              {/* Call Controls Simulation */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCallActive(!callActive)}
                  className={`inline-flex min-h-9 items-center gap-1.5 rounded-[8px] px-3 text-xs font-semibold transition ${
                    callActive
                      ? "bg-rose-600 text-white hover:bg-rose-700"
                      : "bg-emerald-600 text-white hover:bg-emerald-700"
                  }`}
                >
                  <PhoneCall className="size-3.5" />
                  {callActive ? `End Call (${callTimer})` : "Start Call"}
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
                <strong>{dict.portal.consentRecorded}</strong> — Customer acknowledged the recorded quality & payment release verification call.
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
                        value={answers[index] ?? ""}
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
                <div className="mt-4 flex items-center justify-between rounded-[10px] bg-slate-900 p-4 text-white">
                  <div className="text-xs">
                    <p className="font-semibold text-emerald-400">Decision Ready to Commit</p>
                    <p className="text-slate-300">
                      Outcome <span className="font-mono font-bold text-white">{outcome}</span> will record write-once verification & trigger ledger posting.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => alert(`Verification record posted: ${outcome}. Ledger unlocked.`)}
                    className="rounded-[8px] bg-primary px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-primary-strong"
                  >
                    Commit Release
                  </button>
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* Right Column: Work Evidence Floor & Provider Summary */}
        <div className="space-y-4">
          <Card className="p-5">
            <h3 className="font-semibold text-navy">{dict.common.professional}</h3>
            <div className="mt-3 flex items-center gap-3">
              <div className="grid size-10 place-items-center rounded-full bg-blue-50 text-sm font-bold text-primary-strong">
                {provider?.name.slice(0, 2) ?? "PR"}
              </div>
              <div>
                <p className="text-sm font-semibold text-navy">{provider?.name ?? "-"}</p>
                <p className="text-xs text-muted">Rating {provider?.rating.toFixed(1)} · {provider?.verifiedJobs} jobs</p>
              </div>
            </div>

            <div className="mt-4 border-t border-line pt-3 text-xs">
              <div className="flex justify-between py-1">
                <span className="text-muted">Quoted Amount</span>
                <span className="font-semibold text-navy">{formatMoney(booking.quotedPaisa, locale)}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-muted">Escrow Account</span>
                <span className="font-mono text-emerald-700">ESCROW-{booking.code}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-muted">Start OTP Check</span>
                <span className="font-semibold text-emerald-700">Verified (482913)</span>
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
                2 Uploads
              </span>
            </div>
            <p className="mt-1 text-xs text-muted">
              Inspect uploaded before/after photos while verifying with the client.
            </p>

            <div className="mt-4 grid grid-cols-2 gap-2">
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
