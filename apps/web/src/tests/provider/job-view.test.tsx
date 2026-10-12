import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderJobScreen } from '@/features/provider/job-view';
import { getDictionary } from '@/lib/dictionaries';
import type { Locale } from '@/lib/utils';

/* The provider's job screen.
 *
 * This is the screen that had the worst defects in the migration, and each one is
 * pinned here:
 *
 * · **The start code was a literal `"482913"`** compared in the browser. There is
 *   no such thing any more — the customer reads it out over the phone — and a test
 *   asserts that code is never present in the document.
 * · **The whole job lived in `useState`** (a `stage` index, `beforePhotos`,
 *   `ticked`, `collected`), so it reset on reload and drifted from the server.
 *   Every step is now derived from `booking.status`, and a test reloads-equivalent
 *   render at a later status to prove nothing is carried over.
 * · **It rendered an address** that no provider-reachable endpoint returns
 *   (`GET /customer/addresses` is CUSTOMER-only). The screen must say the address
 *   is unavailable and must never print a plausible-looking street.
 * · **It rendered a checklist** from catalogue mock data with invented `itemId`s.
 *   Nothing publishes the steps to a provider, so posting those ids would 422. */
const dict = getDictionary('en');
const locale: Locale = 'en';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

const renderScreen = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0, gcTime: 0 } } });
  const Component = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return render(<ProviderJobScreen locale={locale} bookingId="bk-1" dict={dict} />, { wrapper: Component });
};

const booking = (over: Record<string, unknown> = {}) => ({
  id: 'bk-1',
  code: 'SHM-0000042',
  customerId: '00000000-0000-4000-8000-000000000001',
  providerId: '00000000-0000-4000-8000-000000000098',
  serviceId: 1,
  addressId: '0f2c9a41-6f7e-4a1e-9c33-0b6a1d2e3f40',
  status: 'REQUESTED',
  paymentMode: 'CASH',
  paymentStatus: 'PENDING',
  isEmergency: false,
  isAutoAssign: false,
  scheduledStart: '2026-10-08T05:00:00.000Z',
  scheduledEnd: '2026-10-08T06:30:00.000Z',
  problemText: 'Kitchen tap is leaking',
  issueOptionId: null,
  isOnBehalf: false,
  onBehalfName: null,
  quotedAmountPaisa: 250_000,
  approvedTotalPaisa: 250_000,
  finalAmountPaisa: null,
  discountPaisa: 0,
  rescheduleCount: 0,
  noShowParty: null,
  cancelReason: null,
  startOtpVerifiedAt: null,
  completedAt: null,
  verificationTier: null,
  createdAt: '2026-10-06T00:00:00.000Z',
  updatedAt: '2026-10-06T00:00:00.000Z',
  ...over
});

const photo = (over: Record<string, unknown> = {}) => ({
  id: 'e1',
  kind: 'BEFORE',
  clientUuid: '11111111-1111-4111-8111-111111111111',
  checklistItemId: null,
  contentType: 'image/jpeg',
  sizeBytes: 40_000,
  receivedAt: '2026-10-08T05:05:00.000Z',
  clientCapturedAt: null,
  url: 'https://storage.example/e1.jpg',
  ...over
});

let row = booking();
let evidence = [photo()];
let services = [{ id: 1, nameEn: 'Leak repair', nameUr: '.leak', slug: 'leak-repair', active: true }];

/* `GET /bookings/:id/service-address` — real shape, including the point the
   arrival check-in is measured against. Nulls are included deliberately: a row
   with no centroid is a real answer and must not print "null". */
let serviceAddress: { label: string | null; line1: string | null; line2: string | null; areaId: number | null; areaName: string | null; lat: number | null; lng: number | null; revealed: boolean } = { label: 'Home', line1: 'House 12, Gulberg', line2: null, areaId: 1, areaName: 'Gulberg', lat: 31.5204, lng: 74.3587, revealed: true };

/* `GET /bookings/:id/checklist` — itemId is the whole point of the route, so it
   is asserted rather than stubbed away. */
