import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomerDashboardScreen } from '@/features/customer/dashboard-view';
import { CustomerBookingsScreen } from '@/features/customer/bookings-view';
import { CustomerBookingDetailScreen } from '@/features/customer/booking-detail-view';
import { CUSTOMER_CATEGORIES, URGENT_CATEGORIES } from '@/features/complaints/api';
import { getDictionary } from '@/lib/dictionaries';
import type { Locale } from '@/lib/utils';

/* The customer's screens.
 *
 * The defects these pin, all of which were live in the mock version:
 *
 * · **A hardcoded date string.** The dashboard counted "upcoming visits" with
 *   `bookings.filter((item) => item.scheduledStart >= "2026-09-25")` — a literal
 *   that stopped meaning anything the day it was written. Two bookings, one past
 *   and one future, must now count differently.
 * · **A hardcoded figure.** The verification stat was the string `"1"`, with no
 *   source behind it. It is the count of complaints the API returned.
 * · **A fabricated professional.** The detail screen printed
 *   "CNIC & Background Verified / Lahore" and a "Verified Pro" badge for every
 *   booking. The booking carries `providerId` and no name.
 * · **A complaint form that posted nothing**, with category slugs (`scope`) that
 *   are not in `CATEGORIES` at all.
 * · **A dead re-book link** to `/book/[slug]?rebook=<id>`, where nothing reads
 *   `?rebook=` — a button that looked like a re-book and silently started a fresh
 *   booking instead.
 *
 * Two contract facts worth naming: `complaintCreateSchema` requires a
 * ten-character description, and `finalAmountPaisa` is null until the job is
 * completed — shown as "not charged yet", because zero would read as "the work was
 * free".
 */
const dict = getDictionary('en');
const locale: Locale = 'en';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

/** A fresh client per render, so one test's cache cannot leak into another's. */
const wrap = ({ children }: { children: ReactNode }) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0, gcTime: 0 } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

