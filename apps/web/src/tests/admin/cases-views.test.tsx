import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminAppeals, AdminPenalties } from '@/features/admin/conduct-view';
import { AdminDisputes } from '@/features/admin/disputes-view';
import { getDictionary } from '@/lib/dictionaries';
import type { Locale } from '@/lib/utils';

/* Cases: disputes, penalties and appeals.
 *
 * Three server rules are enforced *in the UI* here, and each one is the reason a
 * control is missing, disabled, or conditional rather than left to fail:
 *
 * · **`apply` on a penalty is refused until the professional has replied or 48 hours
 *   have passed.** The tests pin that a proposed penalty inside its reply window
 *   has a disabled Apply and says why, while one past the window does not.
 * · **`overrideReason` is required to rule before the reply window closes without a
 *   reply.** So the override box appears in exactly that state and not otherwise —
 *   an override field sitting on every ruling would invite a reason for a decision
 *   that does not need one.
 * · **`UPHELD` changes nothing, `REVERSED` undoes the penalty exactly, `PARTIAL`
 *   refunds part of the fine and keeps the points.** Three different consequences,
 *   so each is spelled out before the decision rather than discovered after it. */

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

const dispute = (over: Record<string, unknown> = {}) => ({
  id: '00000000-0000-4000-8000-0000000000d1',
  bookingCode: 'SHM-0000042',
  origin: 'COMPLAINT',
  status: 'AWAITING_PROVIDER_REPLY',
  /* Well in the future: the reply window is open, which is the state that matters. */
  replyDueAt: new Date(Date.now() + 86_400_000).toISOString(),
  providerReplied: false,
  createdAt: '2026-10-01T09:00:00.000Z',
  resolution: null,
  provider: 'Bilal Ahmed',
  ...over
});

const penalty = (over: Record<string, unknown> = {}) => ({
  id: '00000000-0000-4000-8000-0000000000p1',
  providerId: '00000000-0000-4000-8000-000000000098',
  breachCode: 'OVERCHARGE',
  breachName: 'Overcharging',
  category: 'MONEY',
  points: 3,
  status: 'PROPOSED',
  bookingCode: 'SHM-0000042',
  finePaisa: 50_000,
  replyDueAt: new Date(Date.now() + 86_400_000).toISOString(),
  providerReply: null,
  repliedAt: null,
  evidence: { note: 'Customer confirmed on the verification call' },
  appliedAt: null,
  createdAt: '2026-10-01T09:00:00.000Z',
  ...over
});

const appeal = (over: Record<string, unknown> = {}) => ({
  id: '00000000-0000-4000-8000-0000000000a1',
  penaltyId: '00000000-0000-4000-8000-0000000000p1',
  providerId: '00000000-0000-4000-8000-000000000098',
  grounds: 'The photos contradict the customer',
  status: 'OPEN',
  decisionNote: null,
  createdAt: '2026-10-02T09:00:00.000Z',
  decidedAt: null,
  breachCode: 'OVERCHARGE',
  finePaisa: 50_000,
  ...over
});

let disputes: ReturnType<typeof dispute>[] = [];
let penalties: ReturnType<typeof penalty>[] = [];
let appeals: ReturnType<typeof appeal>[] = [];
let fetchMock: ReturnType<typeof vi.fn>;