let checklist = {
  items: [
    { itemId: 1, position: 1, labelEn: 'Isolate the water supply', labelUr: '.', requiresPhoto: false, done: true, evidenceId: null, doneAt: '2026-10-05T10:00:00.000Z' },
    { itemId: 2, position: 2, labelEn: 'Photograph the leak before repair', labelUr: '.', requiresPhoto: true, done: false, evidenceId: null, doneAt: null }
  ],
  outstanding: 1
};

const callsTo = (fragment: string, method: string) =>
  (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(([url, init]) => String(url).includes(fragment) && (init as RequestInit | undefined)?.method === method);

beforeEach(() => {
  row = booking();
  evidence = [photo()];
  services = [{ id: 1, nameEn: 'Leak repair', nameUr: '.leak', slug: 'leak-repair', active: true }];
  serviceAddress = { label: 'Home', line1: 'House 12, Gulberg', line2: null, areaId: 1, areaName: 'Gulberg', lat: 31.5204, lng: 74.3587, revealed: true };
  checklist = {
    items: [
      { itemId: 1, position: 1, labelEn: 'Isolate the water supply', labelUr: '.', requiresPhoto: false, done: true, evidenceId: null, doneAt: '2026-10-05T10:00:00.000Z' },
      { itemId: 2, position: 2, labelEn: 'Photograph the leak before repair', labelUr: '.', requiresPhoto: true, done: false, evidenceId: null, doneAt: null }
    ],
    outstanding: 1
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'GET' && url.includes('/service-address')) return json(serviceAddress);
      if (method === 'GET' && url.includes('/checklist')) return json(checklist);
      if (method === 'GET' && url.includes('/evidence')) return json({ items: evidence });
      if (url.includes('/on-behalf-contact')) return json({ contact: null });
      /* Order matters: `listAllServices` fans out to
         `/catalogue/categories/{slug}/services`, which also matches a plain
         `/catalogue/categories` test, so the more specific route is routed first. */
      if (url.includes('/services')) return json({ items: services });
      if (url.includes('/catalogue/categories')) {
        return json({ items: [{ id: 1, slug: 'plumbing', nameEn: 'Plumbing', nameUr: 'پلمبنگ', isActive: true }] });
      }
      /* Any POST here is a state transition the test triggers; the returned row is
         the one the test has staged, so the screen re-renders from server truth. */
      if (method === 'POST') return json(row);
      if (url.includes('/bookings/bk-1')) return json(row);
      throw new Error(`unrouted ${method} ${url}`);
    })
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('what the job screen refuses to invent', () => {
  it('never shows a start code, because no endpoint returns one', async () => {
    row = booking({ status: 'EN_ROUTE' });
    renderScreen();
    await screen.findByLabelText(dict.job.otpLabel);
    /* The old screen compared the customer's code against a literal in the bundle. */
    expect(document.body.textContent).not.toContain('482913');
    /* And the field starts empty. */
    expect(((await screen.findByLabelText(dict.job.otpLabel)) as HTMLInputElement).value).toBe('');
  });

  /* The address is genuinely withheld while the job is REQUESTED — that part of
     the old reasoning held. What changed is that there is now a route that opens
     it afterwards, so the screen asks only once it is allowed to. */
  it('says why there is no address while the job is still being offered', async () => {
    row = booking({ status: 'REQUESTED' });
    renderScreen();
    expect(await screen.findByText(dict.job.addressPendingAcceptText)).toBeDefined();
    /* And it does not go looking for one. */
    expect(callsTo('/service-address', 'GET')).toHaveLength(0);
  });

  it('shows the real address once the job has left REQUESTED', async () => {
    row = booking({ status: 'IN_PROGRESS' });
    renderScreen();
    expect(await screen.findByText('House 12, Gulberg')).toBeDefined();
    expect(screen.getByText('Home')).toBeDefined();
    expect(screen.getByText('Gulberg')).toBeDefined();
    /* The point the arrival check-in is measured against, in the API's own form. */
    expect(document.body.textContent).toContain('31.52040');
    /* Not a sentence claiming the API cannot do it any more. */
    expect(screen.queryByText(dict.job.addressUnavailableText)).toBeNull();
  });

  it('survives an address with no centroid without printing null', async () => {
    row = booking({ status: 'IN_PROGRESS' });
    serviceAddress = { ...serviceAddress, lat: null, lng: null };
    renderScreen();
    expect(await screen.findByText('House 12, Gulberg')).toBeDefined();
    expect(document.body.textContent).not.toMatch(/null/);
  });

  it('shows the real checklist and lets a step be ticked', async () => {
    row = booking({ status: 'IN_PROGRESS' });
    evidence = [photo({ kind: 'BEFORE' }), photo({ id: 'e2', kind: 'AFTER' })];
    renderScreen();
    /* The steps come from the API, with their real labels and positions. */
    expect(await screen.findByText(/Isolate the water supply/)).toBeDefined();
    expect(screen.getByText(/Photograph the leak before repair/)).toBeDefined();
    /* The server's own count, which is what `complete` will check. */
    expect(screen.getByText(dict.job.checklistRemaining.replace('{count}', '1'))).toBeDefined();
    /* Not the old "not published" panel. */
    expect(screen.queryByText(dict.job.checklistEmpty)).toBeNull();

    /* A photo step cannot be ticked by clicking it alone — it asks for the photo. */
    expect(screen.getByRole('button', { name: dict.job.checklistPhotoLabel })).toBeDefined();
    expect(screen.getByText(dict.job.checklistNeedsPhoto)).toBeDefined();
  });

  it('ticks a photo step with the photo already on file, and does not ask for another', async () => {
    row = booking({ status: 'IN_PROGRESS' });
    /* A CHECKLIST photo already uploaded against item 2, and the item is still not
       ticked — which is the state the server is left in if an upload succeeded and
       the tick that should have followed it failed. */
    evidence = [
      photo({ kind: 'BEFORE' }),
      photo({ id: 'e2', kind: 'AFTER' }),
      photo({ id: 'e9', kind: 'CHECKLIST', checklistItemId: 2 })
    ];
    renderScreen();
    await screen.findByText(/Photograph the leak before repair/);
    expect(screen.getByText(dict.job.checklistPhotoOnFile)).toBeDefined();
    /* The picker is not offered: the photo exists, so asking again would produce a
       duplicate the provider then has to think about. */
    expect(screen.queryByRole('button', { name: dict.job.checklistPhotoLabel })).toBeNull();

    /* And the tick carries that photo's id, because the server 422s without it. */
    const ticks = screen.getAllByRole('button', { name: dict.job.checklistTick });
    fireEvent.click(ticks[ticks.length - 1]);
    await waitFor(() => {
      const posted = callsTo('/checklist/2', 'POST');
      expect(posted).toHaveLength(1);
      expect(JSON.parse(String((posted[0][1] as RequestInit).body)).evidenceId).toBe('e9');
    });
  });

  it('says so when the service has no published steps', async () => {
    row = booking({ status: 'IN_PROGRESS' });
    checklist = { items: [], outstanding: 0 };
    renderScreen();
    expect(await screen.findByText(dict.job.checklistEmpty)).toBeDefined();
  });

  it('shows the checklist read-only once the job is past the working stage', async () => {
    row = booking({ status: 'AWAITING_VERIFICATION' });
    checklist = { ...checklist, items: checklist.items.map((i) => ({ ...i, done: true })), outstanding: 0 };
    renderScreen();
    expect(await screen.findByText(dict.job.checklistAllDone)).toBeDefined();
    /* Nothing left to photograph, because nothing is left to do. */
    expect(screen.queryByRole('button', { name: dict.job.checklistPhotoLabel })).toBeNull();
  });

  it('does not offer the checklist before the job is under way', async () => {
    row = booking({ status: 'EN_ROUTE' });
    renderScreen();
    await screen.findByLabelText(dict.job.otpLabel);
    expect(screen.queryByText(/Isolate the water supply/)).toBeNull();
  });
});

describe('state comes from the server', () => {
  it('shows REQUESTED as awaiting acceptance, offering only accept and decline', async () => {
    renderScreen();
    expect(await screen.findByRole('button', { name: dict.job.acceptJob })).toBeDefined();
    expect(screen.getByRole('button', { name: dict.job.declineJob })).toBeDefined();
    /* Accepting before acceptance is nonsense; nothing else is offered. */
    expect(screen.queryByRole('button', { name: dict.job.markEnRoute })).toBeNull();
    expect(screen.queryByRole('button', { name: dict.job.completeJob })).toBeNull();
  });

  it('offers the start code at EN_ROUTE and nothing else', async () => {
    row = booking({ status: 'EN_ROUTE' });
    renderScreen();
    expect(await screen.findByRole('button', { name: dict.job.startJob })).toBeDefined();
    expect(screen.queryByRole('button', { name: dict.job.acceptJob })).toBeNull();
    expect(screen.queryByRole('button', { name: dict.job.completeJob })).toBeNull();
  });

  it('offers completion at IN_PROGRESS and a revision, but no cash collection yet', async () => {
    row = booking({ status: 'IN_PROGRESS' });
    evidence = [photo({ kind: 'BEFORE' }), photo({ id: 'e2', kind: 'AFTER' })];
    renderScreen();
    expect(await screen.findByRole('button', { name: dict.job.completeJob })).toBeDefined();
    expect(screen.getByRole('button', { name: dict.job.raiseRevision })).toBeDefined();
    /* The job is not finished, so cash cannot have been collected. */
    expect(screen.queryByRole('button', { name: dict.job.cashReceived })).toBeNull();
  });

  it('says nothing is left to do on a cancelled job', async () => {
    row = booking({ status: 'CANCELLED_CUSTOMER', cancelReason: 'Found a closer provider' });
    renderScreen();
    expect(await screen.findByText(dict.job.noActionsTitle)).toBeDefined();
    expect(screen.queryByRole('button', { name: dict.job.acceptJob })).toBeNull();
    /* Rendered as `label: reason` in the details card, so the reason is its own text
       node next to the label rather than the whole string. */
    expect(screen.getByText(/Found a closer provider/)).toBeDefined();
  });

  it('waits on the customer during QUOTE_REVISION and offers no action', async () => {
    row = booking({ status: 'QUOTE_REVISION' });
    renderScreen();
    expect(await screen.findByText(dict.job.revisionPending)).toBeDefined();
    expect(screen.queryByRole('button', { name: dict.job.completeJob })).toBeNull();
    expect(screen.queryByRole('button', { name: dict.job.raiseRevision })).toBeNull();
  });
});

describe('the completion gate', () => {
  it('disables completion until both photos are on file, naming the missing one', async () => {
    row = booking({ status: 'IN_PROGRESS' });
    evidence = [photo({ kind: 'BEFORE' })];
    renderScreen();
    const complete = (await screen.findByRole('button', { name: dict.job.completeJob })) as HTMLButtonElement;
    expect(complete.disabled).toBe(true);
    expect(screen.getByText(dict.job.needAfterPhoto)).toBeDefined();
  });

  it('names the before photo first when neither is on file', async () => {
    row = booking({ status: 'IN_PROGRESS' });
    evidence = [];
    renderScreen();
    expect(await screen.findByText(dict.job.needBeforePhoto)).toBeDefined();
  });

  it('enables completion once both are present', async () => {
    row = booking({ status: 'IN_PROGRESS' });
    evidence = [photo({ kind: 'BEFORE' }), photo({ id: 'e2', kind: 'AFTER' })];
    renderScreen();
    expect(((await screen.findByRole('button', { name: dict.job.completeJob })) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText(dict.job.photosReadyNote)).toBeDefined();
  });

  it('sends no finalAmountPaisa when the box is left empty', async () => {
    row = booking({ status: 'IN_PROGRESS' });
    evidence = [photo({ kind: 'BEFORE' }), photo({ id: 'e2', kind: 'AFTER' })];
    renderScreen();
    fireEvent.click(await screen.findByRole('button', { name: dict.job.completeJob }));
    await waitFor(() => expect(callsTo('/bookings/bk-1/complete', 'POST')).toHaveLength(1));
    /* An empty box means "complete at the approved total", which is the schema's
       own default. Sending 0 would under-charge the job. */
    expect(JSON.parse(String((callsTo('/bookings/bk-1/complete', 'POST')[0][1] as RequestInit).body))).toEqual({});
  });

  it('converts a typed rupee amount to paisa', async () => {
    row = booking({ status: 'IN_PROGRESS' });
    evidence = [photo({ kind: 'BEFORE' }), photo({ id: 'e2', kind: 'AFTER' })];
    renderScreen();
    fireEvent.change(await screen.findByLabelText(dict.job.finalAmountInputLabel), { target: { value: '2000' } });
    fireEvent.click(screen.getByRole('button', { name: dict.job.completeJob }));
    await waitFor(() => expect(callsTo('/bookings/bk-1/complete', 'POST')).toHaveLength(1));
    expect(JSON.parse(String((callsTo('/bookings/bk-1/complete', 'POST')[0][1] as RequestInit).body))).toEqual({
      finalAmountPaisa: 200_000
    });
  });
});

describe('actions', () => {
  it('sends the six-digit code, and refuses anything shorter before calling', async () => {
    row = booking({ status: 'EN_ROUTE' });
    renderScreen();
    fireEvent.change(await screen.findByLabelText(dict.job.otpLabel), { target: { value: '123' } });
    fireEvent.click(screen.getByRole('button', { name: dict.job.startJob }));
    /* Five attempts are allowed before the API locks the code for fifteen minutes,
       so an obviously-short entry should never reach it. */
    expect(await screen.findByText(dict.job.otpSixDigits)).toBeDefined();
    expect(callsTo('/bookings/bk-1/start', 'POST')).toHaveLength(0);

    fireEvent.change(screen.getByLabelText(dict.job.otpLabel), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: dict.job.startJob }));
    await waitFor(() => expect(callsTo('/bookings/bk-1/start', 'POST')).toHaveLength(1));
    expect(JSON.parse(String((callsTo('/bookings/bk-1/start', 'POST')[0][1] as RequestInit).body))).toEqual({ code: '123456' });
  });

  it('accepts and declines through their own endpoints', async () => {
    renderScreen();
    fireEvent.click(await screen.findByRole('button', { name: dict.job.acceptJob }));
    await waitFor(() => expect(callsTo('/bookings/bk-1/accept', 'POST')).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: dict.job.declineJob }));
    await waitFor(() => expect(callsTo('/bookings/bk-1/decline', 'POST')).toHaveLength(1));
  });

  it('shows the server refusal verbatim, because it names the real reason', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : String(input);
        const method = (init?.method ?? 'GET').toUpperCase();
        if (method === 'POST' && url.includes('/accept')) {
          return new Response(
            JSON.stringify({
              type: 'about:blank',
              title: 'x',
              status: 409,
              code: 'ILLEGAL_TRANSITION',
              detail: 'Cannot accept a booking in status SCHEDULED',
              errors: []
            }),
            { status: 409, headers: { 'content-type': 'application/problem+json' } }
          );
        }
        if (method === 'GET' && url.includes('/evidence')) return json({ items: [] });
        if (url.includes('/on-behalf-contact')) return json({ contact: null });
        if (url.includes('/services')) return json({ items: [] });
        if (url.includes('/catalogue/categories')) return json({ items: [] });
        return json(row);
      })
    );
    renderScreen();
    fireEvent.click(await screen.findByRole('button', { name: dict.job.acceptJob }));
    expect(await screen.findByText('Cannot accept a booking in status SCHEDULED')).toBeDefined();
    /* Not paraphrased into something vaguer. */
    expect(screen.queryByText(dict.job.actionFailed)).toBeNull();
  });

  it('refuses an incomplete revision before sending it', async () => {
    row = booking({ status: 'IN_PROGRESS' });
    evidence = [photo({ kind: 'BEFORE' }), photo({ id: 'e2', kind: 'AFTER' })];
    renderScreen();
    fireEvent.click(await screen.findByRole('button', { name: dict.job.raiseRevision }));
    expect(await screen.findByText(dict.job.revisionIncomplete)).toBeDefined();
    expect(callsTo('/bookings/bk-1/revisions', 'POST')).toHaveLength(0);
  });

  it('offers cash collection only for a CASH job once verification has run', async () => {
    row = booking({ status: 'VERIFIED', paymentMode: 'CASH' });
    evidence = [photo({ kind: 'BEFORE' }), photo({ id: 'e2', kind: 'AFTER' })];
    renderScreen();
    expect(await screen.findByRole('button', { name: dict.job.cashReceived })).toBeDefined();
  });

  it('never offers cash collection for an ONLINE job', async () => {
    /* `confirmCashReceived` 409s for an online job; offering the button would be
       teaching the professional to expect an error. */
    row = booking({ status: 'VERIFIED', paymentMode: 'ONLINE' });
    evidence = [photo({ kind: 'BEFORE' }), photo({ id: 'e2', kind: 'AFTER' })];
    renderScreen();
    await screen.findByText(dict.job.photosTitle);
    expect(screen.queryByRole('button', { name: dict.job.cashReceived })).toBeNull();
  });
});

