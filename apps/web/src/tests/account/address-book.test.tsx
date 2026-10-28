import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AddressBookView } from '@/features/account/addresses-view';
import type { Address } from '@/features/account/api';
import { getDictionary } from '@/lib/dictionaries';
import type { Locale } from '@/lib/utils';

/* The address book.

   This screen used to render four cards invented from `src/lib/data.ts` — the
   house number was arithmetic on the array index — while sitting next to a
   create form that really did call the API. These tests pin the properties that
   made that split dangerous:

   · only what `GET /customer/addresses` returned is shown, and no invented row;
   · the area is resolved to its name rather than printed as a bare id;
   · "make default" PATCHes rather than mutating local state, because the API
     un-defaults the other rows in the same transaction;
   · removing is confirmed rather than fired on the first click;
   · a load failure is an error with a retry, never an empty list. */

const dict = getDictionary('en');
const locale: Locale = 'en';

const home: Address = {
  id: 'a1',
  label: 'Home',
  line1: '12 Street 7',
  line2: null,
  areaId: 14,
  lat: 31.5204,
  lng: 74.3587,
  notes: null,
  isDefault: true,
  createdAt: '2026-09-01T00:00:00.000Z'
};

const office: Address = {
  id: 'a2',
  label: 'Office',
  line1: '4 Canal Road',
  line2: 'Floor 3',
  areaId: 21,
  lat: 31.5497,
  lng: 74.3436,
  notes: 'Ring the bell twice',
  isDefault: false,
  createdAt: '2026-09-02T00:00:00.000Z'
};

const cities = { items: [{ id: 1, name: 'Lahore', timezone: 'Asia/Karachi' }] };
const areas = {
  items: [
    { id: 14, cityId: 1, name: 'Gulberg III' },
    { id: 21, cityId: 1, name: 'Johar Town' }
  ]
};

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

const problem = (status: number, code = 'INTERNAL_ERROR') =>
  new Response(JSON.stringify({ type: 'about:blank', title: 'x', status, code, detail: 'x', errors: [] }), { status, headers: { 'content-type': 'application/problem+json' } });

type Route = { match: (url: string, method: string) => boolean; respond: () => Response };

/** Routes only what the screen actually asks for, so an unexpected call fails. */
const route = (routes: Route[]) => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    for (const candidate of routes) {
      if (candidate.match(url, method)) return candidate.respond();
    }
    throw new Error(`unrouted ${method} ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

const callsTo = (mock: ReturnType<typeof route>, fragment: string, method = 'GET') =>
  mock.mock.calls.filter(([input, init]) => {
    const url = typeof input === 'string' ? input : String(input);
    return url.includes(fragment) && (init?.method ?? 'GET').toUpperCase() === method;
  });

const wrapperFor = (client: QueryClient) => {
  const Component = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return Component;
};

const renderBook = () =>
  render(<AddressBookView locale={locale} dict={dict} />, {
    wrapper: wrapperFor(
      /* `retryDelay: 0` because the hook asks for one retry on a 5xx, and the
         default backoff would push the failure-state assertion past its timeout. */
      new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0, gcTime: 0 } } })
    )
  });

const addressesRoute = (items: Address[]): Route => ({
  match: (url, method) => method === 'GET' && url.includes('/api/v1/customer/addresses'),
  respond: () => json({ items })
});

/* Order matters: `/places/cities/1/areas` also contains `/places/cities`, so the
   areas route has to be offered first or every area call is answered with the
   city list and no area name ever resolves. */
const placesRoutes: Route[] = [
  { match: (url) => url.includes('/areas'), respond: () => json(areas) },
  { match: (url) => url.includes('/places/cities'), respond: () => json(cities) }
];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the address book', () => {
  beforeEach(() => {
    route([addressesRoute([home, office]), ...placesRoutes]);
  });

  it('shows only the addresses the API returned', async () => {
    renderBook();
    expect(await screen.findByText('Home')).toBeDefined();
    expect(await screen.findByText('Office')).toBeDefined();
    /* The old mock built "House 24, Street 7" from the array index. */
    expect(screen.queryByText(/House \d+/)).toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('names the area instead of printing its id', async () => {
    renderBook();
    expect(await screen.findByText(/Home, 12 Street 7, Gulberg III/)).toBeDefined();
    expect(await screen.findByText(/Office, 4 Canal Road, Floor 3, Johar Town/)).toBeDefined();
  });

  it('shows the notes a customer saved', async () => {
    renderBook();
    expect(await screen.findByText('Ring the bell twice')).toBeDefined();
  });

  it('sends the archive only after the removal is confirmed', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'DELETE') return new Response(null, { status: 204 });
      if (method === 'GET' && url.includes('/customer/addresses')) return json({ items: [home, office] });
      if (url.includes('/areas')) return json(areas);
      if (url.includes('/places/cities')) return json(cities);
      throw new Error(`unrouted ${method} ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderBook();
    const remove = await screen.findByRole('button', { name: `${dict.portal.removeAddress}: Office` });

    fireEvent.click(remove);
    /* One click opens the confirmation and must not have removed anything. */
    expect(callsTo(fetchMock, '/customer/addresses/a2', 'DELETE')).toHaveLength(0);
    expect(await screen.findByText(dict.portal.removeAddressConfirm)).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: dict.portal.removeAddress }));
    await waitFor(() => expect(callsTo(fetchMock, '/customer/addresses/a2', 'DELETE')).toHaveLength(1));
  });

  it('makes an address default through the API rather than local state', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'PATCH') return json({ ...office, isDefault: true });
      if (method === 'GET' && url.includes('/customer/addresses')) return json({ items: [home, office] });
      if (url.includes('/areas')) return json(areas);
      if (url.includes('/places/cities')) return json(cities);
      throw new Error(`unrouted ${method} ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderBook();
    fireEvent.click(await screen.findByRole('button', { name: dict.portal.makeDefault }));

    await waitFor(() => expect(callsTo(fetchMock, '/customer/addresses/a2', 'PATCH')).toHaveLength(1));
    /* The whole list is refetched: the API un-defaults the others in the same
       transaction, so patching one row would leave two rows claiming to be the
       default until something else invalidated the query. */
    expect(callsTo(fetchMock, '/customer/addresses').length).toBeGreaterThan(1);
  });

  it('does not offer to make the current default address default', async () => {
    renderBook();
    await screen.findByText('Home');
    expect(screen.getAllByRole('button', { name: dict.portal.makeDefault })).toHaveLength(1);
  });
});

describe('the address book with no addresses', () => {
  beforeEach(() => {
    route([addressesRoute([]), ...placesRoutes]);
  });

  it('says so plainly instead of showing an empty grid', async () => {
    renderBook();
    expect(await screen.findByText(dict.portal.noAddresses)).toBeDefined();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  it('still offers the create form', async () => {
    renderBook();
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(dict.portal.addAddress, 'i') }));
    expect(await screen.findByText(dict.booking.pointLegend)).toBeDefined();
  });
});

describe('the address book when the API fails', () => {
  beforeEach(() => {
    route([{ match: (url, method) => method === 'GET' && url.includes('/customer/addresses'), respond: () => problem(500) }]);
  });

  it('reports the failure and offers a retry, never a blank list', async () => {
    renderBook();
    expect(await screen.findByText(dict.portal.addressesLoadError)).toBeDefined();
    expect(screen.queryByText(dict.portal.noAddresses)).toBeNull();
    expect(screen.getByRole('button', { name: new RegExp(dict.catalogue.retry, 'i') })).toBeDefined();
  });
});
