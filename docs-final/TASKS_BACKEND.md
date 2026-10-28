# Backend Task Board — Smart Home Maintenance Services

Reference docs (all in this folder): `TRD.md` (architecture), `ERD.md` (data model — the
schema actually running is `schema.sql`, this folder). Every task below cites the SRS
requirement ID it satisfies so a reviewer can trace a PR back to `SRS.md`, the requirements
doc of record — see the doc-of-record entry below for the full reasoning. This file tracks
phases and modules at a coarse grain; `PROGRESS_TRACKER.md` (this folder) is the live,
ticket-by-ticket source of truth and is kept current — trust it over this file if the two
disagree on what's actually built.

**This folder (`docs-final/`) is the *only* doc folder.** See `README.md` here for the full
index and `archive/` for everything superseded. There is nowhere else to look.

**How to use this file:** check items off as PRs merge; don't reorder phases — each phase's
"Definition of done" is the gate for starting the next. Group commits/PRs by module, not by
individual checkbox, so review stays reviewable.

---

## Platform migration — Fastify → NestJS/Express

Cross-cutting, done outside the phase order above. Verified 2026-09-28: lint, typecheck,
72 unit tests, all 148 integration tests, and the API surface snapshot (61 operations,
byte-identical to `apps/api/test/api-surface.baseline.json`) all green.

