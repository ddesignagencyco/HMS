# Backend Report — HMS Platform
## From Frontend QA, 2026-10-12

**To:** Backend development team (`apps/api`, `packages/db`)
**From:** Frontend engineering & QA
**Scope:** Contract audit of the pulled backend code against `docs/backend_requirement.md`, plus every defect found on the frontend that the backend is the root cause of.

**Read the two headline numbers first:**

1. **The P0 list in `backend_requirement.md` is essentially untouched.** Of 14 numbered requirements (P0.1–P0.6, P1.1–P1.7, P2.2–P2.5), **3 are satisfied, 3 partial, 8 unmet.** The last commit to touch `apps/api` or `packages` is `079d568` (2026-10-12, a merge of `backend-dev`) and it delivered none of them.
2. **We found and fixed 3 contract mismatches on our side** that were shipping wrong numbers to customers. Those are in §3 and need a decision from you, because two of them are ambiguous between "frontend bug" and "backend inconsistency".

Everything below was verified by reading the current backend source. Nothing is carried over from the previous report without re-checking it — and §5 lists seven statements in our own doc that are now **stale and wrong**, which you should ignore.

---

## 1. Requirement status, verified against current code

| ID | Requirement | Status |
|---|---|---|
| **P0.1** | `photos[]` accepted by `POST /bookings`, `job_evidence` written in the same transaction | ❌ **UNMET** |
| **P0.2** | `avatar_key` columns, `POST /me/avatar`, `POST /provider/avatar`, `avatarUrl` in responses | ❌ **UNMET** |
| **P0.3** | `GET /search/providers` joins `users` and returns the provider's name | ❌ **UNMET** |
| **P0.4** | Production storage URLs / streaming instead of dev JSON envelopes | ❌ **UNMET** |
| **P0.5** | Provider can preview their own identity documents | ❌ **UNMET** |
| **P0.6** | `icon_url` / `cover_image_url` on categories and services | ❌ **UNMET** |
| **P1.1** | `serviceSlug`/`lat`/`lng` optional; allow `cityId`/`areaId` | ❌ **UNMET** |
| **P1.2** | Server-side sort / filter / pagination on provider search | ❌ **UNMET** |
| **P1.3** | Standard pagination envelope | ❌ **UNMET** |
| **P1.4** | Pagination on 17 high-volume endpoints | ⚠️ **1 of 17** |
| **P1.5** | `GET /admin/providers?status=PENDING_APPROVAL` approval queue | ❌ **UNMET** |
| **P1.6** | `GET /admin/bookings` platform-wide directory | ❌ **UNMET** |
| **P1.7** | Admin checklist-items reader | ⚠️ **PARTIAL** |
| **P2.2** | `GET /admin/reports` | ❌ **UNMET** |
| **P2.3** | Admin audit-log reader | ⚠️ **PARTIAL** (wrong path) |
| **P2.4** | Roles & permissions API | ⚠️ **PARTIAL** (wrong verb/path) |
| **P2.5** | Public feed of verified recent reviews | ❌ **UNMET** |

### 1.1 The four P0s that block real product work

**P0.1 — photos on booking creation.** `bookingCreateSchema` (`apps/api/src/booking/booking.schemas.ts:5-33`) has no `photos` key and is still `.strict()` at line 32, so a photo-bearing create is a `422 VALIDATION_FAILED` with `unrecognized_keys`. `booking.service.ts:136-169` opens a transaction that inserts `bookings`, `booking_items`, `booking_status_history` and the payment/coupon rows — and **zero** `job_evidence` rows.

This one is now actively harmful rather than merely missing. We had to build a workaround: the booking flow uploads photos **after** the booking is created, via a separate `POST /bookings/:id/evidence` call per photo. That means a booking exists, and is visible to the professional, before its photos do. If the upload fails the customer has a real booking with no evidence of the problem, and we show them an error saying "nothing was recorded" when in fact the booking was.

> **Request:** accept `photos: [{ contentType, contentBase64 }]` on `POST /bookings` and write the `job_evidence` rows inside the existing transaction.

