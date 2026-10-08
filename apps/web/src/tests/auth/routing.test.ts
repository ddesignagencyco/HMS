import { describe, expect, it } from "vitest";
import { homePathForRoles, isPermittedForPath, returnToForRoles, safeReturnTo, signInPath } from "@/features/auth/routing";
import type { ActorRole } from "@/features/auth/api";

/* A return destination arrives from the URL, so it is untrusted input. These
   tests pin the refusals: an off-site destination must never be honoured, and a
   destination the account has no role for must fall back to its own area. The
   API authorises every route regardless — this only stops the redirect from
   bouncing somebody somewhere they cannot be. */

describe("safeReturnTo", () => {
  it("accepts a path inside this app under the current locale", () => {
    expect(safeReturnTo("/en/account/bookings", "en")).toBe("/en/account/bookings");
    expect(safeReturnTo("/en", "en")).toBe("/en");
    expect(safeReturnTo("/ur/admin/reports", "ur")).toBe("/ur/admin/reports");
  });

  it("refuses anything that leaves the app or the locale", () => {
    expect(safeReturnTo("https://evil.example/steal", "en")).toBeNull();
    expect(safeReturnTo("//evil.example/steal", "en")).toBeNull();
    expect(safeReturnTo("/\\evil.example", "en")).toBeNull();
    expect(safeReturnTo("/en/\\evil", "en")).toBeNull();
    expect(safeReturnTo("account", "en")).toBeNull();
    expect(safeReturnTo("", "en")).toBeNull();
    expect(safeReturnTo(null, "en")).toBeNull();
    expect(safeReturnTo("/en\nSet-Cookie: x", "en")).toBeNull();
  });

  it("refuses a path under the other locale, which would fight the router", () => {
    expect(safeReturnTo("/ur/account", "en")).toBeNull();
  });

  it("refuses the authentication pages themselves, which would loop", () => {
    expect(safeReturnTo("/en/auth/sign-in", "en")).toBeNull();
    expect(safeReturnTo("/en/auth/verify", "en")).toBeNull();
  });
});

describe("homePathForRoles", () => {
  it("sends each role to the area the API's roles say it owns", () => {
    expect(homePathForRoles(["CUSTOMER"], "en")).toBe("/en/account");
    expect(homePathForRoles(["PROVIDER"], "en")).toBe("/en/provider");
    expect(homePathForRoles(["AGENT"], "en")).toBe("/en/agent");
    expect(homePathForRoles(["FINANCE"], "en")).toBe("/en/finance/escrow");
    expect(homePathForRoles(["ADMIN"], "en")).toBe("/en/admin");
    expect(homePathForRoles(["ADMIN"], "ur")).toBe("/ur/admin");
  });

  it("picks the most privileged role when an account holds several", () => {
    expect(homePathForRoles(["CUSTOMER", "ADMIN"], "en")).toBe("/en/admin");
    expect(homePathForRoles(["CUSTOMER", "PROVIDER"], "en")).toBe("/en/provider");
    expect(homePathForRoles(["PROVIDER", "FINANCE"], "en")).toBe("/en/finance/escrow");
  });

  it("falls back to the public home for no roles at all", () => {
    expect(homePathForRoles([], "en")).toBe("/en");
  });
});

describe("returnToForRoles", () => {
  it("honours a destination the account's own role owns", () => {
    expect(returnToForRoles("/en/account/bookings", ["CUSTOMER"], "en")).toBe("/en/account/bookings");
    expect(returnToForRoles("/en/provider/today", ["PROVIDER", "CUSTOMER"], "en")).toBe("/en/provider/today");
  });

  it("refuses a destination belonging to another role and uses that role's area", () => {
    expect(returnToForRoles("/en/admin/settings", ["CUSTOMER"], "en")).toBe("/en/account");
    expect(returnToForRoles("/en/admin/reports", ["FINANCE"], "en")).toBe("/en/finance/escrow");
    expect(returnToForRoles("/en/provider/jobs/abc", ["AGENT"], "en")).toBe("/en/agent");
  });

  it("refuses an off-site destination even when the role would be allowed", () => {
    expect(returnToForRoles("https://evil.example", ["ADMIN"], "en")).toBe("/en/admin");
    expect(returnToForRoles("//evil.example", ["ADMIN"], "en")).toBe("/en/admin");
  });

  it("allows a public page for any signed-in account", () => {
    expect(returnToForRoles("/en/services", ["CUSTOMER"], "en")).toBe("/en/services");
  });
});

describe("signInPath", () => {
  it("carries a safe destination and drops an unsafe one", () => {
    expect(signInPath("en", "/en/admin/reports")).toBe("/en/auth/sign-in?returnTo=%2Fen%2Fadmin%2Freports");
    expect(signInPath("en", "https://evil.example")).toBe("/en/auth/sign-in");
    expect(signInPath("ur")).toBe("/ur/auth/sign-in");
  });
});

describe("isPermittedForPath", () => {
  it("allows access to public pages for any role", () => {
    expect(isPermittedForPath("/en/services", ["CUSTOMER"])).toBe(true);
    expect(isPermittedForPath("/en/book/leak-repair", ["CUSTOMER"])).toBe(true);
    expect(isPermittedForPath("/en", ["PROVIDER"])).toBe(true);
  });

  it("permits access when the account role matches the portal area", () => {
    expect(isPermittedForPath("/en/account/bookings", ["CUSTOMER"])).toBe(true);
    expect(isPermittedForPath("/en/provider/today", ["PROVIDER"])).toBe(true);
    expect(isPermittedForPath("/en/agent", ["AGENT"])).toBe(true);
    expect(isPermittedForPath("/en/finance/escrow", ["FINANCE"])).toBe(true);
    expect(isPermittedForPath("/en/admin/reports", ["ADMIN"])).toBe(true);
  });

  it("denies access when the account lacks the required role for that portal area", () => {
    expect(isPermittedForPath("/en/admin", ["CUSTOMER"])).toBe(false);
    expect(isPermittedForPath("/en/provider", ["CUSTOMER"])).toBe(false);
    expect(isPermittedForPath("/en/finance", ["PROVIDER"])).toBe(false);
    expect(isPermittedForPath("/en/agent", ["CUSTOMER"])).toBe(false);
  });
});

describe("role typing", () => {
  it("treats only the five roles the API issues as areas", () => {
    const roles: ActorRole[] = ["CUSTOMER", "PROVIDER", "AGENT", "FINANCE", "ADMIN"];
    for (const role of roles) expect(homePathForRoles([role], "en")).toContain(`/${role.toLowerCase() === "customer" ? "account" : role.toLowerCase()}`);
  });
});