- [x] Capture baseline API surface snapshot (61 operations) + commit it
- [x] Replace pino with a Nest LoggerService (JSON lines, keep redaction paths + request id) — `apps/api/src/logger.ts`
- [x] Swap `platform-fastify` → `platform-express` in package.json (drop fastify, `@fastify/*`, fastify-plugin, pino; add express, helmet)
- [x] Rewrite `adapter.ts` + `http-app.ts` for Express (`rawBody: true`, 1mb body limit, trust proxy, request-id middleware, rate limit)
- [x] Delete `common/raw-body.ts`, rewire `request-context.ts` augmentation to Express `Request`
- [x] Retype `policy.ts`, `problem-details.filter.ts`, `idempotency.interceptor.ts` to Express `Request`/`Response`
- [x] Retype `auth.controller.ts` cookie handling (`setCookie` → `res.cookie`) and `payment-webhook.controller.ts` `rawBody`
- [x] Port test harness off `server.inject()` — landed on `light-my-request` injecting straight into the Express handler, not `supertest`: driving requests over real TCP made the single vitest worker crash intermittently on Windows (see `apps/api/test/integration/harness.ts`)
- [x] Add integration test that diffs live routes against the committed baseline snapshot — `apps/api/test/integration/api-surface.test.ts`
- [x] Verify: lint, typecheck, unit tests, all integration tests green + surface snapshot byte-identical (148 integration tests today, up from the 125 at the time this list was written)
- [x] Extend this file (TASKS_BACKEND.md) to trace all FR ids from the new SRS — the "148" in this line's original wording was a rough estimate; the new SRS (`SRS_Smart_Home_Maintenance_Services.pdf` at the repo root, v2.0 — see the doc-of-record note below) states **130** functional requirement ids, by its own count in Appendix B ("24 carried forward, 106 added — 130 in total"). Of those 130, 98 were already cited somewhere in this file; the other **32** are now traced below, each folded into its module's phase section: `FR-AD-04/06/07`, `FR-CP-02/04`, `FR-CU-05/06/07/08/09`, `FR-NT-02/03/04`, `FR-PN-08/09`, `FR-PY-01/10`, `FR-RP-02`, `FR-RT-01/02/05/06/07`, `FR-SP-04/05/10/11/12/13/14`, `FR-VC-02`. Two of them (`FR-CU-05` customer addresses, `FR-CU-06` booking history list/detail) are already built — see the citations inline.
- [x] Analyse the 19 [corrected: **15**] dropped FR ids and flag which look accidental vs intentional — see **Appendix: FR-id reconciliation** at the end of this file for the full analysis, including the doc-of-record correction this surfaced. Short version: the 15 ids present in `smart-home-docs/01_SRS_v2.1.md` and absent from the root-level `SRS_Smart_Home_Maintenance_Services.pdf` (v2.0) are **not gaps in the team's actual plan** — every one of them is already cited as a `Refs:` entry on a real ticket in `docs/07_PROGRESS_TRACKER.md`, which states its own baseline as "SRS v2.1" and is the live, actively-updated tracker (last updated 2026-09-26). The gap is that *this file* (`TASKS_BACKEND.md`), `docs/TRD_Smart_Home_Maintenance.md`, `docs/OPENCODE_BUILD_PROMPT.md` and the root SRS PDF form a second, parallel lineage that was built from v2.0 and never reconciled with v2.1 — see the doc-of-record note below for the fix. Of the 15: 3 are intentional simplifications relative to v2.1 (`FR-CAT-08` merged into `FR-EX-08`, `FR-EX-12` offline-upload resilience, `FR-AD-16` HR conflict declarations — all three still ticketed, e.g. SHM-024 for the conflict declarations), and 12 are substantive v2.1 refinements already ticketed and worth this file citing too, which the next bullet's 32-id trace now does where they land in Phase-level work: `FR-EX-10` (`final_amount ≤ approved_total`), `FR-EX-11` (inspection-first rejection fee), `FR-PN-10` (breach-category precedence), `FR-PY-11/12/13` (cash fee receivable, online top-up, online debt clearing), `FR-VC-13/14/15` (cash-priority SLA, calling-hours SLA — already implemented, see `packages/domain/test/slaCalendar.test.ts` — and queue claim locking), `FR-BK-09/10` (`PENDING_PAYMENT`/`UNFULFILLED` — already live enum values), `FR-NT-06` (bilingual templates — already seeded).
- [x] Switch doc of record to new-docs-final; record deviations (72-table schema kept, `packages/domain` kept) — "new-docs-final" is `docs/` (as opposed to the `smart-home-docs/` folder, despite its name being the *older* one on the SRS axis — see above). Doc of record per artifact, as it actually stands today, confirmed by cross-checking the live tracker and the running database/migration rather than assumed:
  - **Requirements:** `smart-home-docs/01_SRS_v2.1.md`, tracked ticket-by-ticket in `docs/07_PROGRESS_TRACKER.md` (which states this explicitly: "Requirement IDs refer to `01_SRS_v2.1.md`"). *Not* the root `SRS_Smart_Home_Maintenance_Services.pdf` (v2.0) that `docs/OPENCODE_BUILD_PROMPT.md` claims — that claim is the one now known to be wrong; this file and `docs/TRD_Smart_Home_Maintenance.md` were built from it and are the reason the 32 ids above needed tracing in from v2.1.
  - **Database schema:** `smart-home-docs/04_schema.sql`, confirmed canonical by `packages/db/README.md`, enforced byte-identical to `packages/db/migrations/0001_init.sql` by the `migration-fidelity` CI job, and verified in this session against the running Postgres container. **Deviation:** `docs/schema.prisma` (a separate, 50-model design in the "new" doc set, vs. the 72-table `04_schema.sql` actually running) exists only as a reference document and was never adopted — the 72-table old-docs schema was kept.
  - **Architecture/TRD:** `docs/TRD_Smart_Home_Maintenance.md` is followed for stack choices (NestJS/Express, npm workspaces, BullMQ, Prisma) and matches the running code. **Deviations from its own proposed layout, both intentional and already in effect:** (1) `packages/domain` exists as its own workspace (clock/money/booking-transition/SLA-calendar helpers) even though the TRD's §3 tree doesn't list it — kept because `apps/api` and `apps/worker` both need these pure helpers without depending on each other; (2) the TRD's §3 tree proposes `apps/api/src/modules/<name>/`, but the real tree is flat (`apps/api/src/<name>/`, e.g. `booking/`, `catalogue/`) — one less directory layer, no functional difference; (3) the TRD proposes `packages/integrations` as its own workspace, but it's implemented as `apps/api/src/integrations/`, a module inside `apps/api` rather than a separate package — fine while only `apps/api` needs it, revisit if `apps/worker` ever needs the same gateway adapters directly.
  - **Historical / point-in-time, not doc-of-record for anything current:** `docs/BACKEND_CONTINUATION_REPORT.md` and `docs/PROJECT_OVERVIEW_REPORT.md` are handoff/status snapshots from earlier interrupted sessions — both still reference Turborepo, Fastify and Pino, all three removed since (see this section's other entries). `docs/OPENCODE_BUILD_PROMPT.md` was a one-time prompt for the tool that scaffolded `docs/TRD.md`/`docs/ERD.md`/`docs/schema.prisma`/this file from the v2.0 PDF; it was never updated when the team's live tracker moved to v2.1, which is the actual bug this checklist item surfaced.
- [x] **Follow-up, same day:** stopped documenting the split and actually fixed it — created `docs-final/` as the one doc of record and moved every file identified above as current into it: `SRS.md` (← `smart-home-docs/01_SRS_v2.1.md`), `ERD.md` (← `smart-home-docs/03_ERD.md`, already accurate, content unchanged), `PROGRESS_TRACKER.md` (← `docs/07_PROGRESS_TRACKER.md`), this file, and `TASKS_FRONTEND.md`. `TRD.md` was freshly written — the old TRD's business-logic depth (state machine, ledger, verification engine, conduct engine, API catalogue, security, testing, ADRs) was still correct and is kept, but every stack/layout fact was corrected against the real code (Express not Fastify, npm workspaces not Turborepo/pnpm, `JsonLogger` not Pino, MinIO/Mailpit gone, `apps/worker`'s actual thin-split shape) and a §0 "Implementation status" section was added up front so this document can't drift from reality silently again. `smart-home-docs/04_schema.sql` stayed put at first — CI (`.github/workflows/backend.yml`), `packages/db/README.md` and `packages/contracts/test/enum-mirror.test.ts` all hardcoded that path, and moving it meant a code change, not just a docs one.
- [x] **Second follow-up, next message:** asked directly whether `smart-home-docs/` and `docs/` were still needed at all now that `docs-final/` existed — no, they weren't, and leaving them around with banners was still "two folders to check," just with a sign on one of them. Moved `schema.sql` into `docs-final/` too, updating the three hardcoded paths above (verified: `enum-mirror.test.ts` still passes, the CI migration-fidelity script's logic re-verified locally against the new path). Moved everything superseded — `smart-home-docs/02_TRD.md`, `05_CURSOR_BUILD_PROMPT.md`, `06_cursor_rules/`, `00_README.md`; `docs/TRD_Smart_Home_Maintenance.md`, `ERD_Smart_Home_Maintenance.md`, `schema.prisma`, `OPENCODE_BUILD_PROMPT.md`, `BACKEND_CONTINUATION_REPORT.md`, `PROJECT_OVERVIEW_REPORT.md`, `SRS_Smart_Home_Maintenance_Services.pdf` — into `docs-final/archive/`, then deleted the two now-empty folders. `docs-final/` is now the only doc folder in the repo. See `docs-final/README.md` for the final index and the rule going forward: one doc of record per artifact, updated in place, never a second copy, never a second folder.
- [x] Drop MinIO + Mailpit from `infra/docker-compose.yml` and the env schema; drop turbo in favour of plain npm workspaces — neither was ever actually connected to (`STORAGE_PROVIDER`/`EMAIL_PROVIDER` are pinned to `mock`), so this only removed unused config, containers and the `turbo` devDependency. Root scripts now run `npm run <task> --workspaces --if-present`, each prefixed with a build pass since npm workspaces doesn't do turbo's dependency-graph caching. Reverified: build, lint, typecheck, unit tests (across every workspace) and all 148 integration tests green.
- [x] Remove the `packages/config` workspace, move shared tsconfig/eslint/prettier to root — `tsconfig.base.json`, `eslint.config.js` (inlined, no longer a re-export) and `prettier.config.js` now live at the repo root; the custom `no-restricted-syntax` bans (booking-status write, money-as-Number) and their `fixtures/`+`test/lint-fixtures.test.ts` proof moved with it. Root `lint`/`typecheck` gained explicit steps for these root-owned files (there's no longer a phantom workspace to carry them), and root `test` now runs `vitest run` for the fixtures test before the per-workspace tests. Every workspace's `tsconfig.json` now extends `../../tsconfig.base.json` directly and the `@smart-home/config` dependency is gone from all four `package.json`s. Fixed two pre-existing gaps surfaced by finally typechecking these files (they were never checked before — `packages/config` had no `typecheck` script): an undeclared `update` identifier in a fixture, and an untyped import of `eslint.config.js` in the test. Also gave `packages/contracts` and `packages/db` their own local `vitest.config.ts` (mirroring `apps/api` and `packages/domain`, which already had one) so `vitest`'s upward config search can no longer pick up the new root `vitest.config.ts` for their runs. Reverified: build, lint, typecheck, unit tests (every workspace) and all 148 integration tests green; `prettier --check` now actually applies the intended style repo-wide, which it silently wasn't before (`@smart-home/config/prettier` was exported but never imported anywhere).
- [x] Split `apps/worker` out of `apps/api/src/worker.ts` into its own workspace app — done as a **thin split** (chosen over fully extracting `AppModule` and every feature module into a shared `packages/app-core`, which would have touched ~60 files to redraw the controller/service boundary): `apps/api/package.json` gained an `exports` map exposing the five things the worker needs off its build output (`./app.module`, `./config/environment.service`, `./platform/outbox.dispatcher`, `./platform/settings.service`, `./queues/queue.registry`); `apps/worker` is a new workspace (own `package.json`/`tsconfig.json`/`tsconfig.build.json`/`vitest.config.ts`) whose `src/worker.ts` is the old file unchanged except for those five imports now going through `@smart-home/api/...` instead of relative paths. `dev:worker`/`start:worker` moved off `apps/api/package.json` onto `apps/worker`, with matching root convenience scripts. Caveat carried forward: `apps/worker` still transitively pulls in `@nestjs/platform-express`/`helmet`/etc. through `@smart-home/api` — harmless (the worker never touches HTTP) but not a clean dependency boundary; revisit with the full extraction if that ever matters. Verified: build (api before worker, matching the `workspaces` array order), lint, typecheck, unit tests across every workspace including the new one, all 148 integration tests, and `node apps/worker/dist/worker.js` boots standalone and logs `worker ready`.

---

## Phase 1 — Foundation
`identity` · `catalogue` · `admin` (approval slice) · infra

### Infra & scaffolding
- [ ] npm workspaces monorepo: `apps/api`, `apps/worker`, `packages/prisma`, `packages/contracts`, `packages/integrations`
- [ ] `packages/prisma`: add `schema.prisma`, run first migration, wire generated client as a workspace dependency
- [ ] `docker-compose.yml`: `postgres`, `redis`
- [ ] `apps/api` bootstrap: NestJS + `@nestjs/platform-express`, global `ValidationPipe`, `helmet`, `@nestjs/swagger`
- [ ] CI pipeline: lint, typecheck, `prisma migrate diff` (fail on drift), unit tests
- [ ] `Setting` table + cached `ConfigService` wrapper (NFR-MA-01) — seed the config keys every later phase will need: `AUTO_RELEASE_WINDOW_HOURS`, `CALLING_HOURS_START/END`, `VERIFICATION_TIER_A_SAMPLE_RATE`, etc.

### Identity module (M2, M3, M12-auth)
- [ ] FR-CU-01 / FR-SP-01 — registration + login, JWT access + refresh tokens
- [ ] FR-CU-03 — mobile OTP verification at registration (this number is the one verification calls go to — get it right here)
- [ ] FR-CU-04 — password recovery via email or SMS one-time code
- [ ] FR-CU-02 / FR-SP-03 — profile view/update, password change
- [ ] FR-SP-02 — provider profile: experience, expertise, qualification, picture, location
- [x] FR-CU-05 — customer saved addresses (area + map location), select one per booking — `apps/api/src/customer/addresses.controller.ts` + `addresses.service.ts`, full CRUD with default-address ordering
- [ ] FR-SP-06 — CNIC / trade certificate / optional character certificate upload; approval blocked until verified
- [ ] FR-AD-10 — approval workflow: reviewer, decision, reason recorded; rejection notifies provider with explanation
- [ ] NFR-SE-01 — Argon2id password hashing
- [ ] NFR-SE-06 — rate limiting on `/auth/*`, `/otp/*` (`@nestjs/throttler`)
- [ ] `RolesGuard` + `@Roles()` decorator for the 5-role enum, applied globally

### Catalogue module (M1)
- [ ] FR-CAT-01 — admin CRUD on categories and services
- [ ] FR-CAT-02 — service fields: description, price/price band, duration, pricing model (flat / per-day / inspection-first)
- [ ] FR-CAT-03 — provider expertise selections bound to catalogue services (a provider is only offered jobs for approved services)
- [ ] FR-CAT-04 — provider custom price, validated against the admin's band
- [ ] FR-CAT-05 — commission rule at global / category / provider scope
- [x] FR-CAT-06 / FR-CAT-07 — emergency-eligible, plan-eligible, warranty-eligible, high-risk flags
- [x] **FR-CAT-06 same-day half (built 2026-10-05, FR-BK-11/12):** the surcharge side already worked; the *scheduling* side did not. `booking.min_notice_min` (30) is now read by both `GET /search/providers/:id/slots` and checkout — they previously disagreed, the listing hardcoding 60 minutes while checkout only required a start in the future. `booking.max_day_span` (1) replaces "must start and end on the same calendar day", which refused a 23:00-00:30 job; provider availability is now matched one local day at a time (`splitAtLocalMidnight`) in both `assertWindowIsBookable` and the auto-assign candidate query, without which a cross-midnight booking matched no candidate and fell through to `UNFULFILLED`. New `GET /search/providers/:id/next-slots` answers "when is this provider next free?" across `booking.next_slot_days`.
- [x] **FR-BK-13 booking on behalf of someone else (built 2026-10-05):** `bookings.is_on_behalf` / `on_behalf_name` / `on_behalf_phone_e164` (migration `20261005050000`), E.164 and all-or-nothing by check constraint. The booker's `customer_id` is untouched, so escrow, ratings, verification and disputes all still key off the paying account. The number is **not** on `BookingRow` — every provider-facing endpoint returns that row — so it is read only through `BookingService.onBehalfContact`, which masks it for a provider who has not accepted and reveals it to the one who has. `GET /bookings/:id/on-behalf-contact`.
- [x] **FR-BK-14 common-faults dropdown (built 2026-10-05):** `service_issue_options` per service, EN/UR, replaced wholesale by `PUT /admin/catalogue/services/:id/issue-options` like the checklist; published at `GET /catalogue/services/:slug/issue-options` and included in service detail. `bookings.issue_option_id` is optional and is checked against the service being booked. Deliberately not a constraint on what a customer may write: an option, free text, both or neither.
- [x] **Completion now texts the customer (built 2026-10-05):** `booking.handToVerification` was `IN_APP`-only, so on a Tier B job — where escrow releases on the customer's own answer and auto-releases after 72 h — a customer who never opened the app was never told there was anything to confirm, and no verification test asserted a notification at all. Now `BOTH`, with an SMS template. `completion-notification.test.ts`.
- [ ] Seed script: the 6 launch categories + full service list (SRS §3.1), plus the 2 held-back categories flagged inactive

### Admin module — approval & user management slice (M12)
- [ ] FR-AD-01 — admin login (reuses Identity)
- [ ] FR-AD-02 — approve registered providers
- [ ] FR-AD-03 / FR-AD-04 / FR-AD-05 / FR-AD-09 — manage providers & customers, including updating provider details and resetting login passwords; delete = soft deactivation only, never physical
- [ ] FR-AD-13 — role/permission scaffolding for agent, finance, admin logins
- [ ] FR-AD-14 — append-only audit log: DB role has no `UPDATE`/`DELETE` grant on `audit_log`, plus a service-layer `AuditService.record()` called from every privileged action

**Definition of done — Phase 1:** an admin can onboard a real tradesman end to end —
register → verify phone → upload documents → admin reviews and approves → provider adds
services and prices within the admin's band.

---

## Phase 2 — Transacting
`search` · `booking` · `execution`

### Search & matching (M4)
- [x] FR-SR-03 — service-first search: customer picks a service, sees providers offering it in their area **Built:** `GET /search/providers` (service-first, PostGIS).
- [x] FR-SR-04 — structured location (city/area/coordinates); distance shown on every result **Built:** distance on every result; slots via `GET /search/providers/:id/slots` (SHM-025).
- [ ] FR-SR-01 / FR-SR-02 — filter by location, experience, expertise, rating; full provider detail view
- [ ] FR-SR-05 — additional filters: price range, available today, verified-documents-only, min completed jobs
- [ ] FR-SR-06 — ranking: rating + distance + completion rate + response speed + recency, admin-configurable weights; blocked/unapproved providers excluded (raw-SQL scoring query — see TRD §6)
- [x] FR-SR-07 — auto-assign: offer down the ranked list until accepted **Built 2026-09-30:** `OfferService` — auto-assign offers ranked candidates one at a time (SHM-038); silence forfeits (`booking.expire-offers`).

### Booking & scheduling (M5)
- [x] FR-BK-02 — only free calendar slots selectable; confirming locks the slot against double booking **Built 2026-09-30:** `generateSlots` (domain) + slot listing; the exclusion constraint stores half the travel buffer per side so listed gaps are exactly bookable (SHM-025).
- [x] FR-BK-01 / FR-BK-04 — booking creation with estimated price, visit/inspection fee, cancellation policy shown before confirm **Built 2026-09-30:** `POST /bookings/quote` + `POST /bookings` / `/checkout`; cash and online (SHM-036/037).
- [x] FR-BK-03 — problem description + up to 5 photos **Built 2026-09-30:** up to 5 customer photos via `POST /bookings/:id/evidence` (base64, insert-only, deduped by `clientUuid`) (SHM-041).
- [x] Booking state machine (SRS §5): implement `REQUESTED → ACCEPTED → SCHEDULED → EN_ROUTE → IN_PROGRESS → …` with every named branch transition (§5.3) — no other way to mutate `Booking.status`. **Ten of eleven events wired (2026-09-28):** `BookingService.apply(bookingId, event, actorUserId, options?)` is the sole status-writer — DB-enforced by `trg_booking_status_guard` (rejects any status change without `app.transition_ctx = 'on'`, set only inside `apply()`'s transaction), and generic over every event in `@smart-home/domain`'s `BOOKING_TRANSITIONS` table, not hardcoded per-event. `accept`/`decline` (see FR-SP-09), `depart` (FR-EX-01), `cancel` (FR-BK-06) and `noShow` all go through `apply()`; `reschedule` (FR-BK-05), `start` (FR-EX-02) and the three quote-revision events (`raiseQuoteRevision`/`approveQuoteRevision`/`rejectQuoteRevision`, FR-EX-05) each needed their own dedicated methods instead — `reschedule` because it moves the slot itself (same availability re-validation as `create()`), `start` because it's gated by a whole OTP mechanism (issue/verify/lock) with its own failure modes, and the revision trio because each writes its own `quote_revisions`/`booking_items` rows alongside the status change, not a plain role+status check. Only `complete` remains unwired, once its endpoint lands (SHM-043) — see `PROGRESS_TRACKER.md`'s SHM-034 and SHM-042 cards for what's still open (chained transitions, top-up gating). **Completed 2026-09-30:** all events wired incl. system events (`paymentCaptured`, `paymentAbandoned`, `exhaustOffers`, `completeAtVisitFee`) and the chained `WORK_COMPLETED` → `AWAITING_VERIFICATION`; `BookingStateService` + `applySystemEvent` (SHM-033/034).
- [x] FR-BK-09 / FR-BK-10 — `PENDING_PAYMENT` (online bookings held until captured) and `UNFULFILLED` (refunded when no provider accepts) are both already live enum values in the `bookingStatuses` list the shared lint rule guards (`eslint.config.js`); v2.1-only ids the SRS text this file was originally traced against (v2.0) dropped, but the state machine already models them
- [x] FR-BK-08 — every transition writes `BookingStatusHistory` (actor, timestamp, reason) — `BookingService.apply()`, for every event it currently handles (accept/decline/depart/cancel/noShow)
- [x] FR-CU-06 — customer booking history: list + detail already exist (`booking.controller.ts` `listMine`/`getOne`); the invoice and verification-feedback fields FR-CU-06 also asks for depend on M6/M7/M8, not yet built
- [x] FR-BK-06 (state-transition half) — `POST /bookings/:id/cancel`, records who cancelled and an optional reason. The fee-rule half is not built — no ledger exists yet to post a fee to **Fee half built 2026-09-30:** late-cancel fee from escrow (online) or `CUSTOMER_RECEIVABLE` (cash), refunds queued in the same transaction (SHM-039).
- [x] FR-BK-05 — reschedule once free (≥4h out) — `POST /bookings/:id/reschedule`, `BookingService.reschedule()` (2026-09-28): once-only and the 4-hour notice window both enforced (400), new time re-validated against availability/leave, conflicting slots caught by the same exclusion constraint `create()` relies on (409)
- [x] Provider-side: FR-SP-07 (availability calendar + leave), FR-SP-08 (service area/radius) — both already built (`provider/availability.service.ts`, `provider/service-areas.service.ts`)
- [x] FR-SP-09 (accept/decline) — `POST /bookings/:id/accept` / `/decline`, `BookingService.apply()` (2026-09-28). The "countdown, no-response forfeits" half of FR-SP-09 is not built — that's the offer/auto-assign cascade, SHM-038
- [x] FR-BK-07 — in-app messaging with phone-number masking (NFR-PR-01) **Built 2026-09-30:** `GET/POST /bookings/:id/messages`, masked before storage, closed after terminal state; no realtime channel yet (SHM-040).

### Work execution & evidence (M6)
- [x] FR-EX-01 (state-transition half) — `POST /bookings/:id/depart`, `SCHEDULED` → `EN_ROUTE`. "Customer notified" is not built — no notifications module exists yet (M11) Customer now notified by SMS + in-app via the outbox handler (SHM-044).
- [x] FR-EX-02 — start OTP gates `IN_PROGRESS`: `BookingService.issueStartOtp()` (called on `accept`) + `startWork()` (2026-09-28) — 6-digit code hashed with `OTP_PEPPER`, sent by SMS, 5 wrong attempts locks for 15 minutes. **`WORK_COMPLETED` must be blocked in code unless `startOtpVerifiedAt` is set** (Integrity Rule 10.3-2) — already enforced by the DB `CHECK` constraint on `bookings`, not app code; holds automatically once `complete` is wired, since `IN_PROGRESS` can now only be reached through this OTP-verified path
- [x] FR-EX-03 — before/after photo capture with timestamps **Built 2026-09-30:** BEFORE/AFTER/CHECKLIST photos, server `received_at`, insert-only (SHM-041).
- [x] FR-EX-09 — geofenced check-in/check-out; flag significant shortfall vs. expected duration (feeds Tier A routing) **Built 2026-09-30:** optional `lat`/`lng` on start and complete; distance vs geofence radius recorded and flagged, never blocking (SHM-041/043). Duration-shortfall flag for tier routing is phase 3.
- [x] FR-EX-04 / FR-EX-06 — parts/materials logged, itemised invoice generated on completion — the invoice/completion half is not built (SHM-043); parts/materials as invoice lines exist once a revision is approved (`booking_items`, kind `EXTRA` — see FR-EX-05), but there's no line-item entry for the original quoted scope yet **Built 2026-09-30:** `CompletionService` — itemised invoice + PDF; extras/parts via approved revisions (SHM-042/043).
- [x] FR-EX-05 — revised quote requires in-app customer approval before work continues — `BookingService.raiseQuoteRevision()` / `approveQuoteRevision()` / `rejectQuoteRevision()` (2026-09-28): provider raises a revision (`IN_PROGRESS` → `QUOTE_REVISION`, one `quote_revisions` row, DB-enforced one-pending-at-a-time), customer approves (adds `deltaPaisa` to `approved_total_paisa`, inserts an `EXTRA` `booking_items` row) or rejects (no charge) — both return to `IN_PROGRESS`. **Not built:** the top-up capture FR-PY-12 asks for before an online job's approval takes effect — needs M8's payment/ledger module, so approval currently applies unconditionally regardless of payment mode
- [x] FR-EX-10 — `final_amount ≤ approved_total`; any excess is refunded from escrow at release, never charged over the approved quote (v2.1 refinement of FR-EX-06, flagged accidental-looking in the FR-id reconciliation below — this invariant isn't stated anywhere in the v2.0 text this file was originally traced against) **Built 2026-09-30:** final above approved → 422; a lower final adds an adjustment line (SHM-043).
- [x] FR-EX-11 — an inspection-first job the customer rejects after the visit completes for the visit fee only, nothing more — blocked on `complete` (FR-EX-06/SHM-043) existing at all, since that's where this special case would branch **Built 2026-09-30:** rejecting extra work on an inspection-first job completes at the visit fee (SHM-042).
- [x] FR-EX-08 — service-specific checklist (with photo evidence where required) must complete before submission **Built 2026-09-30:** photo-required steps need their CHECKLIST photo; completion refuses while steps remain (SHM-041/043).
- [ ] FR-EX-07 — configurable workmanship warranty; a claim reopens the original booking as rework, not a new job

**Definition of done — Phase 2:** a job runs end to end from search through completion
submission and stops cleanly at `AWAITING_VERIFICATION` (Phase 3 picks it up from there).

**Status 2026-09-30:** met on the backend — see `PROGRESS_TRACKER.md` SHM-025, 033–045 (`IN REVIEW`). Open: FR-SR-01/02/05/06 filters and weighted ranking (need ratings, phase 3), FR-EX-07 warranty reopen, realtime channel, provider documents (SHM-022).

---

## Phase 3 — Verification and money
`verification` · `payments` · `trust` (ratings only) · **first worker jobs**

### Verification & feedback (M7)
- [x] FR-VC-01 — completion → `AWAITING_VERIFICATION`, all funds frozen **Built 2026-09-30:** completion chains to `AWAITING_VERIFICATION` and the job waits in the verification queue; money stays in escrow (SHM-043/057).
- [x] FR-VC-02 — queue ordered by waiting time with an SLA countdown; breaches visible on the admin dashboard (FR-AD-12) **Built 2026-09-30:** `GET /agent/queue`, SLA in business minutes, `verification.sla-monitor` stamps breaches; the admin dashboard view is phase 4/5 (SHM-055).
- [x] FR-VC-13 — cash jobs get queue priority with a 15-minute SLA, tighter than the online default — money hasn't moved yet on a cash job, so verifying it fast matters more **Built 2026-09-30:** cash jobs priority 0 with the 15-minute SLA (SHM-043/055).
- [x] FR-VC-15 — a queue item locks to the agent who claims it, with an expiring lock, so two agents can never work the same call (mirrors the `SKIP LOCKED` pattern already used in `OutboxDispatcher` — see `apps/api/test/integration/outbox.test.ts`) **Built 2026-09-30:** `FOR UPDATE SKIP LOCKED` claim, expiring lock sweeper (SHM-055).
- [x] FR-VC-11 — Tier A/B routing per SRS §4.3 rules; tier stored on the booking **Built 2026-09-30:** `routeTier` R1–R10, reasons stored (SHM-054).
- [x] FR-VC-03 — agent console query: booking + invoice + photos + provider history, single call **Built 2026-09-30:** `GET /agent/verifications/:id` (SHM-056).
- [x] FR-VC-04 — fixed questionnaire only (SRS §4.5) — no free-text feedback path **Built 2026-09-30:** fixed questionnaire schema, no free-form feedback field (SHM-056/057).
- [x] FR-VC-05 — one of 4 outcomes recorded: verified / verified-with-issue / rework / disputed **Built 2026-09-30:** the four agent outcomes plus system LINK_CONFIRMED / AUTO_RELEASED (SHM-057/059).
- [x] FR-VC-08 — verification record immutable once `submittedAt` is set; amendments are new linked rows, never edits **Built 2026-09-30:** immutable once submitted, enforced by the database (SHM-057).
- [x] FR-VC-10 — an agent cannot verify a booking where they're linked as the customer or provider **Built 2026-09-30:** conflict-of-interest on claim and submit (SHM-055).
- [x] FR-VC-06 — call attempts logged individually (time, agent, duration, result) **Built 2026-09-30:** insert-only attempts with time bands; link after 3 unanswered across bands (SHM-056/059).
- [x] FR-VC-09 — call recording: consent line, encrypted at rest, admin/finance-only access (NFR-PR-02) **Built 2026-09-30:** consent line enforced, recordings playable by finance/admin only via signed audited links, retention purge (SHM-056/064).
- [x] FR-VC-14 — SLA time is counted only within configured calling hours, not wall-clock — already implemented and tested by name: `packages/domain/test/slaCalendar.test.ts` ("FR-VC-14: never lands outside the accrual window 08:00-22:00")
- [x] **Worker job:** `verification-sla` — flag bookings past the 30-minute contact SLA (§4.4), visible on the ops board (built in Phase 1's admin slice / extended in Phase 4) **Built 2026-09-30:** `verification.sla-monitor`, `verification.lock-sweeper`.
- [x] **Worker job:** `tier-escalation` — FR-VC-12, Tier B → Tier A after 24h no response **Built 2026-09-30:** `verification.b-escalation`.
- [x] **Worker job:** `auto-release` — FR-VC-07, 72h no reachable customer → release payment, suppress rating **Built 2026-09-30:** `verification.auto-release`.

### Payments, escrow & payouts (M8)
- [x] FR-PY-01 — customer pays cash on the spot or by transfer directly to the provider (the general FR.pdf-sourced statement `FR-PY-04`'s cash path below implements) **Built 2026-09-30:** `POST /bookings/:id/cash-received` (SHM-060).
- [x] FR-PY-02 — online capture into platform escrow via gateway adapter (`packages/integrations`) **Built 2026-09-30:** capture into escrow (SHM-037).
- [x] FR-PY-03 — escrow releases only on a passing verification outcome or the auto-release rule — no other release path **Built 2026-09-30:** `ReleaseService` is the only release path and a trigger refuses PAYMENT_RELEASED without a permitting verification (SHM-057).
- [x] FR-PY-04 — cash path: reversed sequence (call before cash changes hands), commission debited to wallet **Built 2026-09-30:** call first, then cash-received debits commission to the wallet (SHM-060).
- [x] FR-PY-11 — a cash customer's unpaid cancellation fee becomes a receivable posted against their next booking, since there's no captured payment to deduct it from (v2.1 refinement; without this a cash customer can cancel and never actually pay the fee — flagged accidental-looking below) **Built 2026-09-30:** receivable on cash late-cancel, shown on the next quote (SHM-036/039).
- [x] FR-PY-12 — extra work approved mid-job on an online-paid booking needs a top-up capture before work resumes — the revised-quote approval in FR-EX-05 has nowhere to pull the extra money from without this **Built 2026-09-30:** top-up captured before approval (SHM-042).
- [x] FR-PY-05 — commission-debt ceiling blocks new job offers until cleared **Built 2026-09-30:** debt over the ceiling blocks offers, direct bookings and search (SHM-060).
- [x] FR-PY-13 — a provider can clear commission debt online (self-service), not only by manual admin adjustment — otherwise FR-PY-05's block has no resolution path **Built 2026-09-30:** `POST /provider/debt/pay` (SHM-060).
- [x] FR-PY-06 — double-entry `LedgerEntry` writes for every movement (capture/hold/release/commission/refund/penalty/payout); balances always `SUM()`, never a stored editable field **Built 2026-09-30:** balanced double-entry postings for every movement; nightly reconciliation (SHM-037/057/062).
- [x] FR-PY-07 — refunds to original method, linked reason **Built 2026-09-30:** refunds per payment with reason, gateway-settled (SHM-037/061).
- [x] FR-PY-09 — idempotent gateway callbacks, keyed on `Payment.gatewayRef` (Integrity Rule 10.3-4 depends on this holding) **Built 2026-09-30:** idempotent webhook (SHM-037).
- [x] FR-PY-08 — payout batch run (build the endpoint now; the scheduled trigger is a Phase 5 worker job) **Built 2026-09-30:** payout batch endpoints, CSV and PDF statements; the weekly trigger is phase 5 (SHM-061).
- [x] FR-SP-10 — provider earnings dashboard: held / releasable / paid amounts, commission deducted, weekly and monthly totals **Built 2026-09-30:** `GET /provider/earnings` (SHM-061).
- [x] FR-SP-11 — provider requests payout of their released wallet balance to a registered bank or mobile-wallet account **Built 2026-09-30:** payout accounts and `POST /provider/payouts` (SHM-061).

### Ratings (M9 — verification-gated slice only; complaints/remarks UI-facing bits land in Phase 4)
- [x] FR-RT-01 / FR-RT-02 — customer rates and leaves a remark after completion (the general FR.pdf-sourced statements `FR-RT-03`/`FR-RT-04` below make concrete: no rating without a verified call) **Built 2026-09-30:** rating and remark are created from the verification call (SHM-057).
- [x] FR-RT-03 — `Rating` can only be created from a completed `VerificationCall` — enforced by the schema FK, not just application logic **Built 2026-09-30:** schema trigger, tested (SHM-057).
- [x] FR-RT-04 — published score = average of the 4 criteria, weighted toward the most recent 20 jobs **Built 2026-09-30:** CL-17 weighted score (SHM-063).
- [x] FR-RT-05 — provider profile shows the score, the job count it's based on, and the rating distribution **Built 2026-09-30:** score, count and distribution on the public reputation (SHM-063).
- [x] FR-RT-06 — remarks publish under the customer's first name and initial only; full identity never shown to the provider **Built 2026-09-30:** "First L." only (SHM-057/063).
- [x] FR-RT-07 — admin may unpublish an abusive remark; the underlying rating stays in the score and the removal is logged **Built 2026-09-30:** admin unpublish, score unchanged, audited (SHM-063).
- [x] FR-SP-04 / FR-SP-05 — provider can view the ratings and remarks customers have given them **Built 2026-09-30:** `GET /provider/ratings` (SHM-063).
- [x] FR-SP-12 — provider may post one reply to a published remark; replies are visible and can't be edited after posting **Built 2026-09-30:** one immutable reply (SHM-063).
- [x] FR-AD-06 / FR-AD-07 — admin can view the ratings and remarks recorded against each provider, and each provider's average rating **Built 2026-09-30:** `GET /admin/providers/:id/ratings` (SHM-063).
- [x] Rating publish happens exactly at `PAYMENT_RELEASED`, never before (§4.4) **Built 2026-09-30:** ratings are published in the verification transaction, at release.

**Definition of done — Phase 3:** money moves correctly — a completed job reaches a
verification outcome (by call or auto-release) and the ledger reflects the release, with
no path in the codebase that releases funds any other way.

**Status 2026-09-30:** met on the backend — see `PROGRESS_TRACKER.md` SHM-054–065 (`IN REVIEW`). Open: `agent-queue` WebSocket, admin dashboard for SLA breaches (FR-AD-12), `provider_stats` table (computed on read today), FR-AD-08/11 badge administration UI, dispute resolution (phase 4).

---

## Phase 4 — Trust and communication
`trust` (complaints/disputes/penalties) · `notifications`

### Complaints & disputes (M10)
- [ ] FR-CP-01 / FR-CP-07 — customer and provider can raise complaints
- [ ] FR-CP-02 — admin views customer complaints and takes action (the general FR.pdf-sourced statement the states/outcomes below make concrete)
- [ ] FR-CP-03 — 5-state lifecycle (open/under review/awaiting response/resolved/rejected) with severity-based SLA
- [ ] FR-CP-04 — complaints attach to a booking, carry photographic evidence, and are visible to the verification agent handling that booking
- [ ] FR-CP-08 — safety-severity complaints jump to the top of the admin queue
- [ ] FR-CP-05 — provider gets a right of reply before any penalty
- [ ] FR-CP-06 — resolution outcomes: no action / warning / partial refund / full refund / provider penalty / suspension / block
- [ ] Dispute resolution (UC-14): full release / partial release / full refund / refund-with-penalty, ledger + notification on resolution

### Conduct & penalties (M15)
- [ ] FR-PN-01 — demerit points per the Section 7.2 schedule
- [ ] FR-PN-02 — rolling 180-day expiry, decay 1 point / 30 clean days (worker job, see below)
- [ ] FR-PN-03 — Section 7.3 thresholds trigger automatically (warning → ranking demotion → suspension → re-verification → permanent block)
- [ ] FR-PN-04 — penalty debited from wallet; shortfall becomes a blocking debt
- [ ] FR-PN-05 — total liability per job capped at job value + configured max fine
- [ ] FR-PN-06 — no penalty applies until 48h right-of-reply has passed
- [ ] FR-PN-07 — appeal path, decision logged to `audit_log`
- [ ] FR-PN-08 — the penalty schedule is shown to the provider at registration and stays visible in their conduct record afterwards
- [ ] FR-PN-10 — where multiple breach categories could apply to one incident, the harsher consequence wins — a conflict-resolution rule the graduated-consequence engine (FR-PN-03) needs to be deterministic (v2.1 refinement, flagged accidental-looking below)
- [ ] FR-SP-14 — provider can view their own conduct record: current demerit points and the date each one expires
- [ ] FR-SP-13 / FR-PN-09 — provider tier badges computed from verified jobs only; top-tier providers get priority job offers, a reduced commission rate and accelerated payouts
- [ ] **Worker job:** `demerit-decay` — daily cron implementing FR-PN-02
- [ ] Note on `FR-AD-08` ("admin blocks a provider for continuous poor rating", FR.pdf-sourced): superseded by this module plus `FR-AD-11` (Phase 5, auto-flag below threshold) — a provider heading toward a block goes through the graduated `FR-PN-03` consequences and an automatic rating-threshold flag, not a one-off manual block button

### Notifications (M11)
- [ ] FR-NT-01 — every booking state change notifies by email, SMS and in-app message
- [ ] FR-NT-02 — providers are alerted on: new job offer with countdown, acceptance confirmation, upcoming job reminder, payment release
- [ ] FR-NT-03 — customers are alerted on: booking confirmation, provider en route, start OTP, work completed, pending verification call, payment release
- [ ] FR-NT-04 — administrators are alerted on: new provider awaiting approval, verification SLA breach, dispute opened, safety-flagged complaint
- [ ] FR-NT-05 — delivery logged (channel, recipient, template, status)
- [x] FR-NT-06 — templates editable per event × channel × language — already seeded and running: the dev seed output logs "seeded notification templates (en and ur)" (v2.1-only id the v2.0-traced text of this file had dropped, but the capability was already built — see the FR-id reconciliation below)
- [ ] **Worker job:** `notification-dispatch` — queue-driven, sends via the email/SMS adapters, updates `Notification.status`

**Definition of done — Phase 4:** a complaint or a dispute can be raised, resolved, and
(where applicable) produce a logged, appealable penalty — with every state change
notifying the right party.

---

## Phase 5 — Depth
`plans` · `reporting` · remaining worker jobs

### Maintenance plans (M13)
- [ ] FR-MP-01 — admin defines plans (e.g. quarterly plumbing inspection, 2 call-outs)
- [ ] FR-MP-02 — subscribed visits auto-scheduled, offered first to the same provider
- [ ] FR-MP-03 — plan visits follow the identical verification flow; release draws on the plan balance
- [ ] FR-MP-04 — customer view of remaining entitlements/renewal date; cancel path

### Customer nice-to-haves (M2, deferred here as Low/Medium priority in the SRS)
- [ ] FR-CU-07 — customer can re-book a previously used provider directly from booking history
- [ ] FR-CU-08 — customer can maintain a list of favourite providers
- [ ] FR-CU-09 — customer can deactivate their account; personal data is anonymised while financial records are retained
- [ ] FR-PY-10 — coupons and referral credits apply at booking, settled against platform commission rather than provider earnings

### Reporting (M14)
- [ ] FR-RP-01 / FR-RP-02 — monthly bookings report; "successful" = verified or auto-released without dispute
- [ ] FR-RP-03 — revenue report (gross, commission, refunds, penalties, net) by month/category
- [ ] FR-RP-04 — provider performance report
- [ ] FR-RP-05 — verification report (calls placed, first-attempt success, avg duration, outcome mix, SLA compliance, auto-release count)
- [ ] FR-RP-06 — PDF + Excel export
- [ ] Move report queries onto raw SQL / a read replica once they compete with transactional load (TRD §5, §6)

### Remaining worker job
- [ ] **Worker job:** `payout-batch` — FR-PY-08, fixed-cycle cron producing the batch file + per-provider statements

### Operations board (M12, completed here)
- [ ] FR-AD-11 — auto-flag providers below the configured rolling-average threshold
- [ ] FR-AD-12 — ops board: today's bookings by state, verification queue depth, SLA breaches, open disputes, total escrow held
- [ ] FR-AD-15 — settings coverage complete: commission, cancellation fees, SLA timers, calling hours, auto-release window, surcharges, tier thresholds, penalty values

**Definition of done — Phase 5:** the system reports on itself — every number in the
implementation plan's success criteria is queryable without a manual DB query.

---

## Cross-cutting (do continuously, not a phase)
- [ ] NFR-SE-02/03/04/05 — server-side authz, parameterized queries, CSRF/XSS protection, upload restrictions
- [ ] NFR-IN-01/02 — every money operation inside `prisma.$transaction`; idempotent callbacks
- [ ] NFR-PE-01/02 — indexes present for search/filter load; verify with `EXPLAIN` before Phase 2 sign-off
- [ ] Unit tests per service class; e2e coverage for the booking state machine and the verification→payment path (TRD §11)
- [ ] Keep `packages/contracts` (shared DTOs/enums) in sync with `apps/api` — this is what the frontend task board's API client is built against

---

## Appendix: FR-id reconciliation (2026-09-28)

Full detail behind the two checked-off "Platform migration" items above. Every FR id in
both `smart-home-docs/01_SRS_v2.1.md` (145 ids) and the root `SRS_Smart_Home_Maintenance_Services.pdf`
(v2.0, 130 ids) is now cited somewhere in this file — confirmed by extracting every `FR-XX-NN`
token from each source and diffing against this file's own tokens; the sets now match exactly.

**The 15 ids in v2.1 but not v2.0** (v2.1 is chronologically later — see its own changelog,
`smart-home-docs/01_SRS_v2.1.md:643` — despite living in the "old docs" folder):

| FR id | What it adds | Verdict |
|---|---|---|
| `FR-CAT-08` | Ordered service checklist, photo-required items | Intentional — merged into `FR-EX-08` in v2.0 |
| `FR-EX-12` | Offline-resumable evidence uploads on unreliable 3G | Intentional — reasonable to defer, technically complex |
| `FR-AD-16` | Formal staff conflict-of-interest declarations | Intentional — the safety-critical part survives as `FR-VC-10`; the broader HR process is deferred |
| `FR-BK-09` | `PENDING_PAYMENT` booking state | Doc-only gap — already a live enum value |
| `FR-BK-10` | `UNFULFILLED` booking state + refund | Doc-only gap — already a live enum value |
| `FR-NT-06` | Per-event × channel × language templates | Doc-only gap — en/ur templates already seeded |
| `FR-VC-14` | SLA counted only in calling hours | Doc-only gap — implemented and tested (`slaCalendar.test.ts`) |
| `FR-EX-10` | `final_amount ≤ approved_total` invariant | Real gap — not yet built or specified in v2.0 |
| `FR-EX-11` | Inspection-first rejection = visit fee only | Real gap |
| `FR-PN-10` | Breach-category precedence (harsher wins) | Real gap |
| `FR-PY-11` | Cash cancellation fee → receivable on next booking | Real gap |
| `FR-PY-12` | Online top-up capture for approved revisions | Real gap |
| `FR-PY-13` | Provider clears commission debt online | Real gap |
| `FR-VC-13` | Cash-job queue priority, 15-min SLA | Real gap |
| `FR-VC-15` | Queue claim locking (one agent at a time) | Real gap |

Every one of these 15 — including the 8 "real gap" rows — is already cited as a `Refs:`
entry on a ticket in `docs/07_PROGRESS_TRACKER.md` (e.g. `FR-VC-15` on SHM-055, `FR-AD-16`
on SHM-024). None of them are missing from the team's actual plan; they were only missing
from this file, `docs/TRD_Smart_Home_Maintenance.md` and `docs/OPENCODE_BUILD_PROMPT.md`,
which were built from v2.0 while the live tracker had already moved to v2.1. All 15 are now
cited above in their module's phase section, carrying this same verdict inline.

**The 32 v2.0 ids that were absent from this file specifically** (not from the tracker —
a narrower gap than the above): `FR-AD-04/06/07`, `FR-CP-02/04`, `FR-CU-05/06/07/08/09`,
`FR-NT-02/03/04`, `FR-PN-08/09`, `FR-PY-01/10`, `FR-RP-02`, `FR-RT-01/02/05/06/07`,
`FR-SP-04/05/10/11/12/13/14`, `FR-VC-02`. All 32 are now cited above. Two were already
built (`FR-CU-05` customer addresses, `FR-CU-06` booking list/detail, both marked `[x]`
with a file reference); the rest are genuinely not built yet and are cited as ordinary
`[ ]` phase items.
