import { describe, expect, it, vi } from 'vitest';
import { bookingApi, type Booking, type CreatedBooking, type Quote } from '@/features/booking/api';
import { ApiError } from '@/lib/api/problem';

/* The shapes `POST /bookings/*` and `GET /bookings*` actually send, copied from
   `BookingRow` (apps/api/src/booking/booking.row.ts) and `PricingService.price()`.

   These guard the mapping in both directions: a field the API sends that the
   frontend drops, and a field it invents that the API never sends. Two of the
   assertions below are there because getting them wrong is not a type error but
   a lie on screen — see the notes on `ratingScore`-shaped priors in module 2 and
   on the DISCOUNT line's sign here. */

/** Exactly the columns in `BOOKING_COLUMNS`, with amounts as the API sends them. */
const bookingRow: Booking = {
  id: '8b1f0f2a-0000-4000-8000-000000000001',
  code: 'SHM-0000001',
  customerId: '8b1f0f2a-0000-4000-8000-0000000000c1',
  providerId: '8b1f0f2a-0000-4000-8000-000000000098',
  serviceId: 1,
  addressId: '8b1f0f2a-0000-4000-8000-0000000000a1',
  status: 'REQUESTED',
  paymentMode: 'CASH',
  paymentStatus: 'NONE',
  isEmergency: false,
  isAutoAssign: false,
  scheduledStart: '2026-10-05T04:00:00.000Z',
  scheduledEnd: '2026-10-05T05:30:00.000Z',
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
  createdAt: '2026-10-01T09:00:00.000Z',
  updatedAt: '2026-10-01T09:00:00.000Z',
  issueOptionId: null,
  isOnBehalf: false,
  onBehalfName: null
};

/** An emergency quote: the surcharge is the setting-driven percentage. */
const emergencyQuote: Quote = {
  currency: 'PKR',
  servicePaisa: 200000,
  visitFeePaisa: 50000,
  emergencySurchargePaisa: 50000,
  discountPaisa: 10000,
  totalPaisa: 290000,
  /* Collected separately and explicitly NOT part of the booking total. */
  outstandingReceivablePaisa: 50000,
  payablePaisa: 340000,
  lines: [
    { kind: 'SERVICE', description: 'Leak Repair', amountPaisa: 200000 },
    { kind: 'VISIT_FEE', description: 'Visit fee', amountPaisa: 50000 },
    { kind: 'SURCHARGE', description: 'Emergency surcharge', amountPaisa: 50000 },
    { kind: 'DISCOUNT', description: 'Coupon discount', amountPaisa: -10000 }
  ],
  cancellationPolicy: 'Free cancellation up to 4 hours before your slot. After that a cancellation fee of PKR 500.00 applies.'
};

const problem = (status: number, code = 'NOT_FOUND', detail = 'x') => ({
  type: 'about:blank',
  title: 'x',
  status,
  code,
  detail,
  errors: []
});

const respond = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Captures the parsed request body alongside the URL. */
const capture = (status: number, body: unknown) => {
  const seen: { url: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      seen.push({ url: String(url), body: init?.body === undefined ? {} : (JSON.parse(String(init.body)) as Record<string, unknown>) });
      return respond(status, body);
    })
  );
  return seen;
};

