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

export function formatMoney(paisa: number, locale: Locale) {
  return `Rs ${formatNumber(Math.round(paisa / 100), locale)}`;
}

export function formatDate(value: string, locale: Locale) {
  return new Intl.DateTimeFormat(localeTag(locale), {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

export function formatDateTime(value: string, locale: Locale) {
  return new Intl.DateTimeFormat(localeTag(locale), {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Karachi",
  }).format(new Date(value));
}

export function formatDuration(minutes: number, locale: Locale) {
  if (minutes < 60) {
    return `${formatNumber(minutes, locale)} min`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${formatNumber(hours, locale)} h` : `${formatNumber(hours, locale)} h ${formatNumber(rest, locale)} min`;
}
