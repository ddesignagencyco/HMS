import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminPlans } from '@/features/plans/admin-plans-view';
import { CustomerPlansScreen } from '@/features/plans/customer-plans-view';
import { PlansCatalogue } from '@/features/plans/public-plans-view';
import { planName, planServiceName, planTotalVisits, subscriptionRemainingVisits } from '@/features/plans/api';
import { getDictionary } from '@/lib/dictionaries';
import type { Locale } from '@/lib/utils';

/* `react-hot-toast` writes into a portal that only exists once a
   `<Toaster />` is mounted, and these tests render the view in isolation,
   so a real toast would be invisible. Mocked here for the same reason the
   header and TOTP tests mock it.

   `auth-feedback.ts` does `import toast from 'react-hot-toast'` and calls
   `toast.success(...)`, so the spy that matters is on the **default**
   export's `.success` property — asserting on a named `toast` export
   would be asserting on a different object and pass vacuously. */
vi.mock('react-hot-toast', () => ({
  __esModule: true,
  default: Object.assign((message: unknown, options?: unknown) => void [message, options], { success: vi.fn(), error: vi.fn() }),
  Toaster: () => null
}));

const toast = (await import('react-hot-toast')).default;

/* Maintenance plans, on the eleven routes SHM-089 added.
 *
 * Every one of these screens used to state an absence, and the public
 * one used to *invent* — three tiers at Rs 4,900 / 8,900 / 14,900 with
 * 2, 4 and 6 visits, none of which existed in the database. The
 * properties pinned here are the ones a mock could not have had:
 *
 * · **A price is never invented and never recomputed.** The card shows
 *   `pricePaisa` exactly as returned. If a test seeds 490000 the screen
 *   says Rs 4,900 — and if the API returns a price no test predicted,
 *   the screen has to follow it, not round it toward a familiar tier.
 *
 * · **The five visit counts are reported separately.** A plan with four
 *   visits, one consumed and one refunded is *not* "3 remaining": the
 *   refunded one is gone money. The customer screen shows all five
 *   because the collapsing version is the misleading one.
 *
 * · **Subscribing routes to `checkout.returnUrl` and does not announce a
 *   confirmed plan.** The subscription only becomes ACTIVE when the
 *   gateway callback fires, so a screen that said "subscribed" on the
 *   strength of a POST would be lying to the customer about money.
 *
 * · **Cancelling sends the server's refund figure, not a preview.** There
 *   is no preview endpoint; a refund quoted before the call would be a
 *   money claim with nothing behind it.
 *
 * · **A 403 on the admin list is an error, never an empty catalogue.**
 *   "There are no plans" and "you may not see plans" are different
 *   statements and the screen must not conflate them.
 *
 * · **An admin create is refused client-side when the server would
 *   refuse it** — no name, or a plan with no services — because
 *   `planCreateSchema` is `.strict()` and `services` has `.min(1)`.
 */

const dict = getDictionary('en');
const locale: Locale = 'en';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const problem = (status: number, code: string, detail: string) =>
  new Response(JSON.stringify({ type: 'about:blank', title: 'x', status, code, detail, errors: [] }), { status, headers: { 'content-type': 'application/problem+json' } });

const wrap = ({ children }: { children: ReactNode }) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0, gcTime: 0 } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

const PLAN_UUID = '00000000-0000-4000-8000-00000000aa01';
const SUB_UUID = '00000000-0000-4000-8000-00000000bb01';
const ADDRESS_UUID = '00000000-0000-4000-8000-00000000cc01';

const plan = (over: Record<string, unknown> = {}) => ({
  id: PLAN_UUID,
  nameEn: 'Annual Care',
  nameUr: 'سالانہ نگہداشت',
  description: 'Twice-yearly visits for the jobs every home needs.',
  pricePaisa: 490000,
  durationMonths: 12,
  isActive: true,
  services: [
    { serviceId: 1, serviceNameEn: 'AC Service', serviceNameUr: 'اے سی سروس', visitsIncluded: 2, intervalDays: 180 },
    { serviceId: 2, serviceNameEn: 'Plumbing', serviceNameUr: 'پلمبنگ', visitsIncluded: 1, intervalDays: 180 }
  ],
  ...over
});

