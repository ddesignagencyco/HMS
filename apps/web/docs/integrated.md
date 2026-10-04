# API integration tracker

Which backend endpoints are wired into `apps/web`, and which are not.
Last updated: 2026-10-03 · backend commit `08bf442` · **165 endpoints** on the API.

**Read this before starting a module.** It is the shortest answer to "is this
already built, and what will I collide with?"

- `docs/PROJECT_PROGRESS.md` — current state, how to run, conventions
- `docs/BACKEND_REQUIREMENTS.md` — defects and asks for the backend team

## Contents

1. [How to read this](#1-how-to-read-this)
2. [Summary](#2-summary)
3. [Module 1 — Authentication ✅](#module-1--authentication-)
4. [Module 2 — Search, Catalogue & Places ✅](#module-2--search-catalogue--places-)
5. [Module 3 — Booking ⬜](#module-3--booking-)
6. [Module 4 — Customer ⬜](#module-4--customer-)
7. [Module 5 — Provider ⬜](#module-5--provider-)
8. [Module 6 — Verification agent ⬜](#module-6--verification-agent)
9. [Module 7 — Finance ⬜](#module-7--finance-)
10. [Module 8 — Administration ⬜](#module-8--administration-)
11. [Cross-cutting and dev-only](#cross-cutting-and-dev-only)
12. [Pages still reading mock data](#pages-still-reading-mock-data)

---

## 1. How to read this

| Mark | Meaning |
|---|---|
| ✅ | Wired to the real API, verified against the running server |
| 🟡 | Partly wired — some endpoints of the module are live |
| ⬜ | Not wired. The page still reads `src/lib/data.ts` |
| ➖ | Deliberately not for the web app (webhooks, dev tooling, health) |

**"Integrated" means the frontend calls it and renders the response.** It does not
mean the page is finished — several module-3+ pages are visually complete and still
entirely mock.

---

## 2. Summary

| # | Module | Endpoints | Integrated | State |
|---|---|---|---|---|
| 1 | Authentication | 11 | **11** | ✅ complete |
| 2 | Search, Catalogue & Places | 8 | **8** | ✅ complete |
| 3 | Booking | 3 | 0 | ⬜ mock |
| 4 | Customer | 12 | 0 | ⬜ mock |
| 5 | Provider | 24 | 0 | ⬜ mock |
| 6 | Verification agent | 10 | 0 | ⬜ mock |
| 7 | Finance | 17 | 0 | ⬜ mock |
| 8 | Administration | 46 | 0 | ⬜ mock |
| — | Cross-cutting / dev | 34 | 3 | see below |

**21 of 165 endpoints are called by the web app today.** Everything else is either a
later module or not for the browser.

---

## Module 1 — Authentication ✅

Source: `src/features/auth/` · tests: `src/tests/auth/`

| Endpoint | Access | Where it is used |
|---|---|---|
| `POST /auth/register` | public | `register-form.tsx` |
| `POST /auth/otp/request` | public | `verify-otp-form.tsx`, `forgot-form.tsx` |
| `POST /auth/otp/verify` | public | `verify-otp-form.tsx` (sign-in and account confirm) |
| `POST /auth/login` | public | `sign-in-form.tsx` |
| `POST /auth/refresh` | cookie | `lib/api/client.ts` — single-flight, never called directly by a page |
| `POST /auth/logout` | cookie | `auth-actions.ts`, `sign-out/page.tsx` |
| `GET /auth/me` | cookie | `session.tsx` — the single `["auth","me"]` query |
| `POST /auth/password/forgot` | public | `forgot-form.tsx` |
| `POST /auth/password/reset` | public | `reset-password-form.tsx` |
| `POST /auth/totp/setup` | authenticated | `totp-form.tsx` |
| `POST /auth/totp/verify` | authenticated | `sign-in-form.tsx`, `totp-form.tsx` |
| `DELETE /auth/totp` | authenticated | `totp-form.tsx` |

**Not built:** social sign-in. The Google/Facebook buttons render "Coming soon"
because there is no OAuth surface on the API — see `BACKEND_REQUIREMENTS.md` §1.7.
**Do not** wire them until those endpoints exist.

**Known defect that affects this module:** email OTP delivery returns 500
(`otp.service.ts:84`). The frontend shows the failure inline.

---

## Module 2 — Search, Catalogue & Places ✅

Source: `src/features/{catalogue,places,search,discovery}/` · tests: `src/tests/{services,providers}/`

| Endpoint | Access | Where it is used |
|---|---|---|
| `GET /catalogue/categories` | `@Public` | `catalogue/api.ts` → catalogue page sidebar + service breadcrumb |
| `GET /catalogue/categories/:slug/services` | `@Public` | `catalogue/api.ts` → category listing, and the `listAllServices` fan-out |
| `GET /catalogue/services/:slug` | `@Public` | `catalogue/api.ts` → service detail page |
| `GET /places/cities` | `@Public` | `places/api.ts` → provider search city filter |
| `GET /places/cities/:cityId/areas` | `@Public` | `places/api.ts` → area filter, fetched only after a city is chosen |
| `GET /search/providers` | `@Public` | `search/api.ts` → provider search results |
| `GET /search/providers/:providerId` | `@Public` | `search/api.ts` → provider profile |
| `GET /search/providers/:providerId/reputation` | `@Public` | `search/api.ts` → reputation section |
| `GET /search/providers/:providerId/remarks` | `@Public` | `search/api.ts` → remarks, loaded separately from the profile |
| `GET /search/providers/:providerId/slots` | `@Public` | `search/api.ts` → availability panel |

All ten are `@Public()`, so every call sends `auth: false` and can never trigger a
refresh or a login redirect.

### Two client-side compositions, not endpoints

| Function | What it does | Why it is not one call |
|---|---|---|
| `catalogueApi.listAllServices` | Fans out: `categories`, then one `categories/:slug/services` per active category | **There is no all-services endpoint on the API.** It fails loudly if any category fails, rather than returning a partial catalogue |
| `apiRequest` refresh-and-replay | On `UNAUTHENTICATED`, refreshes once and replays once | Shared client behaviour, not a route |

**If a real `GET /catalogue/services` list endpoint is added**, replace the fan-out
with one call — it is the single biggest improvement available to this module, and
the natural home for the paging and text search `/search/providers` also lacks.

---

## Module 3 — Booking ⬜ — **next**

Source: `src/features/booking/booking-flow.tsx` · page: `/[locale]/book/[slug]`

| Endpoint | Access | Status |
|---|---|---|
| `POST /bookings/quote` | `CUSTOMER` | ⬜ not called |
| `POST /bookings` | `CUSTOMER` | ⬜ not called |
| `POST /bookings/checkout` | `CUSTOMER` | ⬜ alias of the above |
| `GET /bookings/:id` | customer or provider | ⬜ |
| `POST /bookings/:id/accept` | provider | ⬜ |
| `POST /bookings/:id/decline` | provider | ⬜ |
| `POST /bookings/:id/cancel` | customer or provider | ⬜ |
| `POST /bookings/:id/reschedule` | customer | ⬜ |

**Ready to start.** `POST /bookings` already accepts everything module 2 hands
over: `providerId`, `serviceId`, `addressId`, `scheduledStart`, `scheduledEnd`,
`problemText`, `paymentMode`, `isEmergency`. Both quote and create require a
**customer session**, so the flow must handle signed-out visitors.

The current `/book/[slug]` page takes only a service slug and reads mock data.
Module 2 links to it and tells the visitor on screen that the professional and
time are chosen inside the booking flow — that copy should be removed once this
module lands.

**Also needs `GET /customer/addresses`** (module 4) — `addressId` is required.

---

## Module 4 — Customer ⬜

Source: `src/features/portal/customer-*.tsx` · pages: `/[locale]/account/*`

| Endpoint | Access | Status |
|---|---|---|
| `GET /customer/addresses` | authenticated | ⬜ |
| `POST /customer/addresses` | `CUSTOMER` | ⬜ |
| `PATCH /customer/addresses/:id` | `CUSTOMER` | ⬜ |
| `DELETE /customer/addresses/:id` | `CUSTOMER` | ⬜ |
| `GET /bookings` (customer list) | `CUSTOMER` | ⬜ with module 3 |
| `GET /notifications` | authenticated | ⬜ |
| `POST /notifications/:id/read` | authenticated | ⬜ |
| `POST /notifications/read-all` | authenticated | ⬜ |
| `POST /complaints` | customer | ⬜ |
| `POST /complaints/from-receipt` | customer | ⬜ |
| `GET /complaints` | customer | ⬜ |
| `GET /complaints/:id` | customer | ⬜ |
| `POST /complaints/:id/evidence` | customer | ⬜ |
| `POST /complaints/:id/reply` | customer | ⬜ |

---

## Module 5 — Provider ⬜

Source: `src/features/portal/provider-*.tsx` · pages: `/[locale]/provider/*`

### Expertise and profile

| Endpoint | Access | Status |
|---|---|---|
| `GET /provider/services` | authenticated | ⬜ `/provider/services` |
| `PUT /provider/services/:serviceId` | `PROVIDER` | ⬜ |
| `DELETE /provider/services/:serviceId` | authenticated | ⬜ |
| `GET /provider/service-areas` | `PROVIDER` | ⬜ `/provider/areas` |
| `PUT /provider/service-areas` | `PROVIDER` | ⬜ |
| `GET /provider/profile` | authenticated | ⬜ `/provider/profile` |
| `PATCH /provider/profile` | `PROVIDER` | ⬜ |

### Schedule

| Endpoint | Access | Status |
|---|---|---|
| `GET /provider/availability` | authenticated | ⬜ `/provider/calendar` |
| `PUT /provider/availability` | `PROVIDER` | ⬜ |
| `GET /provider/time-off` | authenticated | ⬜ |
| `POST /provider/time-off` | `PROVIDER` | ⬜ |
| `DELETE /provider/time-off/:id` | `PROVIDER` | ⬜ |

### Reputation

| Endpoint | Access | Status |
|---|---|---|
| `GET /provider/ratings` | authenticated | ⬜ `/provider/ratings` |
| `POST /provider/remarks/:id/reply` | `PROVIDER` | ⬜ |

### Money

| Endpoint | Access | Status |
|---|---|---|
| `GET /provider/earnings` | `PROVIDER` | ⬜ `/provider/earnings` |
| `GET /provider/wallet` | authenticated | ⬜ |
| `GET /provider/payout-accounts` | authenticated | ⬜ |
| `POST /provider/payout-accounts` | `PROVIDER` | ⬜ |
| `GET /provider/payouts` | authenticated | ⬜ `/provider/payouts` |
| `POST /provider/payouts` | `PROVIDER` | ⬜ |
| `POST /provider/debt/pay` | authenticated | ⬜ |

### Work execution

| Endpoint | Access | Status |
|---|---|---|
| `GET /provider/jobs` | provider | ⬜ `/provider`, `/provider/offers`, `/provider/today` |
| `POST /bookings/:id/accept` · `/decline` | provider | ⬜ with module 3 |
| `POST /bookings/:id/quote` | provider | ⬜ `/provider/jobs/[id]` |
| `POST /bookings/:id/evidence` | provider | ⬜ |
| `POST /bookings/:id/complete` | provider | ⬜ |
| `GET /provider/conduct` | authenticated | ⬜ `/provider/conduct` |
| `GET /provider/penalties` · `/:id` | authenticated | ⬜ |
| `POST /provider/penalties/:id/appeal` · `/reply` | authenticated | ⬜ |
| `GET /provider/disputes` · `/:id` | provider | ⬜ |
| `POST /provider/disputes/:id/reply` | `PROVIDER` | ⬜ |

---

## Module 6 — Verification agent ⬜

Source: `src/features/portal/verification-console.tsx` · pages: `/[locale]/agent/*`

| Endpoint | Access | Status |
|---|---|---|
| `GET /agent/queue` | authenticated | ⬜ `/agent` |
| `POST /agent/queue/claim` | authenticated | ⬜ |
| `GET /agent/verifications/:id` | authenticated | ⬜ `/agent/verification/[id]` |
| `GET /agent/verifications/:id/attempts` | authenticated | ⬜ |
| `POST /agent/verifications/:id/attempts` | authenticated | ⬜ |
| `POST /agent/verifications/:id/call` | authenticated | ⬜ |
| `POST /agent/verifications/:id/submit` | authenticated | ⬜ |
| `POST /agent/verifications/:id/release-lock` | authenticated | ⬜ |
| `GET /v/:token` | public link | ⬜ `/verification/[token]` |
| `POST /v/:token` | public link | ⬜ |

---

## Module 7 — Finance ⬜

Source: `src/features/portal/finance-views.tsx` · pages: `/[locale]/finance/*`

| Endpoint | Access | Status |
|---|---|---|
| `GET /finance/escrow` | authenticated | ⬜ `/finance/escrow` |
| `GET /finance/ledger` | authenticated | ⬜ `/finance/ledger` |
| `GET /finance/refunds` · `POST` | authenticated | ⬜ `/finance/refunds` |
| `GET /finance/cash-reconciliation` | authenticated | ⬜ `/finance/cash` |
| `GET /finance/debts` | authenticated | ⬜ `/finance/debts` |
| `GET /finance/payout-batches` · `POST` | authenticated | ⬜ `/finance/payouts` |
| `POST /finance/payout-batches/:id/mark-paid` | authenticated | ⬜ |
| `GET /finance/payout-batches/:id/export.csv` | authenticated | ⬜ |
| `GET /finance/payout-batches/:id/statements/:providerId` | authenticated | ⬜ |
| `POST /finance/reconciliation/run` | authenticated | ⬜ |
| `GET /finance/recordings/:attemptId` | authenticated | ⬜ |

---

## Module 8 — Administration ⬜

Source: `src/features/portal/{admin,staff}-*.tsx` · pages: `/[locale]/admin/*`

### Catalogue and expertise

| Endpoint | Access | Status |
|---|---|---|
| `POST /admin/catalogue/categories` | `ADMIN` | ⬜ `/admin/catalogue` |
| `PATCH /admin/catalogue/categories/:id` | `ADMIN` | ⬜ |
| `POST /admin/catalogue/services` | `ADMIN` | ⬜ |
| `PATCH /admin/catalogue/services/:id` | `ADMIN` | ⬜ |
| `PUT /admin/catalogue/services/:id/checklist` | `ADMIN` | ⬜ |
| `GET /admin/catalogue/commission-rules` | `ADMIN` | ⬜ |
| `POST /admin/catalogue/commission-rules` | `ADMIN` | ⬜ |
| `POST /admin/catalogue/commission-rules/:id/end` | `ADMIN` | ⬜ |
| `GET /admin/provider-services` | `ADMIN` | ⬜ `/admin/approvals` |
| `POST /admin/provider-services/:p/:s/approve` · `/reject` | `ADMIN` | ⬜ |
| `POST /admin/providers/:providerId/approve` · `/reject` | admin | ⬜ `/admin/approvals` |

**This is the write side of the APIs module 2 already reads.** The natural next
step after booking if a smaller module is wanted.

### Complaints, disputes, conduct

| Endpoint | Access | Status |
|---|---|---|
| `GET /admin/complaints` · `/:id` | authenticated | ⬜ `/admin/complaints` |
| `POST /admin/complaints/:id/assign` · `/transition` · `/open-dispute` | authenticated | ⬜ |
| `GET /admin/disputes` · `/:id` | authenticated | ⬜ `/admin/disputes` |
| `POST /admin/disputes/:id/resolve` | authenticated | ⬜ |
| `GET /admin/penalties` · `/:id` | authenticated | ⬜ `/admin/penalties` |
| `POST /admin/penalties` · `/:id/apply` · `/:id/withdraw` | authenticated | ⬜ |
| `GET /admin/appeals` | authenticated | ⬜ `/admin/appeals` |
| `POST /admin/appeals/:id/decide` | authenticated | ⬜ |
| `GET /admin/providers/:providerId/ratings` | admin | ⬜ |
| `POST /admin/remarks/:id/unpublish` | `ADMIN` | ⬜ |

### Everything else

| Endpoint | Access | Status |
|---|---|---|
| `GET /admin/settings` · `/:key` · `PUT /:key` | authenticated | ⬜ `/admin/settings` |
| `GET /admin/templates` · `/:id` · `POST` · `PUT /:id` | authenticated | ⬜ `/admin/templates` |
| `POST /admin/templates/preview` | authenticated | ⬜ |
| `GET /admin/notifications` | authenticated | ⬜ |
| `GET /admin/providers` · `/:id` | authenticated | ⬜ `/admin/providers` |
| `GET /admin/customers` | authenticated | ⬜ `/admin/customers` |
| `GET /admin/reports` | authenticated | ⬜ `/admin/reports` |
| `GET /admin/roles` | authenticated | ⬜ `/admin/roles` |
| `GET /admin/audit` | authenticated | ⬜ `/admin/audit` |
| `GET /admin/plans` | authenticated | ⬜ `/admin/plans`, `/plans` |

> Several admin reads are listed from the module's own docs. Confirm each route
> against `apps/api/src/admin` before wiring — the admin surface is the largest
> and least uniform part of the API.

---

## Cross-cutting and dev-only

| Endpoint | Called? | Note |
|---|---|---|
| `GET /health/live` · `/health/ready` | ✅ `lib/` tooling | Not a page |
| `POST /auth/refresh` | ✅ `lib/api/client.ts` | Already counted in module 1 |
| `GET /dev/inbox` | ➖ | Dev-only mock sender; OTP codes for local testing |
| `GET /dev/storage/:bucket/:key` | ➖ | Dev-only mock storage |
| `GET /dev/payments/:id` · `/complete` | ➖ | Dev-only mock gateway |
| `POST /webhooks/sms/:provider` | ➖ | Inbound webhook, no UI |
| `POST /webhooks/payments/:provider` | ➖ | Inbound webhook, no UI |

---

## Pages still reading mock data

Everything below renders correctly but fabricates its content from
`src/lib/data.ts`. **Do not present any of it as real.**

| Area | Pages |
|---|---|
| Booking | `/book/[slug]` |
| Customer | `/account`, `/account/bookings`, `/account/bookings/[id]`, `/account/addresses`, `/account/favourites`, `/account/plans`, `/account/profile` |
| Provider | `/provider` and all 12 `/provider/*` routes |
| Agent | `/agent`, `/agent/verification/[id]`, `/agent/attempts` |
| Finance | `/finance`, `/finance/escrow`, `/finance/releases`, `/finance/refunds`, `/finance/payouts`, `/finance/cash`, `/finance/debts`, `/finance/ledger` |
| Admin | all 16 `/admin/*` routes |
| Also mock | `/track`, `/verification/[token]`, `/plans`, `/how-verification-works`, `/` (home page sections) |

The home page (`/`) is worth calling out: it reads mock data for its service and
category sections while `/services` reads the API. **Two sources of truth for the
same catalogue.** Module 3 should reconcile that, or the home page will advertise
services the catalogue does not have.

---

## Rules for whoever wires the next module

1. **One typed endpoint module per feature area** — `api.ts` for calls, `queries.ts`
   for the TanStack hooks. No `fetch` in a component.
2. **Query keys must include every response-affecting input.** A provider's slots
   are keyed on provider, service *and* day; a search on service, lat and lng.
3. **`auth: false` on `@Public()` reads.** Never on authenticated ones.
4. **Pass TanStack's `signal` through**, so a superseded request is cancelled
   instead of overwriting a newer one.
5. **Never substitute data for a failure.** A 404 is a not-found state, a 5xx is an
   inline error with a retry. This was a real bug — see
   `BACKEND_REQUIREMENTS.md` "Conflicts already found and resolved".
6. **Add a freshness entry** to `lib/api/keys.ts` with a comment saying why.
7. **Tests in `src/tests/<module>/`**, and `.tsx` tests need `afterEach(cleanup)`.
8. **Update this file** as you go — it is the only place that says what is real.