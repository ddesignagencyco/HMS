import { localizedPath, type Locale } from "@/lib/utils";
import { isActorRole, type ActorRole, type AuthUser } from "./api";

/* The portal areas the web app owns, and the one role that lands in each.
   Roles come from the API's own /auth/me response (users.role_code), never from
   anything the browser decides. */

export const ROLE_HOME: Record<ActorRole, string> = {
  CUSTOMER: "/account",
  PROVIDER: "/provider",
  AGENT: "/agent",
  FINANCE: "/finance/escrow",
  ADMIN: "/admin",
};

const ROLE_AREA: Record<ActorRole, string> = {
  CUSTOMER: "account",
  PROVIDER: "provider",
  AGENT: "agent",
  FINANCE: "finance",
  ADMIN: "admin",
};

/** Priority when one account holds several roles: the most privileged first, so
    a person who is both a customer and an admin lands in administration. */
const ROLE_PRIORITY: ActorRole[] = ["ADMIN", "FINANCE", "AGENT", "PROVIDER", "CUSTOMER"];

export const actorRoles = (user: AuthUser | null | undefined): ActorRole[] =>
  (user?.roles ?? []).filter(isActorRole);

export const primaryRole = (roles: readonly ActorRole[]): ActorRole | null =>
  ROLE_PRIORITY.find((role) => roles.includes(role)) ?? null;

export const homePathForRoles = (roles: readonly ActorRole[], locale: Locale): string => {
  const role = primaryRole(roles);
  return role === null ? localizedPath(locale) : localizedPath(locale, ROLE_HOME[role]);
};

/**
 * Only a path inside this app, under this locale, is ever used as a destination.
 *
 * Anything else — an absolute URL, a protocol-relative `//host`, a backslash a
 * browser may normalise to a slash, a path under another locale — falls back to
 * the sign-in page, so a crafted ?returnTo= cannot bounce somebody off-site.
 */
export const safeReturnTo = (value: string | null | undefined, locale: Locale): string | null => {
  if (typeof value !== "string" || value === "") return null;
  if (!value.startsWith("/")) return null;
  if (value.startsWith("//") || value.startsWith("/\\")) return null;
  if (value.includes("\\")) return null;
  if (/[\u0000-\u001f]/.test(value)) return null;
  const prefix = `/${locale}`;
  if (value !== prefix && !value.startsWith(`${prefix}/`)) return null;
  /* The auth pages themselves would bounce a still-signed-in visitor in a loop. */
  if (value.startsWith(`${prefix}/auth/`)) return null;
  return value;
};

/** The area a path belongs to, if it is one of the portal areas. */
export const areaOfPath = (pathname: string): string | null => {
  const segments = pathname.split("/").filter(Boolean);
  return segments[1] ?? null;
};

const PORTAL_AREAS = new Set(Object.values(ROLE_AREA));

/** Whether the given roles allow access to the specified path area.
 *  Non-portal paths are always permitted. For portal areas, at least one of
 *  the user's roles must own that area. */
export const isPermittedForPath = (
  pathname: string,
  roles: readonly ActorRole[],
): boolean => {
  const area = areaOfPath(pathname);
  if (area === null || !PORTAL_AREAS.has(area)) return true;
  return ROLE_PRIORITY.some((role) => roles.includes(role) && ROLE_AREA[role] === area);
};

/**
 * A return destination is only honoured when the account is allowed to be there.
 * The API enforces this too; checking it here only stops the redirect from
 * bouncing a customer into administration before the API says no. A public page
 * is not gated at all — only the portal areas belong to a role.
 */
export const returnToForRoles = (
  value: string | null | undefined,
  roles: readonly ActorRole[],
  locale: Locale,
): string => {
  const safe = safeReturnTo(value, locale);
  if (safe !== null) {
    if (isPermittedForPath(safe, roles)) return safe;
  }
  return homePathForRoles(roles, locale);
};

/** Sign-in URL carrying a safe destination, for use from a link or a redirect. */
export const signInPath = (locale: Locale, returnTo?: string | null): string => {
  const target = safeReturnTo(returnTo, locale);
  const base = localizedPath(locale, "/auth/sign-in");
  return target === null ? base : `${base}?returnTo=${encodeURIComponent(target)}`;
};