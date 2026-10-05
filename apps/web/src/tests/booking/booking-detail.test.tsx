import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BookingDetail } from "@/features/booking/booking-detail";
import { getDictionary } from "@/lib/dictionaries";
import type { Locale } from "@/lib/utils";
import type { Booking } from "@/features/booking/api";

/* One booking, seen by the customer who made it.

   The page's whole job is to say what is true right now: which stages have been
   passed, which actions are still available, and what the money is. Three
   specific claims are pinned here because the previous mock version of this page
   got all three wrong while looking finished:

   · **A progress bar that always advances.** The mock rendered four fixed steps
     for every booking and labelled the last one "current live stage" whatever
     the status was — so a cancelled booking showed progress. Here the stages are
     derived from the status, and a booking that will never move again says so.

   · **A cancellation fee that is never charged.** FR-BK-06 is not applied by the
     API yet, so no fee is quoted. Claiming one would name a rule that does not
     run, and a customer shown "Rs 500 fee" would expect to be charged it.

   · **Actions that cannot work.** A button the API will refuse is worse than no
     button, so cancel and reschedule appear only where the transition table
     allows them. */

const dict = getDictionary("en");
const locale: Locale = "en";
const text = () => document.body.textContent ?? "";

const booking = (over: Partial<Booking>): Booking => ({
  id: "b1",
  code: "SHM-0000001",
  customerId: "c1",
  providerId: "00000000-0000-4000-8000-000000000098",
  serviceId: 1,
  addressId: "a1",
  status: "SCHEDULED",
  paymentMode: "CASH",
  paymentStatus: "NONE",
  isEmergency: false,
  isAutoAssign: false,
  scheduledStart: "2026-10-20T04:00:00.000Z",
  scheduledEnd: "2026-10-20T05:30:00.000Z",
  problemText: "Kitchen tap is leaking",
  quotedAmountPaisa: 250000,
  approvedTotalPaisa: 250000,
  finalAmountPaisa: null,
  discountPaisa: 0,
  rescheduleCount: 0,
  noShowParty: null,
  cancelReason: null,
  startOtpVerifiedAt: null,
  completedAt: null,
  verificationTier: null,
  createdAt: "2026-10-01T09:00:00.000Z",
  updatedAt: "2026-10-01T09:00:00.000Z",
  ...over,
});

const problem = (status: number, code: string) => ({ type: "about:blank", title: "x", status, code, detail: "x", errors: [] });

/** The catalogue names are joined onto `serviceId`; the API row has no name. */
const stubApi = (over: Partial<Booking> = {}, overrides: { chat?: unknown; create?: { status: number; body: unknown } } = {}) => {
  const record = booking(over);
  const sent: { url: string; body: Record<string, unknown> }[] = [];
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url);
      sent.push({ url: path, body: init?.body === undefined ? {} : (JSON.parse(String(init.body)) as Record<string, unknown>) });
      /* `/bookings/:id` is a prefix of every action on that booking, so it is
         matched first and exactly. */
      if (path.endsWith("/messages") && init?.method === "POST") return ok({ id: "m1", senderUserId: "c1", body: "x", mine: true, readAt: null, createdAt: "x", masked: false });
      if (path.endsWith("/messages")) return ok(overrides.chat ?? { items: [], open: true });
      if (/\/slots$/.test(path)) return ok({ date: "2026-10-21", durationMin: 90, items: [{ start: "2026-10-21T05:00:00.000Z", end: "2026-10-21T06:30:00.000Z" }] });
      /* An action, which an override may refuse to model a booking that moved on
         between the page loading and the click. */
      if (path.endsWith("/cancel") || path.endsWith("/reschedule")) {
        const spec = overrides.create ?? { status: 200, body: record };
        return new Response(JSON.stringify(spec.body), { status: spec.status, headers: { "content-type": "application/json" } });
      }
      if (/\/bookings\/[^/]+$/.test(path)) return ok(record);
      /* The catalogue fan-out behind the service name. */
      if (path.endsWith("/catalogue/categories")) return ok({ items: [{ id: 1, slug: "plumbing", nameEn: "Plumbing", nameUr: "x", sortOrder: 0, defaultWarrantyDays: 30, isActive: true }] });
      if (path.includes("/services")) return ok({ items: [{ id: 1, categoryId: 1, slug: "leak-repair", nameEn: "Leak Repair", nameUr: "x", description: "d", pricingModel: "FLAT", timeUnit: null, basePricePaisa: 250000, minPricePaisa: 250000, maxPricePaisa: 250000, visitFeePaisa: 0, expectedDurationMin: 90, isEmergencyEligible: true, isPlanEligible: false, warrantyDays: 30, isHighRisk: false, isActive: true, categorySlug: "plumbing", categoryNameEn: "Plumbing", categoryNameUr: "x" }] });
      return new Response(JSON.stringify(problem(404, "NOT_FOUND")), { status: 404, headers: { "content-type": "application/json" } });
    }),
  );
  return { sent };
};

