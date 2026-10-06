import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FRESHNESS, bookingKeys } from '@/lib/api/keys';
import { useAddresses } from '@/features/booking/queries';
import { useBooking } from '@/features/booking/queries';
import { useBookingMessages } from '@/features/booking/queries';
import { useMyBookings } from '@/features/booking/queries';
import { ApiError } from '@/lib/api/problem';
import type { Booking } from '@/features/booking/api';

/* Server state for the booking module: what may be cached, what may not, and
   what must never be invented.

   Two failures this file exists to prevent, both of which every gate would miss:

   � **Caching the chat.** `GET /bookings/:id/messages` marks the other side's
     messages as read. Served from cache, "read" would mean "rendered" � a
     customer would see a message the professional still thinks is unread.

   � **Substituting data for a failure.** A booking list that answered from
     somewhere else on a 500 would show bookings that do not exist, in a product
     where a booking means someone is being sent to a house. */

afterEach(() => cleanup());

const problem = (status: number, code: string) => ({ type: 'about:blank', title: 'x', status, code, detail: 'x', errors: [] });

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

const wrapper = (client: QueryClient) => {
  const Component = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return Component;
};

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

const row: Booking = {
  id: 'b1',
  code: 'SHM-0000001',
  customerId: 'c1',
  providerId: 'p1',
  serviceId: 1,
  addressId: 'a1',
  status: 'REQUESTED',
  paymentMode: 'CASH',
  paymentStatus: 'NONE',
  isEmergency: false,
  isAutoAssign: false,
  scheduledStart: '2026-10-05T04:00:00.000Z',
  scheduledEnd: '2026-10-05T05:30:00.000Z',
  problemText: null,
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
  onBehalfName: null
};

describe('booking list', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => json({ items: [row] }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('reads every booking the account is on, not a page of them', async () => {
    const { result } = renderHook(() => useMyBookings(undefined, 'en'), { wrapper: wrapper(client()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.items).toHaveLength(1);
    /* The endpoint takes `status` and nothing else � no page, no cursor � so the
       absence of a pager here is the contract, not an omission. */
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain('page=');
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain('limit=');
  });

  it('treats an empty history as an empty state, not a failure', async () => {
    fetchMock.mockImplementation(async () => json({ items: [] }));
    const { result } = renderHook(() => useMyBookings(undefined, 'en'), { wrapper: wrapper(client()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.items).toEqual([]);
    expect(result.current.isError).toBe(false);
  });

  it('retries a server fault once, then surfaces it rather than answering with nothing', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify(problem(500, 'INTERNAL_ERROR')), { status: 500 }));
    const { result } = renderHook(() => useMyBookings(undefined, 'en'), { wrapper: wrapper(client()) });
    /* `publicRetry` allows one more attempt for a 5xx and the retry delay is a
       second, so this waits past the default. */
    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 5_000 });
    expect(result.current.error).toBeInstanceOf(ApiError);
    /* Two attempts: the initial one and the single bounded retry. */
    expect(fetchMock).toHaveBeenCalledTimes(2);
    /* No fallback list exists. An empty array here would render "you have no
       bookings" for a customer who has several. */
    expect(result.current.data).toBeUndefined();
  });

  it('keys on the status filter, because it is part of the request', async () => {
    const cache = client();
    const first = renderHook(() => useMyBookings(undefined, 'en'), { wrapper: wrapper(cache) });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    const second = renderHook(() => useMyBookings('CANCELLED_CUSTOMER', 'en'), { wrapper: wrapper(cache) });
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));

    expect(bookingKeys.list(undefined)).not.toEqual(bookingKeys.list('CANCELLED_CUSTOMER'));
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('status=CANCELLED_CUSTOMER');
  });
});

describe('one booking', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => json(row));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('does not ask for a booking it has no id for', async () => {
    const { result } = renderHook(() => useBooking(null, 'en'), { wrapper: wrapper(client()) });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(result.current.fetchStatus).toBe('idle');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not retry a booking that is not the caller's", async () => {
    /* getOwned filters on customer_id OR provider_id, so a 404 means "not yours
       or not there" � the API will not say which. One attempt, then a not-found
       state. */
    fetchMock.mockImplementation(async () => new Response(JSON.stringify(problem(404, 'NOT_FOUND')), { status: 404 }));
    const { result } = renderHook(() => useBooking('b1', 'en'), { wrapper: wrapper(client()) });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("is stale almost immediately, because a booking's state moves during the visit", () => {
    expect(FRESHNESS.booking.staleTime).toBeLessThanOrEqual(30_000);
    /* Far shorter than the catalogue, and shorter than a search result: this is
       the one thing on the site that is expected to change while it is open. */
    expect(FRESHNESS.booking.staleTime).toBeLessThan(FRESHNESS.search.staleTime);
  });
});

describe('the chat is never cached', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => json({ items: [], open: true }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('treats a read as immediately stale, because reading marks messages read', async () => {
    expect(FRESHNESS.messages.staleTime).toBe(0);
    expect(FRESHNESS.messages.refetchOnWindowFocus).toBe(true);

    const cache = client();
    const { result } = renderHook(() => useBookingMessages('b1', 'en'), { wrapper: wrapper(cache) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const cached = cache.getQueryCache().find({ queryKey: [...bookingKeys.detail('b1'), 'messages'] });
    expect(cached?.isStale()).toBe(true);
  });

  it('does not read the chat at all when nobody can reply', async () => {
    /* Enabled is passed explicitly by the caller from `canMessage(status)`, and
       a GET here would both fail with 409-on-send semantics and mark messages
       read for a thread that is closed. */
    const { result } = renderHook(() => useBookingMessages('b1', 'en', false), { wrapper: wrapper(client()) });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(result.current.fetchStatus).toBe('idle');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a closed thread as closed even when it loaded fine', async () => {
    fetchMock.mockImplementation(async () => json({ items: [{ id: 'm1', senderUserId: 'p1', body: 'On my way', mine: false, readAt: null, createdAt: 'x' }], open: false }));
    const { result } = renderHook(() => useBookingMessages('b1', 'en'), { wrapper: wrapper(client()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    /* Past messages stay readable after the chat shuts; that is deliberate on the
       server's side and the copy says so. */
    expect(result.current.data?.open).toBe(false);
    expect(result.current.data?.items).toHaveLength(1);
  });
});

describe('addresses are a booking dependency', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => json({ items: [] }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("reads the signed-in customer's own addresses", async () => {
    const { result } = renderHook(() => useAddresses('en'), { wrapper: wrapper(client()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    /* No bearer, no provider, no address id in the URL: it is always "mine". */
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/customer/addresses');
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain('provider');
  });

  it('reports an account with no saved address as an empty list, so the flow can offer to add one', async () => {
    const { result } = renderHook(() => useAddresses('en'), { wrapper: wrapper(client()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    /* `POST /bookings` requires an addressId, so this empty list is the trigger
       for the inline create form rather than a dead end. */
    expect(result.current.data?.items).toEqual([]);
  });

  it('waits until it is enabled rather than firing early', async () => {
    const { result } = renderHook(() => useAddresses('en', false), { wrapper: wrapper(client()) });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(result.current.fetchStatus).toBe('idle');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
