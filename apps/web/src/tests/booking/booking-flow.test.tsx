import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BookingFlow } from '@/features/booking/booking-flow';
import { getDictionary } from '@/lib/dictionaries';
import type { Locale } from '@/lib/utils';
import type { CatalogueService } from '@/features/catalogue/api';
import type { Booking, Quote } from '@/features/booking/api';

/* The booking flow, driven through the steps a customer actually takes.

   What is being protected here is not "the form works" but three specific
   claims the flow must not make:

   · **No total is computed in this app.** Every figure on the review step comes
     from `POST /bookings/quote`. The catalogue's `basePricePaisa` appears in the
     sidebar as a *guide* and is labelled as one, because a FLAT price, an
     INSPECTION_FIRST visit fee and an emergency surcharge are three different
     shapes and only the server knows which applies.

   · **An auto-assigned booking has no slot.** There is no professional to ask, so
     the flow offers a *requested* window and says on screen that nothing is held.
     Showing a confirmed slot for a job that has not been accepted would be the
     single most misleading thing this module could do.

   · **A slot is not reserved.** It is offered from live availability and can be
     lost; a 409 sends the customer back with refreshed times rather than a retry
     of the one that just failed. */

const dict = getDictionary('en');
const locale: Locale = 'en';
const text = () => document.body.textContent ?? '';

const service: CatalogueService = {
  id: 7,
  categoryId: 1,
  slug: 'leak-repair',
  nameEn: 'Leak Repair',
  nameUr: 'واہی کی مرمت',
  description: 'Diagnose and repair an indoor or outdoor leak.',
  pricingModel: 'FLAT',
  timeUnit: null,
  basePricePaisa: 250000,
  minPricePaisa: 250000,
  maxPricePaisa: 250000,
  visitFeePaisa: 0,
  expectedDurationMin: 90,
  isEmergencyEligible: true,
  isPlanEligible: false,
  warrantyDays: 30,
  isHighRisk: false,
  isActive: true
};

const quote: Quote = {
  currency: 'PKR',
  servicePaisa: 250000,
  visitFeePaisa: 0,
  emergencySurchargePaisa: 0,
  discountPaisa: 0,
  totalPaisa: 250000,
  outstandingReceivablePaisa: 0,
  payablePaisa: 250000,
  lines: [{ kind: 'SERVICE', description: 'Leak Repair', amountPaisa: 250000 }],
  cancellationPolicy: 'Free cancellation up to 4 hours before your slot.'
};

const address = {
  id: 'a1',
  label: 'Home',
  line1: 'House 24, street 7',
  line2: null,
  areaId: 1,
  lat: 31.5204,
  lng: 74.3587,
  notes: null,
  isDefault: true,
  createdAt: '2026-09-01T00:00:00.000Z'
};

const created: Booking = {
  id: 'b1',
  code: 'SHM-0000001',
  customerId: 'c1',
  providerId: null,
  serviceId: 7,
  addressId: 'a1',
  status: 'REQUESTED',
  paymentMode: 'CASH',
  paymentStatus: 'NONE',
  isEmergency: false,
  isAutoAssign: true,
  scheduledStart: '2026-10-06T04:00:00.000Z',
  scheduledEnd: '2026-10-06T05:30:00.000Z',
  problemText: 'Kitchen tap is leaking',
  quotedAmountPaisa: 250000,
  approvedTotalPaisa: 250000,
  finalAmountPaisa: null,
  discountPaisa: 0,
  rescheduleCount: 0,
  noShowParty: null,
  cancelReason: null,
  startOtpVerifiedAt: null,
  completedAt: null,
  verificationTier: null,
  createdAt: '2026-10-05T09:00:00.000Z',
  updatedAt: '2026-10-05T09:00:00.000Z',
  issueOptionId: null,
  isOnBehalf: false,
  onBehalfName: null
};

type Routes = {
  addresses?: unknown;
  providers?: unknown;
  slots?: unknown;
  quote?: unknown;
  create?: { status: number; body: unknown };
  slotTaken?: boolean;
};