**P0.2 — avatars.** There is no avatar route anywhere in `apps/api`, and no `avatarKey`/`avatarUrl` string exists in the repo at all. `me.controller.ts:12` has only GET/PATCH/PATCH-password/POST-deactivate/favourites. `users` in `packages/db/prisma/schema.prisma:1204-1221` has no photo column.

Consequence: **every avatar in the product is a letter monogram** — headers, customer profile, provider dashboard, reviews, chat threads, search cards. On a marketplace whose entire value proposition is trusting a stranger to enter your home, "who is this person" is answered with initials.

> **Request:** `avatar_key` on `users` and `providers`, `POST /me/avatar` and `POST /provider/avatar`, and `avatarUrl` on `GET /auth/session`, `GET /me`, `GET /search/providers`, `GET /search/providers/:id`.

**P0.3 — provider name in search.** `search.service.ts:205-220` joins `providers p` to `provider_services ps` plus a ratings lateral. **There is no `JOIN users`** — confirmed at line 211. `ProviderSearchResultRow` (`search.service.ts:11-22`) is exactly nine fields, none of them a name.

> ⚠️ **This one needs a decision from both teams.** `apps/web/src/tests/providers/search-contract.test.ts:30-35` **actively asserts** that `name`, `firstName`, `lastName`, `displayName`, `photoUrl`, `imageUrl` and `photoKey` are *absent* from the search row, with the comment "so neither may be rendered." That test was written to stop us inventing names client-side, and it is doing its job. If you add the fields, **that test must change in the same PR** or CI goes red on the frontend for a backend change. Flagging it so it is not discovered as a surprise.
>
> Note `providers.photo_key` already exists in `schema.prisma:889` but is **dead** — nothing in `apps/api` reads or writes it.

**P0.4 — production storage.** `dev.controller.ts:46-58` still returns `{ contentType, sizeBytes, contentBase64 }` as JSON. There is no `GET /storage/:bucket/:key` streaming route. `presignGet` is used only for provider documents (`provider-documents.service.ts:134`) and call recordings (`recording.service.ts:45`).

Every image in the app therefore loads through a base64 JSON round trip. We wrote `EvidenceImage` (`apps/web/src/components/evidence-image.tsx`) to unwrap that envelope into a `data:` URL — but a `data:` URL means the base64 payload ships inside the HTML, so a grid of 20 evidence tiles inlines the whole image set into the document. It works; it is not how images should be delivered.

### 1.2 P1.5 and P1.6 are missing whole surfaces

- **P1.5:** both controllers mounted at `@Controller('admin/providers')` (`provider-approval-admin.controller.ts:11`, `provider-admin.controller.ts:8`) expose **only `@Post`** — approve, reject, block, unblock, deactivate. **There is no `@Get`.** There is no way to list providers awaiting approval.
- **P1.6:** nothing is mounted at `admin/bookings`. `booking.controller.ts:358-369` `@Get()` is scoped to `['CUSTOMER','PROVIDER']` and delegates to `listMine`, which filters `b.customer_id = … OR b.provider_id = …`. An administrator cannot list platform bookings.

### 1.3 P1.3 / P1.4 — pagination is the systemic one

Grepping `apps/api/src` for `pagination`, `pageSize`, `totalPages` or `hasMore` returns **no matches**. No endpoint returns the Standard A envelope.

**Worse, the one endpoint that does paginate does it inconsistently with its own spec.** `GET /finance/ledger` is the only genuinely cursor-paged endpoint, and it returns `{ items, nextBefore }` with `nextBefore` as a **sibling** of `items` (`finance.service.ts:116`) — not nested under `pagination` as `backend_requirement.md` P1.3 specifies. Any client written to the documented shape reads `undefined` there. It also omits `prevAfter`, `hasMore` and `totalCount`.

Of the 17 endpoints listed in P1.4:

