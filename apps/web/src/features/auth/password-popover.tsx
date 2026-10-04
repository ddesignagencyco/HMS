"use client";

import { Check, Circle } from "lucide-react";
import { cn, type Locale } from "@/lib/utils";

interface PasswordPopoverProps {
  password?: string;
  visible: boolean;
  locale?: Locale;
  className?: string;
}

export function PasswordPopover({ password = "", visible, locale = "en", className }: PasswordPopoverProps) {
  if (!visible) return null;

  const isUrdu = locale === "ur";

  const checks = [
    {
      label: isUrdu ? "کم از کم 10 حروف" : "At least 10 characters",
      met: password.length >= 10,
    },
    {
      label: isUrdu ? "ایک بڑا حرف (A-Z)" : "One uppercase letter (A-Z)",
      met: /[A-Z]/.test(password),
    },
    {
      label: isUrdu ? "ایک چھوٹا حرف (a-z)" : "One lowercase letter (a-z)",
      met: /[a-z]/.test(password),
    },
    {
      label: isUrdu ? "ایک نمبر (0-9)" : "One number (0-9)",
      met: /\d/.test(password),
    },
  ];

  const metCount = checks.filter((c) => c.met).length;
  const allMet = metCount === checks.length;

  return (
    <div
      role="tooltip"
      aria-live="polite"
      className={cn(
        "absolute z-50 start-0 top-[calc(100%+6px)] w-full sm:w-[260px] rounded-[10px] border border-slate-200/90 bg-white p-3 shadow-xl backdrop-blur-xs text-xs animate-in fade-in zoom-in-95 duration-150",
        className,
      )}
    >
      <div className="flex items-center justify-between text-[11px] font-bold text-slate-800 mb-1.5">
        <span>{isUrdu ? "پاس ورڈ کی شرائط:" : "Password requirements:"}</span>
        <span
          className={cn(
            "text-[10.5px] font-semibold px-1.5 py-0.2 rounded-full",
            allMet ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600",
          )}
        >
          {metCount}/4
        </span>
      </div>

      {/* Mini Progress Bar */}
      <div className="h-1 w-full bg-slate-100 rounded-full overflow-hidden mb-2">
        <div
          className={cn(
            "h-full transition-all duration-200 rounded-full",
            metCount <= 1 ? "bg-rose-500" : metCount <= 3 ? "bg-amber-500" : "bg-emerald-500",
          )}
          style={{ width: `${(metCount / 4) * 100}%` }}
        />
      </div>

      <div className="grid gap-1">
        {checks.map((check) => (
          <div
            key={check.label}
            className={cn(
              "flex items-center gap-2 text-[11px] transition-colors leading-tight",
              check.met ? "text-emerald-700 font-medium" : "text-slate-500",
            )}
          >
            {check.met ? (
              <Check className="size-3 text-emerald-600 shrink-0 stroke-[3]" aria-hidden="true" />
            ) : (
              <Circle className="size-1.5 text-slate-300 fill-slate-300 shrink-0 mx-0.5" aria-hidden="true" />
            )}
            <span>{check.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