const problem = (status: number, code: string, detail = 'x') => ({ type: 'about:blank', title: 'x', status, code, detail, errors: [] });

/** One router over the endpoints this flow touches, recording what was sent. */
const stubApi = (routes: Routes = {}) => {
  const sent: { url: string; body: Record<string, unknown> }[] = [];
  const areas = { items: [{ id: 1, cityId: 1, name: 'Gulberg' }] };
  const cities = { items: [{ id: 1, name: 'Lahore', timezone: 'Asia/Karachi' }] };
  const providers = routes.providers ?? {
    items: [
      {
        providerId: '00000000-0000-4000-8000-000000000098',
        bio: 'Seeded test provider.',
        experienceYears: 5,
        qualification: 'Licensed plumber',
        pricePaisa: 240000,
        distanceM: 1200,
        ratingScore: 3.5,
        ratingCount: 0,
        badge: null
      }
    ]
  };
  const slots = routes.slots ?? {
    date: '2026-10-06',
    durationMin: 90,
    items: [{ start: '2026-10-06T05:00:00.000Z', end: '2026-10-06T06:30:00.000Z' }]
  };

  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url);
    sent.push({ url: path, body: init?.body === undefined ? {} : (JSON.parse(String(init.body)) as Record<string, unknown>) });
    const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

    if (path.includes('/customer/addresses')) return ok(routes.addresses ?? { items: [address] });
    if (path.includes('/places/cities/1/areas')) return ok(areas);
    if (path.includes('/places/cities')) return ok(cities);
    if (path.includes('/search/providers') && path.includes('/slots')) return ok(slots);
    if (path.includes('/search/providers')) return ok(providers);
    if (path.endsWith('/bookings/quote')) return ok(routes.quote ?? quote);
    if (path.endsWith('/bookings') && init?.method === 'POST') {
      if (routes.slotTaken === true) {
        return new Response(JSON.stringify(problem(409, 'SLOT_TAKEN', 'That provider is no longer free at this time')), {
          status: 409,
          headers: { 'content-type': 'application/json' }
        });
      }
      const spec = routes.create ?? { status: 201, body: created };
      return new Response(JSON.stringify(spec.body), { status: spec.status, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify(problem(404, 'NOT_FOUND')), { status: 404, headers: { 'content-type': 'application/json' } });
  });

  vi.stubGlobal('fetch', fetchMock);
  return { sent, fetchMock };
};

const renderFlow = (props: Partial<React.ComponentProps<typeof BookingFlow>> = {}) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const Component = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return render(<BookingFlow locale={locale} dict={dict} service={service} initialProviderId={null} initialDate={null} initialStart={null} {...props} />, {
    wrapper: Component
  });
};

/** Times look like `9:00 am`; the stepper's dots read `3Schedule`, so a bare
    /^\d/ would match the progress rail instead of the picker. */
const timeButtons = (): HTMLElement[] => screen.getAllByRole('button', { name: /^\d{1,2}:\d{2}/ });