const subscription = (over: Record<string, unknown> = {}) => ({
  id: SUB_UUID,
  planId: PLAN_UUID,
  planNameEn: 'Annual Care',
  planNameUr: 'سالانہ نگہداشت',
  status: 'ACTIVE',
  startsAt: '2026-01-01T00:00:00.000Z',
  endsAt: '2027-01-01T00:00:00.000Z',
  cancelledAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  addressLabel: 'Home',
  addressLine1: '12 Street 7, Gulberg',
  preferredProviderId: null,
  /* `visitCount`, matching what `GET /me/subscriptions` actually sends. This
     fixture used to say `totalVisits`, which the server never returns — so the
     suite passed while the customer's own screen rendered "NaN". A fixture that
     invents a field name is worse than no fixture: it agrees with the bug. */
  visitCount: 3,
  pendingVisits: 2,
  bookedVisits: 0,
  consumedVisits: 1,
  refundedVisits: 0,
  ...over
});

const address = (over: Record<string, unknown> = {}) => ({
  id: ADDRESS_UUID,
  label: 'Home',
  line1: '12 Street 7, Gulberg',
  line2: '',
  cityId: 1,
  areaId: 1,
  lat: 31.5,
  lng: 74.3,
  isDefault: true,
  ...over
});

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

/* The catalogue also reads the category list to build its service picker. */
const withCatalogue = () => {
  fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/plans')) return json({ items: [plan()] });
    if (url.includes('/me/subscriptions')) return json({ items: [] });
    if (url.includes('/customer/addresses')) return json({ items: [address()] });
    if (url.includes('/catalogue/categories')) return json({ items: [] });
    return json({ items: [] });
  });
};

describe('plan helpers', () => {
  it('falls back to the other language rather than to the id', () => {
    expect(planName({ nameEn: 'Annual Care', nameUr: 'سالانہ' }, 'en')).toBe('Annual Care');
    expect(planName({ nameEn: 'Annual Care', nameUr: 'سالانہ' }, 'ur')).toBe('سالانہ');
    /* An empty Urdu name must not render as a blank heading. */
    expect(planName({ nameEn: 'Annual Care', nameUr: '' }, 'ur')).toBe('Annual Care');
  });

  it('reads an admin service row, which carries no Urdu name', () => {
    /* The admin list query joins `serviceNameEn` only — a client that
       asked for `serviceNameUr` there would be asking for a column the
       server never selected. */
    const row = { serviceId: 1, serviceNameEn: 'AC Service', visitsIncluded: 2, intervalDays: 180 };
    expect(planServiceName(row, 'ur')).toBe('AC Service');
    expect(planServiceName({ ...row, serviceNameUr: 'اے سی' } as never, 'ur')).toBe('اے سی');
  });

  it('sums the visits a plan includes, across its service rows', () => {
    expect(planTotalVisits(plan().services)).toBe(3);
  });

  it('counts remaining visits as pending + booked, excluding consumed and refunded', () => {
    expect(subscriptionRemainingVisits(subscription() as never)).toBe(2);
    /* A refunded visit is gone money, so it is not "remaining". */
    expect(subscriptionRemainingVisits(subscription({ pendingVisits: 1, bookedVisits: 1, consumedVisits: 1, refundedVisits: 1, visitCount: 4 }) as never)).toBe(2);
  });
});