describe('booking row', () => {
  it('carries exactly the fields BOOKING_COLUMNS selects', () => {
    expect(Object.keys(bookingRow).sort()).toEqual(
      [
        'addressId',
        'approvedTotalPaisa',
        'cancelReason',
        'code',
        'completedAt',
        'createdAt',
        'customerId',
        'discountPaisa',
        'finalAmountPaisa',
        'id',
        'isAutoAssign',
        'isEmergency',
        /* These three were missing from the client's `Booking` type even though
           BOOKING_COLUMNS has always selected them. `onBehalfName` is who to knock
           on; the contact *number* is deliberately not on this row and comes from
           `GET /bookings/:id/on-behalf-contact`, masked until acceptance. */
        'isOnBehalf',
        'issueOptionId',
        'noShowParty',
        'onBehalfName',
        'paymentMode',
        'paymentStatus',
        'problemText',
        'providerId',
        'quotedAmountPaisa',
        'rescheduleCount',
        'scheduledEnd',
        'scheduledStart',
        'serviceId',
        'startOtpVerifiedAt',
        'status',
        'updatedAt',
        'verificationTier'
      ].sort()
    );
  });

  it('publishes no service name, no address text and no provider name, so none may be rendered', () => {
    /* BOOKING_COLUMNS projects ids and money only. A booking list therefore has
       to join `serviceId` against the catalogue, and a booking detail cannot
       show a street address without a second call the API does not offer. */
    for (const key of ['serviceName', 'serviceSlug', 'addressLine', 'providerName', 'areaName']) {
      expect(key in bookingRow).toBe(false);
    }
  });

  it('leaves providerId null while an auto-assign request has no taker', () => {
    /* Not a bug and not a missing join: `offer.service.ts` fixes the provider
       only when somebody accepts, so null is the honest answer for REQUESTED. */
    const open: Booking = { ...bookingRow, providerId: null, isAutoAssign: true };
    expect(open.providerId).toBeNull();
    expect(open.isAutoAssign).toBe(true);
  });

  it('leaves finalAmountPaisa null until the job is finished, never zero', () => {
    /* Null and 0 are different claims: null is "not settled yet", 0 is "settled
       at nothing". Collapsing them would render a paid job as unpaid. */
    expect(bookingRow.finalAmountPaisa).toBeNull();
  });

  it('keeps every amount an integer number of paisa', () => {
    for (const value of [bookingRow.quotedAmountPaisa, bookingRow.approvedTotalPaisa, bookingRow.discountPaisa]) {
      expect(Number.isInteger(value)).toBe(true);
    }
  });
});

describe('quote', () => {
  it('keeps the receivable outside the booking total', () => {
    /* FR-PY-11: an earlier cancelled cash job is collected separately. Adding the
       two together as "the booking costs" would overstate this booking by the
       amount owed on a different one. */
    expect(emergencyQuote.totalPaisa).toBe(200000 + 50000 + 50000 - 10000);
    expect(emergencyQuote.payablePaisa).toBe(emergencyQuote.totalPaisa + emergencyQuote.outstandingReceivablePaisa);
    expect(emergencyQuote.totalPaisa).not.toBe(emergencyQuote.payablePaisa);
  });

  it('carries a DISCOUNT line as a negative amount', () => {
    /* The server emits the discount as a negative line rather than as a separate
       sign convention, so the UI must not assume every line is positive. */
    const discount = emergencyQuote.lines.find((line) => line.kind === 'DISCOUNT');
    expect(discount?.amountPaisa).toBe(-10000);
  });

  it('publishes the cancellation policy as server-rendered words, not a number', () => {
    /* The text is built from `booking.free_cancel_hours` and the late fee, both
       administrator settings. Re-deriving it client-side would be a second
       source of truth for a fee rule. */
    expect(emergencyQuote.cancellationPolicy).toContain('4 hours');
    expect(emergencyQuote.cancellationPolicy).toContain('PKR 500.00');
  });

  it('reads back exactly what the API sent', async () => {
    capture(200, emergencyQuote);
    const quote = await bookingApi.quote({ serviceId: 1, isEmergency: true });
    expect(quote).toEqual(emergencyQuote);
  });
});