/** Walks steps 1–3 for an auto-assign booking, which needs no live availability. */
const reachReview = async (): Promise<void> => {
  await screen.findByText('Home');
  fireEvent.click(screen.getByRole('radio', { name: /Home/ }));
  fireEvent.click(screen.getByRole('button', { name: new RegExp(dict.common.continue, 'i') }));

  await screen.findByText(dict.booking.autoAssignTitle);
  fireEvent.click(screen.getByRole('radio', { name: new RegExp(dict.booking.autoAssignTitle) }));
  fireEvent.click(screen.getByRole('button', { name: new RegExp(dict.common.continue, 'i') }));

  await screen.findByText(dict.booking.requestedTimeTitle);
  fireEvent.click(timeButtons()[0]);
  fireEvent.click(screen.getByRole('button', { name: new RegExp(dict.common.continue, 'i') }));

  await screen.findByLabelText(dict.booking.problemLabel);
  fireEvent.change(screen.getByLabelText(dict.booking.problemLabel), { target: { value: 'The kitchen tap has been leaking since Monday.' } });
  fireEvent.click(screen.getByRole('button', { name: new RegExp(dict.common.continue, 'i') }));
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('step one — the address', () => {
  it('offers the addresses the API returned and no others', async () => {
    stubApi();
    renderFlow();
    expect(await screen.findByText('Home')).toBeDefined();
    expect(text()).toContain('House 24, street 7');
    /* No free-text address: `POST /bookings` takes an addressId, so a typed
       address could not be attached to the booking at all. */
    expect(screen.queryByLabelText(dict.booking.houseLabel)).toBeNull();
  });

  it('sends the customer to the create form when they have no saved address', async () => {
    stubApi({ addresses: { items: [] } });
    renderFlow();
    expect(await screen.findByText(dict.booking.newAddressTitle)).toBeDefined();
    expect(text()).toContain(dict.booking.noAddressesYet);
  });

  it('refuses to leave the step with no address chosen', async () => {
    stubApi();
    renderFlow();
    await screen.findByText('Home');
    fireEvent.click(screen.getByRole('button', { name: new RegExp(dict.common.continue, 'i') }));
    expect(text()).toContain(dict.booking.requiredAddress);
    /* Still on step one. */
    expect(screen.queryByText(dict.booking.newAddressTitle)).toBeNull();
  });

  it('reports an address load failure instead of showing an empty picker', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        String(url).includes('/customer/addresses')
          ? new Response(JSON.stringify(problem(500, 'INTERNAL_ERROR')), { status: 500, headers: { 'content-type': 'application/json' } })
          : new Response(JSON.stringify({ items: [] }), { status: 200 })
      )
    );
    renderFlow();
    /* A 500 earns one bounded retry, so this waits past the retry delay. */
    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined(), { timeout: 5_000 });
    expect(text()).toContain(dict.booking.addressesError);
    /* Not the empty-address create form: a failure to read the list is not the
       same fact as having no addresses, and offering "add one" would send the
       customer to re-enter an address they may already have saved. */
    expect(screen.queryByText(dict.booking.newAddressTitle)).toBeNull();
  });
});

describe('step two — choosing a professional', () => {
  const chooseAddress = async (): Promise<void> => {
    await screen.findByText('Home');
    fireEvent.click(screen.getByRole('radio', { name: /Home/ }));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(dict.common.continue, 'i') }));
  };

  it('offers auto-assign alongside the professionals the search returned', async () => {
    stubApi();
    renderFlow();
    await chooseAddress();
    expect(await screen.findByText(dict.booking.autoAssignTitle)).toBeDefined();
    /* The professional list is a search and lands after the step renders, so it
       is awaited rather than asserted synchronously. */
    await waitFor(() => expect(text()).toContain('Licensed plumber'), { timeout: 5_000 });
  });

  it('says plainly that an auto-assigned booking is priced at the standard rate', async () => {
    stubApi();
    renderFlow();
    await chooseAddress();
    await screen.findByText(dict.booking.autoAssignTitle);
    /* Auto-assign is priced by the server at the service base price rather than a
       chosen professional's rate, so the copy must not imply a personal quote. */
    expect(text()).toContain(dict.booking.autoAssignText);
  });

  it('does not claim a rating for a professional with none', async () => {
    stubApi();
    renderFlow();
    await chooseAddress();
    await screen.findByText(dict.booking.autoAssignTitle);
    await waitFor(() => expect(text()).toContain('Licensed plumber'), { timeout: 5_000 });
    /* `ratingScore` is a Bayesian prior: 3.5 with zero ratings. Rendering it next
       to a star would be a rating nobody has given. */
    expect(text()).toContain(dict.booking.noRatingsYet);
    expect(text()).not.toContain('3.5 / 5');
  });

  it('reports a genuine empty result rather than an error', async () => {
    stubApi({ providers: { items: [] } });
    renderFlow();
    await chooseAddress();
    await waitFor(() => expect(text()).toContain(dict.booking.noProviders), { timeout: 5_000 });
    /* Auto-assign remains available, so an empty search is not a dead end. */
    expect(text()).toContain(dict.booking.autoAssignTitle);
  });
});

