import type { Locale } from "@/lib/utils";

/* A code is sent to a phone number or an email address, and the copy has to say
   which without printing the whole thing back. */

export const maskPhone = (target: string): string => {
  if (target.startsWith("+")) {
    const tail = target.slice(-3);
    return `${target.slice(0, Math.min(5, target.length - 3))}•••${tail}`;
  }
  const digits = target.replace(/\D/g, "");
  if (digits.length < 5) return target;
  return `${target.slice(0, 4)} ••••• ${digits.slice(-3)}`;
};

export const maskEmail = (target: string): string => {
  const at = target.indexOf("@");
  if (at < 2) return target;
  return `${target.slice(0, 2)}•••${target.slice(at)}`;
};

export const describeTarget = (target: string): string => (target.includes("@") ? maskEmail(target) : maskPhone(target));

/** Local time, not a locale-formatted date: the server's expiry is absolute. */
export const formatExpiry = (isoDate: string, locale: Locale): string =>
  new Intl.DateTimeFormat(locale === "ur" ? "ur-PK" : "en-PK", { hour: "numeric", minute: "2-digit" }).format(new Date(isoDate));