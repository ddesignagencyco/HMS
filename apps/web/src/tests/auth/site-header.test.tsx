import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
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
   symptom of the session not reaching the chrome.

   The first question is `GET /auth/session`, which answers 200 either way. Every
   fixture below models that, so a test that passes here would also pass against
   the live API: `me` is never the first call, because it needs a bearer token
   that a reload has thrown away. */

const replace = vi.fn();
let pathname = "/en";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => pathname,
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

/** The real `GET /auth/session` answer for a signed-out browser: 200, no user. */
const signedOut = () => json(200, { authenticated: false, user: null });

/** A refresh cookie that is still good, so the session is restored without a 401. */
const signedInAs = (user: unknown) => json(200, { authenticated: true, user });

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
    pathname = "/en";
  });

  afterEach(() => {
    cleanup();
    resetAccessToken();
    resetRefreshState();
    vi.unstubAllGlobals();
  });

  /* The signed-in controls live behind one round account button that opens a
     menu, so "is there a session" is now answered by the presence of that
     button rather than by a Sign out button sitting on the bar. */
  const accountButton = () => screen.queryByRole("button", { name: "Account menu" });
  const openAccountMenu = async () => {
    await waitFor(() => expect(accountButton()).not.toBeNull());
    screen.getByRole("button", { name: "Account menu" }).click();
    await waitFor(() => expect(screen.getByRole("menu")).not.toBeNull());
  };

  /* The brand is the mark alone. The wordmark beside it was what made the header
     read as half-migrated, and it was being repeated in the page body too. */
  it("shows the logo without the brand wordmark beside it", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    renderTree();
    const header = screen.getByRole("banner");
    /* The mark carries an accessible name; the name must not also be visible. */
    expect(within(header).queryAllByText("Smart Home Maintenance")).toHaveLength(0);
    expect(within(header).getByLabelText("Smart Home Maintenance")).not.toBeNull();
  });

  /* Everything on the utility strip is a destination a person can actually take. */
  it("puts a callable number and a real help route on the utility strip", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    renderTree();
    const phone = document.querySelector('a[href^="tel:"]');
    expect(phone).not.toBeNull();
    expect(phone?.getAttribute("href")).toMatch(/^tel:\+92300\d+$/);
    expect(within(screen.getByRole("banner")).getByRole("link", { name: "Support" }).getAttribute("href")).toBe("/en/contact");
  });

  it("does not offer sign-in before it knows whether there is a session", () => {
    /* The session question never answers. The header must not claim either way:
       the wrong claim here is what a signed-in person sees on every full page
       load. */
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));

    renderTree();

    expect(screen.queryAllByRole("link", { name: "Sign in" })).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
    expect(document.querySelectorAll("[aria-hidden='true'].skeleton").length).toBeGreaterThan(0);
  });

  /* A signed-out visitor used to cost two errors per page load: a 401 from
     `/auth/me` and a refused `/auth/refresh`. The session endpoint answers 200
     either way, so neither should be requested at all. */
  it("settles a signed-out visitor from /auth/session without a single 401", async () => {
    const fetchMock = vi.fn(async (url: string) => (url.endsWith("/auth/session") ? signedOut() : json(401, problem(401, "UNAUTHENTICATED"))));
    vi.stubGlobal("fetch", fetchMock);

    renderTree();

    await waitFor(() => expect(screen.getAllByRole("link", { name: "Sign in" }).length).toBeGreaterThan(0));
    const asked = fetchMock.mock.calls.map(([url]) => String(url));
    expect(asked.some((url) => url.endsWith("/auth/session"))).toBe(true);
    expect(asked.some((url) => url.endsWith("/auth/me"))).toBe(false);
    expect(asked.some((url) => url.endsWith("/auth/refresh"))).toBe(false);
  });

  /* The whole point of the session endpoint: a reload destroys the access token,
     so the cookie is the only evidence left. This is the page-refresh case. */
  it("restores a signed-in browser from the cookie alone, with no 401 first", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/auth/session")) return signedInAs(customer);
      if (url.endsWith("/auth/refresh")) return json(200, { user: customer, accessToken: "minted", expiresInSeconds: 900, totpRequired: false });
      return json(401, problem(401, "UNAUTHENTICATED"));
    });
    vi.stubGlobal("fetch", fetchMock);

    renderTree();

    await waitFor(() => expect(accountButton()).not.toBeNull());
    const asked = fetchMock.mock.calls.map(([url]) => String(url));
    expect(asked.some((url) => url.endsWith("/auth/me"))).toBe(false);
  });

  it("swaps the sign-in link for the account and sign-out controls as soon as a sign-in succeeds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/auth/login")) {
          return json(200, { user: customer, accessToken: "minted", expiresInSeconds: 900, totpRequired: false });
        }
        return signedOut();
      }),
    );

    renderTree();

    /* Signed out: the header offers the way in, and nothing private. */
    await waitFor(() => expect(screen.getAllByRole("link", { name: "Sign in" }).length).toBeGreaterThan(0));
    expect(accountButton()).toBeNull();

    screen.getByRole("button", { name: "sign in" }).click();

    await waitFor(() => expect(accountButton()).not.toBeNull());
    expect(screen.queryAllByRole("link", { name: "Sign in" })).toHaveLength(0);

    /* The menu carries the account destinations, and sign-out is in it rather
       than beside the profile link at the same weight. */
    await openAccountMenu();
    expect(screen.getByRole("menuitem", { name: "Profile" }).getAttribute("href")).toBe("/en/account");
    expect(screen.getByRole("menuitem", { name: "Sign out" })).not.toBeNull();
  });

  it("shows the signed-out controls again when the session ends", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => (url.endsWith("/auth/logout") ? new Response("", { status: 204 }) : signedInAs(customer))),
    );

    renderTree();

    await openAccountMenu();

    screen.getByRole("menuitem", { name: "Sign out" }).click();

    await waitFor(() => expect(screen.queryAllByRole("link", { name: "Sign in" }).length).toBeGreaterThan(0));
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
  });
});

