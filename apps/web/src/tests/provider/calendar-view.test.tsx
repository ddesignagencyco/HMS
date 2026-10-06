import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderCalendarScreen } from "@/features/provider/calendar-view";
import { getDictionary } from "@/lib/dictionaries";
import type { Locale } from "@/lib/utils";

/* Availability and leave.

   The contract facts these pin:
   · availability is `{ items: [{ weekday, startTime, endTime }] }` and the save is a
     **full replace**, so the body must be the whole list and must not carry the
     `id` the GET returns — `availabilityReplaceSchema` is `.strict()`.
   · leave is a half-open `tstzrange`, so one picked day becomes 00:00 → next-day
     00:00. Sending the same instant twice would be rejected by the schema's
     `start < end` refinement.
   · a window that ends before it starts is refused before the round trip. */

const dict = getDictionary("en");
const locale: Locale = "en";

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

const renderScreen = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0, gcTime: 0 } },
  });
  const Component = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<ProviderCalendarScreen locale={locale} dict={dict} />, { wrapper: Component });
};

let blocks = [{ id: "a1", weekday: 1, startTime: "09:00", endTime: "17:00" }];
let leave = [] as { id: string; start: string; end: string; reason: string | null; createdAt: string }[];

const putCall = () =>
  (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
    ([url, init]) => String(url).includes("/provider/availability") && (init as RequestInit)?.method === "PUT",
  );
const postCall = () =>
  (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
    ([url, init]) => String(url).includes("/provider/time-off") && (init as RequestInit)?.method === "POST",
  );

beforeEach(() => {
  blocks = [{ id: "a1", weekday: 1, startTime: "09:00", endTime: "17:00" }];
  leave = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "PUT" && url.includes("/provider/availability")) return json({ items: blocks });
      if (method === "POST" && url.includes("/provider/time-off")) return json(leave[0] ?? {});
      if (method === "DELETE" && url.includes("/provider/time-off")) return new Response(null, { status: 204 });
      if (method === "GET" && url.includes("/provider/availability")) return json({ items: blocks });
      if (method === "GET" && url.includes("/provider/time-off")) return json({ items: leave });
      throw new Error(`unrouted ${method} ${url}`);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("provider availability", () => {
  it("shows the windows already on file", async () => {
    renderScreen();
    expect((await screen.findByLabelText(dict.portal.fromLabel)) as HTMLInputElement).toBeDefined();
    expect(((await screen.findByLabelText(dict.portal.fromLabel)) as HTMLInputElement).value).toBe("09:00");
  });

  it("says so plainly when nothing is set", async () => {
    blocks = [];
    renderScreen();
    expect(await screen.findByText(dict.portal.noAvailability)).toBeDefined();
  });

  it("keeps Save disabled until a window actually changes", async () => {
    renderScreen();
    await screen.findByLabelText(dict.portal.fromLabel);
    const save = (await screen.findByRole("button", { name: dict.portal.saveAvailability })) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.change(await screen.findByLabelText(dict.portal.fromLabel), { target: { value: "10:00" } });
    expect(((await screen.findByRole("button", { name: dict.portal.saveAvailability })) as HTMLButtonElement).disabled).toBe(false);
  });

  it("sends the whole list without the id the GET returned", async () => {
    renderScreen();
    fireEvent.change(await screen.findByLabelText(dict.portal.fromLabel), { target: { value: "10:00" } });
    fireEvent.click(await screen.findByRole("button", { name: dict.portal.saveAvailability }));

    await waitFor(() => expect(putCall()).toBeDefined());
    const body = JSON.parse(String((putCall()?.[1] as RequestInit).body)) as { items: unknown[] };
    /* `.strict()` — an `id` here would be a 422, because replace deletes and
       re-inserts, handing out fresh ids. */
    expect(body).toEqual({ items: [{ weekday: 1, startTime: "10:00", endTime: "17:00" }] });
  });

  it("refuses a window that ends before it starts, before sending it", async () => {
    renderScreen();
    fireEvent.change(await screen.findByLabelText(dict.portal.fromLabel), { target: { value: "18:00" } });
    fireEvent.click(await screen.findByRole("button", { name: dict.portal.saveAvailability }));
    expect(await screen.findByText(dict.portal.availabilityOrderInvalid)).toBeDefined();
    expect(putCall()).toBeUndefined();
  });

  it("adds a new window when asked", async () => {
    renderScreen();
    await screen.findByLabelText(dict.portal.fromLabel);
    fireEvent.click(screen.getByRole("button", { name: dict.portal.addWindow }));
    /* Two rows now: the new one defaults to Sunday, the seeded first day. */
    expect(screen.getAllByLabelText(dict.portal.fromLabel)).toHaveLength(2);
  });

  it("discards the draft on cancel", async () => {
    renderScreen();
    fireEvent.change(await screen.findByLabelText(dict.portal.fromLabel), { target: { value: "10:00" } });
    fireEvent.click(await screen.findByRole("button", { name: dict.common.cancel }));
    expect(((await screen.findByLabelText(dict.portal.fromLabel)) as HTMLInputElement).value).toBe("09:00");
  });

  it("reports a failure to load availability", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/provider/availability")) {
          return new Response(
            JSON.stringify({ type: "about:blank", title: "x", status: 500, code: "INTERNAL_ERROR", detail: "x", errors: [] }),
            { status: 500, headers: { "content-type": "application/problem+json" } },
          );
        }
        return json({ items: [] });
      }),
    );
    renderScreen();
    expect(await screen.findByText(dict.portal.availabilityLoadError)).toBeDefined();
  });
});