- `GET /finance/ledger` — cursor, but wrong shape (above)
- `GET /finance/debts` — **no `LIMIT` at all** (`finance.service.ts:95-102`)
- `GET /bookings` — **no `LIMIT` at all** (`booking.service.ts:734-742`)
- `GET /finance/escrow` — hardcoded `LIMIT 500`, no params accepted
- `GET /finance/cash-reconciliation` — hardcoded `LIMIT 500`, no params
- `GET /finance/refunds`, `/finance/payouts`, `/admin/disputes`, `/complaints` — **already have a working `status` filter**, `LIMIT 200` (our doc says the filter is missing; it is not)
- `GET /agent/queue` — `LIMIT 200`, no query params
- `GET /notifications` — `unread` + `limit` only, **no `before` cursor**, no `X-Unread-Count` header (the count is in the body instead)
- `GET /provider/ratings` — `LIMIT 200`, no filters
- `GET /admin/customers` — `q` + `limit` exist; `status` filter, `page` and envelope do not
- `GET /search/providers` — `{ items }` only, no metadata whatsoever

Unbounded `GET /bookings` and `GET /finance/debts` are the two that will hurt first: a customer with a long history and a finance screen with a large debt ledger are both single queries that grow without limit.

### 1.4 P1.7, P2.3, P2.4 — near misses

These three exist but not in the documented shape, so a client written to the doc still fails:

| ID | Doc asks for | Reality |
|---|---|---|
| P1.7 | `GET /admin/catalogue/services/:id/checklist` | Only `@Put` exists on the admin controller (line 69). **No `@Get`** — but the checklist *is* readable via `GET /catalogue/services/:slug` and `GET /bookings/:id/checklist`, so this is low priority. |
| P2.3 | `GET /admin/audit-logs` | Route is **`GET /admin/audit`** (`admin-audit.controller.ts:11,15`). All filters work. **No `before` cursor** — hard `ORDER BY id DESC LIMIT n`, and the response is a bare `{ items }` with no `nextBefore` or `totalCount`. |
| P2.4 | `GET /admin/roles` + `PATCH /admin/users/:id/role` | `GET /admin/roles` is **exactly right** (`admin-roles.controller.ts:14-19`), with real `role_permissions` backing (`admin.service.ts:104-135`). Assignment is `POST /admin/users/:userId/roles/:roleCode` + `DELETE` — **different verb, different path.** |

These are cheap to align. If the doc is the contract, change the routes; if the routes are the contract, say so and we will follow them. **We need a ruling on which is authoritative**, because right now we are guessing per endpoint.

---

## 2. Frontend defects found and fixed during this QA pass

All fixed and committed-ready on `apps/web`. Listed because several are *symptoms* of the gaps above, and you should know what we had to do about them.

### 2.1 The money screens were showing invented money — fixed, and this is the most serious thing in this report

`features/portal/finance-views.tsx` held **four** hardcoded datasets and rendered them whenever an API read came back **empty *or* failed**:

| Dataset | What was invented |
|---|---|
| `fallbackRefunds` | 3 refunds, booking codes `SHM-0001031/32/36`, amounts, statuses |
| `fallbackPayouts` | 5 payouts, invented provider names ("Ahmad Plumbing Works") |
| `fallbackCash` | 3 cash settlements with invented commission figures |
| `defaultEntries` | 10 double-entry ledger transactions, built **balanced on purpose** |

The payouts table rendered a **live "Approve" button** against those invented rows — so an operator could attempt a real ledger write keyed on an id like `po-2042` that exists nowhere. The ledger screen computed its chart of accounts and a **"Balanced 10 / 10" badge over the invented set, unconditionally** — even when the real query succeeded and returned nothing, and it had no error branch at all.

Also invented: a hardcoded `500000` paisa debt ceiling that then **decided whether a professional's offers were shown "Blocked"**, and a provider share computed as `heldPaisa - round(heldPaisa * 0.12)` — a hardcoded 12% commission printed as fact.

All removed. Failures now render as failures; empty renders as empty; the balance claim is gone entirely — see §3.3 for why we could not honestly recompute it.

### 2.2 The escrow-release console fabricated the basis for releasing a customer's money — fixed

`features/portal/verification-console.tsx`, the screen an agent uses to release held funds, invented:

- a rating of `"4.9"` and `"12"` verified jobs when the API sent none
- an escrow account id, by pasting the booking code into a fabricated `ESCROW-` prefix
- **"Start OTP Check: Verified"** — hardcoded, on the one screen whose purpose is deciding whether to release
- `"2 Uploads"` when zero photos existed, and **two Unsplash stock photographs captioned "Before" and "After (Resolved)"** as work evidence
- "Recording active (Encrypted telephony)" over four `animate-pulse` divs that were not a waveform — no recording is started from that screen
- a frozen `useState("01:24")` timer posted to the API as `durationSeconds: 84`

