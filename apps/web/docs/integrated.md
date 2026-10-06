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
5. [Module 3 — Booking ✅](#module-3--booking-)
6. [Module 4 — Customer 🟡](#module-4--customer-)
7. [Module 5 — Provider ⬜](#module-5--provider-)
8. [Module 6 — Verification agent ⬜](#module-6--verification-agent)
9. [Module 7 — Finance ⬜](#module-7--finance-)
10. [Module 8 — Administration ⬜](#module-8--administration-)
11. [Cross-cutting and dev-only](#cross-cutting-and-dev-only)
12. [Pages still reading mock data](#pages-still-reading-mock-data)

---

## 1. How to read this

| Mark | Meaning                                                          |
| ---- | ---------------------------------------------------------------- |
| ✅   | Wired to the real API, verified against the running server       |
| 🟡   | Partly wired — some endpoints of the module are live             |
| ⬜   | Not wired. The page still reads `src/lib/data.ts`                |
| ➖   | Deliberately not for the web app (webhooks, dev tooling, health) |

**"Integrated" means the frontend calls it and renders the response.** It does not
mean the page is finished — several module-3+ pages are visually complete and still
entirely mock.

---

## 2. Summary

| #   | Module                     | Endpoints | Integrated | State                  |
| --- | -------------------------- | --------- | ---------- | ---------------------- |
| 1   | Authentication             | 11        | **11**     | ✅ complete            |
| 2   | Search, Catalogue & Places | 8         | **8**      | ✅ complete            |
| 3   | Booking                    | 12        | **12**     | ✅ complete            |
| 4   | Customer                   | 12        | 7          | 🟡 addresses + profile |
| 5   | Provider                   | 24        | 0          | ⬜ mock                |
| 6   | Verification agent         | 10        | 0          | ⬜ mock                |
| 7   | Finance                    | 17        | 0          | ⬜ mock                |
| 8   | Administration             | 46        | 0          | ⬜ mock                |
| —   | Cross-cutting / dev        | 34        | 3          | see below              |

**36 of 165 endpoints are called by the web app today.** Everything else is either a
later module or not for the browser.

---

## Module 1 — Authentication ✅

Source: `src/features/auth/` · tests: `src/tests/auth/`

| Endpoint                     | Access        | Where it is used                                                     |
| ---------------------------- | ------------- | -------------------------------------------------------------------- |
| `POST /auth/register`        | public        | `register-form.tsx`                                                  |
| `POST /auth/otp/request`     | public        | `verify-otp-form.tsx`, `forgot-form.tsx`                             |
| `POST /auth/otp/verify`      | public        | `verify-otp-form.tsx` (sign-in and account confirm)                  |
| `POST /auth/login`           | public        | `sign-in-form.tsx`                                                   |
| `POST /auth/refresh`         | cookie        | `lib/api/client.ts` — single-flight, never called directly by a page |
| `POST /auth/logout`          | cookie        | `auth-actions.ts`, `sign-out/page.tsx`                               |
| `GET /auth/me`               | cookie        | `session.tsx` — the single `["auth","me"]` query                     |
| `POST /auth/password/forgot` | public        | `forgot-form.tsx`                                                    |
| `POST /auth/password/reset`  | public        | `reset-password-form.tsx`                                            |
| `POST /auth/totp/setup`      | authenticated | `totp-form.tsx`                                                      |
| `POST /auth/totp/verify`     | authenticated | `sign-in-form.tsx`, `totp-form.tsx`                                  |
| `DELETE /auth/totp`          | authenticated | `totp-form.tsx`                                                      |

**Not built:** social sign-in. The Google/Facebook buttons render "Coming soon"
because there is no OAuth surface on the API — see `BACKEND_REQUIREMENTS.md` §1.7.
**Do not** wire them until those endpoints exist.

**Known defect that affects this module:** email OTP delivery returns 500
(`otp.service.ts:84`). The frontend shows the failure inline.

---

## Module 2 — Search, Catalogue & Places ✅

Source: `src/features/{catalogue,places,search,discovery}/` · tests: `src/tests/{services,providers}/`

| Endpoint                                       | Access    | Where it is used                                                         |
| ---------------------------------------------- | --------- | ------------------------------------------------------------------------ |
| `GET /catalogue/categories`                    | `@Public` | `catalogue/api.ts` → catalogue page sidebar + service breadcrumb         |
| `GET /catalogue/categories/:slug/services`     | `@Public` | `catalogue/api.ts` → category listing, and the `listAllServices` fan-out |
| `GET /catalogue/services/:slug`                | `@Public` | `catalogue/api.ts` → service detail page                                 |
| `GET /places/cities`                           | `@Public` | `places/api.ts` → provider search city filter                            |
| `GET /places/cities/:cityId/areas`             | `@Public` | `places/api.ts` → area filter, fetched only after a city is chosen       |
| `GET /search/providers`                        | `@Public` | `search/api.ts` → provider search results                                |
| `GET /search/providers/:providerId`            | `@Public` | `search/api.ts` → provider profile                                       |
| `GET /search/providers/:providerId/reputation` | `@Public` | `search/api.ts` → reputation section                                     |
| `GET /search/providers/:providerId/remarks`    | `@Public` | `search/api.ts` → remarks, loaded separately from the profile            |
| `GET /search/providers/:providerId/slots`      | `@Public` | `search/api.ts` → availability panel                                     |

All ten are `@Public()`, so every call sends `auth: false` and can never trigger a
refresh or a login redirect.

### Two client-side compositions, not endpoints

| Function                        | What it does                                                                     | Why it is not one call                                                                                                             |
| ------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `catalogueApi.listAllServices`  | Fans out: `categories`, then one `categories/:slug/services` per active category | **There is no all-services endpoint on the API.** It fails loudly if any category fails, rather than returning a partial catalogue |
| `apiRequest` refresh-and-replay | On `UNAUTHENTICATED`, refreshes once and replays once                            | Shared client behaviour, not a route                                                                                               |

**If a real `GET /catalogue/services` list endpoint is added**, replace the fan-out
with one call — it is the single biggest improvement available to this module, and
the natural home for the paging and text search `/search/providers` also lacks.

---

## Module 3 — Booking ✅

Source: `src/features/booking/` · addresses: `src/features/account/` · tests: `src/tests/booking/`

**Routes:** `/[locale]/book/[slug]` (the checkout flow) · `/[locale]/account/bookings`
· `/[locale]/account/bookings/[id]`

The previous mock flow is gone. It read `src/lib/data.ts`, so its `serviceId` did
not exist in the database and `POST /bookings` could never have accepted it.

### Checkout

| Endpoint                                   | Access     | Where it is used                                                                 |
| ------------------------------------------ | ---------- | -------------------------------------------------------------------------------- |
| `POST /bookings/quote`                     | `CUSTOMER` | `queries.ts` → `useQuote`, the review step's figures and the cancellation policy |
| `POST /bookings`                           | `CUSTOMER` | `useCreateBooking` → the confirm button, and the payment redirect when ONLINE    |
| `GET /customer/addresses`                  | `CUSTOMER` | `useAddresses` → step one; an empty list opens the inline create form            |
| `POST /customer/addresses`                 | `CUSTOMER` | `useCreateAddress` → the inline create form                                      |
| `GET /places/cities` · `/cities/:id/areas` | `@Public`  | reused from module 2 — `areaId` on a new address must be a real area             |
| `GET /search/providers`                    | `@Public`  | reused from module 2 → the professional list, searched around the chosen address |
| `GET /search/providers/:id/slots`          | `@Public`  | reused from module 2 → real availability for a _named_ professional              |

`POST /bookings/checkout` is an alias of `POST /bookings` and is deliberately
**not** called: one function for one route, and the alias exists only for the
payment-flow documentation.

### After the booking

| Endpoint                                           | Access                  | Where it is used                                                 |
| -------------------------------------------------- | ----------------------- | ---------------------------------------------------------------- |
| `GET /bookings`                                    | `CUSTOMER` / `PROVIDER` | `booking-list.tsx` → `/account/bookings`                         |
| `GET /bookings/:id`                                | `CUSTOMER` / `PROVIDER` | `booking-detail.tsx` → `/account/bookings/[id]`                  |
| `POST /bookings/:id/cancel`                        | either                  | the cancel card, shown only where the transition table allows it |
| `POST /bookings/:id/reschedule`                    | `CUSTOMER`              | the reschedule panel, picking a new slot from live availability  |
| `POST /bookings/:id/revisions/approve` · `/reject` | `CUSTOMER`              | the revision card, only while `status === "QUOTE_REVISION"`      |
| `POST /bookings/:id/evidence`                      | either                  | problem photos, only before the visit begins                     |
| `GET /bookings/:id/evidence`                       | either                  | available in `bookingApi`; the page shows uploads, not a gallery |
| `POST /bookings/:id/warranty-claim`                | `CUSTOMER`              | the warranty card, only for a released booking                   |
| `POST /bookings/:id/no-show`                       | either                  | the no-show card, only while `EN_ROUTE`                          |
| `GET` · `POST /bookings/:id/messages`              | either                  | `booking-chat.tsx` — FR-BK-07                                    |

Plus one route that exists because the API names it: `app/[locale]/checkout/return`
is the gateway's `returnUrl`, hardcoded server-side as
`/checkout/return?bookingId=…`. It was a 404 until the frontend added it — see
`BACKEND_REQUIREMENTS.md` §3.7.

### Four decisions worth knowing before editing this module

1. **The server prices the booking; this app never does.** `POST /bookings/quote`
   and `POST /bookings` both run `PricingService.price()`, so what the customer
   agreed to and what they are charged can only differ if the basket changed.
   The catalogue's `basePricePaisa` appears in the sidebar labelled as a _guide_.
   A locally computed total next to the server's would be two sources of truth
   for one number.

2. **`providerId` is optional, and that is a product choice.** Omitted, the
   booking is auto-assigned: offered to ranked professionals one at a time until
   one accepts (FR-SR-07), `UNFULFILLED` — and refunded — if nobody does. **A
   slot cannot be shown on that path**, because `/slots` is keyed on a provider
   who has not accepted yet. So the flow offers a _requested_ window and says on
   screen that nothing is held. A chosen professional gets real slots instead.

3. **`GET /bookings` has no paging and no cursor.** It takes one optional
   `status` and returns everything. There is no pager, and a "load more" over an
   already-complete response would be a control that does nothing.

4. **A booking row carries no readable names.** `BOOKING_COLUMNS` projects ids and
   money only — no service name, no provider name, no address text. The list joins
   `serviceId` against the catalogue (`service-names.ts`); a service the catalogue
   no longer publishes shows an honest placeholder rather than a bare number. The
   detail page has **no** way to show the address — see
   `BACKEND_REQUIREMENTS.md` §3.4.

### Not wired, deliberately

| Endpoint                                                                                         | Why                                                                                                                |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `POST /bookings/:id/accept` · `/decline` · `/depart` · `/start` · `/complete` · `/cash-received` | `PROVIDER`-role; these are the provider workspace, module 5                                                        |
| `POST /bookings/:id/checklist/:itemId` · `/revisions`                                            | provider job execution, module 5                                                                                   |
| `POST /bookings/:id/quote`                                                                       | listed in module 5's own docs; no route of that name exists on the controller — see `BACKEND_REQUIREMENTS.md` §3.3 |

---

## Module 4 — Customer 🟡

Source: `features/portal/customer-*.tsx` · pages: `/[locale]/account/*`

Addresses are wired because booking cannot start without one — `POST /bookings`
takes an `addressId`. Everything else here is still mock.

| Endpoint                         | Access        | Status                                                                                      |
| -------------------------------- | ------------- | ------------------------------------------------------------------------------------------- |
| `GET /customer/addresses`        | `CUSTOMER`    | ✅ `account/api.ts` — booking step one and the full `/account/addresses` list               |
| `POST /customer/addresses`       | `CUSTOMER`    | ✅ `useCreateAddress` — the inline form in the booking flow and on the address book         |
| `PATCH /customer/addresses/:id`  | `CUSTOMER`    | ✅ `AddressForm` in edit mode, and "make default"                                           |
| `DELETE /customer/addresses/:id` | `CUSTOMER`    | ✅ `useArchiveAddress`, behind an inline confirmation                                       |
| `GET /auth/me`                   | cookie        | ✅ `profile-view.tsx` — the profile screen, with the phone and email **masked** (NFR-PR-01) |
| `GET /notifications`             | authenticated | ⬜                                                                                          |
| `POST /notifications/:id/read`   | authenticated | ⬜                                                                                          |
| `POST /notifications/read-all`   | authenticated | ⬜                                                                                          |
| `POST /complaints`               | customer      | ⬜                                                                                          |
| `POST /complaints/from-receipt`  | customer      | ⬜                                                                                          |
| `GET /complaints`                | customer      | ⬜                                                                                          |
| `GET /complaints/:id`            | customer      | ⬜                                                                                          |
| `POST /complaints/:id/evidence`  | customer      | ⬜                                                                                          |
| `POST /complaints/:id/reply`     | customer      | ⬜                                                                                          |

`GET /bookings` and `GET /bookings/:id` are listed in this module's original
table but were built with module 3, since they are the same resource.

### Three things this module deliberately does not do

1. **No password-change screen.** The API publishes no authenticated
   password-update route, so `/account/security` carries TOTP enrolment only.
   A disabled "change password" button would be a promise the backend cannot
   keep — see `BACKEND_REQUIREMENTS.md` §1.
2. **No pin drop on the address form.** `areas.centroid` is not selected by the
   places API (§2.2), so an area cannot become a point. The form offers exactly
   two labelled sources — the device's own location, or the city-centre
   approximation — and says plainly that neither is the person's exact address.
3. **The profile shows masked contact details.** The numbers are the reader's
   own, but every other screen in the product masks them, and a screen that
   prints one in full is a screen that eventually leaks one.

---

## Module 4 — Customer 🟡

Source: `src/features/portal/customer-*.tsx` · pages: `/[locale]/account/*`

Addresses are wired because booking cannot start without one — `POST /bookings`
takes an `addressId`. Everything else on these pages is still mock.

| Endpoint                         | Access        | Status                                                          |
| -------------------------------- | ------------- | --------------------------------------------------------------- |
| `GET /customer/addresses`        | `CUSTOMER`    | ✅ `account/api.ts` — booking step one and `/account/addresses` |
| `POST /customer/addresses`       | `CUSTOMER`    | ✅ `useCreateAddress` — the inline form in the booking flow     |
| `PATCH /customer/addresses/:id`  | `CUSTOMER`    | 🟡 typed in `accountApi`, not yet rendered                      |
| `DELETE /customer/addresses/:id` | `CUSTOMER`    | 🟡 typed in `accountApi`, not yet rendered                      |
| `GET /notifications`             | authenticated | ⬜                                                              |
| `POST /notifications/:id/read`   | authenticated | ⬜                                                              |
| `POST /notifications/read-all`   | authenticated | ⬜                                                              |
| `POST /complaints`               | customer      | ⬜                                                              |
| `POST /complaints/from-receipt`  | customer      | ⬜                                                              |
| `GET /complaints`                | customer      | ⬜                                                              |
| `GET /complaints/:id`            | customer      | ⬜                                                              |
| `POST /complaints/:id/evidence`  | customer      | ⬜                                                              |
| `POST /complaints/:id/reply`     | customer      | ⬜                                                              |

`GET /bookings` and `GET /bookings/:id` were listed in this module's original
table but were built with module 3 — they are the same resource, and a customer
who cannot see the booking they just made has not really booked anything.

---

## Module 5 — Provider ⬜

Source: `src/features/portal/provider-*.tsx` · pages: `/[locale]/provider/*`

### Expertise and profile

| Endpoint                               | Access        | Status                  |
| -------------------------------------- | ------------- | ----------------------- |
| `GET /provider/services`               | authenticated | ⬜ `/provider/services` |
| `PUT /provider/services/:serviceId`    | `PROVIDER`    | ⬜                      |
| `DELETE /provider/services/:serviceId` | authenticated | ⬜                      |
| `GET /provider/service-areas`          | `PROVIDER`    | ⬜ `/provider/areas`    |
| `PUT /provider/service-areas`          | `PROVIDER`    | ⬜                      |
| `GET /provider/profile`                | authenticated | ⬜ `/provider/profile`  |
| `PATCH /provider/profile`              | `PROVIDER`    | ⬜                      |

### Schedule

| Endpoint                        | Access        | Status                  |
| ------------------------------- | ------------- | ----------------------- |
| `GET /provider/availability`    | authenticated | ⬜ `/provider/calendar` |
| `PUT /provider/availability`    | `PROVIDER`    | ⬜                      |
| `GET /provider/time-off`        | authenticated | ⬜                      |
| `POST /provider/time-off`       | `PROVIDER`    | ⬜                      |
| `DELETE /provider/time-off/:id` | `PROVIDER`    | ⬜                      |

### Reputation

| Endpoint                           | Access        | Status                 |
| ---------------------------------- | ------------- | ---------------------- |
| `GET /provider/ratings`            | authenticated | ⬜ `/provider/ratings` |
| `POST /provider/remarks/:id/reply` | `PROVIDER`    | ⬜                     |

### Money

| Endpoint                         | Access        | Status                  |
| -------------------------------- | ------------- | ----------------------- |
| `GET /provider/earnings`         | `PROVIDER`    | ⬜ `/provider/earnings` |
| `GET /provider/wallet`           | authenticated | ⬜                      |
| `GET /provider/payout-accounts`  | authenticated | ⬜                      |
| `POST /provider/payout-accounts` | `PROVIDER`    | ⬜                      |
| `GET /provider/payouts`          | authenticated | ⬜ `/provider/payouts`  |
| `POST /provider/payouts`         | `PROVIDER`    | ⬜                      |
| `POST /provider/debt/pay`        | authenticated | ⬜                      |

### Work execution

| Endpoint                                                                                         | Access        | Status                                                                                  |
| ------------------------------------------------------------------------------------------------ | ------------- | --------------------------------------------------------------------------------------- |
| `GET /provider/jobs`                                                                             | provider      | ⬜ `/provider`, `/provider/offers`, `/provider/today`                                   |
| `POST /bookings/:id/accept` · `/decline` · `/depart` · `/start` · `/complete` · `/cash-received` | provider      | ⬜ with module 5 — typed in `bookingApi`, no UI yet                                     |
| `POST /bookings/:id/quote`                                                                       | provider      | ⬜ `/provider/jobs/[id]` — **no such route exists**; see `BACKEND_REQUIREMENTS.md` §3.3 |
| `POST /bookings/:id/evidence` · `GET /bookings/:id/evidence`                                     | provider      | 🟡 typed in `bookingApi`; the customer side is built, the provider side is not          |
| `POST /bookings/:id/checklist/:itemId` · `/revisions`                                            | provider      | ⬜                                                                                      |
| `GET /bookings` · `/bookings/:id` · `/messages`                                                  | either        | ✅ built with module 3                                                                  |
| `GET /provider/conduct`                                                                          | authenticated | ⬜ `/provider/conduct`                                                                  |
| `GET /provider/penalties` · `/:id`                                                               | authenticated | ⬜                                                                                      |
| `POST /provider/penalties/:id/appeal` · `/reply`                                                 | authenticated | ⬜                                                                                      |
| `GET /provider/disputes` · `/:id`                                                                | provider      | ⬜                                                                                      |
| `POST /provider/disputes/:id/reply`                                                              | `PROVIDER`    | ⬜                                                                                      |

---

## Module 6 — Verification agent ⬜

Source: `src/features/portal/verification-console.tsx` · pages: `/[locale]/agent/*`

| Endpoint                                     | Access        | Status                        |
| -------------------------------------------- | ------------- | ----------------------------- |
| `GET /agent/queue`                           | authenticated | ⬜ `/agent`                   |
| `POST /agent/queue/claim`                    | authenticated | ⬜                            |
| `GET /agent/verifications/:id`               | authenticated | ⬜ `/agent/verification/[id]` |
| `GET /agent/verifications/:id/attempts`      | authenticated | ⬜                            |
| `POST /agent/verifications/:id/attempts`     | authenticated | ⬜                            |
| `POST /agent/verifications/:id/call`         | authenticated | ⬜                            |
| `POST /agent/verifications/:id/submit`       | authenticated | ⬜                            |
| `POST /agent/verifications/:id/release-lock` | authenticated | ⬜                            |
| `GET /v/:token`                              | public link   | ⬜ `/verification/[token]`    |
| `POST /v/:token`                             | public link   | ⬜                            |

---

## Module 7 — Finance ⬜

Source: `src/features/portal/finance-views.tsx` · pages: `/[locale]/finance/*`

| Endpoint                                                 | Access        | Status                |
| -------------------------------------------------------- | ------------- | --------------------- |
| `GET /finance/escrow`                                    | authenticated | ⬜ `/finance/escrow`  |
| `GET /finance/ledger`                                    | authenticated | ⬜ `/finance/ledger`  |
| `GET /finance/refunds` · `POST`                          | authenticated | ⬜ `/finance/refunds` |
| `GET /finance/cash-reconciliation`                       | authenticated | ⬜ `/finance/cash`    |
| `GET /finance/debts`                                     | authenticated | ⬜ `/finance/debts`   |
| `GET /finance/payout-batches` · `POST`                   | authenticated | ⬜ `/finance/payouts` |
| `POST /finance/payout-batches/:id/mark-paid`             | authenticated | ⬜                    |
| `GET /finance/payout-batches/:id/export.csv`             | authenticated | ⬜                    |
| `GET /finance/payout-batches/:id/statements/:providerId` | authenticated | ⬜                    |
| `POST /finance/reconciliation/run`                       | authenticated | ⬜                    |
| `GET /finance/recordings/:attemptId`                     | authenticated | ⬜                    |

---

## Module 8 — Administration ⬜

Source: `src/features/portal/{admin,staff}-*.tsx` · pages: `/[locale]/admin/*`

### Catalogue and expertise

| Endpoint                                                  | Access  | Status                |
| --------------------------------------------------------- | ------- | --------------------- |
| `POST /admin/catalogue/categories`                        | `ADMIN` | ⬜ `/admin/catalogue` |
| `PATCH /admin/catalogue/categories/:id`                   | `ADMIN` | ⬜                    |
| `POST /admin/catalogue/services`                          | `ADMIN` | ⬜                    |
| `PATCH /admin/catalogue/services/:id`                     | `ADMIN` | ⬜                    |
| `PUT /admin/catalogue/services/:id/checklist`             | `ADMIN` | ⬜                    |
| `GET /admin/catalogue/commission-rules`                   | `ADMIN` | ⬜                    |
| `POST /admin/catalogue/commission-rules`                  | `ADMIN` | ⬜                    |
| `POST /admin/catalogue/commission-rules/:id/end`          | `ADMIN` | ⬜                    |
| `GET /admin/provider-services`                            | `ADMIN` | ⬜ `/admin/approvals` |
| `POST /admin/provider-services/:p/:s/approve` · `/reject` | `ADMIN` | ⬜                    |
| `POST /admin/providers/:providerId/approve` · `/reject`   | admin   | ⬜ `/admin/approvals` |

**This is the write side of the APIs module 2 already reads.** The natural next
step after booking if a smaller module is wanted.

### Complaints, disputes, conduct

| Endpoint                                                              | Access        | Status                 |
| --------------------------------------------------------------------- | ------------- | ---------------------- |
| `GET /admin/complaints` · `/:id`                                      | authenticated | ⬜ `/admin/complaints` |
| `POST /admin/complaints/:id/assign` · `/transition` · `/open-dispute` | authenticated | ⬜                     |
| `GET /admin/disputes` · `/:id`                                        | authenticated | ⬜ `/admin/disputes`   |
| `POST /admin/disputes/:id/resolve`                                    | authenticated | ⬜                     |
| `GET /admin/penalties` · `/:id`                                       | authenticated | ⬜ `/admin/penalties`  |
| `POST /admin/penalties` · `/:id/apply` · `/:id/withdraw`              | authenticated | ⬜                     |
| `GET /admin/appeals`                                                  | authenticated | ⬜ `/admin/appeals`    |
| `POST /admin/appeals/:id/decide`                                      | authenticated | ⬜                     |
| `GET /admin/providers/:providerId/ratings`                            | admin         | ⬜                     |
| `POST /admin/remarks/:id/unpublish`                                   | `ADMIN`       | ⬜                     |

### Everything else

| Endpoint                                              | Access        | Status                      |
| ----------------------------------------------------- | ------------- | --------------------------- |
| `GET /admin/settings` · `/:key` · `PUT /:key`         | authenticated | ⬜ `/admin/settings`        |
| `GET /admin/templates` · `/:id` · `POST` · `PUT /:id` | authenticated | ⬜ `/admin/templates`       |
| `POST /admin/templates/preview`                       | authenticated | ⬜                          |
| `GET /admin/notifications`                            | authenticated | ⬜                          |
| `GET /admin/providers` · `/:id`                       | authenticated | ⬜ `/admin/providers`       |
| `GET /admin/customers`                                | authenticated | ⬜ `/admin/customers`       |
| `GET /admin/reports`                                  | authenticated | ⬜ `/admin/reports`         |
| `GET /admin/roles`                                    | authenticated | ⬜ `/admin/roles`           |
| `GET /admin/audit`                                    | authenticated | ⬜ `/admin/audit`           |
| `GET /admin/plans`                                    | authenticated | ⬜ `/admin/plans`, `/plans` |

> Several admin reads are listed from the module's own docs. Confirm each route
> against `apps/api/src/admin` before wiring — the admin surface is the largest
> and least uniform part of the API.

---

## Cross-cutting and dev-only

| Endpoint                              | Called?                | Note                                              |
| ------------------------------------- | ---------------------- | ------------------------------------------------- |
| `GET /health/live` · `/health/ready`  | ✅ `lib/` tooling      | Not a page                                        |
| `POST /auth/refresh`                  | ✅ `lib/api/client.ts` | Already counted in module 1                       |
| `GET /dev/inbox`                      | ➖                     | Dev-only mock sender; OTP codes for local testing |
| `GET /dev/storage/:bucket/:key`       | ➖                     | Dev-only mock storage                             |
| `GET /dev/payments/:id` · `/complete` | ➖                     | Dev-only mock gateway                             |
| `POST /webhooks/sms/:provider`        | ➖                     | Inbound webhook, no UI                            |
| `POST /webhooks/payments/:provider`   | ➖                     | Inbound webhook, no UI                            |

---

## Pages still reading mock data

Everything below renders correctly but fabricates its content from
`src/lib/data.ts`. **Do not present any of it as real.**

| Area      | Pages                                                                                                                                                                                |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Booking   | **none** — `/book/[slug]`, `/account/bookings` and `/account/bookings/[id]` are all on the API                                                                                       |
| Customer  | `/account`, `/account/favourites`, `/account/plans`. `/account/profile` and `/account/addresses` are now on the API; `/account/security` is TOTP-only, which is all the API supports |
| Provider  | `/provider` and all 12 `/provider/*` routes                                                                                                                                          |
| Agent     | `/agent`, `/agent/verification/[id]`, `/agent/attempts`                                                                                                                              |
| Finance   | `/finance`, `/finance/escrow`, `/finance/releases`, `/finance/refunds`, `/finance/payouts`, `/finance/cash`, `/finance/debts`, `/finance/ledger`                                     |
| Admin     | all 16 `/admin/*` routes                                                                                                                                                             |
| Also mock | `/track`, `/verification/[token]`, `/plans`, `/how-verification-works`, and the home page's **trust-metric band** (see below)                                                        |

One follow-up module 3 leaves, because the API does not expose what the page
needs:

- **`/account` still reads mock bookings** while `/account/bookings` reads the
  API. Two sources of truth for one customer's bookings. Wiring `CustomerDashboard`
  to `GET /bookings` is a small job and belongs with the rest of module 4.

### The home page trust band, and why it is still mock

`BrandTrustSection` renders four figures — professionals, average rating,
completed jobs, areas covered. It computed all four from the mock `providers`
array, which meant the "4.9 / 5" on the front page was an average of three
invented people, and the hero badge asserted the same number as a literal.

There is no endpoint that answers "how many professionals are there" or "what is
the platform-wide average rating" — `/search/providers` is a ranked, paginated,
location-filtered search, not a platform statistic. So the band still reads
`lib/data.ts`.

**Do not present these four figures as real.** Either wire a genuine statistics
endpoint or remove the band; a trust figure invented from a fixture is worse
than no trust figure, because it is the number a visitor checks first.

---

## Rules for whoever wires the next module

1. **One typed endpoint module per feature area** — `api.ts` for calls, `queries.ts`
   for the TanStack hooks. No `fetch` in a component.
2. **Query keys must include every response-affecting input.** A provider's slots
   are keyed on provider, service _and_ day; a search on service, lat and lng.
3. **`auth: false` on `@Public()` reads.** Never on authenticated ones.
4. **Pass TanStack's `signal` through**, so a superseded request is cancelled
   instead of overwriting a newer one.
5. **Never substitute data for a failure.** A 404 is a not-found state, a 5xx is an
   inline error with a retry. This was a real bug — see
   `BACKEND_REQUIREMENTS.md` "Conflicts already found and resolved".
6. **Add a freshness entry** to `lib/api/keys.ts` with a comment saying why.
7. **Tests in `src/tests/<module>/`**, and `.tsx` tests need `afterEach(cleanup)`.
8. **Update this file** as you go — it is the only place that says what is real.
9. **Never compute a price the API prices.** `POST /bookings/quote` and
   `POST /bookings` share one `PricingService.price()`, so a locally derived
   total can only ever disagree with the server about what is owed.
10. **A status with no name must not reach the screen.** `bookingStatus` in
    `dictionaries.ts` covers all 22 values of `booking_status`. Adding an enum
    value without a label would render `SCREAMING_SNAKE` to a customer.
