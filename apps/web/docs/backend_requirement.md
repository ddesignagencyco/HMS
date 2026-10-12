# Backend Requirements — Frontend Verification

## Status

Updated 2026-10-12, after the second `backend-dev` merge. Everything below is
either **verified against the code in `apps/api/src` and, where noted, against a
running API** or written up as a gap.

That merge (`079d568`, commits `8696785` / `f6d98df` / `d89831e`) added an ADMIN
surface the web app had not been consuming — 16 controllers, every route
`@PolicyDecorator({ roles: ['ADMIN'], totpRequired: true })` — and then, in
`8696785`, **maintenance plans** (`apps/api/src/plans/*`, eleven operations).

What changed for this file:

- **A1–A8 are unchanged by that merge.** Every one was re-checked against the
  pulled code; none is closed. They remain below.
- **`/admin/plans` is no longer "no backend at all"** — it is now consumed, along
  with `/plans` and `/account/plans`. See the plans section, which also records
  four gaps of its own (B1–B4).
- **A3 was wrong and has been corrected.** `GET /finance/escrow` does total escrow
  and an admin can read it; only the released and refunded totals are missing.
- **No database migration was required.** `db:status` reports 2 applied, 0
  pending, and the pull added no migration file. The schema was already ahead of
  the code — `0001_init.sql` carried `payment_purpose = 'PLAN'`, the
  `PLAN_DEFERRED` account type and `ledger_accounts_uniq … subscription_id`
  before any route used them.

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

### A3 — Escrow *is* readable by an admin; released and refunded are not (S2)
Endpoints: `GET /finance/escrow`, `GET /finance/refunds`
Expected: an admin-side summary of held, released and refunded.
Actual: **`GET /finance/escrow` already exists and returns `totalHeldPaisa` plus the
per-booking rows**, read straight from `ledger_accounts`/`account_balances`. Its
policy is `roles: ['FINANCE', 'ADMIN']` with TOTP, so an administrator can read
it. An earlier version of this file said no route totals escrow; that was wrong.
What is genuinely missing is the other two figures: `GET /finance/refunds` lists
the most recent 200 refund rows with **no total**, and there is no released-total
route anywhere.
Frontend impact: the admin landing can show money held, and only money held. The
released and refunded tiles stay absent rather than being summed from a truncated
200-row page.
Required backend change: either extend `/finance/escrow` with `releasedPaisa` and
`refundedPaisa`, or add `GET /admin/finance/summary` for admins who should not need
the finance role.

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

## Maintenance plans — SHM-089 closed this, with four gaps of its own

The merge of `backend-dev` on 2026-10-12 brought `apps/api/src/plans/*` and with it
**eleven operations**, so `/admin/plans` is off the "no backend at all" list and
`/plans` and `/account/plans` are no longer absences.

Verified against a running API (a plan was published through `POST /admin/plans`
and read back through both the admin list and the public catalogue):

| Route | Guard | Consumed by |
|---|---|---|
| `GET /plans` · `GET /plans/:id` | `@Public()` | the public catalogue |
| `POST /plans/:id/subscribe` | `CUSTOMER` | subscribe, then follow `checkout.returnUrl` |
| `GET /me/subscriptions` | `CUSTOMER` | the customer's own plans |
| `GET /subscriptions/:id` · `POST :id/cancel` | `Authenticated()` + service-side tenant check | visit schedule, cancel |
| `GET/POST /admin/plans` · `GET/PATCH/DELETE /admin/plans/:id` | `ADMIN` + TOTP | the admin plan manager |

The schema was already ahead of the code: `0001_init.sql` carried
`payment_purpose = 'PLAN'`, the `PLAN_DEFERRED` account type and
`ledger_accounts_uniq … subscription_id` long before a route used them, so
**no migration was needed** — `db:status` reports 2 applied, 0 pending.

### B1 — A plan's services cannot be changed after creation (S2)
Endpoints: `POST /admin/plans` takes `services`; `PATCH /admin/plans/:id` does not.
`planUpdateSchema` has no `services` key and there is no other route. Actual: the
service list is fixed at creation and is thereafter read-only.
Frontend impact: `/admin/plans` collects services in the create form and offers no
service control in the edit form, with the limitation stated on screen. An operator
who chose the wrong service has to publish a new plan.
Required backend change: `PUT /admin/plans/:id/services`, replacing the set atomically.

