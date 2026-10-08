# API Handoff — for the frontend team

**Read this before building a screen.** It is the contract between the backend and any
frontend: what each endpoint expects, what it returns, and the behaviour that will
otherwise surprise you. The exhaustive list of all 175 operations is in
[`api-handoff-index.md`](./api-handoff-index.md), included at the bottom of this file.

| | |
|---|---|
| Base URL | `http://localhost:3000/api/v1` (dev) |
| Interactive API docs | `http://localhost:3000/api/docs` — generated from the live app, always current |
| OpenAPI JSON | `./openapi.json` — committed snapshot (§ regenerate with `npm run api:openapi -w @smart-home/api`); the live copy is at `http://localhost:3000/api/docs/openapi.json` |
| Auth scheme | `Authorization: Bearer <accessToken>` |
| Content type | `application/json` everywhere except the two PDF/CSV downloads |
| Errors | RFC 7807 `application/problem+json` |
| Screen backlog | [`TASKS_FRONTEND.md`](./TASKS_FRONTEND.md) |

> **When you add an API on the backend, this file must be updated in the same change.**
> Re-run `npm run api:handoff --workspace @smart-home/api` to refresh the endpoint index,
> then hand-edit the section for the screen it belongs to. There is no test that fails
> if you forget — it is a rule the team keeps, so please do not let it slide.

---

## 1. Conventions that apply everywhere

### 1.1 Authentication

Two tokens, deliberately different lifetimes, and the split matters:

- **Access token** — short-lived JWT (15 min). Returned in the JSON body. **Hold it in
  memory only**, never `localStorage`. Send it as `Authorization: Bearer <token>`.
- **Refresh token** — long-lived, rotating, single-use. Delivered as an **httpOnly
  cookie** named `shm_rt`, scoped to `path=/api/v1/auth`, `SameSite=Lax`, `Secure` in
  production. Script cannot read it, which is the point — send it with `credentials:
  'include'` and never try to manage it yourself.

On 401, call `POST /api/v1/auth/refresh` once and retry the original request. If that
also fails, the session is gone: clear state and send the user to login.

**Reuse is treated as theft.** A refresh token that is presented twice revokes the
whole session family and returns `REFRESH_REUSE_DETECTED`. So never retry a refresh
with a stale token, and never share a cookie jar across users.

`POST /auth/login` and `POST /auth/register` return `totpRequired`. When it is `true`
you are signed in but **not yet authorised for staff routes** — every staff endpoint
answers `401 TOTP_REQUIRED` until the user completes `POST /auth/totp/setup` then
`/auth/totp/verify`. Customers and providers never see this flag.

### 1.2 Idempotency

`POST`, `PUT`, `PATCH` and `DELETE` accept an `Idempotency-Key` header (8–200 chars).

- The header is **optional** — omitting it just means "do not retry this blindly".
- **Send it for every payment or booking write.** Generate a UUID per user intent
  (per checkout attempt, not per retry) so a double-tap, a flaky connection, or a
  React re-render cannot create two bookings.
- Replaying a key returns the **original stored response**, with the original status
  code, plus header `Idempotency-Replayed: true`. Treat that exactly like a success.
- Reusing a key with a **different body** returns `422 IDEMPOTENCY_KEY_REUSED`. This is
  a bug in the client, not something to retry around.
- Two concurrent uses of one key: the second gets `409 IDEMPOTENCY_IN_PROGRESS`.

Evidence upload has its own belt-and-braces: a `clientUuid` field, so a photo uploaded
twice stores once and returns `200` with `duplicate: true` instead of `201`.

### 1.3 Errors

Every failure is `application/problem+json`:

```json
{ "type": "https://smart-home.local/problems/slot-taken",
  "title": "Slot Taken", "status": 409, "code": "SLOT_TAKEN", "detail": "...",
  "requestId": "…" }
```

Switch on `code`, never on the status alone — two different codes share a status.
The full catalog is `packages/contracts/src/errors.ts`. The ones that matter for UX:

| Code | Status | What the user should see |
|---|---|---|
| `VALIDATION_FAILED` | 422 | Per-field messages; `detail` names the offender |
| `UNAUTHENTICATED` / `TOTP_REQUIRED` | 401 | Refresh, or send them to enrol |
| `FORBIDDEN` / `CONFLICT_OF_INTEREST` | 403 | Not yours to do |
| `NOT_FOUND` | 404 | Generic "not found" — see below |
| `SLOT_TAKEN` | 409 | Someone got there first — refresh the slot list |
| `ILLEGAL_TRANSITION` | 409 | Action no longer valid in this state; re-read the booking |
| `OTP_INVALID` / `OTP_LOCKED` | 422 / 423 | Wrong code / too many tries |
| `RATE_LIMITED` | 429 | Countdown, then retry |
| `DEBT_BLOCKED` | 409 | Provider is over their commission ceiling |

**404 is used deliberately to hide existence.** Asking for someone else's booking,
address or complaint gives the same 404 as asking for something that does not exist.
Never tell a user "you do not have permission" for these — it leaks that the resource
is real. Say "not found".

### 1.4 Money and time

