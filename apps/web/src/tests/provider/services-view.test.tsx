import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderServicesScreen } from '@/features/provider/services-view';
import { getDictionary } from '@/lib/dictionaries';
import type { Locale } from '@/lib/utils';

/* The provider's own service list and prices.

   This screen joins two sources on purpose: `GET /provider/services` gives the
   binding (serviceId, pricePaisa, status) and the catalogue gives the band, the
   duration and the Urdu name. The tests pin that join — a price outside the band
   is refused by the server with a 400, so the screen has to know the band, and
   a binding whose service is no longer published must still render rather than
   crash on a missing lookup. */

const dict = getDictionary('en');
const locale: Locale = 'en';

/** A catalogue row as `listAllServices` returns it. */
const catalogueService = (input: { id: number; slug: string; nameEn: string; basePricePaisa: number; minPricePaisa: number; maxPricePaisa: number }) => ({
  id: input.id,
  categoryId: 1,
  slug: input.slug,
  nameEn: input.nameEn,
  nameUr: `${input.nameEn} اردو`,
  description: 'A description',
  pricingModel: 'FLAT',
  timeUnit: null,
  basePricePaisa: input.basePricePaisa,
  minPricePaisa: input.minPricePaisa,
  maxPricePaisa: input.maxPricePaisa,
  visitFeePaisa: 0,
  expectedDurationMin: 90,
  isEmergencyEligible: false,
  isPlanEligible: false,
  warrantyDays: 30,
  isHighRisk: false,
  isActive: true,
  categorySlug: 'plumbing',
  categoryNameEn: 'Plumbing',
  categoryNameUr: 'پلمنگ'
});

const leakRepair = catalogueService({
  id: 11,
  slug: 'leak-repair',
  nameEn: 'Leak Repair',
  basePricePaisa: 100000,
  minPricePaisa: 80000,
  maxPricePaisa: 150000
});

const tapReset = catalogueService({
  id: 22,
  slug: 'tap-reset',
  nameEn: 'Tap Reset',
  basePricePaisa: 200000,
  minPricePaisa: 150000,
  maxPricePaisa: 300000
});

const binding = (input: { serviceId: number; pricePaisa: number; status: string }) => ({
  providerId: '00000000-0000-4000-8000-000000000098',
  serviceId: input.serviceId,
  serviceSlug: leakRepair.slug,
  serviceNameEn: leakRepair.nameEn,
  pricePaisa: input.pricePaisa,
  status: input.status,
  createdAt: '2026-10-01T00:00:00.000Z'
});

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

const renderScreen = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0, gcTime: 0 } }
  });
  const Component = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return render(<ProviderServicesScreen locale={locale} dict={dict} />, { wrapper: Component });
};

let bindings: unknown[] = [];

