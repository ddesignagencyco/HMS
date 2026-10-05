# Project progress — HMS web

Current state of `apps/web`. Last updated: 2026-10-03.

> For what the API must change, see `docs/BACKEND_REQUIREMENTS.md`.
> For which endpoints are wired and which are not, see
> **`docs/integrated.md`** — that is the file to read before starting a module.
> that is the file to read before starting a module.
> For how to run it, see §5.

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
| 1 | **Authentication** | Complete, verified live, production build green | real API |
| 2 | **Search, Catalogue & Places (public)** | Complete, verified against the running API | real API |
| 3 | **Booking** | **Complete — against the live API** | real API |
| 4 | **Customer portal** | 🟡 addresses only | real API + `src/lib/data.ts` |
| 5 | **Provider portal** | **Mock data** | `src/lib/data.ts` |
| 6 | **Verification agent** | **Mock data** | `src/lib/data.ts` |
| 7 | **Finance** | **Mock data** | `src/lib/data.ts` |
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
   **address is not available at all** — see `BACKEND_REQUIREMENTS.md` §3.1.

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

### Module 3 — verified against the API, not yet against a browser

**Every endpoint this module calls was executed against the running API** with the
seeded database, through the web app's own origin. The full transcript of
expectations and results is `BACKEND_REQUIREMENTS.md` §3.9 — 30 rows. The findings
that changed a design decision:

- **A chosen professional is priced at *their* rate, not the catalogue's.**
  `quotedAmountPaisa: 100000` against a catalogue `basePricePaisa: 250000`. A total
  computed from the service row would have overstated this booking by 2.5×. The
  "server prices it" rule is not theoretical.
- **`409 SLOT_TAKEN` is real.** Booking the same slot twice gives
  `409 SLOT_TAKEN`, which is the path the flow handles by returning to availability.
- **The chat is closed at `REQUESTED`** (`open: false`), confirming that "live" and
  "chat open" are different sets — which is why `canMessage` is its own list.
- **`?status=VERIFIED` is a live 422**, so the status filter offers only the ten
  values the schema accepts.
- **The cancellation fee is not charged**, but the quote's own policy sentence
  promises Rs 500. The two halves of the feature disagree; the UI states the
  honest version. `BACKEND_REQUIREMENTS.md` §3.4.
- **The ONLINE return leg was a 404.** `payment.redirectUrl` carries a hardcoded
  `/checkout/return?bookingId=…`, and no such route existed. Added
  `app/[locale]/checkout/return`; `BACKEND_REQUIREMENTS.md` §3.7.
- **`areas` still carry no coordinates** and `ratingScore` is still 3.5 with zero
  ratings — §2.2 and §2.3 both re-confirmed against live data.

**Still not done — this needs a human with a browser:**

- [ ] `/en/book/leak-repair` end to end as `customer@smart-home.local`: address →
      professional → slot → details → review → payment → confirmation, cash and online.
- [ ] The **auto-assign** path, the one with no live slot.
- [ ] A **409 `SLOT_TAKEN` in the UI** — needs two browsers on one slot.
- [ ] `/en/account/bookings` and `/account/bookings/[id]` in EN and UR, RTL asserted.
- [ ] The hand-off: pick a slot on a profile, land in the flow preselected.
- [ ] Zero horizontal overflow and zero console errors, as modules 1–2 were checked.

**131 unit tests across 5 files** cover the contracts, the transition rules, the
query layer and both pages, but component tests are not a browser.

**Two known rough edges, recorded rather than hidden:**

1. The return page renders the correct not-found content for a malformed
   `bookingId`, but answers **200** rather than 404 — streaming commits the status
   header before `notFound()` throws. Content is right; the status code is not.
2. `apps/web/package.json` was changed outside this work: `"dev"` lost
   `--port 3001`, so `npm run dev` binds 3000 — **the API's port**. The API and the
   web app then contend for it, and `next.config.ts` would proxy `/api/v1` to
   itself. Start the web app explicitly with `npx next dev --port 3001` until that
   script is restored.

**151 + 131 = 282 unit tests across 19 files** in total.

---

## 3. Known limitations

Deliberate, documented, and not hidden behind an empty state:

1. **No area or city filter can exist on search.** `areas.centroid` exists in the
   database and is not selected (`places.service.ts:20`). The area control ships
   **disabled with the reason on screen** rather than pretending to filter. Fix:
   `BACKEND_REQUIREMENTS.md` §2.2.
2. **No provider name and no photo in the public contract.** Both endpoints omit
   `users.first_name` and `providers.photo_key`. Cards lead with the qualification
   and a neutral monogram. **No stock photograph of a person is used anywhere.**
