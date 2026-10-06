# Module Definitions — Auth, Service Catalogue, Search, Booking

**System:** Smart Home Maintenance Service (HMS) — marketplace connecting home owners with tradesmen in Lahore
**Stack:** TypeScript 5.8 · NestJS 11 on Express 5 · PostgreSQL 16 + PostGIS 3.4 · Redis 7 / BullMQ 5 · Prisma 6 (raw SQL) · Vitest 3
**API prefix:** `/api/v1` · **Swagger:** `/api/docs`

> **Naming note:** the module is spelled **`catalogue`** (British English) in code, directories, routes, and the SRS. There is no `catalog` folder. The API surface is `/api/v1/catalogue/...`

---

## 1. Module Definitions at a Glance

| # | Module | Code path | Purpose in one line | Surface | Ownership |
|---|---|---|---|---|---|
| 1 | **Auth / Identity** | `apps/api/src/identity/` | Who you are, and proving it | 12 endpoints | Customer, Provider, Agent, Finance, Admin |
| 2 | **Service Catalogue** | `apps/api/src/catalogue/` | What can be booked, and at what price | 15 endpoints | Admin (curation), Provider (own offers) |
| 3 | **Search** | `apps/api/src/search/` | Finding a provider and a free time slot | 3 endpoints | Customer (discovery) |
| 4 | **Booking** | `apps/api/src/booking/` | Owning the job from checkout to money released | 26 endpoints | Customer, Provider, plus system/verification |

**Dependency direction (no cycles):**

```
                    ┌──────────────────────┐
                    │  IDENTITY  (@Global) │  exports ACCESS_TOKEN_VERIFIER
                    └──────────┬───────────┘
        token guard ───────────┼──────────────┐
                               │              │
                               ▼              │  otp.ts helpers
   ┌───────────────┐   ┌───────────────┐     │
   │  CATALOGUE    │◄──┤    SEARCH     │     │ (seed, not per-request)
   │ read-only ref │   │  + reputation │     │
   └───────┬───────┘   └───────────────┘     │
           │ prices,                     │  │
           │ checklists,                 │  │
           │ commission ─────────┐       │  │
           ▼                     ▼       │  │
   ┌────────────────────────────────────┐ │  │
   │            BOOKING  (hub)         │─┘  │
   └───────────────┬────────────────────┘   │
                   ▼                        │
            payments · ledger ·            │
            verification · conduct         │
            queues · platform              │
                   └────────────────────────┘
```

Catalogue has **no** knowledge of booking or search. Booking consumes catalogue. Search is a leaf read model consumed only over HTTP.

---

## 2. Module 1 — Auth / Identity

**Path:** `apps/api/src/identity/` (12 files, ~1,400 lines)
**Registered as:** `@Global()` Nest module — `identity.module.ts:22`

### What it owns
The account lifecycle and session security for all five roles: registration with phone verification, password login, single-use OTP codes, refresh-token rotation with theft detection, password recovery, TOTP two-factor, and session revocation.

### Files
| File | Role |
|---|---|
| `auth.controller.ts` | 12 HTTP endpoints |
| `auth.service.ts` | register, login, OTP verify, password reset, TOTP enrolment |
| `auth.schemas.ts` | Zod request validation |
| `otp.service.ts` / `otp.ts` | OTP issue/consume; pure crypto (HMAC, Base32, RFC-6238 TOTP) |
| `totp-vault.ts` | AES-256-GCM encryption of TOTP secrets |
| `password.ts` | Argon2id hashing, password policy, timing-equalising dummy verify |
| `tokens.ts` | JWT sign/verify (jose HS256), opaque refresh tokens |
| `session.service.ts` | Refresh rotation families, reuse detection, revocation |
| `jwt-access-token.verifier.ts` | Adapts `verifyAccessToken` to the `ACCESS_TOKEN_VERIFIER` port |