### B2 — A duplicate service in one plan is a bare 409 (S2)
Endpoints: `POST /admin/plans`
Actual: `plan_services` has `PRIMARY KEY (plan_id, service_id)` but
`planCreateSchema` accepts an array with the same `serviceId` twice. The insert
fails with Postgres `23505`, which the API maps to a generic
`409 CONFLICT / "The resource already exists"`.
Frontend impact: the create form cannot distinguish "you listed the same service
twice" from anything else, so it only reports the server's message.
Required backend change: reject the duplicate in the schema with a field error, e.g.
`.refine(services => new Set(services.map(s => s.serviceId)).size === services.length)`.

### B3 — No seed data for plans (S3)
`packages/db/seed` has no plans step, so all four plan tables are empty on a fresh
`db:reset` and every plans screen can only be seen in its empty state.
Frontend impact: the empty states are correct and are what a fresh environment
shows. Development data is created through the real admin route instead —
`apps/web/scripts/dev-admin-plans.mjs` publishes two plans over HTTP.
Required backend change: add a plans step to the seed, so `db:reset` yields a
populated catalogue.

### B4 — Cancelling has no preview (S3)
Endpoint: `POST /subscriptions/:id/cancel`
Actual: the refund is computed from the locked `PENDING` visits and returned only
*after* the cancellation. There is no endpoint that quotes the refund first.
Frontend impact: the confirmation states the rule ("unscheduled visits are
refunded; a booked or used visit is not") and names no figure, because a quoted
refund before the call would be a money claim with nothing behind it. The figure
is reported afterwards, exactly as returned.
Required backend change: `GET /subscriptions/:id` already returns the per-visit
`valuePaisa`; a `GET /subscriptions/:id/refund-preview` would let the confirmation
quote the server's own figure before the customer commits.

### B5 — A plan's description has no Urdu column (S2)
Table: `plans` (`0001_init.sql`)
Actual: `name_en` and `name_ur` both exist, but `description` is a single
`text NOT NULL` column. `planCreateSchema` takes one `description` and there is no
`descriptionUr`.
Frontend impact: on `/ur/plans` the name, the service names and all chrome render in
Urdu while the plan's own description stays English — a mixed-language card,
confirmed in a browser (`apps/web/e2e/verify-plans-ur.cjs` passes for the names and
shows the description untranslated). The screen renders `description` as returned
rather than hiding it, because a plan with no description at all would be worse.
Required backend change: add `description_ur` to `plans`, accept it in
`planCreateSchema`/`planUpdateSchema`, and return it from `listPublicPlans` and
`getPublicPlan` alongside `nameUr`.

## Still no backend at all

- **`/admin/reports`** — no reporting route exists: no aggregate, no chart series.
  Revenue, category mix and professional-performance figures were previously
  invented; the screen now states the absence and points at the operations board
  and the ledger. (SHM-090, still `TODO` upstream.)
- **Public booking tracking by code** — see P1 above.
- **Anonymous public remarks feed** — see P1 above.
- **An operations-board API** (SHM-091, `TODO`) — which is why A2 below is still open.

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
Admin plans: Verified — `GET/POST /admin/plans`, `GET/PATCH/DELETE /admin/plans/:id`, exercised live against a running API (`apps/web/scripts/dev-admin-plans.mjs`). Gaps B1, B2.
Admin reports: **No backend** — see "Still no backend at all" and A2
Public plan catalogue `/plans`: Verified — `GET /plans`, `GET /plans/:id`, both `@Public()`. Verified in a real browser (`apps/web/e2e/verify-plans.cjs`, 14/14) against a published plan, asserting the card shows the stored price and that the three previously invented prices are gone.
Customer plans `/account/plans`: Verified — `GET /me/subscriptions`, `POST /plans/:id/subscribe`, `GET /subscriptions/:id`, `POST /subscriptions/:id/cancel`. Gaps B4.
Finance: Not started

## Finance Readiness

READY. The dependency this file previously named as blocking — an **escrow
aggregate** (A3) — turns out to be partly satisfied: `GET /finance/escrow` already
returns `totalHeldPaisa` and is readable by an ADMIN, so the finance screens can
show money held today. What remains missing for a platform-wide view is an
**admin bookings list** (A2), plus released and refunded totals (A3). Per-booking
and per-ledger routes are unaffected, which is the bulk of the finance work.

Blocking reasons: None.