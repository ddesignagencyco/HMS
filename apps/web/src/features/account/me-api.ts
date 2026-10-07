/* `/me` — the account owner's own surface (me.controller.ts, me.service.ts).

   Seven routes, and they are the reason three customer screens can stop
   explaining an absence:

   · `GET /me`                  the same `AuthenticatedUser` `GET /auth/me` returns
   · `PATCH /me`                first name, last name, language
   · `PATCH /me/password`       current + new password, revoking every other session
   · `POST /me/deactivate`      anonymise the PII, keep the financial records
   · `GET /me/favourites`       the shortlist
   · `POST /me/favourites/:id`  add one (idempotent — the composite key makes it so)
   · `DELETE /me/favourites/:id` remove one; 400 when it was not shortlisted

   Four contract facts the UI has to respect:

   · **Only three fields are writable.** `profileUpdateSchema` is `.strict()` and
     accepts `firstName`, `lastName` and `locale`. The phone number and the email
     are login identifiers, so they change through the OTP flow and are *not*
     editable here — a field that silently ignored input would be worse than one
     that is not offered. The schema also refuses an empty patch
     (`.refine(input => Object.keys(input).length > 0)`), so this client sends
     only the keys that changed.

   · **`PATCH /me` returns the fresh user**, so the session cache can be written
     from the response instead of refetching. The header renders the name.

   · **`POST /me/favourites/:id` answers 404** for a provider who is not APPROVED,
     and a 404 here is deliberately indistinguishable from one that does not
     exist — the same shape `GET /search/providers/:id` has.

   · **A favourite carries no rating, area or distance.** `FavouriteItem` is
     `{ providerId, firstName, lastName, providerStatus, favouritedAt }` and
     nothing more, so a favourites card is built from exactly those five fields.
     The richer public profile is a link away, and pretending to know more here
     would mean inventing it. */

import { apiRequest, type ApiRequest } from '@/lib/api/client';
import type { AuthUser } from '@/features/auth/api';
import type { Locale } from '@/lib/utils';

export type MeOptions = { signal?: AbortSignal; locale?: Locale };

/** What `GET /me` and `PATCH /me` both answer. */
export type MeResult = { user: AuthUser };

/** `POST /me/favourites/:providerId` — idempotent, so it answers `true` twice. */
export type FavouriteAdded = { favourited: true };

/**
 * The shortlist row.
 *
 * `providerStatus` is the `providers.status` enum as text. It is not always
 * `APPROVED`: a professional can be suspended or blocked after being shortlisted,
 * and the list does not filter those out, so the screen has to show the status
 * rather than assume the row is still bookable.
 */
export type FavouriteItem = {
  providerId: string;
  firstName: string;
  lastName: string;
  providerStatus: string;
  /** When *you* shortlisted them, newest first. Not the provider's join date. */
  favouritedAt: string;
};

export type PasswordChangeInput = { currentPassword: string; newPassword: string };

export type PasswordChangeResult = { changed: true; otherSessionsRevoked: number };

/**
 * `profileUpdateSchema` accepts any subset, so the type is partial too — and
 * `Partial<Record<never, string>>` would swallow an empty patch, which the
 * server rejects, so at least one key is required.
 */
export type ProfileUpdateInput =
  { firstName: string; lastName?: string; locale?: Locale } | { lastName: string; firstName?: string; locale?: Locale } | { locale: Locale; firstName?: string; lastName?: string };

const call = <T>(path: string, request: ApiRequest = {}, options?: MeOptions) =>
  apiRequest<T>(path, {
    ...request,
    ...(options?.locale === undefined ? {} : { locale: options.locale }),
    ...(options?.signal === undefined ? {} : { signal: options.signal })
  });

/**
 * Only the keys that are actually present are sent.
 *
 * `.strict()` on the server means an `undefined` key that survives JSON encoding
 * is still a key, and a patch with no keys is a 422 — so an explicit
 * "set lastName to the empty string" (`lastName: ""`) has to survive this, and a
 * "field was left alone" must not. `undefined` is exactly that distinction.
 */
const compact = (input: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) if (value !== undefined) out[key] = value;
  return out;
};

const providerPath = (providerId: string, suffix = ''): string => `/me/favourites/${encodeURIComponent(providerId)}${suffix}`;

export const meApi = {
  /** The account-owner view of the same data `GET /auth/me` returns. */
  me: (options?: MeOptions) => call<MeResult>('/me', {}, options),

  /** Renames you and changes your language. Nothing else is writable here. */
  updateProfile: (input: ProfileUpdateInput, options?: MeOptions) => call<MeResult>('/me', { method: 'PATCH', body: compact({ ...input }) }, options),

  /**
   * Requires the current password and revokes every *other* session, so a
   * password changed after a compromise signs the other party out. This session
   * survives — `revokeOthersForUser` is keyed on the current `sessionId`.
   */
  changePassword: (input: PasswordChangeInput, options?: MeOptions) => call<PasswordChangeResult>('/me/password', { method: 'PATCH', body: { ...input } }, options),

  /**
   * Irreversible from here: the name, phone and email are overwritten, the
   * password is made unusable, TOTP is dropped and every session is revoked. The
   * `customers` row, the bookings and the ledger are financial records and stay.
   */
  deactivate: (options?: MeOptions) => call<{ status: 'DEACTIVATED' }>('/me/deactivate', { method: 'POST' }, options),

  /** Newest first. Only the five fields above — no rating, no area. */
  listFavourites: (options?: MeOptions) => call<{ items: FavouriteItem[] }>('/me/favourites', {}, options),

  /** 404 unless the provider is APPROVED. Idempotent when it succeeds. */
  addFavourite: (providerId: string, options?: MeOptions) => call<FavouriteAdded>(providerPath(providerId), { method: 'POST' }, options),

  /** 204. 400 rather than a silent no-op when it was not shortlisted. */
  removeFavourite: (providerId: string, options?: MeOptions) => call<undefined>(providerPath(providerId), { method: 'DELETE' }, options)
};

/** How a shortlisted professional reads: their name, or the id if they have none. */
export const favouriteName = (item: FavouriteItem): string =>
  [item.firstName, item.lastName]
    .filter((part) => typeof part === 'string' && part !== '')
    .join(' ')
    .trim();
