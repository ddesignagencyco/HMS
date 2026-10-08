"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { ArrowRight, Lock, Mail } from "lucide-react";
import { z } from "zod";
import { ApiError } from "@/lib/api/problem";
import type { Dictionary } from "@/lib/dictionaries";
import { localizedPath, type Locale } from "@/lib/utils";
import { useSession } from "./session";
import { loginIdentifier, loginSchema, totpCodeSchema, type LoginValues } from "./schemas";
import { Field, PasswordField, SubmitButton } from "./auth-fields";
import { AUTH_HERO_IMAGE, AuthShell } from "./auth-shell";
import { OtpField } from "./otp-field";
import { actorRoles, returnToForRoles, totpPath } from "./routing";
import { applyServerFieldErrors, authErrorMessage, toastError, toastSuccess } from "./auth-feedback";
import { describeTarget } from "./target";
import { SocialButtons } from "./social-buttons";

const challengeSchema = z.object({ code: totpCodeSchema });
type Challenge = { identifier: string; password: string } | null;

export function SignInForm({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { signIn, status, user, totpPending } = useSession();
  const [challenge, setChallenge] = useState<Challenge>(null);
  const [enrollingTotp, setEnrollingTotp] = useState(false);

  const returnTo = searchParams.get("returnTo");

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { identifier: "", password: "" },
    mode: "onBlur",
  });

  const challengeForm = useForm<z.infer<typeof challengeSchema>>({
    resolver: zodResolver(challengeSchema),
    defaultValues: { code: "" },
    mode: "onBlur",
  });

  /* A staff session that has not finished its two-factor check goes back to the
     route that finishes it. Sending it to the role home instead is what put an
     administrator on an empty dashboard after pressing "Back to sign in" without
     ever entering a code. */
  useEffect(() => {
    if (status !== "authenticated" || user === null || challenge !== null) return;
    if (totpPending || enrollingTotp) router.replace(totpPath(locale, returnTo));
    else router.replace(returnToForRoles(returnTo, actorRoles(user), locale));
  }, [challenge, enrollingTotp, locale, returnTo, router, status, totpPending, user]);

  /* A staff account that has to turn two-factor on is sent to the one route that
     can do it. Sign-in used to draw the enrolment card here as well and link across
     to it, which meant the same two-factor screen appeared twice in a row — once to
     be left, once to be arrived at. A handover state is all that belongs here. */
  useEffect(() => {
    if (!enrollingTotp) return;
    router.replace(totpPath(locale, returnTo));
  }, [enrollingTotp, locale, returnTo, router]);

  const onSubmit = form.handleSubmit(
    async (values) => {
      const identifier = loginIdentifier(values);
      try {
        const result = await signIn({ identifier, password: values.password });
        if (result.totpRequired) {
          setEnrollingTotp(true);
          return;
        }
        toastSuccess(locale === "ur" ? "خوش آمدید! آپ سائن ان ہو چکے ہیں" : "Welcome back! Signed in successfully");
        router.replace(returnToForRoles(returnTo, actorRoles(result.user), locale));
      } catch (error) {
        if (error instanceof ApiError && error.code === "TOTP_REQUIRED") {
          setChallenge({ identifier, password: values.password });
          challengeForm.reset({ code: "" });
          return;
        }
        applyServerFieldErrors(form, error);
        toastError(authErrorMessage(error, dict));
      }
    },
    (errors) => {
      const firstKey = Object.keys(errors)[0] as keyof LoginValues;
      const firstMsg = errors[firstKey]?.message;
      if (firstMsg) toastError(firstMsg);
    },
  );

  const onChallengeSubmit = challengeForm.handleSubmit(
    async ({ code }) => {
      if (challenge === null) return;
      try {
        const result = await signIn({ identifier: challenge.identifier, password: challenge.password, totpCode: code });
        if (result.totpRequired) {
          setEnrollingTotp(true);
          return;
        }
        toastSuccess(locale === "ur" ? "کامیابی سے تصدیق ہو گئی" : "Verification successful!");
        router.replace(returnToForRoles(returnTo, actorRoles(result.user), locale));
      } catch (error) {
        challengeForm.setValue("code", code);
        applyServerFieldErrors(challengeForm, error);
        toastError(authErrorMessage(error, dict));
      }
    },
    (errors) => {
      const firstMsg = errors.code?.message;
      if (firstMsg) toastError(firstMsg);
    },
  );

  /* Handing over to the two-factor route. A title and a spinner, nothing more: the
     card that explains the step lives on `/auth/totp`, and this must not grow into
     a second copy of it. */
  if (enrollingTotp) {
    return (
      <AuthShell
        locale={locale}
        dict={dict}
        title={dict.auth.totpPendingTitle}
        titleAccent={dict.auth.totpAccent}
        description={dict.auth.totpPendingText}
        imageSrc={AUTH_HERO_IMAGE}
        imagePlacement="right"
      >
        <div className="grid gap-4" aria-busy="true" aria-live="polite">
          <span className="skeleton h-11 w-full rounded-[9px]" />
          <span className="skeleton h-11 w-2/3 rounded-[9px]" />
        </div>
      </AuthShell>
    );
  }

  if (challenge !== null) {
    return (
      <AuthShell
        locale={locale}
        dict={dict}
        title={dict.auth.totpTitle}
        titleAccent={dict.auth.totpAccent}
        description={dict.auth.totpIntro}
        step={{ current: 2, total: 2 }}
        imageSrc={AUTH_HERO_IMAGE}
        imagePlacement="right"
        footer={
          <button
            type="button"
            onClick={() => {
              setChallenge(null);
            }}
            className="font-semibold text-primary-strong hover:text-primary"
          >
            {dict.auth.backToSignIn}
          </button>
        }
      >
        <form onSubmit={onChallengeSubmit} className="grid gap-4" noValidate>
          <p className="text-sm leading-6 text-secondary">
            {dict.auth.otpSentTo.replace("{target}", describeTarget(challenge.identifier))}
          </p>
          <Controller
            control={challengeForm.control}
            name="code"
            render={({ field }) => (
              <OtpField value={field.value} onChange={field.onChange} onBlur={field.onBlur} label={dict.auth.totpCode} />
            )}
          />
          <SubmitButton pending={challengeForm.formState.isSubmitting} pendingLabel={dict.auth.signInBusy}>
            {dict.auth.signIn}
          </SubmitButton>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      locale={locale}
      dict={dict}
      title={locale === "ur" ? "خوش آمدید" : "Welcome back"}
      description={
        locale === "ur"
          ? "اپنی بکنگز اور سروس ہسٹری دیکھنے کے لیے سائن ان کریں۔"
          : "Sign in to your account to manage your bookings, view service history and more."
      }
      imageSrc={AUTH_HERO_IMAGE}
      imagePlacement="right"
    >
      <form onSubmit={onSubmit} className="grid gap-3.5" noValidate>
        <Field
          {...form.register("identifier")}
          label={locale === "ur" ? "فون یا ای میل" : "Phone or email"}
          error={form.formState.errors.identifier?.message}
          placeholder={locale === "ur" ? "فون نمبر یا ای میل درج کریں" : "Enter your phone number or email"}
          type="text"
          inputMode="text"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          dir="ltr"
          className="[&_input]:text-start"
          startIcon={<Mail className="size-4" aria-hidden="true" />}
        />
        <PasswordField
          {...form.register("password")}
          label={dict.auth.password}
          error={form.formState.errors.password?.message}
          placeholder={locale === "ur" ? "پاس ورڈ درج کریں" : "Enter your password"}
          autoComplete="current-password"
          showLabel={dict.auth.showPassword}
          hideLabel={dict.auth.hidePassword}
          startIcon={<Lock className="size-4" aria-hidden="true" />}
        />
        <div className="flex justify-end">
          <Link
            href={localizedPath(locale, "/auth/forgot")}
            className="text-xs font-semibold text-blue-600 transition-colors hover:text-blue-700 hover:underline"
          >
            {dict.auth.forgot}
          </Link>
        </div>

        <SubmitButton pending={form.formState.isSubmitting} pendingLabel={dict.auth.signInBusy} className="mt-1">
          {dict.auth.signIn}
          <ArrowRight className="size-4 rtl:rotate-180" aria-hidden="true" />
        </SubmitButton>

        <SocialButtons dict={dict} />

        {/* Small mobile-only switch link (on desktop the action is already on the visual image panel) */}
        <p className="mt-1.5 text-center text-xs text-slate-500 lg:hidden">
          {locale === "ur" ? "اکاؤنٹ نہیں ہے؟" : "Don't have an account?"}{" "}
          <Link href={localizedPath(locale, "/auth/register")} className="font-semibold text-blue-600 hover:underline">
            {locale === "ur" ? "نیا اکاؤنٹ بنائیں" : "Create account"}
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}