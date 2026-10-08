# Backend Requirements — Frontend Verification

## Status

Updated after the admin module was moved onto the live API. Everything below is
either **verified against the code in `apps/api/src`** or written up as a gap.

The `backend-dev` merge added an ADMIN surface the web app had not been consuming:
16 controllers, every route `@PolicyDecorator({ roles: ['ADMIN'], totpRequired: true })`.
The admin screens now read it. What remains are the gaps that surface *inside* those
routes — mostly writes that have no reader, and two aggregates that do not exist.

### Re-verified 2026-10-08

Every entry below was re-checked against a running API and against
`apps/api/src`, not against this document. Three entries turned out to be **stale
and have been corrected** — the backend had already shipped them, so as written they
would have sent the team to re-implement work that exists:

| Entry | Status now |
|---|---|
| P1 "Missing service names on the booking list" | **Already shipped** — see P1 §Resolved |
| P1 "Missing area name on the booking list" | **Already shipped** — see P1 §Resolved |
| A3 "No escrow aggregate for admins" | **Already exists** — `GET /finance/escrow`, now consumed |
| B1 "No reader for the job checklist" | **Already exists** — `GET /bookings/:id/checklist`, now consumed |
| B2 "No provider-reachable address" | **Already exists** — `GET /bookings/:id/service-address`, now consumed |
| "Unverified staff session reaches the portal" | **Not a backend gap** — see Staff two-factor §Verified below |

## Staff two-factor — verified, no backend change required

**Symptom:** a staff member who had not finished setting up two-factor
authentication was shown the admin dashboard, and reloading mid-enrolment kept
them there. Pressing "Back to sign in" and signing in again also landed on the
dashboard rather than on the two-factor step.

**This was a frontend bug, not a backend one.** The API was already correct:

- `apps/api/src/common/policy.ts:38` — `if (required.totpRequired === true &&
  !principal.totpVerified) throw new DomainError('TOTP_REQUIRED', ...)` runs before
  any staff route body, and every admin/finance route is decorated with
  `totpRequired: true`.
- `apps/api/src/identity/auth.service.ts:177` — a staff account with no enrolment
  still gets a session, but minted with `totpVerified: false`.

Confirmed live: with an unenrolled admin session, `GET /admin/users`,
`/admin/complaints`, `/admin/disputes` and `/admin/penalties` all answered **401**.
No staff data left the API. What was broken was that the web app rendered the
portal shell anyway, on top of a screenful of 401s, so it read as a working
dashboard with empty panels.

Three frontend defects, all now fixed:

1. **`lib/api/client.ts` discarded `totpRequired`.** `POST /auth/refresh` publishes
   it on every response, and `refreshSession` read the body, wrote the token, and
   dropped the flag.
2. **`GET /auth/session` cannot restore it.** That route answers
   `{ authenticated, user }` and nothing more — see `auth.controller.ts` — so the
   only call that reports two-factor standing outside sign-in is the refresh. The
   client's `me` query returned `{ user }` and nothing else, so a reload came back
   as a plain authenticated session. The flag is now read off the refresh and
   carried on the query, and `totpPending` is derived from it rather than being
   state that only sign-in could set.
3. **`RequireSession` never checked it.** The gate asked whether there was a
   session and whether the roles matched the path. It now also asks whether the
   session still owes a two-factor check, and holds such a session on
   `/auth/totp`. "Back to sign in" no longer reaches the dashboard either.

**No backend change is needed for any of this.** One optional improvement would
make the web app's job easier rather than fix a hole: `GET /auth/session` could
publish `totpRequired` alongside `authenticated` and `user`, so the client would
not have to infer it from the refresh it makes anyway. It already has the value.


The three entries marked *now consumed* were, a week ago, screens that carried a
sentence telling the reader the API could not do the thing. Each of those sentences
has now been deleted in both locales, because the route was there. **The recurring
lesson for the next audit: read the source before writing down a limitation.** Three
of these were written as backend gaps and were not.

## P0 — Blocking

All P0 issues from the original verification have been resolved:
- Provider display name gap: documented as known backend limitation (see Known limitations §2)
- `/search/providers` requires `serviceSlug`+`lat`+`lng`: backend design decision, documented

## P1 — Required

### P1 §Resolved — booking list now carries its readable names

**These two entries are closed. `GET /bookings` already returns both.**

Verified live on 2026-10-08 with a provider token against the seeded database:

```json
{ "code": "SHM-0000002", "status": "SCHEDULED",
  "serviceId": 1, "serviceName": "Leak Repair",
  "areaName": "Gulberg", ... }
```

So the "fans out the catalogue to join names" cost described below no longer
applies to the list read. Anything still joining names client-side is doing so
against a stale assumption, not against a missing field.

### Issue: No way to list providers without a named service
Endpoint: `GET /search/providers`
Expected: Optionally browse all approved providers, then narrow by filters.
Actual: `serviceSlug` is required. Answers 422 if omitted.
Frontend impact: `/providers` cannot open on a list of everyone and narrow down. Customers cannot just search by location without a specific service.
Required backend change: Make `serviceSlug` optional, return providers sorted by rank or within a location radius with a limit.

Verified live 2026-10-08 — all three of `lat`+`lng`, `serviceSlug` alone, and
`serviceSlug`+`lat`+`lng` were tried:

| Request | Result |
|---|---|
| `?lat=31.5204&lng=74.3587` | **422** `VALIDATION_FAILED` |
| `?serviceSlug=leak-repair` | **422** `VALIDATION_FAILED` |
| `?serviceSlug=leak-repair&lat=31.5204&lng=74.3587` | **200** |

So all three parameters are mandatory, not just `serviceSlug`.

### Issue: No public feed of recent reviews for marketing page
Endpoint: None exists.
Expected: `GET /search/remarks?limit=n` returning recent platform-wide remarks.
Actual: `GET /search/providers/:providerId/remarks` is scoped to one provider only.
Frontend impact: Homepage testimonial carousel has been removed entirely instead of showing fake data.
Required backend change: Add a public, rate-limited, published-only remarks listing.

### Issue: No anonymous booking lookup by code
Endpoint: None exists.
Expected: `GET /track/:code` for customers with a tracking code but no session.
Actual: All booking routes are scoped to the session's customer/provider (404 otherwise).
Frontend impact: `/track` page requires sign-in and shows the user's real bookings instead of anonymous lookup.
Required backend change: Add anonymous tracking endpoint if this feature is desired.

### Issue: No provider display name on the public search or profile
Endpoint: `GET /search/providers`, `GET /search/providers/:providerId`
Expected: a display name, and ideally an avatar URL.
Actual: both rows carry `providerId`, `bio`, `experienceYears`, `qualification`,
`pricePaisa`, `distanceM`, `ratingScore`, `ratingCount`, `badge` — and **no name
and no photo**. Live response for the seeded provider:

```json
{ "providerId": "00000000-0000-4000-8000-000000000098",
  "bio": "Seeded test provider for API development.",
  "experienceYears": 5, "qualification": "Licensed plumber",
  "pricePaisa": 100000, "distanceM": 0, "badge": null,
  "ratingCount": 1, "ratingScore": 3.93 }
```

Frontend impact: every provider surface leads with `qualification` and a generated
monogram. On the booking's professional-selection step the customer chooses between
"Licensed plumber" and nothing else.

Why not worked around: the name is not in the payload at any nesting level, so no
frontend change can surface it.

Required backend change: publish a display name on both routes. `users.first_name`
/ `last_name` already exist — `GET /me/favourites` already returns `firstName` and
`lastName` for the same people, so this is a projection, not a schema change. An
avatar is a separate decision and is not assumed here.

## Authentication / Session

No issues found. `GET /auth/session` works as expected. Nullable `providerStatus` handled correctly. Session endpoint answers 200 either way — cookie is sole evidence.

## Booking

No issues found. `POST /bookings` accepts `issueOptionId` from the real `issue-options` endpoint. Cancellation policy/quote supported. `startCheckout` returns `returnUrl`. Booking statuses derived from database enum.

Two routes that were previously written up as missing now answer correctly and are
recorded in B1/B2: `GET /bookings/:id/checklist` and
`GET /bookings/:id/service-address`.

## Search / Catalogue

No way to list providers without a service (see P1) — confirmed live, all three of
`serviceSlug`/`lat`/`lng` are mandatory. No provider display name on the public
search or profile (see P1).

The missing service and area names on the booking list are **closed**; see
P1 §Resolved.

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

### A3 — Escrow aggregate: this one is a FRONTEND gap, not a backend gap (corrected)

**The previous version of this entry said "no route totals escrow". That is wrong.**
`GET /finance/escrow` exists and is available to an admin:

- `finance.controller.ts` — `@PolicyDecorator(FINANCE)` where
  `FINANCE = { roles: ['FINANCE', 'ADMIN'], totpRequired: true }`
- summary: *"See the money held in escrow — Customer money currently held per
  booking, with the booking's state and **the total held**. Read straight from the
  ledger."*

So an admin has a route that returns the held total. Re-verified from source
2026-10-08, and the live call was made: it answers for an ADMIN session.

The field is `totalHeldPaisa` (paisa, not rupees), alongside `items` — the per-booking
detail with `heldPaisa > 0`, newest first, **capped at 500 rows** by the raw query.
That cap is the reason the client never re-sums `items`: on a busy platform the sum
would be silently short, and the server's own total is the authority.

Frontend impact: **consumed.** `/admin` now reads this through `useEscrow` and shows
the balance in a card, using `formatMoney` on the paisa the API sends. The
`overviewNoEscrow` sentence — *"There is no admin escrow balance either — no route
totals what is held across bookings"* — has been deleted in both locales, because it
was false. The bookings-total sentence above it stays: there really is no admin
bookings list (A1/A2).

A failed read is shown as *"We could not read the escrow balance. This is not a
zero."* rather than as `Rs 0`, since every `/finance/*` route is `totpRequired` and
a 403 is an ordinary outcome for an admin session without a fresh TOTP.

Required change: **none from the backend.**

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

## Backend endpoints that now exist and are verified working

These were previously written up as impossible for the frontend. They ship, they
answer correctly, and they were exercised live on 2026-10-08. **Nothing is asked
of the backend here** — recorded so this document stops contradicting the API, and
so the frontend work below is visible to whoever picks it up.

### B1 — `GET /bookings/:id/checklist` (new)

Answers `200` for the booking's own customer or assigned provider:

```json
{ "items": [ { "itemId": 1, "position": 1, "labelEn": "Isolate the water supply",
               "labelUr": "…", "requiresPhoto": false,
               "done": false, "evidenceId": null, "doneAt": null }, … ],
  "outstanding": 4 }
```

Frontend state: **consumed.** `features/provider/job-view.tsx` fetches this through
`useChecklist` and renders a `ChecklistCard` that lists the steps in `position`
order, shows the server's own `outstanding` count, and ticks a step through
`POST /bookings/:id/checklist/:itemId`. A step with `requiresPhoto` uploads
evidence first and posts that `evidenceId`; a step that already has an `evidenceId`
is ticked without asking for a second photo. The `checklistUnavailable` panel and
the comment above it are gone.

No backend change required.

### B2 — `GET /bookings/:id/service-address` (new)

Answers `200` for the customer, and for the assigned provider once the job has
left `REQUESTED`; `404` otherwise (a provider must not see the address for a job
they are still being asked to accept).

```json
{ "label": "Home", "line1": "House 12, Gulberg", "line2": null,
  "areaId": 1, "areaName": "Gulberg",
  "lat": 31.5204, "lng": 74.3587, "revealed": true }
```

Frontend state: **consumed.** The job screen reads this through `useServiceAddress`
and shows `label`, `line1`, `line2`, `areaName` and the `lat`/`lng` pair in the API's
own precision. `lat`/`lng` are nullable and a row without them renders no
coordinates rather than the word "null". The read is gated on the booking having
left `REQUESTED`: while it is still an open offer the screen says the address is
not available yet and does not issue the request, so the `404` is never the normal
path. The old "the address is not available here" panel and its comment are gone.

No backend change required.

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
Admin ops board and landing: Verified (counts only what it holds; escrow total from the ledger)
Admin reports and plans: **No backend** — see A2 and "Still no backend at all"
Provider job screen: Verified (checklist and service address now read live)
Finance: Not started

The B1/B2/A3 frontend work the backend had already unblocked is now **done**: the
provider job screen reads `GET /bookings/:id/checklist` and
`GET /bookings/:id/service-address`, and the admin landing reads `GET /finance/escrow`
for the held total. Nothing in this file is waiting on those three any more.

## Finance Readiness

READY, with one dependency worth naming before it starts: the finance screens need
an **admin bookings list** (A2) to show anything platform-wide. Per-booking and
per-ledger routes are unaffected.

Note A3 is no longer a dependency — `GET /finance/escrow` is admin-readable
already, so the held total is available without any new backend work.

Blocking reasons: None.