import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfileDetails } from '@/features/account/profile-view';
import { SessionProvider } from '@/features/auth/session';
import { getDictionary } from '@/lib/dictionaries';

/* The signed-in person's own profile.
 *
 * The screen this replaced rendered "Ayesha Khan / 0300 1234567 / Gulberg III"
 * for whoever was signed in. These tests pin what has to stay true:
 *
 * · every field comes from `GET /auth/session`, so a different account renders
 *   differently instead of the same literals;
 * · the phone and email are **masked** (NFR-PR-01);
 * · the editable parts write through `PATCH /me`, and only the fields that
 *   changed — an empty patch is a 422;
 * · deactivation calls `POST /me/deactivate` behind a confirmation, because it is
 *   irreversible from this screen.
 *
 * What changed when `me.controller.ts` arrived: the screen used to state that the
 * name could not be edited and that deactivation was unavailable, and both of those
 * notes were true then and are false now. The tests below assert the new contract,
 * so a regression back to the "no endpoint" screen fails here rather than shipping. */

const dict = getDictionary('en');

const user = {
  id: '00000000-0000-4000-8000-000000000001',
  phoneE164: '+923001234567',
  email: 'ayesha@example.com',
  firstName: 'Ayesha',
  lastName: 'Khan',
  locale: 'en',
  status: 'ACTIVE' as const,
  roles: ['CUSTOMER'],
  totpEnabled: false,
  providerStatus: null
};

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

/** Every PATCH the screen made, in order, so "only what changed" is assertable. */
let patches: { url: string; body: Record<string, unknown> }[] = [];
let fetchMock: ReturnType<typeof vi.fn>;

const renderProfile = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  /* The session provider has to be here: the screen reads the one `["auth","me"]`
     query rather than fetching again, and `useSession` throws outside it. */
  const Component = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <SessionProvider locale="en">{children}</SessionProvider>
    </QueryClientProvider>
  );
  return render(<ProfileDetails dict={dict} locale="en" />, { wrapper: Component });
};

beforeEach(() => {
  patches = [];
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input);
    if (init?.method === 'PATCH' && url.includes('/api/v1/me')) {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      patches.push({ url, body });
      return json({ user: { ...user, ...(typeof body.firstName === 'string' ? { firstName: body.firstName } : {}) } });
    }
    if (init?.method === 'POST' && url.includes('/api/v1/me/deactivate')) return json({ status: 'DEACTIVATED' });
    if (url.includes('/api/v1/auth/session')) return json({ authenticated: true, user });
    throw new Error(`unrouted ${init?.method ?? 'GET'} ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the profile screen', () => {
  it("shows the signed-in person's own name", async () => {
    renderProfile();
    expect(await screen.findByDisplayValue('Ayesha')).toBeDefined();
    expect(screen.getByDisplayValue('Khan')).toBeDefined();
  });

  it('masks the phone number rather than printing it', async () => {
    renderProfile();
    await screen.findByDisplayValue('Ayesha');
    expect(document.body.textContent).not.toContain('+923001234567');
    expect(document.body.textContent).not.toContain('03001234567');
    /* `maskPhone` keeps the country prefix and the last three digits, with the
       middle replaced — "+9230•••567" for this number. */
    expect(screen.getByText(/^\+9230.*567$/)).toBeDefined();
  });

  it('masks the email address', async () => {
    renderProfile();
    await screen.findByDisplayValue('Ayesha');
    expect(document.body.textContent).not.toContain('ayesha@example.com');
    /* "ay•••@example.com" — local part reduced to its first two characters. */
    expect(screen.getByText(/^ay.*@example\.com$/)).toBeDefined();
  });

  it('does not invent an area the API never returned', async () => {
    renderProfile();
    await screen.findByDisplayValue('Ayesha');
    /* The old screen printed "Gulberg III" for everyone. */
    expect(screen.queryByText('Gulberg III')).toBeNull();
  });

  it('says the provider status is unpublished instead of guessing it', async () => {
    renderProfile();
    await screen.findByDisplayValue('Ayesha');
    /* providerStatus is null for an account that is not a professional, and a null is
       shown as "not published" rather than being turned into an approval state. */
    expect(screen.getAllByText(dict.portal.notPublished).length).toBeGreaterThan(0);
  });

  it('states that the sign-in details are not editable here rather than offering a field that ignores input', async () => {
    renderProfile();
    await screen.findByDisplayValue('Ayesha');
    /* The phone and email are login identifiers: `profileUpdateSchema` is `.strict()`
       and does not accept them. The screen says so instead of shipping a control
       that accepts typing and silently discards it. */
    expect(screen.getByText(dict.portal.profileEditContactLocked)).toBeDefined();
  });

  it('writes a rename through PATCH /me', async () => {
    renderProfile();
    const first = await screen.findByDisplayValue('Ayesha');
    fireEvent.change(first, { target: { value: 'Ayesha' } });
    fireEvent.change(first, { target: { value: 'Ayesha!' } });
    fireEvent.click(screen.getByRole('button', { name: dict.portal.save }));

    await waitFor(() => expect(patches.length).toBe(1));
    expect(patches[0].url).toContain('/api/v1/me');
    expect(patches[0].body).toEqual({ firstName: 'Ayesha!' });
  });

  it('sends no patch at all when nothing changed', async () => {
    renderProfile();
    await screen.findByDisplayValue('Ayesha');
    fireEvent.click(screen.getByRole('button', { name: dict.portal.save }));

    /* The API refuses an empty patch — `profileUpdateSchema` requires at least one
       key — so a save with no edit must not reach the network at all. */
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(patches.length).toBe(0);
  });

  it('does not offer deactivation without a confirmation, and calls the endpoint once it is given', async () => {
    renderProfile();
    await screen.findByDisplayValue('Ayesha');

    /* The destructive control exists now — `POST /me/deactivate` is real — so the
       old assertion that there must be no such button no longer holds. */
    const button = screen.getByRole('button', { name: dict.portal.deactivate });
    expect(screen.queryByRole('button', { name: dict.portal.deactivateConfirmYes })).toBeNull();

    fireEvent.click(button);
    fireEvent.click(screen.getByRole('button', { name: dict.portal.deactivateConfirmYes }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url).includes('/api/v1/me/deactivate') && init?.method === 'POST')).toBe(true));
  });
});
