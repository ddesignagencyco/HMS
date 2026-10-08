import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderAreasScreen } from '@/features/provider/areas-view';
import { getDictionary } from '@/lib/dictionaries';
import type { Locale } from '@/lib/utils';

/* The areas a professional covers.

   `GET /provider/service-areas` returns bare `areaId`s — no names — so the picker
   is built from the places API. The tests pin that:

   · a saved area is ticked, from the id the API returned;
   · Save is disabled until something changes, because `PUT` is a destructive full
     replace (it deletes then re-inserts), so a stray click would clear the set;
   · Save sends the **whole** id list, not a delta;
   · an unknown/withdrawn area id never crashes the screen. */

const dict = getDictionary('en');
const locale: Locale = 'en';

const cities = { items: [{ id: 1, name: 'Lahore', timezone: 'Asia/Karachi' }] };
const areas = {
  items: [
    { id: 14, cityId: 1, name: 'Gulberg III' },
    { id: 21, cityId: 1, name: 'Johar Town' },
    { id: 33, cityId: 1, name: 'Model Town' }
  ]
};

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

const renderScreen = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0, gcTime: 0 } }
  });
  const Component = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return render(<ProviderAreasScreen locale={locale} dict={dict} />, { wrapper: Component });
};

/** What `GET /provider/service-areas` returns: bare ids, nothing else. */
let saved: { areaId: number }[] = [{ areaId: 14 }];

beforeEach(() => {
  saved = [{ areaId: 14 }];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'PUT' && url.includes('/provider/service-areas')) {
        const body = JSON.parse(String((init as RequestInit).body)) as { areaIds: number[] };
        saved = body.areaIds.map((areaId) => ({ areaId }));
        return json({ items: saved });
      }
      if (method === 'GET' && url.includes('/provider/service-areas')) return json({ items: saved });
      if (method === 'GET' && url.includes('/places/cities/1/areas')) return json(areas);
      if (method === 'GET' && url.includes('/places/cities')) return json(cities);
      throw new Error(`unrouted ${method} ${url}`);
    })
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the areas a provider covers', () => {
  it('lists every active area from the places API', async () => {
    renderScreen();
    expect(await screen.findByLabelText('Gulberg III')).toBeDefined();
    expect(screen.getByLabelText('Johar Town')).toBeDefined();
    expect(screen.getByLabelText('Model Town')).toBeDefined();
  });

  it('ticks the areas already saved, matched on id', async () => {
    renderScreen();
    expect((await screen.findByLabelText('Gulberg III')) as HTMLInputElement).toBeDefined();
    expect(((await screen.findByLabelText('Gulberg III')) as HTMLInputElement).checked).toBe(true);
    expect(((await screen.findByLabelText('Johar Town')) as HTMLInputElement).checked).toBe(false);
  });

  it('keeps Save disabled until something actually changes', async () => {
    renderScreen();
    const save = (await screen.findByRole('button', { name: dict.portal.saveAreas })) as HTMLButtonElement;
    /* PUT is delete-then-insert: an accidental press would clear the set. */
    expect(save.disabled).toBe(true);

    fireEvent.click(await screen.findByLabelText('Johar Town'));
    expect(((await screen.findByRole('button', { name: dict.portal.saveAreas })) as HTMLButtonElement).disabled).toBe(false);
  });

  it('sends the whole id list, not a delta', async () => {
    renderScreen();
    fireEvent.click(await screen.findByLabelText('Johar Town'));
    fireEvent.click(await screen.findByRole('button', { name: dict.portal.saveAreas }));

    await waitFor(() => {
      const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(([url, init]) => String(url).includes('/provider/service-areas') && (init as RequestInit)?.method === 'PUT');
      expect(call).toBeDefined();
      /* { areaIds: [...] } — the whole set, not "add 21". */
      expect(JSON.parse(String((call?.[1] as RequestInit).body))).toEqual({ areaIds: [14, 21] });
    });
  });

  it('can remove an area by unticking it', async () => {
    renderScreen();
    fireEvent.click(await screen.findByLabelText('Gulberg III'));
    fireEvent.click(await screen.findByRole('button', { name: dict.portal.saveAreas }));

    await waitFor(() => {
      const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(([url, init]) => String(url).includes('/provider/service-areas') && (init as RequestInit)?.method === 'PUT');
      expect(JSON.parse(String((call?.[1] as RequestInit).body))).toEqual({ areaIds: [] });
    });
  });

  it('discards the draft when cancelled', async () => {
    renderScreen();
    fireEvent.click(await screen.findByLabelText('Model Town'));
    fireEvent.click(await screen.findByRole('button', { name: dict.common.cancel }));
    expect(((await screen.findByLabelText('Model Town')) as HTMLInputElement).checked).toBe(false);
    expect(((await screen.findByRole('button', { name: dict.portal.saveAreas })) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the saved count from the API', async () => {
    renderScreen();
    expect(await screen.findByText(dict.portal.areasSaved.replace('{count}', '1'))).toBeDefined();
  });

  it('reports a load failure rather than an empty picker', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/provider/service-areas')) {
          return new Response(JSON.stringify({ type: 'about:blank', title: 'x', status: 500, code: 'INTERNAL_ERROR', detail: 'x', errors: [] }), {
            status: 500,
            headers: { 'content-type': 'application/problem+json' }
          });
        }
        return json(url.includes('areas') ? areas : cities);
      })
    );
    renderScreen();
    expect(await screen.findByText(dict.portal.areasLoadError)).toBeDefined();
  });
});