describe('step three — the time', () => {
  const reachSchedule = async (auto: boolean): Promise<void> => {
    await screen.findByText('Home');
    fireEvent.click(screen.getByRole('radio', { name: /Home/ }));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(dict.common.continue, 'i') }));
    await screen.findByText(dict.booking.autoAssignTitle);
    if (auto) {
      fireEvent.click(screen.getByRole('radio', { name: new RegExp(dict.booking.autoAssignTitle) }));
    } else {
      /* A radio's accessible name is its whole card, so the qualification is
         matched inside the label rather than as the name itself. */
      const card = await screen.findByRole('radio', { name: /Licensed plumber/ });
      fireEvent.click(card);
    }
    fireEvent.click(screen.getByRole('button', { name: new RegExp(dict.common.continue, 'i') }));
  };

  it('offers requested windows and says none of them is held', async () => {
    stubApi();
    renderFlow();
    await reachSchedule(true);
    expect(await screen.findByText(dict.booking.requestedTimeTitle)).toBeDefined();
    /* The honest sentence. There is no professional yet, so there is no slot. */
    expect(text()).toContain(dict.booking.requestedTimeText);
  });

  it('never calls the availability endpoint for an auto-assigned booking', async () => {
    const { fetchMock } = stubApi();
    renderFlow();
    await reachSchedule(true);
    await screen.findByText(dict.booking.requestedTimeTitle);
    /* `/slots` is keyed on a provider. An auto-assign booking has none, so asking
       would be asking about a professional who has not accepted yet. */
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/slots'))).toBe(false);
  });

  it("offers a named professional's real availability instead", async () => {
    const { fetchMock } = stubApi();
    renderFlow();
    await reachSchedule(false);
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/slots'))).toBe(true), { timeout: 5_000 });
    /* The slot list arrives after the step renders. */
    await waitFor(() => expect(text()).toContain(dict.booking.slotsAreNotHeld), { timeout: 5_000 });
    expect(text()).not.toContain(dict.booking.requestedTimeTitle);
  });

  it('offers the emergency option only on an emergency-eligible service', async () => {
    stubApi();
    renderFlow({ service: { ...service, isEmergencyEligible: false } });
    await reachSchedule(true);
    await screen.findByText(dict.booking.requestedTimeTitle);
    /* FR-CAT-06. The API rejects `isEmergency: true` on an ineligible service
       with a 400, so the control must not exist at all. */
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('refuses to leave without a time', async () => {
    stubApi();
    renderFlow();
    await reachSchedule(true);
    await screen.findByText(dict.booking.requestedTimeTitle);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(dict.common.continue, 'i') }));
    expect(text()).toContain(dict.booking.requiredSlot);
  });
});

