import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DevPaymentPage } from '@/features/booking/dev-payment-page';
import { getDictionary } from '@/lib/dictionaries';

/* The web's page for the API's mock payment gateway: it must use the backend's
   own action links (no simulated success), and say so honestly when the dev
   gateway is switched off. */

const dict = getDictionary('en');
const PAYMENT = 'aff57cf4-45bb-4cd4-aa2a-64d308c01ec0';
const RETURN = 'http://localhost:3001/en/checkout/return?bookingId=9817e770-979e-4b03-814c-8ff3717d4440';

const renderPage = (response: Response) => {
  const fetchMock = vi.fn(async () => response);
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const wrap = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  render(<DevPaymentPage locale="en" dict={dict} paymentId={PAYMENT} returnUrl={RETURN} />, { wrapper: wrap });
  return fetchMock;
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('DevPaymentPage', () => {
  it("asks the API for JSON and follows the backend's own pay link", async () => {
    const payUrl = `/api/v1/dev/payments/${PAYMENT}/complete?outcome=captured&returnUrl=${encodeURIComponent(RETURN)}`;
    const fetchMock = renderPage(
      new Response(JSON.stringify({ paymentId: PAYMENT, returnUrl: RETURN, actions: { pay: { method: 'GET', url: payUrl }, fail: { method: 'GET', url: payUrl.replace('captured', 'failed') } } }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    );
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });

    fireEvent.click(await screen.findByRole('button', { name: dict.devPay.pay }));

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain(`/api/v1/dev/payments/${PAYMENT}`);
    /* Not text/html — otherwise next.config's redirect would bounce it back here. */
    expect(String((init.headers as Record<string, string>).accept)).not.toContain('text/html');
    expect(assign).toHaveBeenCalledWith(payUrl);
  });

  it('says the simulator is unavailable when the API refuses (production)', async () => {
    renderPage(
      new Response(JSON.stringify({ type: 'about:blank', title: 'x', status: 403, code: 'FORBIDDEN', detail: 'Development endpoints are disabled in this environment', errors: [] }), {
        status: 403,
        headers: { 'content-type': 'application/problem+json' }
      })
    );
    expect(await screen.findByText(dict.devPay.unavailableTitle)).toBeTruthy();
    expect(screen.queryByRole('button', { name: dict.devPay.pay })).toBeNull();
  });
});
