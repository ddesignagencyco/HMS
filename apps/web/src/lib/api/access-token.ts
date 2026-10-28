/* The access token lives in this module and nowhere else.

   The API pairs it with an httpOnly refresh cookie that script cannot read
   (auth.controller.ts), so there is exactly one place that can hold the bearer
   token and it is deliberately not a store, not React state and not
   localStorage: a reload throws it away and the session is rebuilt from the
   cookie through /auth/refresh. */

let token: string | null = null;
let expiresAtMs = 0;

/** Refresh a little before the server would reject the token, so a request that
    starts just before expiry does not have to fail first. */
const EXPIRY_SKEW_MS = 30_000;

type Listener = (token: string | null) => void;
const listeners = new Set<Listener>();

const notify = (): void => {
  for (const listener of listeners) listener(token);
};

export const readAccessToken = (): string | null => token;

export const writeAccessToken = (value: string | null, expiresInSeconds?: number): void => {
  const changed = token !== value;
  token = value;
  expiresAtMs = value !== null && typeof expiresInSeconds === "number" ? Date.now() + expiresInSeconds * 1000 : 0;
  if (changed) notify();
};

/** True when the token can still be sent without the API having to reject it. */
export const isAccessTokenFresh = (): boolean => token !== null && Date.now() < expiresAtMs - EXPIRY_SKEW_MS;

/** How long until the token expires, in milliseconds. 0 when there is none. */
export const accessTokenTtlMs = (): number => (token === null ? 0 : Math.max(0, expiresAtMs - Date.now()));

export const onAccessTokenChange = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Test seam: resets the module without reloading the page. */
export const resetAccessToken = (): void => {
  token = null;
  expiresAtMs = 0;
  notify();
};