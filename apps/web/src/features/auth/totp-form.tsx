"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { Check, Copy, KeyRound, Loader2, ShieldCheck, ShieldOff } from "lucide-react";
import type { Dictionary } from "@/lib/dictionaries";
import type { Locale } from "@/lib/utils";
import { Button } from "@/components/ui";
import { useSession } from "./session";
import { totpCodeSchema } from "./schemas";
import { SubmitButton } from "./auth-fields";
import { TotpQrCode } from "./totp-qr";
import { AUTH_TOTP_IMAGE, AuthShell, Notice } from "./auth-shell";
import { OtpField } from "./otp-field";
import { actorRoles, returnToForRoles, signInPath } from "./routing";
import { applyServerFieldErrors, authErrorMessage, toastError, toastSuccess } from "./auth-feedback";

/* Two-factor for staff.
     · Enrollment — the API answers a login with totpRequired true and hands out
       a token the policy guard refuses on every staff route. POST /auth/totp/setup
       returns the secret exactly once, and /auth/totp/verify turns it on. Only
       then does a refresh produce a token the API accepts, which is why the
       refresh is part of confirming rather than left to the next request.
     · Turning it off — DELETE /auth/totp. Live sessions keep working but the
       next staff sign-in has to enrol again, which is the API's behaviour and
       the copy says so.

   A login challenge is not here: that is `totpCode` on POST /auth/login, asked
   for by the sign-in screen. */

const codeSchema = z.object({ code: totpCodeSchema });

