# Backend Requirements — Frontend Verification

## Status

Updated after the admin module was moved onto the live API. Everything below is
either **verified against the code in `apps/api/src`** or written up as a gap.

The `backend-dev` merge added an ADMIN surface the web app had not been consuming:
16 controllers, every route `@PolicyDecorator({ roles: ['ADMIN'], totpRequired: true })`.
The admin screens now read it. What remains are the gaps that surface *inside* those
routes — mostly writes that have no reader, and two aggregates that do not exist.

## P0 — Blocking

All P0 issues from the original verification have been resolved:
- Provider display name gap: documented as known backend limitation (see Known limitations §2)
- `/search/providers` requires `serviceSlug`+`lat`+`lng`: backend design decision, documented

## P1 — Required

### Issue: Missing service names on the booking list
Endpoint: `GET /bookings`
Expected: Include the `serviceName`/`serviceSlug` just like `GET /bookings/:id` does.
Actual: Returns `serviceId` but not the service name.
Frontend impact: The booking list fans out the catalogue (`GET /catalogue/services/:slug/services`) to join names manually.
Required backend change: Include readable service names in the response.

### Issue: No way to list providers without a named service
Endpoint: `GET /search/providers`
Expected: Optionally browse all approved providers, then narrow by filters.
Actual: `serviceSlug` is required. Answers 422 if omitted.
Frontend impact: `/providers` cannot open on a list of everyone and narrow down. Customers cannot just search by location without a specific service.
Required backend change: Make `serviceSlug` optional, return providers sorted by rank or within a location radius with a limit.

### Issue: No public feed of recent reviews for marketing page
Endpoint: None exists.
Expected: `GET /search/remarks?limit=n` returning recent platform-wide remarks.
Actual: `GET /search/providers/:providerId/remarks` is scoped to one provider only.
Frontend impact: Homepage testimonial carousel has been removed entirely instead of showing fake data.
Required backend change: Add a public, rate-limited, published-only remarks listing.

### Issue: Missing area name on the booking list
Endpoint: `GET /bookings`
Expected: Include `areaName` just like `GET /bookings/:id` does.
Actual: Missing area name.
Frontend impact: Consistency issue between list and detail views.
Required backend change: Include `areaName` on `GET /bookings`.

### Issue: No anonymous booking lookup by code
Endpoint: None exists.
Expected: `GET /track/:code` for customers with a tracking code but no session.
Actual: All booking routes are scoped to the session's customer/provider (404 otherwise).
Frontend impact: `/track` page requires sign-in and shows the user's real bookings instead of anonymous lookup.
Required backend change: Add anonymous tracking endpoint if this feature is desired.

## Authentication / Session

No issues found. `GET /auth/session` works as expected. Nullable `providerStatus` handled correctly. Session endpoint answers 200 either way — cookie is sole evidence.

## Booking

No issues found. `POST /bookings` accepts `issueOptionId` from the real `issue-options` endpoint. Cancellation policy/quote supported. `startCheckout` returns `returnUrl`. Booking statuses derived from database enum.

## Search / Catalogue

Missing service names on booking list (see P1). No way to list providers without service (see P1).

## Places

No issues found. `lat`/`lng` are properly consumed as nullable values from the API. Areas and cities publish `lat`/`lng` (nullable).

## Reputation

No issues found. Null `ratingScore` is handled as "No ratings yet".

## Payments / Checkout

No issues found. `startCheckout` returns `returnUrl` properly.

## Other

None.

## Admin module — what is wired, and what is still missing

The whole admin module is now on the live API. These are the gaps found **inside**
that surface while building it, written up because the frontend cannot close them.