describe('create request body', () => {
  it('omits providerId entirely for an auto-assigned booking', async () => {
    /* providerId is `.optional()`, and its absence is the *only* signal that
       triggers the offer cascade. Sending `providerId: null` or an empty string
       would be a 422, and sending a placeholder uuid would auto-assign a job to
       a professional who never agreed to it. */
    const seen = capture(201, bookingRow);
    await bookingApi.create({
      serviceId: 1,
      addressId: bookingRow.addressId,
      scheduledStart: bookingRow.scheduledStart,
      scheduledEnd: bookingRow.scheduledEnd,
      paymentMode: 'CASH'
    });
    expect('providerId' in seen[0].body).toBe(false);
  });

  it('sends only the keys the strict create schema accepts', async () => {
    /* bookingCreateSchema is `.strict()`: one unrecognised key is a 422
       VALIDATION_FAILED and the booking is not created. */
    const seen = capture(201, bookingRow);
    await bookingApi.create({
      providerId: bookingRow.providerId as string,
      serviceId: 1,
      addressId: bookingRow.addressId,
      scheduledStart: bookingRow.scheduledStart,
      scheduledEnd: bookingRow.scheduledEnd,
      problemText: 'Kitchen tap is leaking',
      paymentMode: 'ONLINE',
      isEmergency: true
    });
    expect(Object.keys(seen[0].body).sort()).toEqual(['addressId', 'isEmergency', 'paymentMode', 'problemText', 'providerId', 'scheduledEnd', 'scheduledStart', 'serviceId'].sort());
  });

  it('never sends an undefined optional key as a literal', async () => {
    /* JSON.stringify drops undefined values, so this guards the *body builder*
       rather than the transport: an absent coupon must be absent, not empty,
       because `couponCode: ""` fails the schema's `.min(1)`. */
    const seen = capture(201, bookingRow);
    await bookingApi.create({
      serviceId: 1,
      addressId: bookingRow.addressId,
      scheduledStart: bookingRow.scheduledStart,
      scheduledEnd: bookingRow.scheduledEnd,
      paymentMode: 'CASH'
    });
    expect(Object.values(seen[0].body)).not.toContain(undefined);
    expect('couponCode' in seen[0].body).toBe(false);
  });

  it('returns the payment redirect only when the API sends one', async () => {
    /* A CASH booking is REQUESTED immediately and carries no payment. An ONLINE
       one is PENDING_PAYMENT and does — and "created" does not mean "booked". */
    capture(201, bookingRow);
    const cash = await bookingApi.create({
      serviceId: 1,
      addressId: bookingRow.addressId,
      scheduledStart: bookingRow.scheduledStart,
      scheduledEnd: bookingRow.scheduledEnd,
      paymentMode: 'CASH'
    });
    expect((cash as CreatedBooking).payment).toBeUndefined();

    const redirectUrl = '/api/v1/dev/payments/8b1f0f2a-0000-4000-8000-0000000000p1?returnUrl=%2Fcheckout%2Freturn';
    capture(201, { ...bookingRow, status: 'PENDING_PAYMENT', paymentMode: 'ONLINE', paymentStatus: 'PENDING', payment: { paymentId: 'p1', redirectUrl } });
    const online = await bookingApi.create({
      serviceId: 1,
      addressId: bookingRow.addressId,
      scheduledStart: bookingRow.scheduledStart,
      scheduledEnd: bookingRow.scheduledEnd,
      paymentMode: 'ONLINE'
    });
    expect(online.status).toBe('PENDING_PAYMENT');
    expect(online.payment?.redirectUrl).toBe(redirectUrl);
  });
});

describe('booking reads', () => {
  it('sends no status filter when none was chosen', async () => {
    /* `bookingListQuerySchema` is `.strict()`, so an empty `?status=` would be a
       422 rather than "everything". */
    const seen = capture(200, { items: [bookingRow] });
    await bookingApi.listMine();
    expect(seen[0].url).not.toContain('status=');
  });

  it('sends only statuses the list schema accepts', async () => {
    const seen = capture(200, { items: [] });
    await bookingApi.listMine('CANCELLED_CUSTOMER');
    expect(seen[0].url).toContain('status=CANCELLED_CUSTOMER');
    /* VERIFIED is a real booking_status and `GET /bookings/:id` returns it, but
       it is not in the list filter's enum — asking for it is a 422. That gap is
       reported in BACKEND_REQUIREMENTS.md §3.2. */
    expect(seen[0].url).not.toContain('VERIFIED');
  });

  it("answers 404 for a booking that is not the caller's, and does not soften it", async () => {
    /* getOwned filters on customer_id OR provider_id, so somebody else's booking
       is indistinguishable from one that does not exist. The frontend can only
       ever say "not found". */
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respond(404, problem(404, 'NOT_FOUND', 'Booking')))
    );
    const error = await bookingApi.get('8b1f0f2a-0000-4000-8000-0000000000ff').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(404);
  });

  it('surfaces SLOT_TAKEN as a distinct code rather than a generic failure', async () => {
    /* The exclusion constraint on (provider, slot) is the final arbiter, so of two
       customers racing for one slot exactly one loses — and that loser needs to be
       offered fresh availability, not a retry of the same time. */
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respond(409, problem(409, 'SLOT_TAKEN', 'That provider is no longer free at this time')))
    );
    const error = await bookingApi
      .create({
        serviceId: 1,
        addressId: bookingRow.addressId,
        scheduledStart: bookingRow.scheduledStart,
        scheduledEnd: bookingRow.scheduledEnd,
        paymentMode: 'CASH'
      })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('SLOT_TAKEN');
    expect((error as ApiError).status).toBe(409);
  });

  it('sends an empty body when cancelling without a reason', async () => {
    /* bookingCancelSchema is `.strict()` with an optional reason, so `{}` is
       valid and `{ reason: "" }` is not — it fails `.min(1)`. */
    const seen = capture(200, bookingRow);
    await bookingApi.cancel(bookingRow.id);
    expect(seen[0].body).toEqual({});
  });

  it('sends both instants for a reschedule', async () => {
    /* The API re-checks the new window against availability, leave and the same
       exclusion constraint, so a start on its own would be a 422. */
    const seen = capture(200, { ...bookingRow, rescheduleCount: 1 });
    await bookingApi.reschedule(bookingRow.id, { scheduledStart: '2026-10-06T04:00:00.000Z', scheduledEnd: '2026-10-06T05:30:00.000Z' });
    expect(Object.keys(seen[0].body).sort()).toEqual(['scheduledEnd', 'scheduledStart']);
    expect(seen[0].url).toContain(`/bookings/${bookingRow.id}/reschedule`);
  });
});

