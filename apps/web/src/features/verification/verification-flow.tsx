"use client";

import { CheckCircle2, Clock3, PhoneCall, ShieldQuestion } from "lucide-react";
import { useState } from "react";
import type { Dictionary } from "@/lib/dictionaries";
import { ButtonLink, Card, Container, PageBanner, buttonStyles } from "@/components/ui";
import { money } from "@/features/catalogue/pricing";
import { ApiError } from "@/lib/api/problem";
import { isNotFoundError } from "@/lib/api/keys";
import { verificationApi, type VerificationAnswers, type VerificationLink } from "./api";
import { cn, localizedPath, type Locale } from "@/lib/utils";

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

/** The scores the API asks for, each 1–5, with the label each is shown under. */
const RATING_KEYS = [
  { key: "quality", label: "scoreQuality" },
  { key: "punctuality", label: "scorePunctuality" },
  { key: "conduct", label: "scoreConduct" },
  { key: "cleanliness", label: "scoreCleanliness" },
] as const;

type RatingKey = (typeof RATING_KEYS)[number]["key"];

const WORK_COMPLETED = ["FULL", "PARTIAL", "NONE"] as const;
const WORK_LABEL: Record<(typeof WORK_COMPLETED)[number], "workFULL" | "workPARTIAL" | "workNONE"> = {
  FULL: "workFULL",
  PARTIAL: "workPARTIAL",
  NONE: "workNONE",
};

