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
 * With `STORAGE_PROVIDER=supabase` the target is a Supabase Storage signed upload
 * URL (`…/storage/v1/object/upload/sign/<bucket>/<key>?token=…`), which takes the
 * raw bytes on a PUT. The `content-type` header is what Supabase records as the
 * object's type — without it the file is stored as `application/octet-stream`
 * and the signed link later serves a PDF or a video as an opaque download.
 * `x-upsert` matches the API's own `upsert: true`, so a retry after a dropped
 * connection overwrites the half-written object rather than failing with 409.
 *
 * With the mock adapter the target is `/api/v1/dev/storage/…`, which reads the
 * type from its query string and ignores both headers.
 *
 * `credentials: "omit"` — the target is a third-party host and there is no reason
 * to offer it this origin's cookies. A failure is reported by status, because the
 * store's error body is not the API's problem+json.
 */
export const putToPresignedTarget = async (upload: PresignedUpload, file: Blob, contentType: string, signal?: AbortSignal): Promise<void> => {
  const response = await fetch(upload.url, {
    method: 'PUT',
    body: file,
    headers: { 'content-type': contentType, 'x-upsert': 'true' },
    credentials: 'omit',
    ...(signal === undefined ? {} : { signal })
  });
  if (!response.ok) {
    throw new Error(`The upload target refused the file (${response.status}). The link may have expired — try again.`);
  }
};
