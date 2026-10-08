"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef } from "react";
import type { LucideIcon } from "lucide-react";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Info,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import type { Dictionary } from "@/lib/dictionaries";
import { heroImage } from "@/lib/data";
import { cn, getText, localizedPath, type Locale } from "@/lib/utils";

export type AuthVisual = { src: string; focus: string };

export const AUTH_HERO_IMAGE: AuthVisual = {
  src: "/images/auth-technician.jpg",
  focus: "50% 30%",
};

export const AUTH_SECONDARY_IMAGE: AuthVisual = {
  src: "/images/auth-technician-ceiling.jpg",
  focus: "50% 30%",
};

export const AUTH_TOTP_IMAGE: AuthVisual = {
  src: "/images/auth-technician.jpg",
  focus: "50% 30%",
};

let authSplitSeen = false;

export function SmartHomeLogo({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-blue-600 text-white shadow-xs">
        <svg viewBox="0 0 24 24" className="size-5" fill="currentColor">
          <path d="M12 3L2 12h3v8h6v-6h2v6h6v-8h3L12 3z" />
        </svg>
      </div>
      <div>
        <span className="block text-[15px] font-extrabold leading-tight tracking-tight text-slate-900">
          Smart Home Maintenance
        </span>
        <span className="block text-[8.5px] font-bold uppercase tracking-widest text-slate-400">
          Cleaner homes. Happier lives.
        </span>
      </div>
    </div>
  );
}

export function AuthShell({
  locale,
  dict,
  title,
  titleAccent,
  description,
  step,
  children,
  footer,
  imageSrc,
  imagePlacement = "right",
  showLogo = true,
  visualVariant = "signin",
}: {
  locale: Locale;
  dict: Dictionary;
  title: string;
  titleAccent?: string;
  description: string;
  step?: { current: number; total: number };
  children: React.ReactNode;
  footer?: React.ReactNode;
  imageSrc?: AuthVisual;
  imagePlacement?: "left" | "right";
  showLogo?: boolean;
  visualVariant?: "signin" | "signup";
}) {
  return (
    <SplitCard
      locale={locale}
      dict={dict}
      title={title}
      titleAccent={titleAccent}
      description={description}
      step={step}
      footer={footer}
      imageSrc={imageSrc ?? AUTH_HERO_IMAGE}
      imagePlacement={imagePlacement}
      showLogo={showLogo}
      visualVariant={visualVariant}
    >
      {children}
    </SplitCard>
  );
}

function SplitCard({
  locale,
  dict,
  title,
  titleAccent,
  description,
  step,
  footer,
  imageSrc,
  imagePlacement = "right",
  showLogo,
  visualVariant = "signin",
  children,
}: {
  locale: Locale;
  dict: Dictionary;
  title: string;
  titleAccent?: string;
  description: string;
  step?: { current: number; total: number };
  footer?: React.ReactNode;
  imageSrc: AuthVisual;
  imagePlacement?: "left" | "right";
  showLogo?: boolean;
  visualVariant?: "signin" | "signup";
  children: React.ReactNode;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (authSplitSeen) headingRef.current?.focus({ preventScroll: true });
    authSplitSeen = true;
  }, []);

  const isLeftImage = imagePlacement === "left";
  const isSignup = visualVariant === "signup";

  return (
    <div className="relative mx-auto flex w-full max-w-[1040px] flex-col justify-center">
      {/* Main Split Card - Responsive on mobile, fixed consistent 605px height on desktop */}
      <div
        className={cn(
          "relative grid rounded-[16px] sm:rounded-[20px] border border-slate-200/90 bg-white shadow-[0_20px_60px_-15px_rgba(15,23,42,0.1)] lg:grid-cols-2 lg:overflow-hidden",
          "lg:min-h-[605px]",
        )}
      >
        {/* Form Column - Left side on desktop, natural flowing height on mobile */}
        <div
          className={cn(
            "flex flex-col justify-center auth-anim-form",
            isLeftImage ? "order-2 lg:order-2" : "order-2 lg:order-1",
            isSignup
              ? "px-5 py-6 sm:px-8 sm:py-6 lg:px-9 lg:py-5"
              : "px-5 py-7 sm:px-8 sm:py-8 lg:px-9.5 lg:py-7",
          )}
        >
          <div>
            {showLogo ? <SmartHomeLogo className={isSignup ? "mb-2" : "mb-3"} /> : null}
            <AuthHeading
              dict={dict}
              title={title}
              titleAccent={titleAccent}
              description={description}
              step={step}
              headingRef={headingRef}
              showTagline={false}
              locale={locale}
              isSignup={isSignup}
            />
            <div className={isSignup ? "mt-2.5" : "mt-3"} data-auth-card>
              {children}
            </div>
          </div>
          {footer ? (
            <div className="mt-2.5 border-t border-slate-100 pt-2 text-center text-xs leading-5 text-secondary">
              {footer}
            </div>
          ) : null}
        </div>

        {/* Visual Column - Right side on desktop with consistent height and low-profile bottom overlay */}
        <div
          className={cn(
            "relative hidden overflow-hidden lg:block",
            isLeftImage ? "order-1 lg:order-1" : "order-1 lg:order-2",
            "min-h-[580px] lg:min-h-[605px]",
          )}
        >
          <VisualImage locale={locale} imageSrc={imageSrc} />
          <VisualContent visualVariant={visualVariant} locale={locale} />
        </div>
      </div>
    </div>
  );
}

