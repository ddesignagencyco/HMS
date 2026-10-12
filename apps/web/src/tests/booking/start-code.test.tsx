import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StartCodeCard } from '@/features/booking/start-code-card';
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
  id: 'b-start-1',
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
  scheduledStart: '2026-10-20T04:00:00.000Z',
  scheduledEnd: '2026-10-20T05:30:00.000Z',
  problemText: 'Water leakage',
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
  createdAt: '2026-10-01T09:00:00.000Z',
  updatedAt: '2026-10-01T09:00:00.000Z',
  issueOptionId: null,
  isOnBehalf: false,
  onBehalfName: null,
  canConfirmCashReceived: false,
  ...over
});

describe('Customer start code (StartCodeCard)', () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let codeIssueCount = 0;

  beforeEach(() => {
    codeIssueCount = 0;
    mockFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();

      if (url.includes('/start-code') && method === 'POST') {
        codeIssueCount++;
        const code = codeIssueCount === 1 ? '418273' : '928374';
        return json({ code, expiresInSeconds: 900 });
      }

      if (url.includes('/services')) {
        return json({ items: [{ id: 1, nameEn: 'Leak repair', nameUr: '.leak', slug: 'leak-repair' }] });
      }
      if (url.includes('/evidence')) return json({ items: [] });
      if (url.includes('/on-behalf-contact')) return json({ contact: null });
      if (url.includes('/messages')) return json({ items: [] });
      if (url.includes('/bookings/b-start-1')) return json(makeBooking());
      if (url.includes('/bookings')) return json({ items: [makeBooking()] });

      throw new Error(`unrouted ${method} ${url}`);
    });
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('does NOT fetch or auto-poll the start code on mount', () => {
    render(<StartCodeCard locale={locale} dict={dict} booking={makeBooking({ status: 'SCHEDULED' })} />, {
      wrapper: wrap
    });

    // Label is plainly visible
    expect(screen.getByText(dict.booking.startCodeTitle)).toBeDefined();
    expect(screen.getByText(dict.booking.startCodeDescription)).toBeDefined();

    // Button to show code is visible
    expect(screen.getByRole('button', { name: new RegExp(dict.booking.startCodeShowButton) })).toBeDefined();

    // No start-code call has been made yet
    const startCodeCalls = mockFetch.mock.calls.filter(([url, init]) =>
      String(url).includes('/start-code') && init?.method === 'POST'
    );
    expect(startCodeCalls).toHaveLength(0);
  });

  it('calls POST /bookings/:id/start-code on deliberate tap and displays the 6 digits in large elements', async () => {
    render(<StartCodeCard locale={locale} dict={dict} booking={makeBooking({ status: 'SCHEDULED' })} />, {
      wrapper: wrap
    });

    const showButton = screen.getByRole('button', { name: new RegExp(dict.booking.startCodeShowButton) });
    fireEvent.click(showButton);

    await waitFor(() => {
      expect(screen.getByTestId('start-code-display')).toBeDefined();
    });

    const display = screen.getByTestId('start-code-display');
    expect(display.textContent).toBe('418273');

    // Six separate digit blocks for high contrast visibility
    const digits = display.querySelectorAll('span');
    expect(digits).toHaveLength(6);
    expect(digits[0].textContent).toBe('4');
    expect(digits[5].textContent).toBe('3');

    // Verified endpoint call
    const startCodeCalls = mockFetch.mock.calls.filter(([url, init]) =>
      String(url).includes('/start-code') && init?.method === 'POST'
    );
    expect(startCodeCalls).toHaveLength(1);
    expect(startCodeCalls[0][1]?.body).toBeUndefined(); // Send no body
  });

  it('re-issues a NEW code on tap of "Get new code" and invalidates the previous one', async () => {
    render(<StartCodeCard locale={locale} dict={dict} booking={makeBooking({ status: 'EN_ROUTE' })} />, {
      wrapper: wrap
    });

    // 1. Initial click
    fireEvent.click(screen.getByRole('button', { name: new RegExp(dict.booking.startCodeShowButton) }));
    await waitFor(() => {
      expect(screen.getByTestId('start-code-display').textContent).toBe('418273');
    });

    // Notice about invalidation is displayed
    expect(screen.getByText(dict.booking.startCodeInvalidationWarning)).toBeDefined();

    // 2. Click "Get new code"
    const refreshButton = screen.getByRole('button', { name: new RegExp(dict.booking.startCodeRefreshButton) });
    fireEvent.click(refreshButton);

    await waitFor(() => {
      expect(screen.getByTestId('start-code-display').textContent).toBe('928374');
    });

    expect(screen.getByTestId('start-code-display').textContent).not.toBe('418273');
    expect(codeIssueCount).toBe(2);
  });

  it('supports "Send me an SMS" fallback and notifies the customer', async () => {
    render(<StartCodeCard locale={locale} dict={dict} booking={makeBooking({ status: 'SCHEDULED' })} />, {
      wrapper: wrap
    });

    const smsButton = screen.getByRole('button', { name: new RegExp(dict.booking.startCodeResendSmsButton) });
    fireEvent.click(smsButton);

    await waitFor(() => {
      expect(screen.getByTestId('start-code-display').textContent).toBe('418273');
    });

    expect(screen.getByText(dict.booking.startCodeSmsSent)).toBeDefined();
  });

  it('hides the start code card completely once booking is IN_PROGRESS', () => {
    const { container } = render(
      <StartCodeCard locale={locale} dict={dict} booking={makeBooking({ status: 'IN_PROGRESS' })} />,
      { wrapper: wrap }
    );

    expect(container.firstChild).toBeNull();
    expect(screen.queryByText(dict.booking.startCodeTitle)).toBeNull();
  });

  it('hides the start code card when status is WORK_COMPLETED or later', () => {
    const { container } = render(
      <StartCodeCard locale={locale} dict={dict} booking={makeBooking({ status: 'WORK_COMPLETED' })} />,
      { wrapper: wrap }
    );

    expect(container.firstChild).toBeNull();
  });

  it('displays conflict message when 409 CONFLICT is returned', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/start-code')) {
          return json({ code: 'CONFLICT', detail: 'This job has already been started, so there is no code to show.' }, 409);
        }
        return json({});
      })
    );

    render(<StartCodeCard locale={locale} dict={dict} booking={makeBooking({ status: 'SCHEDULED' })} />, {
      wrapper: wrap
    });

    fireEvent.click(screen.getByRole('button', { name: new RegExp(dict.booking.startCodeShowButton) }));

    await waitFor(() => {
      expect(screen.getByText(dict.booking.startCodeStarted)).toBeDefined();
    });
  });

  it('copies the code to clipboard when "Copy code" is clicked', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: writeTextMock }
    });

    render(<StartCodeCard locale={locale} dict={dict} booking={makeBooking({ status: 'SCHEDULED' })} />, {
      wrapper: wrap
    });

    fireEvent.click(screen.getByRole('button', { name: new RegExp(dict.booking.startCodeShowButton) }));

    await waitFor(() => {
      expect(screen.getByTestId('start-code-display')).toBeDefined();
    });

    const copyBtn = screen.getByRole('button', { name: new RegExp(dict.booking.startCodeCopy) });
    fireEvent.click(copyBtn);

    expect(writeTextMock).toHaveBeenCalledWith('418273');
    await waitFor(() => {
      expect(screen.getByText(dict.booking.startCodeCopied)).toBeDefined();
    });
  });

  it('renders exactly one StartCodeCard on CustomerBookingDetailScreen and none in messages card', async () => {
    render(<CustomerBookingDetailScreen locale={locale} bookingId="b-start-1" dict={dict} />, {
      wrapper: wrap
    });

    const headings = await screen.findAllByRole('heading', { name: dict.booking.startCodeTitle });
    expect(headings).toHaveLength(1);

    const buttons = screen.getAllByRole('button', { name: new RegExp(dict.booking.startCodeShowButton) });
    expect(buttons).toHaveLength(1);
  });
});
