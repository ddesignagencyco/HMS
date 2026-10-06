# Backend handoff — implemented modules

Raised by the frontend team while wiring `apps/web` to the live API.
Last updated: 2026-10-03 · API commit `08bf442` · Verified against local dev
(Postgres + Redis, seeded).

> **Scope.** Only `apps/web` was ever changed. Everything in this document is a
> report, not a patch. Nothing in `apps/api`, `packages/*` or the database was
> modified. Where the frontend worked around something, it says so.

**Severity:** **S1** broken feature · **S2** contract/doc mismatch · **S3** hardening.

> **Read `docs-final/API_HANDOFF.md` first.** It is the contract of record for the
> frontend-facing API — all 175 operations, plus the conventions this document
> would otherwise have to restate (idempotency, non-200 success codes, integer
> paisa, RFC 7807 errors, the booking and verification flows). Two claims below are
> now **superseded** and are marked where they appear: §6.1 (provider documents)
> and §0.2 (missing endpoints — re-verify against the handoff before acting on it).

---

# 0. Environment

## 0.1 S1 — The API and the web app both default to port 3000

**File:** `.env` (`PORT=3000`) and `apps/web/next.config.ts:6`

`.env` sets `PORT=3000` for the API. `next dev` also defaults to **3000**. Whichever
process starts second fails to bind, and the failure mode is not a clean error — it is
this, from the web app's own terminal:

```
Failed to proxy http://localhost:3000/api/v1/auth/me Error: socket hang up
    code: 'ECONNRESET'
```

**Why that happens.** `next.config.ts` rewrites `/api/v1/:path*` onto `API_ORIGIN`. If
Next is bound to 3000 _and_ `API_ORIGIN` is also 3000, Next forwards the request to
itself. The dev server proxies into its own listener, recurses, and the socket is torn
down — so every `/auth/me` and `/catalogue/*` call dies with `ECONNRESET` while page
renders (`GET /en/services 200`) keep succeeding. The symptom reads like a broken API;
it is a port collision.

**What the frontend changed** (`apps/web` only):

- `next dev` and `next start` are pinned to **`-p 3001`**, so the collision cannot recur
  silently. **Open the web app at `http://localhost:3001`, not `:3000`.**
- `next.config.ts` refuses to start if `API_PROXY_ORIGIN` resolves to this server's own
  port, so a mis-set environment variable fails loudly at boot instead of producing a
  wall of socket resets.

**What the backend needs to do — one of:**

1. **Preferred:** leave `PORT=3000` for the API and keep the web app on 3001 (the state
   above). Nothing to change; the two are now explicitly separated.
2. Or move the API to a port Next does not use (e.g. `PORT=4000`) and set
   `API_PROXY_ORIGIN=http://localhost:4000` in `apps/web`'s environment.

**One caveat worth fixing while you are in there.** `API_PROXY_ORIGIN` is read only by
the Next process, and Next does **not** load the repo-root `.env` — it loads
`apps/web/.env.local`. So setting `API_PROXY_ORIGIN` in the root `.env` has no effect,
and the value can only be changed by editing the web app. If the API port is meant to be
deployable, the web app needs an `apps/web/.env.local` (currently absent) or the origin
should be passed in as a real deployment variable.

**Also note:** `.env` sets `CORS_ORIGINS=http://localhost:3000`, which is the API's
allow-list. Since the browser now reaches the API through the web app's origin on
**3001**, that value is stale — it should be `http://localhost:3001`. It is currently
harmless only because the proxy keeps every browser call same-origin, so the allow-list
is never consulted.

---

# 0.2 Eight missing endpoints, and the screens they block

