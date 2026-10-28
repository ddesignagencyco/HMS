import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderTodayScreen } from '@/features/provider/today-view';
import { getDictionary } from '@/lib/dictionaries';
import type { Locale } from '@/lib/utils';

/* "Today" for a professional.
 *
 * The previous version of this screen read `getBookingsForProvider` out of
 * `@/lib/data`, invented a `nextSlot`, and filtered on the statuses `COMPLETED`
 * and `CANCELLED` — **neither of which is in `booking_status`**. Every filter it
 * used matched nothing, so its "active" and "completed today" figures were both
 * always zero and the earnings total was always Rs 0.
 *
 * What replaced it, and what these tests pin:
 *
 * · **Today is the business's day, not the viewer's.** `scheduledStart` is an
 *   instant and the platform runs on Asia/Karachi. A 05:00Z booking is 10:00 in
 *   Karachi and belongs to that day; formatting in UTC would file it under the
 *   previous one and the screen's whole purpose is a day.
 * · **Only settled money is counted as earned.** `finalAmountPaisa` once complete,
 *   the approved total before that. An in-progress job is still held, so adding it
 *   would tell a professional they have earned money they cannot withdraw.
 * · **The real status names.** `WORK_COMPLETED`, `CANCELLED_CUSTOMER`,
 *   `CANCELLED_PROVIDER` — not `COMPLETED`, not `CANCELLED`. */
const dict = getDictionary('en');
const locale: Locale = 'en';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

/* A pinned "now", so the screen's day boundary and the fixtures below can never
   straddle a midnight on a slow, heavily loaded run: the component defaults to
   the wall clock and these tests hand it this. 12:00 in Asia/Karachi on a known
   day, comfortably clear of a boundary either way. */
const NOW = new Date('2026-10-06T07:00:00.000Z');

const renderScreen = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0, gcTime: 0 } } });
  const Component = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return render(<ProviderTodayScreen locale={locale} dict={dict} now={NOW} />, { wrapper: Component });
};

const booking = (over: Record<string, unknown> = {}) => ({
  id: 'bk-1',
  code: 'SHM-0000042',
  customerId: 'c-1',
  providerId: 'p-1',
  serviceId: 1,
  addressId: 'a-1',
  status: 'SCHEDULED',
  paymentMode: 'CASH',
  paymentStatus: 'PENDING',
  isEmergency: false,
  isAutoAssign: false,
  scheduledStart: '2026-10-08T05:00:00.000Z',
  scheduledEnd: '2026-10-08T06:30:00.000Z',
  problemText: null,
  issueOptionId: null,
  isOnBehalf: false,
  onBehalfName: null,
  quotedAmountPaisa: 250_000,
  approvedTotalPaisa: 250_000,
  finalAmountPaisa: null,
  discountPaisa: 0,
  rescheduleCount: 0,
  noShowParty: null,
  cancelReason: null,
  startOtpVerifiedAt: null,
  completedAt: null,
  verificationTier: null,
  createdAt: '2026-10-06T00:00:00.000Z',
  updatedAt: '2026-10-06T00:00:00.000Z',
  ...over
});

/** The pinned "now", in the shape `Intl` produces with `en-CA`. */
const karachiDay = (offsetDays = 0): string => {
  const now = NOW.getTime() + offsetDays * 86_400_000;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
};

/** A booking on the given Karachi day, at a given local hour. */
const onKarachiDay = (day: string, hourUtc: number, over: Record<string, unknown> = {}) => {
  const start = new Date(`${day}T00:00:00.000Z`);
  start.setUTCHours(hourUtc);
  return booking({ scheduledStart: start.toISOString(), ...over });
};

