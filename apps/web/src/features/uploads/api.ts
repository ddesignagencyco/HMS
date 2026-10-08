/* `POST /uploads/presign` — the three-step upload used for provider documents.

   Why it is not one POST: the object store wants the bytes, the API wants the
   metadata, and `apiRequest` is JSON-only. The sequence is

     1. `presignUpload()`  → a short-lived signed URL, a storage key, and the
                             byte ceiling the store will enforce
     2. `PUT` the raw bytes to that URL
     3. confirm with `POST /provider/documents` carrying `storageKey`

   Step 2 is a bare `fetch` to a third-party host, deliberately **not** through
   `apiRequest`: no bearer token, no refresh, no JSON envelope, and no cookies.

   `documentPresignSchema` is `.strict()` and takes only `docType` and
   `contentType` — the size is not declared up front, so it is checked locally
   against the `maxBytes` the response hands back. */

import { apiWrite } from '@/lib/api/idempotency';
import type { DocumentContentType, PresignedUpload, ProviderDocumentKind } from '@/features/provider/api';
import type { Locale } from '@/lib/utils';

export type PresignInput = {
  docType: ProviderDocumentKind;
  contentType: DocumentContentType;
};

/**
 * One key per intent, not per attempt.
 *
 * A key derived from the document kind would collide when the same provider
 * legitimately uploads two CNIC fronts over time, so the caller supplies the
 * identity of the upload — a uuid minted when the file is chosen. Re-picking the
 * file mints a new one, which is correct: it is a new upload.
 */
export const presignUpload = (input: PresignInput, clientUuid: string, locale?: Locale): Promise<PresignedUpload> =>
  apiWrite<PresignedUpload>('/uploads/presign', { method: 'POST', body: input, idempotencyKey: `shm-doc-${clientUuid}` }, locale);

/**
 * Uploads the bytes to a presigned target.
 *
 * `credentials: "omit"` — the target is a third-party host and there is no reason
 * to offer it this origin's cookies. The response carries no headers to echo back;
 * a failure is reported by status, because the store's error body is not the
 * API's problem+json and guessing at a message would be worse than the status.
 */
export const putToPresignedTarget = async (upload: PresignedUpload, file: Blob, signal?: AbortSignal): Promise<void> => {
  const response = await fetch(upload.url, {
    method: 'PUT',
    body: file,
    credentials: 'omit',
    ...(signal === undefined ? {} : { signal })
  });
  if (!response.ok) {
    throw new Error(`The upload target refused the file (${response.status}). The link may have expired — try again.`);
  }
};
