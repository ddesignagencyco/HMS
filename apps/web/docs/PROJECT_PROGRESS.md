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
| 3 | **Booking** | **Mock data** — not started | `src/lib/data.ts` |
| 4 | **Customer portal** | **Mock data** | `src/lib/data.ts` |
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

Nothing in `features/catalogue`, `features/places`, `features/search` or
`features/discovery` falls back to `src/lib/data.ts`. The 12 remaining
service-related backend endpoints (`/admin/catalogue/*`, `/admin/provider-services/*`,
`/provider/services`, `/provider/service-areas`, `/provider/ratings`) are all
role-scoped and belong to modules 3–8 above.

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
6. **The booking hand-off carries only the service.** `POST /bookings` already
   accepts `providerId` + `scheduledStart` + `scheduledEnd`, so this is a
   web-app gap in module 3, not a backend one.
7. **A signed-out visitor logs two non-2xx entries per page load**
   (`/auth/me` + `/auth/refresh`). Both are correct behaviour, not JavaScript
   faults; removing them needs a public `GET /auth/session`.

---

## 4. Still to verify

Nothing on the checklist is outstanding. Two things need data rather than code:

- **The rating-distribution bar and the remark-reply block have never been drawn
  by the real API**, because the seeded professional has no ratings and no
  remarks. Both are covered by component tests with real-shaped payloads. Once a
  professional with a rating and a replied remark exists, open the profile once.
- **Live data volume.** One approved professional and one city are seeded, so
  long result lists and multi-city switching are only exercised at that scale.

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
npm run lint        # 0 errors (14 warnings, all pre-existing, outside this work)
npm run typecheck   # clean
npm test            # 151 passed / 14 files
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

**Module 3 — Booking** is the natural next step, and the backend is already
ready for it: `POST /bookings` and `POST /bookings/quote` accept `providerId`,
`serviceId`, `addressId`, `scheduledStart`, `scheduledEnd` and `problemText`.
Module 2 links to `/book/{serviceSlug}` and says on screen that the professional
and time are chosen inside the booking flow.

After that, modules 4–8 in the order in §1. `/admin/catalogue` is the write side
of the APIs module 2 just wired, if a smaller step is wanted first.