- **All money is an integer number of paisa.** `150000` is PKR 1,500. Format for
  display with `formatPaisa` from `@smart-home/domain` so grouping matches the backend.
  Never do float arithmetic on money, and never assume a decimal.
- **All timestamps are ISO 8601 UTC with a `Z`** (`2026-10-01T10:00:00.000Z`). Format for
  display yourself in `Asia/Karachi` — the business timezone — but send UTC.
- Slot times are **instants, not local wall-clock strings**. Send `scheduledStart` and
  `scheduledEnd` as ISO instants. Local wall time only appears in availability input
  (`startTime`/`endTime` as `HH:MM`).

### 1.5 Success status codes are not all 200

**Do not assert `status === 200`.** Nest defaults `POST` to **201**, and several routes
override it. Assert `2xx`, or branch on the documented value. Observed live against the
running server:

| Operation | Status |
|---|---|
| `POST /bookings`, `POST /bookings/checkout` | **201** |
| `POST /bookings/{id}/messages` | **201** |
| `POST /customer/addresses` | **201** |
| `POST /provider/documents` | **201** |
| `POST /auth/register`, `POST /auth/login` | **201** |
| `POST /auth/otp/request`, `POST /auth/password/forgot` | **202** (accepted, code on its way) |
| `POST /auth/logout` | **204** (no body) |
| `DELETE /customer/addresses/{id}`, `DELETE /provider/services/{serviceId}` | **204** |
| Every `GET` | **200** |
| All other `POST` actions (accept, depart, start, complete, cancel, reschedule, …) | **200** |

`POST /bookings/{id}/evidence` is the one to watch: **201** for a new photo, **200** when a
`clientUuid` retry is deduplicated. The body carries `duplicate: true/false` — check that,
not the status.

### 1.6 Two routes sit outside the prefix

`/health/live`, `/health/ready`, `/health/queues` and `/` are served at the **root** —
`http://localhost:3000/health/ready`, not under `/api/v1`. Everything else is prefixed.

### 1.7 One field name that will bite you

`GET /provider/profile` returns the provider's id as **`userId`**, not `providerId`:

```json
{ "userId": "…", "status": "APPROVED", "bio": "…", "experienceYears": 8,
  "qualification": "…", "cityId": 1, "baseAddressText": "…", "lat": 31.52,
  "lng": 74.35, "radiusM": 8000 }
```

That `userId` is what every other provider route expects as `{providerId}` in the path —
including `/search/providers/{providerId}/slots` and `/next-slots`. Passing
`/search/providers/undefined/next-slots` returns `400 uuid is expected`.

### 1.8 Validation

Request bodies are strict: an **unknown field is rejected**, not ignored
(`.strict()` everywhere). A typo in a field name is a `422`, not a silently dropped
value. Optional fields often have server defaults — sending them explicitly is fine.

---

## 2. The booking flow — the one to get right

This is the heart of the product and the easiest place to build something subtly wrong.

### 2.1 Booking statuses

```
PENDING_PAYMENT → REQUESTED → ACCEPTED → SCHEDULED → EN_ROUTE → IN_PROGRESS
                     │            │                     │           │
                     │            │                     │     QUOTE_REVISION ─┐
                     │            │                     │           │         │
                     ▼            ▼                     ▼      (back to IN_PROGRESS)
               UNFULFILLED  ABANDONED              NO_SHOW        │
                                                                   ▼
                                                          WORK_COMPLETED
                                                                   ▼
                                                    AWAITING_VERIFICATION
                              ┌────────────┬───────────────┬───────────┴────────┐
                              ▼            ▼               ▼                    ▼
                          VERIFIED   AUTO_RELEASED      REWORK_REQUIRED        DISPUTED
                              └────────────┴───────────────┴────────────────────┘
                                           ▼
                                  PAYMENT_RELEASED → CLOSED
```
Also reachable: `PARTIALLY_REFUNDED`, `REFUNDED`, `CANCELLED_CUSTOMER`, `CANCELLED_PROVIDER`.

Every customer- and provider-facing action is one transition, and an action that does
not fit the current status returns `409 ILLEGAL_TRANSITION` naming the current status.
**Render from the status, never from your own local flag**, and re-read the booking
after any action — the response is the new truth.

### 2.2 Booking a service

1. **Price it first.** `POST /bookings/quote` — no side effects, returns the itemised
   lines (service, visit fee, emergency surcharge, coupon, any outstanding cash fee) plus
   the cancellation policy. Show the estimate and the cancellation policy *before*
   confirm, as the SRS requires.
2. **Pick a time.** Two options, both public:
   - `GET /search/providers/{providerId}/slots?serviceId=&date=YYYY-MM-DD` — the half-hourly
     picker for a named date.
   - `GET /search/providers/{providerId}/next-slots?serviceId=&limit=` — **"when is this provider
     next free?"** across the coming days, soonest first. This is what a same-day
     customer actually wants; they have no date in mind.
3. **Check out.** `POST /bookings` (or the `/checkout` alias).

`POST /bookings` body:

| Field | Notes |
|---|---|
| `serviceId` | required |
| `addressId` | required, must be **your own** address; someone else's returns 404 |
| `scheduledStart` / `scheduledEnd` | ISO instants; `end > start` enforced |
| `providerId` | omit to auto-assign to the first ranked provider who accepts |
| `problemText` | free text, 1–2000 chars, optional |
| `issueOptionId` | **optional** — one of the service's common faults, from §3.2 |
| `onBehalfOf` | **optional** — `{ name, phoneE164 }`, booking for someone else, see §2.6 |
| `paymentMode` | `CASH` (default) or `ONLINE` |
| `isEmergency` | default `false`; only valid on emergency-eligible services, else 400 |
| `couponCode` | optional |

**Timing rules** (both enforced at checkout, and the slot endpoints use the same
settings so an offered time is always bookable):

- A start must be at least `booking.min_notice_min` (**30 min**) away. Inside that you
  get `400` with a message naming the notice.
- A booking **may cross local midnight** — a 23:00–00:30 job is fine. A window crossing
  more than one night is refused.
- The time must sit inside the provider's declared availability, or the provider's
  auto-assign will simply skip them and the booking goes `UNFULFILLED`.

**Cash vs online is a real behavioural difference.** `CASH` returns immediately with
status `REQUESTED`. `ONLINE` returns **201 with status `PENDING_PAYMENT` and a
`payment.redirectUrl`** — the booking is *not* offered to any provider until the
gateway's signed webhook confirms the capture, and it is abandoned if unpaid within
`booking.pending_payment_timeout_min`. Do not show the booking as "confirmed" at
`PENDING_PAYMENT`; show it as awaiting payment and poll or rely on the redirect.

**Races are real and handled.** Two customers booking one slot: exactly one gets 201,
the other `409 SLOT_TAKEN`. On that error, refresh the slot list — do not retry the
same instant.

### 2.3 The provider's side

`GET /provider/offers` lists jobs offered to you with a countdown to `expiresAt`, then:

- `POST /provider/offers/{id}/accept` — job becomes `SCHEDULED`, the slot is locked,
  and a **6-digit start code is issued and SMS'd to the customer**.
- `POST /provider/offers/{id}/decline` — moves to the next provider, or `UNFULFILLED`
  if there is no one else.

Then on the day: `depart` → `EN_ROUTE`, `start` (with the code the customer reads out)
→ `IN_PROGRESS`, evidence/checklist, `complete` → `WORK_COMPLETED` →
`AWAITING_VERIFICATION`.

`POST /bookings/{id}/start` takes `{ code, lat?, lng?, accuracyM? }`. The location is
recorded as check-in and comes back as `distanceM` and `withinGeofence`. **A geofence
shortfall is flagged, never blocking** — surface it as a warning, do not refuse to
continue. Wrong code is `422 OTP_INVALID`; the fifth wrong attempt locks the code for
15 minutes and returns `423 OTP_LOCKED`.

`POST /bookings/{id}/complete` requires every checklist step done (photo steps with
their photo) and a before *and* after photo, else `409`. `finalAmountPaisa` may be
**lower** than the approved total but never higher — that is `422`.

### 2.4 Verification, and why money is released

The product promise: the provider finishes, **someone confirms with the customer, and
only then does the money move.** A database trigger refuses to mark a booking
`PAYMENT_RELEASED` without a release-permitting verification, so this cannot be
bypassed from the client.

Tier B (routine jobs) releases on the customer's own answer via a one-tap link —
`GET/POST /v/{token}`, **no login**, authenticated by an SMS code. Tier A is a staff
agent's phone call. Either way the customer is now **texted** when the work completes,
so build a notification surface for it rather than assuming they will open the app.

After 72 hours with no answer, escrow auto-releases (`AUTO_RELEASED`, no rating). So
the customer's prompt is time-limited — say so.

### 2.5 Cash jobs

For `CASH`, the call gates the handover: after a passing verification the provider is
**authorised to collect**, and only `POST /bookings/{id}/cash-received` completes the
release and debits commission. The customer gets an SMS receipt with a link to report a
problem.

### 2.6 Booking on behalf of someone else

A customer can book for another person. **The booker's account still pays, rates,
disputes and is verified against** — `customer_id` is unchanged, so nothing about the
money or the escrow moves. Only the door changes:

```json
"onBehalfOf": { "name": "Bilal Ahmed", "phoneE164": "+923111223344" }
```

Both fields are required together (`phoneE164` must be valid E.164); a half-filled object
is `422`. Read the contact with `GET /bookings/{id}/on-behalf-contact`:

```json
{ "contact": { "name": "Bilal Ahmed", "phone": "+92•••••••344", "revealed": false } }
```

**The number is masked until the provider accepts the job**, because an offer is still a
choice and a provider browsing offers should not collect contact details for jobs they
may decline. `revealed` tells you whether you are seeing the real number:

- `revealed: true` — the customer who entered it, or the provider who accepted. Show it.
- `revealed: false` — anyone else. **Render the masked form as-is.** Do not attempt to
  reconstruct it.

It is deliberately absent from the booking row entirely, so there is no other field that
can leak it. For an ordinary booking the endpoint returns `{ "contact": null }`.

### 2.7 Reschedule, cancel, warranty

