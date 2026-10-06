// apps/api/test/integration/booking-on-behalf-of.test.ts
//
// "Can I book a service for someone else, and share their number and address with
// the provider?"
//
// The design: the booker's account still pays, rates, disputes and is verified
// against — the escrow ledger keys off customer_id and there is no reason to disturb
// that. What the third party adds is a door to knock on and someone to phone.
//
// The number is therefore masked by default and revealed only to the provider who
// accepted the job. That is the whole point of the tests here: a provider browsing
// the offer list must not be able to harvest contact details for jobs they may
// decline, and the full number must not ride along on any booking row that some
// other endpoint returns by accident.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { callApi, createTestApp, postJson, readyBookableProvider, registerAndVerify, type TestUser } from './harness.js';

let app: NestExpressApplication;
let close: () => Promise<void>;

beforeAll(async () => {
  const started = await createTestApp();
  app = started.app;
  close = started.close;
});

afterAll(async () => {
  await close();
});

const bearer = (accessToken: string, init: RequestInit = {}): RequestInit => ({ ...init, headers: { ...init.headers, authorization: `Bearer ${accessToken}` } });

const THIRD_PARTY = { name: 'Bilal Ahmed', phoneE164: '+923111223344' };
const MASKED_TAIL = '344';

type Booking = { id: string; code: string; status: string; isOnBehalf: boolean; onBehalfName: string | null; problemText: string | null; issueOptionId: number | null };
type Offer = { id: string; bookingId: string; onBehalfContact: { name: string; phone: string; revealed: boolean } | null; issueLabel: string | null };
type ContactResponse = { contact: { name: string; phone: string; revealed: boolean } | null };