export function TotpForm({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, status, roles, totpPending, beginTotpSetup, confirmTotp, disableTotp } = useSession();
  const returnTo = searchParams.get("returnTo");
  const [secret, setSecret] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [starting, setStarting] = useState(false);
  const [done, setDone] = useState(false);
  const [disabling, setDisabling] = useState(false);
  const [copied, setCopied] = useState(false);
  const manualKey = useRef<HTMLDialogElement>(null);

  const form = useForm<z.infer<typeof codeSchema>>({
    resolver: zodResolver(codeSchema),
    defaultValues: { code: "" },
    mode: "onBlur",
  });

  /* Enrolment is a session-only operation, so a visitor with none is sent to
     sign in rather than shown a setup button whose only answer would be 401.
     `safeReturnTo` drops an /auth/ destination, so this lands on sign-in
     itself and the account's own role home after — never back here in a loop. */
  useEffect(() => {
    if (status === "anonymous") router.replace(signInPath(locale, returnTo));
  }, [locale, returnTo, router, status]);

  /* Nothing to enrol on this account. */
  useEffect(() => {
    if (status === "authenticated" && user !== null && user.totpEnabled && !totpPending && secret === null) {
      router.replace(returnToForRoles(returnTo, actorRoles(user), locale));
    }
  }, [locale, returnTo, router, secret, status, totpPending, user]);

  const start = async () => {
    setStarting(true);
    try {
      setSecret(await beginTotpSetup());
    } catch (error) {
      toastError(authErrorMessage(error, dict));
    } finally {
      setStarting(false);
    }
  };

  /* Copies the setup key for manual entry. The key block stays selectable,
     so an unavailable clipboard still leaves a way in. */
  const copyKey = async () => {
    if (secret === null) return;
    try {
      await navigator.clipboard.writeText(secret.secret);
      setCopied(true);
      toastSuccess(dict.auth.totpKeyCopied);
    } catch {
      setCopied(false);
    }
  };

  const onSubmit = form.handleSubmit(async ({ code }) => {
    try {
      const { verified } = await confirmTotp(code);
      if (!verified) {
        toastError(dict.auth.genericError);
        return;
      }
      setDone(true);
      toastSuccess(dict.auth.totpEnabledTitle);
      router.replace(returnToForRoles(returnTo, actorRoles(user), locale));
    } catch (error) {
      /* The secret stays on screen and the code stays in the boxes: one
         mistyped digit must not restart enrolment, because the secret is only
         ever shown once. */
      applyServerFieldErrors(form, error);
      toastError(authErrorMessage(error, dict));
    }
  });

  const onDisable = async () => {
    setDisabling(true);
    try {
      await disableTotp();
      toastSuccess(dict.auth.totpDisabled);
    } catch (error) {
      toastError(authErrorMessage(error, dict));
    } finally {
      setDisabling(false);
    }
  };

  /* Held for loading and for the frame in which a visitor with no session is
     being redirected — an enrolment card either way would be a dead end. */
  if (status !== "authenticated") {
    return (
      <AuthShell locale={locale} dict={dict} title={dict.auth.totpTitle} description={dict.auth.totpIntro} imageSrc={AUTH_TOTP_IMAGE}>
        <div className="grid gap-3" aria-busy="true" aria-live="polite">
          <span className="skeleton h-11 w-full rounded-[9px]" />
          <span className="skeleton h-11 w-2/3 rounded-[9px]" />
        </div>
      </AuthShell>
    );
  }

  /* ---- turning it off, from a signed-in account that has it on ---- */
  if (user !== null && user.totpEnabled && !totpPending) {
    return (
      <AuthShell
        locale={locale}
        dict={dict}
        title={dict.auth.totpEnabledTitle}
        titleAccent={dict.auth.totpAccent}
        description={dict.auth.totpEnabledText}
        imageSrc={AUTH_TOTP_IMAGE}
        footer={
          <Link href={returnToForRoles(returnTo, roles, locale)} className="font-semibold text-primary-strong hover:text-primary">
            {dict.auth.goToAccount}
          </Link>
        }
      >
        <div className="grid gap-4">
          <Notice tone="success" icon={ShieldCheck}>
            {dict.auth.totpEnabledText}
          </Notice>
          <Button type="button" variant="secondary" disabled={disabling} onClick={onDisable} className="w-full">
            <ShieldOff className="size-4" aria-hidden="true" />
            {dict.auth.totpDisable}
          </Button>
        </div>
      </AuthShell>
    );
  }

  /* ---- enrolment ---- */
  return (
    <AuthShell
      locale={locale}
      dict={dict}
      title={dict.auth.totpSetupTitle}
      titleAccent={dict.auth.totpAccent}
      description={dict.auth.totpSetupText}
      imageSrc={AUTH_TOTP_IMAGE}
      footer={
        <Link href={signInPath(locale, returnTo)} className="font-semibold text-primary-strong hover:text-primary">
          {dict.auth.backToSignIn}
        </Link>
      }
    >
      {secret === null ? (
        <div className="grid gap-4">
          <Notice tone="info">{dict.auth.totpPendingText}</Notice>
          <Button type="button" disabled={starting} onClick={start} className="w-full">
            {starting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <KeyRound className="size-4" aria-hidden="true" />}
            {dict.auth.totpSetupTitle}
          </Button>
        </div>
      ) : (
        /* Stacked, this card measured 927px inside the 607px frame every other
           auth card fits, and the confirm button fell off the bottom of the
           page. So from lg the two steps sit side by side - QR on the left,
           everything to type on the right - which is also the order they are
           done in. Below lg it is one column, because a QR beside six code
           boxes is more than a phone screen is wide.

           The QR track is a fixed 212px rather than a fraction so the code
           never gets wider and squeezes the QR below what an authenticator app
           reads comfortably; the code boxes take what is left. 212 is also what
           keeps the whole card inside the 607px frame the other auth cards fill
           exactly. The card description already says what `totpStepOneText`
           said, and in a 200px column that sentence alone was four lines and
           96px of the budget. The numbered headers carry the steps. */
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <div className="grid gap-4 lg:grid-cols-[212px_minmax(0,1fr)] lg:items-start lg:gap-4">
            <div className="grid gap-3">
              <p className="flex items-center gap-2 text-sm font-semibold text-navy">
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary text-[11px] font-bold text-white" aria-hidden="true">
                  1
                </span>
                {dict.auth.totpStepOne}
              </p>
              <TotpQrCode uri={secret.otpauthUri} label={dict.auth.totpQrAlt} />
            </div>

            <div className="grid gap-3">
              <p className="flex items-center gap-2 text-sm font-semibold text-navy">
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary text-[11px] font-bold text-white" aria-hidden="true">
                  2
                </span>
                {dict.auth.totpStepTwo}
              </p>
              <Controller
                control={form.control}
                name="code"
                render={({ field }) => (
                  <OtpField
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    label={dict.auth.totpCode}
                    error={form.formState.errors.code?.message}
                  />
                )}
              />
              {/* A disclosure that expanded in place made the card taller than
                  the fixed auth frame, which clipped the footer off the page,
                  and squeezed a 32-character key into a column too narrow to
                  read. This button opens a dialog instead - see below - so the
                  card is the same height whichever way it is answered. */}
              <button
                type="button"
                onClick={() => manualKey.current?.showModal()}
                className="justify-self-start text-[13px] font-semibold text-primary-strong underline-offset-4 hover:underline"
              >
                {dict.auth.totpManualTitle}
              </button>
              <SubmitButton pending={form.formState.isSubmitting} pendingLabel={dict.auth.verifyBusy} className="mt-1">
                {dict.auth.totpConfirm}
              </SubmitButton>
            </div>
          </div>

          {done ? <Notice tone="success">{dict.auth.totpEnabledText}</Notice> : null}
        </form>
      )}

      {/* Outside the two-column row above, so nothing here can resize the card: a
          closed <dialog> is display:none and an open one is promoted to the top
          layer, out of the document flow. */}
      <dialog
        ref={manualKey}
        aria-labelledby="totp-manual-key-title"
        onClose={() => setCopied(false)}
        className="m-auto w-[min(30rem,calc(100vw-2rem))] rounded-[14px] border border-line bg-white p-0 text-start text-navy shadow-lifted backdrop:bg-navy/50"
      >
        <div className="grid gap-4 p-5">
          <div>
            <h2 id="totp-manual-key-title" className="text-[15px] font-bold text-navy">
              {dict.auth.totpSecretLabel}
            </h2>
            <p className="mt-1 text-[13px] leading-6 text-secondary">{dict.auth.totpSecretHint}</p>
          </div>
          {/* Full width here, and selectable: an unavailable clipboard still
              leaves a way in. */}
          <p
            dir="ltr"
            className="select-all break-all rounded-[9px] border border-line bg-surface-2 p-3 font-mono text-sm tracking-[0.12em] text-navy"
          >
            {secret?.secret}
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" onClick={() => manualKey.current?.close()}>
              {dict.common.cancel}
            </Button>
            <Button type="button" onClick={() => void copyKey()}>
              {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
              {dict.auth.totpCopyKey}
            </Button>
          </div>
        </div>
      </dialog>
    </AuthShell>
  );
}