- `POST /bookings/{id}/reschedule` — free **once**, and only at least 4 hours before the
  current slot. Same availability rules as a new booking.
- `POST /bookings/{id}/cancel` — either party. **Surface the fee consequence before
  confirming** (late cancellation is charged).
- `POST /bookings/{id}/warranty-claim` — within the service's warranty; after it,
  `409`.

---

## 3. The client's 5 Oct 2026 request, as shipped

### 3.1 "Can I book for the same day / within the hour?"

Yes. Both slot endpoints honour a 30-minute minimum notice, and a booking starting
45 minutes out succeeds. Use `next-slots` for this question — it is designed for exactly
it. For an urgent job also pass `isEmergency: true` (eligible services only) to add the
surcharge line.

### 3.2 "A dropdown of common faults, or edit my own description"

Fetch `GET /catalogue/services/{slug}/issue-options` (public) — or read `issueOptions`
from `GET /catalogue/services/{slug}`, which includes it — and render the list as a
dropdown:

```json
{ "items": [ { "id": 7, "slug": "under-sink", "labelEn": "Water pooling under the sink",
               "labelUr": "سنک کے نیچے پانی جمع ہونا", "position": 0 } ] }
```

Always render `labelEn`/`labelUr` by the user's locale. 44 options are seeded across 13
services.

**It is a convenience, never a constraint.** The customer may pick an option, write
their own `problemText`, or both. Pre-fill the description from the chosen label so they
start from something and can edit it — that is the behaviour the client asked for.
Offering the dropdown must not remove the free-text box.

An option from a *different* service is refused (`404`), so a reported fault can never
be mislabelled. Admin replaces a service's list wholesale via
`PUT /admin/catalogue/services/{id}/issue-options`, exactly like the checklist; option
ids change when it is replaced, but an existing booking keeps the label it was shown.

### 3.3 "Call the customer, they approve, the money is released"

Already the built product — see §2.4. The one gap found and closed: completion now
**texts** the customer as well as notifying in-app, because on a Tier B job they were
never told there was anything to confirm and the money released itself after 72 hours.

---

## 4. Per-screen notes

### Public browsing
`GET /places/cities` then `GET /places/cities/{cityId}/areas` for the address picker.
The catalogue is one city and area-aware by design. `GET /catalogue/categories` →
`/categories/{slug}/services` → `/services/{slug}` (the detail includes both the
provider checklist and `issueOptions`).

`GET /search/providers` takes `serviceSlug`, `lat`, `lng` and is **time-blind** — it
does not filter by availability. To answer "who is free", follow up with `slots` or
`next-slots` per provider.

### Provider onboarding
Documents via presigned upload (`POST /uploads/presign` → PUT the file → confirm),
then `PUT /provider/availability` (replace-all weekly windows), `PUT /provider/service-areas`,
and offer services with `PUT /provider/services/{serviceId}` for admin approval. The
admin approves the provider and each service offer separately.

### Notification centre
`GET /notifications`, `POST /notifications/{id}/read`, `POST /notifications/read-all`.
Delivery is backend-only (SMS/email); `GET /admin/notifications` is the delivery log for
admins and is where repeated `FAILED` shows up. The frontend does not send anything.

### Chat
`GET/POST /bookings/{id}/messages`, available only while the booking is in flight.
**Phone numbers and emails in message bodies are masked by the backend before storage.**
There is no client-side masking job to do — and do not try to reconstruct them.

### Evidence
`POST /bookings/{id}/evidence` takes **base64**, not multipart. Keep `clientUuid` stable
across retries. Compress client-side first — `evidence.photo_max_bytes` is 5 MB and
`evidence.photo_max_edge_px` is 1600px. The customer may attach up to 5 `CUSTOMER_PROBLEM`
photos, and only before the job starts; the provider records `BEFORE`, `AFTER` and
per-step `CHECKLIST` photos. Evidence is insert-only — never edited or deleted.

### Money screens
Customer: `GET /bookings` history, `GET /bookings/{id}/invoice.pdf` (itemised PDF).
Provider: `GET /provider/earnings`, `/wallet`, `/payout-accounts`, `/payouts`. Finance:
`/finance/*`. Note `GET /provider/earnings` distinguishes **held / releasable / paid**,
which is the distinction customers and providers most often get wrong.

---

## 5. Things the backend has **not** built yet

Do not design screens around these:

- **No frontend exists yet.** This document is the contract; the repository has no web
  or mobile app. `TASKS_FRONTEND.md` is the screen backlog.
- **Telephony is a mock.** `TelephonyPort` returns a fake call reference; click-to-call
  in the agent console has a manual-dial fallback. No real vendor, no IVR, no recording
  from a provider. OQ-04 in the tracker is still open.
- **Operations board, reports and maintenance plans** (`TASKS_FRONTEND.md` Phase 5) have
  no endpoints behind them yet.
- `POST /bookings/{id}/cancel` records the cancellation; the **fee rules are computed by
  the booking state machine, not returned** — if you need the exact fee before
  confirming, get it from `/bookings/quote`.
- Dispute resolution, appeals and several conduct paths are coded but have **no
  integration tests**, so treat those endpoints as provisional.