> **Re-verify before acting on this section.** Written against `apps/api` before the
> 5 Oct handoff landed. `docs-final/API_HANDOFF.md` §5 ("Things the backend has not
> built yet") is now authoritative and is shorter: telephony is a mock, and
> **operations board, reports and maintenance plans** have no endpoints. The rows
> below that concern those three are confirmed still open. The provider-approval,
> audit-log and roles rows below were checked against the controllers in this repo
> and no reader exists for them — but confirm against the handoff index before
> spending time on a new backend task.

Raised 2026-10-06 while migrating every remaining screen off mock data.

The frontend work to remove all mock data is **not blocked by effort** — it is blocked
by these eight gaps. Everything else has a real endpoint waiting. Each row was verified
against the controllers in `apps/api/src`, not inferred from a route name.

**Priority order:** §0.2.1 and §0.2.2 first. They block the operations board and the
entire provider-approval flow, which are the two largest mock surfaces in the app.

| #     | Missing                                               | Blocks                                                         | Why it cannot be worked around                                                                                                                                 |
| ----- | ----------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.2.1 | `GET /admin/bookings`                                 | `/admin/ops` — the whole operations board                      | `GET /bookings` is guarded `CUSTOMER, PROVIDER` only. An admin has no booking list of any kind.                                                                |
| 0.2.2 | `GET /admin/providers` (directory + application list) | `/admin/providers`, `/admin/approvals`, `/admin/providers/:id` | `/admin/providers` exposes **only** `approve` and `reject`. There is no way to list applicants, so the approval queue has nothing to render.                   |
| 0.2.3 | `GET /admin/customers`                                | `/admin/customers`                                             | No customer-facing admin endpoint exists. `GET /bookings` is scoped to the caller.                                                                             |
| 0.2.4 | `GET /admin/reports`                                  | `/admin/reports`                                               | No analytics aggregate endpoint. Revenue-by-month, success rate and per-provider performance have no source.                                                   |
| 0.2.5 | `GET /admin/audit`                                    | `/admin/audit`                                                 | `AuditService` **writes** `audit_log`; no controller ever reads it. The data is already there.                                                                 |
| 0.2.6 | `GET /admin/roles`                                    | `/admin/roles`                                                 | The guard matrix is server-side policy metadata, never exposed over HTTP.                                                                                      |
| 0.2.7 | Maintenance plans (any endpoint)                      | `/account/plans`, `/plans`                                     | The `plans` table and the `PLAN_DEFERRED` ledger account exist, but nothing reads them. `services[].isPlanEligible` is eligibility, not a subscription.        |
| 0.2.8 | Public lookup by booking code                         | `/track`                                                       | `GET /bookings/:id` takes a **uuid** and is owner-scoped. The track form takes a human reference (`SHM-0001030`), so it cannot be built on the existing route. |

## 0.2.1 S1 — Admin booking list

`GET /bookings` is guarded `CUSTOMER, PROVIDER`. The operations board — today's
bookings by state, verification queue depth, SLA breaches, open disputes, escrow
held — has no data source.

**Ask:** `GET /admin/bookings?status=&from=&to=` returning the same `Booking` shape the
existing endpoint returns, so the frontend reuses `bookingApi` rather than a second
type. Without paging this will be the heaviest read in the system; a cursor and a
date range would both be welcome.

## 0.2.2 S1 — Provider directory and application list

`provider-approval-admin.controller.ts` exposes exactly two routes:

```
POST /admin/providers/:providerId/approve
POST /admin/providers/:providerId/reject
```

There is **no** `GET`. So the approval queue cannot list applicants, cannot show
how many documents each has submitted, and cannot show a provider's current status.
`/admin/providers/:id` on the frontend is worse than empty: it falls back to
`providers[0]`, so it silently displays a **different** provider.

**Ask:**

```
GET  /admin/providers?status=PENDING_APPROVAL|APPROVED|REJECTED|BLOCKED&search=&page=
GET  /admin/providers/:providerId          → user, profile, documents, status, services
```

`documentCount` on the list row is what makes the queue useful — the queue's whole
job is comparing submitted documents against the required list.

## 0.2.3 S1 — Customer register

No endpoint. `/admin/customers` currently renders 20 invented rows with real-looking
Pakistani phone numbers.

**Ask:** `GET /admin/customers?search=&status=&page=` → id, display name, **masked**
phone, joined date, booking count, spend, status. Note this feeds NFR-PR-01: the
register is exactly where an unmasked number leaks, so the response should be masked
server-side rather than trusting each client to mask.

## 0.2.4 S1 — Reports

No reporting endpoint. `/admin/reports` renders six months of invented revenue, a
success rate computed as `((94 + rating) - 0.5)%`, and an inert Export button.

**Ask:** `GET /admin/reports?kind=revenue|bookings|providers|verification&from=&to=` with
the aggregates the screen already claims to show. Exports (PDF/Excel) can stay
client-side if the data is returned as rows.

## 0.2.5 S2 — Audit log reader

`AuditService` writes `audit_log` and **no controller reads it**. The rows already
exist, so this is a read endpoint over data you are already producing.

**Ask:** `GET /admin/audit?actor=&entity=&entityId=&from=&to=&page=` → actor, action,
entity, entityId, before/after JSON, createdAt. `TASKS_FRONTEND.md` asks for filter by
actor, entity and date.

## 0.2.6 S3 — Roles and permissions

The role matrix is enforced by the policy guard and never serialised. `/admin/roles`
renders a 9-row matrix that was typed by hand and can drift from the guard with
nothing failing.

**Ask (or alternatively, confirm this should be removed):** `GET /admin/roles` →
role, label, and the permission keys the guard actually checks. If exposing the policy
metadata is not wanted, say so and the frontend will render a static explanatory page
instead of a matrix that claims to be authoritative.

## 0.2.7 S1 — Maintenance plans

Confirmed absent by grep across `apps/api/src`: the only `plan` hits are the Prisma
model, the migration, `is_plan_eligible` on services, and `PLAN_DEFERRED` in the
ledger. There is no subscribe, no entitlement balance, no renewal, no cancel.

**Ask:** see `TASKS_FRONTEND.md` Phase 5 — browse plans, subscribe, view remaining
entitlements and renewal date, cancel. `/account/plans` currently computes a pro-rata
refund in the browser from an invented plan list, and its cancel button does nothing.

## 0.2.8 S2 — Public lookup by booking code

**Ask — pick one:**

1. `GET /api/v1/track/:code` → `@Public()`, returning a deliberately narrow row (status,
   scheduled window, service name, masked professional first name). This is the option
   that keeps `/track` usable by somebody who is not signed in.
2. Require sign-in on `/track` and list the caller's own bookings.

Option 1 needs a rate limit and must not leak provider identity or the address.

---

## Contents

- [Module 1 — Authentication](#module-1--authentication)
  - [1.1 S1 — Email OTP delivery returns 500](#11-s1--email-otp-delivery-returns-500)
  - [1.2 S2 — `/auth/me` never returns `providerStatus`](#12-s2--authme-never-returns-providerstatus)
  - [1.3 S2 — `refreshSchema` / `logoutSchema` unreachable](#13-s2--refreshschema--logoutschema-are-unreachable)
  - [1.4 S3 — Unknown identifiers escape the login throttle](#14-s3--unknown-identifiers-are-not-subject-to-the-login-throttle)
  - [1.5 Questions, not defects](#15-questions-not-defects)
  - [1.6 S3 — Grace period for the previous refresh token](#16-s3--consider-a-grace-period-for-the-previous-refresh-token)
  - [1.7 S1 — Social authentication is absent](#17-s1--social-authentication-is-absent)
  - [1.8 Verified working — no action needed](#18-verified-working--no-action-needed)
  - [1.9 S1 — Confirm the refresh cookie survives the proxy](#19-s1--please-confirm-the-refresh-cookie-survives-the-proxy-a-real-sign-in-that-reads-as-signed-out)
- [Module 2 — Search, Catalogue & Public](#module-2--search-catalogue--public)
  - [2.1 Verified contracts](#21-verified-contracts)
  - [2.2 S1 — `areas.centroid` not selected](#22-s1--areascentroid-not-selected)
  - [2.3 S2 — `reputation.score` is a prior, not a rating](#23-s2--reputationscore-is-a-prior-not-a-rating)
  - [2.4 S2 — `remark.reply` is an object](#24-s2--remarkreply-is-an-object)
  - [2.5 S3 — No cheap anonymous-session answer](#25-s3--no-cheap-anonymous-session-answer)
  - [2.6 S2 — Unknown service slug is a 404](#26-s2--unknown-service-slug-is-a-404)
  - [2.7 Correct by design — do not "fix"](#27-correct-by-design--do-not-fix)
  - [2.8 Not a backend gap — the booking hand-off](#28-not-a-backend-gap--the-booking-hand-off)
- [Module 3 — Booking](#module-3--booking)
  - [3.1 S2 — `GET /bookings` publishes no readable names](#31-s2--get-bookings-publishes-no-readable-names)
  - [3.2 S2 — The `status` filter omits most of the enum](#32-s2--the-status-filter-omits-most-of-the-enum)
  - [3.3 S2 — `POST /bookings/:id/quote` does not exist](#33-s2--post-bookingsidquote-does-not-exist)
  - [3.4 S2 — FR-BK-06 cancellation fee is not applied](#34-s2--fr-bk-06-cancellation-fee-is-not-applied)
  - [3.5 S2 — Auto-assign cannot show availability before a taker exists](#35-s2--auto-assign-cannot-show-availability-before-a-taker-exists)
  - [3.6 S3 — No endpoint returns a booking's invoice line items](#36-s3--no-endpoint-returns-a-bookings-invoice-line-items)
  - [3.7 S2 — The payment return URL is fixed, locale-less, and names no route](#37-s2--the-payment-return-url-is-fixed-locale-less-and-names-no-route)
  - [3.8 S3 — `addressCreateSchema` requires a point nobody can supply](#38-s3--addresscreateschema-requires-a-point-nobody-can-supply)
  - [3.9 Verified working — no action needed](#39-verified-working--no-action-needed)
- [Module 4 — Notifications](#module-4--notifications)
  - [3.1 SMS gateway routing and failover](#31-sms-gateway-routing-and-failover)
  - [3.2 Localized notification templates](#32-localized-notification-templates)
- [Module 5 — Verification & onboarding](#module-5--verification--onboarding)
  - [5.1 Provider document upload trigger](#51-provider-document-upload-trigger)
- [What breaks in the frontend when each fix lands](#what-breaks-in-the-frontend-when-each-fix-lands)
- [Priority order](#priority-order-for-the-backend-team)
- [0. Environment — ports](#0-environment--ports)
  - [0.1 S1 — The API and the web app both default to port 3000](#01-s1--the-api-and-the-web-app-both-default-to-port-3000)
  - [0.2 Eight missing endpoints, and the screens they block](#02-eight-missing-endpoints-and-the-screens-they-block)

---

# Module 1 — Authentication

**Note on ports.** Everything below was verified against the web origin on
**`http://localhost:3001`** with the API on 3000. See §0.1 if you see
`socket hang up` / `ECONNRESET` — that is a port collision, not an API fault.

Wired by the frontend and verified live. The whole `/api/v1/auth/*` surface is
integrated: register, OTP request/verify, login, refresh, logout, password
forgot/reset, staff TOTP enrolment and verification, and `/auth/me`.

## 1.1 S1 — Email OTP delivery returns 500

**File:** `apps/api/src/identity/otp.service.ts:84`

```ts
if (normalised.startsWith('@')) await this.email.send(…);
else await this.sms.send(…);
```

`startsWith('@')` is never true for a real address, so every email target falls
into the **SMS** branch. `MockSmsSender.send` rejects non-E.164 recipients
(`apps/api/src/integrations/mocks.ts`), and that plain `Error` carries no status,
so `ProblemDetailsFilter.normalize` falls through to `500 INTERNAL_ERROR`.

The correct predicate is already defined and imported in the same file
(`otp.service.ts:14`):

```ts
export const isEmailTarget = (target: string): boolean => target.includes('@');
```

**Reproduce**

```
POST /api/v1/auth/otp/request  {"target":"provider@smart-home.local","purpose":"LOGIN"}
→ 500 {"code":"INTERNAL_ERROR","detail":"An unexpected error occurred"}

POST /api/v1/auth/otp/request  {"target":"+923001000097","purpose":"LOGIN"}
→ 202 {"sent":true,"purpose":"LOGIN","expiresAt":"…","resendAfterSeconds":60}
```

**Blast radius**

- Passwordless sign-in only works for accounts reachable by phone number.
- `POST /auth/password/forgot` calls
  `this.otp.issue(user.phone_e164 ?? user.email ?? identifier, …)`
  (`auth.service.ts:196`). Accounts **without** a phone get a 500 and can never
  recover their password.
- Worse: `/auth/password/forgot` still returns `202 {sent:true}`, because the
  throw happens downstream of the response. Silent failure, not visible.

**Fix:** use `isEmailTarget(normalised)`. Consider also mapping sender rejections
to a typed 4xx — today any adapter misuse becomes an opaque 500.

## 1.2 S2 — `/auth/me` never returns `providerStatus`

**File:** `apps/api/src/identity/auth.service.ts:309` — hardcodes
`providerStatus: null`, though the field is declared on `AuthenticatedUser`
(`:29`) and the endpoint's own Swagger description promises it.

The value exists in the database (`providers.status`, written by registration and
the conduct service) and `conduct.service.ts:426` already reads it correctly. A
provider therefore cannot tell whether they are `PENDING_APPROVAL`, `APPROVED` or
`BLOCKED` from their own profile, and the web app has to render approval as
unknown.

**Fix:** select `providers.status` in `USER_COLUMNS`, or `LEFT JOIN providers` on
`user_id`.

## 1.3 S2 — `refreshSchema` / `logoutSchema` are exported but unreachable

**Files:** `auth.schemas.ts:69,71` and `auth.controller.ts:105`

Both schemas and the public `RefreshInput` type are defined and exported, but
neither is referenced anywhere else. `refresh()` and `logout()` take no `@Body()`
and read the cookie only. A client sending `{"refreshToken":"…"}` in the body gets
a silent `401` that reads like a wrong token rather than a wrong transport, and
the strict-schema rejection of unknown body keys that every other `POST /auth/*`
route performs does not happen here.

**Fix:** wire the body in deliberately for non-browser clients, or delete both
schemas and the type so the published surface matches reality.

## 1.4 S3 — Unknown identifiers are not subject to the login throttle

**File:** `apps/api/src/identity/auth.service.ts:135-145`

`assertNotRateLimited` and `recordFailure` both sit **after** the unknown-user
early return, so the per-identifier + per-IP counter
(`auth:login-fail:<identifier>:<ip>`, `:348`) only accumulates for identifiers that
exist. Guessing against non-existent identifiers is bounded only by the global
300 req/min per-IP middleware. `dummyVerify` and the generic message are both
correct — the gap is purely that the counter is never incremented on that path.

**Fix:** move `assertNotRateLimited` above the `findUserByIdentifier` branch and
record the failure in both branches.

## 1.5 Questions, not defects

1. **Social sign-in does not exist at all.** The sign-in and register forms show
   Google and Facebook buttons that report "Coming Soon" — correctly, because
   there is no OAuth surface on the API. See §1.7.
2. **`POST /auth/totp/setup` has no role restriction.** It is `@Authenticated()`
   only, so a `CUSTOMER` can enrol TOTP — but `login()` computes
   `totpRequired = roles.some(isStaffRole) && …`, so a customer's code is never
   asked for and never checked. Should the route say staff-only? Today enrolment
   is accepted and then silently inert.
3. **`DELETE /auth/totp` and live sessions.** Docs and behaviour agree —
   `refresh()` derives `totpVerified` from the account's _current_
   `totp_enabled_at` (`auth.service.ts:182`), so turning TOTP off downgrades every
   live staff token on its next refresh while the token in hand stays valid until
   it expires. Noted because the window is easy to miss in review.

## 1.6 S3 — Consider a grace period for the previous refresh token

**Context, not a defect.** `REFRESH_REUSE_DETECTED` revoking the whole session
family is correct and the frontend has adapted with single-flight refresh and
tests (`apps/web/src/lib/api/client.test.ts`). But on an unstable mobile network
two requests genuinely can race, and the penalty for losing is a full sign-out.

**Recommendation:** accept the immediately previous refresh token for a short
window (≈10 s) instead of treating it as a replay. This would remove a class of
unavoidable user-visible logouts rather than relying on every client to serialise
correctly.

## 1.7 S1 — Social authentication is absent

**Status:** no OAuth surface on the API. The sign-in and register forms show
Google and Facebook buttons that answer "Coming Soon" — accurate, but the
requirement is live.

**Required endpoints**

```
GET  /api/v1/auth/oauth/:provider/authorize
POST /api/v1/auth/oauth/:provider/callback
```

- `:provider` ∈ `google`, `facebook`, `apple`.
- `authorize` returns the provider authorization URL using PKCE
  (`code_challenge`), with the state encrypted into a cookie.
- `callback` takes the authorization code and state, exchanges it with the
  provider, verifies the token signature, and normalises the profile to
  `email`, `firstName`, `lastName`, `avatarUrl`.

**Database**

```
federated_identities
  id             uuid primary key
  user_id        uuid → users.id on delete cascade
  provider       enum('GOOGLE','FACEBOOK','APPLE')
  provider_user_id text, indexed, unique per provider
  created_at / updated_at timestamptz
```

**Account linking.** If a user already exists with the verified email, link the
provider account automatically — or require one-time password verification, your
call, but it must be decided and documented. A merge that can silently attach a
Google login to an existing account is an account-takeover vector.

**Onboarding.** New users need to choose `CUSTOMER` or `PROVIDER`; carry that
through the OAuth `state` parameter rather than asking again afterwards.

Note `avatarUrl` would be the **first** user-supplied image in the entire
contract. It is also untrusted third-party content: store it, but never render it
without size limits and an allow-listed host.

## 1.8 Verified working — no action needed

Confirmed against the running API through the web app's own origin, so the
rewrite and the httpOnly cookie were both in play.

| Behaviour                              | Result                                                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `register` → duplicate                 | `409 CONFLICT`, message names phone or email                                                            |
| `register` → session                   | none, `requiresOtp: true` only — correct                                                                |
| `otp/verify` wrong code                | `422` with "N attempt(s) remaining"                                                                     |
| `otp/verify` 5th wrong                 | `423 OTP_LOCKED`, stays locked                                                                          |
| `otp/request` cooldown                 | `429 RATE_LIMITED` at 60s                                                                               |
| `password/forgot`                      | `{sent:true}` for known **and** unknown accounts — correctly non-disclosing                             |
| `password/reset`                       | wrong code `422`, success `201` + session, code reuse `422`, old password `401`, other sessions revoked |
| `refresh` rotation                     | cookie rotates; replaying the old cookie → `401 REFRESH_REUSE_DETECTED`                                 |
| logout                                 | `204`, clears cookie, refresh afterwards `401`; also `204` with no cookie                               |
| staff login, no / wrong / correct code | `401 TOTP_REQUIRED` · `422 TOTP_INVALID` · `201` with `totp` claim `true`, `/admin/settings` `200`      |

### Client obligation this depends on

`REFRESH_REUSE_DETECTED` revoking the whole session family is correct, but it
means **a client that fires two refreshes concurrently signs the user out
permanently.** The web app serialises refresh into a single in-flight operation
with a short reuse window and remembers a _refused_ refresh for the life of the
document; there are tests pinning all three behaviours
(`apps/web/src/lib/api/client.test.ts`). If that constraint is ever to be
relaxed, please tell us rather than changing it silently - every browser client
has it.

## 1.9 S1 - Please confirm the refresh cookie survives the proxy: a real sign-in that reads as signed out

**Reported from the running app, not from reading the code.** Symptom: a staff
account signs in successfully, lands in the workspace, and the site chrome keeps
offering **Sign in** - including after a full browser reload, when the only thing
that can possibly tell the frontend who this is, is the refresh cookie.

**Why this lands on the backend team and not the frontend.** The access token is
held in a module variable in the browser (`apps/web/src/lib/api/access-token.ts`)
and is gone on reload by design. `GET /auth/me` is therefore the _only_ source of
truth after a reload, and the app can only reach a session through
`POST /auth/refresh` carrying the httpOnly `shm_rt` cookie. If any of the
following is true, the frontend has no way to distinguish "signed in" from
"signed out" and will render the signed-out chrome no matter how it is written:

1. the signing-in response does not carry `Set-Cookie: shm_rt`, or carries it with
   a `Path`/`Domain`/`SameSite` the browser will not replay to `/api/v1/auth/*`;
2. the rewrite in `apps/web/next.config.ts` (`/api/v1/:path*` to the API process)
   strips or rewrites `Set-Cookie` on the way back;
3. `POST /auth/refresh` rotates the cookie but does not send the replacement, so
   the second navigation in a session finds nothing;
4. `GET /auth/me` answers `401` for a request that carries a valid, unexpired
   refresh cookie.

**How to settle it in under a minute** (against the web origin, so the rewrite
and the cookie are both in play):

```bash
# 1. sign in, keep the cookie jar
curl -i -c jar.txt -X POST http://localhost:3001/api/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"identifier":"<staff>","password":"<password>","totpCode":"123456"}'

# 2. the header must exist in the jar, with Path=/api/v1/auth
grep shm_rt jar.txt

# 3. a brand new document: no bearer token, cookie only
curl -i -b jar.txt http://localhost:3001/api/v1/auth/me      # must be 200

# 4. and it must still work after one rotation
curl -i -c jar.txt -b jar.txt -X POST http://localhost:3001/api/v1/auth/refresh
curl -i -b jar.txt http://localhost:3001/api/v1/auth/me      # must still be 200
```

If step 2 shows a cookie that is not replayed, or steps 3 or 4 answer `401`, the
fix belongs here. Our own §1.8 table was produced with a signed-in bearer token
for `/auth/me`, so it would not have caught any of the four cases above - which is
why this is filed rather than assumed correct.

**What the frontend changed anyway, and what it is not.** Two changes were made so
the site no longer _asserts_ the wrong thing:

- the header renders a neutral placeholder while `/auth/me` is in flight instead
  of a Sign in link, so the state a signed-in person used to see on every full
  page load is no longer shown;
- the session query revalidates when the tab regains focus, so a session that
  ended or began in another tab is picked up rather than cached for a minute.

Neither of those is a fix. If `GET /auth/me` cannot answer from the cookie alone,
the correct outcome is that the API is fixed; please say which of the four cases
above you find.

### Not a backend gap, but worth stating

The two-factor enrolment screen (`/en/auth/totp`) is the tallest card in the
authentication set. Two things were wrong with it and both were layout, not API:

- Stacked, it measured **927px** inside the **607px** frame that sign-in,
  register and forgot all fill exactly, and that frame is `overflow: hidden` — so
  the confirm button fell off the bottom of the page with no way to reach it.
  From `lg` the two steps now sit side by side, QR left and code entry right, and
  the card measures 607px with no scrolling from 1280x720 up.
- "Can't scan the code?" was a `<details>` that expanded **in place**. Opening it
  pushed the card back past the frame again and clipped the footer, and it
  squeezed a 32-character key into a column too narrow to read. The key now opens
  a dialog, so the card is the same 607px whichever way the step is answered.

**No API change.** The only TOTP item still open against the API is §1.5
question 2: `POST /auth/totp/setup` is `@Authenticated()` with no role
restriction, so a `CUSTOMER` can enrol a code that is then never asked for.

---

# Module 2 — Search, Catalogue & Public

All ten endpoints are `@Public()`: no bearer token required, and a signed-out
visitor is never redirected to sign-in. All ten are integrated in the web app.

## 2.1 Verified contracts

Base `/api/v1`. Every row was captured from the running API against the seeded
database — not read off the endpoint name.

| Endpoint                                       | Query                                              | Success                                                                                              | Errors (verified)                                   |
| ---------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `GET /catalogue/categories`                    | —                                                  | `{items:[{id,slug,nameEn,nameUr,sortOrder,defaultWarrantyDays,isActive}]}`                           | —                                                   |
| `GET /catalogue/categories/:slug/services`     | —                                                  | `{items:[ServiceRow]}`                                                                               | 404 unknown category                                |
| `GET /catalogue/services/:slug`                | —                                                  | `ServiceRow & {checklist:[…]}`                                                                       | 404 unknown slug                                    |
| `GET /places/cities`                           | —                                                  | `{items:[{id,name,timezone}]}`                                                                       | —                                                   |
| `GET /places/cities/:cityId/areas`             | —                                                  | `{items:[{id,cityId,name}]}`                                                                         | 400 non-numeric id, 404 unknown city                |
| `GET /search/providers`                        | `serviceSlug`, `lat`, `lng` — **`.strict()`**      | `{items:[…9 fields]}`                                                                                | 404 unknown service slug, 422 any extra key         |
| `GET /search/providers/:providerId`            | —                                                  | `{providerId,status,bio,experienceYears,qualification,cityId,radiusM,services[],areas[],reputation}` | 400 malformed uuid, 404 unknown **or not approved** |
| `GET /search/providers/:providerId/reputation` | —                                                  | `{score,ratingCount,distribution,verifiedJobs,badge}`                                                | 400 / 404                                           |
| `GET /search/providers/:providerId/remarks`    | `limit` 1–100, default 20                          | `{items:[{id,displayName,body,score,createdAt,reply}]}`                                              | 400 / 404 / 422 out-of-range limit                  |
| `GET /search/providers/:providerId/slots`      | `serviceId`, `date` `YYYY-MM-DD` — **`.strict()`** | `{date,durationMin,items:[{start,end}]}` ISO instants                                                | 400 / 404 provider does not offer that service, 422 |

`ServiceRow` = `{id,categoryId,slug,nameEn,nameUr,description,pricingModel,
timeUnit,basePricePaisa,minPricePaisa,maxPricePaisa,visitFeePaisa,
expectedDurationMin,isEmergencyEligible,isPlanEligible,warrantyDays,isHighRisk,
isActive}`. Money is integer paisa throughout.

`ProviderSearchResult` = `{providerId,bio,experienceYears,qualification,
pricePaisa,distanceM,ratingScore,ratingCount,badge}` — nine fields, no more.

### Contract limits that shape the UI

1. **No paging, sorting or free text on search.** `providerSearchQuerySchema` is
   `.strict()` with three keys; `&page=2` returns **422**. The UI therefore shows
   the API's ranking with no pager and says so in a note.
2. **Ranking is weighted rating + distance** (`search.service.ts:125`,
   `ranking.weights` default 0.35 / 0.25).
3. **Remarks have `limit` only** — no offset or cursor, so no "load more".
4. **Slots are UTC instants for a local Asia/Karachi day.** A day beginning
   `2026-10-04T19:00Z` is midnight on the 5th locally. Every slot label is
   formatted in `Asia/Karachi`, never the browser's zone.

## 2.2 S1 — `areas.centroid` not selected

**File:** `apps/api/src/places/places.service.ts:20`

```ts
SELECT id, city_id as "cityId", name FROM areas WHERE city_id = $1 AND is_active = true
```

`areas.centroid` is a `geography(Point, 4326)` column in `0001_init.sql`. It is
simply not in the projection, `AreaRow` has no latitude or longitude, and `cities`
has no centre point either.

**Consequence.** `GET /search/providers` requires `lat` and `lng`, so an area —
the only location filter a customer actually thinks in — cannot become a query.
The frontend can offer "use my location" or an approximate city centre, and the
area control ships **disabled with the reason visible on screen**, because
pretending it filters would be a lie.

**Fix — one line:**

```ts
SELECT id, city_id as "cityId", name,
       ST_Y(centroid) as "lat", ST_X(centroid) as "lng"
  FROM areas WHERE city_id = $1 AND is_active = true ORDER BY name
```

Adding a centre point to `CityRow` the same way removes the frontend's hard-coded
Lahore coordinate entirely. **Highest-value fix in this document.**

## 2.3 S2 — `reputation.score` is a prior, not a rating

**File:** `apps/api/src/reputation/reputation.service.ts:70`

```ts
score: weightedScoreHundredths(hundredths, prior, priorWeight, recentWeight) / 100;
```

With no ratings the numerator and denominator both collapse to the prior terms,
so the score is exactly `rating.bayesian_prior` — **3.5** with the shipped
settings. The `Reputation` type declares `score: number`; it is never null.

The Swagger description on the same field says _"Null until there is at least one
rating and no prior"_, which the code does not do. Anything written against that
sentence renders **"3.5 out of 5"** for a professional nobody has rated.

Confirmed live for the seeded provider, who has zero ratings:

```json
{ "score": 3.5, "ratingCount": 0, "distribution": { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 }, "verifiedJobs": 0, "badge": null }
```

`ProviderSearchResult.ratingScore` has the same shape — `3.5` alongside
`"ratingCount":0`.

**Fix — either is acceptable, but the docs must match the code:**

- return `score: number | null` and `null` when `ratingCount === 0`; or
- keep the number and correct the comment, stating plainly that it is a ranking
  input that must not be displayed as a rating.

The frontend gates on `ratingCount` today and is safe either way — but the doc is
a live trap for the next consumer.

## 2.4 S2 — `remark.reply` is an object

**File:** `apps/api/src/reputation/reputation.service.ts:136`

```ts
reply: row.replyBody === null ? null : { body: row.replyBody, createdAt: row.repliedAt };
```

The Swagger text — _"each with the provider's reply if they gave one"_ — reads as
a string. Typed as `string | null` and rendered directly, this **throws in React**:
an object is not a valid child.

This cost the frontend a crash before it was caught. Worth an explicit
`reply: { body, createdAt } | null` in the response type or OpenAPI schema.

## 2.5 S3 — No cheap anonymous-session answer

Every page mounts the session provider, which asks `GET /auth/me`. For a
signed-out visitor:

1. `GET /auth/me` → **401 `UNAUTHENTICATED`**
2. the client treats that as a possibly-expired token and attempts
   `POST /auth/refresh` to rebuild the session from the httpOnly cookie —
   necessary, it is the only way a reload restores a session
3. → **401**

Both are logged by the browser as console errors on every page for every
signed-out visitor. They are not JavaScript faults — the API is answering
correctly and the client recovers correctly — but "0 console errors" is not
achievable on a public page until the API can answer the question cheaply.

**Fix, smallest:** let `GET /auth/me` answer `200 { "user": null }` for an
anonymous caller. Nothing in the authenticated flow depends on the 401, which is
already handled as `UNAUTHENTICATED`.

**Fix, explicit:** add a public `GET /auth/session` → `{ authenticated: boolean }`
so public pages can skip `/auth/me` entirely.

**Meanwhile the frontend** remembers a refused refresh for the life of the
document, so repeated 401s cost one refresh rather than one each — see
`client.ts` and `client.test.ts` ("asks for a refresh once per document after one
is refused"). That reduced the cost per document but cannot remove the initial
probe.

## 2.6 S2 — Unknown service slug is a 404

**File:** `apps/api/src/search/search.service.ts:98` — `throw notFound('Service')`.

A typo in `serviceSlug` and a service that genuinely has no approved provider in
range produce different responses (404 vs `{items:[]}`). Workable, but a client
cannot tell a misspelling from a withdrawn service. Returning `{items:[]}` with a
hint, or a distinct code, would be friendlier. The frontend renders 404 as a real
not-found state.

## 2.7 Correct by design — do not "fix"

| Behaviour                                                                                                                    | Where                                               | Why it is right                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| A provider who is not approved answers **404**, same as one that does not exist                                              | `search.service.ts:143`, `reputation.service.ts:80` | The public API does not confirm that a suspended person exists. The frontend renders not-found, never "unavailable".              |
| Slots are half-hourly starts inside declared hours, clear of leave and bookings plus the travel buffer, at least an hour out | `search.service.ts:48`                              | Availability is current information, not a reservation. The panel says so on screen.                                              |
| A slot can still be lost between listing and checkout → **409 `SLOT_TAKEN`**                                                 | `booking.service.ts`                                | The database exclusion constraint is the final word. The UI must never present a slot as reserved.                                |
| Slot instants are **UTC**, the day is **Asia/Karachi**                                                                       | `search.service.ts:85`                              | Midnight local is `19:00Z` the previous day. Formatting in the browser's zone shows the wrong day outside Pakistan.               |
| `/search/providers` ranks by weighted rating **and** distance                                                                | `search.service.ts:125`                             | The **controller's OpenAPI description is stale** — it still claims distance only. The frontend avoids claiming a specific order. |

## 2.8 Not a backend gap — the booking hand-off

`POST /bookings` already accepts everything this module would need to carry a
chosen slot through:

```json
{
  "providerId": "…uuid…",
  "serviceId": 1,
  "addressId": "…uuid…",
  "scheduledStart": "2026-10-01T10:00:00.000Z",
  "scheduledEnd": "2026-10-01T11:00:00.000Z",
  "problemText": "Kitchen tap is leaking",
  "paymentMode": "ONLINE"
}
```

`POST /bookings/quote` prices the same shape first. Both require a **customer**
session. The backend side of the hand-off is therefore complete.

The gap is entirely in the web app: `/[locale]/book/[slug]` is still the previous
mock-data flow and accepts only a service slug. That is the booking module's job.
This module links to `/book/{serviceSlug}` — a real working entry point — and says
on screen that the professional and time are chosen inside the booking flow.

---

# Module 3 — Booking

Wired by the frontend. `POST /bookings/quote`, `POST /bookings`, `GET /bookings`,
`GET /bookings/:id`, `/cancel`, `/reschedule`, `/revisions/approve`, `/revisions/reject`,
`/warranty-claim`, `/no-show`, `/evidence` and `/messages` are all called, plus
`GET`/`POST /customer/addresses` as a booking dependency.

**The module works.** The items below are gaps in what the API _publishes_ or
contradictions between the docs and the code — not reasons the feature is blocked.
Two of them (§3.4, §3.5) the frontend has worked around in a way you should know
about, because in both cases the workaround is visible to a customer.

## 3.1 S2 — `GET /bookings` publishes no readable names

**File:** `apps/api/src/booking/booking.row.ts:40` — `BOOKING_COLUMNS`

```sql
id, code, customer_id, provider_id, service_id, address_id, status, payment_mode,
scheduled_start, scheduled_end, problem_text, quoted_amount_paisa,
approved_total_paisa, final_amount_paisa, discount_paisa, payment_status,
is_emergency, is_auto_assign, completed_at, verification_tier, reschedule_count,
no_show_party, cancel_reason, start_otp_verified_at, created_at, updated_at
```

Ids and money. **No service name, no provider name, no address text.** Every
identifier the customer would recognise is missing.

**Consequence.** A booking list cannot show "Leak repair" from its own response.
The frontend joins `serviceId` against `GET /catalogue/categories/:slug/services`
— a real fan-out across the published categories, because there is no all-services
endpoint — and shows an honest placeholder for any service the catalogue no longer
publishes. On the **detail** page there is no way to show the address at all: the
customer cannot see where they asked someone to go.

**Fix — add to `BOOKING_COLUMNS`:**

```sql
s.name_en as "serviceName", s.name_ur as "serviceNameUr", s.slug as "serviceSlug",
p.qualification as "providerQualification",
a.label as "addressLabel", a.line1 as "addressLine1", a.line2 as "addressLine2",
ar.name as "areaName"
  … FROM bookings b
  LEFT JOIN services s ON s.id = b.service_id
  LEFT JOIN providers p ON p.user_id = b.provider_id
  LEFT JOIN addresses a ON a.id = b.address_id
  LEFT JOIN areas ar ON ar.id = a.area_id
```

Names rather than ids is the point: the public search contract deliberately omits
`users.first_name` (§2.2 of the module-2 notes), so `qualification` keeps this
consistent with what the rest of the product may show.

## 3.2 S2 — The `status` filter omits most of the enum

**File:** `apps/api/src/booking/booking.schemas.ts:84`

```ts
status: z.enum(['REQUESTED', 'SCHEDULED', 'EN_ROUTE', 'IN_PROGRESS', 'QUOTE_REVISION', 'WORK_COMPLETED', 'UNFULFILLED', 'CANCELLED_CUSTOMER', 'CANCELLED_PROVIDER', 'NO_SHOW']).optional();
```

Ten values. `booking_status` in the Prisma schema has **twenty-two**. So
`GET /bookings?status=VERIFIED` — a booking that demonstrably exists, since
`GET /bookings/:id` returns it — is a **422**.

The frontend works around this by offering only filters drawn from that list, so
a customer cannot ask for "verified jobs" or "refunded jobs". On a busy account
those are exactly the ones people want.

**Fix:** derive the enum from the database rather than restating it, e.g.
`z.enum(BOOKING_STATUS_VALUES)` with a test asserting the two stay equal. The
same enum also appears in `packages/domain/src/bookingTransitions.ts` as
`BookingStatus`, which is already complete.

## 3.3 S2 — `POST /bookings/:id/quote` does not exist

`docs/integrated.md` listed `POST /bookings/:id/quote` against the provider job
page, so the frontend team went looking for it. **`BookingController` has no such
route.** The nearest things are:

| What you probably meant             | Route                                              |
| ----------------------------------- | -------------------------------------------------- |
| the provider proposing extra work   | `POST /bookings/:id/revisions`                     |
| the customer answering it           | `POST /bookings/:id/revisions/approve` · `/reject` |
| pricing a booking before committing | `POST /bookings/quote`                             |

**Action:** correct the module-5 table. No code change needed — the frontend
builds against the controller, not the document, so nothing is blocked.

## 3.4 S2 — FR-BK-06 cancellation fee is not applied

**File:** `apps/api/src/booking/booking.controller.ts:252`

> "The cancellation-fee rules (FR-BK-06) are not applied here yet — there is no
> ledger to post a fee to until M8 exists; this only records the cancellation and
> the optional reason."

That is accurate and the controller says so plainly. It is raised here because
**the requirement is user-visible and the API gives a customer no way to learn
it.** `booking.free_cancel_hours` and `booking.late_cancel_fee_paisa` exist as
settings, and `PricingService.cancellationPolicy()` renders them into a sentence
— but only on `POST /bookings/quote`. After a booking exists there is no endpoint
that returns the policy, and `cancelReason` is free text, so a cancellation record
does not say whether a fee was due.

**What the frontend does, and you should check you agree with it:** the cancel
card says _"No cancellation fee is charged — the platform does not apply one yet,
so we will not quote you a figure that is never collected."_ No fee is shown
anywhere. If that is wrong, the fix is server-side and the copy has to change with
it.

**Confirmed live, and it is worse than "not implemented".** The two halves of the
feature disagree with each other:

```
POST /bookings/quote   →  cancellationPolicy:
   "Free cancellation up to 4 hours before your slot.
    After that a cancellation fee of PKR 500.00 applies. …"

POST /bookings/:id/cancel  →  200, status CANCELLED_CUSTOMER, no fee
POST /bookings/quote (again)  →  outstandingReceivablePaisa: 0
SELECT count(*) FROM ledger_entries  →  0
```

A customer is **promised** a Rs 500 fee in the quote they confirm against, and is
then not charged it. `PricingService.cancellationPolicy()` builds that sentence
from `booking.free_cancel_hours` and `booking.late_cancel_fee_paisa` without
knowing whether the fee is enforced anywhere.

The frontend's wording is the honest one, but it now **contradicts a sentence the
customer has already read**. That is a support burden and a trust problem, not
just a missing feature.

**Fix — the smallest correct change:**

1. Either apply the fee in `apply(id, 'cancel', …)` and post it to the ledger, or
2. stop promising it: have `cancellationPolicy()` reflect the rules that actually
   run, so the quote and the cancellation agree.

If (2), `cancellationPolicy` should be built from a single source that the cancel
path also consults, so the two cannot drift again.

**Then, separately:** return `cancellationPolicy` and any `cancellationFeePaisa`
from `GET /bookings/:id`, so the detail page can state the rule for _this_ booking
at the moment the customer is deciding — rather than only during checkout.

## 3.5 S2 — Auto-assign cannot show availability before a taker exists

`POST /bookings` treats a missing `providerId` as auto-assign (FR-SR-07), and
`offer.service.ts` fixes `provider_id` only when somebody accepts. But
availability is only readable through `/search/providers/:providerId/slots`, which
needs a provider.

**So for an auto-assigned booking there is no honest way to show a free slot**, and
`POST /bookings` still requires `scheduledStart` and `scheduledEnd`. The customer
picks a preferred window and the platform offers the job to ranked professionals
in turn; `assertWindowIsBookable` is skipped for `providerId === undefined`, so the
requested time is not validated against anybody's calendar until a provider accepts
— and if that provider is busy then, the acceptance fails.

**What the frontend does:** on the auto-assign path it shows **requested** windows
labelled as requested, with the sentence _"These are the times we can offer. None
is held until a professional accepts your request."_ It never renders a slot as
confirmed. On the chosen-professional path it uses `/slots` as normal.

**Ask:** should an auto-assign booking show times at all, or should the flow ask
for a date and a window and confirm the exact start on acceptance? The copy above
assumes the latter is acceptable.

**Fix, if you want the former:** an availability endpoint that does not name a
provider — e.g. `GET /bookings/availability?serviceId=&date=` returning the union
of free windows across eligible providers.

## 3.6 S3 — No endpoint returns a booking's invoice line items

`create()` writes `booking_items` from the quote's `lines` (§3.1 of the pricing
code) and `complete()` generates an itemised invoice, but **no route reads them
back**. The only way to see what a booking was priced for is
`GET /bookings/:id/invoice.pdf`, which 404s until the job is completed.

**Consequence.** The booking detail page shows `quotedAmountPaisa`,
`approvedTotalPaisa`, `discountPaisa` and `finalAmountPaisa` — four numbers — and
cannot show what they are _for_. The line-item breakdown exists in the customer's
own confirmation screen only because the frontend kept the `POST /bookings/quote`
response in component state for that one render.

**Fix:** return the items on `GET /bookings/:id`, e.g.
`{ …booking, items: [{ kind, description, quantity, unitPricePaisa, amountPaisa }] }`.
The rows already exist.

## 3.7 S2 — The payment return URL is fixed, locale-less, and names no route

**File:** `apps/api/src/booking/booking.service.ts:134`

```ts
const payment = await this.payments.startCheckout(created.paymentId, { userId: customerId }, `/checkout/return?bookingId=${booking.id}`);
```

Three problems, all confirmed live:

```
POST /bookings (ONLINE) → 201
  payment.redirectUrl = /api/v1/dev/payments/<id>?returnUrl=%2Fcheckout%2Freturn%3FbookingId%3D<uuid>
```

1. **The `returnUrl` is hardcoded, so it cannot match the frontend's routing.**
   Every other path in this app is locale-prefixed (`/[locale]/…`) and
   `src/proxy.ts` rewrites a locale-less path to `/en`. Before the frontend added
   `app/[locale]/checkout/return`, this URL was a **404** — an online customer who
   paid landed on nothing at all. The route now exists, so the ONLINE flow
   completes.
2. **A locale-less URL means a locale-less return.** A customer who paid in Urdu
   comes back in English, because `/checkout/return` carries no `locale` and the
   proxy defaults it to `/en`. The locale is not recoverable from the URL as the
   API builds it. The frontend remembers the locale across the redirect, so this
   is cosmetic — but only because the frontend works around it.
3. **`GET /bookings/:id` is the only way to know the payment worked.** The return
   page cannot observe the gateway's webhook, so it must not announce success; it
   forwards to the booking, which re-reads the real status.

**Ask:** make the return URL absolute and configurable, and locale-aware, e.g.
`checkouUrl: { returnUrl, cancelUrl }` returned in the create response rather than
hardcoded server-side. That also lets a deployment point at the right origin
instead of assuming a relative path.

**Also worth knowing (not a defect):** an online booking is `PENDING_PAYMENT` with
`paymentStatus: "PENDING"` until the webhook lands. A `201` from `POST /bookings`
means _held_, not _booked_, and the frontend says exactly that on the confirmation
screen. Verified: `status=PENDING_PAYMENT`, `paymentStatus=PENDING`, `redirectUrl`
present.

## 3.8 S3 — `addressCreateSchema` requires a point nobody can supply

**File:** `apps/api/src/customer/customer.schemas.ts:8`

`lat` and `lng` are **required** on create, and there is no geocoding endpoint.
Meanwhile `areas.centroid` exists in the database and is not selected by the
places API (§2.2), so an area cannot become a point either.

**What the frontend does:** the inline address form offers exactly two sources,
both labelled on screen — the browser's own geolocation, or the city-centre
approximation already used by provider search. The copy says plainly: _"There is
no address lookup on the platform yet… we will not claim either one is your exact
address."_ A customer in a new area therefore cannot enter a precise address at
all, and the professional list is searched around an approximate point.

**This is the same root cause as §2.2.** Selecting `areas.centroid` fixes both.

## 3.9 Verified working — no action needed

Confirmed against the running API through the web app's own origin.

**All of the following was executed, not inferred**, against the seeded database
with `customer@smart-home.local`. The seeded fixtures are: 6 active categories,
16 services, 24 areas, 1 city (Lahore), 1 approved professional
(`00000000-0000-4000-8000-000000000098`), and 1 saved address ("Home", Gulberg,
`31.5204, 74.3587`).

| Behaviour                                   | Result                                                                                                                              |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| login as the seeded customer                | 200, roles `[CUSTOMER]`, `totpRequired: false`                                                                                      |
| quote, no provider (auto-assign)            | 200, `totalPaisa: 250000` — the **service base price**                                                                              |
| quote, chosen provider                      | 200, `quotedAmountPaisa: 100000` — **that professional's rate**, not the catalogue's `250000`                                       |
| `GET /customer/addresses`                   | 200, 1 item, and it carries a real `lat`/`lng`                                                                                      |
| `GET /places/cities/:id/areas`              | 200, 24 items, **no `lat`/`lng`** — §2.2 confirmed again                                                                            |
| `GET /search/providers`                     | 200, 1 result, `ratingScore: 3.5` with `ratingCount: 0` — §2.3 confirmed again                                                      |
| `GET …/slots?serviceId=1&date=2026-10-06`   | 200, 45 slots, `durationMin: 90`; the first start is `2026-10-05T19:00Z` for local date **the 6th** — the Asia/Karachi day boundary |
| create, CASH, chosen provider               | 201, `code: SHM-0000001`, `status: REQUESTED`, **no `payment`**                                                                     |
| create, ONLINE, chosen provider             | 201, `status: PENDING_PAYMENT`, `paymentStatus: PENDING`, `redirectUrl` present                                                     |
| create, auto-assign                         | 201, `isAutoAssign: true`, `providerId: null`, `quotedAmountPaisa: 250000` (base)                                                   |
| create, **the same slot again**             | **409 `SLOT_TAKEN`** — "That provider is no longer free at this time"                                                               |
| create, unknown `addressId`                 | 404 `Address was not found`                                                                                                         |
| create, `scheduledStart` in the past        | 400 "The booking must start in the future"                                                                                          |
| create, one unrecognised body key           | 422 `VALIDATION_FAILED` — `.strict()` confirmed                                                                                     |
| reschedule from `REQUESTED`                 | 409 `ILLEGAL_TRANSITION` "Cannot reschedule a booking in status REQUESTED"                                                          |
| cancel with body `{}`                       | 200, `CANCELLED_CUSTOMER` — the empty-body case is accepted                                                                         |
| quote, emergency on an ineligible service   | 400 "This service is not available as an emergency booking"                                                                         |
| quote, unknown coupon                       | 400 "That coupon code is not valid" — reported, never a silent zero                                                                 |
| `GET /bookings`                             | 200, `{items:[…]}`, everything in one response, no paging                                                                           |
| `GET /bookings?status=SCHEDULED`            | 200                                                                                                                                 |
| **`GET /bookings?status=VERIFIED`**         | **422 `VALIDATION_FAILED`** — §3.2 confirmed                                                                                        |
| `GET /bookings/:id` not yours               | 404 "Booking was not found" — identical to a booking that does not exist                                                            |
| `GET /bookings/:id` malformed uuid          | 400 "uuid is expected"                                                                                                              |
| `GET /bookings/:id/messages` at `REQUESTED` | 200, **`open: false`** — the chat is shut before a professional accepts, exactly as `canMessage` assumes                            |
| `GET /bookings/:id` row keys                | the 27 columns of `BOOKING_COLUMNS`, matching the frontend type field for field; `finalAmountPaisa` is `null`, not `0`              |
| cancel, then re-quote                       | `outstandingReceivablePaisa: 0`, `ledger_entries: 0` — **no fee charged**, see §3.4                                                 |

### Client obligations these depend on

- **No local pricing.** The review step renders `POST /bookings/quote` verbatim.
  If quote and create ever diverge, the cause is server-side.
- **`providerId` is omitted, never sent as null or `""`.** Its absence is the only
  signal for auto-assign; anything else is a 422 or a job assigned to a
  professional who never agreed to it.
- **The quote is a mutation, not a cached query.** It is priced against the
  signed-in customer's outstanding balance, so a remembered quote is a quote for a
  basket that no longer exists.
- **The chat is never served from cache.** Reading it marks the other side's
  messages as read.
- **`getOwned` 404 is rendered as "not found".** The page never says a booking
  exists but belongs to somebody else.

---

# Module 5 — Notifications

The frontend has no visibility into delivery, so these are requirements carried
forward from the authentication phase rather than defects found against live
behaviour.

## 3.1 SMS gateway routing and failover

Registration and OTP login both use Pakistani numbers (`+92 3XX XXXXXXX`).

- Route SMS through an approved local gateway (Telenor / Jazz / a Twilio Pakistan
  route).
- Support **sender ID masking** — `SMART-HOME`. An earlier draft of this document
  offered a second sender ID; the brand is Smart Home Maintenance, so there is
  only that one.
- Normalise to international **E.164** before sending. This is already load-bearing:
  `MockSmsSender` throws on a non-E.164 recipient, and that plain `Error` is what
  turns an email OTP into a 500 (§1.1).
- Fall back to **WhatsApp Business** when SMS has not delivered within ~30 s.

## 5.2 Localized notification templates

- Transactional messages must honour the user's `locale` (`en` / `ur`).
- Localised strings are required at minimum for: OTP verification, password-reset
  tokens, and security alerts.

---

# Module 6 — Verification & onboarding

## 6.1 Provider document upload trigger

> **RESOLVED — 6 Oct 2026.** This section previously said no provider-document
> endpoint existed. That was true when it was written and is no longer: the
> backend added `GET`/`POST /provider/documents` plus `POST /uploads/presign`,
> and `docs-final/API_HANDOFF.md` §"Provider onboarding" now documents the flow.
> The frontend types it in `features/provider/api.ts` and
> `features/uploads/api.ts`. Kept below as the record of what was asked.

- Registering with `role: "PROVIDER"` provisions the account with
  `requiresOtp: true`.
- **After OTP verification succeeds**, automatically initialise the `providers`
  row with status `PENDING_APPROVAL` and initiate the KYC document request
  (CNIC front/back, trade certificate, police verification).

Note the frontend already renders `status` as "Approved to take work" and treats
anything else as not-yet-public, so this transition needs no frontend change once
the backend performs it.

---

# What breaks in the frontend when each fix lands

So nobody merges a backend fix and breaks a page. Each row is a change the
frontend has already prepared for, or must be told about.

| If the backend changes…                                              | The frontend must…                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **§2.2** adds `lat`/`lng` to `AreaRow`                               | `features/places/api.ts` gains the fields; `features/search/location.ts` can stop hard-coding the Lahore centre; the area selector stops being disabled and **starts affecting the query** — so `dict.search.areaNotApplied` ("this cannot narrow the search") must be deleted, and `areaId` must be added to the search query key. `useCityAreas` stops needing the "cannot filter" caveat. |
| **§2.3** makes `score` nullable                                      | `Reputation.score` becomes `number \| null`; `profile-sections.tsx` and `provider-card.tsx` currently gate on `ratingCount`, so they keep working — but the `score === null` branch in the reputation section becomes meaningful rather than dead.                                                                                                                                           |
| **§2.4** renames or flattens `reply`                                 | `Remark.reply` in `features/search/api.ts` and the `remark.reply.body` read in `profile-sections.tsx` must change together.                                                                                                                                                                                                                                                                  |
| **§2.6** returns `{items:[]}` for an unknown service slug            | `service-detail.tsx` loses the 404 branch, and the catalogue explorer's unknown-category fallback needs rethinking — currently a 404 is a not-found state and an empty list is an empty state.                                                                                                                                                                                               |
| **§1.7** adds social sign-in                                         | The "Coming soon" buttons in `sign-in-form.tsx` / `register-form.tsx` become live, `authApi` gains two calls, and `session.tsx` must adopt the provider's profile shape. `callback` needs a route — currently there is none.                                                                                                                                                                 |
| **§1.1** fixes email OTP                                             | No frontend change. The inline error it produces today simply stops appearing.                                                                                                                                                                                                                                                                                                               |
| **§1.6** adds a refresh grace period                                 | None required, but `api-client.test.ts`'s "collapses simultaneous 401s onto a single refresh" becomes belt-and-braces rather than essential. Relaxing single-flight client-side before the server does would sign users out.                                                                                                                                                                 |
| **§2.5** adds `GET /auth/session`                                    | `session.tsx` can skip `/auth/me` on public pages; the `me` query moves behind a check.                                                                                                                                                                                                                                                                                                      |
| **§3.1** adds names to `BOOKING_COLUMNS`                             | `Booking` in `features/booking/api.ts` gains the fields; **`service-names.ts` and its catalogue fan-out can be deleted entirely**, which also removes `1 + N` requests from the bookings list and the detail page. Then re-run `booking-contract.test.ts` — its "carries exactly the fields `BOOKING_COLUMNS` selects" assertion is written to fail loudly on purpose.                       |
| **§3.1** adds an address to the booking row                          | `booking-detail.tsx` gains a real "where" line. Until then the page shows no address at all, which is a gap a customer will notice.                                                                                                                                                                                                                                                          |
| **§3.2** widens the `status` filter                                  | `BookingListStatus` in `features/booking/api.ts` widens to match, and `booking-list.tsx`'s `FILTERS` can offer "verified", "refunded" and so on. The hand-written enum must be deleted, not extended by hand.                                                                                                                                                                                |
| **§3.4** returns a cancellation policy or fee on `GET /bookings/:id` | The cancel card's copy changes: `dict.booking.cancelNote` currently says no fee is charged, which becomes false. **This is a copy change, not just a code change** — the sentence must be rewritten to state the rule as the API now applies it.                                                                                                                                             |
| **§3.5** adds a provider-agnostic availability endpoint              | The auto-assign path could show real availability instead of requested windows; `requestedWindows()` in `provider-choice.tsx` would go, and the screen would become one path rather than two.                                                                                                                                                                                                |
| **§3.6** returns `items` on `GET /bookings/:id`                      | The detail page can show the price breakdown after the fact rather than only during checkout.                                                                                                                                                                                                                                                                                                |
| **§3.8** geocodes addresses, or `areaId` implies a point             | The inline address form loses its two-source point picker; `features/search/location.ts` stops being needed there. Same root cause as §2.2.                                                                                                                                                                                                                                                  |
| **A real `GET /catalogue/services` list endpoint is added**          | `catalogueApi.listAllServices` stops fanning out and becomes one call. `useAllServices` loses its `N+1` shape. Text search and paging would then be server-side, so the client's `searchQuery` / `sortBy` / `pricingFilter` state moves into query params and the filtering moves out of `catalogue-explorer.tsx`. **Biggest single improvement available to this module.**                  |
| Anything adds a **new field** to a response row                      | Add it to the type in `features/{catalogue,places,search}/api.ts`. `src/tests/providers/search-contract.test.ts` asserts the exact field set on the search row and will fail loudly, which is the intent.                                                                                                                                                                                    |

## Conflicts already found and resolved in the frontend

Recorded because each was invisible to every gate:

1. **A hardcoded fallback dataset in the catalogue API layer.** `api.ts` caught
   every error and answered from `catalogue-data.ts`. An unknown slug was answered
   with a _different real service_ including its price, duration and warranty, so a
   customer could have booked a job that does not exist; and a total API outage
   rendered a healthy-looking catalogue, so nobody would know to look. Fixed by
   making the API layer thin and honest, and pinned by
   `src/tests/services/catalogue-api-honesty.test.ts`.
2. **`perUnit` was a dictionary key rendered as text.** `presentPrice` returns the
   key `"perHour"`, and the service page printed it literally — the page read
   "Rate · perHour". `PricePresentation.perUnit` is now a `PriceUnit` union and
   both call sites resolve it through `dict.catalogue`.
3. **A card overlay with no positioned ancestor.** `ProviderCard`'s article lacked
   `relative`, so the stretched title link covered the filter sidebar and
   swallowed clicks on it.
4. **An unknown category in the URL filtered to nothing.** `?category=<slug the
API does not publish>` produced "Showing 0 verified services" with no
   explanation, which reads as an empty catalogue. The catalogue explorer now
   discards an unrecognised slug and falls back to the whole catalogue.
5. **A mock `serviceId` in the booking flow.** `/book/[slug]` read the service
   from `src/lib/data.ts`, whose `id` fields are not database ids. The flow looked
   complete and would have sent `serviceId: 1` to `POST /bookings` — either
   booking the wrong service or failing a `.strict()` validation. Caught while
   writing the contract tests for module 3, before it could reach a customer.
6. **`void promise` is not a rejection handler.** Every booking action used
   `void mutation.mutateAsync(…)`, so each refused action — a 409 on a cancel that
   had already been cancelled — logged an unhandled rejection in the browser
   console. Every gate stayed green. The mutation's own `isError` was already
   rendered, so the fix is `.catch(reportFailure)`.
7. **A carried-in provider was silently discarded.** Choosing an address in the
   booking flow cleared `choice` unconditionally, which undid the hand-off from a
   profile's availability panel one click after it was made. Found by the
   hand-off test; the address handler now keeps a carried professional.
8. **`scrollIntoView` on a chat that may not exist.** `booking-chat.tsx` called it
   unconditionally. It is absent in jsdom and in some embedded webviews, and the
   resulting `TypeError` took the whole booking page down over a convenience.

### One API endpoint does not exist, and the client does not pretend otherwise

There is **no "all services" route** on the API — only `GET /catalogue/categories`,
`GET /catalogue/categories/:slug/services` and `GET /catalogue/services/:slug`.
The catalogue explorer needs the whole catalogue to offer search and filters, so
`catalogueApi.listAllServices` **fans out across the published category list**:
one real call per active category, using the real per-category endpoint.

This is a deliberate choice and worth knowing about:

- If **any** category call fails, the whole thing fails. A partial catalogue
  presented as a complete one is the same lie as substituting made-up rows, so it
  is not partially swallowed.
- It costs `1 + N` requests where N is the number of active categories (6 today).
  If this ever becomes hot, the right fix is **a real endpoint on the API** —
  `GET /catalogue/services?category=&q=&page=` — not a client-side cache. That
  would also be the natural home for the paging and text search that
  `/search/providers` lacks (§2.4), and it is the single change that would most
  improve this module.

---

# Priority order for the backend team

| #   | Sev    | Module | Item                                                                                                                                                                                                     |
| --- | ------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | **S1** | 1      | **Confirm the refresh cookie survives the proxy** - a successful staff sign-in renders signed-out chrome, and no frontend change can fix it if `GET /auth/me` cannot answer from the cookie alone (§1.9) |
| 1   | **S1** | 2      | Select `areas.centroid` — one line, turns the area filter from a disabled control into a real filter **and unblocks address creation (§3.8)**                                                            |
| 2   | **S2** | 2      | Reconcile `score` / `ratingScore` with their documentation — a live trap for every consumer                                                                                                              |
| 3   | **S2** | 2      | `remark.reply` in the response schema — a crash for any client that reads the docs literally                                                                                                             |
| 4   | **S2** | 3      | Add names to `BOOKING_COLUMNS` — service, provider, address (§3.1). Without it a booking list can only show ids, and a booking detail cannot show the address at all                                     |
| 5   | **S2** | 3      | **Reconcile the cancellation fee with itself** (§3.4) — the quote promises Rs 500 and the cancel charges nothing. Either apply it or stop promising it; today the two halves of one feature disagree     |
| 6   | **S2** | 3      | Make the payment `returnUrl` absolute, configurable and locale-aware (§3.7) — it is hardcoded to a path this app had to add a route to match                                                             |
| 7   | **S1** | 1      | Email OTP delivery — `isEmailTarget()` instead of `startsWith('@')`                                                                                                                                      |
| 8   | **S1** | 1      | Social authentication is entirely absent — endpoints, `federated_identities`, linking rule (§1.7)                                                                                                        |
| 9   | **S2** | 3      | Derive the `GET /bookings?status=` enum from the database (§3.2) — `?status=VERIFIED` is a live 422                                                                                                      |
| 10  | **S2** | 3      | Correct the module-5 docs: `POST /bookings/:id/quote` does not exist (§3.3)                                                                                                                              |
| 11  | **S3** | 3      | Return `items` on `GET /bookings/:id` — the rows exist, nothing reads them (§3.6)                                                                                                                        |
| 12  | **S3** | 3      | A provider-agnostic availability endpoint, so an auto-assign booking can show real times (§3.5)                                                                                                          |
| 13  | **S3** | 2      | A cheap anonymous-session answer, removing two console entries per public page load                                                                                                                      |
| 14  | **S3** | 5      | SMS gateway routing, sender-ID masking, WhatsApp failover (§5.1)                                                                                                                                         |
| 15  | **S2** | 1      | `/auth/me` should return `providerStatus`                                                                                                                                                                |
| 16  | **S3** | 1      | Login throttle should cover unknown identifiers                                                                                                                                                          |
| 17  | **S3** | 1      | Grace period for the previous refresh token (§1.6)                                                                                                                                                       |
| 18  | **S2** | 1      | Refresh/logout body schemas: wire or delete                                                                                                                                                              |
| 19  | —      | 5, 6   | Localized notification templates; provider KYC trigger (§5.2, §6.1)                                                                                                                                      |
| 20  | —      | 2      | Refresh the stale `/search/providers` OpenAPI description                                                                                                                                                |
| 21  | —      | 2      | Paging / sorting / text on `/search/providers`, once there are enough providers for it to matter                                                                                                         |
| 22  | —      | 2      | Provider first name and photo — the biggest change to how the public product looks                                                                                                                       |
