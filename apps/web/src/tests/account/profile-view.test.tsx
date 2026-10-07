import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfileDetails } from '@/features/account/profile-view';
import { SessionProvider } from '@/features/auth/session';
import { getDictionary } from '@/lib/dictionaries';

/* The customer's own profile.

   The screen this replaced rendered "Ayesha Khan / 0300 1234567 / Gulberg III"
   for whoever was signed in. These tests pin the two properties that mattered:

   · every field comes from `GET /auth/session`, so a different account renders
     differently instead of the same literals;
   · the phone and email are **masked** (NFR-PR-01). The full number belongs to
     the person reading it, but a screen that prints one in full is a screen that
     eventually leaks one — and every other screen in the product already masks.

   The screen also has to stay honest about what it cannot do: there is no
   authenticated password-change route and no deactivation endpoint, so neither
   is offered as a button that would do nothing. */

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

const meResponse = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

const renderProfile = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  /* The session provider has to be here: the screen reads the one `["auth","me"]`
     query rather than fetching again, and `useSession` throws outside it. */
  const Component = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <SessionProvider locale="en">{children}</SessionProvider>
    </QueryClientProvider>
  );
  return render(<ProfileDetails dict={dict} />, { wrapper: Component });
};

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : String(input);
      if (url.includes('/api/v1/auth/session')) return meResponse({ authenticated: true, user });
      throw new Error(`unrouted GET ${url}`);
    })
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the profile screen', () => {
  it("shows the signed-in person's own name", async () => {
    renderProfile();
    expect(await screen.findByText('Ayesha Khan')).toBeDefined();
  });

  it('masks the phone number rather than printing it', async () => {
    renderProfile();
    await screen.findByText('Ayesha Khan');
    expect(document.body.textContent).not.toContain('+923001234567');
    expect(document.body.textContent).not.toContain('03001234567');
    /* `maskPhone` keeps the country prefix and the last three digits, with the
       middle replaced — "+9230•••567" for this number. */
    expect(screen.getByText(/^\+9230.*567$/)).toBeDefined();
  });

  it('masks the email address', async () => {
    renderProfile();
    await screen.findByText('Ayesha Khan');
    expect(document.body.textContent).not.toContain('ayesha@example.com');
    /* "ay•••@example.com" — local part reduced to its first two characters. */
    expect(screen.getByText(/^ay.*@example\.com$/)).toBeDefined();
  });

  it('does not invent an area the API never returned', async () => {
    renderProfile();
    await screen.findByText('Ayesha Khan');
    /* The old screen printed "Gulberg III" for everyone. */
    expect(screen.queryByText('Gulberg III')).toBeNull();
  });

  it('says the provider status is unpublished instead of guessing it', async () => {
    renderProfile();
    await screen.findByText('Ayesha Khan');
    /* providerStatus is null for an account that is not a professional, and a null is
       shown as "not published" rather than being turned into an approval state. */
    expect(screen.getAllByText(dict.portal.notPublished).length).toBeGreaterThan(0);
  });

  it('explains that contact details cannot be edited here', async () => {
    renderProfile();
    expect(await screen.findByText(dict.portal.profileManagedBySignup)).toBeDefined();
  });

  it('states the deactivation policy without offering a button that cannot work', async () => {
    renderProfile();
    expect(await screen.findByText(dict.portal.deactivateUnavailable)).toBeDefined();
    /* No endpoint exists, so there must be no control claiming otherwise. */
    expect(screen.queryByRole('button', { name: dict.portal.deactivate })).toBeNull();
  });
});