### Endpoints
| Method | Route | Access |
|---|---|---|
| POST | `/auth/register` | Public (customer or provider only) |
| POST | `/auth/otp/request` | Public |
| POST | `/auth/otp/verify` | Public (completes registration / passwordless login) |
| POST | `/auth/login` | Public (TOTP code optional) |
| POST | `/auth/refresh` | Public (reads `shm_rt` httpOnly cookie) |
| POST | `/auth/logout` | Public |
| POST | `/auth/password/forgot` | Public (identical response — no account enumeration) |
| POST | `/auth/password/reset` | Public (revokes all other sessions) |
| GET | `/auth/me` | Authenticated |
| POST | `/auth/totp/setup` | Authenticated |
| POST | `/auth/totp/verify` | Authenticated |
| DELETE | `/auth/totp` | Authenticated |

### Data touched
`users` · `sessions` · `otp_codes` · `user_roles` / `roles` / `permissions` · `customers` · `providers` · `audit_log`

### Key design decisions
- **Two-path login.** OTP for customers; password **plus mandatory TOTP** for staff. `auth.staff_totp_required` is a DB setting, togglable.
- **Refresh rotation with reuse detection.** Each refresh mints a new token within a *family*. Presenting a rotated-away token is treated as theft and revokes the whole family (`session.service.ts:39`).
- **TOTP secrets never stored in plaintext** — AES-256-GCM at rest, key from `TOTP_ENCRYPTION_KEY`.
- **Argon2id** (m=19456, t=2, p=1), 10-char minimum, common-password denylist. A dummy verify runs on unknown users so response timing does not leak account existence.
- **Login throttle** in Redis: `auth:login-fail:{id}:{ip}`, 5 attempts / 15 min.
- **Policy guard is global.** Every route in every module must declare a policy decorator or the guard rejects it at runtime — enforced by a source-level test (`route-policy.test.ts:35`).

### Configuration
Env: `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ISSUER`, `JWT_AUDIENCE`, `ACCESS_TOKEN_TTL_MIN`, `REFRESH_TOKEN_TTL_DAYS`, `CSRF_SECRET`, `OTP_PEPPER`, `TOTP_ENCRYPTION_KEY`
DB settings: `auth.otp_ttl_min` (10), `auth.otp_max_attempts` (5), `auth.otp_resend_cooldown_sec` (60), `auth.login_max_attempts` (5), `auth.login_window_min` (15), `auth.staff_totp_required` (true)

### Tests
Unit: `otp`, `tokens`, `password`, `policy`, `route-policy`, `environment`
Integration: `identity.test.ts` (357 lines) — registration + phone verification, duplicate phone 409, self-register cannot claim a staff role, OTP attempt limits, login + rate limiting, refresh rotation + reuse detection, logout, password recovery, staff TOTP, role separation on identical routes.

---

## 3. Module 2 — Service Catalogue

**Path:** `apps/api/src/catalogue/` (7 files, ~640 lines)
**Public** · **Admin curation** · **Provider self-service**

### What it owns
The definition of *what can be booked*: category tree, bookable services with pricing model and price band, expected duration, warranty, emergency/plan/high-risk eligibility; the ordered job checklist providers must complete (some steps photo-required); platform commission rules; and which providers are approved to offer which service at which price.

### Files
| File | Role |
|---|---|
| `catalogue.service.ts` | Categories, services, checklists, commission rules |
| `catalogue.controller.ts` | Public read-only catalogue (3 routes) |
| `catalogue-admin.controller.ts` | Admin CRUD + commission rules (8 routes) |
| `provider-services.service.ts` | Provider ↔ service bindings, price within band |
| `provider-services.controller.ts` | Provider's own offers (3 routes) |
| `provider-services-admin.controller.ts` | Approve / reject provider offers (3 routes) |
| `catalogue.schemas.ts` | Zod schemas for all four surfaces |

