import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AvailabilityPanel } from "@/features/discovery/availability-panel";
import { getDictionary } from "@/lib/dictionaries";
import type { Locale } from "@/lib/utils";

/* The availability panel — the one screen where a wrong number causes real harm,
   because somebody turns up at a time that was never actually free.

   Four states must be distinguishable: loading, no slots for the chosen day, an
   error the person can retry, and the slots themselves. And the booking action
   must stay disabled until a real slot is chosen: availability is current
   information, not a reservation, so the panel must never imply a time is held. */

const dict = getDictionary("en");
const locale: Locale = "en";
const providerId = "00000000-0000-4000-8000-000000000098";
const offers = [{ serviceId: 1, slug: "leak-repair", nameEn: "Leak Repair", pricePaisa: 100000 }];

/* The real payload: UTC instants for a local Asia/Karachi day, where midnight
   local is 19:00Z the previous evening. */
const day = {
  date: "2026-10-05",
  durationMin: 90,
  items: [
    { start: "2026-10-04T19:00:00.000Z", end: "2026-10-04T20:30:00.000Z" },
    { start: "2026-10-04T19:30:00.000Z", end: "2026-10-04T21:00:00.000Z" },
  ],
};

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const problem = (status: number) =>
  new Response(JSON.stringify({ type: "about:blank", title: "x", status, code: "NOT_FOUND", detail: "x", errors: [] }), { status });

const wrapperFor = (client: QueryClient) => {
  const Component = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return Component;
};

const renderPanel = (services = offers) =>
  render(<AvailabilityPanel locale={locale} dict={dict} providerId={providerId} services={services} />, {
    wrapper: wrapperFor(new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })),
  });

/** The note under the grid only exists once slots have actually arrived, so it is
    the one reliable signal that loading has finished. */
const settled = () => screen.findByText(dict.profile.availabilityNote);

/** Buttons whose label is a clock time — the slot grid, never the date chips. */
const slotButtons = () =>
  screen.getAllByRole("button").filter((button) => /^\d{1,2}:\d{2}/.test(button.textContent?.trim() ?? ""));

/** The date chips: a date, but not a clock time. */
const dayChips = () =>
  screen.getAllByRole("button").filter((button) => /\d/.test(button.textContent ?? "") && !/^\d{1,2}:\d{2}/.test(button.textContent?.trim() ?? ""));

const bookingLink = () => screen.queryByRole("link", { name: dict.profile.bookingAction });

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => json(day)));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("availability panel", () => {
  it("asks for slots with both the service and a local day", async () => {
    renderPanel();
    await settled();
    const url = String(vi.mocked(fetch).mock.calls[0]?.[0]);
    expect(url).toContain(`/search/providers/${providerId}/slots`);
    expect(url).toContain("serviceId=1");
    expect(url).toMatch(/date=\d{4}-\d{2}-\d{2}/);
  });

  it("renders one button per slot the API returned, and invents none", async () => {
    renderPanel();
    await settled();
    expect(slotButtons()).toHaveLength(day.items.length);
  });

  it("labels a slot in Asia/Karachi, not the browser's timezone", async () => {
    /* 19:00Z is midnight on the 5th in Asia/Karachi (+05:00). Formatting in the
       browser's zone would show the wrong clock to anyone outside Pakistan. */
    renderPanel();
    await settled();
    expect(slotButtons()[0]?.textContent?.trim().toLowerCase()).toBe("12:00 am");
  });

  it("keeps the booking action disabled until a slot is chosen", async () => {
    renderPanel();
    await settled();
    expect(bookingLink()).toBeNull();
    const action = screen.getByRole("button", { name: dict.profile.bookingAction });
    expect((action as HTMLButtonElement).disabled).toBe(true);
  });

  it("enables the hand-off only after a real slot is picked", async () => {
    renderPanel();
    await settled();
    fireEvent.click(slotButtons()[0] as HTMLElement);

    await waitFor(() => expect(bookingLink()).not.toBeNull());
    /* The booking flow accepts a service slug — not a provider, not a slot. */
    expect(bookingLink()?.getAttribute("href")).toBe("/en/book/leak-repair");
    /* Only one action, and it is now the link. */
    expect(screen.queryByRole("button", { name: dict.profile.bookingAction })).toBeNull();
  });

  it("drops the chosen slot when the day changes", async () => {
    renderPanel();
    await settled();
    fireEvent.click(slotButtons()[0] as HTMLElement);
    await waitFor(() => expect(bookingLink()).not.toBeNull());

    fireEvent.click(dayChips()[1] as HTMLElement);

    await waitFor(() => expect(bookingLink()).toBeNull());
    expect((screen.getByRole("button", { name: dict.profile.bookingAction }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows a loading state while the day is being read", async () => {
    let release = (): void => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return json(day);
      }),
    );
    renderPanel();
    expect(screen.getByText(dict.profile.slotsLoading)).toBeDefined();
    release();
    await settled();
  });

  it("says so plainly when a day has no start times left", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ date: "2026-10-05", durationMin: 90, items: [] })));
    renderPanel();
    expect(await screen.findByText(dict.profile.slotsNone)).toBeDefined();
    /* An empty day is not an error and must not offer the hand-off. */
    expect(bookingLink()).toBeNull();
  });

  it("offers a retry when the API refuses", async () => {
    /* 404 here means "this professional does not offer that service". */
    vi.stubGlobal("fetch", vi.fn(async () => problem(404)));
    renderPanel();
    expect(await screen.findByText(dict.profile.slotsError)).toBeDefined();
    expect(screen.getByRole("button", { name: new RegExp(dict.catalogue.retry, "i") })).toBeDefined();
  });

  it("does not retry a 404 — the API answered properly", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => problem(404)));
    renderPanel();
    await screen.findByText(dict.profile.slotsError);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("states that availability is current information, not a reservation", async () => {
    renderPanel();
    expect(await settled()).toBeDefined();
  });

  it("does not ask for slots at all when the professional offers nothing", async () => {
    renderPanel([]);
    expect(screen.getAllByText(dict.profile.bookingNone).length).toBeGreaterThan(0);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("shows the chosen service's own price, not the catalogue's base price", async () => {
    renderPanel();
    await settled();
    /* Rs 1,000 is this professional's price for the service. */
    expect(document.body.textContent).toContain("Rs 1,000");
  });
});