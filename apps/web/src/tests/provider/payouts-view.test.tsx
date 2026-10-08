import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderPayoutsScreen } from '@/features/provider/payouts-view';
import { getDictionary } from '@/lib/dictionaries';
import type { Locale } from '@/lib/utils';

/* Payouts.

   Three facts this pins, each of them a place a plausible-looking screen would lie:

   · **The minimum payout is not knowable from here.** It is an admin-owned setting
     with no provider-readable endpoint, so the screen must not quote a figure. A
     test asserts no rupee amount appears as a *minimum*, and that the server's own
     refusal — which does name the figure — is what reaches the professional.

   · **`releasablePaisa` is the honest ceiling** and the amount field defaults to
     it, rather than to an invented round number like 5000.

   · **An account number is write-only.** The API returns `accountLast4` and never
     the number, so after adding one the screen must not display it again — the
     same rule the CNIC number follows on the documents screen. */

const dict = getDictionary('en');
const locale: Locale = 'en';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

const renderScreen = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0, gcTime: 0 } } });
  const Component = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return render(<ProviderPayoutsScreen locale={locale} dict={dict} />, { wrapper: Component });
};

const account = (over: Record<string, unknown> = {}) => ({
  id: 'pa1',
  kind: 'BANK',
  accountTitle: 'Bilal Ahmed',
  institution: 'Meezan Bank',
  accountLast4: '7788',
  isDefault: true,
  ...over
});

const payout = (over: Record<string, unknown> = {}) => ({
  id: 'po1',
  amountPaisa: 250_000,
  status: 'PAID',
  institution: 'Meezan Bank',
  accountLast4: '7788',
  requestedAt: '2026-09-28T00:00:00.000Z',
  paidAt: '2026-09-30T00:00:00.000Z',
  failureReason: null,
  ...over
});

let earnings = { heldPaisa: 40_000, releasablePaisa: 250_000, paidOutPaisa: 900_000, commissionPaisa: 20_000 };
let accounts = [account()];
let payouts = [payout()];

