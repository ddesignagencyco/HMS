import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminAuditLog } from '@/features/admin/audit-view';
import { AdminRoles } from '@/features/admin/roles-view';
import { getDictionary } from '@/lib/dictionaries';
import type { Locale } from '@/lib/utils';

/* The two read-only admin surfaces that had a real endpoint all along.
 *
 * The screens these replace rendered fixed columns from `src/lib/data.ts` — an
 * audit trail of actions nobody had taken, and a permission matrix that was a
 * description of the roles rather than the roles themselves.
 *
 * The properties pinned here are the ones that are easy to fake and impossible to
 * check by eye:
 *
 * · **`before`/`after` are `Prisma.JsonValue`.** Null, a scalar, or an object of
 *   whatever the caller recorded, varying across ~30 action names. The screen must
 *   render whatever arrived rather than reaching in for named fields — and must
 *   never print `[object Object]`.
 * · **`actorUserId` is null for system actions**, which is a value, not a missing
 *   join.
 * · **A 403 is a failure.** Every admin route is `totpRequired`, so "no rows" and
 *   "you cannot see them" are very different things to show an operator. */

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

const role = (over: Record<string, unknown> = {}) => ({
  code: 'ADMIN',
  name: 'Administrator',
  permissions: ['provider.approve', 'settings.write'],
  ...over
});

const auditRow = (over: Record<string, unknown> = {}) => ({
  id: '00000000-0000-4000-8000-0000000000aa',
  actorUserId: '00000000-0000-4000-8000-000000000001',
  actorRole: 'ADMIN',
  action: 'admin.user.block',
  entityType: 'user',
  entityId: '00000000-0000-4000-8000-000000000002',
  before: { status: 'ACTIVE' },
  after: { status: 'LOCKED' },
  createdAt: '2026-10-01T09:00:00.000Z',
  ...over
});

let roles: ReturnType<typeof role>[] = [];
let audit: ReturnType<typeof auditRow>[] = [];
let status = 200;

const stub = (): void => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (status !== 200) return problem(status, 'TOTP_REQUIRED', 'Second factor required');
      if (url.includes('/api/v1/admin/audit')) return json({ items: audit });
      if (url.includes('/api/v1/admin/roles')) return json({ items: roles });
      throw new Error(`unrouted GET ${url}`);
    })
  );
};

beforeEach(() => {
  roles = [role()];
  audit = [auditRow()];
  status = 200;
  stub();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const renderRoles = () => render(<AdminRoles locale={locale} dict={dict} />, { wrapper: wrap });
const renderAudit = () => render(<AdminAuditLog locale={locale} dict={dict} />, { wrapper: wrap });

describe('the roles matrix', () => {
  it('renders the permission codes the API returned', async () => {
    renderRoles();
    expect(await screen.findByText('Administrator')).toBeDefined();
    expect(screen.getByText('provider.approve')).toBeDefined();
    expect(screen.getByText('settings.write')).toBeDefined();
  });

  it('shows a role with no permissions as having none, rather than as broken', async () => {
    /* `LEFT JOIN` with `FILTER (WHERE … IS NOT NULL)` yields `{}` for a role with
       no rows, so an empty array is a real state. */
    roles = [role({ code: 'FINANCE', name: 'Finance', permissions: [] })];
    stub();
    renderRoles();
    expect(await screen.findByText('Finance')).toBeDefined();
    expect(screen.getByText(dict.admin.noPermissions)).toBeDefined();
  });

  it('offers no grant or revoke control, because the API acts on a person', async () => {
    renderRoles();
    await screen.findByText('Administrator');
    /* `POST /admin/users/:userId/roles/:roleCode` needs a user. A control here
       would mean inventing a picker, so the actions live on the account instead. */
    expect(screen.queryAllByRole('button').length).toBe(0);
    expect(document.body.textContent).toContain(dict.admin.rolesActionsNote);
  });

  it('reports a 403 as a failure rather than an empty matrix', async () => {
    status = 403;
    stub();
    renderRoles();
    expect(await screen.findByRole('alert')).toBeDefined();
    expect(screen.getByText(dict.admin.adminTotpRequired)).toBeDefined();
  });
});

describe('the audit log', () => {
  it('shows the action, the actor and the entity from the row', async () => {
    renderAudit();
    expect(await screen.findByText('admin.user.block')).toBeDefined();
    expect(screen.getByText('user')).toBeDefined();
  });

  it('renders the recorded before and after as text, not as [object Object]', async () => {
    renderAudit();
    await screen.findByText('admin.user.block');
    const body = document.body.textContent ?? '';
    expect(body).not.toContain('[object Object]');
    /* The values are what the caller recorded, so they are printed as they are. */
    expect(body).toContain('ACTIVE');
    expect(body).toContain('LOCKED');
  });

  it('says a system action had no actor, rather than showing a blank', async () => {
    /* `audit_log.actor_user_id` is nullable, so "no actor" is a value. */
    audit = [auditRow({ actorUserId: null, action: 'platform.sweep' })];
    stub();
    renderAudit();
    expect(await screen.findByText('platform.sweep')).toBeDefined();
    expect(screen.getByText(dict.admin.systemAction)).toBeDefined();
  });

  it('records "nothing recorded" for a null before, rather than the word null', async () => {
    /* `admin.role.grant` records no `before` — there was no prior state. */
    audit = [auditRow({ action: 'admin.role.grant', before: null, after: { role: 'AGENT' } })];
    stub();
    renderAudit();
    await screen.findByText('admin.role.grant');
    expect(document.body.textContent).toContain(dict.admin.noChangeRecorded);
    expect(document.body.textContent).not.toContain(': null');
  });

  it('does not invent a diff of fields it does not know about', async () => {
    /* The shape varies per action, so a "changed field" column would have to guess
       which keys matter. The value is shown whole instead. */
    audit = [auditRow({ before: { nested: { deep: [1, 2] } }, after: null })];
    stub();
    renderAudit();
    await screen.findByText('admin.user.block');
    expect(document.body.textContent).toContain('deep');
  });

  it('reports a 403 rather than an empty log', async () => {
    status = 403;
    stub();
    renderAudit();
    expect(await screen.findByRole('alert')).toBeDefined();
    /* "Nothing recorded yet" and "you cannot read the log" are opposite claims. */
    expect(screen.queryByText(dict.admin.noAuditRows)).toBeNull();
  });

  it('trims the filter before sending it, because a bare space is a 422', async () => {
    renderAudit();
    await screen.findByText('admin.user.block');
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const before = fetchMock.mock.calls.length;

    const input = screen.getByLabelText(dict.admin.auditAction);
    /* jsdom does not run form submission for a click on a submit button in all
       versions, so the native requestSubmit path is used explicitly. */
    input.closest('form')?.requestSubmit();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const after = fetchMock.mock.calls.slice(before).map(([url]) => String(url));
    expect(after.every((url) => !url.includes('action='))).toBe(true);
  });
});