describe('chat', () => {
  it('reads the open flag from the server instead of deriving it from the status', async () => {
    /* `MessageService.list` computes `open` from its own status list, which is
       narrower than "the booking is live" — REQUESTED is live but the chat is
       closed until somebody accepts. Deriving it client-side would show a composer
       that 409s. */
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respond(200, { items: [], open: false }))
    );
    const thread = await bookingApi.listMessages(bookingRow.id);
    expect(thread.open).toBe(false);
    expect(thread.items).toEqual([]);
  });

  it('reports whether the platform masked a contact detail out of the message', async () => {
    /* `message-masking.ts` replaces phone numbers and emails with
       `[number hidden]` / `[email hidden]` before storing. A sender who is not
       told would believe the number reached the professional. */
    const message = {
      id: 'm1',
      senderUserId: 'u1',
      body: 'I am at the gate, call me on [number hidden]',
      mine: true,
      readAt: null,
      createdAt: '2026-10-05T04:10:00.000Z',
      masked: true
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respond(201, message))
    );
    const sent = await bookingApi.sendMessage(bookingRow.id, 'I am at the gate, call me on 03001234567');
    expect(sent.masked).toBe(true);
    expect(sent.body).toContain('[number hidden]');
  });

  it('never sends the raw text back as the stored body when it was masked', async () => {
    const seen = capture(201, { id: 'm1', senderUserId: 'u1', body: 'call [number hidden]', mine: true, readAt: null, createdAt: 'x', masked: true });
    const sent = await bookingApi.sendMessage(bookingRow.id, 'call 03001234567');
    /* What went over the wire is the original; what came back is the stored
       version. Rendering the sent text would claim a delivery that was altered. */
    expect(seen[0].body).toEqual({ body: 'call 03001234567' });
    expect(sent.body).not.toBe('call 03001234567');
  });
});

describe('evidence', () => {
  it('carries a clientUuid so a retried upload stores once', async () => {
    /* `ExecutionService.addEvidence` upserts on (booking_id, client_uuid) and
       answers 200 with duplicate: true for a repeat. Without the uuid a retry
       after a dropped connection would either duplicate the photo or fail. */
    const stored = {
      id: 'e1',
      kind: 'CUSTOMER_PROBLEM',
      clientUuid: '11111111-1111-4111-8111-111111111111',
      checklistItemId: null,
      contentType: 'image/jpeg',
      sizeBytes: 2048,
      receivedAt: '2026-10-05T04:00:00.000Z',
      clientCapturedAt: null,
      url: '/api/v1/dev/storage/evidence/8b1f/e1',
      duplicate: false
    };
    const seen = capture(201, stored);
    const result = await bookingApi.addEvidence(bookingRow.id, {
      clientUuid: stored.clientUuid,
      kind: 'CUSTOMER_PROBLEM',
      contentType: 'image/jpeg',
      contentBase64: '/9j/4AAQSkZJRg=='
    });
    expect(seen[0].body.clientUuid).toBe(stored.clientUuid);
    expect(result.duplicate).toBe(false);
  });

  it('sends raw base64, never a data: URL', async () => {
    /* The schema is a plain `z.string().min(1)` and the service does
       `Buffer.from(input, 'base64')`, so a `data:image/jpeg;base64,` prefix is
       silently decoded into garbage rather than rejected. */
    const seen = capture(201, { id: 'e1', duplicate: false });
    await bookingApi.addEvidence(bookingRow.id, {
      clientUuid: '11111111-1111-4111-8111-111111111111',
      kind: 'CUSTOMER_PROBLEM',
      contentType: 'image/jpeg',
      contentBase64: '/9j/4AAQSkZJRg=='
    });
    expect(seen[0].body.contentBase64).toBe('/9j/4AAQSkZJRg==');
    expect(String(seen[0].body.contentBase64).startsWith('data:')).toBe(false);
  });
});