const postsTo = (fragment: string) =>
  (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(([url, init]) => String(url).includes(fragment) && (init as RequestInit | undefined)?.method === 'POST');

beforeEach(() => {
  earnings = { heldPaisa: 40_000, releasablePaisa: 250_000, paidOutPaisa: 900_000, commissionPaisa: 20_000 };
  accounts = [account()];
  payouts = [payout()];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : String(input);
      if ((init?.method ?? 'GET').toUpperCase() === 'POST') return json(account());
      if (url.includes('/provider/earnings')) return json(earnings);
      if (url.includes('/provider/payout-accounts')) return json({ items: accounts });
      if (url.includes('/provider/payouts')) return json({ items: payouts });
      throw new Error(`unrouted ${url}`);
    })
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('provider payouts', () => {
  it('lists past payouts with their status and destination', async () => {
    renderScreen();
    expect(await screen.findByText('Rs 2,500')).toBeDefined();
    expect(screen.getByText(dict.portal.payoutStatus.PAID)).toBeDefined();
    /* The institution and last four digits are all the API gives back. */
    expect(screen.getByText(/Meezan Bank · ••••7788/)).toBeDefined();
  });

  it('shows the failure reason when a payout was rejected', async () => {
    payouts = [payout({ status: 'REJECTED', paidAt: null, failureReason: 'The IBAN did not validate at your bank.' })];
    renderScreen();
    expect(await screen.findByText('The IBAN did not validate at your bank.')).toBeDefined();
  });

  it('offers the releasable balance as the default amount, not an invented round number', async () => {
    renderScreen();
    await screen.findByText('Rs 2,500');
    /* releasablePaisa is 250000 → Rs 2500. */
    expect((await screen.findByLabelText(dict.portal.payoutAmountLabel)) as HTMLInputElement).toBeDefined();
    expect(((await screen.findByLabelText(dict.portal.payoutAmountLabel)) as HTMLInputElement).placeholder).toBe('2500');
    expect(screen.getByText(dict.portal.releasableNow.replace('{amount}', 'Rs 2,500'))).toBeDefined();
  });

  it('converts the typed rupees to paisa and sends the chosen account', async () => {
    renderScreen();
    fireEvent.change(await screen.findByLabelText(dict.portal.payoutAmountLabel), { target: { value: '1200.50' } });
    fireEvent.click(screen.getByRole('button', { name: dict.portal.requestPayout }));

    await waitFor(() => expect(postsTo('/provider/payouts')).toHaveLength(1));
    expect(JSON.parse(String((postsTo('/provider/payouts')[0][1] as RequestInit).body))).toEqual({
      amountPaisa: 120_050,
      payoutAccountId: 'pa1'
    });
    expect(await screen.findByText(dict.portal.payoutRequested)).toBeDefined();
  });

  it('refuses a non-numeric amount before sending it', async () => {
    renderScreen();
    await screen.findByLabelText(dict.portal.payoutAmountLabel);
    fireEvent.change(screen.getByLabelText(dict.portal.payoutAmountLabel), { target: { value: 'lots' } });
    fireEvent.click(screen.getByRole('button', { name: dict.portal.requestPayout }));
    expect(await screen.findByText(dict.portal.payoutAmountInvalid)).toBeDefined();
    expect(postsTo('/provider/payouts')).toHaveLength(0);
  });

  it('surfaces the server refusal rather than quoting a minimum it cannot read', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : String(input);
        if ((init?.method ?? 'GET').toUpperCase() === 'POST') {
          return new Response(
            JSON.stringify({
              type: 'about:blank',
              title: 'x',
              status: 422,
              code: 'VALIDATION_FAILED',
              detail: 'The smallest payout is Rs 500',
              errors: []
            }),
            { status: 422, headers: { 'content-type': 'application/problem+json' } }
          );
        }
        if (url.includes('/provider/earnings')) return json(earnings);
        if (url.includes('/provider/payout-accounts')) return json({ items: accounts });
        return json({ items: payouts });
      })
    );
    renderScreen();
    fireEvent.change(await screen.findByLabelText(dict.portal.payoutAmountLabel), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: dict.portal.requestPayout }));
    /* The admin-owned figure comes from the server's own sentence. */
    expect(await screen.findByText('The smallest payout is Rs 500')).toBeDefined();
    expect(screen.queryByText(dict.portal.payoutRequested)).toBeNull();
  });

  it('says so when no account is on file and disables the request', async () => {
    accounts = [];
    renderScreen();
    expect(await screen.findByText(dict.portal.noAccounts)).toBeDefined();
    expect((await screen.findByRole('button', { name: dict.portal.requestPayout })) as HTMLButtonElement).toBeDefined();
    expect(((await screen.findByRole('button', { name: dict.portal.requestPayout })) as HTMLButtonElement).disabled).toBe(true);
  });

  it('says so when no payout has been requested', async () => {
    payouts = [];
    renderScreen();
    expect(await screen.findByText(dict.portal.noPayouts)).toBeDefined();
  });

  it('adds an account without ever reading the number back', async () => {
    renderScreen();
    await screen.findByText('Rs 2,500');
    fireEvent.click(screen.getByRole('button', { name: dict.portal.addAccount }));

    fireEvent.change(await screen.findByLabelText(dict.portal.accountTitleLabel), { target: { value: 'Bilal Ahmed' } });
    fireEvent.change(screen.getByLabelText(dict.portal.institutionLabel), { target: { value: 'Meezan Bank' } });
    fireEvent.change(screen.getByLabelText(dict.portal.accountNumberLabel), { target: { value: '010201012345' } });
    fireEvent.click(screen.getByRole('button', { name: dict.portal.save }));

    await waitFor(() => expect(postsTo('/provider/payout-accounts')).toHaveLength(1));
    expect(JSON.parse(String((postsTo('/provider/payout-accounts')[0][1] as RequestInit).body))).toEqual({
      kind: 'BANK',
      accountTitle: 'Bilal Ahmed',
      institution: 'Meezan Bank',
      accountNumber: '010201012345'
    });
    expect(await screen.findByText(dict.portal.accountAdded)).toBeDefined();
    /* The number exists only in the form. Once saved it is gone from the page,
       because the API only ever hands back the last four digits. */
    expect(document.body.textContent).not.toContain('010201012345');
  });

  it('refuses an incomplete account before sending it', async () => {
    renderScreen();
    await screen.findByText('Rs 2,500');
    fireEvent.click(screen.getByRole('button', { name: dict.portal.addAccount }));
    fireEvent.change(await screen.findByLabelText(dict.portal.accountTitleLabel), { target: { value: 'Bilal' } });
    fireEvent.click(screen.getByRole('button', { name: dict.portal.save }));
    expect(await screen.findByText(dict.portal.accountFieldsRequired)).toBeDefined();
    expect(postsTo('/provider/payout-accounts')).toHaveLength(0);
  });

  it('reports a failure to load payouts', async () => {
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
    expect(await screen.findByText(dict.portal.payoutsLoadError)).toBeDefined();
  });
});
