"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import {
  ArrowRight,
  Lock,
  Mail,
  Phone,
  User,
  UserRound,
  Wrench,
} from "lucide-react";
import { ApiError } from "@/lib/api/problem";
import type { Dictionary } from "@/lib/dictionaries";
import { cn, localizedPath, type Locale } from "@/lib/utils";
import { authApi } from "./api";
import { toE164, registerSchema, type RegisterValues } from "./schemas";
import { Field, PasswordField, SubmitButton } from "./auth-fields";
import { AUTH_SECONDARY_IMAGE, AuthShell } from "./auth-shell";
import { applyServerFieldErrors, authErrorMessage, toastError, toastSuccess } from "./auth-feedback";
import { PasswordPopover } from "./password-popover";
import { SocialButtons } from "./social-buttons";

/* Registration posts details and redirects to OTP verification. */

export function RegisterForm({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = searchParams.get("returnTo");
  const [passwordFocused, setPasswordFocused] = useState(false);

  const form = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      role: "CUSTOMER",
      firstName: "",
      lastName: "",
      phoneE164: "",
      email: "",
      password: "",
      confirmPassword: "",
      acceptTerms: false,
    },
    mode: "onBlur",
  });

  const passwordValue = form.watch("password");

  const onSubmit = form.handleSubmit(
    async (values) => {
      const phoneE164 = toE164(values.phoneE164);
      if (phoneE164 === null) {
        form.setError("phoneE164", { type: "validate", message: dict.auth.invalidPhone });
        toastError(dict.auth.invalidPhone);
        return;
      }

      try {
        await authApi.register(
          {
            role: values.role,
            firstName: values.firstName.trim(),
            ...(values.lastName === undefined || values.lastName.trim() === "" ? {} : { lastName: values.lastName.trim() }),
            phoneE164,
            ...(values.email === undefined || values.email.trim() === "" ? {} : { email: values.email.trim() }),
            password: values.password,
            locale,
          },
          { locale },
        );
      } catch (error) {
        if (error instanceof ApiError && error.code === "CONFLICT") {
          const detail = error.problem.detail;
          const onEmail = detail.toLowerCase().includes("email");
          form.setError(onEmail ? "email" : "phoneE164", { type: "server", message: detail });
          toastError(detail);
          return;
        }
        applyServerFieldErrors(form, error);
        toastError(authErrorMessage(error, dict));
        return;
      }

      toastSuccess(dict.auth.otpSent.replace("{target}", phoneE164.replace(/^\+92/, "0")));
      const finalReturn = returnTo || (values.role === "PROVIDER" ? localizedPath(locale, "/provider") : localizedPath(locale, "/account"));
      router.push(
        `${localizedPath(locale, "/auth/verify")}?purpose=REGISTER&target=${encodeURIComponent(phoneE164)}&returnTo=${encodeURIComponent(finalReturn)}`,
      );
    },
    (errors) => {
      const firstKey = Object.keys(errors)[0] as keyof RegisterValues;
      const firstMsg = errors[firstKey]?.message;
      if (firstMsg) toastError(firstMsg);
    },
  );

  const role = form.watch("role");

  return (
    <AuthShell
      locale={locale}
      dict={dict}
      title={locale === "ur" ? "نیا اکاؤنٹ بنائیں" : "Create your account"}
      description={
        locale === "ur"
          ? "اسمارٹ ہوم مینٹیننس کا حصہ بنیں اور آج ہی شروعات کریں۔"
          : "Join Smart Home Maintenance and get started today."
      }
      imageSrc={AUTH_SECONDARY_IMAGE}
      imagePlacement="right"
      visualVariant="signup"
      showLogo={true}
    >
      <form onSubmit={onSubmit} className="grid gap-2 sm:gap-2.5" noValidate>
        {/* Role Selection Matching Reference Design */}
        <div className="grid gap-2 sm:grid-cols-2">
          {(["CUSTOMER", "PROVIDER"] as const).map((value) => {
            const inputId = `role-${value.toLowerCase()}`;
            const Icon = value === "CUSTOMER" ? User : Wrench;
            const selected = role === value;
            return (
              <label
                key={value}
                htmlFor={inputId}
                className={cn(
                  "flex min-h-[42px] cursor-pointer items-center gap-2 rounded-[9px] border px-3 py-1.5 transition-all outline-none",
                  selected
                    ? "border-blue-600 bg-blue-50/70 text-blue-900 shadow-2xs"
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50/60",
                )}
              >
                <input
                  id={inputId}
                  name="role"
                  type="radio"
                  value={value}
                  checked={selected}
                  onChange={() => form.setValue("role", value, { shouldValidate: true })}
                  className="sr-only"
                />
                <Icon
                  className={cn("size-4 shrink-0", selected ? "text-blue-600" : "text-slate-400")}
                  aria-hidden="true"
                />
                <div className="text-start leading-tight">
                  <span className="block text-[12px] font-bold">
                    {value === "CUSTOMER"
                      ? locale === "ur"
                        ? "میں گھریلو صارف ہوں"
                        : "I'm a homeowner"
                      : locale === "ur"
                        ? "میں سروس ماہر ہوں"
                        : "I'm a service professional"}
                  </span>
                  <span className="block text-[10px] text-slate-400">
                    {value === "CUSTOMER" ? "(Customer)" : "(Provider)"}
                  </span>
                </div>
              </label>
            );
          })}
        </div>

        {/* First & Last Name */}
        <div className="grid items-start gap-2 sm:grid-cols-2">
          <Field
            {...form.register("firstName")}
            label={locale === "ur" ? "پہلا نام" : "First name"}
            error={form.formState.errors.firstName?.message}
            placeholder="John"
            autoComplete="given-name"
            dir="auto"
            className="[&_input]:text-start"
            startIcon={<UserRound className="size-3.5" aria-hidden="true" />}
          />
          <Field
            {...form.register("lastName")}
            label={locale === "ur" ? "آخری نام" : "Last name"}
            error={form.formState.errors.lastName?.message}
            placeholder="Doe"
            autoComplete="family-name"
            dir="auto"
            className="[&_input]:text-start"
            startIcon={<UserRound className="size-3.5" aria-hidden="true" />}
          />
        </div>

        {/* Phone & Email */}
        <div className="grid items-start gap-2 sm:grid-cols-2">
          <Field
            {...form.register("phoneE164")}
            label={locale === "ur" ? "فون نمبر" : "Phone number"}
            error={form.formState.errors.phoneE164?.message}
            placeholder={locale === "ur" ? "0300 1234567" : "(555) 123-4567"}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            dir="ltr"
            className="[&_input]:text-start"
            startIcon={<Phone className="size-3.5" aria-hidden="true" />}
          />

          <Field
            {...form.register("email")}
            label={locale === "ur" ? "ای میل (اختیاری)" : "Email address (optional)"}
            error={form.formState.errors.email?.message}
            placeholder="john.doe@email.com"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            dir="ltr"
            className="[&_input]:text-start"
            startIcon={<Mail className="size-3.5" aria-hidden="true" />}
          />
        </div>

        {/* Password & Confirm Password with live Popover Validator */}
        <div className="grid items-start gap-2 sm:grid-cols-2">
          <div className="relative">
            <PasswordField
              {...form.register("password", {
                onBlur: () => setPasswordFocused(false),
              })}
              onFocus={() => setPasswordFocused(true)}
              label={dict.auth.password}
              error={form.formState.errors.password?.message}
              placeholder={locale === "ur" ? "پاس ورڈ درج کریں" : "Create a password"}
              autoComplete="new-password"
              showLabel={dict.auth.showPassword}
              hideLabel={dict.auth.hidePassword}
              startIcon={<Lock className="size-3.5" aria-hidden="true" />}
            />
            <PasswordPopover
              password={passwordValue}
              visible={passwordFocused}
              locale={locale}
            />
          </div>

          <PasswordField
            {...form.register("confirmPassword")}
            label={dict.auth.confirmPassword}
            error={form.formState.errors.confirmPassword?.message}
            placeholder={locale === "ur" ? "پاس ورڈ کی تصدیق کریں" : "Confirm your password"}
            autoComplete="new-password"
            showLabel={dict.auth.showPassword}
            hideLabel={dict.auth.hidePassword}
            startIcon={<Lock className="size-3.5" aria-hidden="true" />}
          />
        </div>

        {/* Terms and Privacy Checkbox */}
        <div className="grid gap-1 pt-0.5">
          <label className="flex items-start gap-2 text-[11px] leading-snug text-slate-600 cursor-pointer">
            <input
              type="checkbox"
              checked={form.watch("acceptTerms")}
              onChange={(event) => form.setValue("acceptTerms", event.target.checked, { shouldValidate: true })}
              aria-invalid={form.formState.errors.acceptTerms ? true : undefined}
              aria-describedby={form.formState.errors.acceptTerms ? "acceptTerms-error" : undefined}
              className="mt-0.5 size-3.5 rounded accent-[#2563eb] outline-none"
            />
            <span>
              {dict.auth.termsAgree}{" "}
              <Link href={localizedPath(locale, "/terms")} className="font-semibold text-blue-600 hover:text-blue-700 underline-offset-2 hover:underline">
                {dict.auth.termsService}
              </Link>{" "}
              {dict.auth.termsAnd}{" "}
              <Link href={localizedPath(locale, "/privacy")} className="font-semibold text-blue-600 hover:text-blue-700 underline-offset-2 hover:underline">
                {dict.auth.termsPrivacy}
              </Link>
              .
            </span>
          </label>
          {form.formState.errors.acceptTerms ? (
            <p id="acceptTerms-error" role="alert" className="text-xs font-medium text-rose-600">
              {form.formState.errors.acceptTerms.message}
            </p>
          ) : null}
        </div>

        <SubmitButton pending={form.formState.isSubmitting} pendingLabel={dict.auth.registerBusy} className="mt-0.5 min-h-[38px] py-1.5 text-[13.5px]">
          {locale === "ur" ? "نیا اکاؤنٹ بنائیں" : "Create account"}
          <ArrowRight className="size-4 rtl:rotate-180" aria-hidden="true" />
        </SubmitButton>

        <SocialButtons dict={dict} className="mt-0" />

        {/* Small mobile-only switch link (on desktop the button is already on the visual image) */}
        <p className="mt-1 text-center text-xs text-slate-500 lg:hidden">
          {locale === "ur" ? "پہلے سے اکاؤنٹ ہے؟" : "Already have an account?"}{" "}
          <Link href={localizedPath(locale, "/auth/sign-in")} className="font-semibold text-blue-600 hover:underline">
            {locale === "ur" ? "سائن ان کریں" : "Sign in"}
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}