describe('the public plan catalogue', () => {
  it('shows the price the API returned rather than a remembered tier', async () => {
    withCatalogue();
    render(<PlansCatalogue locale={locale} />, { wrapper: wrap });

    expect(await screen.findByText('Annual Care')).toBeTruthy();
    /* Rs 4,900 — 490000 paisa, straight from the row. */
    expect(screen.getByText('Rs 4,900')).toBeTruthy();
    /* The invented tier names are gone with the mock. */
    expect(screen.queryByText('Care Plus')).toBeNull();
    expect(screen.queryByText('Rs 8,900')).toBeNull();
  });

  it('renders each service line with the visit count and interval the plan defines', async () => {
    withCatalogue();
    render(<PlansCatalogue locale={locale} />, { wrapper: wrap });

    expect(await screen.findByText(/AC Service/)).toBeTruthy();
    expect(screen.getByText(/Plumbing/)).toBeTruthy();
    expect(screen.getByText(/3 visits/)).toBeTruthy();
  });

  it('says no plan is published when the catalogue is empty, and links somewhere useful', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/plans')) return json({ items: [] });
      return json({ items: [] });
    });
    render(<PlansCatalogue locale={locale} />, { wrapper: wrap });

    expect(await screen.findByText(dict.plansPage.emptyTitle)).toBeTruthy();
    /* Crucially, not a fallback tier card. */
    expect(screen.queryByText('Rs 4,900')).toBeNull();
    expect(screen.queryByText('Rs 8,900')).toBeNull();
    expect(screen.queryByText('Rs 14,900')).toBeNull();
  });

  it('reports a load failure rather than an empty catalogue', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes('/plans')) return problem(503, 'UNAVAILABLE', 'down');
      return json({ items: [] });
    });
    render(<PlansCatalogue locale={locale} />, { wrapper: wrap });

    expect(await screen.findByRole('alert')).toBeTruthy();
    /* A failure must not read as "no plans exist". */
    expect(screen.queryByText(dict.plansPage.emptyTitle)).toBeNull();
  });
});

