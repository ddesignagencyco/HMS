import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminComplaints } from '@/features/admin/complaints-view';
import { AdminSettings } from '@/features/admin/settings-view';
import { AdminTemplates } from '@/features/admin/templates-view';
import { AdminApprovals } from '@/features/admin/approvals-view';
import { getDictionary } from '@/lib/dictionaries';
import type { Locale } from '@/lib/utils';

/* The remaining admin screens.
 *
 * The properties pinned here are the ones a mock could not have had:
 *
 * · **The complaint queue's order and SLA numbers are the server's.**
 *   `slaRemainingMinutes` and `slaBreached` are computed by `complaints.service.ts`;
 *   a screen that recomputed a deadline would disagree with the server by however
 *   long the page was open. The tests seed a *breached* row and assert the screen
 *   reports the breach rather than showing a fresh countdown.
 *
 * · **A complaint decision is built from `RESOLUTIONS`, not from free text**, and
 *   the extra field each of three members needs is only asked for on that member.
 *
 * · **A setting's editor is chosen by the value's current type**, because
 *   `SettingRow.value` is a real union — a boolean must not be edited as text.
 *
 * · **A template cannot be saved without a preview**, because the preview route is
 *   the only thing that reports a placeholder the system would not fill.
 *
 * · **Approval stays disabled until the CNIC is verified**, which is the server's
 *   409 stated in advance rather than discovered on submit. */

const dict = getDictionary('en');
const locale: Locale = 'en';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const problem = (status: number, code: string, detail: string) =>
  new Response(JSON.stringify({ type: 'about:blank', title: 'x', status, code, detail, errors: [] }), {
    status,
    headers: { 'content-type': 'application/problem+json' }
  });

const wrap = ({ children }: { children: ReactNode }) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0, gcTime: 0 } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

const complaint = (over: Record<string, unknown> = {}) => ({
  id: '00000000-0000-4000-8000-0000000000c1',
  bookingId: '00000000-0000-4000-8000-0000000000b1',
  bookingCode: 'SHM-0000042',
  raisedBy: '00000000-0000-4000-8000-000000000001',
  against: '00000000-0000-4000-8000-000000000098',
  source: 'CUSTOMER',
  category: 'QUALITY',
  severity: 'HIGH',
  status: 'OPEN',
  description: 'The same joint started leaking again the same evening.',
  slaDueAt: '2026-10-09T00:00:00.000Z',
  assignedTo: null,
  resolution: null,
  resolutionNote: null,
  createdAt: '2026-10-06T00:00:00.000Z',
  resolvedAt: null,
  raisedByName: 'Bilal Ahmed',
  againstName: 'Asad Raza',
  slaRemainingMinutes: 4320,
  slaBreached: false,
  ...over
});

const setting = (over: Record<string, unknown> = {}) => ({
  key: 'verification.sla_minutes',
  value: 60,
  description: 'How long an agent has to answer a verification call.',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...over
});

const template = (over: Record<string, unknown> = {}) => ({
  id: '00000000-0000-4000-8000-0000000000t1',
  eventKey: 'booking.accepted',
  channel: 'SMS',
  locale: 'en',
  subject: null,
  body: 'Your professional {{providerName}} is on the way for {{serviceName}}.',
  isActive: true,
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...over
});

const providerRow = (over: Record<string, unknown> = {}) => ({
  id: '00000000-0000-4000-8000-000000000098',
  email: 'bilal@example.com',
  phoneE164: '+923001234567',
  firstName: 'Bilal',
  lastName: 'Ahmed',
  status: 'ACTIVE',
  roles: ['PROVIDER'],
  createdAt: '2026-09-01T00:00:00.000Z',
  ...over
});

const documentRow = (over: Record<string, unknown> = {}) => ({
  id: '00000000-0000-4000-8000-0000000000d1',
  providerId: '00000000-0000-4000-8000-000000000098',
  docType: 'CNIC_FRONT',
  status: 'PENDING',
  /* Deliberately an unrecognisable value: a storage key is not a URL and must
     never be rendered as one. */
  storageKey: 'providers/098/cnic-front.jpg',
  reviewedBy: null,
  reviewedAt: null,
  reviewNote: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  ...over
});

