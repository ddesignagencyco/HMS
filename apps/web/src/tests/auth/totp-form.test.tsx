import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAccessToken, writeAccessToken } from "@/lib/api/access-token";
import { resetRefreshState } from "@/lib/api/client";
import { getDictionary } from "@/lib/dictionaries";
import { SessionProvider } from "@/features/auth/session";
import { TotpForm } from "@/features/auth/totp-form";

/* The scan screen is the tallest card in the authentication set, so it is the
   one that has to survive a phone and a short laptop window. These cover the
   parts that were actually broken: an overflow-proof QR frame, a manual-key row
   that stacks, a visitor with no session being sent to sign-in instead of being
   offered a button that can only 401, and the refresh that re-mints a token the
   API's policy guard will accept. */

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/en/auth/totp",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("react-hot-toast", () => ({
  default: { success: vi.fn(), error: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

/* next/image needs a sized parent, which jsdom cannot give it. The alt text is
   what the QR is queried by, so a labelled placeholder carries it faithfully. */
vi.mock("next/image", () => ({
  default: ({ alt }: { alt?: string }) => <span role="img" aria-label={alt} />,
}));

const dict = getDictionary("en");

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

const secret = {
  secret: "JBSWY3DPEHPK3PXP",
  otpauthUri: "otpauth://totp/SHM:ahmad@example.com?secret=JBSWY3DPEHPK3PXP&issuer=SHM",
};

const agent = {
  id: "u2",
  phoneE164: "+923001234567",
  email: null,
  firstName: "Ahmad",
  lastName: "Plumber",
  locale: "en",
  status: "ACTIVE",
  roles: ["AGENT"],
  totpEnabled: false,
  providerStatus: null,
};

const renderForm = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SessionProvider locale="en">
        <TotpForm locale="en" dict={dict} />
      </SessionProvider>
    </QueryClientProvider>,
  );

/** Answers /auth/session as a staff account that has not cleared two-factor yet, and
    hands out the one-time secret the way the API does. */
const stubStaffSession = () => {
  writeAccessToken("held", 900);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => (url.endsWith("/auth/session") ? json(200, { authenticated: true, user: agent }) : json(200, secret))),
  );
};

const beginSetup = async () => {
  await waitFor(() => expect(screen.getByRole("button", { name: dict.auth.totpSetupTitle })).not.toBeNull());
  fireEvent.click(screen.getByRole("button", { name: dict.auth.totpSetupTitle }));
};

describe("TotpForm", () => {
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

  it("sends a visitor with no session to sign-in rather than offering a setup that will be refused", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(401, problem(401, "UNAUTHENTICATED"))));

    renderForm();

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/en/auth/sign-in"));
    expect(screen.queryByRole("button", { name: dict.auth.totpSetupTitle })).toBeNull();
  });

  it("draws the QR in a capped square, so it fits a narrow screen instead of overflowing the card", async () => {
    stubStaffSession();
    renderForm();
    await beginSetup();

    const qr = await screen.findByRole("img", { name: dict.auth.totpQrAlt });
    /* A fixed 224px square was the overflow; the frame is capped and square. */
    expect(qr.className).toContain("size-full");
    const frame = qr.parentElement;
    expect(frame?.className).toContain("aspect-square");
    expect(frame?.className).toContain("max-w-[248px]");
  });

  it("puts the code entry beside the QR on desktop, because stacked the card outgrew the fixed auth frame", async () => {
    stubStaffSession();
    renderForm();
    await beginSetup();

    /* The desktop auth frame is fixed height with overflow hidden: a card that
       outgrows it clips the confirm button off the bottom with no way to reach
       it. This one measured 927px stacked. */
    const qr = await screen.findByRole("img", { name: dict.auth.totpQrAlt });
    const row = qr.closest("div.grid")?.parentElement;
    expect(row?.className).toContain("lg:grid-cols-[212px_minmax(0,1fr)]");
    /* And the confirm button belongs to the code column, not under both. */
    const confirm = screen.getByRole("button", { name: dict.auth.totpConfirm });
    expect(qr.closest("div.grid")?.contains(confirm)).toBe(false);
  });