describe('the customer plan screen', () => {
  it('shows all five visit counts, so a refunded visit is not counted as remaining', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/plans')) return json({ items: [plan()] });
      if (url.includes('/me/subscriptions')) return json({ items: [subscription({ pendingVisits: 1, bookedVisits: 1, consumedVisits: 1, refundedVisits: 1, visitCount: 4 })] });
      if (url.includes('/customer/addresses')) return json({ items: [address()] });
      return json({ items: [] });
    });
    render(<CustomerPlansScreen locale={locale} dict={dict} />, { wrapper: wrap });

    expect(await screen.findByText(dict.portal.plansActiveTitle)).toBeTruthy();
    for (const label of [dict.portal.planPendingVisits, dict.portal.planBookedVisits, dict.portal.planConsumedVisits, dict.portal.planRefundedVisits]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByText('4')).toBeTruthy();
  });

  it('renders the server\'s visitCount, not NaN', async () => {
    /* `GET /me/subscriptions` names the total `visitCount`. An earlier version of
     * the type called it `totalVisits`, a field the server never sends, and
     * `formatNumber(undefined)` renders the literal string "NaN" — on the
     * customer's own plan, in the total-visits line and the remaining-visits
     * line. Nothing caught it: the type was an assertion the runtime never
     * checked, and the fixture used here agreed with the bug rather than the
     * server. This asserts the absence of NaN, which is what a customer would
     * actually have seen. */
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/plans')) return json({ items: [plan()] });
      if (url.includes('/me/subscriptions')) return json({ items: [subscription({ visitCount: 7 })] });
      if (url.includes('/customer/addresses')) return json({ items: [address()] });
      return json({ items: [] });
    });
    render(<CustomerPlansScreen locale={locale} dict={dict} />, { wrapper: wrap });

    await screen.findByText(dict.portal.plansActiveTitle);
    expect(screen.queryByText(/NaN/)).toBeNull();
    /* The figure the server sent has to be the figure on screen. */
    expect(screen.getAllByText('7').length).toBeGreaterThan(0);
  });

  it('refuses to subscribe without an address, because the schema requires one the caller owns', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/plans')) return json({ items: [plan()] });
      if (url.includes('/me/subscriptions')) return json({ items: [] });
      /* No saved address: `planSubscribeSchema` would answer 400. */
      if (url.includes('/customer/addresses')) return json({ items: [] });
      return json({ items: [] });
    });
    render(<CustomerPlansScreen locale={locale} dict={dict} />, { wrapper: wrap });

    expect(await screen.findByText(dict.portal.planNoAddress)).toBeTruthy();
    const buttons = screen.getAllByRole('button', { name: new RegExp(dict.portal.planSubscribe, 'i') });
    for (const button of buttons) expect((button as HTMLButtonElement).disabled).toBe(true);
    /* And no subscribe request was attempted. */
    expect(fetchMock.mock.calls.filter((call) => String(call[0]).includes('/subscribe'))).toHaveLength(0);
  });

  it('sends the chosen address and follows the checkout url the server returns', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { assign });
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/subscribe')) {
        expect(init?.method).toBe('POST');
        return json({
          subscriptionId: SUB_UUID,
          paymentId: 'p1',
          startsAt: '2026-01-01T00:00:00.000Z',
          endsAt: '2027-01-01T00:00:00.000Z',
          visitsCount: 3,
          checkout: { returnUrl: 'https://gateway.test/checkout/abc' }
        });
      }
      if (url.includes('/plans')) return json({ items: [plan()] });
      if (url.includes('/me/subscriptions')) return json({ items: [] });
      if (url.includes('/customer/addresses')) return json({ items: [address()] });
      return json({ items: [] });
    });
    render(<CustomerPlansScreen locale={locale} dict={dict} />, { wrapper: wrap });

    await screen.findByText('Annual Care');
    fireEvent.change(screen.getByLabelText(dict.portal.planSelectAddress), { target: { value: ADDRESS_UUID } });
    fireEvent.click(screen.getAllByRole('button', { name: new RegExp(dict.portal.planSubscribe, 'i') })[0]);

    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://gateway.test/checkout/abc'));
    /* The body carried the address and an explicit null preferred pro. */
    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('/subscribe'));
    expect(JSON.parse(String((call?.[1] as RequestInit)?.body)).addressId).toBe(ADDRESS_UUID);
  });

  it('states the refund rule before cancelling and reports the server figure after', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/cancel')) {
        expect(init?.method).toBe('POST');
        return json({ subscriptionId: SUB_UUID, status: 'CANCELLED', refundedVisitsCount: 2, refundPaisa: 245000 });
      }
      if (url.includes('/plans')) return json({ items: [plan()] });
      if (url.includes('/me/subscriptions')) return json({ items: [subscription()] });
      if (url.includes('/customer/addresses')) return json({ items: [address()] });
      return json({ items: [] });
    });
    render(<CustomerPlansScreen locale={locale} dict={dict} />, { wrapper: wrap });

    await screen.findByText(dict.portal.plansActiveTitle);
    fireEvent.click(screen.getByRole('button', { name: dict.portal.planCancel }));

    /* The confirmation states the rule and quotes no number, because
       there is no preview endpoint to quote one from. */
    expect(screen.getByText(dict.portal.planCancelExplain)).toBeTruthy();

    /* Opening the panel *replaces* the trigger, so this is the only
       cancel button left — the confirming one. */
    fireEvent.click(screen.getByRole('button', { name: dict.portal.planCancel }));

    await waitFor(() => expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes('/cancel'))).toHaveLength(1));
    /* Rs 2,450 is what the server said, not a number this screen made.
       The toast is the only place that figure appears, so the assertion
       is on what was reported — and it must contain the server's refund
       and its visit count verbatim. */
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const message = String((toast.success as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] ?? '');
    expect(message).toContain('Rs 2,450');
    expect(message).toContain('2');
  });

  it("fetches the visit schedule only when asked, and shows the server's per-visit values", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes(`/subscriptions/${SUB_UUID}`)) {
        return json({
          id: SUB_UUID,
          customerId: '00000000-0000-4000-8000-00000000aa99',
          planId: PLAN_UUID,
          planNameEn: 'Annual Care',
          planNameUr: 'سالانہ نگہداشت',
          planPricePaisa: 490000,
          status: 'ACTIVE',
          startsAt: '2026-01-01T00:00:00.000Z',
          endsAt: '2027-01-01T00:00:00.000Z',
          cancelledAt: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          addressId: ADDRESS_UUID,
          addressLabel: 'Home',
          addressLine1: '12 Street 7, Gulberg',
          preferredProviderId: null,
          visits: [
            { id: 'v1', serviceId: 1, serviceNameEn: 'AC Service', dueDate: '2026-07-01', status: 'PENDING', valuePaisa: 163334, bookingId: null },
            { id: 'v2', serviceId: 2, serviceNameEn: 'Plumbing', dueDate: '2026-07-01', status: 'BOOKED', valuePaisa: 163333, bookingId: '00000000-0000-4000-8000-00000000bb99' }
          ]
        });
      }
      if (url.includes('/plans')) return json({ items: [plan()] });
      if (url.includes('/me/subscriptions')) return json({ items: [subscription()] });
      if (url.includes('/customer/addresses')) return json({ items: [address()] });
      return json({ items: [] });
    });
    render(<CustomerPlansScreen locale={locale} dict={dict} />, { wrapper: wrap });

    await screen.findByText(dict.portal.plansActiveTitle);
    /* Not fetched until asked for. */
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes(`/subscriptions/${SUB_UUID}`))).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: dict.portal.planViewSchedule }));

    expect(await screen.findByText(dict.portal.planVisitSchedule)).toBeTruthy();
    expect(screen.getByText('AC Service')).toBeTruthy();
    /* The two visits carry the exact split `splitEvenly` produced —
       163334 + 163333 = 490000, so the remainder lands on one row
       rather than being lost. `formatMoney` renders whole rupees
       everywhere in this app, so both rows read Rs 1,633: the paisa
       difference is in the stored values, not in the label. Asserted
       as two rows rather than one, which is what proves both visits
       were rendered. */
    expect(screen.getAllByText('Rs 1,633')).toHaveLength(2);
    expect(screen.getByText('BOOKED')).toBeTruthy();
    expect(screen.getByText('PENDING')).toBeTruthy();
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes(`/subscriptions/${SUB_UUID}`))).toHaveLength(1);
  });

  it('splits live and cancelled plans, and offers no cancel on a dead one', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/plans')) return json({ items: [plan()] });
      if (url.includes('/me/subscriptions')) {
        return json({
          items: [subscription({ id: SUB_UUID, status: 'ACTIVE' }), subscription({ id: '00000000-0000-4000-8000-00000000bb02', status: 'CANCELLED', cancelledAt: '2026-06-01T00:00:00.000Z' })]
        });
      }
      if (url.includes('/customer/addresses')) return json({ items: [address()] });
      return json({ items: [] });
    });
    render(<CustomerPlansScreen locale={locale} dict={dict} />, { wrapper: wrap });

    await screen.findByText(dict.portal.plansActiveTitle);
    expect(screen.getByText(dict.portal.plansHistoryTitle)).toBeTruthy();
    /* Exactly one cancel control: the cancelled plan has nothing to cancel. */
    expect(screen.getAllByRole('button', { name: dict.portal.planCancel })).toHaveLength(1);
  });
});

