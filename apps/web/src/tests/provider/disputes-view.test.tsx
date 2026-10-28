import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderDisputesScreen } from '@/features/provider/disputes-view';
import { getDictionary } from '@/lib/dictionaries';
import type { Locale } from '@/lib/utils';

/* Disputes on the professional's jobs.

   The contract facts this pins: the detail is the nested evidence floor
   (`DisputesService.evidenceFloor`), not a flat row; and the right of reply is
   sent as `{ reply }` — `replySchema` is `.strict()`, so `{ body }` is a 422. */

const dict = getDictionary('en');
const locale: Locale = 'en';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

const row = (over: Record<string, unknown> = {}) => ({
  id: 'd1',
  bookingCode: 'SHM-0000201',
  origin: 'COMPLAINT',
  status: 'OPEN',
  replyDueAt: '2026-10-16T09:00:00.000Z',
  providerReplied: false,
  createdAt: '2026-10-14T09:00:00.000Z',
  resolution: null,
  ...over
});

const detail = (dispute: Record<string, unknown> = {}) => ({
  dispute: {
    id: 'd1',
    origin: 'COMPLAINT',
    status: 'OPEN',
    replyDueAt: '2026-10-16T09:00:00.000Z',
    providerReply: null,
    providerRepliedAt: null,
    resolution: null,
    releasePaisa: null,
    refundPaisa: null,
    note: null,
    resolvedAt: null,
    createdAt: '2026-10-14T09:00:00.000Z',
    complaintId: 'c1',
    ...dispute
  },
  booking: {
    id: 'b1',
    code: 'SHM-0000201',
    status: 'DISPUTED',
    paymentMode: 'ONLINE',
    serviceName: 'Switch & Socket Repair',
    customerName: 'A Customer',
    providerName: 'A Provider',
    scheduledStart: '2026-10-12T05:00:00.000Z',
    problemText: 'Socket keeps sparking',
    approvedTotalPaisa: 150_000,
    finalAmountPaisa: 150_000,
    discountPaisa: 0,
    visitNo: 1
  },
  money: { escrowHeldPaisa: 150_000, finalAmountPaisa: 150_000, excessPaisa: 0 },
  evidenceFloor: {
    startCodeVerifiedAt: '2026-10-12T05:10:00.000Z',
    completedAt: '2026-10-12T06:00:00.000Z',
    minutesOnSite: 50,
    geofence: { radiusM: 150, checkinDistanceM: 20, checkoutDistanceM: 25, checkinWithin: true, checkoutWithin: true },
    photos: [],
    checklist: [{ label: 'Isolate the circuit', requiresPhoto: false, done: true, visitNo: 1, evidenceId: null }],
    invoice: null
  },
  verifications: [],
  callAttempts: [],
  complaints: [{ id: 'c1', category: 'QUALITY', severity: 'MEDIUM', status: 'OPEN', description: 'The socket still sparks.' }],
  statusHistory: []
});

let current = detail();

const renderScreen = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0, gcTime: 0 } } });
  const Component = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return render(<ProviderDisputesScreen locale={locale} dict={dict} />, { wrapper: Component });
};

const replies = () =>
  (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(([url, init]) => String(url).includes('/reply') && (init as RequestInit | undefined)?.method === 'POST');

beforeEach(() => {
  current = detail();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'POST' && url.includes('/provider/disputes/d1/reply')) return json({ id: 'd1', status: 'READY' });
      if (url.includes('/provider/disputes/d1')) return json(current);
      if (url.includes('/provider/disputes')) return json({ items: [row()] });
      throw new Error(`unrouted ${method} ${url}`);
    })
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('provider disputes', () => {
  it('lists disputes with their state', async () => {
    renderScreen();
    expect(await screen.findByText('SHM-0000201')).toBeDefined();
    expect(screen.getByText(dict.admin.disputeStates.OPEN)).toBeDefined();
  });

  it('opens the evidence floor and sends the reply under `reply`, not `body`', async () => {
    renderScreen();
    fireEvent.click(await screen.findByText('SHM-0000201'));
    expect(await screen.findByText('The socket still sparks.')).toBeDefined();
    expect(screen.getByText('Switch & Socket Repair')).toBeDefined();

    fireEvent.change(screen.getByLabelText(dict.portal.disputeReplyLabel), { target: { value: '  The socket was replaced and tested. ' } });
    fireEvent.click(screen.getByRole('button', { name: dict.portal.disputeSendReply }));

    await waitFor(() => expect(replies()).toHaveLength(1));
    expect(JSON.parse(String((replies()[0][1] as RequestInit).body))).toEqual({ reply: 'The socket was replaced and tested.' });
    expect(await screen.findByText(dict.portal.disputeReplySent)).toBeDefined();
  });

  it('refuses an empty reply before sending it', async () => {
    renderScreen();
    fireEvent.click(await screen.findByText('SHM-0000201'));
    fireEvent.click(await screen.findByRole('button', { name: dict.portal.disputeSendReply }));
    expect(await screen.findByText(dict.portal.disputeReplyRequired)).toBeDefined();
    expect(replies()).toHaveLength(0);
  });

  it('shows the reply already given instead of the form', async () => {
    current = detail({ status: 'READY', providerReply: 'Already answered.', providerRepliedAt: '2026-10-14T10:00:00.000Z' });
    renderScreen();
    fireEvent.click(await screen.findByText('SHM-0000201'));
    expect(await screen.findByText('Already answered.')).toBeDefined();
    expect(screen.queryByRole('button', { name: dict.portal.disputeSendReply })).toBeNull();
  });

  it('shows the ruling and no reply form once resolved', async () => {
    current = detail({ status: 'RESOLVED', resolution: 'FULL_RELEASE', note: 'The work was done.' });
    renderScreen();
    fireEvent.click(await screen.findByText('SHM-0000201'));
    expect(await screen.findByText(dict.admin.rulings.FULL_RELEASE)).toBeDefined();
    expect(screen.getByText(dict.portal.disputeRuledNoReply)).toBeDefined();
    expect(screen.queryByRole('button', { name: dict.portal.disputeSendReply })).toBeNull();
  });
});