const stub = (): void => {
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method === 'POST' && url.includes('/resolve')) return json({ status: 'RESOLVED' });
    if (method === 'POST' && url.includes('/apply')) return json({ status: 'APPLIED' });
    if (method === 'POST' && url.includes('/decide')) return json({ status: 'REVERSED' });
    if (url.includes('/api/v1/admin/disputes')) return json({ items: disputes });
    if (url.includes('/api/v1/admin/penalties')) return json({ items: penalties });
    if (url.includes('/api/v1/admin/appeals')) return json({ items: appeals });
    throw new Error(`unrouted ${method} ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
};

beforeEach(() => {
  disputes = [dispute()];
  penalties = [penalty()];
  appeals = [appeal()];
  stub();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const posts = () => fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST');
const bodyOf = (index: number) => JSON.parse(String((posts()[index][1] as RequestInit).body)) as Record<string, unknown>;

describe('disputes', () => {
  it('shows the professional right of reply as open, not as a plain date', async () => {
    render(<AdminDisputes locale={locale} dict={dict} />, { wrapper: wrap });
    expect(await screen.findByText('SHM-0000042')).toBeDefined();
    /* The queue publishes `replyDueAt` and `providerReplied` separately, and the
       standing note on the card says what that window is for. */
    expect(document.body.textContent).toContain(dict.admin.rightOfReplyNote);
    expect(document.body.textContent).toContain('Reply due');
  });

  it('asks for a reason only when ruling before the reply window closes', async () => {
    render(<AdminDisputes locale={locale} dict={dict} />, { wrapper: wrap });
    await screen.findByText('SHM-0000042');
    fireEvent.click(screen.getByRole('button', { name: dict.admin.ruleOnDispute }));

    /* The window is open and no reply has come, so this is the one state the API
       demands `overrideReason` for. */
    expect(screen.getByLabelText(dict.admin.overrideReason)).toBeDefined();
  });

  it('offers no override once the window has closed', async () => {
    disputes = [dispute({ replyDueAt: new Date(Date.now() - 86_400_000).toISOString() })];
    stub();
    render(<AdminDisputes locale={locale} dict={dict} />, { wrapper: wrap });
    await screen.findByText('SHM-0000042');
    fireEvent.click(screen.getByRole('button', { name: dict.admin.ruleOnDispute }));

    /* Ruling now is unremarkable, so an override box would invite a reason for a
       decision that does not need one. */
    expect(screen.queryByLabelText(dict.admin.overrideReason)).toBeNull();
  });

  it('refuses to send a ruling with no note', async () => {
    render(<AdminDisputes locale={locale} dict={dict} />, { wrapper: wrap });
    await screen.findByText('SHM-0000042');
    fireEvent.click(screen.getByRole('button', { name: dict.admin.ruleOnDispute }));
    fireEvent.click(screen.getByRole('button', { name: dict.admin.recordRuling }));

    /* `resolveSchema` requires `note` with min(3). */
    expect(screen.getByRole('alert').textContent).toContain(dict.admin.noteRequired);
    expect(posts()).toHaveLength(0);
  });

  it('only asks for a release amount on the one ruling that takes one', async () => {
    render(<AdminDisputes locale={locale} dict={dict} />, { wrapper: wrap });
    await screen.findByText('SHM-0000042');
    fireEvent.click(screen.getByRole('button', { name: dict.admin.ruleOnDispute }));
    expect(screen.queryByLabelText(dict.admin.releaseAmount)).toBeNull();

    fireEvent.change(screen.getByLabelText(dict.admin.ruling), { target: { value: 'PARTIAL_RELEASE' } });
    expect(screen.getByLabelText(dict.admin.releaseAmount)).toBeDefined();
  });

  it('does not invent a ceiling on the release, and says why', async () => {
    render(<AdminDisputes locale={locale} dict={dict} />, { wrapper: wrap });
    await screen.findByText('SHM-0000042');
    fireEvent.click(screen.getByRole('button', { name: dict.admin.ruleOnDispute }));
    fireEvent.change(screen.getByLabelText(dict.admin.ruling), { target: { value: 'PARTIAL_RELEASE' } });

    /* The list carries no held figure, so capping the input here would be a limit
       invented from a row that does not have the number. */
    expect(screen.getByText(dict.admin.releaseAmountNote)).toBeDefined();
    const input = screen.getByLabelText(dict.admin.releaseAmount) as HTMLInputElement;
    expect(input.max).toBe('');
  });

  it('shows a resolved dispute as ruled rather than offering another ruling', async () => {
    disputes = [dispute({ status: 'RESOLVED', resolution: 'FULL_REFUND' })];
    stub();
    render(<AdminDisputes locale={locale} dict={dict} />, { wrapper: wrap });
    await screen.findByText('SHM-0000042');
    expect(screen.queryByRole('button', { name: dict.admin.ruleOnDispute })).toBeNull();
  });
});

describe('penalties', () => {
  it('blocks applying inside the reply window, and says it is their right of reply', async () => {
    render(<AdminPenalties locale={locale} dict={dict} />, { wrapper: wrap });
    await screen.findByText('Overcharging');
    /* A proposed penalty does nothing to the professional until applied, and the
       API refuses that until they have replied or 48 hours have passed. */
    expect(screen.getByRole('button', { name: dict.admin.applyPenalty }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByText(dict.admin.applyBlockedUntilReply)).toBeDefined();
    expect(screen.getByText(dict.admin.awaitingReply)).toBeDefined();
  });

  it('allows applying once the window has closed with no reply', async () => {
    penalties = [penalty({ replyDueAt: new Date(Date.now() - 86_400_000).toISOString() })];
    stub();
    render(<AdminPenalties locale={locale} dict={dict} />, { wrapper: wrap });
    await screen.findByText('Overcharging');
    expect(screen.getByRole('button', { name: dict.admin.applyPenalty }).hasAttribute('disabled')).toBe(false);
  });

  it('allows applying as soon as they have replied, whatever the deadline', async () => {
    penalties = [penalty({ providerReply: 'The extra work was agreed on the call', repliedAt: '2026-10-01T12:00:00.000Z' })];
    stub();
    render(<AdminPenalties locale={locale} dict={dict} />, { wrapper: wrap });
    await screen.findByText('Overcharging');
    expect(screen.getByRole('button', { name: dict.admin.applyPenalty }).hasAttribute('disabled')).toBe(false);
    /* And their reply is on screen, not just the fact that one exists. */
    expect(screen.getByText('The extra work was agreed on the call')).toBeDefined();
  });

  it('shows the fine the server computed, not one derived here', async () => {
    render(<AdminPenalties locale={locale} dict={dict} />, { wrapper: wrap });
    await screen.findByText('Overcharging');
    expect(screen.getByText('Rs 500')).toBeDefined();
  });

  it('never retries applying a penalty', async () => {
    /* Assigned to the same `fetchMock` the `posts()` helper reads — swapping the
       global without updating the reference would make the assertion vacuous. */
    fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'POST') return problem(500, 'INTERNAL_ERROR', 'boom');
      return json({ items: penalties });
    });
    vi.stubGlobal('fetch', fetchMock);
    penalties = [penalty({ replyDueAt: new Date(Date.now() - 86_400_000).toISOString() })];
    render(<AdminPenalties locale={locale} dict={dict} />, { wrapper: wrap });
    await screen.findByText('Overcharging');
    fireEvent.click(screen.getByRole('button', { name: dict.admin.applyPenalty }));

    /* Applying moves real money out of a professional's wallet. A silent retry is a
       second decision about their money that nobody made. */
    await waitFor(() => expect(posts()).toHaveLength(1));
  });
});

describe('appeals', () => {
  it('states the consequence of each decision before it is chosen', async () => {
    render(<AdminAppeals locale={locale} dict={dict} />, { wrapper: wrap });
    await screen.findByText('OVERCHARGE');
    fireEvent.click(screen.getByRole('button', { name: dict.admin.decideAppeal }));

    const select = screen.getByLabelText(dict.admin.decision) as HTMLSelectElement;
    /* Upheld changes nothing, reversed undoes it exactly, partial refunds part of
       the fine and keeps the points. Three different outcomes, not three labels. */
    expect(select.options).toHaveLength(3);
    expect(screen.getByText(dict.admin.appealDecisionEffects.UPHELD)).toBeDefined();

    fireEvent.change(select, { target: { value: 'REVERSED' } });
    expect(screen.getByText(dict.admin.appealDecisionEffects.REVERSED)).toBeDefined();
  });

  it('only asks for a refund amount on PARTIAL', async () => {
    render(<AdminAppeals locale={locale} dict={dict} />, { wrapper: wrap });
    await screen.findByText('OVERCHARGE');
    fireEvent.click(screen.getByRole('button', { name: dict.admin.decideAppeal }));
    expect(screen.queryByLabelText(dict.admin.refundFine)).toBeNull();

    fireEvent.change(screen.getByLabelText(dict.admin.decision), { target: { value: 'PARTIAL' } });
    expect(screen.getByLabelText(dict.admin.refundFine)).toBeDefined();
  });

  it('sends only the decision, the note and — on PARTIAL — the amount', async () => {
    render(<AdminAppeals locale={locale} dict={dict} />, { wrapper: wrap });
    await screen.findByText('OVERCHARGE');
    fireEvent.click(screen.getByRole('button', { name: dict.admin.decideAppeal }));
    fireEvent.change(screen.getByLabelText(dict.admin.decision), { target: { value: 'PARTIAL' } });
    fireEvent.change(screen.getByLabelText(dict.admin.refundFine), { target: { value: '20000' } });
    fireEvent.change(screen.getByLabelText(dict.admin.note), { target: { value: 'Partly justified' } });
    fireEvent.click(screen.getByRole('button', { name: dict.admin.recordDecision }));

    await waitFor(() => expect(posts()).toHaveLength(1));
    /* `decideSchema` is `.strict()`; a refundPaisa on a UPHELD would be accepted by
       the schema and silently ignored, which is worse than not sending it. */
    expect(bodyOf(0)).toEqual({ decision: 'PARTIAL', note: 'Partly justified', refundFinePaisa: 20000 });
  });

  it('offers no decision on an appeal that has already been decided', async () => {
    appeals = [appeal({ status: 'REVERSED', decisionNote: 'Photos contradicted the customer', decidedAt: '2026-10-03T09:00:00.000Z' })];
    stub();
    render(<AdminAppeals locale={locale} dict={dict} />, { wrapper: wrap });
    await screen.findByText('OVERCHARGE');
    expect(screen.queryByRole('button', { name: dict.admin.decideAppeal })).toBeNull();
    expect(screen.getByText('Photos contradicted the customer')).toBeDefined();
  });
});