describe("provider leave", () => {
  it("turns one picked date into a half-open range", async () => {
    renderScreen();
    fireEvent.change(await screen.findByLabelText(dict.portal.leaveDateLabel), { target: { value: "2026-12-25" } });
    fireEvent.change(await screen.findByLabelText(dict.portal.leaveReasonLabel), { target: { value: "Eid" } });
    fireEvent.click(await screen.findByRole("button", { name: dict.portal.recordLeave }));

    await waitFor(() => expect(postCall()).toBeDefined());
    expect(JSON.parse(String((postCall()?.[1] as RequestInit).body))).toEqual({
      start: "2026-12-25T00:00:00.000Z",
      end: "2026-12-26T00:00:00.000Z",
      reason: "Eid",
    });
  });

  it("omits the reason when it is blank, because the schema is strict", async () => {
    renderScreen();
    fireEvent.change(await screen.findByLabelText(dict.portal.leaveDateLabel), { target: { value: "2026-12-25" } });
    fireEvent.click(await screen.findByRole("button", { name: dict.portal.recordLeave }));

    await waitFor(() => expect(postCall()).toBeDefined());
    expect(JSON.parse(String((postCall()?.[1] as RequestInit).body))).toEqual({
      start: "2026-12-25T00:00:00.000Z",
      end: "2026-12-26T00:00:00.000Z",
    });
  });

  it("refuses to record leave with no date", async () => {
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: dict.portal.recordLeave }));
    expect(await screen.findByText(dict.portal.leaveDateRequired)).toBeDefined();
    expect(postCall()).toBeUndefined();
  });

  it("surfaces the server's own message on an overlapping period", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : String(input);
        if (init?.method === "POST") {
          return new Response(
            JSON.stringify({
              type: "about:blank",
              title: "x",
              status: 409,
              code: "CONFLICT",
              detail: 'This leave period overlaps one you already have on file',
              errors: [],
            }),
            { status: 409, headers: { "content-type": "application/problem+json" } },
          );
        }
        return json(url.includes("time-off") ? { items: [] } : { items: blocks });
      }),
    );
    renderScreen();
    fireEvent.change(await screen.findByLabelText(dict.portal.leaveDateLabel), { target: { value: "2026-12-25" } });
    fireEvent.click(await screen.findByRole("button", { name: dict.portal.recordLeave }));
    /* The server's sentence names the overlap; anything vaguer would hide it. */
    expect(await screen.findByText("This leave period overlaps one you already have on file")).toBeDefined();
  });

  it("says so when no leave is recorded", async () => {
    renderScreen();
    expect(await screen.findByText(dict.portal.noLeave)).toBeDefined();
  });

  it("removes a leave period through the API", async () => {
    leave = [
      {
        id: "t1",
        start: "2026-12-25T00:00:00.000Z",
        end: "2026-12-26T00:00:00.000Z",
        reason: "Eid",
        createdAt: "2026-10-01T00:00:00.000Z",
      },
    ];
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(dict.portal.cancelLeave) }));
    await waitFor(() => {
      const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
        ([url, init]) => String(url).includes("/provider/time-off/t1") && (init as RequestInit)?.method === "DELETE",
      );
      expect(call).toBeDefined();
    });
  });
});