let complaints: ReturnType<typeof complaint>[] = [];
let settings: ReturnType<typeof setting>[] = [];
let templates: ReturnType<typeof template>[] = [];
let providers: ReturnType<typeof providerRow>[] = [];
let documents: ReturnType<typeof documentRow>[] = [];
let cnic = { hasCnic: true, cnicVerified: false };
let previewMissing: string[] = [];
let fetchMock: ReturnType<typeof vi.fn>;

const stub = (): void => {
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method === 'POST' && url.includes('/preview')) return json({ rendered: 'text', missing: previewMissing });
    if (method === 'POST' && url.includes('/review')) return json(documentRow({ status: 'VERIFIED' }));
    if (method === 'POST') return json({});
    if (method === 'PUT') return json({});
    /* The detail route is checked first: its path also contains
       `/api/v1/admin/complaints`, so the list branch would otherwise swallow it and
       hand the panel a `{ items }` envelope — which renders `undefined` as a date
       and throws `RangeError: Invalid time value`. */
    if (url.includes('/admin/complaints/')) {
      const head = complaints[0];
      return json({
        ...head,
        booking: head === undefined ? null : { status: 'VERIFIED', paymentMode: 'ONLINE', finalAmountPaisa: 200_000 },
        disputes: [],
        penalties: [],
        timeline: []
      });
    }
    if (url.includes('/api/v1/admin/complaints')) return json({ items: complaints });
    if (url.includes('/api/v1/admin/settings')) return json({ items: settings });
    if (url.includes('/api/v1/admin/templates')) return json({ items: templates, variables: ['providerName', 'serviceName'] });
    if (url.includes('/api/v1/admin/providers') && url.includes('/documents')) return json({ items: documents, cnic });
    if (url.includes('/api/v1/admin/users')) return json({ items: providers });
    throw new Error(`unrouted ${method} ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
};

beforeEach(() => {
  complaints = [complaint()];
  settings = [setting()];
  templates = [template()];
  providers = [providerRow()];
  documents = [documentRow()];
  cnic = { hasCnic: true, cnicVerified: false };
  previewMissing = [];
  stub();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Every write, whatever its verb — settings and templates write with PUT, and a
    POST-only filter would have counted zero and passed vacuously. */
const writes = () => fetchMock.mock.calls.filter(([, init]) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes((init as RequestInit | undefined)?.method ?? 'GET'));
const bodyOf = (index: number) => JSON.parse(String((writes()[index][1] as RequestInit).body)) as Record<string, unknown>;

const renderComplaints = () => render(<AdminComplaints locale={locale} dict={dict} />, { wrapper: wrap });
const renderApprovals = (props: { providerId?: string } = {}) => render(<AdminApprovals locale={locale} dict={dict} {...props} />, { wrapper: wrap });

/** The provider-level opener, named because the document list on the same card has
    its own "Reject" and two identical buttons cannot be told apart. */
const rejectProvider = (name: string) => screen.getByRole('button', { name: `${dict.admin.reject}: ${name}` });

describe('the complaint queue', () => {
  it('shows the SLA the server computed, including a breach', async () => {
    complaints = [complaint({ severity: 'SAFETY', slaRemainingMinutes: -30, slaBreached: true })];
    stub();
    renderComplaints();
    await screen.findByText('SHM-0000042');

    /* `slaBreached` is the server's verdict. Recomputing a deadline here would show
       a fresh countdown for a complaint that is already late. */
    expect(screen.getByText(dict.admin.slaBreached)).toBeDefined();
    expect(screen.queryByText(new RegExp(dict.admin.slaInMinutes.replace('{minutes}', '-30')))).toBeNull();
  });

  it('shows a countdown for one still inside its window', async () => {
    renderComplaints();
    await screen.findByText('SHM-0000042');
    /* 4320 minutes is 72 hours — the Normal SLA — so both parts are shown. */
    expect(screen.getByText(dict.admin.slaInHoursMinutes.replace('{hours}', '72').replace('{minutes}', '0'))).toBeDefined();
  });

  it('does not re-sort the queue in the browser', async () => {
    complaints = [complaint({ id: 'a', bookingCode: 'SHM-AAA', severity: 'SAFETY' }), complaint({ id: 'b', bookingCode: 'SHM-BBB', severity: 'NORMAL' })];
    stub();
    renderComplaints();
    await screen.findByText('SHM-AAA');
    /* SAFETY first is the server's ordering decision. Re-sorting would discard its
       judgement about what is urgent. */
    const rows = document.querySelectorAll('tbody tr');
    expect(rows[0].textContent).toContain('SHM-AAA');
  });

  it('requires a resolution before closing a complaint', async () => {
    renderComplaints();
    await screen.findByText('SHM-0000042');
    fireEvent.click(screen.getByRole('button', { name: `${dict.admin.takeAction}: SHM-0000042` }));
    fireEvent.change(await screen.findByLabelText(dict.admin.moveTo), { target: { value: 'RESOLVED' } });
    fireEvent.change(screen.getByLabelText(dict.admin.note), { target: { value: 'Work was redone' } });
    fireEvent.click(screen.getByRole('button', { name: dict.admin.recordDecision }));

    /* A decision with no consequence is not a decision, and the server enforces it. */
    expect(screen.getByRole('alert').textContent).toContain(dict.admin.resolutionRequired);
    expect(writes()).toHaveLength(0);
  });

  it('asks for a refund amount only on the resolution that needs one', async () => {
    renderComplaints();
    await screen.findByText('SHM-0000042');
    fireEvent.click(screen.getByRole('button', { name: `${dict.admin.takeAction}: SHM-0000042` }));
    fireEvent.change(await screen.findByLabelText(dict.admin.moveTo), { target: { value: 'RESOLVED' } });
    fireEvent.change(screen.getByLabelText(dict.admin.resolution), { target: { value: 'PARTIAL_REFUND' } });

    expect(screen.getByLabelText(dict.admin.refundAmount)).toBeDefined();
    fireEvent.change(screen.getByLabelText(dict.admin.resolution), { target: { value: 'WARNING' } });
    expect(screen.queryByLabelText(dict.admin.refundAmount)).toBeNull();
  });

  it('sends only the fields the chosen resolution needs', async () => {
    renderComplaints();
    await screen.findByText('SHM-0000042');
    fireEvent.click(screen.getByRole('button', { name: `${dict.admin.takeAction}: SHM-0000042` }));
    fireEvent.change(await screen.findByLabelText(dict.admin.moveTo), { target: { value: 'RESOLVED' } });
    fireEvent.change(screen.getByLabelText(dict.admin.resolution), { target: { value: 'PARTIAL_REFUND' } });
    fireEvent.change(screen.getByLabelText(dict.admin.refundAmount), { target: { value: '50000' } });
    fireEvent.change(screen.getByLabelText(dict.admin.note), { target: { value: 'Half the work was not done' } });
    fireEvent.click(screen.getByRole('button', { name: dict.admin.recordDecision }));

    await waitFor(() => expect(writes()).toHaveLength(1));
    /* `complaintTransitionSchema` is `.strict()`; a suspensionDays on a refund would
       be refused outright. */
    expect(bodyOf(0)).toEqual({ to: 'RESOLVED', note: 'Half the work was not done', resolution: 'PARTIAL_REFUND', refundPaisa: 50000 });
  });

  it('offers no decision controls on a closed complaint', async () => {
    complaints = [complaint({ status: 'RESOLVED' })];
    stub();
    renderComplaints();
    await screen.findByText('SHM-0000042');
    fireEvent.click(screen.getByRole('button', { name: `${dict.admin.takeAction}: SHM-0000042` }));
    /* `transition` and `assign` both refuse a closed complaint with a 409. */
    await screen.findByText(/cannot be reassigned or moved/);
    expect(screen.queryByRole('button', { name: dict.admin.recordDecision })).toBeNull();
  });

  it('reports a 403 as a failure, not an empty queue', async () => {
    fetchMock = vi.fn(async () => problem(403, 'TOTP_REQUIRED', 'Second factor required'));
    vi.stubGlobal('fetch', fetchMock);
    renderComplaints();
    await screen.findByRole('alert');
    /* "No complaints" and "you cannot read the queue" are opposite claims. */
    expect(screen.queryByText(dict.admin.noComplaints)).toBeNull();
    expect(screen.getByText(dict.admin.adminTotpRequired)).toBeDefined();
  });
});

describe('platform settings', () => {
  it('edits a boolean as a checkbox, not as text', async () => {
    settings = [setting({ key: 'verification.require_verified_cnic', value: true, description: 'Require a verified CNIC.' })];
    stub();
    render(<AdminSettings locale={locale} dict={dict} />, { wrapper: wrap });
    await screen.findByText('verification.require_verified_cnic');
    /* The value union is real: a boolean sent as the string "true" would be a
       different setting. */
    expect(screen.getByRole('checkbox')).toBeDefined();
    expect(screen.queryByLabelText('verification.require_verified_cnic Value')).toBeNull();
  });

  it('edits an array as JSON and refuses malformed text before sending', async () => {
    settings = [setting({ key: 'booking.allowed_slugs', value: ['leak-repair'], description: 'Bookable slugs.' })];
    stub();
    render(<AdminSettings locale={locale} dict={dict} />, { wrapper: wrap });
    const field = await screen.findByLabelText('booking.allowed_slugs Value');
    fireEvent.change(field, { target: { value: '{not json' } });
    fireEvent.click(screen.getByRole('button', { name: dict.portal.save }));

    expect(screen.getByRole('alert').textContent).toContain(dict.admin.invalidJson);
    expect(writes()).toHaveLength(0);
  });

  it('refuses an array whose entries are not strings', async () => {
    settings = [setting({ key: 'booking.allowed_slugs', value: ['leak-repair'], description: 'Bookable slugs.' })];
    stub();
    render(<AdminSettings locale={locale} dict={dict} />, { wrapper: wrap });
    const field = await screen.findByLabelText('booking.allowed_slugs Value');
    fireEvent.change(field, { target: { value: '[1, 2]' } });
    fireEvent.click(screen.getByRole('button', { name: dict.portal.save }));

    expect(screen.getByRole('alert').textContent).toContain(dict.admin.wrongShape);
    expect(writes()).toHaveLength(0);
  });

  it('writes a number as a number', async () => {
    render(<AdminSettings locale={locale} dict={dict} />, { wrapper: wrap });
    const field = await screen.findByLabelText('verification.sla_minutes Value');
    fireEvent.change(field, { target: { value: '90' } });
    fireEvent.click(screen.getByRole('button', { name: dict.portal.save }));

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(bodyOf(0)).toEqual({ value: 90 });
  });
});

describe('notification templates', () => {
  it('will not save a draft that has not been previewed', async () => {
    render(<AdminTemplates locale={locale} dict={dict} />, { wrapper: wrap });
    await screen.findByText('booking.accepted');
    fireEvent.click(screen.getByRole('button', { name: dict.admin.saveTemplate }));

    /* The preview route is the only thing that reports a placeholder the system
       would not fill, so it is the gate rather than an optional extra. */
    expect(screen.getByRole('alert').textContent).toContain(dict.admin.previewFirst);
    expect(writes()).toHaveLength(0);
  });

  it('refuses to save a draft with an unfilled placeholder', async () => {
    previewMissing = ['serviceName'];
    render(<AdminTemplates locale={locale} dict={dict} />, { wrapper: wrap });
    await screen.findByText('booking.accepted');
    fireEvent.click(screen.getByRole('button', { name: dict.admin.preview }));
    await screen.findByText(dict.admin.previewMissing.replace('{placeholders}', '{{serviceName}}'));

    fireEvent.click(screen.getByRole('button', { name: dict.admin.saveTemplate }));
    expect(screen.getByRole('alert').textContent).toContain(dict.admin.fixPlaceholdersFirst);
    /* Only the preview was sent; the template was not. */
    expect(writes()).toHaveLength(1);
  });

  it('saves once the preview reports every placeholder filled', async () => {
    render(<AdminTemplates locale={locale} dict={dict} />, { wrapper: wrap });
    await screen.findByText('booking.accepted');
    fireEvent.click(screen.getByRole('button', { name: dict.admin.preview }));
    await screen.findByText(dict.admin.previewClean);
    fireEvent.click(screen.getByRole('button', { name: dict.admin.saveTemplate }));

    await waitFor(() => expect(writes()).toHaveLength(2));
  });

  it('invalidates the preview as soon as the draft is edited', async () => {
    render(<AdminTemplates locale={locale} dict={dict} />, { wrapper: wrap });
    await screen.findByText('booking.accepted');
    fireEvent.click(screen.getByRole('button', { name: dict.admin.preview }));
    await screen.findByText(dict.admin.previewClean);

    fireEvent.change(screen.getByLabelText(dict.admin.templateBody), { target: { value: 'Now with {{unfilled}}' } });
    /* The clean result belonged to the previous draft, not to this one. */
    expect(screen.queryByText(dict.admin.previewClean)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: dict.admin.saveTemplate }));
    expect(screen.getByRole('alert').textContent).toContain(dict.admin.previewFirst);
  });
});

describe('professional approvals', () => {
  it('keeps approval disabled until the CNIC is verified, and says why', async () => {
    renderApprovals();
    await screen.findByText('Bilal Ahmed');
    /* `ProviderApprovalService.approve` throws a 409 until the CNIC is verified, so
       the button's only possible answer was a rejection. */
    expect(screen.getByRole('button', { name: dict.admin.approve }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByText(dict.admin.approveBlocked)).toBeDefined();
  });

  it('enables approval once the server says the CNIC is verified', async () => {
    cnic = { hasCnic: true, cnicVerified: true };
    stub();
    renderApprovals();
    /* Awaited on the CNIC badge rather than the name: the approval button depends on
       the *documents* query, which is a second request. Asserting as soon as the
       name appears would read the button before its gate had been decided. */
    await screen.findByText(dict.admin.cnicVerified);
    expect(screen.getByRole('button', { name: dict.admin.approve }).hasAttribute('disabled')).toBe(false);
  });

  it('requires a reason to reject, because that is what the professional is shown', async () => {
    renderApprovals();
    await screen.findByText(dict.admin.docTypes.CNIC_FRONT);
    fireEvent.click(rejectProvider('Bilal Ahmed'));
    fireEvent.click(screen.getByRole('button', { name: dict.admin.rejectConfirm }));

    /* `providerRejectSchema` requires a reason; without one the call is a 422. */
    expect(screen.getByRole('alert').textContent).toContain(dict.admin.rejectReasonRequired);
    expect(writes()).toHaveLength(0);
  });

  it('sends the rejection reason with the provider id', async () => {
    renderApprovals();
    await screen.findByText(dict.admin.docTypes.CNIC_FRONT);
    fireEvent.click(rejectProvider('Bilal Ahmed'));
    fireEvent.change(screen.getByLabelText(dict.admin.rejectReason), { target: { value: 'The CNIC scan is not legible' } });
    fireEvent.click(screen.getByRole('button', { name: dict.admin.rejectConfirm }));

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(String(writes()[0][0] as string).includes('/reject')).toBe(true);
    expect(bodyOf(0)).toEqual({ reason: 'The CNIC scan is not legible' });
  });

  it('never renders a document storage key as if it were a link', async () => {
    renderApprovals();
    await screen.findByText(dict.admin.docTypes.CNIC_FRONT);
    /* The file is fetched through the signed-url route, and every call to it is
       audited — so the raw key stays on the server. */
    expect(document.body.textContent).not.toContain('cnic-front.jpg');
  });

  it('says the approval status is not published rather than labelling every row', async () => {
    renderApprovals();
    await screen.findByText('Bilal Ahmed');
    /* `GET /admin/users?role=PROVIDER` publishes `user_status`, not
       `provider_status`, so the screen cannot claim to know who awaits a decision. */
    expect(screen.getByText(dict.admin.providerStatusNotPublished)).toBeDefined();
  });

  it('scopes to one professional when an id is given', async () => {
    providers = [providerRow({ id: 'aaa', firstName: 'Bilal', lastName: 'Ahmed' }), providerRow({ id: 'bbb', firstName: 'Sana', lastName: 'Raza' })];
    stub();
    renderApprovals({ providerId: 'bbb' });
    await screen.findByText('Sana Raza');
    expect(screen.queryByText('Bilal Ahmed')).toBeNull();
  });
});
