"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { Check, Copy, KeyRound, Loader2, ShieldCheck, ShieldOff } from "lucide-react";
import type { Dictionary } from "@/lib/dictionaries";
import type { Locale } from "@/lib/utils";
import { Button } from "@/components/ui";
import { Card, PageHeader } from "@/components/ui";
import { useSession } from "./session";
import { totpCodeSchema } from "./schemas";
import { SubmitButton } from "./auth-fields";
import { TotpQrCode } from "./totp-qr";
import { Notice } from "./auth-shell";
import { OtpField } from "./otp-field";
import { applyServerFieldErrors, authErrorMessage, toastError, toastSuccess } from "./auth-feedback";

/* Authenticated account security. Reuses the portal layout (WorkspaceShell +
   RequireSession) — no auth-card image panel here. Implements only what the
   backend supports: TOTP setup, verification and removal via
   POST /auth/totp/setup, POST /auth/totp/verify and DELETE /auth/totp.
   No password-change endpoint, no active-session management: the API
   publishes neither, so the UI promises neither. The QR code is rendered
   from the backend's own otpauthUri — never a mock. */

const codeSchema = z.object({ code: totpCodeSchema });

export function AccountSecurityView({ dict }: { locale: Locale; dict: Dictionary }) {
  const { user, status, totpPending, beginTotpSetup, confirmTotp, disableTotp } = useSession();
  const [secret, setSecret] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [starting, setStarting] = useState(false);
  const [disabling, setDisabling] = useState(false);
  const [copied, setCopied] = useState(false);

  const form = useForm<z.infer<typeof codeSchema>>({
    resolver: zodResolver(codeSchema),
    defaultValues: { code: "" },
    mode: "onBlur",
  });

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
      setSecret(null);
      form.reset({ code: "" });
      toastSuccess(dict.auth.totpEnabledTitle);
    } catch (error) {
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

  if (status === "loading") {
    return (
      <div aria-busy="true" aria-live="polite" className="grid gap-4">
        <span className="skeleton h-9 w-64 rounded-[9px]" />
        <span className="skeleton h-4 w-full max-w-md rounded-[9px]" />
        <span className="skeleton h-48 w-full rounded-[14px]" />
      </div>
    );
  }

  const enabled = user !== null && user.totpEnabled && !totpPending;

  return (
    <div>
      <PageHeader
        eyebrow={dict.portal.customer}
        title={dict.auth.accountSecurityTitle}
        description={dict.auth.accountSecurityText}
      />
      <Card className="mt-6 p-5 sm:p-6">
        <h2 className="text-base font-semibold text-navy">{dict.auth.securityTwoFactorTitle}</h2>
        <p className="mt-1.5 text-sm leading-6 text-secondary">{dict.auth.securityTwoFactorText}</p>

        {enabled ? (
          <div className="mt-4 grid gap-4">
            <Notice tone="success" icon={ShieldCheck}>
              {dict.auth.totpEnabledText}
            </Notice>
            <Button type="button" variant="secondary" disabled={disabling} onClick={onDisable} className="w-full sm:w-auto">
              <ShieldOff className="size-4" aria-hidden="true" />
              {dict.auth.totpDisable}
            </Button>
          </div>
        ) : secret === null ? (
          <div className="mt-4 grid gap-4">
            <Notice tone="info">{dict.auth.totpSetupText}</Notice>
            <Button type="button" disabled={starting} onClick={start} className="w-full sm:w-auto">
              {starting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <KeyRound className="size-4" aria-hidden="true" />}
              {dict.auth.totpSetupTitle}
            </Button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="mt-4 grid gap-4" noValidate>
            <div className="grid gap-3">
              <p className="flex items-center gap-2 text-sm font-semibold text-navy">
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary text-[11px] font-bold text-white" aria-hidden="true">
                  1
                </span>
                {dict.auth.totpStepOne}
              </p>
              <TotpQrCode uri={secret.otpauthUri} label={dict.auth.totpQrAlt} />
              <p className="text-[13px] leading-6 text-secondary">{dict.auth.totpStepOneText}</p>
              <details className="rounded-[9px] border border-line bg-surface-2 p-3">
                <summary className="cursor-pointer text-[13px] font-semibold text-secondary">{dict.auth.totpManualTitle}</summary>
                <p className="mt-2 text-[13px] leading-6 text-secondary">{dict.auth.totpManualText}</p>
                <div className="mt-2 flex items-stretch gap-2">
                  <p
                    dir="ltr"
                    className="min-w-0 flex-1 select-all break-all rounded-[9px] border border-line bg-white p-3 text-start font-mono text-sm tracking-[0.12em] text-navy"
                  >
                    {secret.secret}
                  </p>
                  <button
                    type="button"
                    onClick={copyKey}
                    className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-[8px] border border-line bg-white px-3 py-2 text-[13px] font-semibold text-navy transition-colors duration-200 hover:bg-slate-50"
                  >
                    {copied ? <Check className="size-4 text-emerald-600" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
                    {dict.auth.totpCopyKey}
                  </button>
                </div>
              </details>
            </div>

            <div className="grid gap-3 border-t border-line pt-4">
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
            </div>

            <SubmitButton pending={form.formState.isSubmitting} pendingLabel={dict.auth.verifyBusy} className="mt-1 sm:w-auto">
              {dict.auth.totpConfirm}
            </SubmitButton>
          </form>
        )}
      </Card>
    </div>
  );
}
