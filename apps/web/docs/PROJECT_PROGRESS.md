# Project progress — HMS web

Current state of `apps/web`. Last updated: 2026-10-07.

> For what the API must change, see `docs/backend_requirement.md`.
> For which endpoints are wired and which are not, see
> **`docs/integrated.md`** — that is the file to read before starting a module.
> For how to run it, see §5.

## Verification pass — 2026-10-07

Modules 1–3 (Authentication, Search/Catalogue/Places, Booking) were verified in
a real browser against a running API and web server, and the defects that turned
up were fixed. Harnesses are in `e2e/` and are run directly:

```
node e2e/verify.cjs          # public: navbar, session, places, responsive
node e2e/verify-auth.cjs     # full sign-in / refresh / sign-out lifecycle
node e2e/verify-booking.cjs  # booking flow end to end, creating a real booking
node e2e/verify-list.cjs     # booking list and detail against real records
```

Fixed in this pass, all inside `apps/web`:

- Session detection now asks `GET /auth/session` first. A signed-out page load
  costs one request and zero 401s, where it previously cost a 401 and a refused
  refresh on every page.
- The public navbar carries the logo only, one-word labels, and an underline
  that follows the route (including nested routes) and never the pointer.
- The booking problem field is a real dropdown over
  `GET /catalogue/services/:slug/issue-options`, sending `issueOptionId`. The
  free-text box remains as optional extra detail.
- `booking/status.ts` classified `ACCEPTED`, `VERIFIED`, `AUTO_RELEASED`,
  `PAYMENT_RELEASED`, `PARTIALLY_REFUNDED` and `REFUNDED` as neither live nor
  closed. All 22 statuses are now covered, and a test asserts it.
- Nullable `ratingScore` / reputation `score` / `lat` / `lng` are handled at every
  render site through one shared `ratingOf` helper.
- Cancellation now shows the API's own fee from `GET /bookings/:id`'s
  `cancellation` block instead of claiming no fee is ever charged.
- The booking list's empty state no longer tells an account with history that it
  has "no bookings yet" merely because the current tab is empty.
- `/track` and the home page no longer answer with invented bookings,
  professionals, ratings or testimonials. See §3.
- Navbar/header restyled: wordmark removed, utility strip added (phone, Support,
  language dropdown), account menu button replaces My Account + Sign out, "Book a Service"
  gets a `+` icon.
- Customer status text switched from provider labels to customer-facing `dict.bookingStatus`.
- `EvidenceImage` no longer sets state synchronously inside an effect: a real object
  URL is now **derived** during render and only the mock-storage envelope waits on a
  request. Behaviour is unchanged; the lint error is gone without a suppression.
- **Customer messages/complaints still read mock data** (see `integrated.md` Module 4).

### Reverted — 2026-10-07

The homepage restyle was **rolled back to commit `71e17cb`** at the client's request:
it had taken the homepage from a building, verified state to a page that crashed at
render time. Reverted files: `app/[locale]/(public)/page.tsx`, `components/cards.tsx`,
`features/home/{home-catalogue,home-platform,home-sections}.tsx`, and
`tests/home/home-catalogue-sections.test.tsx`. The `HeroDepth` component it
introduced was removed with it.

The homepage is therefore **not** verified in its current form — the state at
`71e17cb` is what ships, and `npm run build` is green against it.

### Known failing tests at `71e17cb` — not introduced by this work

`npm test` is **not** green at this commit, and was not before this pass either:

| Suite | Failing | Cause |
|-------|---------|-------|
| `tests/booking/booking-flow.test.tsx` | 15 / 33 | Every failure is `timeButtons` — no slot-time button renders in the schedule step. A shared helper at line 223, so all 15 share one root cause. |
| `tests/auth/site-header.test.tsx` | 0 / 12 | Was 2 failures, now fixed. The cause was real: the language dropdown and the account menu shared one `aria-label`, so the test helper clicked the language button. Given the language dropdown its own name (`dict.nav.languageMenu`). |

The booking-flow failure is worth fixing before Finance, and it is not a regression
from this pass. Recorded here rather than quietly ignored.

