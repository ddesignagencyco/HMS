"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { ArrowLeft, MailCheck } from "lucide-react";
import type { Dictionary } from "@/lib/dictionaries";
import { localizedPath, type Locale } from "@/lib/utils";
import { authApi } from "./api";
import { forgotPasswordSchema, loginIdentifier } from "./schemas";
import { Field, SubmitButton } from "./auth-fields";
import { AUTH_SECONDARY_IMAGE, AuthShell, Notice } from "./auth-shell";
import { applyServerFieldErrors, authErrorMessage, toastError, toastSuccess } from "./auth-feedback";
import { describeTarget } from "./target";

/* Password recovery. POST /auth/password/forgot answers { sent: true } whether
   or not an account matched, so this screen never says which — the same words
   either way, and the same screen afterwards. */

type IdentifierValues = z.infer<typeof forgotPasswordSchema>;

export function ForgotForm({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [resending, setResending] = useState(false);

  const form = useForm<IdentifierValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { identifier: "" },
    mode: "onBlur",
  });

  const send = async (identifier: string) => {
    try {
      await authApi.forgotPassword(identifier, { locale });
      setSentTo(identifier);
      toastSuccess(dict.auth.forgotSentTitle);
    } catch (error) {
      applyServerFieldErrors(form, error);
      toastError(authErrorMessage(error, dict));
    }
  };

  const onSubmit = form.handleSubmit(
    async (values) => {
      await send(loginIdentifier(values));
    },
    (errors) => {
      const msg = errors.identifier?.message;
      if (msg) toastError(msg);
    },
  );

  const onResend = async () => {
    if (sentTo === null || resending) return;
    setResending(true);
    await send(sentTo);
    setResending(false);
  };

  if (sentTo !== null) {
    return (
      <AuthShell
        locale={locale}
        dict={dict}
        title={dict.auth.forgotSentTitle}
        titleAccent={dict.auth.forgotTitle}
        description={dict.auth.forgotSentText}
        imageSrc={AUTH_SECONDARY_IMAGE}
      >
        <div className="grid gap-4">
          <Notice tone="success" icon={MailCheck}>
            {dict.auth.otpSentTo.replace("{target}", describeTarget(sentTo))}
          </Notice>

          <Link
            href={`${localizedPath(locale, "/auth/reset-password")}?identifier=${encodeURIComponent(sentTo)}`}
            className="text-sm font-semibold text-primary-strong transition-colors hover:text-primary"
          >
            {dict.auth.forgotContinue}
          </Link>

          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              disabled={resending}
              onClick={onResend}
              className="min-h-11 rounded-[9px] border border-line px-4 text-sm font-semibold text-navy transition-colors hover:bg-slate-50 disabled:opacity-55"
            >
              {dict.auth.forgotResend}
            </button>
            <button
              type="button"
              onClick={() => {
                setSentTo(null);
              }}
              className="min-h-11 rounded-[9px] px-4 text-sm font-semibold text-secondary transition-colors hover:text-navy"
            >
              {dict.auth.forgotChange}
            </button>
          </div>

          <Link
            href={localizedPath(locale, "/auth/sign-in")}
            className="text-center text-sm font-semibold text-secondary transition-colors hover:text-navy"
          >
            {dict.auth.backToSignIn}
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      locale={locale}
      dict={dict}
      title={dict.auth.forgotTitle}
      titleAccent={dict.auth.forgotAccent}
      description={dict.auth.forgotText}
      imageSrc={AUTH_SECONDARY_IMAGE}
      footer={
        <Link
          href={localizedPath(locale, "/auth/sign-in")}
          className="inline-flex items-center justify-center gap-1.5 font-semibold text-primary-strong hover:text-primary"
        >
          <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden="true" />
          {dict.auth.backToSignIn}
        </Link>
      }
    >
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        <Field
          {...form.register("identifier")}
          label={dict.auth.identifier}
          error={form.formState.errors.identifier?.message}
          placeholder={dict.auth.placeholderIdentifier}
          type="text"
          inputMode="text"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          dir="ltr"
          className="[&_input]:text-start"
        />
        <SubmitButton pending={form.formState.isSubmitting} pendingLabel={dict.auth.sendOtpBusy} className="mt-1">
          {dict.auth.sendResetLink}
        </SubmitButton>
      </form>
    </AuthShell>
  );
}