const renderDetail = (over: Partial<Booking> = {}, overrides?: Parameters<typeof stubApi>[1]) => {
  const api = stubApi(over, overrides);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const Component = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  render(<BookingDetail locale={locale} dict={dict} bookingId="b1" />, { wrapper: Component });
  return api;
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the booking itself", () => {
  it("shows the reference and the joined service name", async () => {
    renderDetail();
    /* The row carries only `serviceId`, so the name comes from the catalogue. */
    expect(await screen.findByRole("heading", { name: "Leak Repair" })).toBeDefined();
    expect(text()).toContain("SHM-0000001");
  });

  it("says so plainly when the service is no longer in the catalogue", async () => {
    renderDetail({ serviceId: 999 });
    /* An unmapped id is not a broken page — the booking exists either way. */
    await waitFor(() => expect(text()).toContain(dict.portal.unknownService), { timeout: 5_000 });
    expect(text()).toContain("SHM-0000001");
  });

  it("shows the approved total while the job is unfinished", async () => {
    renderDetail();
    await screen.findByRole("heading", { name: "Leak Repair" });
    expect(text()).toContain("Rs 2,500");
  });

  it("prefers the provider's closing figure once there is one", async () => {
    renderDetail({ status: "PAYMENT_RELEASED", finalAmountPaisa: 200000 });
    await screen.findByRole("heading", { name: "Leak Repair" });
    expect(text()).toContain("Rs 2,000");
  });

  it("does not call a cash booking's unpaid state a failure", async () => {
    /* CASH is collected by the professional after verification, so NONE is the
       correct paymentStatus for a healthy booking. */
    renderDetail({ paymentMode: "CASH", paymentStatus: "NONE" });
    await screen.findByRole("heading", { name: "Leak Repair" });
    expect(text()).not.toContain(dict.booking.heldNote);
  });

  it("says money is held when the platform is holding it", async () => {
    renderDetail({ paymentMode: "ONLINE", paymentStatus: "HELD" });
    await screen.findByRole("heading", { name: "Leak Repair" });
    expect(text()).toContain(dict.booking.heldNote);
  });
});

describe("progress reflects the status, not a fixed script", () => {
  it("walks the stages a live booking has actually passed", async () => {
    renderDetail({ status: "IN_PROGRESS" });
    await screen.findByRole("heading", { name: "Leak Repair" });
    expect(text()).toContain(dict.bookingStatus.REQUESTED);
    expect(text()).toContain(dict.bookingStatus.SCHEDULED);
    expect(text()).toContain(dict.bookingStatus.IN_PROGRESS);
    /* Not yet: a booking in progress has not been reported complete. */
    expect(text()).not.toContain(dict.bookingStatus.WORK_COMPLETED);
  });

  it("stops at the stage it reached and does not show later ones", async () => {
    renderDetail({ status: "REQUESTED" });
    await screen.findByRole("heading", { name: "Leak Repair" });
    expect(text()).toContain(dict.bookingStatus.REQUESTED);
    expect(text()).not.toContain(dict.bookingStatus.IN_PROGRESS);
  });

  it("does not show a progress rail for a cancelled booking", async () => {
    renderDetail({ status: "CANCELLED_CUSTOMER" });
    await screen.findByRole("heading", { name: "Leak Repair" });
    /* The old mock rendered four advancing steps for every booking, so a
       cancelled one looked like it was still under way. */
    expect(text()).not.toContain(dict.bookingStatus.IN_PROGRESS);
    expect(text()).toContain(dict.bookingStatus.CANCELLED_CUSTOMER);
  });

  it("distinguishes who cancelled", async () => {
    renderDetail({ status: "CANCELLED_PROVIDER" });
    await screen.findByRole("heading", { name: "Leak Repair" });
    expect(text()).toContain(dict.bookingStatus.CANCELLED_PROVIDER);
  });

  it("reports an auto-assigned request as still waiting, not as abandoned", async () => {
    renderDetail({ status: "REQUESTED", providerId: null, isAutoAssign: true });
    await screen.findByRole("heading", { name: "Leak Repair" });
    /* providerId is null until somebody accepts; that is a wait, not a failure. */
    expect(text()).toContain(dict.booking.awaitingAssignment);
  });
});

