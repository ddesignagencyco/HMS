import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readAccessToken, resetAccessToken, writeAccessToken } from "@/lib/api/access-token";
import { resetRefreshState } from "@/lib/api/client";
import { RequireSession } from "@/components/require-session";
import { SessionProvider, sessionKeys, useSession } from "@/features/auth/session";

/* These cover the two things that only show up once state and a network are
   both involved: that a reload rebuilds the session from the refresh cookie
   rather than bouncing the visitor to sign-in, and that signing out leaves no
   trace of the person who was here before. */

let currentPathname = "/en/account";
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => currentPathname,
  useSearchParams: () => new URLSearchParams(),
}));

const problem = (status: number, code: string) => ({
  type: "about:blank",
  title: "x",
  status,
  code,
  detail: "no",
  errors: [],
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const empty = (status: number) => new Response("", { status });

const customer = { id: "u1", phoneE164: "+923001234567", email: null, firstName: "Ayesha", lastName: "Khan", locale: "en", status: "ACTIVE", roles: ["CUSTOMER"], totpEnabled: false, providerStatus: null };

const renderSession = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = render(
    <QueryClientProvider client={queryClient}>
      <SessionProvider locale="en">
        <Probe />
      </SessionProvider>
    </QueryClientProvider>,
  );
  return { queryClient, ...ui };
};

function Probe() {
  const { status, user, signOut } = useSession();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="user">{user?.id ?? "-"}</span>
      <button type="button" onClick={() => void signOut()}>
        out
      </button>
    </div>
  );
}

describe("SessionProvider", () => {
  beforeEach(() => {
    resetAccessToken();
    resetRefreshState();
    replace.mockClear();
  });

  afterEach(() => {
    cleanup();
    resetAccessToken();
    resetRefreshState();
    vi.unstubAllGlobals();
  });

  it("starts in the loading state, so a protected page is not shown to a visitor who has a session", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(200, { user: customer })));
    renderSession();
    expect(screen.getByTestId("status").textContent).toBe("loading");
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("authenticated"));
  });

  it("rebuilds the session after a reload from the refresh cookie alone", async () => {
    let refreshes = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/auth/refresh")) {
        refreshes += 1;
        return json(201, { user: customer, accessToken: "rebuilt", expiresInSeconds: 900, totpRequired: false });
      }
      if (readAccessToken() === "rebuilt") return json(200, { user: customer });
      return json(401, problem(401, "UNAUTHENTICATED"));
    }));
    /* Nothing in memory, exactly as after a browser refresh. */
    resetAccessToken();

    renderSession();

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("authenticated"));
    expect(refreshes).toBe(1);
    expect(readAccessToken()).toBe("rebuilt");
  });

  it("settles on anonymous, not loading, when there is no session at all", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(401, problem(401, "UNAUTHENTICATED"))));
    renderSession();
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("anonymous"));
    expect(screen.getByTestId("user").textContent).toBe("-");
  });

  it("drops every cached query when the session ends, so the next account starts from nothing", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      seen.push(url);
      if (url.endsWith("/auth/logout")) return new Response("", { status: 204 });
      return json(200, { user: customer });
    }));
    const { queryClient } = renderSession();
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("authenticated"));

    /* Somebody else's private data, cached by an earlier page. */
    queryClient.setQueryData(["customer", "bookings"], [{ id: "b1", customer: "Somebody Else" }]);
    expect(queryClient.getQueryData(["customer", "bookings"])).toBeDefined();

    screen.getByRole("button", { name: "out" }).click();

    await waitFor(() => expect(queryClient.getQueryData(["customer", "bookings"])).toBeUndefined());
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("anonymous"));
    expect(seen.some((url) => url.endsWith("/auth/logout"))).toBe(true);
    expect(readAccessToken()).toBeNull();
  });

  it("keeps the local session closed even when the logout call cannot be made", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/auth/logout")) throw new TypeError("offline");
      return json(200, { user: customer });
    }));
    const { queryClient } = renderSession();
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("authenticated"));
    queryClient.setQueryData(["customer", "bookings"], [{ id: "b1" }]);

    screen.getByRole("button", { name: "out" }).click();

    await waitFor(() => expect(queryClient.getQueryData(["customer", "bookings"])).toBeUndefined());
    expect(readAccessToken()).toBeNull();
  });

  it("holds the cached user under one key, so nothing else holds a copy", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(200, { user: customer })));
    const { queryClient } = renderSession();
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("authenticated"));
    expect(queryClient.getQueryData(sessionKeys.me)).toEqual({ user: customer });
  });
});

describe("RequireSession", () => {
  beforeEach(() => {
    resetAccessToken();
    resetRefreshState();
    currentPathname = "/en/account";
    replace.mockClear();
  });

  afterEach(() => {
    cleanup();
    resetAccessToken();
    resetRefreshState();
    vi.unstubAllGlobals();
  });

  it("withholds the portal and sends a signed-out visitor to sign-in with where they were going", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(401, problem(401, "UNAUTHENTICATED"))));
    window.history.replaceState({}, "", "/en/admin/reports?range=30");

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SessionProvider locale="en">
          <RequireSession locale="en">
            <p>secret portal</p>
          </RequireSession>
        </SessionProvider>
      </QueryClientProvider>,
    );

    expect(screen.queryByText("secret portal")).toBeNull();
    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(replace.mock.calls[0]?.[0]).toBe("/en/auth/sign-in?returnTo=%2Fen%2Fadmin%2Freports%3Frange%3D30");
  });

  it("shows the portal to a signed-in account once the session is confirmed", async () => {
    writeAccessToken("held", 900);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (url.endsWith("/auth/me") ? json(200, { user: customer }) : empty(204))));

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SessionProvider locale="en">
          <RequireSession locale="en">
            <p>secret portal</p>
          </RequireSession>
        </SessionProvider>
      </QueryClientProvider>,
    );

    expect(screen.queryByText("secret portal")).toBeNull();
    await waitFor(() => expect(screen.getByText("secret portal")).toBeTruthy());
    expect(replace).not.toHaveBeenCalled();
  });

  it("redirects an authenticated account away from unauthorized portal areas", async () => {
    currentPathname = "/en/admin";
    writeAccessToken("held", 900);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (url.endsWith("/auth/me") ? json(200, { user: customer }) : empty(204))));

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SessionProvider locale="en">
          <RequireSession locale="en">
            <p>secret portal</p>
          </RequireSession>
        </SessionProvider>
      </QueryClientProvider>,
    );

    expect(screen.queryByText("secret portal")).toBeNull();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/en/account"));
  });
});