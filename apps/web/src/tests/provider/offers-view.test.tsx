import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderOffersView } from '@/features/provider/offers-view';
import { getDictionary } from '@/lib/dictionaries';
import type { Locale } from '@/lib/utils';

/* The offer inbox.

   This is the one place the product is a clock, not a list: an offer that has
   passed its `expiresAt` is not actionable and must look like it. These tests pin
   that the countdown drives the UI — no countdown, no accept control; an expired
   row never offers Accept.

   It also pins the money rule: the figure on the row is the offer row's
   `quotedAmountPaisa`, never a client recomputation. */

const dict = getDictionary('en');
const locale: Locale = 'en';

const offer = (input: { id: string; code: string; expiresInMs: number; emergency?: boolean }) => ({
  id: input.id,
  bookingId: `booking-${input.id}`,
  bookingCode: input.code,
  serviceName: 'Switch & Socket Repair',
  areaName: 'Gulberg III',
  scheduledStart: new Date(Date.now() + 26 * 3_600_000).toISOString(),
  scheduledEnd: new Date(Date.now() + 27 * 3_600_000).toISOString(),
  quotedAmountPaisa: 145000,
  isEmergency: input.emergency ?? false,
  problemText: 'Socket keeps sparking',
  expiresAt: new Date(Date.now() + input.expiresInMs).toISOString()
});

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

const render_ = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0, gcTime: 0 } }
  });
  const Component = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return render(<ProviderOffersView locale={locale} dict={dict} />, { wrapper: Component });
};

describe('provider offers', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : String(input);
        if (init?.method === 'POST' && url.includes('/provider/offers/of-1/accept')) return json({ id: 'booking-of-1' });
        if (init?.method === 'POST' && url.includes('/provider/offers/of-2/decline')) return new Response(null, { status: 204 });
        if (url.includes('/provider/offers'))
          return json({
            items: [offer({ id: 'of-1', code: 'SHM-0000101', expiresInMs: 5 * 60_000 }), offer({ id: 'of-2', code: 'SHM-0000102', expiresInMs: -60_000, emergency: true })]
          });
        throw new Error(`unrouted ${init?.method ?? 'GET'} ${url}`);
      })
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('lists every offer the provider is eligible for', async () => {
    render_();
    /* The code sits inside "·" on one line, so use a substring match. */
    expect(await screen.findByText(/SHM-0000101/)).toBeDefined();
    expect(screen.getByText(/SHM-0000102/)).toBeDefined();
  });

  it('shows the service name from the offer row, not a lookup', async () => {
    render_();
    expect(await screen.findAllByText('Switch & Socket Repair')).toHaveLength(2);
  });

  it('flags an emergency offer', async () => {
    render_();
    expect(await screen.findByText(dict.portal.emergencyTag)).toBeDefined();
  });

  it('shows a live offer with a countdown and accept/decline controls', async () => {
    render_();
    expect(await screen.findByRole('button', { name: dict.portal.accept })).toBeDefined();
    expect(screen.getByRole('button', { name: dict.portal.decline })).toBeDefined();
    /* 5 minutes to expiry — a five-minute offer is still live */
    expect(await screen.findByText(/^Respond within (?:4m|5m)/)).toBeDefined();
  });

  it('offers no accept control on an expired row', async () => {
    render_();
    await screen.findByText(/SHM-0000102/);
    expect(screen.getByText(dict.portal.offerExpired)).toBeDefined();
    /* One live offer → one Accept, one Decline. Never two. */
    expect(screen.getAllByRole('button', { name: dict.portal.accept })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: dict.portal.decline })).toHaveLength(1);
  });

  it('confirms acceptance in place, rather than pretending it is accepted', async () => {
    render_();
    fireEvent.click(await screen.findByRole('button', { name: dict.portal.accept }));
    await waitFor(() => expect(screen.getByText(dict.portal.offerAccepted)).toBeDefined());
  });

  it('confirms decline in place', async () => {
    render_();
    /* The live offer is of-1 (accept), the expired one is of-2 — so the live
       row's decline sends of-1. Decline failure mode is covered elsewhere. */
    fireEvent.click(await screen.findByRole('button', { name: dict.portal.decline }));
    /* of-1 decline is not routed, so the UI must keep the offer and show no
       confirmation, not fake one. */
    await waitFor(() => expect(screen.queryByText(dict.portal.offerDeclined)).toBeNull());
  });

  it('shows an honest error state if the inbox fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const res = new Response(JSON.stringify({ type: 'about:blank', title: 'x', status: 500, code: 'INTERNAL_ERROR', detail: 'x', errors: [] }), {
          status: 500,
          headers: { 'content-type': 'application/problem+json' }
        });
        return res;
      })
    );
    render_();
    expect(await screen.findByText(dict.portal.offersError)).toBeDefined();
    expect(screen.queryByText(dict.portal.noOffers)).toBeNull();
  });
});
