import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TrackBooking } from "@/features/discovery/track-booking";
import { getDictionary } from "@/lib/dictionaries";

/* `/track` is a public page. Found in the browser audit: an anonymous visitor's
   page fired `GET /bookings` (401) and then a refused `POST /auth/refresh` (401),
   because the bookings query was created before the session gate. The read is
   now mounted only for a signed-in customer. */

const dict = getDictionary("en");

let session: { status: "loading" | "authenticated" | "anonymous"; roles: string[] } = { status: "anonymous", roles: [] };
vi.mock("@/features/auth/session", () => ({
  useSession: () => session,
}));

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

const renderTracker = () =>
  render(<TrackBooking locale="en" dict={dict} />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>{children}</QueryClientProvider>
    ),
  });

const bookingCalls = () => vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes("/bookings"));

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => json({ items: [] })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("track booking gate", () => {
  it("asks an anonymous visitor to sign in and reads nothing", async () => {
    session = { status: "anonymous", roles: [] };
    renderTracker();
    expect(screen.getByText(dict.trackPage.signInRequiredTitle)).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(bookingCalls()).toHaveLength(0);
  });

  it("reads nothing while the session is still being established", async () => {
    session = { status: "loading", roles: [] };
    renderTracker();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(bookingCalls()).toHaveLength(0);
  });

  it("tells a non-customer account there is nothing here, without a customer read", async () => {
    session = { status: "authenticated", roles: ["PROVIDER"] };
    renderTracker();
    expect(screen.getByText(dict.trackPage.customerOnlyTitle)).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(bookingCalls()).toHaveLength(0);
  });

  it("lists a signed-in customer's own bookings", async () => {
    session = { status: "authenticated", roles: ["CUSTOMER"] };
    renderTracker();
    await waitFor(() => expect(bookingCalls().length).toBeGreaterThan(0));
    expect(await screen.findByText(dict.trackPage.noBookingsYet)).toBeTruthy();
  });

  it("submitting the code form does not navigate away", async () => {
    session = { status: "authenticated", roles: ["CUSTOMER"] };
    renderTracker();
    const button = await screen.findByRole("button", { name: dict.trackPage.submit });
    const form = button.closest("form");
    expect(form).not.toBeNull();
    const event = new Event("submit", { bubbles: true, cancelable: true });
    form?.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});