### Endpoints
**Public** — no token required:
```
GET    /catalogue/categories
GET    /catalogue/categories/{slug}/services
GET    /catalogue/services/{slug}          (includes checklist)
```
**Admin** — all require `ADMIN` + TOTP confirmed:
```
POST   /admin/catalogue/categories              PATCH  /admin/catalogue/categories/{id}
POST   /admin/catalogue/services               PATCH  /admin/catalogue/services/{id}
PUT    /admin/catalogue/services/{id}/checklist
GET    /admin/catalogue/commission-rules        POST   /admin/catalogue/commission-rules
POST   /admin/catalogue/commission-rules/{id}/end
```
**Provider** — `PROVIDER` role:
```
GET    /provider/services
PUT    /provider/services/{serviceId}          (upsert own price)
DELETE /provider/services/{serviceId}
```
**Admin approval of offers** — `ADMIN` + TOTP:
```
GET    /admin/provider-services?status=
POST   /admin/provider-services/{providerId}/{serviceId}/approve
POST   /admin/provider-services/{providerId}/{serviceId}/reject
```

### Data touched
`categories` · `services` · `service_checklist_items` · `commission_rules` · `provider_services` · `providers`

### Key design decisions
- **All money is integer paisa** (PKR, 1/100 rupee) — `BigInt` columns. No floats anywhere in the system.
- **Price band enforcement.** A service carries min/base/max; a provider's own price must fall inside the band or the request is rejected (`provider-services.service.ts:33`).
- **Three pricing models** — `FLAT`, `TIME_BASED` (requires `timeUnit`), `INSPECTION_FIRST`. This drives very different completion and payment behaviour in booking.
- **Commission rules are append-only.** Scoped GLOBAL / CATEGORY / PROVIDER, denominated in basis points, time-bounded, ended rather than deleted — so historical bookings remain reproducible. The effective rate is **snapshotted onto the booking at creation** (`commission_rate_bp`), not resolved live.
- **Nothing is hard-deleted.** Categories and services deactivate, which hides them from the public surface while preserving referential history.
- **Checklists are ordered and unique per `(service_id, position)`**, with a `photo_required` flag — this is what execution checks off on site.

### Data-driven, not env-driven
No dedicated environment variables. The seeded catalogue (`packages/db/seed/catalogue.ts`, 428 lines) holds 8 categories (6 active) and 17 services with checklists. Example: `leak-repair`, base 250,000 paisa, band 100,000–500,000, 90 min, emergency-eligible, 30-day warranty, 4 checklist items (2 photo-required).

### Tests
Integration: `catalogue.test.ts` (284 lines) — public listing hides inactive categories, admin create, duplicate slug 409, customer write attempt 403, deactivation hides, commission rules, provider expertise and price-band enforcement.

---

## 4. Module 3 — Search

**Path:** `apps/api/src/search/` (4 files, ~230 lines) + pure algorithm in `packages/domain/src/slots.ts`
**All three endpoints are public.**

### What it owns
The customer-facing discovery step, in three parts:
1. **Provider search** — approved providers who offer the requested service, are within their own declared radius, ranked by distance and Bayesian-weighted rating.
2. **Slot listing** — the half-hour start times a provider is genuinely free for the full service duration on a given local day.
3. **Provider public profile** — approved providers only.

### Endpoints
```
GET /search/providers?serviceSlug=&lat=&lng=
GET /search/providers/{providerId}/slots?serviceId=&date=YYYY-MM-DD
GET /search/providers/{providerId}
```
Responses: `{ items: [...] }` for the first two; a flat profile object with `services`, `areas`, `reputation` for the third.

### Data read (never written)
`services` · `provider_services` · `providers` · `provider_availability` · `provider_time_off` · `bookings` · `provider_service_areas` · `areas` · `addresses` · `ratings` · `provider_stats`