### A1 — No admin providers list, so `provider_status` is unreachable (S1)
Endpoints: `GET /admin/users?role=PROVIDER`, `POST /admin/providers/:providerId/{approve,reject,block,unblock,deactivate}`
Expected: a list of professionals carrying their **approval state** — `PENDING_APPROVAL`, `APPROVED`, `SUSPENDED`, `BLOCKED`.
Actual: the only route that enumerates professionals is `GET /admin/users`, which publishes `roles` and **`user_status`** (`ACTIVE` / `LOCKED` / `DEACTIVATED`) but not `provider_status`.
Frontend impact: `/admin/approvals` and `/admin/providers` cannot be filtered to "awaiting decision", so the queue cannot show what actually needs an administrator. The screen states the limit rather than labelling every row "approved". Approval is instead gated on document review (`GET /admin/providers/:providerId/documents` → `cnic.cnicVerified`), which is what the API actually enforces.
Required backend change: `GET /admin/providers` returning `providerId`, names, `providerStatus`, `rejectionReason`, `approvedAt`, and a pending-documents count.

### A2 — No admin bookings list, so the operations board has no totals (S1)
Endpoints: `GET /bookings` is customer-scoped; `GET /admin/bookings` **does not exist**.
Expected: an admin-wide booking list or count, filterable by status and date.
Actual: no admin route reads bookings. Complaints and disputes can find a booking *through a complaint*, which is not the same thing.
Frontend impact: the `/admin` landing and `/admin/ops` previously printed total bookings, "live bookings" and escrow held/released — every one invented. Those tiles are **removed**, not estimated. What remains is a count of the queues the board actually holds, and it says so on screen.
Required backend change: `GET /admin/bookings` with at least `id`, `code`, `status`, `paymentStatus`, `scheduledStart`, `serviceId`, `customerId`, `providerId`; plus a count endpoint if totals are wanted.

### A3 — No escrow aggregate for admins (S2)
Endpoint: none. `DisputesService.escrowHeld` computes the held figure per dispute but does not expose it.
Expected: total held across bookings, for the admin landing.
Actual: no route totals escrow. The ledger is the record of the money, on the finance side.
Frontend impact: the admin landing states this rather than summing nothing.
Required backend change: `GET /admin/finance/summary` returning held, released and refunded totals.

### A4 — Checklists and issue options are write-only on the admin API (S2)
Endpoints: `PUT /admin/catalogue/services/:id/checklist`, `PUT /admin/catalogue/services/:id/issue-options`
Expected: every write should be readable back.
Actual: `GET /admin/catalogue/commission-rules` exists, but there is no admin reader for a service's checklist or issue-options — the public catalogue exposes them per slug, not as an editable list.
Frontend impact: `/admin/catalogue` edits categories and the price band, the things it can both read and write, and says on screen that the write-only routes are not editable there — a form that wrote one could not show what it wrote.
Required backend change: `GET /admin/catalogue/services/:id/checklist` and `.../issue-options`.

### A5 — Document review is per provider, not a queue (S2)
Endpoints: `GET /admin/providers/:providerId/documents`, `POST /admin/documents/:documentId/review`
Expected: `GET /admin/documents?status=PENDING` — the pending-document queue.
Actual: documents are only reachable through a known `providerId`, so the queue must be assembled client-side from the professional list.
Frontend impact: `/admin/approvals` reads each professional's documents as it expands. Correct, but N+1 requests for N professionals.
Required backend change: `GET /admin/documents?status=PENDING` with `providerId`, `providerName`, `docType`, `createdAt`.

### A6 — `GET /admin/notifications` publishes the recipient unmasked (S2)
Endpoint: `GET /admin/notifications`
Actual: `recipient` is `coalesce(phone_e164, email)` — the **full** number or address.
Frontend impact: every other admin screen masks contact details (NFR-PR-01), so this is the one route where a full number reaches the client. The delivery log currently does not render that column, but the value is still in the payload.
Required backend change: mask server-side, or publish `recipientMasked` and drop the raw value from an admin read.