it("shows the setup key in a dialog rather than expanding it in place, so the card cannot outgrow the fixed frame", async () => {
    stubStaffSession();
    renderForm();
    await beginSetup();

    /* The desktop auth frame is fixed height with overflow hidden. A disclosure
       that opened in the card made it taller than the frame and pushed the
       footer off the page, and squeezed the key into a column too narrow to
       read. */
    await screen.findByRole("img", { name: dict.auth.totpQrAlt });

    const cardBefore = screen.getByRole("button", { name: dict.auth.totpConfirm }).closest(".relative.grid");
    expect(cardBefore).not.toBeNull();

    /* A plain button now, not a <details> that expands in place. */
    expect(screen.getByRole("button", { name: dict.auth.totpManualTitle })).not.toBeNull();
    expect(document.querySelector("details")).toBeNull();

    /* And the key lives in a dialog that sits outside the two-column row that
       gives the card its height. A closed <dialog> is display:none and an open
       one is promoted to the top layer, so neither state can resize the card. */
    const dialog = document.querySelector("dialog");
    expect(dialog).not.toBeNull();
    const row = screen.getByRole("img", { name: dict.auth.totpQrAlt }).closest("div.grid")?.parentElement;
    expect(row?.contains(dialog ?? null)).toBe(false);
    expect(dialog?.contains(screen.getByText(secret.secret))).toBe(true);
  });

  it("confirms the code and re-mints the session, because the token from sign-in still carries totp=false", async () => {
    const seen: string[] = [];
    writeAccessToken("held", 900);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        seen.push(`${init?.method ?? "GET"} ${url}`);
        if (url.endsWith("/auth/session")) return json(200, { authenticated: true, user: { ...agent, totpEnabled: false } });
        if (url.endsWith("/auth/totp/setup")) return json(200, secret);
        if (url.endsWith("/auth/totp/verify")) return json(200, { totpEnabled: true });
        if (url.endsWith("/auth/refresh")) {
          return json(200, { user: { ...agent, totpEnabled: true }, accessToken: "refreshed", expiresInSeconds: 900, totpRequired: false });
        }
        return json(500, problem(500, "INTERNAL_ERROR"));
      }),
    );

    renderForm();
    await beginSetup();

    await screen.findByLabelText(`${dict.auth.totpCode} 1`);
    for (const [index, digit] of Array.from("123456").entries()) {
      fireEvent.change(screen.getByLabelText(`${dict.auth.totpCode} ${index + 1}`), { target: { value: digit } });
    }

    fireEvent.click(screen.getByRole("button", { name: dict.auth.totpConfirm }));

    await waitFor(() => expect(seen).toContain("POST /api/v1/auth/totp/verify"));
    /* The refresh is the point: without it every staff route refuses the token. */
    await waitFor(() => expect(seen).toContain("POST /api/v1/auth/refresh"));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/en/agent"));
  });

  it("keeps the key and the code in place after a wrong code, because the key is only ever issued once", async () => {
    writeAccessToken("held", 900);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/auth/session")) return json(200, { authenticated: true, user: agent });
        if (url.endsWith("/auth/totp/setup")) return json(200, secret);
        return json(422, { ...problem(422, "TOTP_INVALID"), errors: [{ path: "code", code: "TOTP_INVALID", message: "That code is not right." }] });
      }),
    );

    renderForm();
    await beginSetup();

    await screen.findByText(secret.secret);
    for (const [index, digit] of Array.from("000000").entries()) {
      fireEvent.change(screen.getByLabelText(`${dict.auth.totpCode} ${index + 1}`), { target: { value: digit } });
    }
    fireEvent.click(screen.getByRole("button", { name: dict.auth.totpConfirm }));

    await waitFor(() => expect(screen.getByText("That code is not right.")).not.toBeNull());
    /* Not a restart: the same key is still there to be copied, because the API
       only ever issues it once. */
    expect(document.querySelector("dialog")?.textContent).toContain(secret.secret);
  });
});