### Key design decisions
- **Radius is the provider's, not the customer's.** Each provider sets their own `radius_m` around their `base_location`; the query filters with `ST_DWithin(...)` against that radius rather than a platform-wide distance cap.
- **One round trip.** Provider search is a single SQL statement joining `providers ⋈ provider_services` with a `LEFT JOIN LATERAL` Bayesian rating subquery, so ranking happens over the full result set rather than paginating blind.
- **Slots are computed, never stored.** `generateSlots` (`packages/domain/src/slots.ts:39`) is a pure function: declared availability windows minus approved leave minus existing bookings (extended by the travel buffer), at 30-minute steps, with a 60-minute minimum notice floor. It is unit-tested exhaustively because it is pure and framework-free.
- **Unapproved providers are invisible, not forbidden.** A non-approved provider returns 404, identical to a nonexistent one — the profile surface leaks nothing about who has applied.
- **Timezone discipline.** All slot maths runs in `Asia/Karachi` via `instantFromWallTime`; the database stores `tstzrange`.

### Configuration
No env vars. DB settings: `booking.travel_buffer_min` (30), `rating.bayesian_prior` (3.5), `rating.bayesian_weight` (5), `rating.recent_weight` (2), `ranking.weights`.

### Tests
Integration: `search.test.ts` (108 lines) — in-range provider found, out-of-radius excluded, unapproved provider excluded, pending offer excluded, unknown slug 404, provider detail shape, unapproved hidden as 404.
Pure unit: `packages/domain/test/slots.test.ts`, `slaCalendar.test.ts`, `clock.test.ts`.
Also exercised via `booking-slots.test.ts:28` (SHM-025).

### Known gap — flagging for discussion
`ranking.weights` is seeded as `{ rating: 0.35, distance: 0.25, completion: 0.2, response: 0.1, recency: 0.1 }`, but **only `rating` and `distance` are actually applied today**; the remaining three weights are renormalised away (`search.service.ts:88-94,120-121`). The config implies a richer ranking than the code delivers. Either the remaining signals need wiring or the setting should be trimmed to avoid misleading operators.

---

## 5. Module 4 — Booking

**Path:** `apps/api/src/booking/` (18 files, ~2,200 lines) — the largest module and the hub of the system
**26 endpoints** across three controllers

### What it owns
The job end to end: quote and price → checkout and payment → dispatch to a provider → the status machine → on-site execution → completion → invoice → hand-off into the verification engine that releases the money.

### Files
| File | Role |
|---|---|
| `booking.service.ts` | Checkout, warranty, cash settlement, start OTP, reschedule, quote revisions, reads |
| `booking-state.service.ts` | **Sole writer** of `bookings.status` for actor events; money effects |
| `booking-state.ts` | `applySystemEvent` — platform-side transition writer |
| `booking.row.ts` / `booking.schemas.ts` | Row shape and 13 Zod schemas |
| `pricing.service.ts` | The single price-calculation point |
| `offer.service.ts` | Auto-assign offer cascade, accept/decline, expiry, exhaustion + refunds |
| `execution.service.ts` | Evidence photos, checklist results, geofenced check-in/out |
| `completion.service.ts` | Completion guards, invoicing, hand-off to verification, invoice PDF |
| `tier-routing.service.ts` | Verification tier routing (with an injectable RNG test seam) |
| `message.service.ts` / `message.controller.ts` / `message-masking.ts` | Per-booking chat with contact masking |
| `booking.controller.ts` / `provider-offers.controller.ts` | HTTP surface |
| `booking.jobs.ts` | Payment hooks + 2 scheduled jobs |
| `invoice-pdf.ts` | Dependency-free PDF writer |
| `slot-time.ts` | `Asia/Karachi` local weekday/time helpers |

