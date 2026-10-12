import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RevisionCard } from '@/features/booking/revision-card';
import { CustomerBookingDetailScreen } from '@/features/customer/booking-detail-view';
import { getDictionary } from '@/lib/dictionaries';
import type { Locale } from '@/lib/utils';
import type { Booking } from '@/features/booking/api';

const dict = getDictionary('en');
const locale: Locale = 'en';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });

const wrap = ({ children }: { children: ReactNode }) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } }
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

const makeBooking = (over: Partial<Booking> = {}): Booking => ({
  id: 'b-rev-1',
  code: 'SHM-0000018',
  customerId: 'c-1',
  providerId: '00000000-0000-4000-8000-000000000098',
  serviceId: 1,
  addressId: 'a-1',
  status: 'QUOTE_REVISION',
  paymentMode: 'CASH',
  paymentStatus: 'PENDING',
  isEmergency: false,
  isAutoAssign: false,
  scheduledStart: '2026-10-20T04:00:00.000Z',
  scheduledEnd: '2026-10-20T05:30:00.000Z',
  problemText: 'Leak repair',
  quotedAmountPaisa: 100000,
  approvedTotalPaisa: 100000,
  finalAmountPaisa: null,
  discountPaisa: 0,
  rescheduleCount: 0,
  noShowParty: null,
  cancelReason: null,
  startOtpVerifiedAt: null,
  completedAt: null,
  verificationTier: null,
  createdAt: '2026-10-01T09:00:00.000Z',
  updatedAt: '2026-10-01T09:00:00.000Z',
  issueOptionId: null,
  isOnBehalf: false,
  onBehalfName: null,
  ...over
});

describe('Quote Revision Card (RevisionCard)', () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let approveCalled = false;
  let rejectCalled = false;

  beforeEach(() => {
    approveCalled = false;
    rejectCalled = false;

    mockFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();

      if (url.includes('/revisions/approve') && method === 'POST') {
        approveCalled = true;
        return json(makeBooking({ status: 'IN_PROGRESS' }));
      }

      if (url.includes('/revisions/reject') && method === 'POST') {
        rejectCalled = true;
        return json(makeBooking({ status: 'IN_PROGRESS' }));
      }

      if (url.includes('/services')) {
        return json({ items: [{ id: 1, nameEn: 'Leak repair', nameUr: '.leak', slug: 'leak-repair' }] });
      }
      if (url.includes('/evidence')) return json({ items: [] });
      if (url.includes('/on-behalf-contact')) return json({ contact: null });
      if (url.includes('/messages')) return json({ items: [] });
      if (url.includes('/bookings/b-rev-1')) return json(makeBooking());
      if (url.includes('/bookings')) return json({ items: [makeBooking()] });

      throw new Error(`unrouted ${method} ${url}`);
    });
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders nothing when booking status is not QUOTE_REVISION', () => {
    const { container } = render(
      <RevisionCard locale={locale} dict={dict} booking={makeBooking({ status: 'IN_PROGRESS' })} />,
      { wrapper: wrap }
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders title, explainer text, and decision buttons when status is QUOTE_REVISION', () => {
    render(<RevisionCard locale={locale} dict={dict} booking={makeBooking({ status: 'QUOTE_REVISION' })} />, {
      wrapper: wrap
    });

    expect(screen.getByText(dict.booking.revisionTitle)).toBeDefined();
    expect(screen.getByText(dict.booking.revisionText)).toBeDefined();
    expect(screen.getByRole('button', { name: new RegExp(dict.booking.revisionApprove) })).toBeDefined();
    expect(screen.getByRole('button', { name: new RegExp(dict.booking.revisionReject) })).toBeDefined();
  });

  it('calls POST /bookings/:id/revisions/approve when customer approves extra work', async () => {
    render(<RevisionCard locale={locale} dict={dict} booking={makeBooking({ status: 'QUOTE_REVISION' })} />, {
      wrapper: wrap
    });

    const approveBtn = screen.getByRole('button', { name: new RegExp(dict.booking.revisionApprove) });
    fireEvent.click(approveBtn);

    await waitFor(() => {
      expect(approveCalled).toBe(true);
    });
  });

  it('calls POST /bookings/:id/revisions/reject when customer rejects extra work', async () => {
    render(<RevisionCard locale={locale} dict={dict} booking={makeBooking({ status: 'QUOTE_REVISION' })} />, {
      wrapper: wrap
    });

    const rejectBtn = screen.getByRole('button', { name: new RegExp(dict.booking.revisionReject) });
    fireEvent.click(rejectBtn);

    await waitFor(() => {
      expect(rejectCalled).toBe(true);
    });
  });

  it('renders RevisionCard on CustomerBookingDetailScreen when booking is in QUOTE_REVISION', async () => {
    render(<CustomerBookingDetailScreen locale={locale} bookingId="b-rev-1" dict={dict} />, {
      wrapper: wrap
    });

    expect(await screen.findByText(dict.booking.revisionTitle)).toBeDefined();
    expect(screen.getByRole('button', { name: new RegExp(dict.booking.revisionApprove) })).toBeDefined();
    expect(screen.getByRole('button', { name: new RegExp(dict.booking.revisionReject) })).toBeDefined();
  });
});