## 6. Regenerating the index

```bash
# from the repository root, with the dev database up
npm run api:handoff --workspace @smart-home/api
```

Rewrites `docs-final/api-handoff-index.md` from the live application. It reports
`N of N operations`; anything ungrouped is a bug in the generator's group table, not a
reason to skip the update.

If you also changed the set of endpoints, regenerate the committed snapshot the API
tests compare against, **and read the diff before committing it** — it is the only thing
standing between a refactor and a silently broken client:

```bash
npm run api:surface --workspace @smart-home/api
git diff apps/api/test/api-surface.baseline.json
```

---

## Appendix — every operation

Generated file, do not edit. Includes all 175 operations grouped by screen area.<!-- GENERATED FILE - DO NOT EDIT.
     Produced by `npm run api:handoff --workspace @smart-home/api`, from the live application.
     Re-run it whenever an API is added or changed, and edit API_HANDOFF.md for the contracts. -->

# API index — 175 operations

Generated 2026-10-06 from version `1.0.0`. Base path `api/v1`;
OpenAPI at `api/docs`. This table is the exhaustive list; `API_HANDOFF.md` adds the contracts you cannot
infer from a path.

## Identity & sessions

| Operation | Role | Summary |
|---|---|---|
| `POST /api/v1/auth/login` | PUBLIC | Log in with a password |
| `POST /api/v1/auth/logout` | PUBLIC | Log out |
| `GET /api/v1/auth/me` | AUTHENTICATED | Get your own profile |
| `POST /api/v1/auth/otp/request` | PUBLIC | Send a one-time verification code |
| `POST /api/v1/auth/otp/verify` | PUBLIC | Verify a one-time code |
| `POST /api/v1/auth/password/forgot` | PUBLIC | Request a password reset code |
| `POST /api/v1/auth/password/reset` | PUBLIC | Reset your password |
| `POST /api/v1/auth/refresh` | PUBLIC | Get a new access token |
| `POST /api/v1/auth/register` | PUBLIC | Sign up for a new account |
| `DELETE /api/v1/auth/totp` | AUTHENTICATED | Turn off two-factor authentication |
| `POST /api/v1/auth/totp/setup` | AUTHENTICATED | Start setting up two-factor authentication |
| `POST /api/v1/auth/totp/verify` | AUTHENTICATED | Confirm and turn on two-factor authentication |

## Catalogue & places (public browsing)

| Operation | Role | Summary |
|---|---|---|
| `GET /api/v1/catalogue/categories` | AUTHENTICATED | Browse the service categories |
| `GET /api/v1/catalogue/categories/{slug}/services` | AUTHENTICATED | Browse the services in a category |
| `GET /api/v1/catalogue/services/{slug}` | AUTHENTICATED | Get one service, including its checklist |
| `GET /api/v1/catalogue/services/{slug}/issue-options` | AUTHENTICATED | The common faults a customer can pick from when booking this service |

## Search & reputation (public)

| Operation | Role | Summary |
|---|---|---|
| `GET /api/v1/search/providers` | AUTHENTICATED | Find providers who offer a service near a point |
| `GET /api/v1/search/providers/{providerId}` | AUTHENTICATED | Get a provider’s full public profile |
| `GET /api/v1/search/providers/{providerId}/next-slots` | AUTHENTICATED | When is this provider next free? |
| `GET /api/v1/search/providers/{providerId}/remarks` | AUTHENTICATED | A provider’s published remarks |
| `GET /api/v1/search/providers/{providerId}/reputation` | AUTHENTICATED | A provider’s public reputation |
| `GET /api/v1/search/providers/{providerId}/slots` | AUTHENTICATED | List the times a provider can be booked on a day |

## Customer profile & addresses

| Operation | Role | Summary |
|---|---|---|
| `GET /api/v1/customer/addresses` | CUSTOMER | List my saved addresses |
| `POST /api/v1/customer/addresses` | CUSTOMER | Save a new address |
| `DELETE /api/v1/customer/addresses/{id}` | CUSTOMER | Remove a saved address |
| `PATCH /api/v1/customer/addresses/{id}` | CUSTOMER | Update a saved address |

## Booking lifecycle