describe('the on-behalf contact', () => {
  it('shows the name and explains why the number is masked', async () => {
    row = booking({ status: 'REQUESTED', isOnBehalf: true, onBehalfName: 'Bilal Ahmed' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/on-behalf-contact')) return json({ contact: { name: 'Bilal Ahmed', phone: '+92•••••••567', revealed: false } });
        if (url.includes('/evidence')) return json({ items: [] });
        if (url.includes('/services')) return json({ items: [] });
        if (url.includes('/catalogue/categories')) return json({ items: [] });
        return json(row);
      })
    );
    renderScreen();
    expect(await screen.findByText('Bilal Ahmed')).toBeDefined();
    expect(screen.getByText('+92•••••••567')).toBeDefined();
    expect(screen.getByText(dict.job.contactMaskedNote)).toBeDefined();
  });

  it('drops the masking note once the job is accepted', async () => {
    row = booking({ status: 'SCHEDULED', isOnBehalf: true, onBehalfName: 'Bilal Ahmed' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/on-behalf-contact')) return json({ contact: { name: 'Bilal Ahmed', phone: '+923001234567', revealed: true } });
        if (url.includes('/evidence')) return json({ items: [] });
        if (url.includes('/services')) return json({ items: [] });
        if (url.includes('/catalogue/categories')) return json({ items: [] });
        return json(row);
      })
    );
    renderScreen();
    expect(await screen.findByText('+923001234567')).toBeDefined();
    expect(screen.queryByText(dict.job.contactMaskedNote)).toBeNull();
  });
});

