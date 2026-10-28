import type { Locale } from '@/lib/utils';
import { readAccessToken, writeAccessToken } from './access-token';
import { ApiError, EXPIRED_SESSION_CODES, isProblem, NetworkError, type Problem } from './problem';

/** Same-origin prefix; next.config.ts rewrites it to the API process. */
export const API_BASE = '/api/v1';

export type SessionResult = {
  user: {
    id: string;
    phoneE164: string | null;
    email: string | null;
    firstName: string;
    lastName: string;
    locale: string;
    status: 'ACTIVE' | 'LOCKED' | 'DEACTIVATED';
    roles: string[];
    totpEnabled: boolean;
    providerStatus: string | null;
  };
  accessToken: string;
  expiresInSeconds: number;
  totpRequired: boolean;
};

export type ApiRequest = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
  locale?: Locale;
  /**
   * Extra headers for this call. Used for `Idempotency-Key`, which the API
   * accepts on every write — see `lib/api/idempotency.ts`. Merged last, so a
   * caller can override a default but cannot accidentally drop `accept` or the
   * bearer token by replacing the object.
   */
  headers?: Record<string, string>;
  /**
   * Whether to present the session at all. False on public reads: the catalogue,
   * the places list and provider search are `@Public()` on the API, so sending a
   * bearer token adds nothing and — worse — a 401 on one of them would start a
   * refresh for a request that was never authenticated in the first place.
   */
  auth?: boolean;
  /**
   * Whether a 401 here should be treated as an expired access token and retried
   * after a refresh. False on every authentication submission, where a 401 is
   * the answer to the question that was asked.
   */
  refreshOnExpiry?: boolean;
};

type SessionLostListener = () => void;
const sessionLostListeners = new Set<SessionLostListener>();

/** Notified when the session is gone for good, so caches can be dropped. */
export const onSessionLost = (listener: SessionLostListener): (() => void) => {
  sessionLostListeners.add(listener);
  return () => {
    sessionLostListeners.delete(listener);
  };
};

const announceSessionLost = (): void => {
  writeAccessToken(null);
  for (const listener of sessionLostListeners) listener();
};

const buildUrl = (path: string, query: ApiRequest['query']): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) search.set(key, String(value));
  }
  const suffix = search.toString();
  return `${API_BASE}${path}${suffix === '' ? '' : `?${suffix}`}`;
};

type RawResult = { status: number; body: unknown };