| Operation | Role | Summary |
|---|---|---|
| `GET /api/v1/bookings` | AUTHENTICATED | List my bookings |
| `POST /api/v1/bookings` | AUTHENTICATED | Check out a booking |
| `GET /api/v1/bookings/{id}` | AUTHENTICATED | Read one booking |
| `POST /api/v1/bookings/{id}/accept` | AUTHENTICATED | Accept a booking request |
| `POST /api/v1/bookings/{id}/cancel` | AUTHENTICATED | Cancel a scheduled booking |
| `POST /api/v1/bookings/{id}/cash-received` | AUTHENTICATED | Confirm the customer paid cash |
| `POST /api/v1/bookings/{id}/checklist/{itemId}` | AUTHENTICATED | Mark a checklist item done |
| `POST /api/v1/bookings/{id}/complete` | AUTHENTICATED | Mark the job complete |
| `POST /api/v1/bookings/{id}/decline` | AUTHENTICATED | Decline a booking request |
| `POST /api/v1/bookings/{id}/depart` | AUTHENTICATED | Mark yourself en route |
| `GET /api/v1/bookings/{id}/evidence` | AUTHENTICATED | List a booking’s photos |
| `POST /api/v1/bookings/{id}/evidence` | AUTHENTICATED | Upload a photo |
| `GET /api/v1/bookings/{id}/invoice.pdf` | AUTHENTICATED | Download the invoice |
| `GET /api/v1/bookings/{id}/messages` | AUTHENTICATED | Read the booking chat |
| `POST /api/v1/bookings/{id}/messages` | AUTHENTICATED | Send a chat message |
| `POST /api/v1/bookings/{id}/no-show` | AUTHENTICATED | Report a no-show |
| `GET /api/v1/bookings/{id}/on-behalf-contact` | AUTHENTICATED | Who will receive the provider, when the booking is for someone else |
| `POST /api/v1/bookings/{id}/reschedule` | AUTHENTICATED | Reschedule a booking |
| `POST /api/v1/bookings/{id}/revisions` | AUTHENTICATED | Raise a revised quote for extra work |
| `POST /api/v1/bookings/{id}/revisions/approve` | AUTHENTICATED | Approve the pending revised quote |
| `POST /api/v1/bookings/{id}/revisions/reject` | AUTHENTICATED | Reject the pending revised quote |
| `POST /api/v1/bookings/{id}/start` | AUTHENTICATED | Start the job with the customer’s code |
| `POST /api/v1/bookings/{id}/warranty-claim` | AUTHENTICATED | Claim under warranty |
| `POST /api/v1/bookings/checkout` | AUTHENTICATED | Check out a booking (alias of POST /bookings) |
| `POST /api/v1/bookings/quote` | AUTHENTICATED | Price a booking before committing to it |

## Provider offers & job execution

| Operation | Role | Summary |
|---|---|---|
| `GET /api/v1/provider/offers` | PROVIDER | List the jobs currently offered to me |
| `POST /api/v1/provider/offers/{id}/accept` | PROVIDER | Accept an offered job |
| `POST /api/v1/provider/offers/{id}/decline` | PROVIDER | Decline an offered job |

## Provider onboarding & availability

| Operation | Role | Summary |
|---|---|---|
| `GET /api/v1/provider/availability` | PROVIDER | Read my weekly availability calendar |
| `PUT /api/v1/provider/availability` | PROVIDER | Replace my weekly availability calendar |
| `GET /api/v1/provider/documents` | PROVIDER | List my uploaded documents |
| `POST /api/v1/provider/documents` | PROVIDER | Submit an identity document |
| `GET /api/v1/provider/profile` | PROVIDER | Read my provider profile |
| `PATCH /api/v1/provider/profile` | PROVIDER | Update my provider profile |
| `GET /api/v1/provider/service-areas` | PROVIDER | List the areas I serve |
| `PUT /api/v1/provider/service-areas` | PROVIDER | Replace the areas I serve |
| `GET /api/v1/provider/time-off` | PROVIDER | List my recorded leave periods |
| `POST /api/v1/provider/time-off` | PROVIDER | Record a leave period |
| `DELETE /api/v1/provider/time-off/{id}` | PROVIDER | Cancel a leave period |

## Provider services & pricing

| Operation | Role | Summary |
|---|---|---|
| `GET /api/v1/provider/services` | PROVIDER | List the services I offer |
| `DELETE /api/v1/provider/services/{serviceId}` | PROVIDER | Stop offering a service |
| `PUT /api/v1/provider/services/{serviceId}` | PROVIDER | Offer a service at your price |

## Uploads (presigned targets)

| Operation | Role | Summary |
|---|---|---|
| `POST /api/v1/uploads/presign` | AUTHENTICATED | Get an upload target for a document |

## Provider money

| Operation | Role | Summary |
|---|---|---|
| `POST /api/v1/provider/debt/pay` | PROVIDER | Pay commission debt online |
| `GET /api/v1/provider/earnings` | PROVIDER | See my earnings |
| `GET /api/v1/provider/payout-accounts` | PROVIDER | List my payout accounts |
| `POST /api/v1/provider/payout-accounts` | PROVIDER | Add a payout account |
| `GET /api/v1/provider/payouts` | PROVIDER | List my payouts |
| `POST /api/v1/provider/payouts` | PROVIDER | Request a payout |
| `GET /api/v1/provider/wallet` | PROVIDER | See my wallet and commission debt |

## Verification agent console

| Operation | Role | Summary |
|---|---|---|
| `GET /api/v1/agent/queue` | AGENT | See the verification queue |
| `POST /api/v1/agent/queue/claim` | AGENT | Claim the next call |
| `GET /api/v1/agent/verifications/{id}` | AGENT | Open the console for a call you hold |
| `GET /api/v1/agent/verifications/{id}/attempts` | AGENT | List the call attempts so far |
| `POST /api/v1/agent/verifications/{id}/attempts` | AGENT | Log a call attempt |
| `POST /api/v1/agent/verifications/{id}/call` | AGENT | Call the customer |
| `POST /api/v1/agent/verifications/{id}/release-lock` | AGENT | Put a claimed call back |
| `POST /api/v1/agent/verifications/{id}/submit` | AGENT | Submit the verification |