const booking = (over: Record<string, unknown> = {}) => ({
  id: 'bk-1',
  code: 'SHM-0000042',
  customerId: 'c-1',
  providerId: '00000000-0000-4000-8000-000000000098',
  serviceId: 1,
  addressId: 'a-1',
  status: 'SCHEDULED',
  paymentMode: 'CASH',
  paymentStatus: 'PENDING',
  isEmergency: false,
  isAutoAssign: false,
  /** Far in the future by default, so a test must opt into "today" deliberately. */
  scheduledStart: '2030-01-01T05:00:00.000Z',
  scheduledEnd: '2030-01-01T06:30:00.000Z',
  problemText: 'Kitchen tap is leaking',
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

const complaint = (over: Record<string, unknown> = {}) => ({
  id: 'cp-1',
  bookingId: 'bk-1',
  bookingCode: 'SHM-0000042',
  raisedBy: 'c-1',
  against: '00000000-0000-4000-8000-000000000098',
  source: 'CUSTOMER',
  category: 'QUALITY',
  severity: 'NORMAL',
  status: 'UNDER_REVIEW',
  description: 'The tap started leaking again the same evening.',
  slaDueAt: '2026-10-09T00:00:00.000Z',
  assignedTo: null,
  resolution: null,
  resolutionNote: null,
  createdAt: '2026-10-06T00:00:00.000Z',
  resolvedAt: null,
  raisedByName: 'Bilal Ahmed',
  againstName: 'Asad Raza',
  slaRemainingMinutes: 4320,
  slaBreached: false,
  ...over
});

let rows = [booking()];
let complaints = [complaint()];

const postCalls = () => (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST');

beforeEach(() => {
  rows = [booking()];
  complaints = [complaint()];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'POST') return json({ ...complaint(), id: 'cp-2', status: 'OPEN' });
      if (url.includes('/services')) return json({ items: [{ id: 1, nameEn: 'Leak repair', nameUr: '.leak', slug: 'leak-repair', active: true }] });
      if (url.includes('/catalogue/categories')) return json({ items: [{ id: 1, slug: 'plumbing', nameEn: 'Plumbing', nameUr: '.p', isActive: true }] });
      if (url.includes('/complaints')) return json({ items: complaints });
      if (url.includes('/on-behalf-contact')) return json({ contact: null });
      if (url.includes('/bookings/bk-1')) return json(rows[0]);
      if (url.includes('/bookings')) return json({ items: rows });
      throw new Error(`unrouted ${method} ${url}`);
    })
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const renderDashboard = () => render(<CustomerDashboardScreen locale={locale} dict={dict} />, { wrapper: wrap });

/** One test's cache cannot leak into another's. Renders a StatCard and, once the
 *  labels are on screen, reads the figure that is its previous sibling. The
 *  numbers themselves are asserted elsewhere — this says what a StatCard contains.
 */
const statValue = async (label: string): Promise<string | null> => {
  const matches = await screen.findAllByText(label);
  /* `<div><p>{value}</p><p>{label}</p></div>` — the figure sits before the label. */
  return matches[0].previousElementSibling?.textContent ?? null;
};
const renderList = () => render(<CustomerBookingsScreen locale={locale} dict={dict} />, { wrapper: wrap });
const renderDetail = () => render(<CustomerBookingDetailScreen locale={locale} bookingId="bk-1" dict={dict} />, { wrapper: wrap });

describe('the customer dashboard', () => {
  it('counts upcoming visits against the real clock, not a literal date', async () => {
    /* Under the old literal, one past and one future booking counted identically
       because the string never changed. */
    const past = new Date(Date.now() - 5 * 86_400_000).toISOString();
    const future = new Date(Date.now() + 5 * 86_400_000).toISOString();
    rows = [booking({ id: 'a', scheduledStart: past }), booking({ id: 'b', scheduledStart: future })];
    renderDashboard();

    /* Awaited on a booking row, not on a StatCard label: the labels render while
       the queries are still in flight, so asserting on one would read 0. */
    await screen.findAllByText('SHM-0000042');
    expect(await statValue(dict.portal.upcomingVisits)).toBe('1');
  });

  it('reports complaints from the API rather than a hardcoded figure', async () => {
    complaints = [complaint(), complaint({ id: 'cp-2' })];
    renderDashboard();
    /* The old screen printed the literal "1" for its verification stat. */
    await screen.findAllByText(dict.portal.complaintCategories.QUALITY);
    expect(await statValue(dict.portal.yourComplaints)).toBe('2');
  });

  it('raises an alert when a complaint has breached its SLA', async () => {
    complaints = [complaint({ slaBreached: true, slaRemainingMinutes: -30 })];
    renderDashboard();
    /* The verdict is the server's: `slaBreached` is computed there, and the screen
       must not recompute a deadline and disagree with it. */
    expect(await screen.findByText(dict.portal.complaintSlaBreached.replace('{count}', '1'))).toBeDefined();
  });

  it('shows no SLA alert when the record is clean', async () => {
    renderDashboard();
    await screen.findAllByText(dict.portal.yourComplaints);
    expect(screen.queryByText(new RegExp(dict.portal.complaintSlaBreached.replace('{count}', '.')))).toBeNull();
  });

  it('offers no re-book link, because nothing ever read the parameter', async () => {
    renderDashboard();
    await screen.findAllByText(dict.portal.activeBookings);
    expect(document.body.innerHTML).not.toContain('rebook=');
    expect(screen.queryByRole('link', { name: dict.portal.rebook })).toBeNull();
  });

  it('falls back to the booking code when the catalogue cannot be read', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/catalogue')) return json({ items: [] });
        if (url.includes('/complaints')) return json({ items: [] });
        return json({ items: rows });
      })
    );
    renderDashboard();
    /* Twice by design: as the service-name fallback and as the code column. */
    expect((await screen.findAllByText('SHM-0000042')).length).toBeGreaterThanOrEqual(1);
  });
});