And the submit handler, which writes to the verification record permanently, filled every required field with a constant:

```
workCompleted: outcome === "REWORK" ? "PARTIAL" : "FULL",
quality: outcome === "SATISFIED" ? 5 : ... ,
extraChargeDemanded: false, uniformWorn: true, ownTools: true,
callDurationSeconds: callActive ? 84 : 0,
```

All four questions were also **pre-answered "yes"** in state and in the `<SelectField>` fallback, so an agent could open a call and press submit having recorded that the professional arrived on time, explained the work, resolved the issue and cleaned up.

All fixed. The fields are now unanswered on open, the commit button is disabled until every one is answered, the timer measures real elapsed seconds, and the "before/after" panel says no evidence was uploaded.

> **This is worth your attention as a design question, not just a frontend bug.** Your own `QUESTIONNAIRE` (`apps/api/src/verification/verification-console.service.ts:17-25`) already defines these questions and `submitSchema` already requires the answers. The console was not rendering your questionnaire — it was inventing values to satisfy it. If you would rather the console drive itself from `QUESTIONNAIRE`, that is the right architecture and we would support it.

### 2.3 Other fixed defects, by area

- **Plans (`GET /me/subscriptions`)** — the frontend read `totalVisits`; the API sends **`visitCount`** (`plans.service.ts:428-435` destructures the SQL alias away and renames it). `formatNumber(undefined)` rendered the literal string **"NaN"** on the customer's own plan screen, in two places. See §3.1 — this one is genuinely ambiguous and we want your ruling.
- **`CancelResult`** — frontend typed `id`; API sends `subscriptionId` (`plans.service.ts:578-583`).
- **Plans page crashed on build** — `app/[locale]/(public)/plans/page.tsx` still held the old invented tiers at Rs 4,900 / 8,900 / 14,900 and referenced an unimported `PlansCatalogue`. It was a typecheck error *and* a lint error. Replaced with the real catalogue.
- **`adminKeys.plans` did not exist** in `lib/api/keys.ts`; five call sites referenced it. Added.
- **A failed catalogue read rendered as "No results found"** — `catalogue-explorer.tsx:193` used `isError = categoriesQuery.isError && servicesQuery.isError`, so a services-only failure fell through to the empty state. Changed to `||`.
- **A failed reputation read spun forever** — `profile-sections.tsx` checked the skeleton before the error, making the error branch unreachable on a cold load.
- **`/track` misstated where money was** — `CASH_SETTLED` (already collected and settled) was reported as "Held in escrow until a passing outcome"; same for `CASH_DUE` and `NONE`.
- **`/track` showed an empty progress tracker for 11 of 20 booking statuses** — including `DISPUTED` and every completed-and-paid outcome, whose first step ("Requested") rendered as *not done*. It now uses the same `onTrack` guard `booking-detail-view.tsx` already uses correctly.
- **`/admin/ops` linked to `/auth/login`, which 404s** — the only sign-in route is `/auth/sign-in`. An unauthenticated admin following it got a 404 instead of the sign-in page.
- **Homepage hero** claimed a hardcoded `4.9/5` and "Verified in Lahore" on a stock photograph, directly above the metrics section that correctly *withholds* its rating when the read fails. Removed.
- **"Highest Rated" search ranked unrated professionals as `0.0`** — `(b.ratingScore ?? 0) - (a.ratingScore ?? 0)` treated "no rating" as "worst rating". Unrated now sorts last.
- **A frozen clock** on the provider dashboard meant an offer expiring mid-session never showed as expiring. It now ticks.
- **`lib/data.ts` was in the client bundle** — 7 invented professionals with ratings, 8 fabricated testimonials with named reviewers. Two call sites imported only a hero image, but importing from that module pulled the whole dataset into the shipped bundle. Split out and deleted.
- **`GET /finance/ledger` could crash the screen** — `entry.transactionId.slice()` with no null guard.
- Accessibility: two buttons named "Close" in the mobile filter drawer; a dialog and a nested `<nav>` sharing one accessible name (header and portal shell); an unlabelled search input; `aria-expanded` with no controlled element.
- Admin plan service rows were keyed by array index and removed from the middle, so controlled inputs jumped rows — and every row's fields shared one accessible name.

