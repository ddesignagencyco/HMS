import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminOverview } from '@/features/admin/ops-view';
import { getDictionary } from '@/lib/dictionaries';
import type { Locale } from '@/lib/utils';

/* The escrow figure on the `/admin` landing.
 *
 * This card used not to exist. In its place the page carried a sentence saying no
 * admin escrow balance existed anywhere in the API, which was wrong —
 * `GET /finance/escrow` allows ADMIN and returns `totalHeldPaisa` straight from
 * the ledger. So this pins the figure to the server's own total, and pins the three
 * states that are easy to confuse with each other:
 *
 * A• **A failed read is not a zero.** "Rs 0" tells an administrator that nothing is
 *   being held, which is a completely different claim from "we could not look".
 *   Every `/finance/*` route is `totpRequired`, so a 403 is a real possibility and
 *   not an edge case.
 * B• **The total is never re-summed from `items`.** The server caps `items` at 500
 *   rows, so a client-side sum would be silently wrong on a busy platform.
 * C• **Paisa is formatted as paisa.** `formatMoney` divides by 100; passing an
 *   already-divided value would print a hundredth of the money held. */

const dict = getDictionary('en');
const locale: Locale = 'en';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const problem = (status: number, code: string, detail: string) =>
  new Response(JSON.stringify({ type: 'about:blank', title: 'x', status, code, detail, errors: [] }), {
    status,
    headers: { 'content-type': 'application/problem+json' }
  });

const wrap = ({ children }: { children: ReactNode }) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0, gcTime: 0 } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

/* `GET /finance/escrow` — one held account and a total that is deliberately NOT
   the sum of the row, so that a client-side sum would fail this test. */
const escrowBody = {
  totalHeldPaisa: 1_234_500,
  items: [
    { bookingId: 'bk-1', code: 'SH-1001', status: 'AWAITING_VERIFICATION', paymentMode: 'ONLINE', providerId: 'prv-1', heldPaisa: 234_500, finalPaisa: null }
  ]
};

let escrowStatus = 200;

const callsTo = (fragment: string, method: string) =>
  (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(([url, init]) => String(url).includes(fragment) && (init as RequestInit | undefined)?.method === method);

beforeEach(() => {
  escrowStatus = 200;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : String(input);
      const method = (init?.method ?? 'GET').toUpperCase();

      if (url.includes('/finance/escrow')) {
        if (escrowStatus !== 200) return problem(escrowStatus, escrowStatus === 403 ? 'MFA_REQUIRED' : 'UPSTREAM', 'nope');
        return json(escrowBody);
      }

      /* The landing also reads five queues. They are irrelevant here, so they come
         back empty rather than being stubbed row by row. */
      if (method === 'GET') return json({ items: [] });
      throw new Error(`unrouted ${method} ${url}`);
    })
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the escrow balance on the admin landing', () => {
  it('shows the balance the ledger reports, in rupees', async () => {
    render(<AdminOverview locale={locale} dict={dict} />, { wrapper: wrap });
    expect(await screen.findByText(dict.admin.escrowHeldTitle)).toBeDefined();
    /* 1,234,500 paisa is Rs 12,345. A hundred-fold error here is the whole point.
       Awaited, not asserted synchronously: the title renders in the loading state
       too, so finding it does not mean the balance has arrived. */
    expect(await screen.findByText('Rs 12,345')).toBeDefined();
    /* And the held-account count comes from the rows, not from a guess. */
    expect(screen.getByText(dict.admin.escrowHeldAccounts.replace('{count}', '1'))).toBeDefined();
    expect(callsTo('/finance/escrow', 'GET')).toHaveLength(1);
  });

  it('never re-sums the rows, because the server caps them', async () => {
    render(<AdminOverview locale={locale} dict={dict} />, { wrapper: wrap });
    await screen.findByText('Rs 12,345');
    /* Only the single row is returned; its own amount is Rs 2,345. If the screen
       had summed `items` the headline would read that instead. */
    expect(screen.queryByText('Rs 2,345')).toBeNull();
  });

  it('says it could not read the balance rather than showing a zero', async () => {
    escrowStatus = 403;
    render(<AdminOverview locale={locale} dict={dict} />, { wrapper: wrap });
    expect(await screen.findByText(dict.admin.escrowHeldFailed)).toBeDefined();
    /* The dangerous one. A zero here would read as "nothing is being held". */
    expect(screen.queryByText('Rs 0')).toBeNull();
  });

  it('does not claim there is no escrow balance anywhere in the API', async () => {
    render(<AdminOverview locale={locale} dict={dict} />, { wrapper: wrap });
    await screen.findByText(dict.admin.escrowHeldTitle);
    /* The old, factually wrong sentence claimed no route totals held money. */
    expect(document.body.textContent).not.toMatch(/no admin escrow balance/i);
  });

  it('still declines to invent a platform-wide bookings total', async () => {
    render(<AdminOverview locale={locale} dict={dict} />, { wrapper: wrap });
    await screen.findByText(dict.admin.escrowHeldTitle);
    /* Correcting the escrow claim does not create a bookings one: there really is
       no admin bookings list. */
    expect(screen.getByText(dict.admin.opsNoBookingTotals)).toBeDefined();
  });
});