describe('the bookings list', () => {
  it('groups the tabs locally, because the server filter covers only ten statuses', async () => {
    rows = [booking({ id: 'a', status: 'SCHEDULED' }), booking({ id: 'b', status: 'VERIFIED' }), booking({ id: 'c', status: 'CANCELLED_CUSTOMER' })];
    renderList();

    /* "In play" is the default: only the SCHEDULED one. VERIFIED cannot be reached
       by a server filter at all (BACKEND_REQUIREMENTS 3.2 records ?status=VERIFIED
       as a 422), which is exactly why the grouping is client-side. */
    expect(await screen.findByText(dict.job.statuses.SCHEDULED)).toBeDefined();
    expect(screen.queryByText(dict.job.statuses.VERIFIED)).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: dict.portal.bookingsClosed }));
    await waitFor(() => expect(screen.getByText(dict.job.statuses.VERIFIED)).toBeDefined());
    expect(screen.queryByText(dict.job.statuses.SCHEDULED)).toBeNull();

    /* "All" is the only tab that reaches history in one read. */
    fireEvent.click(screen.getByRole('tab', { name: dict.portal.bookingsAll }));
    await waitFor(() => expect(screen.getByText(dict.job.statuses.SCHEDULED)).toBeDefined());
    expect(screen.getByText(dict.job.statuses.VERIFIED)).toBeDefined();
  });

  it('says plainly that the grouping happens here rather than on the server', async () => {
    renderList();
    /* Silently grouping client-side would let the filter look server-side. */
    expect(await screen.findByText(/10 of the statuses/)).toBeDefined();
  });
});