describe("step five — the review shows the server's price and nothing else", () => {
  it("renders the quote's own line items, total and policy", async () => {
    stubApi();
    renderFlow();
    await reachReview();

    await screen.findByText(dict.booking.reviewTitle);
    expect(text()).toContain('Leak Repair');
    /* Rs 2,500 — the quote's 250000 paisa, not the catalogue's arithmetic. */
    expect(text()).toContain('Rs 2,500');
    expect(text()).toContain(quote.cancellationPolicy);
  });

  it('never computes a total the API did not send', async () => {
    /* The catalogue's visit fee is 0 and the emergency surcharge has not been
       ticked. A locally computed total would still be Rs 2,500 here, so the
       sharper case is a quote that disagrees with the catalogue. */
    stubApi({
      quote: {
        ...quote,
        servicePaisa: 200000,
        emergencySurchargePaisa: 50000,
        totalPaisa: 250000,
        payablePaisa: 250000,
        lines: [
          { kind: 'SERVICE', description: 'Leak Repair', amountPaisa: 200000 },
          { kind: 'SURCHARGE', description: 'Emergency surcharge', amountPaisa: 50000 }
        ]
      }
    });
    renderFlow();
    await reachReview();
    await screen.findByText(dict.booking.reviewTitle);
    /* Both server lines appear; the base price is not quietly substituted. */
    expect(text()).toContain('Rs 2,000');
    expect(text()).toContain('Rs 500');
  });

  it('shows an outstanding balance as separate from the booking total', async () => {
    stubApi({ quote: { ...quote, outstandingReceivablePaisa: 50000, payablePaisa: 300000 } });
    renderFlow();
    await reachReview();
    await screen.findByText(dict.booking.reviewTitle);
    /* FR-PY-11: Rs 500 is owed on an earlier cancelled job, so it is shown as
       something separate from what this booking costs. */
    expect(text()).toContain(dict.booking.outstandingFees);
    expect(text()).toContain(dict.booking.payable);
    expect(text()).toContain('Rs 3,000');
  });

  it('will not let the booking be confirmed before the estimate is acknowledged', async () => {
    stubApi();
    renderFlow();
    await reachReview();
    await screen.findByText(dict.booking.reviewTitle);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(dict.common.continue, 'i') }));
    expect(text()).toContain(dict.booking.requiredAgreement);
  });

  it('labels the sidebar figure as a guide, because the total is worked out later', async () => {
    stubApi();
    renderFlow();
    await screen.findByText('Home');
    expect(text()).toContain(dict.booking.estimateIsGuide);
  });
});

/**
 * The same journey, but for a booking aimed at one professional.
 *
 * This is the only path on which SLOT_TAKEN can happen at all: the exclusion
 * constraint is on (provider_id, slot), and an auto-assign booking has a null
 * provider until somebody accepts, so two customers cannot collide on it.
 */
const reachPaymentForChosenProvider = async (routes: Routes = {}): Promise<{ sent: { url: string; body: Record<string, unknown> }[] }> => {
  const api = stubApi(routes);
  renderFlow();
  await screen.findByText('Home');
  fireEvent.click(screen.getByRole('radio', { name: /Home/ }));
  fireEvent.click(screen.getByRole('button', { name: new RegExp(dict.common.continue, 'i') }));

  await screen.findByText(dict.booking.autoAssignTitle);
  fireEvent.click(await screen.findByRole('radio', { name: /Licensed plumber/ }));
  fireEvent.click(screen.getByRole('button', { name: new RegExp(dict.common.continue, 'i') }));

  /* Pick the live slot the availability endpoint returned. */
  await waitFor(() => expect(screen.getAllByRole('button', { name: /^\d{1,2}:\d{2}/ }).length).toBeGreaterThan(0), { timeout: 5_000 });
  fireEvent.click(screen.getAllByRole('button', { name: /^\d{1,2}:\d{2}/ })[0]);
  fireEvent.click(screen.getByRole('button', { name: new RegExp(dict.common.continue, 'i') }));

  await screen.findByLabelText(dict.booking.problemLabel);
  fireEvent.change(screen.getByLabelText(dict.booking.problemLabel), { target: { value: 'The kitchen tap has been leaking since Monday.' } });
  fireEvent.click(screen.getByRole('button', { name: new RegExp(dict.common.continue, 'i') }));

  await screen.findByText(dict.booking.reviewTitle);
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: new RegExp(dict.common.continue, 'i') }));

  await screen.findByText(dict.booking.paymentTitle);
  fireEvent.click(screen.getByRole('radio', { name: new RegExp(dict.booking.cash) }));
  return api;
};

