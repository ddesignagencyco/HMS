"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { ArrowLeft } from "lucide-react";
import { ApiError } from "@/lib/api/problem";
import type { Dictionary } from "@/lib/dictionaries";
import { localizedPath, type Locale } from "@/lib/utils";
import { useSession } from "./session";
import { forgotIdentifier, normaliseTarget, resetPasswordRequest, resetPasswordSchema, type ResetPasswordValues } from "./schemas";
import { OtpField, otpIsComplete } from "./otp-field";
import { PasswordField, SubmitButton } from "./auth-fields";
import { AUTH_SECONDARY_IMAGE, AuthShell } from "./auth-shell";
import { applyServerFieldErrors, authErrorMessage, toastError, toastSuccess } from "./auth-feedback";
import { describeTarget } from "./target";
import { PasswordPopover } from "./password-popover";
import { actorRoles, returnToForRoles } from "./routing";

/* The API resets a password in one request: the code and the new password
   together, then it revokes every other session and signs this one in. So the
   code never appears in a URL, and an expired, wrong or already-used code is
   reported on this screen rather than as a broken page. */

export function ResetPasswordForm({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { resetPasswordSession } = useSession();
  const returnTo = searchParams.get("returnTo");
  const identifier = forgotIdentifier({ identifier: searchParams.get("identifier") ?? "" });
  const [locked, setLocked] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);

  const form = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { code: "", newPassword: "", confirmPassword: "" },
    mode: "onBlur",
  });

  const onSubmit = form.handleSubmit(
    async (values) => {
      if (!otpIsComplete(values.code)) {
        form.setError("code", { type: "validate", message: dict.auth.otpRequired });
        toastError(dict.auth.otpRequired);
        return;
      }
      try {
        const result = await resetPasswordSession(resetPasswordRequest(identifier, values));
        toastSuccess(dict.auth.signedInAs.replace("{name}", result.user.firstName));
        router.replace(returnToForRoles(returnTo, actorRoles(result.user), locale));
      } catch (error) {
        if (error instanceof ApiError && error.code === "OTP_LOCKED") setLocked(true);
        applyServerFieldErrors(form, error);
        toastError(authErrorMessage(error, dict));
      }
    },
    (errors) => {
      const firstKey = Object.keys(errors)[0] as keyof ResetPasswordValues;
      const firstMsg = errors[firstKey]?.message;
      if (firstMsg) toastError(firstMsg);
    },
  );

  /* Without the account the code was requested for there is nothing to reset.
     This is also the shape a tampered or hand-edited link produces. */
  if (identifier === "" || normaliseTarget(identifier).length < 3) {
    return (
      <AuthShell locale={locale} dict={dict} title={dict.auth.resetTitle} description={dict.auth.forgotSentText} imageSrc={AUTH_SECONDARY_IMAGE}>
        <div className="grid gap-4">
          <Link
            href={localizedPath(locale, "/auth/forgot")}
            className="text-sm font-semibold text-primary-strong transition-colors hover:text-primary"
          >
            {dict.auth.sendResetLink}
          </Link>
          <Link
            href={localizedPath(locale, "/auth/sign-in")}
            className="text-sm font-semibold text-secondary transition-colors hover:text-navy"
          >
            {dict.auth.backToSignIn}
          </Link>
        </div>
      </AuthShell>
    );
  }

  const newPasswordValue = form.watch("newPassword") ?? "";

  return (
    <AuthShell
      locale={locale}
      dict={dict}
      title={dict.auth.resetTitle}
      titleAccent={dict.auth.resetAccent}
      description={dict.auth.newPasswordText}
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
        <p className="text-sm leading-6 text-secondary">{dict.auth.otpSentTo.replace("{target}", describeTarget(identifier))}</p>

        <Controller
          control={form.control}
          name="code"
          render={({ field }) => (
            <OtpField
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              label={dict.auth.otp}
              error={form.formState.errors.code?.message}
            />
          )}
        />

        <div className="relative">
          <PasswordField
            {...form.register("newPassword", {
              onBlur: () => setPasswordFocused(false),
            })}
            onFocus={() => setPasswordFocused(true)}
            label={dict.auth.passwordNew}
            error={form.formState.errors.newPassword?.message}
            placeholder={dict.auth.placeholderNewPassword}
            autoComplete="new-password"
            showLabel={dict.auth.showPassword}
            hideLabel={dict.auth.hidePassword}
          />
          <PasswordPopover
            password={newPasswordValue}
            visible={passwordFocused}
            locale={locale}
          />
        </div>

        <PasswordField
          {...form.register("confirmPassword")}
          label={dict.auth.confirmPassword}
          error={form.formState.errors.confirmPassword?.message}
          placeholder={dict.auth.placeholderNewPassword}
          autoComplete="new-password"
          showLabel={dict.auth.showPassword}
          hideLabel={dict.auth.hidePassword}
        />

        <SubmitButton pending={form.formState.isSubmitting} pendingLabel={dict.auth.resetPasswordBusy} className="mt-1">
          {dict.auth.resetPassword}
        </SubmitButton>

        {locked ? <p className="text-xs leading-5 text-muted">{dict.auth.otpLocked}</p> : null}
      </form>
    </AuthShell>
  );
}