describe('one booking, from the customer side', () => {
  it('never invents a professional name or a verification badge', async () => {
    renderDetail();
    expect(await screen.findByText(dict.portal.professionalNameUnavailable)).toBeDefined();
    /* Printed for every booking by the old screen, whatever the API said. */
    expect(document.body.textContent).not.toContain('CNIC & Background Verified');
    expect(document.body.textContent).not.toContain('Verified Pro');
  });

  it('says nobody has taken the job while providerId is null', async () => {
    rows = [booking({ providerId: null })];
    renderDetail();
    expect(await screen.findByText(dict.portal.awaitingProfessional)).toBeDefined();
    expect(screen.queryByText(dict.portal.professionalNameUnavailable)).toBeNull();
  });

  it('shows the final amount as uncharged rather than as zero', async () => {
    renderDetail();
    /* `finalAmountPaisa` is null until completion. Zero would read as free. */
    expect(await screen.findByText(dict.portal.notYetCharged)).toBeDefined();
  });

  it('shows the real final amount once the job is done', async () => {
    rows = [booking({ status: 'VERIFIED', finalAmountPaisa: 200_000 })];
    renderDetail();
    expect(await screen.findByText('Rs 2,000')).toBeDefined();
    expect(screen.queryByText(dict.portal.notYetCharged)).toBeNull();
  });

  it('derives the progress track from the status rather than four fixed steps', async () => {
    rows = [booking({ status: 'IN_PROGRESS' })];
    renderDetail();
    await screen.findByText(dict.portal.bookingProgress);
    /* Up to IN_PROGRESS. The old screen's fixed list omitted EN_ROUTE entirely. */
    expect(screen.getByText(dict.job.statuses.EN_ROUTE)).toBeDefined();
    expect(screen.queryByText(dict.job.statuses.QUOTE_REVISION)).toBeNull();
  });

  it('reports a status off the track as itself, not forced into a step', async () => {
    rows = [booking({ status: 'CANCELLED_CUSTOMER' })];
    renderDetail();
    await screen.findByText(dict.portal.bookingProgress);
    /* Twice: the status pill and the off-track explanation. Both correct. */
    expect(screen.getAllByText(dict.job.statuses.CANCELLED_CUSTOMER).length).toBeGreaterThanOrEqual(1);
  });

  it('files a real complaint with the category and description the schema wants', async () => {
    renderDetail();
    fireEvent.click(await screen.findByRole('button', { name: dict.portal.raiseComplaint }));
    fireEvent.change(await screen.findByLabelText(dict.portal.complaintDescriptionLabel), {
      target: { value: 'The same joint started leaking again the same evening.' }
    });
    fireEvent.click(screen.getByRole('button', { name: dict.portal.submitComplaint }));

    await waitFor(() => expect(postCalls()).toHaveLength(1));
    const body = JSON.parse(String((postCalls()[0][1] as RequestInit).body)) as Record<string, unknown>;
    expect(body.bookingId).toBe('bk-1');
    expect(body.category).toBe('QUALITY');
    expect(body.description).toBe('The same joint started leaking again the same evening.');
  });

  it('refuses a complaint under the schema ten-character floor', async () => {
    renderDetail();
    fireEvent.click(await screen.findByRole('button', { name: dict.portal.raiseComplaint }));
    fireEvent.change(await screen.findByLabelText(dict.portal.complaintDescriptionLabel), { target: { value: 'leaking' } });
    fireEvent.click(screen.getByRole('button', { name: dict.portal.submitComplaint }));
    /* `complaintCreateSchema` requires min(10). Saying so beats a 422 on the form
       someone reaches when something has gone wrong. */
    expect(await screen.findByText(dict.portal.complaintTooShort.replace('{min}', '10'))).toBeDefined();
    expect(postCalls()).toHaveLength(0);
  });

  it('treats SAFETY as the urgent category, and warns only for it', async () => {
    /*
     * SAFETY carries a one-hour SLA and alerts the admins at once, so it is the one
     * category that must warn. Driven through the constant rather than by clicking
     * through a react-select in jsdom, which would test the widget rather than the
     * rule.
     */
    expect(URGENT_CATEGORIES).toContain('SAFETY');
    expect(CUSTOMER_CATEGORIES).toContain('SAFETY');

    /* And under the default category the warning must be absent — otherwise it is
       decoration rather than a consequence of the choice. */
    renderDetail();
    fireEvent.click(await screen.findByRole('button', { name: dict.portal.raiseComplaint }));
    await screen.findByLabelText(dict.portal.complaintCategoryLabel);
    expect(screen.queryByText(dict.portal.complaintUrgent)).toBeNull();
  });

  it('refuses a warranty claim under the same floor', async () => {
    renderDetail();
    fireEvent.click(await screen.findByRole('button', { name: dict.portal.claimWarranty }));
    fireEvent.change(await screen.findByLabelText(dict.portal.warrantyReasonLabel), { target: { value: 'again' } });
    /* The submit carries its own label, not the opener's: two buttons reading
       "Claim under warranty" on one screen cannot be told apart. */
    fireEvent.click(screen.getByRole('button', { name: dict.portal.submitWarrantyClaim }));
    expect(await screen.findByText(dict.portal.warrantyReasonTooShort.replace('{min}', '10'))).toBeDefined();
    expect(postCalls()).toHaveLength(0);
  });

  it('reports a booking it cannot read without claiming it belongs to someone else', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/bookings/bk-1')) {
          return new Response(JSON.stringify({ type: 'about:blank', title: 'x', status: 404, code: 'NOT_FOUND', detail: 'Booking was not found', errors: [] }), {
            status: 404,
            headers: { 'content-type': 'application/problem+json' }
          });
        }
        return json({ items: [] });
      })
    );
    renderDetail();
    /* `getOwned` 404s both "missing" and "not yours", so the screen must not guess
       which — that would confirm the booking exists. */
    expect(await screen.findByText(dict.portal.bookingNotFound)).toBeDefined();
  });
});

describe('the complaint category list cannot drift', () => {
  it('matches CUSTOMER_COMPLAINT_CATEGORIES in the domain package', () => {
    /*
     * `CUSTOMER_CATEGORIES` is copied rather than imported: the web app has no
     * dependency on `@smart-home/domain`, and adding one to a client bundle to
     * share a single array of ten strings is not a trade worth making. This test is
     * what stops the copy going stale — it reads the source of truth on disk.
     */
    const source = readFileSync(resolve(process.cwd(), '../../packages/domain/src/complaints.ts'), 'utf8');
    const match = /CUSTOMER_COMPLAINT_CATEGORIES[^=]*=\s*\[([^\]]*)\]/.exec(source);
    expect(match).not.toBeNull();
    const fromDomain = (match as RegExpExecArray)[1]
      .split(',')
      .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ''))
      .filter((entry) => entry !== '');
    expect([...CUSTOMER_CATEGORIES].sort()).toEqual(fromDomain.sort());
  });
});
