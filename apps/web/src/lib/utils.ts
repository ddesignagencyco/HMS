import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Text } from "@/lib/types";

export const locales = ["en", "ur"] as const;
export type Locale = (typeof locales)[number];

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function isLocale(value: string): value is Locale {
  return locales.includes(value as Locale);
}

export function getText(value: Text, locale: Locale) {
  return value[locale];
}

export function localizedPath(locale: Locale, path = "") {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `/${locale}${normalized === "/" ? "" : normalized}`;
}

export function localeTag(locale: Locale) {
  return locale === "ur" ? "ur-PK" : "en-PK";
}

export function formatNumber(value: number, locale: Locale) {
  return new Intl.NumberFormat(localeTag(locale)).format(value);
}

/**
 * Paisa → "Rs 1,912.50". Whole-rupee amounts stay "Rs 1,000"; anything with
 * paisa shows both decimals. It used to round to whole rupees, which printed
 * held Rs 1,912.50 as "Rs 1,913" — a money screen must never show a figure the
 * ledger doesn't hold.
 */
export function formatMoney(paisa: number, locale: Locale) {
  const whole = paisa % 100 === 0;
  const rupees = new Intl.NumberFormat(localeTag(locale), { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 }).format(paisa / 100);
  return `Rs ${rupees}`;
}

export function formatDate(value: string | null | undefined, locale: Locale) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(localeTag(locale), {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function formatDateTime(value: string | null | undefined, locale: Locale) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(localeTag(locale), {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Karachi",
  }).format(date);
}

export function formatDuration(minutes: number, locale: Locale) {
  if (minutes < 60) {
    return `${formatNumber(minutes, locale)} min`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${formatNumber(hours, locale)} h` : `${formatNumber(hours, locale)} h ${formatNumber(rest, locale)} min`;
}