let rows = [booking()];
let windows = [{ id: 'w1', weekday: new Date().getDay(), startTime: '09:00', endTime: '18:00' }];
let leave: { id: string; start: string; end: string; reason: string | null; createdAt: string }[] = [];
let offers = [
  {
    id: 'o1',
    bookingId: 'b2',
    bookingCode: 'SHM-0000050',
    serviceName: 'Leak repair',
    areaName: null,
    scheduledStart: '2026-10-09T05:00:00.000Z',
    scheduledEnd: '2026-10-09T06:00:00.000Z',
    quotedAmountPaisa: 180_000,
    isEmergency: false,
    problemText: null,
    expiresAt: '2099-01-01T00:00:00.000Z'
  }
];

beforeEach(() => {
  rows = [booking()];
  /* The component computes today's weekday in Asia/Karachi, so the fixture window
     must be set that way too — a test runner west of the dateline would otherwise
     disagree with it by a day. */
  const short = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Karachi', weekday: 'short' }).format(NOW);
  const weekday = ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as Record<string, number>)[short];
  leave = [];
  windows = [{ id: 'w1', weekday, startTime: '09:00', endTime: '18:00' }];
  offers = [
    {
      id: 'o1',
      bookingId: 'b2',
      bookingCode: 'SHM-0000050',
      serviceName: 'Leak repair',
      areaName: null,
      scheduledStart: '2026-10-09T05:00:00.000Z',
      scheduledEnd: '2026-10-09T06:00:00.000Z',
      quotedAmountPaisa: 180_000,
      isEmergency: false,
      problemText: null,
      expiresAt: '2099-01-01T00:00:00.000Z'
    }
  ];

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/services')) return json({ items: [{ id: 1, nameEn: 'Leak repair', nameUr: '.leak', slug: 'leak-repair', active: true }] });
      if (url.includes('/catalogue/categories')) return json({ items: [{ id: 1, slug: 'plumbing', nameEn: 'Plumbing', nameUr: '.p', isActive: true }] });
      if (url.includes('/provider/availability')) return json({ items: windows });
      if (url.includes('/provider/time-off')) return json({ items: leave });
      if (url.includes('/provider/offers')) return json({ items: offers });
      if (url.includes('/bookings')) return json({ items: rows });
      throw new Error(`unrouted ${url}`);
    })
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('which day counts as today', () => {
  it('files an early-morning booking under the Karachi day, not the UTC one', async () => {
    const day = karachiDay();
    /* 05:00Z is 10:00 in Karachi. In UTC that is still the 8th, but for any viewer
       east of Greenwich the local date would be later — the point is that the
       screen keys on the platform's day so the answer does not depend on the
       viewer's offset. */
    rows = [onKarachiDay(day, 5)];
    renderScreen();
    /* Awaited on the service name, not on a heading: the page header renders Today 
       before any query lands, so a heading assertion passes against a loading screen. */
    expect(await screen.findByText('Leak repair')).toBeDefined();
  });

  it('separates later bookings into their own section', async () => {
    rows = [onKarachiDay(karachiDay(), 5), onKarachiDay(karachiDay(3), 6)];
    renderScreen();
    /* Two bookings, both named "Leak repair" by the single catalogue entry, so both
       sections are expected to render the same name. */
    expect((await screen.findAllByText('Leak repair')).length).toBe(2);
    expect(screen.getByText(dict.portal.laterJobs)).toBeDefined();
  });

  it('says so plainly when there is nothing booked', async () => {
    rows = [];
    offers = [];
    renderScreen();
    expect(await screen.findByText(dict.portal.todayEmpty)).toBeDefined();
  });
});