describe('booking on behalf of someone else', () => {
  let provider: TestUser;
  let serviceId: number;
  let areaId: number;
  let customer: TestUser;
  let addressId: string;

  beforeAll(async () => {
    const ready = await readyBookableProvider(app);
    provider = ready.provider;
    serviceId = ready.serviceId;
    areaId = ready.areaId;
    customer = await registerAndVerify(app, 'CUSTOMER');
    const address = await callApi<{ id: string }>(app, '/customer/addresses', bearer(customer.accessToken, postJson({ label: 'Home', line1: 'House 1', areaId, lat: 31.52, lng: 74.35, isDefault: true })));
    addressId = address.body.id;
  });

  const slot = (hoursAhead: number): { scheduledStart: string; scheduledEnd: string } => {
    const start = new Date(Date.now() + hoursAhead * 3_600_000);
    return { scheduledStart: start.toISOString(), scheduledEnd: new Date(start.getTime() + 90 * 60_000).toISOString() };
  };

  const bookOnBehalf = (overrides: Record<string, unknown> = {}, hoursAhead = 48) =>
    callApi<Booking>(app, '/bookings', bearer(customer.accessToken, postJson({ providerId: provider.id, serviceId, addressId, ...slot(hoursAhead), ...overrides })));

  it('records the third party on the booking while the booker still owns it', async () => {
    const response = await bookOnBehalf({ onBehalfOf: THIRD_PARTY }, 48);
    expect(response.status).toBe(201);
    expect(response.body.isOnBehalf).toBe(true);
    expect(response.body.onBehalfName).toBe('Bilal Ahmed');
    // The booker, not the third party, is the customer of record: this is what keeps
    // escrow, ratings and verification pointing at the paying account.
    const detail = await callApi<Booking>(app, `/bookings/${response.body.id}`, bearer(customer.accessToken));
    expect(detail.status).toBe(200);
    expect(detail.body.isOnBehalf).toBe(true);
  });

  it('never puts the third party\'s number on the booking row any endpoint returns', async () => {
    const created = await bookOnBehalf({ onBehalfOf: THIRD_PARTY }, 72);
    expect(created.status).toBe(201);
    // The row is what every booking endpoint returns to a provider, so the number
    // cannot be a field on it without leaking through all of them.
    expect(JSON.stringify(created.body)).not.toContain(THIRD_PARTY.phoneE164);
    const read = await callApi<Booking>(app, `/bookings/${created.body.id}`, bearer(customer.accessToken));
    expect(JSON.stringify(read.body)).not.toContain(THIRD_PARTY.phoneE164);
  });

  it('shows the customer who entered it the full number', async () => {
    const created = await bookOnBehalf({ onBehalfOf: THIRD_PARTY }, 96);
    const response = await callApi<ContactResponse>(app, `/bookings/${created.body.id}/on-behalf-contact`, bearer(customer.accessToken));
    expect(response.status).toBe(200);
    expect(response.body.contact).toEqual({ name: 'Bilal Ahmed', phone: THIRD_PARTY.phoneE164, revealed: true });
  });

  it('shows a provider considering the job only a masked number', async () => {
    const created = await bookOnBehalf({ onBehalfOf: THIRD_PARTY }, 120);
    const offers = await callApi<{ items: Offer[] }>(app, '/provider/offers', bearer(provider.accessToken));
    const offer = offers.body.items.find(item => item.bookingId === created.body.id)!;
    expect(offer).toBeDefined();
    expect(offer.onBehalfContact).not.toBeNull();
    expect(offer.onBehalfContact!.name).toBe('Bilal Ahmed');
    // Masked: enough to recognise, not enough to dial. An offer is still a choice.
    expect(offer.onBehalfContact!.revealed).toBe(false);
    expect(offer.onBehalfContact!.phone).not.toBe(THIRD_PARTY.phoneE164);
    expect(offer.onBehalfContact!.phone.endsWith(MASKED_TAIL)).toBe(true);
    expect(offer.onBehalfContact!.phone).toMatch(/^[+]?•+\d{3}$/);
  });

  it('reveals the number to the provider once they have accepted the job', async () => {
    const created = await bookOnBehalf({ onBehalfOf: THIRD_PARTY }, 144);
    const offers = await callApi<{ items: Offer[] }>(app, '/provider/offers', bearer(provider.accessToken));
    const offer = offers.body.items.find(item => item.bookingId === created.body.id)!;

    const accepted = await callApi<{ id: string; onBehalfContact: ContactResponse['contact'] }>(app, `/provider/offers/${offer.id}/accept`, bearer(provider.accessToken, { method: 'POST' }));
    expect(accepted.status).toBe(200);
    // Accepting is the reveal point: the job is now theirs.
    expect(accepted.body.onBehalfContact).toEqual({ name: 'Bilal Ahmed', phone: THIRD_PARTY.phoneE164, revealed: true });

    const after = await callApi<ContactResponse>(app, `/bookings/${created.body.id}/on-behalf-contact`, bearer(provider.accessToken));
    expect(after.body.contact).toEqual({ name: 'Bilal Ahmed', phone: THIRD_PARTY.phoneE164, revealed: true });
  });

  it('hides the contact from an unrelated signed-in user, who gets a 404 as with any booking', async () => {
    const created = await bookOnBehalf({ onBehalfOf: THIRD_PARTY }, 168);
    const stranger = await registerAndVerify(app, 'CUSTOMER');
    const response = await callApi(app, `/bookings/${created.body.id}/on-behalf-contact`, bearer(stranger.accessToken));
    expect(response.status).toBe(404);
  });

  it('returns no contact at all for an ordinary booking', async () => {
    const plain = await callApi<Booking>(app, '/bookings', bearer(customer.accessToken, postJson({ providerId: provider.id, serviceId, addressId, ...slot(192) })));
    expect(plain.status).toBe(201);
    const response = await callApi<ContactResponse>(app, `/bookings/${plain.body.id}/on-behalf-contact`, bearer(customer.accessToken));
    expect(response.status).toBe(200);
    expect(response.body.contact).toBeNull();
  });

  it('refuses a booking that claims to be on someone else\'s behalf but names nobody', async () => {
    // The schema makes name and phone a pair, so a half-filled object cannot be sent
    // at all; and the database refuses a booking that is on-behalf with either column
    // null, so the invariant does not rest on the request validator alone.
    const response = await bookOnBehalf({ onBehalfOf: { name: 'Bilal Ahmed' } }, 216);
    expect(response.status).toBe(422);
  });

  it('refuses a phone number that is not E.164, and an empty name', async () => {
    expect((await bookOnBehalf({ onBehalfOf: { name: 'Bilal Ahmed', phoneE164: '0311-223344' } }, 240)).status).toBe(422);
    expect((await bookOnBehalf({ onBehalfOf: { name: '   ', phoneE164: '+923111223344' } }, 264)).status).toBe(422);
  });
});

