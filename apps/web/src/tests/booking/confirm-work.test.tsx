import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Booking } from '@/features/booking/api';
import { ConfirmWorkSection } from '@/features/verification/confirm-work-card';
import type { SelfConfirmationForm } from '@/features/verification/api';
import { getDictionary } from '@/lib/dictionaries';

/* FR-VC-16 — the customer's own "confirm the work" form. Each case maps to an
   item in the definition of done in DIRECTION_FRONTEND_CONFIRM_THE_WORK.md §9. */

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/en/account/bookings/b-1',
  useSearchParams: () => new URLSearchParams()
}));

const dict = getDictionary('en');
const t = dict.confirmWork;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const problem = (status: number, code: string, detail: string, errors: { path: string; code: string; message: string }[] = []) =>
  json({ type: 'about:blank', title: 'x', status, code, detail, errors }, status);

const makeBooking = (over: Partial<Booking> = {}): Booking => ({
  id: 'b-1',
  code: 'SHM-0000042',
  customerId: 'c-1',
  providerId: 'p-1',
  serviceId: 1,
  addressId: 'a-1',
  status: 'AWAITING_VERIFICATION',
  paymentMode: 'ONLINE',
  paymentStatus: 'HELD',
  isEmergency: false,
  isAutoAssign: false,
  scheduledStart: '2026-10-12T04:00:00.000Z',
  scheduledEnd: '2026-10-12T05:30:00.000Z',
  problemText: null,
  issueOptionId: null,
  isOnBehalf: false,
  onBehalfName: null,
  quotedAmountPaisa: 350000,
  approvedTotalPaisa: 350000,
  finalAmountPaisa: 350000,
  discountPaisa: 0,
  rescheduleCount: 0,
  noShowParty: null,
  cancelReason: null,
  startOtpVerifiedAt: '2026-10-12T04:05:00.000Z',
  completedAt: '2026-10-12T05:20:00.000Z',
  verificationTier: 'A',
  createdAt: '2026-10-01T09:00:00.000Z',
  updatedAt: '2026-10-12T05:20:00.000Z',
  canConfirmCashReceived: false,
  canSelfVerify: true,
  ...over
});

const makeForm = (over: Partial<SelfConfirmationForm> = {}): SelfConfirmationForm => ({
  bookingCode: 'SHM-0000042',
  serviceName: 'Leak repair',
  providerFirstName: 'Bilal',
  paymentMode: 'ONLINE',
  amountPaisa: 350000,
  canSubmit: true,
  blockedReason: null,
  questions: [
    { key: 'workCompleted', label: 'Was the work completed?', answers: ['FULL', 'PARTIAL', 'NONE'] },
    { key: 'ratings', label: 'Rate the quality, punctuality, conduct and cleanliness, 1 to 5 each' },
    { key: 'extraChargeDemanded', label: 'Did the provider ask for any money beyond the agreed price?', answers: [true, false] },
    { key: 'choice', label: 'How would you like to leave this?', answers: ['SATISFIED', 'WITH_ISSUE', 'NOT_ACCEPTABLE'] }
  ],
  ...over
});

let fetchMock: ReturnType<typeof vi.fn>;
let getCount = 0;
let posted: Record<string, unknown> | null = null;

/** Routes the two confirmation calls; anything else is a test bug. */
const serve = (handlers: { get?: () => Response; post?: (body: Record<string, unknown>) => Response }) => {
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    if (url.includes('/verification/confirmation') && method === 'GET') {
      getCount += 1;
      return handlers.get?.() ?? json(makeForm());
    }
    if (url.includes('/verification/confirmation') && method === 'POST') {
      posted = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return handlers.post?.(posted) ?? problem(500, 'INTERNAL_ERROR', 'unhandled');
    }
    return json({});
  });
  vi.stubGlobal('fetch', fetchMock);
};

const renderSection = (booking: Booking = makeBooking(), onRaiseComplaint = vi.fn()) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  const wrap = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  render(<ConfirmWorkSection locale="en" dict={dict} booking={booking} onRaiseComplaint={onRaiseComplaint} />, { wrapper: wrap });
  return { onRaiseComplaint };
};

const rate = (score: number) => {
  for (const label of [t.quality, t.punctuality, t.conduct, t.cleanliness]) {
    fireEvent.click(within(screen.getByRole('group', { name: label })).getByRole('radio', { name: new RegExp(`^${score} `) }));
  }
};