describe("only actions the API will accept are offered", () => {
  it("offers cancel and reschedule on a scheduled booking", async () => {
    renderDetail({ status: "SCHEDULED" });
    await screen.findByRole("heading", { name: "Leak Repair" });
    expect(screen.getByRole("button", { name: new RegExp(dict.booking.cancelAction) })).toBeDefined();
    expect(text()).toContain(dict.booking.rescheduleAction);
  });

  it("never quotes a cancellation fee, because the API does not apply one", async () => {
    renderDetail({ status: "SCHEDULED" });
    await screen.findByRole("heading", { name: "Leak Repair" });
    fireEvent.click(screen.getByRole("button", { name: new RegExp(dict.booking.cancelAction) }));
    /* FR-BK-06 is not implemented server-side. A figure shown here would be a
       promise of a charge that never happens. */
    expect(text()).toContain(dict.booking.cancelNote);
    expect(text()).not.toContain("Rs 500");
  });

  it("sends the cancellation with no reason when none was typed", async () => {
    const { sent } = renderDetail({ status: "SCHEDULED" });
    await screen.findByRole("heading", { name: "Leak Repair" });
    fireEvent.click(screen.getByRole("button", { name: new RegExp(dict.booking.cancelAction) }));
    fireEvent.click(screen.getByRole("button", { name: new RegExp(dict.booking.confirmCancel) }));

    await waitFor(() => expect(sent.some((call) => call.url.endsWith("/cancel"))).toBe(true));
    /* `bookingCancelSchema` is `.strict()` with an optional reason, so an empty
       string would be a 422 rather than "no reason given". */
    expect(sent.find((call) => call.url.endsWith("/cancel"))?.body).toEqual({});
  });

  it("sends the reason when one was typed", async () => {
    const { sent } = renderDetail({ status: "SCHEDULED" });
    await screen.findByRole("heading", { name: "Leak Repair" });
    fireEvent.click(screen.getByRole("button", { name: new RegExp(dict.booking.cancelAction) }));
    fireEvent.change(screen.getByLabelText(dict.booking.cancelReasonLabel), { target: { value: "Found someone closer" } });
    fireEvent.click(screen.getByRole("button", { name: new RegExp(dict.booking.confirmCancel) }));

    await waitFor(() => expect(sent.some((call) => call.url.endsWith("/cancel"))).toBe(true));
    expect(sent.find((call) => call.url.endsWith("/cancel"))?.body).toEqual({ reason: "Found someone closer" });
  });

  it("offers neither cancel nor reschedule once the work is under way", async () => {
    renderDetail({ status: "IN_PROGRESS" });
    await screen.findByRole("heading", { name: "Leak Repair" });
    /* `cancel` for CUSTOMER ends at SCHEDULED and `reschedule` exists only there,
       so a job under way can be neither cancelled nor moved. */
    expect(screen.queryByRole("button", { name: new RegExp(dict.booking.cancelAction) })).toBeNull();
    expect(text()).not.toContain(dict.booking.rescheduleAction);
    /* And the customer is told that, rather than left wondering where the
       controls went. */
    expect(text()).toContain(dict.booking.noActionsAvailable);
  });

  it("explains a used-up reschedule instead of offering another", async () => {
    renderDetail({ status: "SCHEDULED", rescheduleCount: 1 });
    await screen.findByRole("heading", { name: "Leak Repair" });
    /* FR-BK-05 allows exactly one; `rescheduleCount` on the row is the record. */
    expect(text()).toContain(dict.booking.rescheduleAlreadyUsed);
    expect(text()).not.toContain(dict.booking.rescheduleAction);
  });

  it("says nothing can be changed on a finished booking", async () => {
    renderDetail({ status: "CLOSED" });
    await screen.findByRole("heading", { name: "Leak Repair" });
    expect(text()).toContain(dict.booking.noActionsAvailable);
  });

  it("reports an action that the API refused rather than pretending it worked", { timeout: 15_000 }, async () => {
    /* The booking can move on between the page loading and the click — 409 is the
       correct answer and the customer must be told, not shown a stale success. */
    renderDetail({ status: "SCHEDULED" }, { create: { status: 409, body: problem(409, "ILLEGAL_TRANSITION") } });
    await screen.findByRole("heading", { name: "Leak Repair" });
    fireEvent.click(screen.getByRole("button", { name: new RegExp(dict.booking.cancelAction) }));
    fireEvent.click(screen.getByRole("button", { name: new RegExp(dict.booking.confirmCancel) }));

    await waitFor(() => expect(text()).toContain(dict.booking.actionFailed), { timeout: 5_000 });
    /* Announced to a screen reader, not just painted on. */
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
    /* And the booking is still shown as it was: a refused action does not blank
       the page or invent a new status. */
    expect(text()).toContain("SHM-0000001");
  });
});

