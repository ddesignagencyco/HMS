"use client";

import { CheckCircle2, Clock3, ShieldQuestion } from "lucide-react";
import { useState } from "react";
import type { Dictionary } from "@/lib/dictionaries";
import { ButtonLink, Card, Container, PageBanner, Textarea, buttonStyles } from "@/components/ui";
import { localizedPath, type Locale } from "@/lib/utils";

function NavyStage({ children }: { children: React.ReactNode }) {
  return (
    <section className="relative overflow-x-clip bg-navy-950 py-16 sm:py-24">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -start-32 -top-40 h-80 w-[38rem] rounded-full bg-[radial-gradient(ellipse_at_center,rgba(59,130,246,0.20),transparent_65%)]" />
      </div>
      <Container className="relative grid place-items-center">{children}</Container>
    </section>
  );
}

export function VerificationFlow({ locale, dict, token, expired, bookingCode }: { locale: Locale; dict: Dictionary; token: string; expired: boolean; bookingCode?: string }) {
  const [consent, setConsent] = useState(false);
  const [score, setScore] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const scoreLabels = [dict.customerVerify.score1, dict.customerVerify.score2, dict.customerVerify.score3, dict.customerVerify.score4, dict.customerVerify.score5];

  if (expired) {
    return (
      <NavyStage>
        <Card className="max-w-lg p-8 text-center shadow-lifted">
          <span className="mx-auto grid size-12 place-items-center rounded-full bg-amber-50 text-amber-700"><Clock3 className="size-6" /></span>
          <h1 className="mt-5 text-2xl font-semibold text-navy">{dict.customerVerify.expiredTitle}</h1>
          <p className="mt-2 text-sm leading-6 text-secondary">{dict.customerVerify.expiredText}</p>
          <ButtonLink href={localizedPath(locale, "/account/bookings")} className="mt-6">{dict.customerVerify.openBookings}</ButtonLink>
        </Card>
      </NavyStage>
    );
  }

  if (done) {
    return (
      <NavyStage>
        <Card className="max-w-lg p-8 text-center shadow-lifted">
          <span className="mx-auto grid size-12 place-items-center rounded-full bg-emerald-50 text-emerald-700"><CheckCircle2 className="size-6" /></span>
          <h1 className="mt-5 text-2xl font-semibold text-navy">{dict.customerVerify.doneTitle}</h1>
          <p className="mt-2 text-sm leading-6 text-secondary">{dict.customerVerify.doneText}</p>
          <ButtonLink href={localizedPath(locale, "/account/bookings")} variant="secondary" className="mt-6">{dict.customerVerify.openBookings}</ButtonLink>
        </Card>
      </NavyStage>
    );
  }

  return (
    <>
      <PageBanner
        eyebrow={bookingCode ? `${dict.customerVerify.eyebrow} · ${bookingCode}` : `${dict.customerVerify.eyebrow} · ${token}`}
        title={dict.customerVerify.titleLead}
        titleAccent={dict.customerVerify.titleAccent}
        description={dict.customerVerify.description}
      />
      <Container className="py-12">
        <div className="mx-auto max-w-2xl">
          <Card className="p-6">
            <label className="flex items-start gap-3 text-sm font-medium text-navy">
              <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} className="mt-0.5" />
              {dict.customerVerify.consent}
            </label>

            <fieldset className="mt-7">
              <legend className="text-sm font-semibold text-navy">{dict.customerVerify.scoreLegend}</legend>
              <div className="mt-3 grid grid-cols-5 gap-2">
                {[1, 2, 3, 4, 5].map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setScore(value)}
                    aria-pressed={score === value}
                    className={`min-h-14 rounded-[9px] border text-base font-semibold transition-colors duration-200 ${
                      score === value
                        ? "border-primary bg-blue-50 text-primary-strong"
                        : "border-line text-secondary hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    {value}
                  </button>
                ))}
              </div>
              <div className="mt-2 flex justify-between text-[11px] text-muted">
                <span>{scoreLabels[0]}</span>
                <span>{scoreLabels[4]}</span>
              </div>
            </fieldset>

            <label className="mt-6 grid gap-2 text-sm font-medium text-navy">
              {dict.customerVerify.noteLabel}
              <Textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder={dict.customerVerify.noteHint} className="font-normal" />
            </label>

            {error ? <p role="alert" className="mt-4 rounded-[9px] bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}

            <button
              type="button"
              onClick={() => {
                if (!consent) return setError(dict.customerVerify.consentRequired);
                if (score === null) return setError(dict.customerVerify.scoreRequired);
                setError("");
                setDone(true);
              }}
              className={buttonStyles({ className: "mt-6 w-full" })}
            >
              <ShieldQuestion className="size-4" />
              {dict.customerVerify.submit}
            </button>
          </Card>
        </div>
      </Container>
    </>
  );
}
