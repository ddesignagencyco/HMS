import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAccessToken } from "@/lib/api/access-token";
import { resetRefreshState } from "@/lib/api/client";
import { getDictionary } from "@/lib/dictionaries";
import { SiteHeader } from "@/components/site-header";
import { SessionProvider, useSession } from "@/features/auth/session";

/* The header is the one place the whole site states whether anybody is signed
   in, and it reads the session that the sign-in form just wrote. These cover the
   journey a person actually takes — arrive signed out, sign in, and expect the
   header to change without a reload — because a stale header is the visible
   symptom of the session not reaching the chrome. */

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/en",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("react-hot-toast", () => ({
  default: { success: vi.fn(), error: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
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

const customer = {
  id: "u1",
  phoneE164: "+923001234567",
  email: null,
  firstName: "Ayesha",
  lastName: "Khan",
  locale: "en",
  status: "ACTIVE",
  roles: ["CUSTOMER"],
  totpEnabled: false,
  providerStatus: null,
};

function SignInProbe() {
  const { signIn } = useSession();
  return (
    <button type="button" onClick={() => void signIn({ identifier: "ayesha@example.com", password: "Str0ngPassphrase!" })}>
      sign in
    </button>
  );
}

const renderTree = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SessionProvider locale="en">
        <SiteHeader locale="en" dict={getDictionary("en")} />
        <SignInProbe />
      </SessionProvider>
    </QueryClientProvider>,
  );

describe("SiteHeader", () => {
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

  it("does not offer sign-in before it knows whether there is a session", () => {
    /* /auth/me never answers. The header must not claim either way: the wrong
       claim here is what a signed-in person sees on every full page load. */
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));

    renderTree();

    expect(screen.queryAllByRole("link", { name: "Sign in" })).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
    expect(document.querySelectorAll("[aria-hidden='true'].skeleton").length).toBeGreaterThan(0);
  });

  it("swaps the sign-in link for the account and sign-out controls as soon as a sign-in succeeds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/auth/login")) {
          return json(200, { user: customer, accessToken: "minted", expiresInSeconds: 900, totpRequired: false });
        }
        return json(401, problem(401, "UNAUTHENTICATED"));
      }),
    );

    renderTree();

    /* Signed out: the header offers the way in, and nothing private. */
    await waitFor(() => expect(screen.getAllByRole("link", { name: "Sign in" }).length).toBeGreaterThan(0));
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();

    screen.getByRole("button", { name: "sign in" }).click();

    await waitFor(() => expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeNull());
    expect(screen.queryAllByRole("link", { name: "Sign in" })).toHaveLength(0);
    expect(screen.getAllByRole("link", { name: "My account" })[0]?.getAttribute("href")).toBe("/en/account");
  });

  it("shows the signed-out controls again when the session ends", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (url.endsWith("/auth/logout") ? new Response("", { status: 204 }) : json(200, { user: customer }))));

    renderTree();

    await waitFor(() => expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeNull());

    screen.getByRole("button", { name: "Sign out" }).click();

    await waitFor(() => expect(screen.queryAllByRole("link", { name: "Sign in" }).length).toBeGreaterThan(0));
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
  });
});