### Endpoints
**Customer / Provider lifecycle**
```
POST   /bookings/quote                 CUSTOMER   itemised pre-checkout price
POST   /bookings                       CUSTOMER   checkout (201)
POST   /bookings/checkout              CUSTOMER   alias of the above
GET    /bookings/{id}                  both       owner-only, else 404
GET    /bookings?status=               both
POST   /bookings/{id}/accept           PROVIDER   → SCHEDULED, issues start OTP
POST   /bookings/{id}/decline          PROVIDER   → UNFULFILLED
POST   /bookings/{id}/depart           PROVIDER   → EN_ROUTE
POST   /bookings/{id}/start            PROVIDER   arrival code → IN_PROGRESS + geofence
POST   /bookings/{id}/reschedule       CUSTOMER   one free move, ≥4h notice
POST   /bookings/{id}/cancel           both
POST   /bookings/{id}/no-show          both
POST   /bookings/{id}/complete         PROVIDER
POST   /bookings/{id}/cash-received    PROVIDER
POST   /bookings/{id}/warranty-claim   CUSTOMER   reopen as rework
POST   /bookings/{id}/checklist/{itemId}          PROVIDER  photo steps need evidenceId
POST   /bookings/{id}/evidence         both       8MB body limit
GET    /bookings/{id}/evidence         both
GET    /bookings/{id}/invoice.pdf       both
```
**Quote revisions** (extra work found on site)
```
POST   /bookings/{id}/revisions            PROVIDER   → QUOTE_REVISION
POST   /bookings/{id}/revisions/approve    CUSTOMER   cash: immediate; online: top-up payment
POST   /bookings/{id}/revisions/reject     CUSTOMER   inspection-first ends at visit fee
```
**Offers and chat**
```
GET    /provider/offers                    PROVIDER
POST   /provider/offers/{id}/accept        PROVIDER   issues start OTP
POST   /provider/offers/{id}/decline       PROVIDER
GET    /bookings/{id}/messages             both
POST   /bookings/{id}/messages             both
```

### Data touched
Core: `bookings` (60+ columns) · `booking_items` · `booking_offers` · `booking_status_history` · `quote_revisions` · `invoices` · `job_evidence` · `job_checklist_results` · `messages`
Also reads/writes: `provider_availability`, `provider_time_off`, `addresses`, `areas`, `services`, `service_checklist_items`, `provider_services`, `commission_rules`, `coupons`, `coupon_redemptions`, `ledger_accounts`, `payments`, `refunds`, `verification_calls`, `demerit_awards`, `complaints`, `disputes`, `ratings`, `outbox_events`, `audit_log`

### Key design decisions
- **The status machine is a pure, exhaustively unit-tested table.** 20 statuses, 29 events, a single `BOOKING_TRANSITIONS` lookup in `packages/domain/src/bookingTransitions.ts:80`. Illegal moves are rejected in the domain, before touching the database.
- **Only two code paths may write `bookings.status`** — `BookingStateService.applyInTx` (actor events) and `applySystemEvent` (platform events). Both set `SET LOCAL app.transition_ctx = 'on'`, and a Postgres trigger `bookings_status_guard` rejects any other writer. State integrity is enforced by the database, not by convention.
- **Double-booking is impossible by construction.** A Postgres exclusion constraint on `(provider_id, slot)` blocks overlapping `tstzrange` values; SQLSTATE `23P01` is translated to a domain `SLOT_TAKEN` error. No read-then-write race exists.
- **Money only moves through the ledger**, never as ad-hoc column updates. Cancellation fees, refunds, and release are posting entries, all recorded through a transactional outbox.
- **Commission is snapshotted at booking creation** (`commission_rate_bp`), so later rule changes cannot retroactively alter a booked job's economics.
- **The start OTP is a real second check.** The provider must be physically at the site: a one-time code plus a geofence distance check (200m radius setting). It has its own attempt counter and lockout, separate from auth OTP.
- **Completion is guarded, not trusted.** The provider cannot self-declare success: photo-required checklist items must have evidence, the honest-completion conditions must hold, and the job is then handed to human verification — a staff agent calls the customer before money is released. This escrow model is the core commercial differentiator of the product.
- **No dependency cycle with payments.** `BookingJobs` registers callbacks (`payments.onBookingRequested`, `payments.onTopupCaptured`) so the payment module never imports booking. Preserve this pattern in any refactor.
- **Invoice PDF is generated in-process** with a dependency-free writer — no external service, no template engine, no network call.