## Customer verification link

| Operation | Role | Summary |
|---|---|---|
| `GET /api/v1/v/{token}` | AUTHENTICATED | Open a verification link (customer) |
| `POST /api/v1/v/{token}` | AUTHENTICATED | Answer a verification link (customer) |

## Provider reputation & conduct

| Operation | Role | Summary |
|---|---|---|
| `GET /api/v1/admin/providers/{providerId}/ratings` | ADMIN | Review a provider’s ratings |
| `POST /api/v1/admin/remarks/{id}/unpublish` | ADMIN | Unpublish an abusive remark |
| `GET /api/v1/provider/conduct` | PROVIDER | See my conduct record |
| `GET /api/v1/provider/penalties` | PROVIDER | See my penalties |
| `GET /api/v1/provider/penalties/{id}` | PROVIDER | Read one of my penalties |
| `POST /api/v1/provider/penalties/{id}/appeal` | PROVIDER | Appeal an applied penalty |
| `POST /api/v1/provider/penalties/{id}/reply` | PROVIDER | Reply to a proposed penalty |
| `GET /api/v1/provider/ratings` | PROVIDER | See the ratings I received |
| `POST /api/v1/provider/remarks/{id}/reply` | PROVIDER | Reply to a remark |

## Complaints (raised by either party)

| Operation | Role | Summary |
|---|---|---|
| `GET /api/v1/complaints` | AUTHENTICATED | List my complaints |
| `POST /api/v1/complaints` | AUTHENTICATED | Raise a complaint |
| `GET /api/v1/complaints/{id}` | AUTHENTICATED | Read a complaint and its timeline |
| `POST /api/v1/complaints/{id}/evidence` | AUTHENTICATED | Add a photo to a complaint |
| `POST /api/v1/complaints/{id}/reply` | AUTHENTICATED | Reply on a complaint |
| `POST /api/v1/complaints/from-receipt` | AUTHENTICATED | Report a problem from a receipt link |

## Disputes (a provider sees these)

| Operation | Role | Summary |
|---|---|---|
| `GET /api/v1/provider/disputes` | PROVIDER | See my disputes |
| `GET /api/v1/provider/disputes/{id}` | PROVIDER | Read a dispute on my job |
| `POST /api/v1/provider/disputes/{id}/reply` | PROVIDER | Reply to a dispute |

## Finance

| Operation | Role | Summary |
|---|---|---|
| `GET /api/v1/finance/cash-reconciliation` | FINANCE | Reconcile cash jobs |
| `GET /api/v1/finance/debts` | FINANCE | List commission debts |
| `GET /api/v1/finance/escrow` | FINANCE | See the money held in escrow |
| `GET /api/v1/finance/ledger` | FINANCE | Explore the ledger |
| `GET /api/v1/finance/payout-batches` | FINANCE | List payout batches |
| `POST /api/v1/finance/payout-batches` | FINANCE | Create a payout batch |
| `GET /api/v1/finance/payout-batches/{id}/export.csv` | FINANCE | Download the bank file |
| `POST /api/v1/finance/payout-batches/{id}/mark-paid` | FINANCE | Record the bank’s result for a batch |
| `GET /api/v1/finance/payout-batches/{id}/statements/{providerId}` | FINANCE | A provider’s statement for a batch |
| `GET /api/v1/finance/payouts` | FINANCE | List payout requests |
| `POST /api/v1/finance/payouts/{id}/approve` | FINANCE | Approve a payout |
| `POST /api/v1/finance/reconciliation/run` | FINANCE | Run the ledger reconciliation now |
| `GET /api/v1/finance/recordings/{attemptId}` | FINANCE | Play a call recording |
| `GET /api/v1/finance/refunds` | FINANCE | List refunds |
| `POST /api/v1/finance/refunds` | FINANCE | Refund a disputed booking by hand |

## Admin: catalogue & providers

| Operation | Role | Summary |
|---|---|---|
| `POST /api/v1/admin/catalogue/categories` | ADMIN | Create a service category |
| `PATCH /api/v1/admin/catalogue/categories/{id}` | ADMIN | Update a service category |
| `GET /api/v1/admin/catalogue/commission-rules` | ADMIN | List commission rules |
| `POST /api/v1/admin/catalogue/commission-rules` | ADMIN | Set a commission rate |
| `POST /api/v1/admin/catalogue/commission-rules/{id}/end` | ADMIN | Close a commission rule |
| `POST /api/v1/admin/catalogue/services` | ADMIN | Create a bookable service |
| `PATCH /api/v1/admin/catalogue/services/{id}` | ADMIN | Update a bookable service |
| `PUT /api/v1/admin/catalogue/services/{id}/checklist` | ADMIN | Replace a service's checklist |
| `PUT /api/v1/admin/catalogue/services/{id}/issue-options` | ADMIN | Replace a service's common-faults list |
| `POST /api/v1/admin/documents/{documentId}/review` | ADMIN | Verify or reject a document |
| `GET /api/v1/admin/documents/{documentId}/url` | ADMIN | Get a short-lived link to a document |
| `GET /api/v1/admin/provider-services` | ADMIN | Review provider service offers |
| `POST /api/v1/admin/provider-services/{providerId}/{serviceId}/approve` | ADMIN | Approve a provider's offer to provide a service |
| `POST /api/v1/admin/provider-services/{providerId}/{serviceId}/reject` | ADMIN | Reject a provider's offer to provide a service |
| `POST /api/v1/admin/providers/{providerId}/approve` | ADMIN | Approve a provider |
| `GET /api/v1/admin/providers/{providerId}/documents` | ADMIN | List a provider's documents for review |
| `POST /api/v1/admin/providers/{providerId}/reject` | ADMIN | Reject a provider |