beforeEach(() => {
  bindings = [binding({ serviceId: 11, pricePaisa: 100000, status: 'APPROVED' })];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : String(input);
      const method = (init?.method ?? 'GET').toUpperCase();

      if (method === 'PUT' && url.includes('/provider/services/11')) return json(bindings[0]);
      if (method === 'PUT' && url.includes('/provider/services/22')) return json(binding({ serviceId: 22, pricePaisa: 200000, status: 'PENDING' }));
      if (method === 'DELETE' && url.includes('/provider/services/11')) return new Response(null, { status: 204 });
      if (method === 'GET' && url.includes('/provider/services')) return json({ items: bindings });
      if (method === 'GET' && /\/catalogue\/categories\/[^/]+\/services/.test(url)) {
        return json({ items: [leakRepair, tapReset] });
      }
      if (method === 'GET' && url.includes('/catalogue/categories')) {
        return json({
          items: [
            {
              id: 1,
              slug: 'plumbing',
              nameEn: 'Plumbing',
              nameUr: 'پلمنگ',
              sortOrder: 1,
              defaultWarrantyDays: 30,
              isActive: true
            }
          ]
        });
      }
      throw new Error(`unrouted ${method} ${url}`);
    })
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the services a provider offers', () => {
  it('lists the bindings from the API', async () => {
    renderScreen();
    expect(await screen.findByText('Leak Repair')).toBeDefined();
  });

  it("shows this provider's own price, not the catalogue base price", async () => {
    bindings = [binding({ serviceId: 11, pricePaisa: 120000, status: 'APPROVED' })];
    renderScreen();
    /* 120000 paisa, not the catalogue's 100000 base. */
    expect(await screen.findByText('Rs 1,200')).toBeDefined();
    expect(screen.queryByText('Rs 1,000')).toBeNull();
  });

  it('labels the approval status from the API row', async () => {
    bindings = [binding({ serviceId: 11, pricePaisa: 100000, status: 'PENDING' })];
    renderScreen();
    expect(await screen.findByText(dict.portal.serviceApproval.PENDING)).toBeDefined();
    expect(screen.getByText(dict.portal.servicePendingNote)).toBeDefined();
  });

  it('adds a service chosen from the catalogue and opens its editor', async () => {
    bindings = [binding({ serviceId: 11, pricePaisa: 100000, status: 'APPROVED' })];
    renderScreen();
    await screen.findByText('Leak Repair');

    /* Open the add console, pick the unbound catalogue service, confirm.
       React-select is driven by mouseDown on its control — a plain change event
       does not reach its onChange. The confirm repeats the header label, so it is
       picked as the button *after* the card opens. */
    fireEvent.click(screen.getByRole('button', { name: dict.portal.addService }));
    const combobox = (await screen.findByRole('combobox')) as HTMLInputElement;
    fireEvent.mouseDown(combobox);
    fireEvent.click(await screen.findByText('Tap Reset'));

    const confirms = screen.getAllByRole('button', { name: dict.portal.addService });
    fireEvent.click(confirms[confirms.length - 1]);

    await waitFor(() => {
      const put = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(([url, init]) => String(url).includes('/provider/services/22') && (init as RequestInit | undefined)?.method === 'PUT');
      expect(put).toBeDefined();
      expect(JSON.parse(String((put?.[1] as RequestInit).body))).toEqual({ pricePaisa: 200000 });
    });
  });

  it('shows a rejected binding as not approved, without hiding it', async () => {
    bindings = [binding({ serviceId: 11, pricePaisa: 100000, status: 'REJECTED' })];
    renderScreen();
    expect(await screen.findByText(dict.portal.serviceApproval.REJECTED)).toBeDefined();
    expect(screen.getByText(dict.portal.serviceRejectedNote)).toBeDefined();
  });

  it('shows the price band, which only the catalogue knows', async () => {
    renderScreen();
    await screen.findByText('Leak Repair');
    fireEvent.click(screen.getByRole('button', { name: /Edit price/ }));
    /* Rs 800 – Rs 1,500: minPricePaisa/maxPricePaisa from the catalogue row. */
    expect(await screen.findByText(new RegExp(dict.portal.priceBandHint.replace('{min}', 'Rs 800').replace('{max}', 'Rs 1,500')))).toBeDefined();
  });

  it("does not crash when a binding's service is no longer published", async () => {
    bindings = [binding({ serviceId: 999, pricePaisa: 100000, status: 'APPROVED' })];
    renderScreen();
    /* Falls back to the row's own English name rather than throwing. */
    expect(await screen.findByText('Leak Repair')).toBeDefined();
  });

  it('says so when nothing is offered yet', async () => {
    bindings = [];
    renderScreen();
    expect(await screen.findByText(dict.portal.noServicesYet)).toBeDefined();
    expect(screen.queryByRole('button', { name: /Edit price/ })).toBeNull();
  });

  it('saves a new price through the API rather than local state', async () => {
    renderScreen();
    await screen.findByText('Leak Repair');
    fireEvent.click(screen.getByRole('button', { name: /Edit price/ }));

    const input = await screen.findByLabelText(dict.portal.yourPrice);
    fireEvent.change(input, { target: { value: '1250' } });
    fireEvent.click(screen.getByRole('button', { name: dict.portal.save }));

    await waitFor(() => {
      const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
        ([url, init]) => String(url).includes('/provider/services/11') && (init as RequestInit | undefined)?.method === 'PUT'
      );
      expect(call).toBeDefined();
      /* Rs 1,250 → 125000 paisa. The API is `.strict()` on the schema, so this
         body must be exactly { pricePaisa } — no stray keys. */
      expect(JSON.parse(String((call?.[1] as RequestInit).body))).toEqual({ pricePaisa: 125000 });
    });
  });

  it('refuses a non-numeric price before sending it', async () => {
    renderScreen();
    await screen.findByText('Leak Repair');
    fireEvent.click(screen.getByRole('button', { name: /Edit price/ }));
    fireEvent.change(await screen.findByLabelText(dict.portal.yourPrice), { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: dict.portal.save }));
    expect(await screen.findByText(dict.portal.priceInvalid)).toBeDefined();
  });

  it('removes a binding through the API', async () => {
    renderScreen();
    await screen.findByText('Leak Repair');
    fireEvent.click(screen.getByRole('button', { name: /Stop offering/ }));
    await waitFor(() => {
      const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
        ([url, init]) => String(url).includes('/provider/services/11') && (init as RequestInit | undefined)?.method === 'DELETE'
      );
      expect(call).toBeDefined();
    });
  });

  it('reports a load failure instead of an empty list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/provider/services')) {
          return new Response(JSON.stringify({ type: 'about:blank', title: 'x', status: 500, code: 'INTERNAL_ERROR', detail: 'x', errors: [] }), {
            status: 500,
            headers: { 'content-type': 'application/problem+json' }
          });
        }
        return json({ items: [] });
      })
    );
    renderScreen();
    expect(await screen.findByText(dict.portal.servicesLoadError)).toBeDefined();
    expect(screen.queryByText(dict.portal.noServicesYet)).toBeNull();
  });
});
