# Backend Requirements — Frontend Verification Findings

## Status

Created during HMS frontend verification and stabilisation, against the backend
as it stands today. This replaces `BACKEND_REQUIREMENTS.md`, which described a
contract that has since moved on; several of its entries were already wrong and
are not carried forward.

Every item below is **backend-owned**. Where the frontend could fix something, it
was fixed in `apps/web` instead, and only genuinely unavailable data appears
here. Verification method for each is recorded so the claim can be re-checked.

## Confirmed Backend Changes

Verified live against a running API (`http://localhost:3000`):

- `GET /auth/session` returns 200 either way — `{ authenticated: false, user: null }`
  for a signed-out browser, or `{ authenticated: true, user }` from the httpOnly
  refresh cookie without rotating it. The frontend now asks this first.
- Authentication responses include `providerStatus` alongside `roles`, and the
  frontend derives the profile type from `roles` + `providerStatus` rather than
  hardcoding a customer/provider/admin literal.
- `POST /auth/refresh` and `POST /auth/logout` accept an optional body; the
  browser path relies on the cookie and sends none.
- `GET /places/cities` returns `lat`/`lng` (centroid of the city's areas);
  `GET /places/cities/:cityId/areas` returns each area's own `lat`/`lng`. Both
  nullable. Confirmed live: Lahore `31.3261, 74.2262`, Gulberg `31.34789, 74.24973`.
- `ratingScore` on `/search/providers` and `score` on `/reputation` are **null**
  when nobody has rated the provider, and the provider is still ranked.
- Booking status values derive from the database `booking_status` enum, and
  `GET /bookings?status=` accepts **any** value of it (not a subset).
- `GET /bookings/:id` publishes `cancellation` (`freeCancelHours`,
  `lateCancelFeePaisa`, `hoursUntilStart`, `isLate`, `feeDuePaisa`) and
  `cancellationPolicy`, built by the same rule `POST /bookings/:id/cancel` applies.
- `POST /bookings` accepts `issueOptionId`; `GET /catalogue/services/:slug/issue-options`
  publishes the fault list per service. Confirmed live for `leak-repair` (4),
  `blocked-drain` (3), `new-fixture-install` (2).
- `startCheckout` returns `returnUrl` alongside `redirectUrl`.
- `GET /bookings/:id/checklist` publishes the service checklist for a booking.

## Backend Issues Blocking Frontend

### 1. No public provider identity on the search and profile endpoints

**Endpoint:** `GET /search/providers`, `GET /search/providers/:providerId`
**Expected:** a display name, and ideally an avatar URL.
**Actual:** the row carries `providerId`, `bio`, `experienceYears`,
`qualification`, `pricePaisa`, `distanceM`, `ratingScore`, `ratingCount`,
`badge` — and no name or photo at all.

Live response for the seeded provider:

```json
{ "providerId": "00000000-...-0098", "bio": "Seeded test provider...",
  "experienceYears": 5, "qualification": "Licensed plumber",
  "pricePaisa": 100000, "distanceM": 0, "badge": null,
  "ratingCount": 1, "ratingScore": 3.93 }
```

**Frontend impact:** every provider surface leads with `qualification` and a
generated monogram, because there is nothing else. On the booking's
professional-selection step this means the customer is asked to choose between
"Licensed plumber" and nothing else. The professional's own name is visible
nowhere in the booking flow. `booking.serviceSlug` and
`booking.providerQualification` are the only readable fields a booking detail
carries for the same reason.

**Required backend change:** publish a display name on the search row and the
provider detail. `users.first_name`/`last_name` already exist, so this is a
projection rather than a schema change. An avatar URL is a separate, larger
decision (upload storage, review) and is not assumed here.

**Investigated first:** confirmed absent from the live response, not a frontend
mapping bug — the field is not in the payload at any nesting level. The frontend
types, mapper, query and card were all checked before this was raised.

### 2. No public feed of recent reviews for a marketing page

**Endpoint:** none exists.
**Expected:** something like `GET /search/remarks?limit=n` returning recent
published remarks across providers, for a homepage testimonial band.
**Actual:** `GET /search/providers/:providerId/remarks` is the only remarks
route, and it is scoped to one provider id. There is no way to ask for "recent
remarks platform-wide".

**Frontend impact:** the homepage reviews carousel has been **removed** rather
than refilled with invented quotes. Three quotations with invented reviewer
names and an invented average were being rendered to every visitor; those are
worse than an absent section.

**Required backend change:** a public, rate-limited, published-only remarks
listing, if the marketing band is wanted back. Deliberately not invented on the
frontend, because "which quotes look good" is a curation decision the platform
owns.

### 3. No anonymous booking lookup by code

**Endpoint:** none exists.
**Expected:** `GET /track/:code` or equivalent, for a customer who has the code
but no session.
**Actual:** every booking route is scoped to the booking's own customer or
provider and answers 404 otherwise. This is a deliberate privacy design, not an
oversight.

**Frontend impact:** the public `/track` page no longer pretends to look bookings
up. It now shows the signed-in customer's real bookings and explains that
sign-in is required. No fabricated professional, service or area is printed for
a typed code.

**Required backend change:** only if anonymous tracking is wanted. It would need
a deliberate decision about what a code alone discloses (status and service
name only, presumably), and rate limiting.

## Missing API Contracts

### Service names on the booking list

`GET /bookings` returns `serviceId` but not the service name. The list therefore
fans out the catalogue (`GET /catalogue/categories` then
`/categories/:slug/services`) to join names, which is several requests to render
one table. `GET /bookings/:id` does publish `serviceName`/`serviceSlug`, so this
is an inconsistency between the two reads rather than a missing field.

**Frontend impact:** works, but the list costs N+2 requests and shows an
"unknown service" placeholder if the catalogue is briefly unavailable.
**Required change:** include the same readable names the detail route returns.
**Priority:** P1.

### Area name on the booking row

`GET /bookings/:id` returns `areaName`; `GET /bookings` does not. Same shape of
inconsistency. **Priority:** P2.

## Data Contract Problems

None outstanding. The three nullable-field changes (`ratingScore`, `score`,
`lat`/`lng`) are all now typed as nullable on the frontend and handled at every
render site, with a single shared `ratingOf` helper so no screen can reintroduce
`0.0`/`NaN`.

## Booking Contract Problems

None outstanding. Verified live: `POST /bookings` accepted `issueOptionId: 5`
belonging to `blocked-drain`, and the value came back on `GET /bookings`.

## Authentication / Session Problems

None outstanding. `GET /auth/session` behaves as documented and the frontend no
longer probes `/auth/me` first. Measured on a signed-out page load: one request
to `/auth/session` (200), zero 401s, zero refreshes.

## Search / Catalogue / Places Problems

### 4. No way to list providers without naming a service and a point

**Endpoint:** `GET /search/providers`
**Expected:** optionally browse approved providers, then narrow by filters.
**Actual:** all three of `serviceSlug`, `lat` and `lng` are required. A bare
`GET /search/providers` answers 422:

```json
{"code":"VALIDATION_FAILED","errors":[
  {"path":"serviceSlug","message":"Required"},
  {"path":"lat","message":"Expected number, received nan"}]}
```

**Frontend impact:** `/providers` cannot open on a list of everyone and narrow
down. It has to open on "choose a service to begin", which is honest but reads as
an empty page — and it means a customer who only knows "I need someone in Gulberg"
cannot see who is available at all.

**Required backend change:** make `serviceSlug` optional, and return providers
whose radius covers the point (or, with no point, all approved providers ordered
by rank) with a bounded `limit`. Filtering would then narrow an already-fetched
result set rather than re-query per service.

This is a deliberate design on the server — the endpoint is documented as "starts
from a service (not a person)" — so it is raised as a question rather than a
defect. Until it changes, the frontend's empty state is the correct behaviour and
must not be padded with a client-side list that the API cannot produce.

**Resolved since first recorded:** the area filter. `GET /places/cities/:cityId/areas`
now returns each area's own `lat`/`lng` (24 of 24 areas in Lahore, verified live),
so choosing an area searches around its centroid. The frontend previously
displayed "The API does not return coordinates for an area yet", which was no
longer true; that string has been removed.

## Reputation Problems

None outstanding. An unrated provider renders as "No ratings yet" on the
provider card, in the profile reputation section, on the provider's own ratings
and dashboard screens, and on the booking's professional-selection step.

## Payments / Checkout Problems

`returnUrl` is returned by `startCheckout` but is not consumed by the UI, and
deliberately so: it is informational, and the return page cannot observe the
gateway webhook, so treating it as proof of payment would be wrong. No change
requested.

## Priority

### P0 — Blocking

None. Nothing currently prevents the frontend from working correctly.

### P1 — Required

1. **Provider display name on `/search/providers` and the provider detail** —
   see issue 1. The booking's professional-selection step is materially weaker
   without it, and it is a projection of columns that already exist.
2. **Readable names on `GET /bookings`** — see "Missing API Contracts".
3. **A browseable `/search/providers` without a service** — see issue 4. Product
   decision first: it is the difference between "choose a service to begin" and a
   page a customer can land on and narrow.

### P2 — Nice to have

1. **A public recent-remarks feed** — see issue 2. Restores the homepage
   testimonial band with real quotes.
2. **Area name on `GET /bookings`** — see "Missing API Contracts".
3. **Anonymous booking lookup by code** — see issue 3. Product decision first.

## Frontend Verification Status

Verified in a real browser against a running API and web server on
2026-10-07. Harnesses live in `apps/web/e2e/` and are run directly with
`node e2e/<file>.cjs`.

| Area | Result | Evidence |
| --- | --- | --- |
| Authentication | PASS | `e2e/verify-auth.cjs` — 24/24, full lifecycle on the seeded account |
| Session | PASS | signed-out load = 1×`/auth/session` 200, zero 401; refresh restores from cookie |
| OTP | PASS (contract) | `authApi.requestOtp`/`verifyOtp` match `auth.controller.ts`; no live OTP run |
| Search | PASS | `e2e/verify.cjs` — real `/search/providers`, `/places/*`, filters, empty state |
| Catalogue | PASS | real categories/services read; issue-options verified per service |
| Places | PASS | `lat`/`lng` consumed and rendered nullable; city→area dependency verified |
| Reputation | PASS | null score renders "No ratings yet"; no `0.0`/`NaN` anywhere |
| Booking | PASS | `e2e/verify-booking.cjs` — 24/24, real booking created (201, `SHM-0000008`) |
| Booking list/detail | PASS | `e2e/verify-list.cjs` — 10/10, all 4 API bookings reachable |
| Checkout | PASS (partial) | `returnUrl` verified in contract; redirect path not exercised against a gateway |

**Not verified in a browser:** the admin, agent and finance portal screens, and
the provider portal beyond its rating surfaces. See "Remaining" in
`PROJECT_PROGRESS.md`.

Finance: **NOT STARTED.**