## Admin: complaints, disputes & conduct

| Operation | Role | Summary |
|---|---|---|
| `GET /api/v1/admin/appeals` | ADMIN | List appeals |
| `POST /api/v1/admin/appeals/{id}/decide` | ADMIN | Decide an appeal |
| `GET /api/v1/admin/complaints` | ADMIN | The complaint queue |
| `GET /api/v1/admin/complaints/{id}` | ADMIN | Open a complaint |
| `POST /api/v1/admin/complaints/{id}/assign` | ADMIN | Assign a complaint |
| `POST /api/v1/admin/complaints/{id}/open-dispute` | ADMIN | Freeze the job’s money as a dispute |
| `POST /api/v1/admin/complaints/{id}/transition` | ADMIN | Move a complaint along, or decide it |
| `GET /api/v1/admin/disputes` | ADMIN | The dispute queue |
| `GET /api/v1/admin/disputes/{id}` | ADMIN | Open a dispute: the evidence floor |
| `POST /api/v1/admin/disputes/{id}/resolve` | ADMIN | Rule on a dispute |
| `GET /api/v1/admin/penalties` | ADMIN | List penalties |
| `POST /api/v1/admin/penalties` | ADMIN | Propose a penalty |
| `GET /api/v1/admin/penalties/{id}` | ADMIN | Read a penalty |
| `POST /api/v1/admin/penalties/{id}/apply` | ADMIN | Apply a penalty |
| `POST /api/v1/admin/penalties/{id}/withdraw` | ADMIN | Withdraw a proposed penalty |

## Admin: templates, settings & notifications

| Operation | Role | Summary |
|---|---|---|
| `GET /api/v1/admin/notifications` | ADMIN | The notification delivery log |
| `GET /api/v1/admin/settings` | ADMIN | List all platform settings |
| `GET /api/v1/admin/settings/{key}` | ADMIN | Read one setting's current value |
| `PUT /api/v1/admin/settings/{key}` | ADMIN | Change a setting's value |
| `GET /api/v1/admin/templates` | ADMIN | List notification templates |
| `POST /api/v1/admin/templates` | ADMIN | Create a template |
| `GET /api/v1/admin/templates/{id}` | ADMIN | Read a template |
| `PUT /api/v1/admin/templates/{id}` | ADMIN | Edit a template |
| `POST /api/v1/admin/templates/preview` | ADMIN | Preview a template |

## Notification centre

| Operation | Role | Summary |
|---|---|---|
| `GET /api/v1/notifications` | AUTHENTICATED | My notification centre |
| `POST /api/v1/notifications/{id}/read` | AUTHENTICATED | Mark one notification read |
| `POST /api/v1/notifications/read-all` | AUTHENTICATED | Mark all my notifications read |

## Places (cities & areas)

| Operation | Role | Summary |
|---|---|---|
| `GET /api/v1/places/cities` | AUTHENTICATED | List the cities the platform operates in |
| `GET /api/v1/places/cities/{cityId}/areas` | AUTHENTICATED | List the areas within a city |

## Provider-webhook callbacks (never called by the frontend)

| Operation | Role | Summary |
|---|---|---|
| `POST /api/v1/webhooks/payments/{provider}` | AUTHENTICATED | Payment provider webhook (not for direct use) |
| `POST /api/v1/webhooks/sms/{provider}` | AUTHENTICATED | SMS delivery receipt (not for direct use) |

## Development-only mocks

| Operation | Role | Summary |
|---|---|---|
| `GET /api/v1/dev/inbox` | AUTHENTICATED | View messages the mock SMS/email/WhatsApp senders "sent" |
| `GET /api/v1/dev/payments/{paymentId}` | AUTHENTICATED | Mock payment page (where the mock gateway redirects to) |
| `POST /api/v1/dev/payments/{paymentId}/complete` | AUTHENTICATED | Complete a mock payment |
| `GET /api/v1/dev/storage/{bucket}/{key}` | AUTHENTICATED | Download a file from the mock file storage |

## Health & welcome

| Operation | Role | Summary |
|---|---|---|
| `GET /` | PUBLIC | Welcome message |
| `GET /health/live` | PUBLIC | Is the server process running? |
| `GET /health/queues` | PUBLIC | How many jobs are waiting in each background queue |
| `GET /health/ready` | PUBLIC | Is the API fully ready to handle requests? |