const fillHappyPath = async () => {
  await screen.findByRole('radio', { name: t.workFULL });
  fireEvent.click(screen.getByRole('radio', { name: t.workFULL }));
  rate(5);
  fireEvent.click(within(screen.getByRole('group', { name: t.extraLegend })).getByRole('radio', { name: dict.common.no }));
  fireEvent.click(screen.getByRole('radio', { name: new RegExp(t.choiceSATISFIED) }));
};

beforeEach(() => {
  getCount = 0;
  posted = null;
  replace.mockReset();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ConfirmWorkSection', () => {
  it('is absent when the booking cannot be self-verified, and asks the API nothing', () => {
    serve({});
    renderSection(makeBooking({ canSelfVerify: false, status: 'PAYMENT_RELEASED' }));
    expect(screen.queryByText(t.title)).toBeNull();
    expect(getCount).toBe(0);
  });

  it('renders the blocked reason as information — no button, nothing styled as an error', async () => {
    serve({ get: () => json(makeForm({ canSubmit: false, blockedReason: 'One of our team is calling you about this job right now.' })) });
    renderSection();
    expect(await screen.findByText('One of our team is calling you about this job right now.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: t.submitRelease })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('"no work was done" forces the problem path and takes the consent away', async () => {
    serve({});
    renderSection();
    await screen.findByRole('radio', { name: t.workFULL });

    fireEvent.click(screen.getByRole('radio', { name: new RegExp(t.choiceSATISFIED) }));
    expect(screen.getByRole('checkbox')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox'));

    fireEvent.click(screen.getByRole('radio', { name: t.workNONE }));
    expect(screen.getByText(t.forcedNoWork)).toBeTruthy();
    expect((screen.getByRole('radio', { name: new RegExp(t.choiceNOT_ACCEPTABLE) }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('radio', { name: new RegExp(t.choiceSATISFIED) }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByRole('button', { name: t.submitEscalate })).toBeTruthy();

    /* Changing their mind does not bring the consent back already ticked. */
    fireEvent.click(screen.getByRole('radio', { name: t.workFULL }));
    fireEvent.click(screen.getByRole('radio', { name: new RegExp(t.choiceSATISFIED) }));
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
  });

  it('an extra charge forces the problem path too', async () => {
    serve({});
    renderSection();
    await screen.findByRole('radio', { name: t.workFULL });
    fireEvent.click(within(screen.getByRole('group', { name: t.extraLegend })).getByRole('radio', { name: dict.common.yes }));
    expect(screen.getByText(t.forcedExtraCharge)).toBeTruthy();
    expect((screen.getByRole('radio', { name: new RegExp(t.choiceWITH_ISSUE) }) as HTMLInputElement).disabled).toBe(true);
  });

  it('requires all four ratings even on the "not acceptable" path, before anything is sent', async () => {
    serve({});
    renderSection();
    await screen.findByRole('radio', { name: t.workFULL });
    fireEvent.click(screen.getByRole('radio', { name: t.workPARTIAL }));
    fireEvent.click(within(screen.getByRole('group', { name: t.extraLegend })).getByRole('radio', { name: dict.common.no }));
    fireEvent.click(screen.getByRole('radio', { name: new RegExp(t.choiceNOT_ACCEPTABLE) }));
    fireEvent.click(screen.getByRole('button', { name: t.submitEscalate }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getAllByText(t.required.ratings)).toHaveLength(4);
    expect(posted).toBeNull();
  });

  it('will not release without its own explicit tick', async () => {
    serve({});
    renderSection();
    await fillHappyPath();
    fireEvent.click(screen.getByRole('button', { name: t.submitRelease }));
    expect(await screen.findByText(t.required.consentToRelease)).toBeTruthy();
    expect(posted).toBeNull();
  });

  it('CONFIRMED: sends exactly the documented body and renders the message verbatim with the rating', async () => {
    const message = 'Thank you. The payment has been released to the provider and your rating has been published.';
    serve({
      post: () =>
        json({ outcome: 'CONFIRMED', bookingId: 'b-1', bookingStatus: 'PAYMENT_RELEASED', message, booking: makeBooking({ status: 'PAYMENT_RELEASED', canSelfVerify: false, paymentStatus: 'RELEASED' }) })
    });
    renderSection();
    await fillHappyPath();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.change(screen.getByLabelText(t.remarkLabel), { target: { value: '  Sorted it first time.  ' } });
    fireEvent.click(screen.getByRole('button', { name: t.submitRelease }));

    expect(await screen.findByText(message)).toBeTruthy();
    expect(posted).toEqual({
      workCompleted: 'FULL',
      quality: 5,
      punctuality: 5,
      conduct: 5,
      cleanliness: 5,
      extraChargeDemanded: false,
      consentToRelease: true,
      outcome: 'SATISFIED',
      remark: 'Sorted it first time.'
    });
    expect(screen.getByText(t.yourRating)).toBeTruthy();
    expect(screen.getByText('Sorted it first time.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: t.submitRelease })).toBeNull();
  });

  it('a cash job never shows a "paid" state from this response', async () => {
    const message = 'Thank you. The provider can now collect the payment from you, and they have been notified.';
    serve({
      get: () => json(makeForm({ paymentMode: 'CASH' })),
      post: () =>
        json({ outcome: 'CONFIRMED', bookingId: 'b-1', bookingStatus: 'VERIFIED', message, booking: makeBooking({ paymentMode: 'CASH', status: 'VERIFIED', canSelfVerify: false, canConfirmCashReceived: true, paymentStatus: 'CASH_DUE' }) })
    });
    renderSection(makeBooking({ paymentMode: 'CASH', paymentStatus: 'CASH_DUE' }));
    await fillHappyPath();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: t.submitCash }));

    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.getByText(t.doneCashTitle)).toBeTruthy();
    expect(screen.getByText(t.cashNextStep)).toBeTruthy();
  });

  it('ESCALATED is reassurance: the message, the money still held, no retry, a complaint offered', async () => {
    const message = 'Nothing has been released. One of our team will call you about this — your money stays with us until the job is settled.';
    serve({ post: () => json({ outcome: 'ESCALATED', bookingId: 'b-1', bookingStatus: 'AWAITING_VERIFICATION', message, booking: makeBooking() }) });
    const { onRaiseComplaint } = renderSection();
    await screen.findByRole('radio', { name: t.workFULL });
    fireEvent.click(screen.getByRole('radio', { name: t.workPARTIAL }));
    rate(2);
    fireEvent.click(within(screen.getByRole('group', { name: t.extraLegend })).getByRole('radio', { name: dict.common.no }));
    fireEvent.click(screen.getByRole('radio', { name: new RegExp(t.choiceNOT_ACCEPTABLE) }));
    fireEvent.click(screen.getByRole('button', { name: t.submitEscalate }));

    expect(await screen.findByText(message)).toBeTruthy();
    expect(posted?.consentToRelease).toBe(false);
    expect(screen.getByText(t.escalatedTitle)).toBeTruthy();
    expect(screen.getByText(/still held by us/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: t.submitEscalate })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: t.raiseComplaint }));
    expect(onRaiseComplaint).toHaveBeenCalledTimes(1);
  });

  it('remembers an escalation, so the single-use form is not offered again on return', async () => {
    window.localStorage.setItem('shm.confirmWork.escalated.b-1', JSON.stringify({ message: 'Nothing has been released.', amountPaisa: 350000, paymentMode: 'ONLINE' }));
    serve({});
    renderSection();
    expect(await screen.findByText('Nothing has been released.')).toBeTruthy();
    expect(screen.queryByRole('radio', { name: t.workFULL })).toBeNull();
    expect(getCount).toBe(0);
  });

  it('maps a 422 to the field the API names', async () => {
    serve({ post: () => problem(422, 'VALIDATION_FAILED', 'This cannot be submitted as it stands', [{ path: 'workCompleted', code: 'invalid', message: 'If no work was done, this must be raised as a problem rather than confirmed' }]) });
    renderSection();
    await fillHappyPath();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: t.submitRelease }));
    expect(await screen.findByText('If no work was done, this must be raised as a problem rather than confirmed')).toBeTruthy();
    expect(screen.getByRole('group', { name: t.workLegend }).getAttribute('aria-invalid')).toBe('true');
  });

  it('a 409 shows the detail verbatim and re-reads the form rather than retrying', async () => {
    let calls = 0;
    serve({
      get: () => {
        calls += 1;
        return json(calls === 1 ? makeForm() : makeForm({ canSubmit: false, blockedReason: 'One of our team is calling you about this job right now.' }));
      },
      post: () => problem(409, 'CONFLICT', 'One of our team is calling you about this job right now')
    });
    renderSection();
    await fillHappyPath();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: t.submitRelease }));

    expect(await screen.findByText('One of our team is calling you about this job right now')).toBeTruthy();
    await waitFor(() => expect(getCount).toBeGreaterThan(1));
    expect(await screen.findByText('One of our team is calling you about this job right now.')).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST')).toHaveLength(1);
  });

  it('routes away from a booking that is not yours', async () => {
    serve({ get: () => problem(404, 'NOT_FOUND', 'Booking not found') });
    renderSection();
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/en/account/bookings'));
  });
});