### Configuration
Env: `OTP_PEPPER` (start-code hashing), `STORAGE_BUCKETS` (evidence bucket)
DB settings: `booking.travel_buffer_min` (30) · `booking.free_cancel_hours` (4) · `booking.late_cancel_fee_paisa` (50,000) · `booking.offer_timeout_min` (15) · `booking.max_offers` (5) · `booking.max_offer_window_min` (60) · `booking.pending_payment_timeout_min` (15) · `booking.evidence_required` (true) · `booking.emergency_surcharge_pct` (25) · `evidence.geofence_radius_m` (200) · `evidence.photo_max_bytes` (5MB) · `tier.*` · `verification.*` · `cash.debt_ceiling_paisa`

### Tests
Pure unit: full transition table, tier routing, slots, money, SLA calendar, clock, verification, conduct
App unit: message masking, idempotency, policy
Integration — 11 files: `booking`, `booking-transitions`, `booking-checkout`, `booking-start`, `booking-reschedule`, `booking-slots`, `booking-completion`, `booking-quote-revision`, `booking-revisions`, `booking-messages`, `verification-rework`
Cross-cutting: `money-safety.test.ts` (SHM-045 money/state invariants), `database-invariants.test.ts`, `payments-cash.test.ts`, `outbox.test.ts`, `api-surface.test.ts` (committed 165-operation baseline)

---

## 6. Cross-Cutting Foundations

| Concern | Where | Note |
|---|---|---|
| Global route prefix | `http-app.ts:10` | `api/v1` |
| Error contract | `common/problem-details.filter.ts` | RFC 7807 `application/problem+json`, single error catalogue in `packages/contracts/src/errors.ts:39` |
| Authorization | `common/policy.guard.ts:10` | Global; every route must declare `@Public` / `@Authenticated` / `@PolicyDecorator` |
| Idempotency | `common/idempotency.interceptor.ts:29` | Global interceptor on writes |
| Runtime settings | `platform/settings.service.ts:45` | DB-backed, Redis-cached — where most business rules actually live |
| Transactional outbox | `platform/audit.service.ts` | Every transition emits an event |
| Clock | `platform/app-clock.ts` | Injectable, so SLA and warranty maths are testable |
| Background jobs | `queues/queue.registry.ts:8` | BullMQ, scheduled, with cancellation and timeouts |
| Clock/timezone | `packages/domain/src/slaCalendar.ts` | `Asia/Karachi`; paisa integers throughout |

**All external providers are mocked and pinned to `mock` in every environment, including production** (`environment.schema.ts:65-67`) — payments, SMS, email, maps, telephony, WhatsApp, storage. The env schema *rejects* any other value. This is deliberate for a pre-launch build, but it is the single largest gap between this codebase and production readiness.

---

## 7. Discussion Points

1. **Search ranking is narrower than configured.** `ranking.weights` advertises five signals; only rating and distance are applied. Wire the rest, or trim the setting.
2. **All integrations are mocks.** Real payment, SMS, and storage providers must be selected and implemented before launch. The `IntegrationsModule` port shape is already in place.
3. **Provider candidate logic is duplicated.** `search.service.ts` and `offer.service.ts:181-195` each independently determine eligible providers. They should share one implementation or they will drift.
4. **Money is safe but the invariants are test-enforced, not type-enforced.** Paisa is `BigInt` in the database and `number` in TypeScript. Consider a branded type to prevent a future float from reaching a money path.
5. **The commission setting is informational.** `commission.default_pct` (15) is not the applied rate — the real rate comes from `commission_rules` at booking time. Worth confirming no downstream consumer reads the wrong one.
6. **Coverage is strong on booking and identity, thinner elsewhere.** Catalogue, search, and the provider module have good integration tests but far less of the adversarial depth booking enjoys.