---

## 3. Three items that need a decision from you

These are the ones where "frontend bug" and "backend inconsistency" are both defensible. We have fixed the frontend to match current behaviour, but if the *intent* was different, the fix is wrong and should be reverted.

### 3.1 `MySubscription.visitCount` vs `totalVisits` — please confirm the name

`plans.service.ts:407-421` aliases the SQL column `totalVisits`, then line 428 destructures it and line 430 republishes the number as **`visitCount`**. Your own integration test asserts `visitCount` (`apps/api/test/integration/maintenance-plans.test.ts:173,181`), so the rename looks deliberate — but it is the only field on the row renamed away from its SQL alias, which reads like a leftover.

We have matched `visitCount`. **Please confirm it is intentional.** If the intent was `totalVisits`, we will revert and the fix is one line.

> Also worth knowing: our test fixture had been written with `totalVisits`, so the suite passed while the customer's screen said "NaN". A fixture that invents a field name is worse than no fixture — it agrees with the bug. We fixed the fixture and added a test that fails if "NaN" ever renders again, and **verified that test actually fails when the bug is reintroduced**.

### 3.2 `GET /admin/plans/:id` returns the public shape, and cannot read an inactive plan

`plans-admin.controller.ts:60` returns `this.plans.getPublicPlan(id)`. Two consequences:

1. It returns `Plan`, not `AdminPlan` — so no `createdAt`, no `activeSubscriptionsCount`, and services that *do* carry `serviceNameUr` where `AdminPlan['services']` omits it. Our frontend asserted `AdminPlan`, so three fields were permanently `undefined` and one was forbidden by the type but always present.
2. `getPublicPlan` filters `is_active = true` (`plans.service.ts:81`), so **an administrator cannot read an inactive plan by id** — it 404s — even though `GET /admin/plans` lists inactive ones.

This route is currently unused by our code (the admin screen renders from the list), so nothing breaks today. But it is a trap: the natural next thing anyone builds is "click a row, edit that plan", and it will 404 for every deactivated plan in the table.

> **Request:** make it return `AdminPlan` and drop the `is_active` filter, or delete the route. Please do not leave it returning a shape that does not match its own path.

### 3.3 The ledger "Balanced" badge is not computable from `GET /finance/ledger`

The old screen printed a balance check over invented data. We could not simply move it onto real data, because **the endpoint does not return what a balance check needs.**

`finance.service.ts:105-117` joins `ledger_entries` and returns **one flat row per entry**, each carrying a single `account` and `direction`. It does not return the line pairs of the parent transaction. Whether debits equal credits therefore **cannot be determined from this response** — the constraint lives in the database.

So we removed the badge rather than print a second unverifiable claim. The account balances themselves are fine and are now computed from the real rows.

> **Request (choose one):**
> **(a)** add an endpoint or a `?groupBy=transaction` mode that returns line pairs, and we will restore the badge honestly; or
> **(b)** leave it out and we will treat "the ledger balances" as a backend/database invariant to be asserted in your tests, not a UI claim.

We lean towards (a) — an auditor will ask for it — but (b) is legitimate and we will not re-add the claim without real data.

### 3.4 `POST /plans/:id/subscribe` — the default `returnUrl` points at an API path

`plans.service.ts:375` defaults to **`/me/subscriptions`** when the client omits `returnUrl`. That is an API path, not a Next route — the app's equivalent is `/[locale]/(portal)/account/plans`. The schema (`plans.schemas.ts:42`) requires `z.string().url()` if supplied, so a client **cannot pass the app's own relative `/en/account/plans`**.

Our customer screen omits `returnUrl` and follows `checkout.returnUrl` (see §4). With the default, a customer who buys a plan is sent to an API path after payment.

> **Request:** accept a relative `returnUrl` (or accept an absolute URL and let the web client send the full locale-prefixed path). Until then we will send an absolute URL from the client, which works but is not what the field was designed for.

---

## 4. One frontend bug that was really a spec ambiguity

