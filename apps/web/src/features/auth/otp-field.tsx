"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/* Six boxes that behave like one field: typing advances, backspace retreats, a
   pasted code fills every box, arrow keys move. The form holds the code as a
   single string, so what is submitted is one value and one error — not six
   partial names. */

const LENGTH = 6;

export function OtpField({
  value,
  onChange,
  onBlur,
  label,
  length = LENGTH,
  autoFocus = true,
  error,
}: {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  label: string;
  length?: number;
  autoFocus?: boolean;
  error?: string;
}) {
  const inputs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = Array.from({ length }, (_, index) => value[index] ?? "");

  useEffect(() => {
    if (autoFocus) inputs.current[0]?.focus();
  }, [autoFocus]);

  const write = (next: string) => {
    onChange(next);
    onBlur?.();
  };

  const setAt = (index: number, char: string) => {
    write(Array.from({ length }, (_, position) => (position === index ? char : digits[position])).join(""));
  };

  return (
    <div className="grid gap-2">
      <span className="text-sm font-medium text-navy">{label}</span>
      <div dir="ltr" role="group" aria-label={label} className="flex justify-between gap-2">
        {digits.map((digit, index) => (
          <input
            key={index}
            ref={(element) => {
              inputs.current[index] = element;
            }}
            value={digit}
            onChange={(event) => {
              const char = event.target.value.replace(/\D/g, "").slice(-1);
              if (char === "") return setAt(index, "");
              setAt(index, char);
              inputs.current[index + 1]?.focus();
            }}
            onKeyDown={(event) => {
              if (event.key === "Backspace") {
                event.preventDefault();
                if (digits[index] !== "") return setAt(index, "");
                if (index > 0) {
                  setAt(index - 1, "");
                  inputs.current[index - 1]?.focus();
                }
              }
              if (event.key === "ArrowLeft" && index > 0) inputs.current[index - 1]?.focus();
              if (event.key === "ArrowRight" && index < length - 1) inputs.current[index + 1]?.focus();
            }}
            onPaste={(event) => {
              event.preventDefault();
              const pasted = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
              if (pasted === "") return;
              write(Array.from({ length }, (_, position) => pasted[position] ?? "").join(""));
              inputs.current[Math.min(pasted.length, length - 1)]?.focus();
            }}
            inputMode="numeric"
            autoComplete={index === 0 ? "one-time-code" : "off"}
            maxLength={1}
            aria-label={`${label} ${index + 1}`}
            aria-invalid={error === undefined ? undefined : true}
            className={cn(
              "h-12 w-full min-w-0 rounded-[9px] border bg-white text-center text-lg font-semibold text-navy transition focus-visible:outline-none focus-visible:ring-4",
              error === undefined
                ? "border-line focus-visible:border-primary focus-visible:ring-blue-100"
                : "border-rose-300 focus-visible:border-rose-400 focus-visible:ring-rose-100",
            )}
          />
        ))}
      </div>
      {error !== undefined ? (
        <p role="alert" className="text-xs font-medium text-rose-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export const otpIsComplete = (value: string, length = LENGTH): boolean => value.replace(/\D/g, "").length >= length;