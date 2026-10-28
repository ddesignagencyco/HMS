import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderEarningsScreen } from '@/features/provider/earnings-view';
import { getDictionary } from '@/lib/dictionaries';
import type { Locale } from '@/lib/utils';

/* Provider earnings.

   The distinction this screen exists to get right is **held vs releasable vs
   paid**: money only leaves escrow once a job passes verification. The previous
   version computed a 12% commission in the browser from a hardcoded
   `paid = 1842000`, which is a second source of truth for someone else's money.

   These tests pin that every figure comes from the API, and that a provider over
   the commission ceiling is told plainly — a positive-looking balance while
   offers are blocked is the failure mode worth catching. */

const dict = getDictionary('en');
const locale: Locale = 'en';

const earnings = {
  heldPaisa: 450000,
  releasablePaisa: 320000,
  paidPaisa: 1842000,
  commissionPaisa: 214000,
  weekly: [{ period: '2026-W40', releasedPaisa: 90000 }],
  monthly: [{ period: '2026-10', releasedPaisa: 410000 }]
};

/* Deliberately different from `releasablePaisa`: the two are different numbers in
   reality, and sharing one would let a test pass without proving which field is
   on screen. */
const walletHealthy = {
  balancePaisa: 305000,
  debtPaisa: 0,
  debtCeilingPaisa: 500000,
  offersBlocked: false,
  offerBlockedReason: null
};

const walletBlocked = {
  balancePaisa: -15000,
  debtPaisa: 15000,
  debtCeilingPaisa: 500000,
  offersBlocked: true,
  offerBlockedReason: 'You are over your commission debt ceiling.'
};

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

const renderScreen = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0, gcTime: 0 } }
  });
  const Component = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return render(<ProviderEarningsScreen locale={locale} dict={dict} />, { wrapper: Component });
};

type WalletShape = typeof walletHealthy | typeof walletBlocked;
let wallet: WalletShape = walletHealthy;

beforeEach(() => {
  wallet = walletHealthy;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : String(input);
      if (url.includes('/provider/earnings')) return json(earnings);
      if (url.includes('/provider/wallet')) return json(wallet);
      throw new Error(`unrouted GET ${url}`);
    })
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('provider earnings', () => {
  it('separates held from releasable from paid', async () => {
    renderScreen();
    expect(await screen.findByText('Rs 4,500')).toBeDefined();
    expect(screen.getByText('Rs 3,200')).toBeDefined();
    expect(screen.getByText('Rs 18,420')).toBeDefined();
  });

  it('shows the commission the API computed, never a client percentage', async () => {
    renderScreen();
    /* commissionPaisa is snapshotted per booking server-side. A browser-side
       percentage would disagree the moment a commission rule ends. */
    expect(await screen.findByText('Rs 2,140')).toBeDefined();
    /* 12% of 1842000 would be Rs 22,104 — deliberately absent. */
    expect(screen.queryByText('Rs 22,104')).toBeNull();
  });

  it('lists what was released each week and each month', async () => {
    renderScreen();
    expect(await screen.findByText('2026-W40')).toBeDefined();
    expect(screen.getByText('2026-10')).toBeDefined();
    expect(screen.getByText('Rs 900')).toBeDefined();
    expect(screen.getByText('Rs 4,100')).toBeDefined();
  });

  it('shows the wallet balance, debt and ceiling', async () => {
    renderScreen();
    expect(await screen.findByText('Rs 3,050')).toBeDefined();
    expect(screen.getByText('Rs 5,000')).toBeDefined();
  });

  it('warns plainly when the provider is blocked from new offers', async () => {
    wallet = walletBlocked;
    renderScreen();
    expect(await screen.findByRole('alert')).toBeDefined();
    expect(screen.getByText('You are over your commission debt ceiling.')).toBeDefined();
    expect(screen.getByText(dict.portal.debtOwed.replace('{amount}', 'Rs 150'))).toBeDefined();
  });

  it('does not warn when the provider is in good standing', async () => {
    renderScreen();
    await screen.findByText('Rs 4,500');
    expect(screen.queryByText(dict.portal.offersBlockedDefault)).toBeNull();
  });

  it('says nothing has been released rather than showing an empty table', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/provider/earnings')) return json({ ...earnings, weekly: [], monthly: [] });
        return json(wallet);
      })
    );
    renderScreen();
    expect(await screen.findAllByText(dict.portal.nothingReleasedYet)).toHaveLength(2);
  });

  it('reports a failure to load earnings', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ type: 'about:blank', title: 'x', status: 500, code: 'INTERNAL_ERROR', detail: 'x', errors: [] }), {
            status: 500,
            headers: { 'content-type': 'application/problem+json' }
          })
      )
    );
    renderScreen();
    expect(await screen.findByText(dict.portal.earningsLoadError)).toBeDefined();
  });

  it('still shows earnings when only the wallet fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/provider/earnings')) return json(earnings);
        return new Response(JSON.stringify({ type: 'about:blank', title: 'x', status: 500, code: 'INTERNAL_ERROR', detail: 'x', errors: [] }), {
          status: 500,
          headers: { 'content-type': 'application/problem+json' }
        });
      })
    );
    renderScreen();
    /* Hiding the wallet silently would hide the reason offers stopped. */
    expect(await screen.findByText('Rs 4,500')).toBeDefined();
    expect(screen.getByText(dict.portal.walletLoadError)).toBeDefined();
  });
});