describe('reading the booking', () => {
  it('shows the code, the slot and what the customer reported', async () => {
    renderScreen();
    expect(await screen.findByText(dict.job.codeLabel.replace('{code}', 'SHM-0000042'))).toBeDefined();
    expect(screen.getByText('Kitchen tap is leaking')).toBeDefined();
  });

  it('names the service from a real catalogue lookup', async () => {
    renderScreen();
    expect((await screen.findAllByText('Leak repair')).length).toBeGreaterThan(0);
  });

  it('falls back to a neutral label when the service cannot be read', async () => {
    services = [];
    renderScreen();
    expect(await screen.findByText(dict.job.serviceUnknown)).toBeDefined();
  });

  it('shows the customer’s own problem photos apart from the provider’s', async () => {
    row = booking({ status: 'IN_PROGRESS' });
    evidence = [photo({ kind: 'BEFORE' }), photo({ id: 'e2', kind: 'AFTER' }), photo({ id: 'e3', kind: 'CUSTOMER_PROBLEM' })];
    renderScreen();
    await screen.findByText(dict.job.photosTitle);
    /* The customer's photos are not the provider's evidence to manage, and the API
       will not let a provider add one. They are excluded from the list. The caption reads `kind . time`, so the kind
       is a text node inside a longer string and is matched by regex, not as a whole. */
    expect(screen.getAllByText(new RegExp(dict.job.photoKinds.BEFORE)).length).toBeGreaterThan(0);
    expect(screen.queryByText(new RegExp(dict.job.photoKinds.CUSTOMER_PROBLEM))).toBeNull();
  });

  it('reports a job it cannot read without claiming it belongs to someone else', async () => {
    /* `getOwned` 404s both "missing" and "not yours" so the screen must not guess
       which — that would confirm the booking exists. */
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/bookings/bk-1')) {
          return new Response(JSON.stringify({ type: 'about:blank', title: 'x', status: 404, code: 'NOT_FOUND', detail: 'Booking was not found', errors: [] }), {
            status: 404,
            headers: { 'content-type': 'application/problem+json' }
          });
        }
        return json({ items: [] });
      })
    );
    renderScreen();
    expect(await screen.findByText(dict.job.notFound)).toBeDefined();
  });
});
