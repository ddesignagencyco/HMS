import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminCustomers } from '@/features/admin/customers-view';
import { getDictionary } from '@/lib/dictionaries';
import type { Locale } from '@/lib/utils';

/* The admin customer register — `GET /admin/customers` and
 * `POST /admin/customers/:id/deactivate`.
 *
 * The screen this replaced listed twenty invented customers, each with a booking
 * count, a lifetime-spend figure and an area, all from `src/lib/data.ts`. None of
 * that is in the response — `CustomerRow` is seven fields and none of them is a
 * number to do with money or bookings — so the tests below assert those columns
 * are *absent*, not merely absent from the fixture. A screen that quietly regrows
 * them from some other source is the failure worth catching.
 *
 * Two contract facts the tests pin:
 *
 * · **`status` is `user_status`** — ACTIVE, LOCKED or DEACTIVATED. The previous
 *   screen had a two-way ACTIVE/DEACTIVATED toggle, which cannot represent a
 *   LOCKED account at all, and LOCKED is exactly what a blocked account is.
 * · **A 403 is not an empty register.** Every admin route is `totpRequired`, so
 *   reporting "no customers" when the server said 403 would tell an operator the
 *   platform has no customers. */

const dict = getDictionary('en');
const locale: Locale = 'en';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

const wrap = ({ children }: { children: ReactNode }) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0, gcTime: 0 } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

const renderScreen = () => render(<AdminCustomers locale={locale} dict={dict} />, { wrapper: wrap });

const customer = (over: Record<string, unknown> = {}) => ({
  userId: '00000000-0000-4000-8000-000000000001',
  email: 'ayesha@example.com',
  phoneE164: '+923001234567',
  firstName: 'Ayesha',
  lastName: 'Khan',
  status: 'ACTIVE',
  createdAt: '2026-02-11T00:00:00.000Z',
  ...over
});

let items: ReturnType<typeof customer>[] = [];
let fetchMock: ReturnType<typeof vi.fn>;

const problem = (status: number, code: string, detail: string) =>
  new Response(JSON.stringify({ type: 'about:blank', title: 'x', status, code, detail, errors: [] }), {
    status,
    headers: { 'content-type': 'application/problem+json' }
  });