3. **No paging, sorting or text on `/search/providers`.** The schema is `.strict()`
   with three keys; `&page=2` is a 422. The UI shows the API's ranking and says in
   a note that there is no paging to choose.
4. **`reputation.score` is a Bayesian prior, never null** — 3.5 with zero ratings.
   Every rendering is gated on `ratingCount`, so an unrated professional shows
   "No ratings yet" rather than a star.
5. **Per-slug SEO metadata is not derived from live data.** The shared client is
   browser-oriented (relative URLs), so `generateMetadata` uses dictionary copy.
   Fixing it properly needs an absolute base for server-side prefetch. Until then
   the server-rendered HTML shows skeletons, never a false empty state.
6. **The booking hand-off is closed.** The availability panel now carries the
   professional, the day and the exact start through `?provider=&date=&start=`,
   and the flow preselects them. Resolved in module 3.
7. **A signed-out visitor logs two non-2xx entries per page load**
   (`/auth/me` + `/auth/refresh`). Both are correct behaviour, not JavaScript
   faults; removing them needs a public `GET /auth/session`.

### Added by module 3

8. **A booking cannot show an address.** `BOOKING_COLUMNS` projects ids and money
   only — no service name, no provider name, no address text. Service names are
   joined client-side against the catalogue; **the address has no second source**
   and is simply absent from the detail page. `BACKEND_REQUIREMENTS.md` §3.1.
9. **An auto-assigned booking cannot show a slot.** `/slots` is keyed on a
   provider, and an auto-assign booking has none until somebody accepts. The flow
   offers *requested* windows and says so on screen; it never renders one as
   confirmed. `BACKEND_REQUIREMENTS.md` §3.5.
10. **No cancellation fee is quoted, because none is charged.** FR-BK-06 is not
    applied by `POST /bookings/:id/cancel` — the controller says so. The UI states
    that plainly rather than naming a rule that does not run. If that changes, the
    copy changes with it. `BACKEND_REQUIREMENTS.md` §3.4.
11. **`GET /bookings` returns every booking at once.** No pager, no cursor, and no
    text search. The filter offers only the ten statuses the query schema accepts,
    because `?status=VERIFIED` is a 422 today. `BACKEND_REQUIREMENTS.md` §3.2.
12. **An address needs a map point and there is nothing to geocode from.** The
    inline form offers device location or a city-centre approximation, both
    labelled, and says the platform cannot look an address up yet.
    `BACKEND_REQUIREMENTS.md` §3.7.

---

## 4. Still to verify

**Module 3's endpoints are verified against the running API** — see the checklist
above and `BACKEND_REQUIREMENTS.md` §3.9. What remains needs a browser and a
human. The module-1 and module-2 items stand:

- **The rating-distribution bar and the remark-reply block have never been drawn
  by the real API**, because the seeded professional has no ratings and no
  remarks. Both are covered by component tests with real-shaped payloads. Once a
  professional with a rating and a replied remark exists, open the profile once.
- **Live data volume.** One approved professional and one city are seeded, so
  long result lists and multi-city switching are only exercised at that scale.
  **A seeded address now exists** ("Home", Gulberg), so the "pick a saved address"
  branch has run against real data — but the inline create form has still never
  been submitted to the API, and it is the one write path in this module with no
  live exercise behind it.

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
npm run lint        # 0 errors (4 warnings, all pre-existing and outside this work)
npm run typecheck   # clean
npm test            # 282 passed / 19 files
npm run build       # compiles
```

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

**Module 4 — Customer portal**, and it is a small module now. Addresses are the
only thing `POST /bookings` needs, and those are wired; what remains is the pages
around them:

1. **`/account` reads mock bookings while `/account/bookings` reads the API.**
   Two sources of truth for one customer's bookings — the same problem the home
   page has with the catalogue. Wire `CustomerDashboard` to `GET /bookings`;
   `booking-list.tsx` already has the query and the formatting.
2. **`/account/addresses` renders mock rows** beside a real create form.
   `accountApi` types `updateAddress` and `archiveAddress`; only the list page is
   outstanding.
3. **Notifications** — `GET /notifications`, `POST /notifications/:id/read`,
   `/read-all`. Nothing depends on them.
4. **Complaints** — six endpoints, all customer-scoped, and a page that already
   exists in mock form.

**Before starting module 4, finish module 3's browser checklist** in §4 above.
Nothing in this module has been rendered against the real API, and the booking
flow has more ways to be wrong on screen than a static page does.

`/admin/catalogue` remains the write side of the APIs module 2 reads, if a smaller
step is wanted instead.