describe('the common-faults dropdown', () => {
  let provider: TestUser;
  let serviceId: number;
  let areaId: number;
  let customer: TestUser;
  let addressId: string;

  beforeAll(async () => {
    const ready = await readyBookableProvider(app);
    provider = ready.provider;
    serviceId = ready.serviceId;
    areaId = ready.areaId;
    customer = await registerAndVerify(app, 'CUSTOMER');
    const address = await callApi<{ id: string }>(app, '/customer/addresses', bearer(customer.accessToken, postJson({ label: 'Home', line1: 'House 1', areaId, lat: 31.52, lng: 74.35, isDefault: true })));
    addressId = address.body.id;
  });

  const slot = (hoursAhead: number): { scheduledStart: string; scheduledEnd: string } => {
    const start = new Date(Date.now() + hoursAhead * 3_600_000);
    return { scheduledStart: start.toISOString(), scheduledEnd: new Date(start.getTime() + 90 * 60_000).toISOString() };
  };

  it('publishes a service\'s common faults in both languages, in display order', async () => {
    const response = await callApi<{ items: { id: number; slug: string; labelEn: string; labelUr: string; position: number }[] }>(
      app,
      '/catalogue/services/leak-repair/issue-options'
    );
    expect(response.status).toBe(200);
    expect(response.body.items.length).toBeGreaterThan(0);
    for (const option of response.body.items) {
      expect(option.labelEn.length).toBeGreaterThan(0);
      expect(option.labelUr.length).toBeGreaterThan(0);
    }
    expect(new Set(response.body.items.map(option => option.slug)).size).toBe(response.body.items.length);
    expect(response.body.items.map(option => option.position)).toEqual([...response.body.items.map(option => option.position)].sort((a, b) => a - b));
  });

  it('is included in the service detail, so the booking screen needs one call', async () => {
    const detail = await callApi<{ issueOptions: { slug: string }[] }>(app, '/catalogue/services/leak-repair');
    expect(detail.status).toBe(200);
    expect(detail.body.issueOptions.length).toBeGreaterThan(0);
  });

  it('records the chosen fault on the booking and shows the label to the provider', async () => {
    const options = await callApi<{ items: { id: number; slug: string; labelEn: string }[] }>(app, '/catalogue/services/leak-repair/issue-options');
    const chosen = options.body.items[0]!;

    // The customer picks from the dropdown AND edits their own description — the
    // client asked for both, and neither is meant to crowd out the other.
    const created = await callApi<Booking>(
      app,
      '/bookings',
      bearer(
        customer.accessToken,
        postJson({
          providerId: provider.id,
          serviceId,
          addressId,
          ...slot(24),
          issueOptionId: chosen.id,
          problemText: 'Started two days ago, the cabinet underneath is damp.'
        })
      )
    );
    expect(created.status).toBe(201);
    expect(created.body.issueOptionId).toBe(chosen.id);
    expect(created.body.problemText).toBe('Started two days ago, the cabinet underneath is damp.');

    const offers = await callApi<{ items: Offer[] }>(app, '/provider/offers', bearer(provider.accessToken));
    const offer = offers.body.items.find(item => item.bookingId === created.body.id)!;
    expect(offer.issueLabel).toBe(chosen.labelEn);
  });

  it('accepts free text with no option chosen, and an option with no free text', async () => {
    const options = await callApi<{ items: { id: number }[] }>(app, '/catalogue/services/leak-repair/issue-options');

    const textOnly = await callApi<Booking>(app, '/bookings', bearer(customer.accessToken, postJson({ providerId: provider.id, serviceId, addressId, ...slot(48), problemText: 'Pipe under the bath is dripping.' })));
    expect(textOnly.status).toBe(201);
    expect(textOnly.body.issueOptionId).toBeNull();

    const optionOnly = await callApi<Booking>(app, '/bookings', bearer(customer.accessToken, postJson({ providerId: provider.id, serviceId, addressId, ...slot(72), issueOptionId: options.body.items[0]!.id })));
    expect(optionOnly.status).toBe(201);
    expect(optionOnly.body.issueOptionId).toBe(options.body.items[0]!.id);
    expect(optionOnly.body.problemText).toBeNull();
  });

  it('refuses an option belonging to a different service, so a fault can never be misreported', async () => {
    const ac = await callApi<{ items: { id: number }[] }>(app, '/catalogue/services/ac-service/issue-options');
    expect(ac.body.items.length).toBeGreaterThan(0);
    const response = await callApi(app, '/bookings', bearer(customer.accessToken, postJson({ providerId: provider.id, serviceId, addressId, ...slot(96), issueOptionId: ac.body.items[0]!.id })));
    expect(response.status).toBe(404);
  });

  it('refuses an option id that does not exist', async () => {
    const response = await callApi(app, '/bookings', bearer(customer.accessToken, postJson({ providerId: provider.id, serviceId, addressId, ...slot(120), issueOptionId: 999_999 })));
    expect(response.status).toBe(404);
  });
});