const stub = (): void => {
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method === 'POST' && url.includes('/deactivate')) return json({ id: 'x', status: 'DEACTIVATED' });
    if (method === 'POST' && url.includes('/send-reset')) return json({ sent: true });
    if (url.includes('/api/v1/admin/customers')) return json({ items });
    throw new Error(`unrouted ${method} ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
};

beforeEach(() => {
  items = [customer()];
  stub();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the admin customer register', () => {
  it('lists the accounts the API returned', async () => {
    renderScreen();
    expect(await screen.findByText('Ayesha Khan')).toBeDefined();
  });

  it('shows no lifetime value or booking count, because the endpoint has neither', async () => {
    renderScreen();
    await screen.findByText('Ayesha Khan');
    /* The old screen's headline figure was a sum of invented `spent` figures. There
       is no admin bookings list and no per-customer total, so there is nothing here
       to compute and nothing to approximate. */
    const body = document.body.textContent ?? '';
    expect(body).not.toMatch(/Rs\s[\d,]/);
    /* The old screen's stat tile was literally labelled "Lifetime value". */
    expect(body).not.toContain('Lifetime value');
  });

  it('masks the contact details, for admins too', async () => {
    renderScreen();
    await screen.findByText('Ayesha Khan');
    /* NFR-PR-01 makes no exception for staff, and `send-reset` delivers the code to
       the account owner, so nobody using this screen needs to read them. */
    expect(document.body.textContent).not.toContain('+923001234567');
    expect(document.body.textContent).not.toContain('ayesha@example.com');
  });

  it('names a LOCKED account as locked, not as deactivated', async () => {
    items = [customer({ status: 'LOCKED' })];
    stub();
    renderScreen();
    await screen.findByText('Ayesha Khan');
    /* `user_status` has three values and LOCKED is the one the old two-way screen
       could not represent at all. Asserted inside the table, because the
       "Deactivated" stat tile legitimately carries the same word. */
    const table = screen.getByRole('table');
    expect(within(table).getByText(dict.admin.locked)).toBeDefined();
    expect(within(table).queryByText(dict.admin.deactivated)).toBeNull();
  });

  it('offers no deactivate control on an account that is not active', async () => {
    items = [customer({ status: 'DEACTIVATED' })];
    stub();
    renderScreen();
    await screen.findByText('Ayesha Khan');
    /* `setUserStatus` answers 409 "This user is already DEACTIVATED", so the control
       would only ever produce an error. */
    expect(screen.queryByRole('button', { name: `${dict.admin.deactivateCustomer}: Ayesha Khan` })).toBeNull();
  });

  it('deactivates only after the confirmation, and states that nothing is deleted', async () => {
    renderScreen();
    await screen.findByText('Ayesha Khan');
    fireEvent.click(screen.getByRole('button', { name: `${dict.admin.deactivateCustomer}: Ayesha Khan` }));

    const confirm = screen.getByRole('group', { name: dict.admin.deactivateCustomer });
    /* FR-AD-09. "Deactivate" reads like "delete" to most people, and the database
       forbids deleting anyone who took part in a booking. */
    expect(within(confirm).getByText(dict.admin.deactivateCustomerConfirm).textContent).toMatch(/nothing is deleted/i);
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'POST')).toBe(false);

    fireEvent.click(within(confirm).getByRole('button', { name: dict.admin.deactivateCustomer }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url).includes('/deactivate') && (init as RequestInit | undefined)?.method === 'POST')).toBe(true));
  });

  it('never retries a privileged write', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if ((init?.method ?? 'GET') === 'POST') return problem(500, 'INTERNAL_ERROR', 'boom');
        return json({ items });
      })
    );
    renderScreen();
    await screen.findByText('Ayesha Khan');
    fireEvent.click(screen.getByRole('button', { name: `${dict.admin.deactivateCustomer}: Ayesha Khan` }));
    fireEvent.click(within(screen.getByRole('group', { name: dict.admin.deactivateCustomer })).getByRole('button', { name: dict.admin.deactivateCustomer }));

    /* Each attempt is a privileged decision about a real account, and each one is
       written to the audit log. A silent retry is a second decision nobody made. */
    await waitFor(() => expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST')).toHaveLength(1));
  });

  it('reports a 403 as a failure, never as an empty register', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => problem(403, 'TOTP_REQUIRED', 'Second factor required'))
    );
    renderScreen();
    expect(await screen.findByRole('alert')).toBeDefined();
    /* This is the assertion that matters: an empty register would tell an operator
       the platform has no customers. */
    expect(screen.queryByText(dict.admin.noCustomers)).toBeNull();
    expect(screen.getByText(dict.admin.adminTotpRequired)).toBeDefined();
  });

  it('sends the search term only when the form is submitted', async () => {
    renderScreen();
    await screen.findByText('Ayesha Khan');
    fireEvent.change(screen.getByLabelText(dict.admin.searchAccounts), { target: { value: 'ayesha' } });

    /* `q` is an `ILIKE '%…%'` substring match, so a request per keystroke is a table
       scan per keystroke. */
    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes('q='))).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: dict.admin.search }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes('q=ayesha'))).toBe(true));
  });

  it('says nothing matches rather than nothing exists, when a search was run', async () => {
    items = [];
    stub();
    renderScreen();
    fireEvent.change(await screen.findByLabelText(dict.admin.searchAccounts), { target: { value: 'nobody' } });
    fireEvent.click(screen.getByRole('button', { name: dict.admin.search }));
    expect(await screen.findByText(dict.admin.noMatchingCustomers)).toBeDefined();
    /* Two different claims, and conflating them is how an operator concludes the
       register is empty when a filter simply matched nothing. */
    expect(screen.queryByText(dict.admin.noCustomers)).toBeNull();
  });
});
