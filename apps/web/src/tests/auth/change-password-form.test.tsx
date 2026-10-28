import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChangePasswordCard } from '@/features/auth/change-password-form';
import { getDictionary } from '@/lib/dictionaries';
import type { Locale } from '@/lib/utils';

/* `PATCH /me/password`.
 *
 * This form did not exist when the security screen said no password-change endpoint
 * did. It does now, and three things about it are worth pinning:
 *
 * · **The current password is sent as typed, never held to the new-password
 *   rules.** Those rules describe the password being *set*; the current one is
 *   matched as entered, so a rule about uppercase and digits would reject a
 *   perfectly valid older password.
 * · **`confirmPassword` is never sent.** The API's schema has two fields; a third
 *   would be refused by `.strict()`.
 * · **No retry.** The call revokes every other session, so a replayed mutation is
 *   not a harmless duplicate. */

const dict = getDictionary('en');
const locale: Locale = 'en';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

const wrap = ({ children }: { children: ReactNode }) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0, gcTime: 0 } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

const renderCard = () => render(<ChangePasswordCard locale={locale} dict={dict} />, { wrapper: wrap });

/** The API's own `password` schema: min 10, upper, lower, digit. */
const STRONG = 'BrandNewPass9';

let fetchMock: ReturnType<typeof vi.fn>;
let sent: { url: string; body: Record<string, unknown> }[];

beforeEach(() => {
  sent = [];
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method === 'PATCH' && url.includes('/api/v1/me/password')) {
      sent.push({ url, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return json({ changed: true, otherSessionsRevoked: 2 });
    }
    throw new Error(`unrouted ${method} ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const fill = (current: string, next: string, confirm = next): void => {
  fireEvent.change(screen.getByLabelText(dict.auth.currentPassword), { target: { value: current } });
  fireEvent.change(screen.getByLabelText(dict.auth.passwordNew), { target: { value: next } });
  fireEvent.change(screen.getByLabelText(dict.auth.confirmPassword), { target: { value: confirm } });
};

describe('changing your password', () => {
  it('sends only the two fields the API accepts', async () => {
    renderCard();
    fill('OldPassw0rd!', STRONG);
    fireEvent.click(screen.getByRole('button', { name: dict.auth.changePasswordAction }));

    await waitFor(() => expect(sent).toHaveLength(1));
    /* `passwordChangeSchema` is `.strict()` — a third key is a 422, and
       `confirmPassword` is a client-side check only. */
    expect(sent[0].body).toEqual({ currentPassword: 'OldPassw0rd!', newPassword: STRONG });
  });

  it('accepts a current password that does not meet the new-password rules', async () => {
    renderCard();
    /* Lower-case, no digit, under the length floor — every new-password rule
       rejects it, and it is still the right answer for "what is your current
       password?". Holding this field to those rules would lock people out of
       changing it at all. */
    fill('old', STRONG);
    fireEvent.click(screen.getByRole('button', { name: dict.auth.changePasswordAction }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].body.currentPassword).toBe('old');
  });

  it('refuses a new password the API would refuse, without a round trip', async () => {
    renderCard();
    fill('OldPassw0rd!', 'short');
    fireEvent.click(screen.getByRole('button', { name: dict.auth.changePasswordAction }));

    expect(await screen.findByText('Use at least 10 characters')).toBeDefined();
    expect(sent).toHaveLength(0);
  });

  it('refuses a mismatch between the two new-password fields', async () => {
    renderCard();
    fill('OldPassw0rd!', STRONG, 'SomethingElse9');
    fireEvent.click(screen.getByRole('button', { name: dict.auth.changePasswordAction }));

    expect(await screen.findByText('The two passwords do not match')).toBeDefined();
    expect(sent).toHaveLength(0);
  });

  it('reports how many other sessions the API signed out', async () => {
    renderCard();
    fill('OldPassw0rd!', STRONG);
    fireEvent.click(screen.getByRole('button', { name: dict.auth.changePasswordAction }));

    /* The count is the server's `otherSessionsRevoked`, not an estimate — this
       browser stays signed in, so "how many others died" is the only thing the
       person needs to be told. It is stated in the form's live region, not only in
       a toast that is gone four seconds later. */
    const status = await screen.findByRole('status');
    expect(status.textContent).toContain(dict.auth.passwordChanged);
    expect(status.textContent).toContain(dict.auth.passwordChangedSessions.replace('{count}', '2'));
  });

  it('clears the fields after a change, so the new password is not left in the DOM', async () => {
    renderCard();
    fill('OldPassw0rd!', STRONG);
    fireEvent.click(screen.getByRole('button', { name: dict.auth.changePasswordAction }));

    await waitFor(() => expect((screen.getByLabelText(dict.auth.passwordNew) as HTMLInputElement).value).toBe(''));
    expect((screen.getByLabelText(dict.auth.currentPassword) as HTMLInputElement).value).toBe('');
  });

  it('keeps the current session when the current password is wrong', async () => {
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if ((init?.method ?? 'GET') === 'PATCH' && url.includes('/api/v1/me/password')) {
        return new Response(JSON.stringify({ type: 'about:blank', title: 'x', status: 400, code: 'INVALID_CREDENTIALS', detail: 'Your current password is not correct', errors: [] }), {
          status: 400,
          headers: { 'content-type': 'application/problem+json' }
        });
      }
      throw new Error(`unrouted ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderCard();
    fill('WrongPassw0rd!', STRONG);
    fireEvent.click(screen.getByRole('button', { name: dict.auth.changePasswordAction }));

    /* `me.service.ts` throws a bare `DomainError`, so there are no field errors to
       attach — the message has to be shown by the form itself, and it has to
       outlive the toast. */
    expect((await screen.findByRole('alert')).textContent).toContain('Your current password is not correct');
    expect(screen.queryByText(dict.auth.passwordChanged)).toBeNull();
  });
});
