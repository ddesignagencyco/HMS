# Backend handoff — implemented modules

Raised by the frontend team while wiring `apps/web` to the live API.
Last updated: 2026-10-03 · API commit `08bf442` · Verified against local dev
(Postgres + Redis, seeded).

> **Scope.** Only `apps/web` was ever changed. Everything in this document is a
> report, not a patch. Nothing in `apps/api`, `packages/*` or the database was
> modified. Where the frontend worked around something, it says so.

**Severity:** **S1** broken feature · **S2** contract/doc mismatch · **S3** hardening.

## Contents

- [Module 1 — Authentication](#module-1--authentication)
  - [1.1 S1 — Email OTP delivery returns 500](#11-s1--email-otp-delivery-returns-500)
  - [1.2 S2 — `/auth/me` never returns `providerStatus`](#12-s2--authme-never-returns-providerstatus)
  - [1.3 S2 — `refreshSchema` / `logoutSchema` unreachable](#13-s2--refreshschema--logoutschema-are-unreachable)
  - [1.4 S3 — Unknown identifiers escape the login throttle](#14-s3--unknown-identifiers-are-not-subject-to-the-login-throttle)
  - [1.5 Questions, not defects](#15-questions-not-defects)
  - [1.6 Verified working](#16-verified-working--no-action-needed)
- [Module 2 — Search, Catalogue & Public](#module-2--search-catalogue--public)
  - [2.1 Verified contracts](#21-verified-contracts)
  - [2.2 S1 — `areas.centroid` not selected](#22-s1--areascentroid-not-selected)
  - [2.3 S2 — `reputation.score` is a prior, not a rating](#23-s2--reputationscore-is-a-prior-not-a-rating)
  - [2.4 S2 — `remark.reply` is an object](#24-s2--remarkreply-is-an-object)
  - [2.5 S3 — No cheap anonymous-session answer](#25-s3--no-cheap-anonymous-session-answer)
  - [2.6 S2 — Unknown service slug is a 404](#26-s2--unknown-service-slug-is-a-404)
  - [2.7 Correct by design — do not "fix"](#27-correct-by-design--do-not-fix)
  - [2.8 Not a backend gap — the booking hand-off](#28-not-a-backend-gap--the-booking-hand-off)
- [Module 3 — Notifications](#module-3--notifications)
  - [3.1 SMS gateway routing and failover](#31-sms-gateway-routing-and-failover)
  - [3.2 Localized notification templates](#32-localized-notification-templates)
- [Module 4 — Verification & onboarding](#module-4--verification--onboarding)
  - [4.1 Provider document upload trigger](#41-provider-document-upload-trigger)
- [What breaks in the frontend when each fix lands](#what-breaks-in-the-frontend-when-each-fix-lands)
- [Priority order](#priority-order-for-the-backend-team)

---

# Module 1 — Authentication

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
   `refresh()` derives `totpVerified` from the account's *current*
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

| Behaviour | Result |
|---|---|
| `register` → duplicate | `409 CONFLICT`, message names phone or email |
| `register` → session | none, `requiresOtp: true` only — correct |
| `otp/verify` wrong code | `422` with "N attempt(s) remaining" |
| `otp/verify` 5th wrong | `423 OTP_LOCKED`, stays locked |
| `otp/request` cooldown | `429 RATE_LIMITED` at 60s |
| `password/forgot` | `{sent:true}` for known **and** unknown accounts — correctly non-disclosing |
| `password/reset` | wrong code `422`, success `201` + session, code reuse `422`, old password `401`, other sessions revoked |
| `refresh` rotation | cookie rotates; replaying the old cookie → `401 REFRESH_REUSE_DETECTED` |
| logout | `204`, clears cookie, refresh afterwards `401`; also `204` with no cookie |
| staff login, no / wrong / correct code | `401 TOTP_REQUIRED` · `422 TOTP_INVALID` · `201` with `totp` claim `true`, `/admin/settings` `200` |

### Client obligation this depends on

`REFRESH_REUSE_DETECTED` revoking the whole session family is correct, but it
means **a client that fires two refreshes concurrently signs the user out
permanently.** The web app serialises refresh into a single in-flight operation
with a short reuse window and remembers a *refused* refresh for the life of the
document; there are tests pinning all three behaviours
(`apps/web/src/lib/api/client.test.ts`). If that constraint is ever to be
relaxed, please tell us rather than changing it silently — every browser client
has it.

---

# Module 2 — Search, Catalogue & Public

All ten endpoints are `@Public()`: no bearer token required, and a signed-out
visitor is never redirected to sign-in. All ten are integrated in the web app.

## 2.1 Verified contracts

Base `/api/v1`. Every row was captured from the running API against the seeded
database — not read off the endpoint name.

| Endpoint | Query | Success | Errors (verified) |
|---|---|---|---|
| `GET /catalogue/categories` | — | `{items:[{id,slug,nameEn,nameUr,sortOrder,defaultWarrantyDays,isActive}]}` | — |
| `GET /catalogue/categories/:slug/services` | — | `{items:[ServiceRow]}` | 404 unknown category |
| `GET /catalogue/services/:slug` | — | `ServiceRow & {checklist:[…]}` | 404 unknown slug |
| `GET /places/cities` | — | `{items:[{id,name,timezone}]}` | — |
| `GET /places/cities/:cityId/areas` | — | `{items:[{id,cityId,name}]}` | 400 non-numeric id, 404 unknown city |
| `GET /search/providers` | `serviceSlug`, `lat`, `lng` — **`.strict()`** | `{items:[…9 fields]}` | 404 unknown service slug, 422 any extra key |
| `GET /search/providers/:providerId` | — | `{providerId,status,bio,experienceYears,qualification,cityId,radiusM,services[],areas[],reputation}` | 400 malformed uuid, 404 unknown **or not approved** |
| `GET /search/providers/:providerId/reputation` | — | `{score,ratingCount,distribution,verifiedJobs,badge}` | 400 / 404 |
| `GET /search/providers/:providerId/remarks` | `limit` 1–100, default 20 | `{items:[{id,displayName,body,score,createdAt,reply}]}` | 400 / 404 / 422 out-of-range limit |
| `GET /search/providers/:providerId/slots` | `serviceId`, `date` `YYYY-MM-DD` — **`.strict()`** | `{date,durationMin,items:[{start,end}]}` ISO instants | 400 / 404 provider does not offer that service, 422 |

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
score: weightedScoreHundredths(hundredths, prior, priorWeight, recentWeight) / 100
```

With no ratings the numerator and denominator both collapse to the prior terms,
so the score is exactly `rating.bayesian_prior` — **3.5** with the shipped
settings. The `Reputation` type declares `score: number`; it is never null.

The Swagger description on the same field says *"Null until there is at least one
rating and no prior"*, which the code does not do. Anything written against that
sentence renders **"3.5 out of 5"** for a professional nobody has rated.

Confirmed live for the seeded provider, who has zero ratings:

```json
{"score":3.5,"ratingCount":0,"distribution":{"1":0,"2":0,"3":0,"4":0,"5":0},"verifiedJobs":0,"badge":null}
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
reply: row.replyBody === null ? null : { body: row.replyBody, createdAt: row.repliedAt }
```

The Swagger text — *"each with the provider's reply if they gave one"* — reads as
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

| Behaviour | Where | Why it is right |
|---|---|---|
| A provider who is not approved answers **404**, same as one that does not exist | `search.service.ts:143`, `reputation.service.ts:80` | The public API does not confirm that a suspended person exists. The frontend renders not-found, never "unavailable". |
| Slots are half-hourly starts inside declared hours, clear of leave and bookings plus the travel buffer, at least an hour out | `search.service.ts:48` | Availability is current information, not a reservation. The panel says so on screen. |
| A slot can still be lost between listing and checkout → **409 `SLOT_TAKEN`** | `booking.service.ts` | The database exclusion constraint is the final word. The UI must never present a slot as reserved. |
| Slot instants are **UTC**, the day is **Asia/Karachi** | `search.service.ts:85` | Midnight local is `19:00Z` the previous day. Formatting in the browser's zone shows the wrong day outside Pakistan. |
| `/search/providers` ranks by weighted rating **and** distance | `search.service.ts:125` | The **controller's OpenAPI description is stale** — it still claims distance only. The frontend avoids claiming a specific order. |

## 2.8 Not a backend gap — the booking hand-off

`POST /bookings` already accepts everything this module would need to carry a
chosen slot through:

```json
{ "providerId": "…uuid…", "serviceId": 1, "addressId": "…uuid…",
  "scheduledStart": "2026-10-01T10:00:00.000Z",
  "scheduledEnd":   "2026-10-01T11:00:00.000Z",
  "problemText": "Kitchen tap is leaking", "paymentMode": "ONLINE" }
```

`POST /bookings/quote` prices the same shape first. Both require a **customer**
session. The backend side of the hand-off is therefore complete.

The gap is entirely in the web app: `/[locale]/book/[slug]` is still the previous
mock-data flow and accepts only a service slug. That is the booking module's job.
This module links to `/book/{serviceSlug}` — a real working entry point — and says
on screen that the professional and time are chosen inside the booking flow.

---

# Module 3 — Notifications

The frontend has no visibility into delivery, so these are requirements carried
forward from the authentication phase rather than defects found against live
behaviour.

## 3.1 SMS gateway routing and failover

Registration and OTP login both use Pakistani numbers (`+92 3XX XXXXXXX`).

- Route SMS through an approved local gateway (Telenor / Jazz / a Twilio Pakistan
  route).
- Support **sender ID masking** — `HUNAR` or `SMART-HOME`.
- Normalise to international **E.164** before sending. This is already load-bearing:
  `MockSmsSender` throws on a non-E.164 recipient, and that plain `Error` is what
  turns an email OTP into a 500 (§1.1).
- Fall back to **WhatsApp Business** when SMS has not delivered within ~30 s.

## 3.2 Localized notification templates

- Transactional messages must honour the user's `locale` (`en` / `ur`).
- Localised strings are required at minimum for: OTP verification, password-reset
  tokens, and security alerts.

---

# Module 4 — Verification & onboarding

## 4.1 Provider document upload trigger

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

| If the backend changes… | The frontend must… |
|---|---|
| **§2.2** adds `lat`/`lng` to `AreaRow` | `features/places/api.ts` gains the fields; `features/search/location.ts` can stop hard-coding the Lahore centre; the area selector stops being disabled and **starts affecting the query** — so `dict.search.areaNotApplied` ("this cannot narrow the search") must be deleted, and `areaId` must be added to the search query key. `useCityAreas` stops needing the "cannot filter" caveat. |
| **§2.3** makes `score` nullable | `Reputation.score` becomes `number \| null`; `profile-sections.tsx` and `provider-card.tsx` currently gate on `ratingCount`, so they keep working — but the `score === null` branch in the reputation section becomes meaningful rather than dead. |
| **§2.4** renames or flattens `reply` | `Remark.reply` in `features/search/api.ts` and the `remark.reply.body` read in `profile-sections.tsx` must change together. |
| **§2.6** returns `{items:[]}` for an unknown service slug | `service-detail.tsx` loses the 404 branch, and the catalogue explorer's unknown-category fallback needs rethinking — currently a 404 is a not-found state and an empty list is an empty state. |
| **§1.7** adds social sign-in | The "Coming soon" buttons in `sign-in-form.tsx` / `register-form.tsx` become live, `authApi` gains two calls, and `session.tsx` must adopt the provider's profile shape. `callback` needs a route — currently there is none. |
| **§1.1** fixes email OTP | No frontend change. The inline error it produces today simply stops appearing. |
| **§1.6** adds a refresh grace period | None required, but `api-client.test.ts`'s "collapses simultaneous 401s onto a single refresh" becomes belt-and-braces rather than essential. Relaxing single-flight client-side before the server does would sign users out. |
| **§2.5** adds `GET /auth/session` | `session.tsx` can skip `/auth/me` on public pages; the `me` query moves behind a check. |
| **A real `GET /catalogue/services` list endpoint is added** | `catalogueApi.listAllServices` stops fanning out and becomes one call. `useAllServices` loses its `N+1` shape. Text search and paging would then be server-side, so the client's `searchQuery` / `sortBy` / `pricingFilter` state moves into query params and the filtering moves out of `catalogue-explorer.tsx`. **Biggest single improvement available to this module.** |
| Anything adds a **new field** to a response row | Add it to the type in `features/{catalogue,places,search}/api.ts`. `src/tests/providers/search-contract.test.ts` asserts the exact field set on the search row and will fail loudly, which is the intent. |

## Conflicts already found and resolved in the frontend

Recorded because each was invisible to every gate:

1. **A hardcoded fallback dataset in the catalogue API layer.** `api.ts` caught
   every error and answered from `catalogue-data.ts`. An unknown slug was answered
   with a *different real service* including its price, duration and warranty, so a
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

| # | Sev | Module | Item |
|---|---|---|---|
| 1 | **S1** | 2 | Select `areas.centroid` — one line, turns the area filter from a disabled control into a real filter |
| 2 | **S2** | 2 | Reconcile `score` / `ratingScore` with their documentation — a live trap for every consumer |
| 3 | **S2** | 2 | `remark.reply` in the response schema — a crash for any client that reads the docs literally |
| 4 | **S1** | 1 | Email OTP delivery — `isEmailTarget()` instead of `startsWith('@')` |
| 5 | **S1** | 1 | Social authentication is entirely absent — endpoints, `federated_identities`, linking rule (§1.7) |
| 6 | **S3** | 2 | A cheap anonymous-session answer, removing two console entries per public page load |
| 7 | **S3** | 3 | SMS gateway routing, sender-ID masking, WhatsApp failover (§3.1) |
| 8 | **S2** | 1 | `/auth/me` should return `providerStatus` |
| 9 | **S3** | 1 | Login throttle should cover unknown identifiers |
| 10 | **S3** | 1 | Grace period for the previous refresh token (§1.6) |
| 11 | **S2** | 1 | Refresh/logout body schemas: wire or delete |
| 12 | — | 3, 4 | Localized notification templates; provider KYC trigger (§3.2, §4.1) |
| 13 | — | 2 | Refresh the stale `/search/providers` OpenAPI description |
| 14 | — | 2 | Paging / sorting / text on `/search/providers`, once there are enough providers for it to matter |
| 15 | — | 2 | Provider first name and photo — the biggest change to how the public product looks |