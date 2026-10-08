"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { ArrowRight, Phone } from "lucide-react";
import { z } from "zod";
import { ApiError } from "@/lib/api/problem";
import type { Dictionary } from "@/lib/dictionaries";
import { localizedPath, type Locale } from "@/lib/utils";
import { Button } from "@/components/ui";
import { authApi, type OtpPurpose, type OtpRequestResult } from "./api";
import { useSession } from "./session";
import { DEFAULT_OTP_RESEND_SECONDS, identifierOnlySchema, loginIdentifier, otpCodeSchema } from "./schemas";
import { Field, SubmitButton } from "./auth-fields";
import { AuthShell } from "./auth-shell";
import { OtpField, otpIsComplete } from "./otp-field";
import { actorRoles, returnToForRoles } from "./routing";
import { applyServerFieldErrors, authErrorMessage, toastError, toastSuccess } from "./auth-feedback";
import { describeTarget, formatExpiry } from "./target";

/* Code entry for the two purposes that redeem a code into a session: REGISTER
   (finishing an account) and LOGIN (signing in without a password). The expiry
   and the resend cooldown come from POST /auth/otp/request; the client never
   invents them. */

const codeSchema = z.object({ code: otpCodeSchema });

export function VerifyOtpPage({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { verifyOtpSession } = useSession();
  const returnTo = searchParams.get("returnTo");
  const purpose: OtpPurpose = searchParams.get("purpose") === "LOGIN" ? "LOGIN" : "REGISTER";
  const target = searchParams.get("target");

  /* A REGISTER link knows the number it belongs to; a LOGIN visit starts from
     the identifier, because asking for a code needs an account first. */
  const arrivedByLink = purpose === "REGISTER" && target !== null;
  const [identifier, setIdentifier] = useState(target ?? "");
  const [issued, setIssued] = useState<OtpRequestResult | null>(null);
  /* The code for a REGISTER link was sent by POST /auth/register, whose response
     carries no timing, so the cooldown starts from the server's documented
     default and is replaced by the real value as soon as a resend answers. */
  const [secondsLeft, setSecondsLeft] = useState(() => (arrivedByLink ? DEFAULT_OTP_RESEND_SECONDS : 0));
  const [locked, setLocked] = useState(false);
  const [requesting, setRequesting] = useState(false);

  const identifierForm = useForm<z.infer<typeof identifierOnlySchema>>({
    resolver: zodResolver(identifierOnlySchema),
    defaultValues: { identifier: target ?? "" },
    mode: "onBlur",
  });

  const codeForm = useForm<z.infer<typeof codeSchema>>({
    resolver: zodResolver(codeSchema),
    defaultValues: { code: "" },
    mode: "onBlur",
  });

  async function requestCode(rawTarget: string) {
    setRequesting(true);
    try {
      const result = await authApi.requestOtp(rawTarget, purpose, { locale });
      setIssued(result);
      setSecondsLeft(result.resendAfterSeconds);
      setLocked(false);
      toastSuccess(dict.auth.otpSent.replace("{target}", describeTarget(rawTarget)));
    } catch (error) {
      toastError(authErrorMessage(error, dict));
    } finally {
      setRequesting(false);
    }
  }

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = window.setInterval(() => setSecondsLeft((current) => Math.max(0, current - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [secondsLeft]);

  const onRequestSubmit = identifierForm.handleSubmit(
    async (values) => {
      const normalised = loginIdentifier(values);
      setIdentifier(normalised);
      await requestCode(normalised);
    },
    (errors) => {
      const msg = errors.identifier?.message;
      if (msg) toastError(msg);
    },
  );

  const onCodeSubmit = codeForm.handleSubmit(
    async ({ code }) => {
      if (!otpIsComplete(code)) {
        codeForm.setError("code", { type: "validate", message: dict.auth.otpRequired });
        toastError(dict.auth.otpRequired);
        return;
      }
      try {
        const result = await verifyOtpSession({ target: identifier, purpose, code });
        if (result.totpRequired) {
          router.replace(localizedPath(locale, "/auth/totp"));
          return;
        }
        toastSuccess(dict.auth.signedInAs.replace("{name}", result.user.firstName));
        router.replace(returnToForRoles(returnTo, actorRoles(result.user), locale));
      } catch (error) {
        if (error instanceof ApiError && error.code === "OTP_LOCKED") setLocked(true);
        applyServerFieldErrors(codeForm, error);
        toastError(authErrorMessage(error, dict));
      }
    },
    (errors) => {
      const msg = errors.code?.message;
      if (msg) toastError(msg);
    },
  );

  const onResend = async () => {
    if (secondsLeft > 0 || identifier === "") return;
    await requestCode(identifier);
    codeForm.setValue("code", "");
    codeForm.clearErrors();
  };

  const reset = () => {
    setIssued(null);
    setIdentifier(target ?? "");
    setSecondsLeft(0);
    setLocked(false);
    identifierForm.reset({ identifier: target ?? "" });
    codeForm.reset({ code: "" });
  };

  /* ---- no code requested yet: ask who it is for ---- */
  if (!arrivedByLink && issued === null) {
    return (
      <AuthShell
        locale={locale}
        dict={dict}
        title={dict.auth.verifyTitle}
        titleAccent={dict.auth.verifyAccent}
        description={dict.auth.signInWithCode}
        footer={
          <Link href={localizedPath(locale, "/auth/sign-in")} className="font-semibold text-primary-strong hover:text-primary">
            {dict.auth.backToSignIn}
          </Link>
        }
      >
        <form onSubmit={onRequestSubmit} className="grid gap-4" noValidate>
          <Field
            {...identifierForm.register("identifier")}
            label={dict.auth.identifier}
            error={identifierForm.formState.errors.identifier?.message}
            placeholder={dict.auth.placeholderIdentifier}
            type="text"
            inputMode="text"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            dir="ltr"
            className="[&_input]:text-start"
          />
          <SubmitButton pending={requesting} pendingLabel={dict.auth.sendOtpBusy} className="mt-1">
            {dict.auth.sendOtp}
          </SubmitButton>
        </form>
      </AuthShell>
    );
  }

  /* ---- code entry ---- */
  const resendLabel =
    secondsLeft > 0
      ? dict.auth.resendIn
          .replace("{seconds}", `${String(Math.floor(secondsLeft / 60)).padStart(2, "0")}:${String(secondsLeft % 60).padStart(2, "0")}`)
      : dict.auth.resend;
  return (
    <AuthShell
      locale={locale}
      dict={dict}
      title={dict.auth.verifyTitle}
      titleAccent={dict.auth.verifyAccent}
      description={dict.auth.verifyText}
      footer={
        <>
          {dict.auth.needDifferentNumber}{" "}
          <button type="button" onClick={reset} className="font-semibold text-primary-strong hover:text-primary">
            {dict.auth.changeNumber}
          </button>
        </>
      }
    >
      <form onSubmit={onCodeSubmit} className="grid gap-4" noValidate>
        <p dir="ltr" className="inline-flex w-fit items-center gap-2 rounded-[9px] bg-slate-100 px-3.5 py-2 text-[15px] font-semibold text-navy">
          <Phone className="size-4 text-primary" aria-hidden="true" />
          {describeTarget(identifier)}
        </p>
        <Controller
          control={codeForm.control}
          name="code"
          render={({ field }) => (
            <OtpField
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              label={dict.auth.otp}
              error={codeForm.formState.errors.code?.message}
            />
          )}
        />

        {issued !== null ? (
          <p className="text-xs text-muted">{dict.auth.otpExpiresAt.replace("{time}", formatExpiry(issued.expiresAt, locale))}</p>
        ) : null}

        <SubmitButton pending={codeForm.formState.isSubmitting} pendingLabel={dict.auth.verifyBusy}>
          {dict.auth.verify}
          <ArrowRight className="size-4 rtl:rotate-180" aria-hidden="true" />
        </SubmitButton>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <Button type="button" variant="quiet" size="sm" disabled={secondsLeft > 0 || requesting} onClick={onResend}>
            {resendLabel}
          </Button>
          <Link
            href={localizedPath(locale, "/auth/sign-in")}
            className="text-sm font-semibold text-secondary transition-colors hover:text-navy"
          >
            {dict.auth.backToSignIn}
          </Link>
        </div>

        {locked ? <p className="text-xs leading-5 text-muted">{dict.auth.otpLocked}</p> : null}
      </form>
    </AuthShell>
  );
}