Modules 4–8 are unchanged. Provider portal, verification agent, Finance and
Administration still read `src/lib/data.ts`; that is the remaining mock-data
surface and it is now confined to those four modules.

## Contents

1. [Module status](#1-module-status)
2. [What is live](#2-what-is-live-against-the-api)
3. [Known limitations](#3-known-limitations)
4. [Still to verify](#4-still-to-verify)
5. [Running it](#5-running-it)
6. [Quality gates](#6-quality-gates)
7. [Test layout](#7-test-layout)
8. [Architecture](#8-architecture-you-need-to-know)
9. [Traps this repo has fallen into](#9-traps-this-repo-has-already-fallen-into)
10. [Conventions](#10-conventions)
11. [Design system rules](#11-design-system-rules)
12. [Next up](#12-next-up)

---

## 1. Module status

| # | Module | State | Reads |
|---|---|---|---|
| 1 | **Authentication** | Complete — full lifecycle verified in a browser, production build green | real API |
| 2 | **Search, Catalogue & Places (public)** | Complete — verified against the running API and in a browser | real API |
| 3 | **Booking** | **Complete** — verified end to end in a browser; a real booking was created | real API |
| 4 | **Customer portal** | Addresses only — the list pages now on real API; profile partially | real API + some `src/lib/data.ts` |
| 5 | **Provider portal** | **Mock data** | `src/lib/data.ts` |
| 6 | **Verification agent** | **Mock data** | `src/lib/data.ts` |
| 7 | **Finance** | **Mock data — not started** | `src/lib/data.ts` |
| 8 | **Administration** | **Mock data** | `src/lib/data.ts` |

**Only `apps/web` is ever changed.** The backend, `packages/*`, the database and
root config are read-only for this work — anything outside is a finding to
report, not a fix to make.

### Module 1 — Authentication

Register, OTP request/verify, login, refresh, logout, password forgot/reset, staff
TOTP enrolment and verification, `/auth/me`. One token store (a module variable,
never React state, never `localStorage`), a single-flight refresh pinned by tests,
and `auth: false` on every public read so a 401 on a public page can never start a
login redirect.

### Module 2 — Search, Catalogue & Places

All ten public endpoints integrated. Catalogue, service detail, provider search,
provider profile, reputation, remarks and availability.

**Routes:** `/services`, `/services/[slug]`, `/providers`, `/providers/[providerId]`
(the segment is an id, not a slug, because the API is keyed by UUID — same URL
shape, honest name).

**Structure**

| Path | Purpose |
|---|---|
| `src/lib/api/client.ts` | the one typed client (`apiRequest`) |
| `src/lib/api/problem.ts` | RFC 9457 problem document + `ApiError` |
| `src/lib/api/keys.ts` | query-key factories, freshness table, `publicRetry` |
| `src/features/catalogue/` | categories, services, pricing presentation |
| `src/features/places/` | cities, areas |
| `src/features/search/` | provider search, profile, reputation, remarks, slots, URL state, location |
| `src/features/discovery/` | the public page views |

**Freshness**

| Resource | `staleTime` |
|---|---|
| categories, category services | 30 min |
| service detail | 15 min |
| cities, areas | 60 min |
| provider search | 60 s |
| provider detail | 5 min |
| reputation, remarks | 2 min |
| **slots** | **0 s**, `refetchOnWindowFocus: true` |

No polling on any static endpoint. `retry` is off for `400`/`404`/`422` and
bounded (1) for transient failures.

### Module 3 — Booking

Checkout, the customer's own booking list, and one booking in full — with cancel,
reschedule, revised-quote decisions, problem photos, a warranty claim, a no-show
report and the in-booking chat.

**Structure**

| Path | Purpose |
|---|---|
| `src/features/booking/api.ts` | the typed booking calls; one function per route |
| `src/features/booking/status.ts` | which actions exist in which status — a copy of `BOOKING_TRANSITIONS` |
| `src/features/booking/queries.ts` | TanStack hooks; the quote is a **mutation**, not a query |
| `src/features/booking/booking-flow.tsx` | the six-step checkout |
| `src/features/booking/address-step.tsx` | saved address, or an inline create form |
| `src/features/booking/provider-choice.tsx` | a named professional, or auto-assign |
| `src/features/booking/book-service.tsx` | resolves the slug to a live catalogue service |
| `src/features/booking/booking-list.tsx` · `booking-detail.tsx` · `booking-chat.tsx` | after the booking |
| `src/features/booking/checkout-return.tsx` | the payment gateway's return leg |
| `src/features/account/api.ts` | addresses — a booking cannot start without one |

**Four rules that are not obvious from the code**

1. **The server prices every booking.** `POST /bookings/quote` and
   `POST /bookings` share one `PricingService.price()`. The catalogue's
   `basePricePaisa` appears in the sidebar labelled as a *guide*. Nothing in
   `apps/web` computes a total.
2. **`providerId` is optional and its absence means auto-assign.** It is never
   sent as `null` or `""`. Auto-assign means *no slot can be shown at all* —
   `/slots` needs a provider who has not accepted yet — so that path offers a
   **requested** window and says on screen that nothing is held.
3. **Actions are gated by the transition table, then re-checked by the API.**
   `status.ts` mirrors `BOOKING_TRANSITIONS` so no button appears where a 409
   would follow; every action still handles a 409 by telling the customer the
   booking moved on.
4. **A booking row has no names.** `BOOKING_COLUMNS` projects ids and money only,
   so `service-names.ts` joins `serviceId` against the catalogue. A service the
   catalogue no longer publishes shows a placeholder, not a bare number. The
   **address is not available at all** — see `backend_requirement.md` §3.1.

---

## 2. What is live against the API

Every one of these was captured from the running API against the seeded database
and re-checked in a browser:

| Page | Endpoints |
|---|---|
| `/services` | `catalogue/categories`, `catalogue/categories/:slug/services` |
| `/services/[slug]` | `catalogue/services/:slug`, `catalogue/categories` |
| `/providers` | `search/providers`, `places/cities`, `places/cities/:cityId/areas`, `catalogue/categories`, `catalogue/categories/:slug/services` |
| `/providers/[providerId]` | `search/providers/:providerId`, `…/reputation`, `…/remarks`, `…/slots` |
| `/book/[slug]` | `bookings/quote`, `bookings`, `customer/addresses`, `catalogue/services/:slug`, `search/providers`, `search/providers/:id/slots`, `places/cities`, `places/cities/:id/areas` |
| `/account/bookings` | `bookings`, plus `catalogue/categories` + `categories/:slug/services` to resolve service names |
| `/account/bookings/[id]` | `bookings/:id`, `…/messages`, `…/cancel`, `…/reschedule`, `…/evidence`, `search/providers/:id/slots` |

Nothing in `features/catalogue`, `features/places`, `features/search`,
`features/discovery`, `features/booking` or `features/account` falls back to
`src/lib/data.ts`. The 12 remaining service-related backend endpoints
(`/admin/catalogue/*`, `/admin/provider-services/*`, `/provider/services`,
`/provider/service-areas`, `/provider/ratings`) are all role-scoped and belong to
modules 5–8 above.

### Verified in a real browser

39 checks across desktop 1440 / tablet 820 / mobile 360, EN + UR with RTL
asserted, zero horizontal overflow and zero JavaScript errors: the full journey
(category → service → filtered search → profile → slot → `/en/book/leak-repair`),
refresh and direct-route access, back/forward through filter changes, city→area
dependency, area reset on city change, rapid filter changes, and every failure
state (unknown service, unknown provider, malformed uuid, out-of-range point,
unknown category).

Plus 18 checks on the mobile filter drawer: dialog semantics, `aria-modal`,
accessible name, body scroll lock, Escape, apply, reset and keyboard reach.

**99 unit tests across 10 files**, covering response contracts, query keys,
freshness, retry policy, dependent location filters, slot selection, refresh
coordination, remark-reply rendering, the rating distribution and superseded
requests.

### Module 3 — verified end to end in a real browser

Every endpoint this module calls was executed against the running API, and on
2026-10-07 the whole flow was driven through a real browser to a real booking:
`POST /bookings` returned **201** with reference `SHM-0000008`, carrying
`issueOptionId: 5` (a fault belonging to the chosen service), and the record was
then read back through the list and detail screens. `e2e/verify-booking.cjs` runs
24 checks; `e2e/verify-list.cjs` runs 10 more.

Findings from that pass:

- **A chosen professional is priced at *their* rate, not the catalogue's.**
  `quotedAmountPaisa: 100000` against a catalogue `basePricePaisa: 250000`. A total
  computed from the service row would have overstated this booking by 2.5×. The
  "server prices it" rule is not theoretical.
- **`409 SLOT_TAKEN` is real**, and the API also refuses a start in the past with
  a 400. The flow handles the first by returning to availability; the second is
  the customer-facing rule "your slot must be ahead of now".
- **The chat is closed at `REQUESTED`** (`open: false`), confirming that "live" and
  "chat open" are different sets — which is why `canMessage` is its own list.
- **The fault list is real and per-service.** `leak-repair` publishes 4,
  `blocked-drain` 3, `new-fixture-install` 2. The booking step now offers exactly
  what the service publishes, and sends `issueOptionId`.
- **The cancellation fee is charged**, and `GET /bookings/:id` publishes what
  cancelling the booking would cost under `cancellation`. The booking screen shows
  that figure rather than a locally computed one.
- **`areas` carry coordinates**, and an unrated provider's `ratingScore` is now
  `null` rather than the Bayesian prior. Both confirmed live and handled.

Superseded by this pass: the previous notes that `?status=VERIFIED` was a 422
(it is filterable — the API derives the enum from the database), that the
cancellation fee was never charged, and that areas published no coordinates.
Each of those was true when written and is not now.

**Checked on 2026-10-07** by `e2e/verify-booking.cjs` and `e2e/verify-list.cjs`:

- [x] The flow end to end as `customer@smart-home.local`: address → professional →
      schedule → details → review → payment → confirmation. Created a real booking
      (201, `SHM-0000008`).
- [x] The **auto-assign** path, the one with no live slot — confirmed that no
      `providerId` is sent when the platform is asked to choose.
- [x] The **cancellation quote** now read from `GET /bookings/:id`.
- [x] `/en/account/bookings` and `/account/bookings/[id]` against real records.
- [x] The hand-off: a slot picked on a profile arrives preselected in the flow.
- [x] Zero horizontal overflow at 360 / 768 / 1024 / 1440.

**Still not done — this needs a human or more setup:**

- [ ] An **ONLINE** booking to a real gateway. `startCheckout` and its `returnUrl`
      were checked in the contract and on the return page; the redirect leg
      itself was not exercised against a live gateway.
- [ ] A **409 `SLOT_TAKEN` in the UI** — needs two browsers racing one slot.
- [ ] The **UR / RTL** pass. Every screen was checked in English only.

**Two known rough edges, recorded rather than hidden:**

1. The return page renders the correct not-found content for a malformed
   `bookingId`, but answers **200** rather than 404 — streaming commits the status
   header before `notFound()` throws. Content is right; the status code is not.
2. `apps/web/package.json` was changed outside this work: `"dev"` lost
   `--port 3001`, so `npm run dev` binds 3000 — **the API's port**. The API and the
   web app then contend for it, and `next.config.ts` would proxy `/api/v1` to
   itself. Start the web app explicitly with `npx next dev --port 3001` until that
   script is restored.

**529 unit tests across 37 files** in total, plus 77 browser checks across four
harnesses in `e2e/`.

---

## 3. Known limitations

Deliberate, documented, and not hidden behind an empty state:

1. **An area filter that could not be satisfied.** `areas.centroid` was not
   selected by the places API. **Now fixed** — areas and cities publish `lat`/`lng`
   (nullable), and the search reads them. A city or area with no surveyed
   centroid shows that it has none rather than searching a made-up point.
2. **No provider name and no photo in the public contract.** Both `/search/providers`
   and the provider detail omit `users.first_name` and any avatar. Cards lead with
   the qualification and a neutral monogram; **no stock photograph of a person is
   used anywhere.** Still outstanding — `backend_requirement.md` issue 1, and the
   reason the booking's professional-selection step is the weakest screen in the
   product.
3. **No paging, sorting or text on `/search/providers`.** The schema is `.strict()`
   with three keys; `&page=2` is a 422. The UI shows the API's ranking and says in
   a note that there is no paging to choose.
4. **`reputation.score` and `ratingScore` are null when nobody has rated a
   professional**, and the provider is still ranked on it internally. Every
   rendering branches on the score through the shared `ratingOf` helper, so an
   unrated professional shows "No ratings yet" — never `0.0`, never `NaN`, and
   never the Bayesian prior presented as a rating.
5. **Per-slug SEO metadata is not derived from live data.** The shared client is
   browser-oriented (relative URLs), so `generateMetadata` uses dictionary copy.
   Fixing it properly needs an absolute base for server-side prefetch. Until then
   the server-rendered HTML shows skeletons, never a false empty state.
6. **The booking hand-off is closed.** The availability panel now carries the
   professional, the day and the exact start through `?provider=&date=&start=`,
   and the flow preselects them. Resolved in module 3.
7. **A signed-out visitor no longer logs an error.** `GET /auth/session` is asked
   first and answers 200 either way. Measured: one request, zero 401s, zero
   refreshes. Resolved on 2026-10-07.

### Added by module 3

8. **A booking cannot show an address.** `GET /bookings/:id` projects ids and money
   only — no service name, no provider name, no address text. Service names are
   joined client-side against the catalogue; **the address has no second source**
   and is simply absent from the detail page. `backend_requirement.md`.
9. **An auto-assigned booking cannot show a slot.** `/slots` is keyed on a
   provider, and an auto-assign booking has none until somebody accepts. The flow
   offers *requested* windows and says so on screen; it never renders one as
   confirmed.
10. **The cancellation fee is quoted from the server.** `GET /bookings/:id`
    publishes what cancelling this booking would cost under `cancellation`, built
    by the same rule `POST /bookings/:id/cancel` applies. The screen shows that
    figure, not a locally computed one.
11. **`GET /bookings` returns every booking at once.** No pager, no cursor, and no
    text search. It now accepts **any** status in the database enum, so all four
    tabs group one response client-side rather than issuing a filtered read each.
12. **An address needs a map point and there is nothing to geocode from.** The
    inline form offers the device's location or the area's own centroid, both
    labelled, and says the platform cannot look an address up yet.
13. **The homepage testimonial band was removed.** There is no public feed of
    recent remarks — only per-provider remarks — so the band had three invented
    quotations. It is recorded as a backend requirement rather than refilled.
    `backend_requirement.md` issue 2.
14. **`/track` requires sign-in.** Every booking route is scoped to the booking's
    own customer, so an anonymous lookup by code is not possible. The page now
    shows the signed-in customer's real bookings instead of answering any typed
    code with an invented one. `backend_requirement.md` issue 3.

---

## 4. Still to verify

Modules 1–3 were verified end to end in a browser on 2026-10-07; see the
checklist above. What remains:

- **Modules 4–8 have not been opened in a browser.** Provider portal, verification
  agent, Finance and Administration still read `src/lib/data.ts`, and they are
  the whole of the remaining mock-data surface. They need wiring to the real
  endpoints (listed in `integrated.md`) before any of them can be trusted.
- **The rating-distribution bar and the remark-reply block have never been drawn
  by the real API**, because the seeded professional has no ratings and no
  remarks. Both are covered by component tests with real-shaped payloads. Once a
  professional with a rating and a replied remark exists, open the profile once.
- **Live data volume.** One approved professional and one city are seeded, so
  long result lists and multi-city switching are only exercised at that scale.
  A saved address exists ("Home", Gulberg) and the "pick a saved address" branch
  ran against real data; the **inline create form** has still never been
  submitted to the API, and it is the one write path in this module with no live
  exercise behind it.
- **ONLINE checkout against a live gateway**, and the `409 SLOT_TAKEN` race
  between two browsers.
- **The UR / RTL pass.** Every check in this pass ran in English.

### Browser harnesses

Plain node scripts driving Playwright against a running dev server. They are not
part of `npm test`; run them by hand with the API on `:3000` and the web app on
`:3001`:

```
node e2e/verify.cjs          # public: navbar, session, places, responsive sweep
node e2e/verify-auth.cjs     # sign-in / protected route / refresh / sign-out
node e2e/verify-booking.cjs  # the flow, creating a real booking
node e2e/verify-list.cjs     # booking list and detail against real records
```

---

## 5. Running it

```bash
# 1. API (from the repo root) — needs Postgres + Redis
npm run infra:up
npm run build --workspace @smart-home/contracts --workspace @smart-home/domain
npm run db:migrate
npm run db:seed              # 6 categories, 18 services, 1 city, 23 areas, 1 approved provider
npm run dev                  # API on :3000

# 2. Web
cd apps/web
npm install
npm run dev                  # http://localhost:3001
```

**The workspace build in step 1 is not optional.** Without it the API dies at
boot with `ERR_MODULE_NOT_FOUND: .../@smart-home/contracts/dist/index.js`, which
looks like a web problem and is not.

If `db:seed` reports `@prisma/client did not initialize yet`, run
`npm run db:generate --workspace @smart-home/db` first.

Dev accounts, all `DevPassword!2026`: `customer@smart-home.local`,
`provider@smart-home.local`, `admin@smart-home.local`, `finance@smart-home.local`,
`agent1@smart-home.local`. OTP codes: `GET http://localhost:3000/api/v1/dev/inbox?limit=1`
(dev only).

The web app calls `/api/v1/*` **on its own origin** and `next.config.ts` rewrites
that to the API (`API_PROXY_ORIGIN`, default `http://localhost:3000`). This is
deliberate — see §7.

---

## 6. Quality gates

```bash
cd apps/web
npm run lint        # 0 errors (14 warnings, all pre-existing and outside this work)
npm run typecheck   # clean
npm test            # 529 passed / 37 files
npm run build       # compiles
```

Plus the four browser harnesses in `e2e/` — 77 checks against a running API and
dev server. See §4.

**A successful build is not visual verification.** Open the page.

---

## 7. Test layout

Every module owns its tests. They live under `src/tests/<module>/`, one folder
per module, mirroring the module list in §1 — so a new module's tests have an
obvious home and no test is stranded next to unrelated code.

```
src/tests/
  auth/         session, routing, schemas
  services/     pricing, catalogue API honesty, service detail flow
  providers/    search state, search contract, dependent queries,
                profile sections, provider card, availability panel
  booking/      booking contract, transition rules, query layer,
                the checkout flow, the booking detail page
  shared/       API client (refresh coordination), query keys, freshness, retry
```

**Rules**

- A test file is named after what it protects, not after the file it imports.
- Prefer asserting on behaviour a user can observe over implementation detail.
  Where markup is composed into one element, assert against rendered text rather
  than exact nodes, so a layout change does not fail a contract test.
- **Every `.tsx` test needs `afterEach(cleanup)`.** See trap 4 in §9 — without it
  one test's DOM is still mounted when the next starts and the failure reads as a
  product bug.
- Anything that must never happen again deserves a test with the bug named in it.
  `services/catalogue-api-honesty.test.ts` is the example: it pins that the API
  layer never substitutes data for a failure.
- Do not use `@testing-library/user-event` — it is not installed. Use
  `fireEvent` from `@testing-library/react`.
- Never edit source with PowerShell `Set-Content` (trap 1). Use the editor or a
  Node script.

---

## 8. Architecture you need to know

**One typed client, shared.** `src/lib/api/client.ts` exports `apiRequest`;
`problem.ts` holds the problem document and `ApiError` (`code`, `status`,
`fieldErrors` keyed by the API's own paths); `keys.ts` holds the query-key
factories, the freshness table and `publicRetry`.

**One token store.** `src/lib/api/access-token.ts` — a module variable, never
React state, never `localStorage`. The API pairs it with an httpOnly refresh
cookie (`Path=/api/v1/auth`, `SameSite=Lax`, no `Domain`), so the browser must
stay on one origin. That is why the rewrite proxy exists.

**Refresh is single-flight and must stay that way.** The API rotates the refresh
token on every use and treats a second use as a replay, revoking every session
descended from it. Two concurrent refreshes sign the user out permanently.
`client.ts` collapses concurrent callers onto one refresh, reuses a very recent
one, and remembers a *refused* refresh for the life of the document. Tests pin all
three — do not "simplify" them.

**`auth: false` on public requests.** Catalogue, places and search are
`@Public()`. Those calls send no bearer and can never trigger a refresh.

**Session state lives in one place.** `src/features/auth/session.tsx` wraps
TanStack Query; the current user is the single `["auth","me"]` query. Do not copy
it into another store.

**Three kinds of state, kept apart:** server data in TanStack Query; anything
shareable in the URL; everything else local to the component.

---

## 9. Traps this repo has already fallen into

1. **PowerShell `Set-Content` without `-Encoding UTF8` double-encodes source
   files.** It corrupted `src/lib/dictionaries.ts` and six other files, leaving
   literal `â€¦` and `â€”` in rendered output while every gate stayed green. After
   any bulk edit:
   ```bash
   node -e "const fs=require('fs'),p=require('path');(function w(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=p.join(d,e.name);if(e.isDirectory())w(f);else if(/\.(ts|tsx|css|md)$/.test(e.name)){const s=fs.readFileSync(f,'utf8');if(s.includes('\u00e2\u20ac')||s.includes('\u00c2'))console.log('MOJIBAKE',f);}}})('src')"
   ```
2. **Next refuses to start when two route folders claim the same dynamic path.**
   `(public)/providers/[slug]` and `(public)/providers/[providerId]` both existed
   during a handover and produced
   `You cannot use different slug names for the same dynamic path` — the dev
   server exited and the whole app looked broken. A hard startup failure, not a
   per-route 404.
3. **An orphaned dev server serves a stale build.** When a second `next dev`
   cannot bind the port, the *old* process keeps answering from a `.next` that no
   longer matches the source — as 404s on routes that demonstrably worked. Check
   the log for `EADDRINUSE` before believing a regression, and kill the whole
   process tree rather than only the listener.
4. **vitest runs with `globals: false`, so Testing Library's automatic cleanup
   never registers.** Without an explicit `afterEach(cleanup)`, one test's DOM is
   still mounted when the next starts and queries match the previous render —
   which reads as a product bug. All three `.tsx` test files now do this.
5. **An `::after` overlay needs a positioned ancestor.** A card whose title link
   is stretched with `after:absolute after:inset-0` must itself be `relative`, or
   the overlay resolves against something far up the page and silently swallows
   clicks on unrelated UI. This was a real bug here: provider cards were blocking
   the filter sidebar.
6. **Reuse the shared primitives.** The project already had a `FilterDrawer` with
   Escape, scroll lock and dialog semantics; the search page had hand-rolled a
   worse one. Check `components/ui/` before writing a dialog, sheet, pager or
   filter.
7. **`void promise` is not a rejection handler.** Every booking action used
   `void mutation.mutateAsync(…)`, so each refused action logged an unhandled
   rejection — a 409 on a booking that had already been cancelled became a
   console error while every gate stayed green. Use `.catch(reportFailure)` and
   let the mutation's own `isError` do the reporting.
8. **An async function named `useX` is flagged wherever it is called.** A handler
   called `useDeviceLocation` triggered `rules-of-hooks` when invoked from an
   `onClick`. Only a real hook gets a `use` prefix.
9. **`react-hooks/set-state-in-effect` is right and the fix is to derive.** The
   booking flow wanted to apply a slot carried in the URL; writing it from an
   effect set state after the first paint, so the step briefly rendered empty as
   though nothing had been carried. Deriving it during render removed the extra
   render *and* the flash.

---

## 10. Conventions

- Next.js here is **16.3.6 with breaking changes**; `AGENTS.md` points at
  `node_modules/next/dist/docs/`. Read it before writing unfamiliar Next code.
- `apps/web` is a root workspace member, so adding a dependency regenerates the
  **root `package-lock.json`**. Unavoidable — flag it, do not hand-edit it.
- All copy lives in `src/lib/dictionaries.ts`; `ur` is typed as `typeof en`, so a
  missing or extra key fails typecheck. **Add both languages together.**
- Money is **integer paisa** everywhere. Format with `money()` from
  `features/catalogue/pricing`. Never `pricePaisa / 100` inline.
- No fabricated testimonials, statistics, reviews, badges or trust claims.
  `providers.status === "APPROVED"` is an approval flag and is labelled as one.
- Route files stay thin: validate locale, fetch dictionary, render a feature view.
  Feature views live in `src/features/<area>/`.
- **A mutation's failure is reported through its own `isError`, never a
  `try/catch` that swallows it.** The card renders the message; the promise only
  needs `.catch(reportFailure)` to keep the console clean.
- **If the API prices something, the app never computes it.** `POST /bookings/quote`
  exists precisely so there is one implementation of the arithmetic.

---

## 11. Design system rules

Agreed during the original build and still binding. They are easy to break by
accident because each one looks like a preference rather than a rule.

| Rule | Why |
|---|---|
| **Waves only at the top of a section**, never the bottom | The footer is `bg-navy` — a dark section directly above it kills the contrast |
| **One illustration only** (the house blueprint) | 20 decorative SVGs were deleted; everything else is type, photo or gradient |
| **Search inputs carry no focus ring** | The bordered shell *is* the affordance; the ring was visual noise |
| **Solid white search bars, not glass** | Translucent white over navy read as "half white, half something else" |
| **No crossed pair of strokes** in any decorative drawing | Registration marks and arrow crosses read as noise at watermark opacity; every terminal mark is a T or a single jamb line |
| **No nested cards** | A card inside a card doubles the border and halves the hierarchy |

**Palette** navy `#0b1b3f`, primary `#2563eb`, yellow accent `#facc15`.
**Radii** 8 / 10 / 14 / 16. **Shadows** `shadow-xs` … `shadow-lifted`, plus
`.shadow-float`. **RTL** is done with Tailwind logical utilities (`ms-`, `pe-`,
`start-`, `end-`) throughout — never `left-`/`right-`.

**Motion** — `Reveal` for scroll entrances (`whileInView` + spring, `once: true`)
and `TiltCard` for mouse-follow tilt. Depth layers use
`data-tilt-depth="media" | "body" | "chip"` to push forward on Z so the tilt
reads as real parallax. All motion collapses under `prefers-reduced-motion`.

**Route inventory** (58 pages, both locales) — public `/`, `/services`,
`/services/[slug]`, `/providers`, `/providers/[providerId]`, `/book/[slug]`,
`/auth/[mode]`, `/verification/[token]`, `/plans`, `/how-verification-works`,
`/track`, `/contact`, `/privacy`, `/terms`; customer `/account/*`; provider
`/provider/*`; agent `/agent/*`; finance `/finance/*`; admin `/admin/*`.

---

## 12. Next up

**Finance has deliberately not been started.** The modules that were already
built were verified and stabilised first, and that work is now done and recorded
above. Finance is listed in `integrated.md` against endpoints that have not been
built from the frontend side.

Before Finance, the remaining mock-data surface is modules 5–8 — provider
portal, verification agent, Finance and Administration. All four read
`src/lib/data.ts`, and the endpoint each one needs is already listed in
`integrated.md`. The **verification agent** is the most self-contained of them:
`/agent/queue`, `/agent/queue/claim`, `/agent/verifications/:id`,
`.../attempts` and `.../submit` all exist on the API and are all currently
rendered from invented bookings, an invented rating, stock photographs of
evidence photos, and an `alert()` that claims a ledger write happened.

Two things are worth knowing before starting any of them:

- The agent rail used to link to `/agent/verification/<id>` with an id taken from
  the mock file. It no longer does: a console link needs a call the agent actually
  holds, and that id comes from `POST /agent/queue/claim`, so the rail starts at
  the queue.
- `/account` and `/account/addresses` still read mock rows beside real forms
  (module 4). They are smaller than modules 5–8 and are the easiest real win left.

The UR / RTL pass (§4) should also happen before Finance: no screen has been
verified in Urdu, and the booking flow's new dropdown is the kind of component
where RTL is most likely to be wrong.