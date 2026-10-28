/* `Idempotency-Key` support.

   `POST`, `PUT`, `PATCH` and `DELETE` on the API accept an `Idempotency-Key`
   header (8–200 chars). Replaying a key returns the **original stored response**
   with the original status and `Idempotency-Replayed: true`; reusing one with a
   different body is `422 IDEMPOTENCY_KEY_REUSED`, which is a client bug and not
   something to retry around; two concurrent uses are `409
   IDEMPOTENCY_IN_PROGRESS`.

   The rule that matters: **one key per user intent, not per retry.** A checkout
   attempt is one intent, so a double-tap, a flaky connection or a React re-render
   cannot create two bookings. Regenerating the key on every attempt is the same
   as sending none, which is why this module derives a key from something stable
   rather than calling `crypto.randomUUID()` inline. */

import { apiRequest, type ApiRequest } from '@/lib/api/client';
import type { Locale } from '@/lib/utils';

/** The API wants 8–200 characters; a bare uuid is comfortably inside that. */
const keyFor = (seed: string): string => `shm-${seed}`;

/**
 * A stable key derived from a seed the caller already holds — an id, a uuid, a
 * `${kind}:${entityId}` pair. The same seed always produces the same key, which
 * is the entire point.
 *
 * Prefer an explicit `clientUuid`/`clientId` the app generated for this intent.
 * Do not pass anything derived from a timestamp or a random number at the call
 * site: that defeats the mechanism.
 */
export const newIdempotencyKey = (seed: string): string => keyFor(seed);

/**
 * `apiRequest` with an idempotency key.
 *
 * Used only where a retry could cost money or create a second record: creating a
 * booking, requesting a payout, accepting an offer, starting a job. Reads and
 * ordinary edits do not need one.
 */
export const apiWrite = <T>(path: string, request: ApiRequest & { idempotencyKey: string }, locale?: Locale): Promise<T> =>
  apiRequest<T>(path, {
    ...request,
    headers: { ...(request.headers ?? {}), 'Idempotency-Key': request.idempotencyKey },
    ...(locale === undefined ? {} : { locale })
  });
