/* `POST /uploads/presign` — the three-step upload used for provider documents.

   Why it is not one POST: the object store wants the bytes, the API wants the
   metadata, and `apiRequest` is JSON-only. The sequence is

     1. `presignUpload()`  → a short-lived signed URL plus the headers it needs
     2. `PUT` the raw bytes to that URL with **those exact headers**
     3. confirm with the endpoint the caller is building for
                     (`POST /provider/documents`)

   Step 2 is a bare `fetch` to a third-party host, deliberately **not** through
   `apiRequest`: it has no bearer token, no refresh and no JSON envelope. Do not
   send credentials to it. */

import { apiWrite } from '@/lib/api/idempotency';
import type { Locale } from '@/lib/utils';

export type PresignPurpose = 'PROVIDER_DOCUMENT' | 'EVIDENCE';

export type PresignInput = {
  purpose: PresignPurpose;
  /** MIME type of the bytes that will be PUT. Must match what is uploaded. */
  contentType: string;
  /** Byte length of those same bytes. */
  sizeBytes: number;
  /** Stable per user intent — one uuid per chosen file, reused on retry. */
  clientUuid: string;
};

export type PresignedUpload = {
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
  objectKey: string;
  expiresAt: string;
};

export const presignUpload = (input: PresignInput, locale?: Locale): Promise<PresignedUpload> =>
  apiWrite<PresignedUpload>('/uploads/presign', { method: 'POST', body: input, idempotencyKey: `shm-presign-${input.clientUuid}` }, locale);

/**
 * Uploads the bytes to a presigned target.
 *
 * Deliberately bare `fetch`. No bearer token, no refresh, no JSON — and
 * `credentials: "omit"`, because the target is a third-party host and there is no
 * reason to offer it this origin's cookies.
 */
export const putToPresignedTarget = async (upload: PresignedUpload, file: Blob, signal?: AbortSignal): Promise<void> => {
  const response = await fetch(upload.url, {
    method: 'PUT',
    headers: upload.headers,
    body: file,
    credentials: 'omit',
    ...(signal === undefined ? {} : { signal })
  });
  if (!response.ok) {
    /* The store's error body is not the API's problem+json — report the status
       rather than guessing at a message. */
    throw new Error(`Upload failed (${response.status}). The link may have expired — try again.`);
  }
};