describe('a slot that is lost between listing and checkout', () => {
  it('sends the customer back to the time step with nothing preselected', async () => {
    await reachPaymentForChosenProvider({ slotTaken: true });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(dict.booking.confirm, 'i') }));

    /* 409 SLOT_TAKEN is the documented outcome of two people taking one slot, and
       the database's exclusion constraint is final. Retrying the same instant
       would fail identically, so the customer is returned to availability. */
    await waitFor(() => expect(text()).toContain(dict.booking.slotTaken), { timeout: 5_000 });
    expect(text()).toContain(dict.booking.slotsAreNotHeld);
    /* The time that was just lost is not still selected. */
    expect(screen.getAllByRole('button', { name: /^\d{1,2}:\d{2}/ })[0].getAttribute('aria-pressed')).toBe('false');
    /* And no success screen was shown: nothing was created. */
    expect(screen.queryByRole('link', { name: dict.booking.viewBooking })).toBeNull();
  });

  it('sends the chosen professional and the exact slot to the API', async () => {
    const { sent } = await reachPaymentForChosenProvider();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(dict.booking.confirm, 'i') }));

    await waitFor(() => expect(screen.queryByRole('link', { name: dict.booking.viewBooking })).not.toBeNull(), { timeout: 5_000 });
    const create = sent.find((call) => call.url.endsWith('/bookings') && call.body.paymentMode !== undefined);
    expect(create?.body.providerId).toBe('00000000-0000-4000-8000-000000000098');
    expect(create?.body.scheduledStart).toBe('2026-10-06T05:00:00.000Z');
    /* Both instants: the API refuses a start on its own. */
    expect(create?.body.scheduledEnd).toBe('2026-10-06T06:30:00.000Z');
  });
});

describe('step six — payment and the outcome', () => {
  const reachPayment = async (): Promise<void> => {
    await reachReview();
    await screen.findByText(dict.booking.reviewTitle);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(dict.common.continue, 'i') }));
    await screen.findByText(dict.booking.paymentTitle);
  };

  it('offers cash and online payment, and refuses to continue without one', async () => {
    stubApi();
    renderFlow();
    await reachPayment();
    expect(text()).toContain(dict.booking.cash);
    expect(text()).toContain(dict.booking.online);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(dict.booking.confirm, 'i') }));
    expect(text()).toContain(dict.booking.requiredPayment);
  });

  it("confirms with the server's own body and shows the real reference", async () => {
    const { sent } = stubApi();
    renderFlow();
    await reachPayment();

    fireEvent.click(screen.getByRole('radio', { name: new RegExp(dict.booking.cash) }));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(dict.booking.confirm, 'i') }));

    expect(await screen.findByText('SHM-0000001')).toBeDefined();
    const create = sent.find((call) => call.url.endsWith('/bookings') && call.body.paymentMode !== undefined);
    /* The auto-assigned booking must not carry a providerId: its absence is the
       only thing that triggers the offer cascade. */
    expect(create?.body.paymentMode).toBe('CASH');
    expect('providerId' in (create?.body ?? {})).toBe(false);
    expect(create?.body.addressId).toBe('a1');
  });

  it('does not claim an online booking is placed before payment is captured', async () => {
    const redirectUrl = '/api/v1/dev/payments/p1?returnUrl=%2Fcheckout%2Freturn';
    stubApi({ create: { status: 201, body: { ...created, status: 'PENDING_PAYMENT', paymentMode: 'ONLINE', payment: { paymentId: 'p1', redirectUrl } } } });
    renderFlow();
    await reachPayment();

    fireEvent.click(screen.getByRole('radio', { name: new RegExp(dict.booking.online) }));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(dict.booking.confirm, 'i') }));

    /* A 201 with a redirectUrl means "held, not yet booked": the webhook has not
       fired. Saying the request is in would be a claim the platform cannot make. */
    expect(await screen.findByText(dict.booking.awaitingPaymentTitle)).toBeDefined();
    expect(screen.getByRole('link', { name: dict.booking.payNow }).getAttribute('href')).toBe(redirectUrl);
  });

  it('reports an auto-assigned booking as awaiting a professional, not as failed', async () => {
    stubApi();
    renderFlow();
    await reachPayment();
    fireEvent.click(screen.getByRole('radio', { name: new RegExp(dict.booking.cash) }));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(dict.booking.confirm, 'i') }));

    await screen.findByText('SHM-0000001');
    /* providerId is null until somebody accepts, which for an auto-assign job can
       take a while. "Not yet assigned" is the truth; an error would be a lie. */
    expect(text()).toContain(dict.booking.awaitingAssignment);
  });

  it('says nothing was charged when the booking could not be created', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const path = String(url);
        const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
        if (path.includes('/customer/addresses')) return ok({ items: [address] });
        if (path.includes('/places/cities/1/areas')) return ok({ items: [] });
        if (path.includes('/places/cities')) return ok({ items: [{ id: 1, name: 'Lahore', timezone: 'Asia/Karachi' }] });
        if (path.includes('/search/providers')) return ok({ items: [] });
        if (path.endsWith('/bookings/quote')) return ok(quote);
        if (path.endsWith('/bookings') && init?.method === 'POST')
          return new Response(JSON.stringify(problem(400, 'BAD_REQUEST', 'The booking must start in the future')), {
            status: 400,
            headers: { 'content-type': 'application/json' }
          });
        return new Response(JSON.stringify(problem(404, 'NOT_FOUND')), { status: 404 });
      })
    );
    renderFlow();
    await reachPayment();
    fireEvent.click(screen.getByRole('radio', { name: new RegExp(dict.booking.cash) }));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(dict.booking.confirm, 'i') }));

    await waitFor(() => expect(text()).toContain('The booking must start in the future'));
    /* The server's own reason is shown rather than a generic apology: it is the
       only account of *why* the booking was refused, and it names a rule the
       customer can act on. */
    expect(text()).toContain(dict.booking.createFailed);
    /* No success screen, and no money taken: the API refused before it charged. */
    expect(screen.queryByText('SHM-0000001')).toBeNull();
    expect(screen.queryByRole('link', { name: dict.booking.viewBooking })).toBeNull();
  });
});