function AuthHeading({
  title,
  titleAccent,
  description,
  step,
  headingRef,
  dict,
  isSignup,
}: {
  title: string;
  titleAccent?: string;
  description: string;
  step?: { current: number; total: number };
  headingRef?: React.RefObject<HTMLHeadingElement | null>;
  showTagline?: boolean;
  locale?: Locale;
  dict: Dictionary;
  isSignup?: boolean;
}) {
  return (
    <div>
      <h1
        ref={headingRef}
        tabIndex={-1}
        data-auth-heading
        className={cn(
          "font-bold leading-[1.18] tracking-[-0.025em] text-slate-900",
          isSignup ? "text-[23px] sm:text-[25px]" : "text-[26px] sm:text-[28px]",
        )}
      >
        {title}
      </h1>
      {titleAccent ? <p className="mt-0.5 text-[12.5px] font-semibold text-primary-strong">{titleAccent}</p> : null}
      <p className={cn("text-[12.5px] leading-[1.45] text-slate-500", isSignup ? "mt-0.5" : "mt-1")}>{description}</p>

      {step ? (
        <div className="mt-2.5 flex items-center gap-2" aria-label={dict.auth.stepOf.replace("{current}", String(step.current)).replace("{total}", String(step.total))}>
          <div className="flex flex-1 gap-1" aria-hidden="true">
            {Array.from({ length: step.total }, (_, index) => (
              <span key={index} className={cn("h-1 flex-1 rounded-full transition-colors", index < step.current ? "bg-primary" : "bg-slate-200")} />
            ))}
          </div>
          <p className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
            {dict.auth.stepOf.replace("{current}", String(step.current)).replace("{total}", String(step.total))}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function VisualImage({ locale, imageSrc }: { locale: Locale; imageSrc: AuthVisual }) {
  return (
    <Image
      src={imageSrc.src}
      alt={getText(heroImage.alt, locale)}
      fill
      priority
      sizes="(min-width: 1024px) 50vw, 100vw"
      style={{ objectPosition: imageSrc.focus }}
      className="object-cover"
    />
  );
}

function VisualContent({ visualVariant, locale }: { visualVariant: "signin" | "signup"; locale: Locale }) {
  const isUrdu = locale === "ur";
  const isSignup = visualVariant === "signup";

  return (
    <div className="absolute inset-0 flex flex-col justify-end p-5 xl:p-6 text-white pointer-events-none">
      {/* Minimum bottom wave overlay (covers bottom ~22% only) so the technician's hands, tools, and torso remain 100% visible */}
      <svg
        className="absolute inset-0 size-full pointer-events-none"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="auth-compact-wave" x1="0" y1="0" x2="0.6" y2="1">
            <stop offset="0%" stopColor="#1e3a8a" stopOpacity="0.96" />
            <stop offset="50%" stopColor="#1d4ed8" stopOpacity="0.94" />
            <stop offset="100%" stopColor="#1e40af" stopOpacity="0.98" />
          </linearGradient>
          <linearGradient id="auth-compact-arc" x1="0" y1="0" x2="1" y2="0.5">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#1d4ed8" stopOpacity="0.08" />
          </linearGradient>
        </defs>
        {/* Subtle accent arc */}
        <path d="M 0,100 L 0,73 Q 45,66 100,75 L 100,100 Z" fill="url(#auth-compact-arc)" />
        {/* Main low-profile wave */}
        <path d="M 0,100 L 0,77 Q 42,70 100,78 L 100,100 Z" fill="url(#auth-compact-wave)" />
      </svg>

      {/* Compact bottom content bar */}
      <div className="relative z-10 pointer-events-auto">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 pr-2">
            <h2 className="text-[17px] xl:text-[19px] font-bold leading-tight tracking-[-0.015em] text-white truncate">
              {isSignup
                ? isUrdu
                  ? "پہلے سے رکن ہیں؟"
                  : "Already part of the family?"
                : isUrdu
                  ? "آپ کا گھر، محفوظ ہاتھوں میں"
                  : "Your home, in good hands"}
            </h2>
            <p className="mt-0.5 text-[11px] xl:text-[11.5px] leading-tight text-blue-100/90 truncate">
              {isSignup
                ? isUrdu
                  ? "بکنگز دیکھنے کے لیے سائن ان کریں۔"
                  : "Sign in to access your bookings and manage services."
                : isUrdu
                  ? "قابلِ اعتماد پیشہ ور افراد • 100% گارنٹی شدہ سروس"
                  : "Trusted professionals • 100% guaranteed service"}
            </p>
          </div>

          <Link
            href={localizedPath(locale, isSignup ? "/auth/sign-in" : "/auth/register")}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-[8px] border border-white/90 bg-white/15 px-3 py-1.5 text-[11.5px] font-semibold text-white backdrop-blur-xs transition-colors hover:bg-white hover:text-blue-900"
          >
            <span>
              {isSignup
                ? isUrdu
                  ? "سائن ان کریں"
                  : "Sign in"
                : isUrdu
                  ? "نیا اکاؤنٹ"
                  : "Create account"}
            </span>
            <ArrowRight className="size-3 rtl:rotate-180" aria-hidden="true" />
          </Link>
        </div>

        {/* Micro Trust Indicators in a clean, tight row */}
        <div className="mt-2.5 flex items-center gap-3 border-t border-white/15 pt-2 text-[10px] font-medium text-blue-100/85">
          <span className="inline-flex items-center gap-1">
            <ShieldCheck className="size-3 text-blue-300" aria-hidden="true" />
            {isUrdu ? "تصدیق شدہ کاریگر" : "Verified Experts"}
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3 text-blue-300" aria-hidden="true" />
            {isUrdu ? "فوری رسپانس" : "Quick Dispatch"}
          </span>
          <span className="inline-flex items-center gap-1">
            <Sparkles className="size-3 text-blue-300" aria-hidden="true" />
            {isUrdu ? "100% گارنٹی" : "100% Guaranteed"}
          </span>
        </div>
      </div>
    </div>
  );
}

export function Notice({
  tone,
  icon,
  children,
}: {
  tone: "success" | "error" | "info";
  icon?: LucideIcon;
  children: React.ReactNode;
}) {
  const Fallback = tone === "success" ? CheckCircle2 : tone === "error" ? AlertCircle : Info;
  const Resolved = icon ?? Fallback;
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 rounded-[8px] p-2.5 text-xs leading-4.5",
        tone === "success" && "border border-emerald-200 bg-emerald-50 text-emerald-800",
        tone === "error" && "border border-rose-200 bg-rose-50 text-rose-700",
        tone === "info" && "border border-blue-200 bg-blue-50 text-blue-900",
      )}
    >
      <Resolved className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}