`POST /plans/:id/subscribe` and the booking payment both return `checkout`, but it carries **two different URLs** and the distinction is not documented anywhere:

```
checkout: {
  redirectUrl,   // where the customer must actually GO — the gateway
  returnUrl      // where the gateway will send them BACK to
}
```

The booking flow correctly navigates to `redirectUrl` (`booking-flow.tsx:1062`). The plans screen navigated to `returnUrl` — straight past the payment step.

We fixed the plans screen to use `redirectUrl`. Worth confirming that is the intent, since the naming invites exactly this mistake and nothing in the OpenAPI description says which is which.

---

## 5. Statements in our own `backend_requirement.md` that are now wrong

Please disregard these. Our previous report carried them forward without re-verification; this pass checked each against source and seven did not survive.

| Doc says | Actually |
|---|---|
| "Neither entity nor database table possesses an `avatar_url` or `photo_key` column" (P0.2) | **`providers.photo_key` exists** at `schema.prisma:889`. Dead column — nothing reads or writes it — but the claim is wrong. `users` still has nothing. |
| "The endpoint provides zero URLs or preview keys for the documents" (P0.5) | `GET /provider/documents` items **do** include `storageKey` (`provider-documents.service.ts:20-33`). Still no URL. |
| "there is no admin API route to query [the audit log]" (P2.3) | **`GET /admin/audit` exists and is fully filtered.** Covered by `apps/api/test/integration/admin-management.test.ts:138-153`. |
| "there is no API to inspect role capabilities or assign staff permissions" (P2.4) | **`GET /admin/roles` returns real per-role permissions**, and grant/revoke is implemented. Only the specific `PATCH /admin/users/:id/role` shape is missing. |
| Summary table: `/api/v1/plans` "New" | The **entire plans module exists** — `plans.controller.ts`, `plans-admin.controller.ts`, `subscriptions.controller.ts` (commit `8696785`). |
| "Missing pagination and search query" on `GET /admin/customers` | Search (`q`) and `limit` **already exist**. `status`, `page` and the envelope are genuinely missing. |
| `finance/refunds`, `finance/payouts`, `admin/disputes`, `complaints` all missing status filters | **All four already have a working `status` filter.** |

We will correct the document. Flagging it because if you have been working from that file, the admin section overstates how much is missing and the pagination section overstates how little exists.

---

## 6. What we need, prioritised

**Blocking the product**
1. **P0.1** — accept `photos[]` on `POST /bookings`. Today a booking can exist without its evidence.
2. **P0.2** — avatars. Every identity in the product is two letters.
3. **P0.3** — provider names in search. *(Coordinate with us: it breaks a pinned frontend test by design.)*
4. **P0.4** — production storage URLs. Every image currently ships as inline base64.

**Blocking scale**
5. **Bound `GET /bookings` and `GET /finance/debts`** — neither has a `LIMIT`.
6. **Settle one pagination envelope** and align `/finance/ledger` with it. Right now the documented shape and the only real implementation disagree.
7. **P1.5 / P1.6** — the admin provider queue and bookings directory do not exist as reads.

**Needs a ruling, not more work**
8. Confirm `visitCount` (§3.1).
9. Fix or delete `GET /admin/plans/:id` (§3.2).
10. Decide the ledger balance check (§3.3).
11. Fix the subscribe `returnUrl` default (§3.4).
12. **Tell us whether the doc or the routes are authoritative** for P1.7 / P2.3 / P2.4 (§1.4). We are currently guessing per endpoint.

---

## Appendix — how this was verified

- **Frontend gates, re-measured after the fixes, not copied:** TypeScript `npx tsc --noEmit` clean; ESLint `npx eslint src` **0 errors**; `npx vitest run` **656 passed / 0 failed** across 48 suites; `npm run build` compiles with both `/plans` routes registered.
- **Every verdict in §1 was read from current backend source** and the file:line is given. Where the doc and the code disagreed, the code won and the doc is flagged in §5.
- **The NaN regression test was verified to have teeth** — the bug was deliberately reintroduced, the new test failed, and the fix was restored.
- **No backend file was modified.** Per our working agreement, `apps/api`, `packages/*`, the database and root config are read-only to us; a backend problem is a finding written down here, never a change made on your side.