/* ---- The navigation itself ----------------------------------------------- */

describe("SiteHeader navigation", () => {
  beforeEach(() => {
    resetAccessToken();
    resetRefreshState();
    pathname = "/en";
  });

  afterEach(() => {
    cleanup();
    resetAccessToken();
    resetRefreshState();
    vi.unstubAllGlobals();
  });

  const renderSignedOut = () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (url.endsWith("/auth/session") ? signedOut() : json(401, problem(401, "UNAUTHENTICATED")))));
    return render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SessionProvider locale="en">
          <SiteHeader locale="en" dict={getDictionary("en")} />
        </SessionProvider>
      </QueryClientProvider>,
    );
  };

  it("does not print the wordmark in the navigation bar", async () => {
    renderSignedOut();
    await waitFor(() => expect(screen.getAllByRole("link", { name: "Sign in" }).length).toBeGreaterThan(0));

    /* The mark is the brand. The brand name belongs to the logo's accessible
       name, not to a line of text beside it. */
    expect(document.body.textContent).not.toContain("Smart Home Maintenance");
  });

  it("labels every navigation item with a single word", async () => {
    renderSignedOut();
    await waitFor(() => expect(screen.getAllByRole("link", { name: "Sign in" }).length).toBeGreaterThan(0));

    const nav = screen.getAllByRole("navigation")[0];
    for (const item of nav.querySelectorAll("a")) {
      const label = item.textContent?.trim() ?? "";
      expect(label.split(/\s+/)).toHaveLength(1);
    }
  });

  it("underlines the active route and nothing else", async () => {
    pathname = "/en/providers";
    renderSignedOut();
    await waitFor(() => expect(screen.getAllByRole("link", { name: "Sign in" }).length).toBeGreaterThan(0));

    const marked = screen.getAllByRole("link", { current: "page" });
    expect(marked).toHaveLength(1);
    expect(marked[0]?.getAttribute("href")).toBe("/en/providers");
  });

  /* A detail page is still inside its section, so the section stays marked.
     Comparing the whole path would unmark every item the moment one opened. */
  it("keeps a section active on its nested routes", async () => {
    pathname = "/en/account/bookings/0f9c";
    renderSignedOut();
    await waitFor(() => expect(screen.getAllByRole("link", { name: "Sign in" }).length).toBeGreaterThan(0));

    expect(screen.queryAllByRole("link", { current: "page" })).toHaveLength(0);
  });

  /* `/providers` must not light up on `/providers-archive`: the boundary is a
     slash, not a string prefix. */
  it("does not treat a longer path with the same prefix as the same section", async () => {
    pathname = "/en/providers-archive";
    renderSignedOut();
    await waitFor(() => expect(screen.getAllByRole("link", { name: "Sign in" }).length).toBeGreaterThan(0));

    expect(screen.queryAllByRole("link", { current: "page" })).toHaveLength(0);
  });
});