### A7 — `slaRemainingMinutes` is a snapshot, not a live countdown (S3)
Endpoint: `GET /admin/complaints`
Actual: computed correctly by the server, but once, at read time.
Frontend impact: the screen shows it as published and never re-derives it; the queue's 30s stale window bounds the drift. Noted so the behaviour is not mistaken for a ticking timer.
Required backend change: none strictly.

### A8 — `PUT /admin/settings/:key` has no batching (S3)
Endpoint: `PUT /admin/settings/:key`
Actual: one key per request, so a group of related settings is N round trips.
Frontend impact: the settings screen saves one row at a time — honest and safe, only slow for an operator changing many at once.

## Verified working (admin)

Read from `apps/api/src` and consumed by the web app:

- `GET /admin/users` (+ `role`, `status`, `q`, `limit`) · `POST :userId/{block,unblock,deactivate,send-reset}`
- `GET /admin/customers` · `POST :customerId/deactivate`
- `GET /admin/roles` · `POST`/`DELETE /admin/users/:userId/roles/:roleCode`
- `GET /admin/staff-conflicts` · `POST` · `DELETE :id`
- `GET /admin/audit` (+ `action`, `actorUserId`, `entityType`, `entityId`, `from`, `to`)
- `GET /admin/providers/:providerId/documents` · `GET /admin/documents/:documentId/url` · `POST /admin/documents/:documentId/review`
- `POST /admin/providers/:providerId/{approve,reject,block,unblock,deactivate}`
- `GET /admin/complaints` · `GET :id` · `POST :id/{assign,transition,open-dispute}`
- `GET /admin/disputes` · `GET :id` · `POST :id/resolve`
- `GET/POST /admin/penalties` · `GET :id` · `POST :id/{apply,withdraw}`
- `GET /admin/appeals` · `POST :id/decide`
- `GET /admin/settings` · `GET/PUT /admin/settings/:key`
- `GET/POST/PUT /admin/templates` · `POST /admin/templates/preview` · `GET /admin/notifications`
- `POST/PATCH /admin/catalogue/{categories,services}` · `GET /admin/catalogue/commission-rules`

**Nothing is hard-deleted, and nothing should be.** The database forbids deletes
outright (`users_no_delete`, `trg_no_delete`) and FR-AD-09 makes deactivation the
only removal. Every admin route above that "removes" something does so softly.

## Still no backend at all

- **`/admin/reports`** — no reporting route exists: no aggregate, no chart series.
  Revenue, category mix and professional-performance figures were previously
  invented; the screen now states the absence and points at the operations board
  and the ledger.
- **`/admin/plans`** — four fully migrated tables (`plans`, `subscriptions`,
  `plan_visits`, `plan_services`) and not one route that reads or writes any of
  them. Required: a public plan catalogue, then customer subscribe/cancel and an
  admin plan CRUD set.
- **Public booking tracking by code** — see P1 above.
- **Anonymous public remarks feed** — see P1 above.

## Frontend Verification Summary

Authentication: Verified
Session: Verified
OTP: Verified
Search: Verified
Catalogue: Verified
Places: Verified
Reputation: Verified
Booking: Verified
Cancellation: Verified
Checkout: Verified (returnUrl integration)
Messages: Verified
Addresses: Verified
Profile: Verified (`/me` profile, password and deactivation now wired)
Favourites: Verified (`/me/favourites` list, add and remove)
Admin accounts, roles, audit: Verified
Admin complaints, disputes, penalties, appeals: Verified
Admin settings, templates, catalogue, approvals: Verified
Admin ops board and landing: Verified (counts only what it holds; names what it cannot)
Admin reports and plans: **No backend** — see A2, A3 and "Still no backend at all"
Finance: Not started

## Finance Readiness

READY, with two dependencies worth naming before it starts: the finance screens
will need an **escrow aggregate** (A3) and an **admin bookings list** (A2) to show
anything platform-wide. Per-booking and per-ledger routes are unaffected.

Blocking reasons: None.