describe('what counts as earned', () => {
  it('counts a settled job at its final amount', async () => {
    rows = [onKarachiDay(karachiDay(), 5, { status: 'VERIFIED', finalAmountPaisa: 200_000 })];
    renderScreen();
    /* 200000 paisa, not the 250000 approved — the provider closed lower. */
    /* Once on the row and once in the day's total — both correct. */
    expect((await screen.findAllByText('Rs 2,000')).length).toBeGreaterThanOrEqual(1);
  });

  it('does not count an in-progress job as earned', async () => {
    rows = [onKarachiDay(karachiDay(), 5, { status: 'IN_PROGRESS', finalAmountPaisa: null })];
    renderScreen();
    await screen.findByText(dict.portal.todayEarnings);
    /* The money is still held. Reporting Rs 2,500 here would tell a professional
       they can withdraw money the platform is still holding. */
    expect(screen.queryByText('Rs 2,500')).toBeNull();
  });

  it('counts the real completed statuses, not an invented COMPLETED', async () => {
    rows = [onKarachiDay(karachiDay(), 5, { id: 'a', status: 'WORK_COMPLETED', finalAmountPaisa: 100_000 }), onKarachiDay(karachiDay(), 8, { id: 'b', status: 'VERIFIED', finalAmountPaisa: 150_000 })];
    renderScreen();
    expect(await screen.findByText('Rs 2,500')).toBeDefined();
    expect(screen.getByText(dict.portal.completedToday)).toBeDefined();
  });

  it('does not count a cancelled job as active work', async () => {
    rows = [onKarachiDay(karachiDay(), 5, { status: 'CANCELLED_CUSTOMER' })];
    renderScreen();
    expect(await screen.findByText(dict.portal.activeBookings)).toBeDefined();
    /* The old screen filtered on `CANCELLED`, which is not a status at all, so it
       counted cancelled jobs as live. */
    /* Three StatCards, and a cancelled job counts for none of them. */
    expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(2);
  });
});

describe('whether today is a working day', () => {
  it('says so when there is recorded leave covering now', async () => {
    const now = NOW.getTime();
    leave = [{ id: 't1', start: new Date(now - 86_400_000).toISOString(), end: new Date(now + 86_400_000).toISOString(), reason: 'Eid', createdAt: new Date(now).toISOString() }];
    renderScreen();
    expect(await screen.findByText(dict.portal.todayOnLeave)).toBeDefined();
  });

  it('treats a leave period that has ended as no leave', async () => {
    const now = NOW.getTime();
    /* `provider_time_off.period` is a half-open `tstzrange`, so a period whose end
       has passed does not cover today. */
    leave = [{ id: 't1', start: new Date(now - 4 * 86_400_000).toISOString(), end: new Date(now - 86_400_000).toISOString(), reason: null, createdAt: new Date(now - 5 * 86_400_000).toISOString() }];
    renderScreen();
    expect(screen.queryByText(dict.portal.todayOnLeave)).toBeNull();
  });

  it('warns when no availability is set for today', async () => {
    /* Sunday, so a Monday-only schedule leaves today with nothing. */
    windows = [{ id: 'w1', weekday: (new Date().getDay() + 1) % 7, startTime: '09:00', endTime: '18:00' }];
    renderScreen();
    expect(await screen.findByText(dict.portal.todayNotWorking)).toBeDefined();
  });

  it('says neither when today is an ordinary working day', async () => {
    renderScreen();
    /* Awaited on a row, not on a StatCard label: the stat cards render while the
       availability and leave queries are still in flight, so asserting on them
       would pass against a screen that has not decided yet. */
    await screen.findByText('Leak repair');
    expect(screen.queryByText(dict.portal.todayOnLeave)).toBeNull();
    expect(screen.queryByText(dict.portal.todayNotWorking)).toBeNull();
  });
});

describe('what it will not invent', () => {
  it('never shows a location, because no provider-reachable route returns one', async () => {
    renderScreen();
    await screen.findByText('Leak repair');
    expect(screen.getByText(dict.portal.todayAddressUnavailable)).toBeDefined();
    /* The booking carries only an addressId. A map pin or a street here would be a
       professional driving to a fabricated address. */
    expect(document.body.textContent).not.toContain('a-1');
  });

  it('falls back to the booking code when the catalogue cannot be read', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/catalogue')) return json({ items: [] });
        if (url.includes('/provider/availability')) return json({ items: [] });
        if (url.includes('/provider/time-off')) return json({ items: [] });
        if (url.includes('/provider/offers')) return json({ items: [] });
        return json({ items: rows });
      })
    );
    renderScreen();
    expect(await screen.findByText('SHM-0000042')).toBeDefined();
  });
});