describe("the photo allowance matches the server's rule", () => {
  it("offers the uploader only before the visit begins", async () => {
    renderDetail({ status: "REQUESTED" });
    await screen.findByRole("heading", { name: "Leak Repair" });
    expect(text()).toContain(dict.booking.photosTitle);
  });

  it("removes it once the job is under way, because the API would refuse", async () => {
    renderDetail({ status: "IN_PROGRESS" });
    await screen.findByRole("heading", { name: "Leak Repair" });
    /* CUSTOMER_PROBLEM evidence is only accepted in PENDING_PAYMENT, REQUESTED
       and SCHEDULED. A uploader outside that window is a guaranteed 409. */
    expect(text()).not.toContain(dict.booking.photosTitle);
    expect(screen.queryByLabelText(dict.booking.photosChoose)).toBeNull();
  });

  it("states the five-photo limit, which is the server's, not a guess", async () => {
    renderDetail({ status: "REQUESTED" });
    await screen.findByRole("heading", { name: "Leak Repair" });
    expect(text()).toContain("five");
  });
});

describe("the chat", () => {
  it("is offered while a professional is on the job", async () => {
    renderDetail({ status: "SCHEDULED" });
    await screen.findByRole("heading", { name: "Leak Repair" });
    expect(text()).toContain(dict.booking.chatTitle);
  });

  it("is closed with an explanation on a request nobody has accepted", async () => {
    renderDetail({ status: "REQUESTED" });
    await screen.findByRole("heading", { name: "Leak Repair" });
    /* `MessageService` sends 409 on a closed chat, and REQUESTED is closed: there
       is no other party to read it yet. */
    expect(text()).toContain(dict.booking.chatClosed);
    expect(screen.queryByRole("button", { name: new RegExp(dict.booking.chatSend) })).toBeNull();
  });

  it("never asks for a phone number in the composer", async () => {
    renderDetail({ status: "IN_PROGRESS" });
    await screen.findByRole("heading", { name: "Leak Repair" });
    /* Contact details are masked server-side before storage, so the UI states the
       rule rather than implying a number would arrive intact. */
    expect(text()).toContain(dict.booking.chatMaskedNote);
  });
});

describe("a booking that is not the caller's", () => {
  it("is reported as not found, without confirming that it exists", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(problem(404, "NOT_FOUND")), { status: 404, headers: { "content-type": "application/json" } })),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const Component = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    render(<BookingDetail locale={locale} dict={dict} bookingId="b1" />, { wrapper: Component });

    expect(await screen.findByText(dict.portal.bookingNotFoundTitle)).toBeDefined();
    /* getOwned filters on customer_id OR provider_id, so "not yours" and "not
       there" are the same 404. Saying "this is not your booking" would confirm
       that it exists. */
    expect(text()).toContain(dict.portal.bookingNotFoundBody);
  });
});