/** One round trip. No refresh, no retry: the layers above own those decisions. */
const rawFetch = async (path: string, request: ApiRequest): Promise<RawResult> => {
  const headers: Record<string, string> = { accept: 'application/json, application/problem+json' };
  if (request.body !== undefined) headers['content-type'] = 'application/json';
  if (request.locale !== undefined) headers['accept-language'] = request.locale;
  const authorization = readAccessToken();
  if (request.auth !== false && authorization !== null) headers.authorization = `Bearer ${authorization}`;
  /* Caller's headers last, so `Idempotency-Key` can be added without having to
     restate — or accidentally drop — the ones above. */
  for (const [name, value] of Object.entries(request.headers ?? {})) headers[name] = value;

  let response: Response;
  try {
    response = await fetch(buildUrl(path, request.query), {
      method: request.method ?? 'GET',
      headers,
      /* The refresh cookie is httpOnly and scoped to /api/v1/auth; it has to
         ride along on every request or a reload cannot restore the session. */
      credentials: 'include',
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
      ...(request.signal === undefined ? {} : { signal: request.signal })
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new NetworkError('The server could not be reached', error);
  }

  if (response.status === 204) return { status: 204, body: undefined };
  const text = await response.text();
  let body: unknown;
  if (text === '') body = undefined;
  else {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: response.status, body };
};

const problemFrom = (status: number, body: unknown): Problem => {
  if (isProblem(body)) return body;
  return {
    type: 'about:blank',
    title: 'Request failed',
    status,
    code: 'INTERNAL_ERROR',
    detail: 'The request could not be completed.',
    errors: []
  };
};

/* ---- Refresh coordination ------------------------------------------------
   The API rotates the refresh token on every use and treats a second use of the
   same token as a replay, signing out every session descended from it
   (auth.service.ts → session.service.ts). Two in-flight refreshes would send
   the same cookie twice and sign the user out, so exactly one refresh may run
   at a time, and a request that 401s just after one finished reuses its result
   rather than starting another. */

let inFlightRefresh: Promise<boolean> | null = null;
let lastRefreshFinishedAt = 0;
/**
 * Set when a refresh has been refused in this document, cleared when one
 * succeeds. A signed-out visitor asks `/auth/me` on every page, it answers 401
 * `UNAUTHENTICATED`, and that is a normal answer rather than a failure — but the
 * refresh it would otherwise trigger fails the same way, so it would double
 * every signed-out page load with a second round trip. There is nothing to
 * recover after a refused refresh inside one document: the only thing that can
 * mint a new session is the sign-in forms.
 */
let refreshUnavailable = false;

/** Long enough to cover a refresh response landing and its cookie being stored. */
const REFRESH_GRACE_MS = 1_000;

/**
 * Whether the session the last refresh returned still owes a two-factor check.
 *
 * `POST /auth/refresh` publishes `totpRequired` on every response, and it is the
 * only call in the app that reports it outside sign-in — `GET /auth/session`
 * answers `{ authenticated, user }` and nothing more. Discarding the flag here is
 * what let a staff member reload mid-enrolment and land on a working dashboard:
 * the token was valid, the user was known, and nothing in the client knew the
 * session had not been verified.
 *
 * `true` means verified-and-not-required, which is the answer for every customer
 * and for staff who have finished. It is reset on a refused refresh, because a
 * session that no longer exists owes nothing.
 */
let sessionTotpVerified = true;

export const sessionNeedsTotp = (): boolean => !sessionTotpVerified;

/**
 * Forgets the two-factor standing of a session that has ended.
 *
 * Signing out is the one path that learns nothing from a response body — the API
 * answers 204 — so this is where the flag is cleared. Left set, a signed-out
 * document would still believe it owed a two-factor check and would send the next
 * visitor to `/auth/totp`.
 */
export const forgetSessionTotpState = (): void => {
  sessionTotpVerified = true;
};

const performRefresh = async (locale: Locale | undefined): Promise<boolean> => {
  /* Whether there was anything to lose. Somebody arriving on the sign-in page
     has no token and no cookie, so a refused refresh is the absence of a
     session rather than the end of one, and must not be announced as an expiry. */
  const hadToken = readAccessToken() !== null;
  try {
    const { status, body } = await rawFetch('/auth/refresh', { method: 'POST', locale, refreshOnExpiry: false });
    if (status >= 200 && status < 300 && typeof body === 'object' && body !== null && 'accessToken' in body) {
      const result = body as SessionResult;
      writeAccessToken(result.accessToken, result.expiresInSeconds);
      sessionTotpVerified = result.totpRequired !== true;
      refreshUnavailable = false;
      return true;
    }
    writeAccessToken(null);
    refreshUnavailable = true;
    sessionTotpVerified = true;
    if (hadToken) announceSessionLost();
    return false;
  } catch (error) {
    /* A cancelled or offline refresh leaves the session exactly as it was. */
    if (!(error instanceof Error && error.name === 'AbortError')) {
      writeAccessToken(null);
      refreshUnavailable = true;
      if (hadToken) announceSessionLost();
    }
    return false;
  } finally {
    lastRefreshFinishedAt = Date.now();
  }
};

/** True when the caller's 401 can be answered by a refresh. */
export const refreshSession = (locale?: Locale): Promise<boolean> => {
  if (inFlightRefresh !== null) return inFlightRefresh;
  if (refreshUnavailable && readAccessToken() === null) return Promise.resolve(false);
  if (readAccessToken() !== null && Date.now() - lastRefreshFinishedAt < REFRESH_GRACE_MS) {
    return Promise.resolve(true);
  }
  inFlightRefresh = performRefresh(locale).finally(() => {
    inFlightRefresh = null;
  });
  return inFlightRefresh;
};

const isExpiredSession = (error: unknown): boolean => error instanceof ApiError && EXPIRED_SESSION_CODES.includes(error.code);

const asError = (status: number, body: unknown): ApiError => new ApiError(problemFrom(status, body));

/**
 * Calls the API and hands back the parsed body.
 *
 * On an expired access token it refreshes once and replays the request exactly
 * once. A refresh that fails ends the session and clears every cached query
 * rather than looping.
 */
export const apiRequest = async <T>(path: string, request: ApiRequest = {}): Promise<T> => {
  const { status, body } = await rawFetch(path, request);
  if (status >= 200 && status < 300) return body as T;

  const error = asError(status, body);
  if (request.auth === false || request.refreshOnExpiry === false || !isExpiredSession(error)) throw error;

  /* Both cases collapse to the same call: after a reload there is no token at
     all and the cookie is the only way back, and a token that is still nominally
     fresh was more likely rejected because the session rotated than because it
     timed out. refreshSession collapses concurrent callers onto one refresh and
     reuses a very recent one. */
  const recovered = await refreshSession(request.locale);
  if (!recovered) throw error;

  const replay = await rawFetch(path, request);
  if (replay.status >= 200 && replay.status < 300) return replay.body as T;
  throw asError(replay.status, replay.body);
};

/** Test seam: clears the refresh bookkeeping between cases. */
export const resetRefreshState = (): void => {
  inFlightRefresh = null;
  lastRefreshFinishedAt = 0;
  refreshUnavailable = false;
};