describe('the admin plan screen', () => {
  const catalogueOnly = () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/admin/plans')) return json({ items: [plan({ activeSubscriptionsCount: 12 })] });
      if (url.includes('/catalogue/categories')) return json({ items: [] });
      return json({ items: [] });
    });
  };

  it('shows the price and the active-subscription count the server returned', async () => {
    catalogueOnly();
    render(<AdminPlans locale={locale} dict={dict} />, { wrapper: wrap });

    expect(await screen.findByText('Annual Care')).toBeTruthy();
    expect(screen.getByText('Rs 4,900')).toBeTruthy();
    /* `12` is both the duration and the subscriber count, so the
       assertion scopes to the definition list row rather than the page. */
    const rowValue = (label: string) => screen.getByText(label).parentElement?.querySelector('dd')?.textContent;
    expect(rowValue(dict.admin.plansActiveSubs)).toBe('12');
    expect(rowValue(dict.admin.plansDurationMonths)).toBe('12');
  });

  it('reports a 403 as a failure, never as an empty catalogue', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes('/admin/plans')) return problem(403, 'TOTP_REQUIRED', 'Two factor verification is required');
      return json({ items: [] });
    });
    render(<AdminPlans locale={locale} dict={dict} />, { wrapper: wrap });

    expect(await screen.findByRole('alert')).toBeTruthy();
    /* "no plans exist" would be a different, and wrong, statement. */
    expect(screen.queryByText(dict.admin.plansEmpty)).toBeNull();
  });

  it('will not submit a create form that the schema would refuse', async () => {
    catalogueOnly();
    render(<AdminPlans locale={locale} dict={dict} />, { wrapper: wrap });

    await screen.findByText('Annual Care');
    fireEvent.click(screen.getByRole('button', { name: dict.admin.plansCreate }));

    const create = await screen.findByRole('button', { name: dict.admin.plansCreateAction });
    /* Empty name, empty price, no services — `.min(1)` on services. */
    expect((create as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(dict.admin.plansNameEn), { target: { value: 'Winter Cover' } });
    fireEvent.change(screen.getByLabelText(dict.admin.plansNameUr), { target: { value: 'سرد مکان' } });
    fireEvent.change(screen.getByLabelText(dict.admin.plansDescription), { target: { value: 'Twice a year.' } });
    fireEvent.change(screen.getByLabelText(dict.admin.plansPricePaisa), { target: { value: '490000' } });
    fireEvent.change(screen.getByLabelText(dict.admin.plansDurationMonths), { target: { value: '12' } });

    /* Still no service picked, so `.min(1)` still fails. */
    await waitFor(() => expect((screen.getByRole('button', { name: dict.admin.plansCreateAction }) as HTMLButtonElement).disabled).toBe(true));

    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes('/admin/plans') && (c[1] as RequestInit)?.method === 'POST')).toHaveLength(0);
  });

  it('deactivates through DELETE and says what that does and does not do', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/admin/plans') && init?.method === 'DELETE') return json({ id: PLAN_UUID, isActive: false });
      if (url.includes('/admin/plans')) return json({ items: [plan({ activeSubscriptionsCount: 12 })] });
      if (url.includes('/catalogue/categories')) return json({ items: [] });
      return json({ items: [] });
    });
    render(<AdminPlans locale={locale} dict={dict} />, { wrapper: wrap });

    await screen.findByText('Annual Care');
    fireEvent.click(screen.getByRole('button', { name: dict.admin.plansDeactivate }));

    /* The confirmation is explicit that nobody is charged and nothing is cancelled. */
    expect(screen.getByText(dict.admin.plansDeactivateExplain)).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: dict.admin.plansDeactivate })[1]);

    await waitFor(() => expect(fetchMock.mock.calls.some((c) => String(c[0]).includes(`/admin/plans/${PLAN_UUID}`) && (c[1] as RequestInit)?.method === 'DELETE')).toBe(true));
  });

  it('offers republishing only on a deactivated plan, as a PATCH', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/admin/plans') && init?.method === 'PATCH') return json({ ...plan({ isActive: true }) });
      if (url.includes('/admin/plans')) return json({ items: [plan({ isActive: false, activeSubscriptionsCount: 0 })] });
      if (url.includes('/catalogue/categories')) return json({ items: [] });
      return json({ items: [] });
    });
    render(<AdminPlans locale={locale} dict={dict} />, { wrapper: wrap });

    await screen.findByText('Annual Care');
    expect(screen.getByText(dict.admin.plansInactive)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: dict.admin.plansReactivate }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => String(c[0]).includes(`/admin/plans/${PLAN_UUID}`) && (c[1] as RequestInit)?.method === 'PATCH');
      expect(call).toBeTruthy();
      expect(JSON.parse(String((call?.[1] as RequestInit)?.body))).toEqual({ isActive: true });
    });
  });

  it('has no service editor on the edit form, because the patch schema has none', async () => {
    catalogueOnly();
    render(<AdminPlans locale={locale} dict={dict} />, { wrapper: wrap });

    await screen.findByText('Annual Care');
    fireEvent.click(screen.getByRole('button', { name: dict.admin.plansEditAction }));

    expect(await screen.findByText(dict.admin.plansServicesFixed)).toBeTruthy();
    /* No "add a service" control in the editor: there is no route to save it. */
    const editor = screen.getByRole('heading', { name: dict.admin.plansEditTitle }).closest('div')?.parentElement ?? document.body;
    expect(editor.textContent).not.toContain(dict.admin.plansAddService);
  });
});