export function VerificationFlow({
  locale,
  dict,
  token,
  link,
  expired,
  loading,
  loadError,
}: {
  locale: Locale;
  dict: Dictionary;
  token: string;
  /** `GET /v/:token`. Null while loading, on 404 and on 410. */
  link: VerificationLink | null;
  expired: boolean;
  loading: boolean;
  /** The server's own `detail`, when it gave one. */
  loadError: string | null;
}) {
  const [otp, setOtp] = useState("");
  const [workCompleted, setWorkCompleted] = useState<(typeof WORK_COMPLETED)[number] | null>(null);
  const [ratings, setRatings] = useState<Record<RatingKey, number | null>>({
    quality: null,
    punctuality: null,
    conduct: null,
    cleanliness: null,
  });
  const [extraCharge, setExtraCharge] = useState<boolean | null>(null);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<"CONFIRMED" | "ESCALATED" | null>(null);

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

  /* The success screen is only reachable from a 200 `CONFIRMED`. There is no
     local flag: announcing that a job was confirmed when the server never heard
     about it is the one failure this screen must not have. */
  if (outcome !== null) {
    const confirmed = outcome === "CONFIRMED";
    return (
      <NavyStage>
        <Card className="max-w-lg p-8 text-center shadow-lifted">
          <span className={cn("mx-auto grid size-12 place-items-center rounded-full", confirmed ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700")}>
            {confirmed ? <CheckCircle2 className="size-6" /> : <PhoneCall className="size-6" />}
          </span>
          <h1 className="mt-5 text-2xl font-semibold text-navy">
            {confirmed ? dict.customerVerify.doneTitle : dict.customerVerify.escalatedTitle}
          </h1>
          <p className="mt-2 text-sm leading-6 text-secondary">
            {confirmed ? dict.customerVerify.doneText : dict.customerVerify.escalatedText}
          </p>
          <ButtonLink href={localizedPath(locale, "/account/bookings")} variant={confirmed ? "secondary" : "primary"} className="mt-6">
            {dict.customerVerify.openBookings}
          </ButtonLink>
        </Card>
      </NavyStage>
    );
  }

  if (loading) {
    return (
      <NavyStage>
        <div className="w-full max-w-lg" aria-busy="true" aria-live="polite">
          <span className="skeleton block h-8 w-56 rounded-[9px]" />
          <span className="skeleton mt-4 block h-4 w-full rounded-[9px]" />
          <span className="skeleton mt-2 block h-4 w-3/4 rounded-[9px]" />
        </div>
      </NavyStage>
    );
  }

  /* 404 and 410 both land here, and both mean the same thing to this person: this
     link cannot be used. Saying which would be a guess. */
  if (link === null) {
    return (
      <NavyStage>
        <Card className="max-w-lg p-8 text-center shadow-lifted">
          <span className="mx-auto grid size-12 place-items-center rounded-full bg-amber-50 text-amber-700"><Clock3 className="size-6" /></span>
          <h1 className="mt-5 text-2xl font-semibold text-navy">{dict.customerVerify.expiredTitle}</h1>
          <p className="mt-2 text-sm leading-6 text-secondary">
            {loadError ?? dict.customerVerify.expiredText}
          </p>
          <ButtonLink href={localizedPath(locale, "/account/bookings")} className="mt-6">{dict.customerVerify.openBookings}</ButtonLink>
        </Card>
      </NavyStage>
    );
  }

  const setRating = (key: RatingKey, value: number) => setRatings((current) => ({ ...current, [key]: value }));

  const submit = async () => {
    if (otp.trim().length !== 6) return setError(dict.customerVerify.otpRequired);
    if (workCompleted === null) return setError(dict.customerVerify.workRequired);
    if (RATING_KEYS.some((item) => ratings[item.key] === null)) return setError(dict.customerVerify.ratingsRequired);
    if (extraCharge === null) return setError(dict.customerVerify.extraChargeRequired);
    if (!consent) return setError(dict.customerVerify.consentRequired);

    setError("");
    setPending(true);
    try {
      const answers: VerificationAnswers = {
        otp: otp.trim(),
        workCompleted,
        quality: ratings.quality as number,
        punctuality: ratings.punctuality as number,
        conduct: ratings.conduct as number,
        cleanliness: ratings.cleanliness as number,
        extraChargeDemanded: extraCharge,
        consentToRelease: consent,
      };
      const result = await verificationApi.respond(token, answers, locale);
      setOutcome(result.status);
    } catch (caught) {
      /* The server's `detail` is the only account of why it was refused — a wrong
         code leaves attempts remaining, and saying so is more useful than a
         generic failure. 423 and 410 have their own words. */
      setError(
        caught instanceof ApiError
          ? caught.code === "OTP_LOCKED"
            ? dict.customerVerify.otpLocked
            : caught.code === "GONE"
              ? dict.customerVerify.expiredText
              : caught.problem.detail || dict.customerVerify.submitFailed
          : dict.customerVerify.submitFailed,
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <PageBanner
        eyebrow={`${dict.customerVerify.eyebrow} · ${link.bookingCode}`}
        title={link.serviceName}
        titleAccent={dict.customerVerify.titleAccent}
        description={dict.customerVerify.description}
      />
      <Container className="py-12">
        <div className="mx-auto max-w-2xl">
          {/* The job being confirmed, named from the server so a customer can see
              it is the one they had done. */}
          <Card className="p-6">
            <dl className="grid gap-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted">{dict.customerVerify.yourBooking}</dt>
                <dd className="font-mono text-end text-navy">{link.bookingCode}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted">{dict.common.professional}</dt>
                <dd className="text-end text-navy">{link.providerFirstName}</dd>
              </div>
              {link.amountPaisa !== null ? (
                <div className="flex justify-between gap-4">
                  <dt className="text-muted">{dict.common.amount}</dt>
                  <dd className="text-end font-semibold text-navy tabular-nums">{money(link.amountPaisa, locale)}</dd>
                </div>
              ) : null}
            </dl>
          </Card>

          <Card className="mt-5 p-6">
            {/* The one-time code from the text. This is what makes the link
                verifiable: without it anyone holding the URL could confirm
                somebody else's job. */}
            <div className="grid gap-2">
              <label htmlFor="verify-otp" className="text-sm font-medium text-navy">{dict.customerVerify.otpLabel}</label>
              <input
                id="verify-otp"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={otp}
                onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))}
                className="w-40 rounded-[9px] border border-line px-3 py-2.5 text-center font-mono text-lg tracking-[0.3em] text-navy focus:border-primary focus:outline-none"
              />
              <p className="text-xs text-muted">{dict.customerVerify.otpHint}</p>
            </div>

            <fieldset className="mt-7">
              <legend className="text-sm font-semibold text-navy">{dict.customerVerify.workCompletedLegend}</legend>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                {WORK_COMPLETED.map((value) => (
                  <ChoiceButton key={value} active={workCompleted === value} onClick={() => setWorkCompleted(value)}>
                    {dict.customerVerify[WORK_LABEL[value]]}
                  </ChoiceButton>
                ))}
              </div>
            </fieldset>

            <fieldset className="mt-7">
              <legend className="text-sm font-semibold text-navy">{dict.customerVerify.scoreLegend}</legend>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                {RATING_KEYS.map((item) => (
                  <div key={item.key}>
                    <p className="text-xs font-medium text-secondary">{dict.customerVerify[item.label]}</p>
                    <div className="mt-1.5 grid grid-cols-5 gap-1.5">
                      {[1, 2, 3, 4, 5].map((value) => (
                        <ChoiceButton key={value} compact active={ratings[item.key] === value} onClick={() => setRating(item.key, value)}>
                          {value}
                        </ChoiceButton>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </fieldset>

            <fieldset className="mt-7">
              <legend className="text-sm font-semibold text-navy">{dict.customerVerify.extraChargeLegend}</legend>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <ChoiceButton active={extraCharge === false} onClick={() => setExtraCharge(false)}>{dict.common.no}</ChoiceButton>
                <ChoiceButton active={extraCharge === true} onClick={() => setExtraCharge(true)}>{dict.common.yes}</ChoiceButton>
              </div>
            </fieldset>

            <label className="mt-7 flex items-start gap-3 text-sm font-medium text-navy">
              <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} className="mt-0.5" />
              {dict.customerVerify.consentRelease}
            </label>

            {error ? <p role="alert" className="mt-4 rounded-[9px] bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}

            <button type="button" onClick={() => void submit()} disabled={pending} className={buttonStyles({ className: "mt-6 w-full" })}>
              <ShieldQuestion className="size-4" />
              {pending ? dict.customerVerify.submitting : dict.customerVerify.submit}
            </button>
          </Card>
        </div>
      </Container>
    </>
  );
}

function ChoiceButton({
  active,
  onClick,
  compact = false,
  children,
}: {
  active: boolean;
  onClick: () => void;
  compact?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        compact ? "min-h-11 text-sm" : "min-h-12 text-sm",
        "rounded-[9px] border px-3 font-semibold transition-colors duration-200",
        active
          ? "border-primary bg-blue-50 text-primary-strong"
          : "border-line bg-white text-secondary hover:border-slate-300 hover:bg-slate-50",
      )}
    >
      {children}
    </button>
  );
}