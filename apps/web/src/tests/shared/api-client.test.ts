import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest, refreshSession, resetRefreshState } from "@/lib/api/client";
import { readAccessToken, resetAccessToken, writeAccessToken } from "@/lib/api/access-token";
import { ApiError } from "@/lib/api/problem";

/* The API rotates the refresh token on every use and signs out every session
   descended from a token that is presented twice (auth.service.ts →
   session.service.ts). A "helpful" client that fires two refreshes at once logs
   the person out, so these tests pin the coordination down rather than the
   shapes. */

const problem = (status: number, code: string, detail = "no") => ({
  type: "https://smart-home.local/problems/x",
  title: "x",
  status,
  code,
  detail,
  errors: [],
});

const json = (status: number, body: unknown) =>
  new Response(body === undefined ? "" : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const session = { user: { id: "u1", roles: ["CUSTOMER"] }, accessToken: "fresh", expiresInSeconds: 900, totpRequired: false };

describe("api client", () => {
  beforeEach(() => {
    resetAccessToken();
    resetRefreshState();
  });

  afterEach(() => {
    resetAccessToken();
    resetRefreshState();
    vi.unstubAllGlobals();
  });

  it("sends the in-memory token and includes credentials so the refresh cookie rides along", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(new Headers(init.headers).get("authorization")).toBe("Bearer held");
      expect(init.credentials).toBe("include");
      return json(200, { ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);
    writeAccessToken("held", 900);

    await expect(apiRequest("/auth/me")).resolves.toEqual({ ok: true });
  });

  it("refreshes once and replays the request once when the access token has expired", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      seen.push(url);
      if (url.endsWith("/auth/refresh")) return json(201, session);
      if (readAccessToken() === "fresh") return json(200, { user: { id: "u1" } });
      return json(401, problem(401, "UNAUTHENTICATED"));
    }));
    writeAccessToken("stale", 900);

    await expect(apiRequest("/auth/me")).resolves.toEqual({ user: { id: "u1" } });
    expect(seen.filter((url) => url.endsWith("/auth/refresh"))).toHaveLength(1);
    expect(seen.filter((url) => url.endsWith("/auth/me"))).toHaveLength(2);
    expect(readAccessToken()).toBe("fresh");
  });

  it("collapses simultaneous 401s onto a single refresh, because two would be a replay", async () => {
    let refreshes = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/auth/refresh")) {
        refreshes += 1;
        return json(201, session);
      }
      if (readAccessToken() === "fresh") return json(200, { url });
      return json(401, problem(401, "UNAUTHENTICATED"));
    }));

    /* No token at all: the reload case, where every in-flight request discovers
       the session is gone at the same moment. */
    resetAccessToken();
    const results = await Promise.all([
      apiRequest("/customer/addresses"),
      apiRequest("/customer/bookings"),
      apiRequest("/admin/settings"),
    ]);

    expect(refreshes).toBe(1);
    expect(results).toEqual([
      { url: "/api/v1/customer/addresses" },
      { url: "/api/v1/customer/bookings" },
      { url: "/api/v1/admin/settings" },
    ]);
  });

  it("reuses a refresh that just finished instead of starting a second one", async () => {
    let refreshes = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/auth/refresh")) {
        refreshes += 1;
        return json(201, session);
      }
      if (readAccessToken() === "fresh") return json(200, { url });
      return json(401, problem(401, "UNAUTHENTICATED"));
    }));

    await refreshSession();
    await refreshSession();
    await apiRequest("/auth/me");

    expect(refreshes).toBe(1);
  });

  it("does not refresh for an authentication submission, where a 401 is the answer", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      seen.push(url);
      return json(401, problem(401, "INVALID_CREDENTIALS", "The phone number, email or password is not correct."));
    }));
    writeAccessToken("held", 900);

    const error = await apiRequest("/auth/login", { method: "POST", body: {}, refreshOnExpiry: false }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(seen.filter((url) => url.endsWith("/auth/refresh"))).toHaveLength(0);
  });

  it("never refreshes against /auth/refresh itself, so a failure cannot recurse", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      calls += 1;
      return json(401, problem(401, "UNAUTHENTICATED"));
    }));
    writeAccessToken("held", 900);

    await expect(apiRequest("/auth/refresh", { method: "POST", refreshOnExpiry: false })).rejects.toBeInstanceOf(ApiError);
    expect(calls).toBe(1);
  });

  it("ends the session and stops after a replayed refresh token instead of looping", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      calls += 1;
      return json(401, problem(401, "REFRESH_REUSE_DETECTED", "That refresh token had already been used."));
    }));
    writeAccessToken("stale", 900);

    await expect(apiRequest("/auth/me")).rejects.toBeInstanceOf(ApiError);
    expect(calls).toBe(2);
    expect(readAccessToken()).toBeNull();
  });

  it("surfaces a 422 as field errors keyed by the API's own paths", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(422, { ...problem(422, "VALIDATION_FAILED"), errors: [{ path: "password", code: "too_small", message: "Password must be at least 10 characters" }] })));
    writeAccessToken("held", 900);

    const error = await apiRequest<never>("/auth/register", { method: "POST", body: {}, refreshOnExpiry: false }).catch(
      (thrown: unknown) => thrown as ApiError,
    );

    expect(error.fieldErrors).toEqual({ password: "Password must be at least 10 characters" });
    expect(error.code).toBe("VALIDATION_FAILED");
  });

  it("stays quiet when a visitor who never had a session finds no cookie", async () => {
    let lost = false;
    const { onSessionLost } = await import("@/lib/api/client");
    const stop = onSessionLost(() => {
      lost = true;
    });
    /* What a first-time visitor on /auth/sign-in does: /auth/me is refused,
       the refresh has no cookie to offer, and that is not an expiry. */
    vi.stubGlobal("fetch", vi.fn(async () => json(401, problem(401, "UNAUTHENTICATED"))));
    resetAccessToken();

    await expect(apiRequest("/auth/me")).rejects.toBeInstanceOf(ApiError);
    expect(lost).toBe(false);
    stop();
  });

  it("announces the loss when a token that did exist could not be replaced", async () => {
    let lost = false;
    const { onSessionLost } = await import("@/lib/api/client");
    const stop = onSessionLost(() => {
      lost = true;
    });
    vi.stubGlobal("fetch", vi.fn(async () => json(401, problem(401, "UNAUTHENTICATED"))));
    writeAccessToken("held", 900);

    await expect(apiRequest("/auth/me")).rejects.toBeInstanceOf(ApiError);
    expect(lost).toBe(true);
    stop();
  });

  it("keeps a cancelled request out of the session-lost path", async () => {
    let lost = false;
    const { onSessionLost } = await import("@/lib/api/client");
    const stop = onSessionLost(() => {
      lost = true;
    });
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new DOMException("aborted", "AbortError");
    }));
    writeAccessToken("held", 900);

    await expect(apiRequest("/auth/me")).rejects.toThrow();
    expect(lost).toBe(false);
    stop();
  });

  it("asks for a refresh once per document after one is refused, not once per 401", async () => {
    /* A signed-out visitor hits /auth/me on every page. Each 401 is a normal
       answer, and each one used to cost a second round trip to /auth/refresh
       that could not succeed either. */
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      seen.push(url);
      return json(401, problem(401, "UNAUTHENTICATED"));
    }));
    resetAccessToken();

    await expect(apiRequest("/auth/me")).rejects.toBeInstanceOf(ApiError);
    await expect(apiRequest("/auth/me")).rejects.toBeInstanceOf(ApiError);
    await expect(apiRequest("/auth/me")).rejects.toBeInstanceOf(ApiError);

    expect(seen.filter((url) => url.endsWith("/auth/refresh"))).toHaveLength(1);
    expect(seen.filter((url) => url.endsWith("/auth/me"))).toHaveLength(3);
  });

  it("tries a refresh again once a real session has been established", async () => {
    let refreshes = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/auth/refresh")) {
        refreshes += 1;
        return refreshes === 1 ? json(401, problem(401, "UNAUTHENTICATED")) : json(201, session);
      }
      if (readAccessToken() === "fresh") return json(200, { user: { id: "u1" } });
      return json(401, problem(401, "UNAUTHENTICATED"));
    }));
    resetAccessToken();

    /* First visit: anonymous, and the refusal is remembered. */
    await expect(refreshSession()).resolves.toBe(false);
    await expect(apiRequest("/auth/me")).rejects.toBeInstanceOf(ApiError);
    expect(refreshes).toBe(1);

    /* The person then signs in, which mints a real token. A remembered refusal
       must not disable refreshes for the rest of the document. */
    writeAccessToken("fresh", 900);
    await expect(refreshSession()).resolves.toBe(true);
    expect(refreshes).toBe(1);
  });
});