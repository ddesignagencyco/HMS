"use client";

import React, { useId } from "react";
import PhoneInput from "react-phone-input-2";
import "react-phone-input-2/lib/style.css";
import { Label } from "@/components/ui";
import { cn, type Locale } from "@/lib/utils";
import { AlertCircle } from "lucide-react";

// Normalize between ESM and CJS bundle exports across Next.js and testing tools
const PhoneInputComponent = (
  (PhoneInput as unknown as { default?: React.ComponentType<any> }).default || PhoneInput
) as React.ComponentType<any>;

export interface PhoneFieldProps {
  id?: string;
  name?: string;
  label: string;
  hint?: string;
  error?: string;
  className?: string;
  value?: string;
  onChange: (value: string, countryData?: any) => void;
  onBlur?: () => void;
  locale?: Locale;
  disabled?: boolean;
}

export function PhoneField({
  id,
  name = "phoneE164",
  label,
  hint,
  error,
  className,
  value = "",
  onChange,
  onBlur,
  locale = "en",
  disabled = false,
}: PhoneFieldProps) {
  const generated = useId();
  const fieldId = id ?? generated;
  const hintId = hint === undefined ? undefined : `${fieldId}-hint`;
  const errorId = error === undefined ? undefined : `${fieldId}-error`;

  const handleChange = (val: string, countryData: any) => {
    const dialCode =
      countryData && typeof countryData === "object" && "dialCode" in countryData
        ? String((countryData as { dialCode?: string }).dialCode ?? "")
        : "";
    const digits = String(val || "").replace(/\D/g, "");

    // If empty or only the dial code without subscriber digits, treat as empty
    if (!digits || digits === dialCode) {
      onChange("", countryData);
      return;
    }

    // If Pakistani number with accidental leading 0 after dial code 92 (e.g. 9203...)
    let cleanDigits = digits;
    if (dialCode === "92" && cleanDigits.startsWith("920")) {
      cleanDigits = "92" + cleanDigits.slice(3);
    }

    onChange(cleanDigits.startsWith("+") ? cleanDigits : `+${cleanDigits}`, countryData);
  };

  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={fieldId} className="text-[11.5px] font-semibold text-slate-800 mb-1">
        {label}
      </Label>
      <div className="relative" dir="ltr">
        <PhoneInputComponent
          country="pk"
          preferredCountries={["pk", "ae", "sa", "gb", "us"]}
          value={value}
          onChange={handleChange}
          onBlur={onBlur}
          disabled={disabled}
          specialLabel=""
          enableSearch={true}
          searchPlaceholder={locale === "ur" ? "ملک تلاش کریں..." : "Search country..."}
          searchNotFound={locale === "ur" ? "کوئی ملک نہیں ملا" : "No country found"}
          containerClass={cn("hms-phone-input", error && "has-error")}
          inputProps={{
            id: fieldId,
            name,
            required: true,
            autoFocus: false,
            "aria-invalid": error !== undefined ? true : undefined,
            "aria-describedby": [errorId, hintId].filter(Boolean).join(" ") || undefined,
          }}
        />
      </div>
      {error !== undefined ? (
        <p
          id={errorId}
          role="alert"
          className="flex items-center gap-1.5 text-xs font-medium text-rose-600 animate-in fade-in duration-200"
        >
          <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : hint !== undefined ? (
        <p id={hintId} className="text-[11px] leading-4 text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
