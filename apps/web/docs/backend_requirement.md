# Backend Requirements — from the Web Frontend

**Updated:** 2026-10-14
**From:** Frontend team (`apps/web`)
**For:** Backend team (`apps/api`)
**Audited against:** branch `feat/web-frontend-integrations` @ `730b092`, which includes backend commits `618c471` (FR-VC-16) and `bbdb868` (Supabase). The API surface is the 225 operations in `apps/api/test/api-surface.baseline.json`. Every claim below cites the API file it was checked in.

**How to read this:** §1 is the list. §2–§5 are the details, one block per item, each saying what happens today, why it matters to a user, and what we need. §6 lists what we previously asked for and you have since shipped, so you can see we've picked it up. Nothing in §6 needs action.

The web app uses nearly every endpoint that exists (the complaint detail/reply routes are the main ones without a screen yet — that is ours to build). Where something below is missing, the web already has a workaround (noted per item), so none of these block a release on their own **except the five P0s** (two broken features, one money bug, one privacy leak, one unpaid-subscription bug).

---

## 1. Summary

| # | Priority | Item | Endpoint / place | Kind |
|---|---|---|---|---|
| [2.1](#21-evidence-urls-404-under-supabase) | **P0** | Evidence photo URLs point at the dev mock and 404 under Supabase | 4 services | Bug |
| [2.2](#22-confirm-the-work-reopens-after-an-escalation) | **P0** | "Confirm the work" form accepts a second answer after `ESCALATED` (can release money) | `/bookings/:id/verification/confirmation` | Bug |
| [2.3](#23-no-way-to-retry-an-online-payment) | **P0** | No way to retry payment for a `PENDING_PAYMENT` booking | new `POST /bookings/:id/checkout` | Missing |
| [2.4](#24-search-reveals-a-customers-saved-location) | **P0** | Public search resolves any `addressId` — leaks a customer's home location | `GET /search/providers` | Privacy |
| [2.5](#25-plan-subscriptions-are-active-before-payment) | **P0** | Plan subscriptions are `ACTIVE` before anyone pays | `POST /plans/:id/subscribe` | Bug |
| [3.1](#31-supabase-bucket-configuration) | P1 | Supabase buckets: existence, privacy, size and MIME limits | Supabase project | Config |
| [3.2](#32-lists-are-silently-truncated) | P1 | Lists silently truncated at 100/200/500 rows, with no paging | 15+ list endpoints | Missing |
| [3.3](#33-provider-approval-queue) | P1 | No provider approval queue (`provider_status` not exposed) | new `GET /admin/providers` | Missing |
| [3.4](#34-platform-wide-bookings-for-admin) | P1 | No platform-wide bookings list for admin/ops | new `GET /admin/bookings` | Missing |
| [3.5](#35-provider-search-gaps) | P1 | Search: `serviceSlug` required; no sort, rating filter or paging | `GET /search/providers` | Missing |
| [3.6](#36-server-sentences-are-english-only) | P1 | `message` / `blockedReason` / question labels English only | `/verification/confirmation` | i18n |
| [3.7](#37-no-confirm-your-job-notification) | P1 | No customer notification when a job can be confirmed | notifications | Missing |
| [3.9](#39-rework-visits-cannot-show-a-start-code) | P1 | Rework visit: customer can never get a start code | `POST /bookings/:id/start-code` | Bug |
| [3.10](#310-customer-approves-a-revision-blind) | P1 | Customer approves a price revision without seeing amount or reason | `GET /bookings/:id` | Missing |
| [3.11](#311-ops-board-stream-logs-an-error-per-connection) | P1 | Ops-board SSE: `@Sse` + `@Res()` logs `INTERNAL_ERROR` per connection | `GET /admin/ops-board/stream` | Bug |
| [3.8](#38-inline-document-upload-is-capped-at-1-mb) | P1 | Inline document upload capped at 1 MB | `POST /provider/documents` | Limit |
| [4.1](#41-read-back-of-the-customers-confirmation) | P2 | Customer can't read back their submitted confirmation | `GET /verification/confirmation` | Missing |
| [4.2](#42-provider-cannot-view-their-own-uploaded-documents) | P2 | Provider can't view their own uploaded documents | `GET /provider/documents` | Missing |
| [4.3](#43-minimum-payout-is-not-readable-by-providers) | P2 | Minimum payout setting not readable by providers | provider settings | Missing |
| [4.4](#44-booking-list-carries-ids-not-names) | P2 | Booking list carries ids only (no service name) | `GET /bookings` | Missing |
| [4.5](#45-problem-photos-in-the-create-call) | P2 | Accept problem photos in the create call | `POST /bookings` | Nice to have |
| [4.7](#47-evidence-rows-lack-visitno) | P2 | Evidence rows lack `visitNo` (rework completion gate) | `GET /bookings/:id/evidence` | Missing |
| [4.8](#48-address-fields-cannot-be-cleared) | P2 | `line2` / `notes` can't be cleared on an address | `PATCH /customer/addresses/:id` | Bug |
| [4.9](#49-smaller-contract-gaps) | P2 | Smaller gaps: presign confirm unchecked, admin plan read, appeal note, decline reason | various | Mixed |
| [4.6](#46-audit-log-paging) | P2 | Audit log has `limit` but no cursor | `GET /admin/audit` | Missing |
| [5.1](#51-provider-name-in-public-search--decision-needed) | Decision | Provider name in public search | `GET /search/providers` | Product |
| [5.2](#52-avatars-and-catalogue-imagery) | Later | Avatars; category/service images | several | Missing |
| [5.3](#53-public-recent-reviews-feed) | Later | Public "recent reviews" feed | new `GET /search/remarks` | Missing |
| [5.4](#54-supabase-adapter-details) | Later | Supabase adapter details (`head()`, `expiresAt`) | `supabase-storage.service.ts` | Polish |

---

## 2. P0 — broken or unsafe today

### 2.1 Evidence URLs 404 under Supabase

**Where:** four read paths build the URL by hand to the mock adapter's route:

| File | Line | Field |
|---|---|---|
| `apps/api/src/booking/execution.service.ts` | 168 | `GET /bookings/:id/evidence` → `url` |
| `apps/api/src/complaints/complaints.service.ts` | 153 | complaint timeline → `evidenceUrl` |
| `apps/api/src/complaints/disputes.service.ts` | 134 | dispute case → `photos[].url` |
| `apps/api/src/verification/verification-console.service.ts` | 127 | agent console → `evidence[].url` |

**What happens:** each returns `/api/v1/dev/storage/evidence/<key>`. `DevController` (`integrations/dev.controller.ts:31`) reads that route from the injected **`MockObjectStorage`**, which is in memory. But since `bbdb868` with `STORAGE_PROVIDER=supabase`, every write (`execution.service.ts:100`, `complaints.service.ts:124`) goes to Supabase through `OBJECT_STORAGE`. So the bytes are in Supabase and every one of these URLs returns `404`.

**Impact:** no job, complaint, dispute or verification photo can be seen anywhere. That includes the verification agent, who needs the before/after photos to verify a job. The route is also `@Public()` and disabled outside dev, so it can't serve production either.

**Need:** sign the URL from the active port, exactly as `provider-documents.service.ts:138` and `recording.service.ts:45` already do:
```ts
const { url } = await this.storage.presignGet({ key: storageKey, bucket: 'evidence', ttlSeconds: 300 });
```
Please also include `contentType` on the console and dispute evidence rows. The booking evidence row already has it. Evidence can now be video or PDF, and the type is how the client picks the right element.

**Web status:** ready. `StoredMedia` (`components/evidence-image.tsx`) loads signed URLs directly, renders image, video or PDF by type, and shows a "file unavailable" tile on a 404 or an expired link. Photos will appear with no client change.

### 2.2 "Confirm the work" reopens after an escalation

**Where:** `apps/api/src/verification/verification-self.service.ts` → `availability()` and `submit()`.

**What happens:** on `NOT_ACCEPTABLE` (or "no work done" / "extra charge"), `submit()` re-queues the open `verification_calls` row. It sets `status = QUEUED` and `locked_by = NULL`, leaves `submitted_at` NULL, and keeps the booking in `AWAITING_VERIFICATION` with `released_at` NULL. `availability()` checks only the kill switch, `released_at`, booking status and `locked_by`, and none of those change on an escalation. So the next `GET` answers `canSubmit: true`, and a second `POST` passes every check.

**Impact:** a customer who answered "not acceptable" can come back and submit `SATISFIED`. That **releases the money and publishes a rating** on a case sitting at priority 0 in the agent queue. This contradicts `DIRECTION_FRONTEND_CONFIRM_THE_WORK.md` §4 ("the form is single-use per job"). The existing test *"will not let one job be confirmed twice"* covers only the release path.

**Need:**
1. In `availability()`, return `canSubmit: false` when the open call's `routing_reasons` contains `CUSTOMER_NOT_ACCEPTED` or `CUSTOMER_INTEGRITY_FLAG`, with a customer-readable `blockedReason`, e.g. *"You've already told us about a problem with this job. One of our team will call you."*
2. Apply the same check under the row lock in `submit()`, and return `409` with that sentence as `detail`.
3. Add a test: escalate, then `GET` returns `canSubmit: false`, then a second `POST` returns `409`.

**Web status:** stopgap in place. After `ESCALATED`, the browser remembers the answer in `localStorage` and shows the reassurance panel instead of a new form. That only covers one browser. Another device or a direct API call still gets the form.

### 2.3 No way to retry an online payment

**Where:** `booking.service.ts:190` starts checkout only inside `create()` (and `:621` on a revision approval).

**What happens:** an online booking is created as `PENDING_PAYMENT`, and the `redirectUrl` is returned **once**, in the create response. If the tab closes, the gateway fails, or the customer comes back later, nothing returns a checkout session for that booking. `GET /bookings/:id` carries no payment fields, and `POST /bookings/checkout` creates a *new* booking, which collides with the held slot (`409 SLOT_TAKEN`).

**Impact:** the customer is stuck watching their booking expire, and has to start again and possibly lose the slot.

**Need:** `POST /bookings/:id/checkout` (customer-owned, `PENDING_PAYMENT` only). It should return the active session if one is still valid, otherwise start a fresh one with `PaymentsService.startCheckout()`, and answer `{ paymentId, redirectUrl, returnUrl, expiresAt }`. Optionally also project `payment: { paymentId, expiresAt }` on `GET /bookings/:id` while pending.

**Web status:** `AwaitingPaymentCard` can show the "Pay now" button only in the session that created the booking.

### 2.4 Search reveals a customer's saved location

**Where:** `apps/api/src/search/search.service.ts` ~lines 318-325.

**What happens:** `GET /search/providers` is `@Public()`. When it is given `addressId`, it selects that address's coordinates `WHERE id = :addressId`, with **no check that the caller owns it**, and centres the search there. The response carries `distanceM` to every provider, so whoever holds an address id can triangulate the customer's home from a few searches. Address ids also appear in places customers and providers both see (booking rows carry `addressId`).

**Need:** resolve `addressId` only for an authenticated customer, scoped `AND customer_id = :caller`. Otherwise return `404`, exactly as other customer-owned rows do. **Web:** booking search sends `lat`/`lng`, not `addressId`, so nothing in the web depends on the unscoped behaviour.

### 2.5 Plan subscriptions are active before payment

**Where:** `apps/api/src/plans/plans.service.ts` ~line 312.

**What happens:** `subscribe` inserts the subscription as `'ACTIVE'` in the same step that starts checkout. `subscription_status` (`packages/contracts/src/enums.ts:135`) has no pending value, so a customer who abandons the gateway still holds an active plan with entitlements.

**Need:** a `PENDING_PAYMENT` status (or equivalent), activated by the capture webhook and expired like an abandoned booking. **Web:** the subscribe flow now sends the customer to the gateway's `redirectUrl` with an absolute `returnUrl`. It shows whatever status the API reports.

---

## 3. P1 — needed before real traffic

### 3.1 Supabase bucket configuration

`resolveBucket()` (`integrations/supabase-storage.service.ts`) maps `documents` → `SUPABASE_STORAGE_BUCKET` and passes `evidence`, `recordings` and `reports` through by name. Please confirm:
- **Those three buckets exist** in the Supabase project. Otherwise every evidence upload fails with `Bucket not found`.
- **All four are private.** Reads go through signed URLs only.
- **Each bucket has a file-size limit and an allowed-MIME list.** `presignPut` accepts `maxBytes` but Supabase's `createSignedUploadUrl` takes no size, so today the 5 MB / 50 MB ceilings and the type allow-list are enforced only by our client. Anyone holding a signed upload URL can store any size or type.

### 3.2 Lists are silently truncated

No list endpoint accepts a page or cursor. Many cut the result at a hard SQL `LIMIT`, so rows past it simply don't exist as far as the UI is concerned, and nothing says the list is incomplete:

| Endpoint | Cut-off | Where |
|---|---|---|
| `GET /complaints` (own) | 100 | `complaints.service.ts:182` |
| `GET /admin/complaints` | 200 | `complaints.service.ts:210` |
| `GET /admin/disputes` | 200 | `disputes.service.ts:62` |
| `GET /provider/disputes` | 100 | `disputes.service.ts:154` |
| `GET /provider/penalties` | 100 | `conduct.service.ts:377` |
| `GET /admin/penalties` | 200 | `conduct.service.ts:389` |
| `GET /admin/appeals` | 200 | `conduct.service.ts:401` |
| `GET /finance/escrow` | 500 | `payment/finance.service.ts:29` |
| `GET /finance/refunds` | 200 | `payment/finance.service.ts:38` |
| `GET /finance/payouts` | 200 | `payment/payouts.service.ts:154` |
| `GET /finance/payout-batches` | 100 | `payment/payouts.service.ts:229` |
| `GET /provider/ratings` | 200 | `reputation/reputation.service.ts:179` |
| `GET /admin/templates` | 500 | `notification/template.service.ts:42` |
| `GET /admin/users`, `/admin/customers`, `/admin/audit` | `limit` ≤ 200, no next page | `admin/admin.schemas.ts:8` |
| `GET /notifications` | `limit` ≤ 100, no next page | `notification.controller.ts` |
| `GET /bookings`, `GET /finance/debts` | unbounded — whole history in one response | `booking.service.ts:805`, `debt.service.ts` |

**Need:** one convention, applied everywhere:
- **Tables** (bookings, complaints, disputes, penalties, users, refunds, payouts, debts, escrow): `?page=1&limit=20` (max 100) → `{ items, pagination: { total, page, limit, hasMore } }`.
- **Append-only streams** (notifications, ledger, audit): `?limit=50&before=<cursor>` → `{ items, nextCursor }`.

For `/admin/complaints`, keep the current severity ordering; paging just has to respect it. Until then, at minimum please return `truncated: true` when the `LIMIT` is hit, so the UI can say so.

### 3.3 Provider approval queue

`GET /admin/users?role=PROVIDER` (`admin.schemas.ts:10`) filters by **user** status (`ACTIVE`/`LOCKED`/`DEACTIVATED`) but never returns or filters by `provider_status` (`PENDING_APPROVAL`/`APPROVED`/`SUSPENDED`/`BLOCKED`). The approve/reject/block mutations exist, but there is no way to *list who is waiting*.

**Need:** `GET /admin/providers?status=PENDING_APPROVAL`, returning provider id, name, masked phone, city, `providerStatus`, submitted-at, and pending-documents count, with paging (§3.2). Adding `providerStatus` to the `/admin/users` rows would also do as a first step.

**Web status:** `/admin/approvals` lists all providers (max 200) and shows a notice that approval status isn't published.

### 3.4 Platform-wide bookings for admin

`GET /bookings` is scoped to the signed-in customer or provider. `/admin/ops-board` gives counts, but there's no way to list or search the bookings behind them.

**Need:** `GET /admin/bookings?status=&from=&to=&cityId=&providerId=&customerId=&isEmergency=&q=` (code search), paged.

### 3.5 Provider search gaps

Already shipped, thank you: `addressId` in place of lat/lng, plus experience, completed-jobs, price, available-today and verified-documents filters (`search.schemas.ts`). Still missing:
- **`serviceSlug` is required.** `/providers` can't show "professionals near me" without a service. Make it optional, ranking across services by reputation.
- **No `sort`** (`distance` | `rating` | `price_asc` | `price_desc` | `experience`), **no `minRating`**, **no paging.** The web sorts and filters the returned array client-side today, which only works while results are small.

### 3.6 Server sentences are English-only

`message`, `blockedReason` and `questions[].label` on `/bookings/:id/verification/confirmation` are English whatever `Accept-Language` says, and `serviceName` reads `s.name_en`. The direction brief requires the client to render `message` and `blockedReason` **verbatim**, so an Urdu customer reads the one sentence about their money in English. **Need:** honour `Accept-Language: ur` for those strings and return the Urdu service name, as the catalogue already does.

### 3.7 No "confirm your job" notification

Already listed in the brief (§8). Nothing tells a customer their finished job is waiting for them. **Need:** a push/SMS when a booking enters `AWAITING_VERIFICATION` with `canSelfVerify` true, linking to `/account/bookings/:id#confirm-work`. **Web status:** callouts on the dashboard and bookings list point to the form.

### 3.8 Inline document upload is capped at 1 MB

`POST /provider/documents` gets the global `BODY_LIMIT = '1mb'` (`http-app.ts`). Only evidence and complaint routes get 8 MB. The inline `contentBase64` route therefore returns `413` for a normal 2–4 MB phone photo of a CNIC, and can never carry the 50 MB video documents `bbdb868` now allows. **Web status:** switched to the presigned route (`/uploads/presign` → PUT to Supabase → `storageKey`), so we're not blocked. **Need:** either raise the limit for this route, or document the inline route as small-files-only so other clients don't hit the same wall.

### 3.9 Rework visits cannot show a start code
`requestStartCode` (`booking.service.ts` ~404-412) refuses with `409` once `start_otp_verified_at` is set, and nothing clears that column on a warranty claim or a rework outcome. A rework visit therefore has a fresh code the provider needs (`booking.service.ts:254`, `verification-submit.service.ts:93`), but the customer can never display it. **Need:** reset `start_otp_verified_at` when the booking enters `REWORK_REQUIRED`. The web will then offer "show start code" for rework too.

### 3.10 Customer approves a revision blind
`quote_revisions` holds `delta_paisa` and `reason`, but neither `GET /bookings/:id` nor any other read returns the pending revision. The customer is asked to approve an extra charge without being shown the amount or the reason, and the web can only show generic text. **Need:** `pendingRevision: { id, deltaPaisa, reason, raisedAt } | null` on `GET /bookings/:id`.

### 3.11 Ops-board stream logs an error per connection
`admin/ops-board.controller.ts` combines `@Sse('stream')` with `@Res()` and returns nothing. Nest's SSE handler expects an Observable and throws. The stream survives only because `problem-details.filter.ts` skips responses whose headers are already sent, and it logs an `INTERNAL_ERROR` on every connection. **Need:** a plain `@Get('stream')` with the manual response, or return an Observable from `@Sse`.

---

## 4. P2 — gaps with a working fallback

### 4.1 Read-back of the customer's confirmation
After confirming, `GET /verification/confirmation` says only *"This job has already been confirmed."* **Need:** `submission: { outcome, quality, punctuality, conduct, cleanliness, remark, submittedAt } | null` for the customer's own booking. The thank-you panel shows the rating only in the session that submitted it.

### 4.2 Provider cannot view their own uploaded documents
`GET /provider/documents` returns status and review note, but no URL, so a provider can't check that their certificate scan is legible. **Need:** a short-lived signed view URL for the provider's own non-CNIC documents, e.g. `GET /provider/documents/:id/url`, mirroring the admin route at `provider-documents-admin.controller.ts:35`.

### 4.3 Minimum payout is not readable by providers
The minimum payout is an admin setting, and providers have no endpoint to read it, so the payout screen can't say "minimum Rs X" before a request is refused. **Need:** expose it on `GET /provider/wallet` or `GET /provider/payouts`.

### 4.4 Booking list carries ids, not names
`GET /bookings` rows (`BOOKING_COLUMNS`) have `serviceId` but no `serviceName`/`serviceNameUr`, unlike `GET /bookings/:id`. The web joins the whole catalogue to label each row. **Need:** both names on the list row.

### 4.5 Problem photos in the create call
`bookingCreateSchema` is `.strict()` with no `photos`. The web uploads up to 5 photos via `POST /bookings/:id/evidence` right after create, which works. An optional `photos[]` on create would make it atomic. Low priority.

### 4.6 Audit log paging
`GET /admin/audit` has good filters (`action`, `actorUserId`, `entityType`, `entityId`, `from`, `to`) but only `limit` ≤ 200. **Need:** a `before` cursor (see §3.2).

### 4.7 Evidence rows lack `visitNo`
The completion gate counts BEFORE/AFTER photos for the **current visit** only (`completion.service.ts:59`), but evidence rows don't say which visit they belong to. On a rework visit the client can't tell old photos from new ones, so "complete" can look ready and then `409`. **Need:** `visitNo` on each evidence row.

### 4.8 Address fields cannot be cleared
`PATCH /customer/addresses/:id` uses `COALESCE(new, old)` for `line2` and `notes` (`addresses.service.ts:46,50`), and the schema requires `min(1)`, so a customer can't remove a second address line or a note. The save reports success and the old value stays. **Need:** accept `null` to clear.

### 4.9 Smaller contract gaps
- **Presigned document confirm is unchecked:** `resolveStorage` only checks that the key exists (`head()`), not its size or type, before inserting `provider_documents`. Check `head().size` and `contentType` against `documentContentTypes` and `maxBytesFor`. Today the client's check is the only guard (see also §3.1).
- **`GET /admin/plans/:id` returns the public plan** (`plans-admin.controller.ts:60`): it 404s for an inactive plan and has no admin fields (`createdAt`, `activeSubscriptionsCount`).
- **A provider can't see their appeal's decision note.** It's visible only through admin routes. Add it to `GET /provider/penalties/:id`.
- **`POST /provider/offers/:id/decline` drops the reason:** there's no body schema. Accept an optional `reason` if the product wants decline reasons.
- **Provider dispute view carries the customer's name:** `getForProvider` (`disputes.service.ts`) returns `customerName` (and `providerName`) to the provider. The web doesn't render it, but please confirm it's intended, since the rest of the provider surface masks customer identity.
- **Time-off rejects local times:** `POST /provider/time-off` uses `.datetime()`, which refuses offsets, so `2026-12-25T00:00:00+05:00` is a `422`. The web now converts Karachi midnight to UTC itself. `z.string().datetime({ offset: true })` would let clients send the business's own clock.
- **Texted short links always land in English:** `/v/:token` and `/problem/:token` carry no locale. The web redirects them to `/en/…`. Building them as `/{locale}/v/:token` from the customer's `users.locale`, as `checkoutReturnUrl` already does, would open them in Urdu for Urdu customers.
- **`POST /provider/debt/pay` creates a new payment on every call** (random key suffix). The web sends an `Idempotency-Key` per click, so please confirm the idempotency interceptor covers this route.

---

## 5. Decisions and later

### 5.1 Provider name in public search — decision needed
Search results publish qualification only, never a name. `booking.row.ts` says this is deliberate ("the public search contract deliberately never publishes a provider's name"). We're raising it as a **product** question, not a bug: customers book a person, and favourites (`/me/favourites`) already shows names. If the answer stays "no names", we'll keep the qualification label. If it changes, we need `firstName` (and an initial) on `/search/providers` and `/search/providers/:id`.

### 5.2 Avatars and catalogue imagery
No `avatar_key` on users/providers and no image fields on categories/services. The web uses monograms and local art keyed by slug. **Later:** `POST /me/avatar` and `POST /provider/avatar` (to a private `avatars` bucket), `avatarUrl` on the relevant reads, and `imageUrl` on catalogue entries.

### 5.3 Public recent-reviews feed
Only per-provider remarks exist (`/search/providers/:id/remarks`). **Later:** `GET /search/remarks?limit=10` (published, verified, first name + initial only) for the home page.

### 5.4 Supabase adapter details
- `head()` uses `list(folder, { search })`, a prefix search capped at 100 rows. `info()` would be exact.
- `presignPut`'s `expiresAt` is set locally to +300 s, not taken from Supabase. The client treats it as authoritative.

---

## 6. Resolved since the last version — no action needed

Thank you. These were open in our previous list and are now live. The web uses each of them.

| Was | Now |
|---|---|
| Audit log reader | `GET /admin/audit` with filters |
| Roles & permissions | `GET /admin/roles`, `POST`/`DELETE /admin/users/:id/roles/:code`, staff conflicts |
| Maintenance plans | `/plans`, `/plans/:id/subscribe`, `/me/subscriptions`, `/subscriptions/:id/cancel`, `/admin/plans` |
| Reports engine | `/finance/reports` — `MONTHLY`, `REVENUE`, `PROVIDER_PERFORMANCE`, `VERIFICATION` as PDF/XLSX |
| Favourites | `/me/favourites` |
| Late-cancellation fee | Now applied on cancel (`booking-state.service.ts:154`), and quoted in `cancellation.feeDuePaisa` |
| Area coordinates | Areas return centroid lat/lng (`places.service.ts`) |
| Search by saved address and filters | `addressId`, experience, completed jobs, price, available today, verified documents |
| Checklist readable | `GET /catalogue/services/:slug` includes the ordered checklist |
| Notification delivery log for admins | `GET /admin/notifications` |
| Document upload backend | `POST /uploads/presign` + `POST /provider/documents` (now Supabase) |
| Customer confirms their own job | `GET`/`POST /bookings/:id/verification/confirmation`, `canSelfVerify` — built in the web, apart from 2.2 |
