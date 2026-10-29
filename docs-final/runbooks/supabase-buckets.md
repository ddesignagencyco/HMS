# Runbook: Supabase Storage buckets

**Used when:** setting up a new Supabase project (staging, production), or after any report of `Bucket not found`
on an upload, or when someone asks "can a signed upload URL be used to store a 2 GB file?".

Source: `apps/web/docs/backend_requirement.md` 3.1 (BE-006) and 5.4 (BE-034).

## What the API expects

`STORAGE_PROVIDER=supabase` makes the API use `SupabaseObjectStorage`
(`apps/api/src/integrations/supabase-storage.service.ts`). It maps the API's logical bucket names like this:

| Logical bucket | Supabase bucket | Written by | Content |
|---|---|---|---|
| `documents` | `SUPABASE_STORAGE_BUCKET` (default `verification-documents`) | provider (presigned PUT or inline) | CNIC scans, certificates, short videos |
| `evidence` | `evidence` | provider / customer (inline) | job photos and videos |
| `recordings` | `recordings` | the telephony provider | verification call audio |
| `reports` | `reports` | the API (report worker) | CSV, XLSX and PDF reports |

All four must exist or every upload to them fails with `Bucket not found`.

## Required policy

- **Private.** Nothing is ever served from a public URL; reads go through short-lived signed URLs only
  (`presignGet`, at most 900 s; admin document views use 300 s and are audited).
- **A file-size limit on every bucket.** Supabase's `createSignedUploadUrl` takes no size, so the bucket limit is
  the only server-side ceiling on a signed upload.
- **An allowed-MIME list on every bucket**, so a signed URL cannot be used to park an arbitrary file type.

| Bucket | Size limit | Allowed MIME types |
|---|---|---|
| documents | 50 MiB | `image/jpeg`, `image/png`, `image/webp`, `application/pdf`, `video/mp4`, `video/webm`, `video/quicktime` |
| evidence | 50 MiB | `image/jpeg`, `image/png`, `image/webp`, `image/gif`, `video/mp4`, `video/webm`, `video/quicktime` |
| recordings | 100 MiB | `audio/mpeg`, `audio/mp4`, `audio/wav`, `audio/x-wav`, `audio/ogg`, `audio/webm` (confirm against your telephony provider's output format) |
| reports | 25 MiB | `text/csv`, `application/pdf`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` |

The bucket limit is deliberately the **video** ceiling (50 MiB). Images and PDFs are held to 5 MiB by the API itself:
when a provider confirms a presigned document the API reads the stored object's real size and type
(`head()`) and refuses (422 `UPLOAD_REJECTED`, object removed) anything over 5 MiB for non-video or 50 MiB for video, or
outside the document MIME list. The bucket limit is the backstop for everything that route does not cover.

## Setting it up

The script is idempotent: it creates a missing bucket and updates an existing one to the policy above. It never deletes
a bucket or an object.

```bash
# needs SUPABASE_URL and SUPABASE_SECRET_KEY (the secret / service-role key) in .env or the shell
npm run storage:buckets -w @smart-home/api -- --dry-run   # show what would change
npm run storage:buckets -w @smart-home/api                # apply
```

Run it once per Supabase project. Re-run it whenever the policy in `apps/api/scripts/supabase-buckets.mjs` changes
(for example if a new document type or a larger video ceiling is allowed). Keep that file in step with
`documentContentTypes` / `MAX_VIDEO_BYTES` in `provider-documents.*` and the evidence MIME list in `booking.schemas.ts`.

If you prefer the dashboard: Storage -> New bucket, leave "Public bucket" off, set "Restrict file size" and
"Restrict MIME types" to the values above.

## Checking

```bash
npm run test:supabase -w @smart-home/api    # connectivity check against the configured default bucket
```

- In the dashboard every bucket shows a lock (private) and the limits above.
- A signed upload of a 60 MiB file, or of an `.exe`, to `documents` must be refused by Supabase itself.
- `POST /provider/documents` with a `storageKey` whose object is over 5 MiB (image/PDF) answers 422 `UPLOAD_REJECTED`.

## Notes on the adapter

- `head()` uses `storage.info()` (an exact lookup) and falls back to a prefix `list()` capped at 100 rows only if `info()` is unavailable or fails.
- `presignPut().expiresAt` is read from the signed URL's own token (`exp`); if it cannot be parsed it falls back to now + 300 s,
  which is shorter than anything Supabase issues, so it is never an overstatement.
- Inline uploads (`contentBase64`) on `POST /provider/documents` are limited to an 8 MB request body (about a 5 MiB file).
  Video documents must use `POST /uploads/presign`, then confirm by `storageKey`.

## When to escalate

Escalate to the platform owner if `npm run storage:buckets` fails with a permission error (the key is not the secret/service-role key),
if a bucket exists but cannot be made private, or if uploads still fail with `Bucket not found` after the script reports success
(you are probably pointed at a different Supabase project than the one the API uses: compare `SUPABASE_URL`).