describe('the hand-off from a provider profile', () => {
  it('preselects a carried professional and their chosen slot', { timeout: 20_000 }, async () => {
    const providerId = '00000000-0000-4000-8000-000000000098';
    stubApi({ slots: { date: '2026-10-06', durationMin: 90, items: [{ start: '2026-10-06T05:00:00.000Z', end: '2026-10-06T06:30:00.000Z' }] } });
    renderFlow({ initialProviderId: providerId, initialDate: '2026-10-06', initialStart: '2026-10-06T05:00:00.000Z' });

    await screen.findByText('Home');
    fireEvent.click(screen.getByRole('radio', { name: /Home/ }));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(dict.common.continue, 'i') }));

    /* The professional is already chosen, so the customer is not asked again. */
    await screen.findByText(dict.booking.autoAssignTitle);
    const chosen = await screen.findByRole('radio', { name: /Licensed plumber/ }, { timeout: 5_000 });
    expect(chosen.getAttribute('data-state')).toBe('checked');

    fireEvent.click(screen.getByRole('button', { name: new RegExp(dict.common.continue, 'i') }));
    /* The carried slot is applied once it appears in that day's availability, so
       the customer lands on a preselected time rather than an empty step. */
    await waitFor(() => expect(screen.getAllByRole('button', { name: /^\d{1,2}:\d{2}/ })[0].getAttribute('aria-pressed')).toBe('true'), { timeout: 8_000 });
  });

  it('ignores a hand-edited provider id rather than putting it in front of the API', { timeout: 20_000 }, async () => {
    /* `/slots` is keyed on a uuid and answers 400 for anything else, so a
       malformed `?provider=` must be dropped in the browser — where the customer
       can see it was ignored — rather than becoming a server error. */
    stubApi();
    renderFlow({ initialProviderId: 'not-a-uuid', initialDate: '2026-10-06', initialStart: '2026-10-06T05:00:00.000Z' });

    await screen.findByText('Home');
    fireEvent.click(screen.getByRole('radio', { name: /Home/ }));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(dict.common.continue, 'i') }));

    await screen.findByText(dict.booking.autoAssignTitle);
    /* Nothing is preselected, so the customer must choose — which is the honest
       outcome for a link that named nobody. */
    const providerCard = await screen.findByRole('radio', { name: /Licensed plumber/ }, { timeout: 5_000 });
    expect(providerCard.getAttribute('data-state')).toBe('unchecked');
  });
});
