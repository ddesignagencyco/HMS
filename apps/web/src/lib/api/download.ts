/* Fetching an authenticated file off the API and saving it to disk.
 *
 * **Why this exists instead of an `<a href="…/invoice.pdf">`.** The access token
 * lives in a module-scoped variable (`access-token.ts`) and is sent on every
 * request by `client.ts` as an `Authorization` header. A browser following a
 * link sends no such header, and the refresh cookie cannot help either: the API
 * sets it with `Path=/api/v1/auth`, so it is not replayed to `/api/v1/bookings/…/invoice.pdf`
 * or `/api/v1/finance/reports/…/download`. A link to a protected download is
 * therefore a guaranteed 401, and it fails *silently* — the browser navigates,
 * the API answers a problem document, and the person is left looking at JSON
 * with their download missing.
 *
 * So every protected file is fetched, authorised and saved in one step.
 *
 * **Refresh before trying.** `apiRequest` retries once through
 * `refreshSession` when it sees an expired-session code; this does the same,
 * because a download that fails on an expired token would lose the file rather
 * than replay the request the way an ordinary read does.
 */

import { API_BASE, refreshSession } from './client';
import { readAccessToken } from './access-token';
import type { Locale } from '@/lib/utils';

export type DownloadResult = { ok: true; filename: string } | { ok: false; error: string };

/** Dots to the last separator, ignoring any query string. */
const filenameFromDisposition = (header: string | null, fallback: string): string => {
  if (header === null) return fallback;
  /* RFC 5987 form first: `filename*=UTF-8''revenue-2026-10.pdf` survives
     non-ASCII names that the plain `filename="…"` form cannot carry. */
  const encoded = /filename\*\s*=\s*[^']*'[^']*'([^;]+)/i.exec(header);
  if (encoded?.[1] !== undefined) {
    try {
      return decodeURIComponent(encoded[1].trim());
    } catch {
      /* A malformed percent-escape is not worth failing a download over. */
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(header);
  return plain?.[1]?.trim() ?? fallback;
};

/**
 * The server sends `Content-Disposition: attachment`, but its `filename` is a
 * route id (`payout-batch-<uuid>.csv`) on one route and a readable name on
 * another. The caller's fallback is what to use when neither is present.
 */
const requestFile = async (path: string, locale: Locale | undefined, attempt: 0 | 1): Promise<Response> => {
  const headers: Record<string, string> = { accept: '*/*' };
  if (locale !== undefined) headers['accept-language'] = locale;
  const token = readAccessToken();
  if (token !== null) headers.authorization = `Bearer ${token}`;

  const response = await fetch(`${API_BASE}${path}`, { headers, credentials: 'include' });
  if (response.ok || attempt === 1) return response;

  /* One replay, and only for the codes that mean "your token is stale" rather
     than "you may not have this". A 404 stays a 404. */
  if (response.status === 401) {
    const recovered = await refreshSession(locale);
    if (recovered) return requestFile(path, locale, 1);
  }
  return response;
};

/**
 * Fetches a protected file and hands it to the browser as a download.
 *
 * `path` is relative to the API root and must start with `/` — e.g.
 * `/finance/reports/<id>/download`. It is the same path `client.ts` would use,
 * so one route reference serves both the metadata read and the file fetch.
 *
 * Resolves to the filename that was saved, or to the server's problem `detail`.
 * It does not throw: a download that failed is a message, not a crash, and the
 * caller is a button.
 */
export const downloadFile = async (path: string, locale?: Locale, fallbackName = 'download'): Promise<DownloadResult> => {
  let response: Response;
  try {
    response = await requestFile(path, locale, 0);
  } catch (error) {
    return { ok: false, error: error instanceof Error && error.name === 'AbortError' ? 'Download cancelled' : 'The server could not be reached' };
  }

  if (!response.ok) {
    let detail = `The download failed (${response.status})`;
    try {
      const body = (await response.json()) as { detail?: string; title?: string };
      if (typeof body.detail === 'string' && body.detail !== '') detail = body.detail;
      else if (typeof body.title === 'string' && body.title !== '') detail = body.title;
    } catch {
      /* A non-JSON error body is still an error; the status line is the answer. */
    }
    return { ok: false, error: detail };
  }

  const filename = filenameFromDisposition(response.headers.get('content-disposition'), fallbackName);

  /* `URL.createObjectURL` is revoked immediately after the click has been
     dispatched. Without the revoke the blob stays alive for the life of the
     document, which on a finance console that exports a batch every week is a
     slow leak of whole spreadsheets. */
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.rel = 'noopener';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }

  return { ok: true, filename };
};

/**
 * Whether this browser will be able to download at all.
 *
 * A blob download needs `URL.createObjectURL`, which every browser this app
 * supports has. The check exists so a screen can say so plainly rather than
 * offering a button that silently does nothing.
 */
export const canDownloadFiles = (): boolean => typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function';