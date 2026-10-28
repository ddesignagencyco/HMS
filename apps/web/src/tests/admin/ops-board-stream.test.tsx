import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminOpsBoard, LIVE_STREAM_AVAILABLE } from '@/features/admin/ops-board';
import { getDictionary } from '@/lib/dictionaries';

/* BE-016: opening `GET /admin/ops-board/stream` crashes the API process
   (`@Sse` + `@Res()` → ERR_HTTP_HEADERS_SENT, uncaught). Until the backend fixes
   it the board must never open the stream — it polls the REST snapshot. */

const dict = getDictionary('en');

/* The `OpsBoard` shape from features/admin/api.ts. */
const board = {
  generatedAt: '2026-10-14T10:00:00.000Z',
  bookingsToday: { total: 0, byStatus: {} },
  queueDepth: { outbox: 0, notifications: 0, payments: 0, verification: 0, projections: 0 },
  slaBreaches: { verifications: 0, complaints: 0 },
  openDisputes: { total: 0, awaitingReply: 0 },
  escrow: { heldPaisa: '0', bookingsHolding: 0 },
  debtBlockedProviders: 0,
  alerts: []
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ops board while BE-016 is open', () => {
  it('never requests the live stream, and says it refreshes on a timer', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      return new Response(JSON.stringify(url.includes('/admin/ops-board') ? board : {}), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const wrap = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;

    render(<AdminOpsBoard locale="en" dict={dict} />, { wrapper: wrap });

    expect(LIVE_STREAM_AVAILABLE).toBe(false);
    expect(await screen.findByText(dict.ops.pollingBadge)).toBeTruthy();
    expect(screen.getByRole('button', { name: dict.ops.refreshNow })).toBeTruthy();
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/admin/ops-board'))).toBe(true));
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/ops-board/stream'))).toBe(false);
  });
});
