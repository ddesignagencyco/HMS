import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomerFavouritesScreen } from '@/features/customer/favourites-view';
import { getDictionary } from '@/lib/dictionaries';
import type { Locale } from '@/lib/utils';

/* Saved professionals — `GET /me/favourites` and `DELETE /me/favourites/:id`.
 *
 * This screen used to render a card saying saving a professional was not available
 * yet, because the `favourites` table existed and nothing read it. `favourites.service.ts`
 * now does, so the explanation became the wrong thing to show and these tests pin
 * what replaced it.
 *
 * The property that matters most is what the screen does *not* claim.
 * `FavouriteItem` is `{ providerId, firstName, lastName, providerStatus,
 * favouritedAt }` — no rating, no area, no distance, no photograph. An earlier
 * version of this screen's copy promised a card "with their rating, area and
 * distance", which no endpoint could supply. So the tests assert the card is built
 * from the five fields that do exist and that nothing else is invented. */

const dict = getDictionary('en');
const locale: Locale = 'en';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
/** `Response` throws on a body for a null-body status, so 204 gets `null`. */
const noContent = () => new Response(null, { status: 204 });

const favourite = (over: Record<string, unknown> = {}) => ({
  providerId: '00000000-0000-4000-8000-000000000098',
  firstName: 'Bilal',
  lastName: 'Ahmed',
  providerStatus: 'APPROVED',
  favouritedAt: '2026-10-01T00:00:00.000Z',
  ...over
});

const wrap = ({ children }: { children: ReactNode }) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0, gcTime: 0 } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

const renderScreen = () => render(<CustomerFavouritesScreen locale={locale} dict={dict} />, { wrapper: wrap });

let items: ReturnType<typeof favourite>[] = [];
let fetchMock: ReturnType<typeof vi.fn>;

const stub = (): void => {
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method === 'DELETE') {
      const id = decodeURIComponent(url.split('/me/favourites/')[1] ?? '');
      items = items.filter((item) => item.providerId !== id);
      return noContent();
    }
    if (method === 'POST') return json({ favourited: true });
    if (url.includes('/api/v1/me/favourites')) return json({ items });
    throw new Error(`unrouted ${method} ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
};

beforeEach(() => {
  items = [favourite()];
  stub();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('saved professionals', () => {
  it('lists what the API returned, with the name it actually published', async () => {
    renderScreen();
    expect(await screen.findByText('Bilal Ahmed')).toBeDefined();
    expect(screen.getByText(dict.portal.statusKeys.APPROVED)).toBeDefined();
  });

  it('invents no rating, area or distance, because the response has none', async () => {
    renderScreen();
    await screen.findByText('Bilal Ahmed');
    /* The row carries five fields. A star rating, a distance and an area would have
       to be made up, and a made-up number reads as measured. */
    const body = document.body.textContent ?? '';
    expect(body).not.toMatch(/\d+(\.\d+)?\s*★/);
    expect(body).not.toMatch(/\d+(\.\d+)?\s*(km|KM)\b/);
    expect(screen.queryByText(/rating/i)).toBeNull();
  });

  it('shows when the professional was saved, from favouritedAt', async () => {
    renderScreen();
    await screen.findByText('Bilal Ahmed');
    /* Formatted for the reader rather than printed as a raw ISO string. */
    expect(document.body.textContent).not.toContain('2026-10-01T00:00:00.000Z');
    expect(document.body.textContent).toMatch(/Saved\s+.+2026/);
  });

  it('labels a professional who is no longer approved, instead of presenting them as bookable', async () => {
    items = [favourite({ providerStatus: 'SUSPENDED' })];
    stub();
    renderScreen();
    await screen.findByText('Bilal Ahmed');
    /* `POST /me/favourites/:id` requires APPROVED, but the list does not filter on
       it — a professional suspended after being saved stays in the list. Showing the
       status is the difference between a shortlist and a broken promise. */
    expect(screen.getByText(dict.portal.statusKeys.SUSPENDED)).toBeDefined();
  });

  it('links to the profile rather than summarising fields the list never returned', async () => {
    renderScreen();
    await screen.findByText('Bilal Ahmed');
    const link = screen.getByRole('link', { name: dict.portal.favouritesBookAgo });
    expect(link.getAttribute('href')).toContain('/providers/00000000-0000-4000-8000-000000000098');
  });

  it('offers an honest empty state that points somewhere useful', async () => {
    items = [];
    stub();
    renderScreen();
    expect(await screen.findByText(dict.portal.noFavourites)).toBeDefined();
    /* Twice on purpose: the header action and the empty-state button. Both lead to
       the directory, which is where a shortlist gets its first entry. */
    expect(screen.getAllByRole('link', { name: dict.portal.browseProviders }).length).toBeGreaterThan(0);
    /* The old card said the feature was unavailable. It is available; printing that
       claim now would be the same defect in the opposite direction. */
    expect(screen.queryByText(dict.portal.plansUnavailableTitle)).toBeNull();
  });

  it('removes a professional only after the confirmation is accepted', async () => {
    renderScreen();
    await screen.findByText('Bilal Ahmed');

    fireEvent.click(screen.getByRole('button', { name: `${dict.portal.favouritesRemove}: Bilal Ahmed` }));
    /* The confirmation asks the question; nothing has been sent yet. */
    const confirm = screen.getByRole('group', { name: dict.portal.favouritesRemove });
    expect(within(confirm).getByText(dict.portal.favouritesRemoveConfirm)).toBeDefined();
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'DELETE')).toBe(false);

    fireEvent.click(within(confirm).getByRole('button', { name: dict.portal.favouritesRemove }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url).includes('/me/favourites/') && (init as RequestInit | undefined)?.method === 'DELETE')).toBe(true));
    /* And the row goes once the API has confirmed it. */
    await waitFor(() => expect(screen.queryByText('Bilal Ahmed')).toBeNull());
  });

  it('does not remove anything when the confirmation is dismissed', async () => {
    renderScreen();
    await screen.findByText('Bilal Ahmed');
    fireEvent.click(screen.getByRole('button', { name: `${dict.portal.favouritesRemove}: Bilal Ahmed` }));
    fireEvent.click(screen.getByRole('button', { name: dict.common.cancel }));

    expect(screen.queryByRole('group', { name: dict.portal.favouritesRemove })).toBeNull();
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'DELETE')).toBe(false);
    expect(screen.getByText('Bilal Ahmed')).toBeDefined();
  });

  it('reports a list it could not read, and offers a retry', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/v1/me/favourites')) {
          return new Response(JSON.stringify({ type: 'about:blank', title: 'x', status: 500, code: 'INTERNAL_ERROR', detail: 'boom', errors: [] }), {
            status: 500,
            headers: { 'content-type': 'application/problem+json' }
          });
        }
        throw new Error(`unrouted ${url}`);
      })
    );
    renderScreen();
    /* An empty shortlist and a failed read look identical on screen, and one of
       them is a lie about the customer's data. So the failure says so. */
    expect(await screen.findByText(dict.portal.favouritesLoadError)).toBeDefined();
    expect(screen.queryByText(dict.portal.noFavourites)).toBeNull();
  });
});
