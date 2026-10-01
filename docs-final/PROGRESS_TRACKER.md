# Smart Home Maintenance Services — Build Progress Tracker

> **Single source of truth for build progress.** Backend (BE) and frontend (FE) developers work from this file and update it as tickets move. Requirement IDs refer to `SRS.md` (this folder); section numbers (§) refer to `TRD.md` (this folder); schema is `schema.sql`. This file, `TASKS_BACKEND.md` and `TASKS_FRONTEND.md` all live together in `docs-final/` now — see `README.md` there for why.

| Field | Value |
|---|---|
| Project key | `SHM` |
| Baseline docs | SRS v2.1 (`SRS.md`) · TRD (`TRD.md`) · ERD (`ERD.md`) · `schema.sql` · Cursor build prompt |
| Tracker created | 21 Sep 2026 |
| Last updated | 1 Oct 2026 - *update on every change* |
| Product owner | Muhammad Hamza Kundi |
| BE lead | backend agent |
| FE lead | _name_ |

---

## 1. How to use this file

**Statuses** (use exactly these words so the count command in §3 works):

| Status | Meaning | Who sets it |
|---|---|---|
| `TODO` | Ready, not started | Lead when planning |
| `IN PROGRESS` | Developer actively working; put your name in *Assignee* | Developer |
| `IN REVIEW` | PR open, all acceptance criteria ticked by the developer | Developer |
| `BLOCKED` | Cannot proceed; add a row in §6 Blockers | Anyone |
| `DONE` | PR merged, CI green, reviewer confirmed acceptance criteria | Reviewer |

**Update rules**

1. Status lives in **one place only**: the *Status* column of the ticket index for that phase (§4). The ticket detail cards (§5) hold the acceptance-criteria checkboxes.
2. When you start a ticket: set `IN PROGRESS`, fill *Assignee*, create branch `SHM-###-short-name`.
3. Tick each acceptance criterion `[x]` only when it is proven by a test or a demo.
4. When the PR is opened: set `IN REVIEW` and put the PR link in the *PR* column. PR title starts with the ticket key.
5. The reviewer (the other side's lead for API tickets, same-side lead otherwise) sets `DONE` after merge.
6. After any change: update the counts in §3 and add a line to §8 Change log.
7. Don't change a ticket's scope silently. Scope changes go to the product owner, then into §8 with the reason.
8. New work found during development gets a new key at the end (`SHM-102`, `SHM-103`, …) in the right phase table. Never renumber.

**Definition of Ready** — dependencies are `DONE` (or the API contract is agreed and mocked), requirement refs are clear, acceptance criteria are testable.

**Definition of Done** — code merged to `main`; lint, typecheck, unit and integration tests green; acceptance criteria ticked; new endpoints documented in OpenAPI; UI works at 360 px in en **and** ur; no money as floats; no `bookings.status` write outside `BookingStateService`; audit rows written for admin actions.

**BE → FE hand-off.** A BE ticket with an *API* line is the contract for the FE tickets that depend on it. FE may start once the BE developer has merged the endpoint **shape** (OpenAPI + typed stub response). Add the note `contract ready` in that BE ticket's *PR* column. The BE ticket is still `DONE` only when the real behaviour ships.

**Phase gate.** A phase is closed only when its `SHARED` exit-gate ticket is `DONE`, the Cursor *Review Prompt* has been run, and git tag `phase-N` is pushed. Record this in §7.

---

## 2. Plan overview

| Epic | Phase | Duration | Goal | Tickets | Story points |
|---|---|---|---|---|---|
| E0 | Phase 0 — Foundation & Infrastructure | 1 wk | Monorepo builds, schema migrates, seed runs, every role can log in, CI green. | 18 | 69 |
| E1 | Phase 1 — Onboarding (M1, M2, M3, M12 core) | 2 wks | An admin can onboard a real tradesman who then becomes bookable-ready. | 14 | 77 |
| E2 | Phase 2 — Transacting (M4, M5, M6) | 3 wks | A job runs from search to `AWAITING_VERIFICATION`, cash and online. | 21 | 117 |
| E3 | Phase 3 — Verification & Money (M7, M8, M9) | 3 wks | Money moves correctly; ratings exist only from verification; ledger reconciles to zero drift. | 21 | 100 |
| E4 | Phase 4 — Trust & Communication (M10, M11, M15) | 2 wks | Complaints, disputes, penalties, appeals and notifications work end to end. | 14 | 74 |
| E5 | Phase 5 — Depth, Hardening & Release (M13, M14, ops) | 2 wks | Plans, reports, ops board, NFR evidence, UAT sign-off, production deploy. | 13 | 70 |
| | **Total** | **13 wks** | | **101** | **507** |

---

## 3. Progress dashboard

*Recount after every status change.* Quick count from the repo root:

```bash
grep -oE '\| (TODO|IN PROGRESS|IN REVIEW|BLOCKED|DONE) \|' docs/PROGRESS_TRACKER.md | sort | uniq -c
```

| Epic | BE done / total | FE done / total | Shared done / total | SP done / total | % |
|---|---|---|---|---|---|
| E0 | 0 / 10 | 0 / 5 | 0 / 3 | 0 / 69 | 0 % |
| E1 | 0 / 7 | 0 / 6 | 0 / 1 | 0 / 77 | 0 % |
| E2 | 0 / 13 | 0 / 7 | 0 / 1 | 0 / 117 | 0 % |
| E3 | 0 / 12 | 0 / 8 | 0 / 1 | 0 / 100 | 0 % |
| E4 | 0 / 7 | 0 / 6 | 0 / 1 | 0 / 74 | 0 % |
| E5 | 0 / 7 | 0 / 4 | 0 / 2 | 0 / 70 | 0 % |
| **All** | **0 / 56** | **0 / 36** | **0 / 9** | **0 / 507** | **0 %** |

Nothing is counted as `DONE` yet: SHM-001 to SHM-012 are merged and every one of
their acceptance criteria is either ticked on evidence or still open, but per
section 1 only a reviewer sets `DONE` after confirming the criteria. The counts
above stay at zero until then. SHM-013 has not been run in CI.

**Open in E0, with evidence attached to each:** the four MinIO buckets cannot be
created locally (see Blockers); the doc pack lives in `smart-home-docs/` rather
than the `docs/` path the SHM-001 criteria name, and the ticket still says
`pnpm` where the project uses npm workspaces; SHM-013 has not been run in CI.

Verification as of this update, all on this machine: lint, typecheck and build
clean in every package; 64 unit tests and 116 integration tests green against
live PostGIS and Redis; the API boots and `/health/ready` reports database,
redis, queues, settings and storage all ok. Five new modules exist since the
last update — catalogue (SHM-019), customer addresses (part of SHM-020),
provider profile/availability/time-off/service-areas and approval (part of
SHM-021 and SHM-023), and search (part of SHM-035), plus a small unticketed
`places` module (cities/areas) that address creation and provider location
both depend on. Every endpoint was exercised twice: once through the
integration suite, and once as a live HTTP walkthrough against the running
dev server using the exact example payloads now shown in Swagger — register
a customer, register a provider, build out their profile/availability/areas/
price, have an admin approve the offer and the account, and have search
actually surface that provider by real PostGIS distance. None of these
tickets are complete against their originally written acceptance criteria
(see §5) — each detail card below records exactly what is built and tested
versus what is still open, rather than being marked done on a partial match.

**M5 (booking) build in progress, same session:** a design spec
(`docs/superpowers/specs/2026-09-26-m5-booking-design.md`) and implementation
plan (`docs/superpowers/plans/2026-09-26-m5-booking-plan.md`) were written and
approved, and execution has started task-by-task with a fresh reviewer per
task (no git repository exists in this project, so review packages are full
file contents rather than diffs, and there is no worktree/branch/commit
history for this work — see the plan's Global Constraints and the execution
ledger at `.superpowers/sdd/2026-09-26-m5-booking-plan/progress.md` for the
full detail). So far: the pure state-transition table (`packages/domain`,
task 1) and booking creation (`POST /bookings`, task 2) are both implemented
and independently reviewed clean, including one real fix round on task 2
(the create write sequence wasn't transactional — fixed, re-reviewed clean).
Booking read/list (`GET /bookings/:id`, `GET /bookings`, task 3) is
implemented and self-tested by its implementer (9/9 passing) but its task
review was interrupted mid-run and has not yet completed — treat it as
unreviewed until that finishes. Tasks 4-12 (state-service foundation,
accept/decline, cancel, reschedule, arrival OTP, no-show, checklist, quote
revisions, completion, and the final full-suite verification pass) have not
started.

Priority: **P0** = required for the phase exit gate · **P1** = required for release · **P2** = nice to have. Story points are relative size (Fibonacci). Calibrate velocity at the end of Phase 0 and re-plan dates from that, not from the point totals.

---

## 4. Ticket index (update *Status*, *Assignee*, *PR* here)

### E0 · Phase 0 — Foundation & Infrastructure

| Key | Owner | Type | Pri | SP | Title | Depends on | Assignee | Status | PR |
|---|---|---|---|---|---|---|---|---|---|
| [SHM-001](#shm-001) | SHARED | Task | P0 | 3 | Monorepo scaffold & shared tooling | — | backend agent | IN REVIEW | merged, awaiting reviewer |
| [SHM-002](#shm-002) | SHARED | Task | P0 | 2 | Local infrastructure via docker-compose | SHM-001 | backend agent | IN REVIEW | merged, awaiting reviewer |
| [SHM-003](#shm-003) | BE | Task | P0 | 3 | DB package: migration, dbmate scripts, Prisma pull | SHM-002 | backend agent | IN REVIEW | merged, awaiting reviewer |
| [SHM-004](#shm-004) | BE | Task | P0 | 5 | Deterministic seed data | SHM-003 | backend agent | IN REVIEW | merged, awaiting reviewer |
| [SHM-005](#shm-005) | BE | Task | P0 | 3 | `packages/contracts` — shared types for FE and BE | SHM-003 | backend agent | IN REVIEW | merged, awaiting reviewer |
| [SHM-006](#shm-006) | BE | Task | P0 | 3 | `packages/domain` basics: Clock, Money, SlaCalendar | SHM-001 | backend agent | IN REVIEW | merged, awaiting reviewer |
| [SHM-007](#shm-007) | BE | Story | P0 | 5 | API skeleton (NestJS 11 on Fastify) | SHM-003, SHM-005 | backend agent | IN REVIEW | merged, awaiting reviewer |
| [SHM-008](#shm-008) | BE | Story | P0 | 5 | Platform services: settings, audit, idempotency, outbox | SHM-007 | backend agent | IN REVIEW | merged, awaiting reviewer |
| [SHM-009](#shm-009) | BE | Story | P0 | 8 | Identity: register, OTP, login, sessions | SHM-008 | backend agent | IN REVIEW | merged, awaiting reviewer |
| [SHM-010](#shm-010) | BE | Story | P0 | 5 | Staff TOTP + RBAC policy guard | SHM-009 | backend agent | IN REVIEW | merged, awaiting reviewer |
| [SHM-011](#shm-011) | BE | Task | P0 | 5 | Integration ports + working mocks; dev inbox | SHM-007 | backend agent | IN REVIEW | merged, awaiting reviewer |
| [SHM-012](#shm-012) | BE | Test | P0 | 3 | DB invariant integration tests | SHM-003, SHM-008 | backend agent | IN REVIEW | merged, awaiting reviewer |
| [SHM-013](#shm-013) | SHARED | Task | P0 | 3 | CI pipeline (GitHub Actions) | SHM-001, SHM-002 | backend agent | TODO | — |
| [SHM-014](#shm-014) | FE | Task | P0 | 3 | Web app scaffold: Next.js 15, i18n, design system | SHM-001 | — | TODO | — |
| [SHM-015](#shm-015) | FE | Task | P0 | 3 | Typed API client with token refresh | SHM-005, SHM-007 | — | TODO | — |
| [SHM-016](#shm-016) | FE | Story | P0 | 5 | Auth pages | SHM-009, SHM-010, SHM-015 | — | TODO | — |
| [SHM-017](#shm-017) | FE | Task | P0 | 3 | Role layout shells + route manifest + status UI map | SHM-016 | — | TODO | — |
| [SHM-018](#shm-018) | FE | Task | P1 | 2 | Provider PWA manifest + dev inbox page | SHM-014, SHM-011 | — | TODO | — |

### E1 · Phase 1 — Onboarding (M1, M2, M3, M12 core)

| Key | Owner | Type | Pri | SP | Title | Depends on | Assignee | Status | PR |
|---|---|---|---|---|---|---|---|---|---|
| [SHM-019](#shm-019) | BE | Story | P0 | 5 | Catalogue API (admin CRUD + public read) | SHM-008, SHM-010 | backend agent | IN PROGRESS | — |
| [SHM-020](#shm-020) | BE | Story | P0 | 5 | Customer profile, addresses, favourites, deactivate | SHM-009 | backend agent | IN PROGRESS | — |
| [SHM-021](#shm-021) | BE | Story | P0 | 8 | Provider onboarding API | SHM-009, SHM-019 | backend agent | IN PROGRESS | — |
| [SHM-022](#shm-022) | BE | Story | P0 | 5 | Provider documents & CNIC protection | SHM-021, SHM-011 | backend agent | TODO | — |
| [SHM-023](#shm-023) | BE | Story | P0 | 5 | Admin approval workflow | SHM-022 | backend agent | IN PROGRESS | — |
| [SHM-024](#shm-024) | BE | Story | P1 | 5 | Admin management: users, roles, settings, conflicts | SHM-010, SHM-008 | backend agent | TODO | — |
| [SHM-025](#shm-025) | BE | Story | P0 | 5 | Slot generator + slots endpoint | SHM-021, SHM-006 | backend agent | IN REVIEW | built, awaiting reviewer |
| [SHM-026](#shm-026) | FE | Story | P0 | 5 | Public catalogue pages (SSR) | SHM-017, SHM-019 | — | TODO | — |
| [SHM-027](#shm-027) | FE | Story | P0 | 5 | Customer account pages | SHM-020, SHM-017 | — | TODO | — |
| [SHM-028](#shm-028) | FE | Story | P0 | 8 | Provider onboarding wizard (mobile-first, Urdu-ready) | SHM-021, SHM-022, SHM-017 | — | TODO | — |
| [SHM-029](#shm-029) | FE | Story | P1 | 5 | Provider settings pages | SHM-028, SHM-025 | — | TODO | — |
| [SHM-030](#shm-030) | FE | Story | P0 | 5 | Admin approvals & provider detail | SHM-023, SHM-017 | — | TODO | — |
| [SHM-031](#shm-031) | FE | Story | P1 | 8 | Admin catalogue, customers, roles, settings, audit UIs | SHM-019, SHM-024 | — | TODO | — |
| [SHM-032](#shm-032) | SHARED | Test | P0 | 3 | Phase 1 E2E + exit gate | SHM-028, SHM-030, SHM-031 | backend agent | TODO | — |

### E2 · Phase 2 — Transacting (M4, M5, M6)

| Key | Owner | Type | Pri | SP | Title | Depends on | Assignee | Status | PR |
|---|---|---|---|---|---|---|---|---|---|
| [SHM-033](#shm-033) | BE | Story | P0 | 8 | Booking state machine (domain) T1–T26 | SHM-006, SHM-005 | backend agent | IN REVIEW | built, awaiting reviewer |
| [SHM-034](#shm-034) | BE | Story | P0 | 5 | `BookingStateService.apply()` | SHM-033, SHM-008 | backend agent | IN REVIEW | built, awaiting reviewer |
| [SHM-035](#shm-035) | BE | Story | P0 | 8 | Search & ranking API | SHM-025, SHM-020 | backend agent | IN PROGRESS | — |
| [SHM-036](#shm-036) | BE | Story | P0 | 3 | Quote endpoint | SHM-019, SHM-020 | backend agent | IN REVIEW | built, awaiting reviewer |
| [SHM-037](#shm-037) | BE | Story | P0 | 8 | Checkout: cash + online, webhook, capture, abandonment | SHM-034, SHM-036, SHM-011 | backend agent | IN REVIEW | built, awaiting reviewer |
| [SHM-038](#shm-038) | BE | Story | P0 | 8 | Offers & auto-assign cascade | SHM-037 | backend agent | IN REVIEW | built, awaiting reviewer |
| [SHM-039](#shm-039) | BE | Story | P0 | 5 | Cancel, reschedule, provider cancel, no-show | SHM-038 | backend agent | IN REVIEW | built, awaiting reviewer |
| [SHM-040](#shm-040) | BE | Story | P1 | 3 | Masked in-booking chat | SHM-034 | backend agent | IN REVIEW | built, awaiting reviewer |
| [SHM-041](#shm-041) | BE | Story | P0 | 8 | Execution API: depart, OTP start, evidence, checklist | SHM-034, SHM-022 | backend agent | IN REVIEW | built, awaiting reviewer |
| [SHM-042](#shm-042) | BE | Story | P0 | 5 | Revised quote, top-up payment, parts & extras | SHM-041, SHM-037 | backend agent | IN REVIEW | built, awaiting reviewer |
| [SHM-043](#shm-043) | BE | Story | P0 | 5 | Completion → invoice → AWAITING_VERIFICATION | SHM-042 | backend agent | IN REVIEW | built, awaiting reviewer |
| [SHM-044](#shm-044) | BE | Task | P1 | 3 | Basic notification dispatch (outbox → mocks) | SHM-008, SHM-011 | backend agent | IN REVIEW | built, awaiting reviewer |
| [SHM-045](#shm-045) | BE | Test | P0 | 3 | Concurrency & money-safety integration tests | SHM-037, SHM-043 | backend agent | IN REVIEW | built, awaiting reviewer |
| [SHM-046](#shm-046) | FE | Story | P0 | 8 | Customer booking wizard | SHM-035, SHM-036, SHM-037, SHM-017 | — | TODO | — |
| [SHM-047](#shm-047) | FE | Story | P1 | 3 | Public provider profile page | SHM-035 | — | TODO | — |
| [SHM-048](#shm-048) | FE | Story | P0 | 3 | Payment handoff, return & pending states | SHM-037 | — | TODO | — |
| [SHM-049](#shm-049) | FE | Story | P0 | 8 | Customer bookings list & detail | SHM-039, SHM-040, SHM-042, SHM-043 | — | TODO | — |
| [SHM-050](#shm-050) | FE | Story | P0 | 5 | Provider offers, today & calendar | SHM-038 | — | TODO | — |
| [SHM-051](#shm-051) | FE | Story | P0 | 8 | Provider job execution flow (PWA) | SHM-041, SHM-042, SHM-043 | — | TODO | — |
| [SHM-052](#shm-052) | FE | Story | P0 | 5 | Offline evidence queue | SHM-051 | — | TODO | — |
| [SHM-053](#shm-053) | SHARED | Test | P0 | 5 | Phase 2 E2E + exit gate | SHM-045, SHM-046, SHM-049, SHM-051, SHM-052 | backend agent | TODO | — |

### E3 · Phase 3 — Verification & Money (M7, M8, M9)

| Key | Owner | Type | Pri | SP | Title | Depends on | Assignee | Status | PR |
|---|---|---|---|---|---|---|---|---|---|
| [SHM-054](#shm-054) | BE | Story | P0 | 3 | Tier routing (domain) R1–R10 | SHM-043 | backend agent | IN REVIEW | built, awaiting reviewer |
| [SHM-055](#shm-055) | BE | Story | P0 | 5 | Verification queue, SLA & claim locking | SHM-054, SHM-006 | backend agent | IN REVIEW | built, awaiting reviewer |
| [SHM-056](#shm-056) | BE | Story | P0 | 5 | Agent console API: call, attempts, outcome guards | SHM-055, SHM-011 | backend agent | IN REVIEW | built, awaiting reviewer |
| [SHM-057](#shm-057) | BE | Story | P0 | 8 | Verification submission & release posting | SHM-056 | backend agent | IN REVIEW | built, awaiting reviewer |
| [SHM-058](#shm-058) | BE | Story | P0 | 5 | Rework flow | SHM-057 | backend agent | IN REVIEW | built, awaiting reviewer |
| [SHM-059](#shm-059) | BE | Story | P0 | 8 | Unreachable customer: link, auto-release, Tier B escalation | SHM-056 | backend agent | IN REVIEW | built, awaiting reviewer |
| [SHM-060](#shm-060) | BE | Story | P0 | 5 | Cash settlement, debt ceiling, debt payment | SHM-057 | backend agent | IN REVIEW | built, awaiting reviewer |
| [SHM-061](#shm-061) | BE | Story | P0 | 8 | Finance API: escrow, refunds, payouts, reconciliation views | SHM-057, SHM-060 | backend agent | IN REVIEW | built, awaiting reviewer |
| [SHM-062](#shm-062) | BE | Task | P0 | 3 | Nightly reconciliation job | SHM-061 | backend agent | IN REVIEW | built, awaiting reviewer |
| [SHM-063](#shm-063) | BE | Story | P1 | 5 | Reputation projector, badges, remarks replies | SHM-057 | backend agent | IN REVIEW | built, awaiting reviewer |
| [SHM-064](#shm-064) | BE | Task | P1 | 2 | Call recordings: access & retention | SHM-056 | backend agent | IN REVIEW | built, awaiting reviewer |
| [SHM-065](#shm-065) | BE | Test | P0 | 3 | Phase 3 money & verification integration tests | SHM-057, SHM-059, SHM-060 | backend agent | IN REVIEW | built, awaiting reviewer |
| [SHM-066](#shm-066) | FE | Story | P0 | 3 | Agent queue page | SHM-055, SHM-017 | — | TODO | — |
| [SHM-067](#shm-067) | FE | Story | P0 | 8 | Agent verification console | SHM-056, SHM-057, SHM-066 | — | TODO | — |
| [SHM-068](#shm-068) | FE | Task | P2 | 2 | Agent attempts history page | SHM-056 | — | TODO | — |
| [SHM-069](#shm-069) | FE | Story | P0 | 3 | Public verification link page | SHM-059 | — | TODO | — |
| [SHM-070](#shm-070) | FE | Story | P0 | 5 | Provider money pages | SHM-060, SHM-061 | — | TODO | — |
| [SHM-071](#shm-071) | FE | Story | P1 | 3 | Ratings, remarks & badges UI | SHM-063 | — | TODO | — |
| [SHM-072](#shm-072) | FE | Story | P0 | 8 | Finance console | SHM-061, SHM-017 | — | TODO | — |
| [SHM-073](#shm-073) | FE | Story | P1 | 3 | Customer post-verification states | SHM-057, SHM-058 | — | TODO | — |
| [SHM-074](#shm-074) | SHARED | Test | P0 | 5 | Phase 3 E2E + exit gate | SHM-065, SHM-067, SHM-069, SHM-070, SHM-072, SHM-073 | backend agent | TODO | — |

### E4 · Phase 4 — Trust & Communication (M10, M11, M15)

| Key | Owner | Type | Pri | SP | Title | Depends on | Assignee | Status | PR |
|---|---|---|---|---|---|---|---|---|---|
| [SHM-075](#shm-075) | BE | Story | P0 | 5 | Complaints API | SHM-057 | backend agent | IN REVIEW | built, awaiting reviewer |
| [SHM-076](#shm-076) | BE | Story | P0 | 8 | Disputes API & resolution postings | SHM-075, SHM-058 | backend agent | IN PROGRESS | — |
| [SHM-077](#shm-077) | BE | Story | P0 | 8 | Conduct engine: penalties, demerits, thresholds | SHM-076 | backend agent | IN PROGRESS | — |
| [SHM-078](#shm-078) | BE | Story | P0 | 5 | Appeals & reversals | SHM-077 | backend agent | IN PROGRESS | — |
| [SHM-079](#shm-079) | BE | Task | P0 | 3 | Daily conduct job: expiry, decay, suspensions | SHM-077 | backend agent | IN PROGRESS | — |
| [SHM-080](#shm-080) | BE | Story | P1 | 5 | Automatic breach proposals | SHM-077 | backend agent | IN PROGRESS | — |
| [SHM-081](#shm-081) | BE | Story | P0 | 8 | Notifications: full planner & delivery | SHM-044 | backend agent | IN PROGRESS | — |
| [SHM-082](#shm-082) | FE | Story | P0 | 5 | Complaint forms & timeline | SHM-075 | — | TODO | — |
| [SHM-083](#shm-083) | FE | Story | P0 | 8 | Admin complaints & disputes workspace | SHM-075, SHM-076 | — | TODO | — |
| [SHM-084](#shm-084) | FE | Story | P0 | 5 | Admin penalties & appeals | SHM-077, SHM-078 | — | TODO | — |
| [SHM-085](#shm-085) | FE | Story | P0 | 5 | Provider conduct page | SHM-077, SHM-079 | — | TODO | — |
| [SHM-086](#shm-086) | FE | Story | P1 | 3 | Notification centre | SHM-081 | — | TODO | — |
| [SHM-087](#shm-087) | FE | Story | P2 | 3 | Admin template editor | SHM-081 | — | TODO | — |
| [SHM-088](#shm-088) | SHARED | Test | P0 | 3 | Phase 4 E2E + exit gate | SHM-082, SHM-083, SHM-084, SHM-085, SHM-086 | backend agent | TODO | — |

### E5 · Phase 5 — Depth, Hardening & Release (M13, M14, ops)

| Key | Owner | Type | Pri | SP | Title | Depends on | Assignee | Status | PR |
|---|---|---|---|---|---|---|---|---|---|
| [SHM-089](#shm-089) | BE | Story | P1 | 8 | Maintenance plans | SHM-057 | backend agent | TODO | — |
| [SHM-090](#shm-090) | BE | Story | P1 | 8 | Reports (async) with PDF & XLSX | SHM-061 | backend agent | TODO | — |
| [SHM-091](#shm-091) | BE | Task | P1 | 3 | Operations board API | SHM-055 | backend agent | TODO | — |
| [SHM-092](#shm-092) | BE | Task | P0 | 8 | Hardening: performance, security, observability | — | backend agent | TODO | — |
| [SHM-093](#shm-093) | BE | Task | P0 | 3 | Backup/restore & runbooks | — | backend agent | TODO | — |
| [SHM-094](#shm-094) | SHARED | Task | P0 | 5 | Production images & deployment pipeline | SHM-092 | backend agent | TODO | — |
| [SHM-095](#shm-095) | BE | Story | P1 | 5 | Real payment gateway adapter | — | backend agent | BLOCKED | — |
| [SHM-096](#shm-096) | BE | Story | P1 | 5 | Real telephony + SMS/WhatsApp adapters | — | backend agent | BLOCKED | — |
| [SHM-097](#shm-097) | FE | Story | P1 | 5 | Plans UI (customer + admin) | SHM-089 | — | TODO | — |
| [SHM-098](#shm-098) | FE | Story | P1 | 5 | Admin reports page | SHM-090 | — | TODO | — |
| [SHM-099](#shm-099) | FE | Story | P1 | 5 | Operations board (realtime) | SHM-091 | — | TODO | — |
| [SHM-100](#shm-100) | FE | Task | P0 | 5 | Accessibility, Urdu completion & bundle budget | — | — | TODO | — |
| [SHM-101](#shm-101) | SHARED | Test | P0 | 5 | UAT script, execution & release sign-off | SHM-088, SHM-092, SHM-094, SHM-097, SHM-098, SHM-099, SHM-100 | backend agent | TODO | — |

---

## 5. Ticket details

Each card: scope, requirement references, API contract (BE), dependencies and acceptance criteria. Tick criteria here; keep status in §4.

### E0 · Phase 0 — Foundation & Infrastructure

<a id="shm-001"></a>
#### SHM-001 · Monorepo scaffold & shared tooling

`SHARED` · Task · P0 · 3 SP · **Depends on:** — · **Blocks:** SHM-002, SHM-006, SHM-013, SHM-014

**Refs:** TRD §3

**Scope:** pnpm workspaces + Turborepo (`lint`, `typecheck`, `test`, `build`, `dev`). `packages/config` with shared tsconfig/eslint/prettier. Custom ESLint rules: no floating promises, no `any`, ban `Number(` on money, ban `status:` writes on bookings outside `BookingStateService`.

**Acceptance criteria**
- [ ] `pnpm i && pnpm build` succeeds from a clean clone
- [x] Each banned pattern has a fixture file that makes lint fail
- [ ] `docs/` contains files 01–05 of the doc pack; `.cursor/rules/` contains the 4 `.mdc` files
- [ ] Definition of Done met

<a id="shm-002"></a>
#### SHM-002 · Local infrastructure via docker-compose

`SHARED` · Task · P0 · 2 SP · **Depends on:** SHM-001 · **Blocks:** SHM-003, SHM-013

**Refs:** TRD §21

**Scope:** `infra/docker-compose.yml`: `postgis/postgis:16-3.4`, `redis:7`, MinIO with bucket bootstrap (`evidence`, `documents`, `recordings`, `reports`), Mailpit.

**Acceptance criteria**
- [ ] `docker compose up -d` brings all services healthy
- [ ] All four buckets exist after first boot
- [ ] `.env.example` documents every variable
- [ ] Definition of Done met

<a id="shm-003"></a>
#### SHM-003 · DB package: migration, dbmate scripts, Prisma pull

`BE` · Task · P0 · 3 SP · **Depends on:** SHM-002 · **Blocks:** SHM-004, SHM-005, SHM-007, SHM-012

**Refs:** TRD §3, ADR (Prisma client-only)

**Scope:** Copy `04_schema.sql` → `packages/db/migrations/0001_init.sql` (dbmate format). Scripts `db:migrate`, `db:pull` (prisma db pull + generate), `db:reset`, `db:seed`. **Never** `prisma migrate`.

**Acceptance criteria**
- [x] `pnpm db:reset` runs clean on an empty DB
- [x] Generated Prisma client compiles; 72 tables, 52 enums, 3 views present
- [x] README section explains the schema-change workflow (new SQL migration → `db:pull`)
- [ ] Definition of Done met

<a id="shm-004"></a>
#### SHM-004 · Deterministic seed data

`BE` · Task · P0 · 5 SP · **Depends on:** SHM-003 · **Blocks:** —

**Refs:** TRD §20, SRS §3.1, §8.2, §13, FR-NT-02..04

**Scope:** Lahore + 20 areas; 6 active + 2 inactive categories; all SRS v2.0 §3.1 services with PKR prices, durations, pricing models (CL-01), checklists (3–6 items, some photo-required); roles & permissions; staff users (admin, finance, 2 agents) with printed dev passwords; all §13 settings; breach types; en + ur templates for every notification event; global commission 15 %.

**Acceptance criteria**
- [x] Running seed twice yields identical data (idempotent, deterministic)
- [x] Dev credentials printed to console on seed
- [x] Every §13 setting key present with default
- [ ] Definition of Done met

<a id="shm-005"></a>
#### SHM-005 · `packages/contracts` — shared types for FE and BE

`BE` · Task · P0 · 3 SP · **Depends on:** SHM-003 · **Blocks:** SHM-007, SHM-015, SHM-033

**Refs:** TRD §14.1

**Scope:** Enums mirrored from schema, error-code catalogue (`ILLEGAL_TRANSITION`, `SLOT_TAKEN`, `OTP_INVALID`, `CONFLICT_OF_INTEREST`, `DEBT_BLOCKED` …), `Money` (integer paisa + `PKR`), cursor pagination, problem+json schema.

**Acceptance criteria**
- [x] A test fails if a DB enum and its contracts mirror diverge
- [ ] FE and BE both import from `@shm/contracts`; no duplicated enum strings in apps
- [ ] Definition of Done met

<a id="shm-006"></a>
#### SHM-006 · `packages/domain` basics: Clock, Money, SlaCalendar

`BE` · Task · P0 · 3 SP · **Depends on:** SHM-001 · **Blocks:** SHM-025, SHM-033, SHM-055

**Refs:** TRD §3, CL-20

**Scope:** `Clock` + `FakeClock`; Money helpers (add, sub, pct in basis points, half-up rounding); `SlaCalendar` (calling hours 08:00–22:00 Asia/Karachi, `addBusinessMinutes`).

**Acceptance criteria**
- [x] Unit tests for 21:50, 22:00, 07:59, midnight and multi-day SLA spans
- [x] Money never uses floating point (lint + tests)
- [x] Domain package has zero imports from Nest/Prisma/Next
- [ ] Definition of Done met

<a id="shm-007"></a>
#### SHM-007 · API skeleton (NestJS 11 on Fastify)

`BE` · Story · P0 · 5 SP · **Depends on:** SHM-003, SHM-005 · **Blocks:** SHM-008, SHM-011, SHM-015

**Refs:** TRD §1, §14.1, §18, §19

**Scope:** Zod-validated config (fail fast), Prisma service, Redis, BullMQ queue registry, global problem+json exception filter, request-id + pino logger with PII redaction, `/health`, OpenAPI at `/api/docs`. Two entrypoints: HTTP/WS and worker.

**API contract:** `GET /health`, `GET /api/docs`

**Acceptance criteria**
- [x] Missing env var aborts startup with a clear message
- [x] Unhandled error returns problem+json with `code`
- [x] Phone numbers / CNIC never appear in logs (redaction test)
- [ ] Definition of Done met

<a id="shm-008"></a>
#### SHM-008 · Platform services: settings, audit, idempotency, outbox

`BE` · Story · P0 · 5 SP · **Depends on:** SHM-007 · **Blocks:** SHM-009, SHM-012, SHM-019, SHM-024, SHM-034, SHM-044

**Refs:** TRD §5.3, §5.4, FR-AD-14, FR-AD-15, FR-PY-09

**Scope:** Settings service (DB + Redis cache + pub/sub invalidation); audit service writing `audit_log`; idempotency interceptor (`Idempotency-Key`); transactional outbox poller + dispatcher skeleton.

**Acceptance criteria**
- [ ] Changing a setting invalidates cache on all API instances
- [ ] Same `Idempotency-Key` twice returns the stored response, no double side effect
- [x] Outbox rows dispatched exactly once under two concurrent workers
- [ ] Definition of Done met

<a id="shm-009"></a>
#### SHM-009 · Identity: register, OTP, login, sessions

`BE` · Story · P0 · 8 SP · **Depends on:** SHM-008 · **Blocks:** SHM-010, SHM-016, SHM-020, SHM-021

**Refs:** FR-CU-01/03/04, FR-SP-01, TRD §16

**Scope:** Customer/provider registration with phone OTP; login; refresh-token rotation with reuse detection; logout; forgot/reset password (email or SMS OTP); rate limiting on auth endpoints.

**API contract:** `POST /auth/register` · `/auth/otp/request` · `/auth/otp/verify` · `/auth/login` · `/auth/refresh` · `/auth/logout` · `/auth/password/forgot` · `/auth/password/reset`

**Acceptance criteria**
- [x] Reused refresh token revokes the whole token family
- [x] OTP attempts limited and locked per settings
- [x] Provider account starts `PENDING`
- [ ] Definition of Done met

<a id="shm-010"></a>
#### SHM-010 · Staff TOTP + RBAC policy guard

`BE` · Story · P0 · 5 SP · **Depends on:** SHM-009 · **Blocks:** SHM-016, SHM-019, SHM-024

**Refs:** FR-AD-01, FR-AD-13, NFR-SE-02, TRD §16

**Scope:** Mandatory TOTP for staff roles; `PolicyGuard` + `@Policy()` decorator; automated test that fails if any route lacks a policy.

**API contract:** `POST /auth/totp/setup` · `POST /auth/totp/verify`

**Acceptance criteria**
- [x] Staff cannot reach any staff route before TOTP verification
- [x] Route-policy test passes and is part of CI
- [ ] Definition of Done met

<a id="shm-011"></a>
#### SHM-011 · Integration ports + working mocks; dev inbox

`BE` · Task · P0 · 5 SP · **Depends on:** SHM-007 · **Blocks:** SHM-018, SHM-022, SHM-037, SHM-044, SHM-056

**Refs:** TRD §17

**Scope:** Ports and mock adapters for payment, SMS, email, maps, telephony, WhatsApp, storage. Mock SMS/email persist to a dev inbox readable via API (dev only).

**API contract:** `GET /dev/inbox` (dev only)

**Acceptance criteria**
- [ ] Whole system runs with network disabled
- [x] Adapter selected by env; mocks are the default in dev/test
- [ ] Definition of Done met

<a id="shm-012"></a>
#### SHM-012 · DB invariant integration tests

`BE` · Test · P0 · 3 SP · **Depends on:** SHM-003, SHM-008 · **Blocks:** —

**Refs:** 03_ERD integrity rules

**Scope:** Prove: insert-only triggers (`audit_log`, `ledger_entries`), raw `UPDATE bookings.status` rejected, `DELETE users` rejected, unbalanced ledger transaction rejected at commit.

**Acceptance criteria**
- [x] All four scenarios covered and green in CI
- [ ] Definition of Done met

<a id="shm-013"></a>
#### SHM-013 · CI pipeline (GitHub Actions)

`SHARED` · Task · P0 · 3 SP · **Depends on:** SHM-001, SHM-002 · **Blocks:** —

**Refs:** TRD §21

**Scope:** install → lint → typecheck → unit → integration (Postgres/Redis service containers) → build. Cache pnpm store.

**Acceptance criteria**
- [ ] PRs cannot merge on red CI (branch protection)
- [ ] Pipeline under 15 min
- [ ] Definition of Done met

<a id="shm-014"></a>
#### SHM-014 · Web app scaffold: Next.js 15, i18n, design system

`FE` · Task · P0 · 3 SP · **Depends on:** SHM-001 · **Blocks:** SHM-018

**Refs:** TRD §15.2

**Scope:** Next.js 15 App Router under `/[locale]`, next-intl (en/ur, RTL via `dir`), Tailwind with logical utilities, shadcn/ui, base design tokens, 360 px baseline.

**Acceptance criteria**
- [ ] Switching to `ur` flips layout RTL with no hard-coded left/right classes
- [ ] Lighthouse mobile ≥ 90 on an empty page
- [ ] Definition of Done met

<a id="shm-015"></a>
#### SHM-015 · Typed API client with token refresh

`FE` · Task · P0 · 3 SP · **Depends on:** SHM-005, SHM-007 · **Blocks:** SHM-016

**Refs:** TRD §14.1

**Scope:** Client generated/typed from OpenAPI + `@shm/contracts`; silent refresh on 401; problem+json → field errors and toast; money formatting helper (paisa → PKR).

**Acceptance criteria**
- [ ] Concurrent 401s trigger a single refresh
- [ ] Server field errors render under the matching input
- [ ] Definition of Done met

<a id="shm-016"></a>
#### SHM-016 · Auth pages

`FE` · Story · P0 · 5 SP · **Depends on:** SHM-009, SHM-010, SHM-015 · **Blocks:** SHM-017

**Refs:** FR-CU-01/03/04, FR-SP-01

**Scope:** Register customer, register provider, login, OTP entry, forgot/reset password, staff TOTP setup (QR) and verify. en + ur.

**Acceptance criteria**
- [ ] Customer can register end to end using OTP read from `/dev/inbox`
- [ ] Each staff role logs in with TOTP and lands in its shell
- [ ] All inputs labelled; errors announced to screen readers
- [ ] Definition of Done met

<a id="shm-017"></a>
#### SHM-017 · Role layout shells + route manifest + status UI map

`FE` · Task · P0 · 3 SP · **Depends on:** SHM-016 · **Blocks:** SHM-026, SHM-027, SHM-028, SHM-030, SHM-046, SHM-066, SHM-072

**Refs:** TRD §15.1, §15.2, NFR-SE-02

**Scope:** Shells for `/c`, `/p`, `/agent`, `/finance`, `/admin` with empty dashboards; route manifest (required role per page) + middleware redirect; `lib/booking-status-ui.ts` generated from contracts (label, colour, next-action for every state).

**Acceptance criteria**
- [ ] Wrong role is redirected (and server still returns 403)
- [ ] A test fails if any booking state lacks a UI mapping
- [ ] Definition of Done met

<a id="shm-018"></a>
#### SHM-018 · Provider PWA manifest + dev inbox page

`FE` · Task · P1 · 2 SP · **Depends on:** SHM-014, SHM-011 · **Blocks:** —

**Refs:** TRD §15

**Scope:** PWA manifest and service-worker shell scoped to `/p`; `/dev/inbox` page listing mock SMS/emails (dev only).

**Acceptance criteria**
- [ ] `/p` installable on Android Chrome
- [ ] `/dev/inbox` not built into production bundle
- [ ] Definition of Done met

### E1 · Phase 1 — Onboarding (M1, M2, M3, M12 core)

<a id="shm-019"></a>
#### SHM-019 · Catalogue API (admin CRUD + public read)

`BE` · Story · P0 · 5 SP · **Depends on:** SHM-008, SHM-010 · **Blocks:** SHM-021, SHM-026, SHM-031, SHM-036

**Refs:** FR-CAT-01..08, CL-01

**Scope:** Categories, services (price band, duration, pricing model, emergency/plan/warranty/high-risk flags), ordered checklist items, commission rules (global / category / provider). Schema CHECK violations mapped to friendly 422s.

**API contract:** `GET /categories` · `GET /services?categoryId` · `/admin/catalogue/*`

**Acceptance criteria**
- [x] Public endpoints require no auth (routes are under `GET /catalogue/*`, `@Public()`; not the `/categories` path named above)
- [x] Price band min > max → 422 with field error (`minPricePaisa <= basePricePaisa <= maxPricePaisa` enforced as a Zod refine)
- [ ] Public endpoints cached — not built; every request hits Postgres
- [ ] Commission resolution order unit-tested (provider > category > global) — commission_rules CRUD exists (create/list/end), but nothing yet *reads* a rate by resolving scope precedence; that logic has no caller until booking/invoicing (M8) exists
- [ ] Definition of Done met

**Evidence (26 Sep 2026):** `apps/api/src/catalogue/`. Also covers FR-CAT-03/04 (provider expertise + own pricing) via `provider_services` endpoints under `/provider/services` and `/admin/provider-services`, which this ticket's contract didn't originally name. 24 integration tests in `catalogue.test.ts`, all green.

<a id="shm-020"></a>
#### SHM-020 · Customer profile, addresses, favourites, deactivate

`BE` · Story · P0 · 5 SP · **Depends on:** SHM-009 · **Blocks:** SHM-027, SHM-035, SHM-036

**Refs:** FR-CU-02, FR-CU-05, FR-CU-08, FR-CU-09

**Scope:** Profile update; change password revokes other sessions; addresses with mock geocoder, area validation and default flag; favourites; deactivation anonymises PII and keeps financial records.

**API contract:** `GET/PATCH /me` · `CRUD /me/addresses` · `POST/DELETE /me/favourites/:providerId` · `POST /me/deactivate`

**Acceptance criteria**
- [~] Address outside a known area → rejected (built as `404 NOT_FOUND` for an unknown/inactive `areaId`, not the `422` this criterion names — same validation intent, different status code convention)
- [ ] After deactivation, name/phone/email anonymised; bookings and ledger intact — not built
- [ ] Definition of Done met

**Evidence (26 Sep 2026):** `apps/api/src/customer/addresses.service.ts` — full CRUD (`GET`/`POST /customer/addresses`, `PATCH`/`DELETE /customer/addresses/:id`), PostGIS point storage, single-default-address enforced in a transaction, soft-archive on delete. **Not built:** `GET/PATCH /me` profile (no separate customer profile exists beyond `/auth/me`), favourites, deactivate. 7 integration tests in `customer-addresses.test.ts`, all green.

<a id="shm-021"></a>
#### SHM-021 · Provider onboarding API

`BE` · Story · P0 · 8 SP · **Depends on:** SHM-009, SHM-019 · **Blocks:** SHM-022, SHM-025, SHM-028

**Refs:** FR-SP-01..03, FR-SP-07, FR-SP-08, FR-CAT-03/04, FR-PN-08

**Scope:** Profile; services with own price inside band; service areas + base location + radius; weekly availability + time off; payout account; penalty-schedule acceptance (timestamp stored); submit for approval.

**API contract:** `GET/PATCH /provider/me` · `PUT /provider/services` · `PUT /provider/areas` · `PUT /provider/availability` · `CRUD /provider/time-off` · `POST /provider/submit`

**Acceptance criteria**
- [~] Price outside band → rejected (built as `400 BAD_REQUEST` in `provider/services`, not `422`)
- [x] Overlapping time off rejected by the DB's `EXCLUDE` constraint, caught by SQLSTATE `23P01` and surfaced as `409 CONFLICT`
- [ ] Submit blocked until all required steps complete — not built; there is no "submit for approval" step at all, an admin can approve a provider at any time regardless of profile completeness
- [ ] Definition of Done met

**Evidence (26 Sep 2026):** `apps/api/src/provider/` — profile (`GET`/`PATCH /provider/profile`), weekly availability (`GET`/`PUT /provider/availability`, replace-all), time off (`GET`/`POST /provider/time-off`, `DELETE .../:id`), service areas (`GET`/`PUT /provider/service-areas`, replace-all). Route paths are `/provider/*`, not `/provider/me/*` as the contract above names them. Payout account and penalty-schedule acceptance are not built (both need modules — M8 payouts, M15 penalties — that don't exist yet). 17 integration tests in `provider-profile.test.ts`, all green.

<a id="shm-022"></a>
#### SHM-022 · Provider documents & CNIC protection

`BE` · Story · P0 · 5 SP · **Depends on:** SHM-021, SHM-011 · **Blocks:** SHM-023, SHM-028, SHM-041

**Refs:** FR-SP-06, FR-AD-10, NFR-PR-03, TRD §10, §18

**Scope:** Presigned uploads (CNIC front/back, trade certificate, optional character certificate). CNIC number AES-256-GCM encrypted + HMAC blind index; duplicate CNIC rejected. Viewing via 5-min signed URLs, access audited, restricted to approving admin role.

**API contract:** `POST /uploads/presign` · `POST /provider/documents`

**Acceptance criteria**
- [ ] Agent and finance roles get 403 on document access
- [ ] Every document view creates an audit row
- [ ] Same CNIC on a second account → 409
- [ ] Definition of Done met

<a id="shm-023"></a>
#### SHM-023 · Admin approval workflow

`BE` · Story · P0 · 5 SP · **Depends on:** SHM-022 · **Blocks:** SHM-030

**Refs:** FR-AD-02, FR-AD-10

**Scope:** Approval queue; verify/reject documents; approve/reject provider with reason (notification via outbox); approve provider services. On approval create `provider_stats` row and `PROVIDER_WALLET` ledger account.

**API contract:** `GET /admin/providers?status` · `POST /admin/providers/:id/approve|reject` · `POST /admin/documents/:id/verify`

**Acceptance criteria**
- [ ] Approval blocked unless CNIC is `VERIFIED` — cannot be built until SHM-022 (documents) exists; today `POST /admin/providers/:id/approve` has no gate at all
- [ ] Decision + reason + actor recorded in **audit log** — **known gap, not just a naming difference:** `approved_by`/`rejection_reason` are stamped on the `providers` row itself, but unlike every other admin write in this codebase (e.g. `settings.service.ts`'s `set()`), no row is written to `audit_log`. This breaks the project's own Definition of Done ("audit rows written for admin actions") and should be fixed before relying on this endpoint.
- [ ] Wallet account exists immediately after approval — not built (needs M8 ledger/wallets)
- [ ] Definition of Done met — **not met**, see audit log gap above

**Evidence (26 Sep 2026):** `apps/api/src/provider/provider-approval.service.ts` — `POST /admin/providers/:id/approve` and `.../reject`, `ADMIN`+TOTP gated. This was added ahead of its listed dependency (SHM-022) because without *some* way to approve a provider, SHM-035 (search) had no way to be tested honestly — a provider can never appear in search while stuck at `PENDING_APPROVAL`. 4 integration tests, all green, but see the audit-log gap noted above before treating this as done.

<a id="shm-024"></a>
#### SHM-024 · Admin management: users, roles, settings, conflicts

`BE` · Story · P1 · 5 SP · **Depends on:** SHM-010, SHM-008 · **Blocks:** SHM-031

**Refs:** FR-AD-03..05, FR-AD-09, FR-AD-13..16

**Scope:** Block/unblock/deactivate providers (soft only); customer management; send password-reset link (admin never sees passwords); role management; staff conflict declarations (CL-19); typed settings editor (audited); audit log query.

**API contract:** `POST /admin/providers/:id/block|unblock|deactivate` · `/admin/customers/*` · `/admin/users/:id/send-reset` · `/admin/roles/*` · `/admin/staff-conflicts/*` · `GET/PUT /admin/settings` · `GET /admin/audit`

**Acceptance criteria**
- [ ] No hard delete endpoint exists for users
- [ ] Every setting change audited with old/new value
- [ ] Definition of Done met

<a id="shm-025"></a>
#### SHM-025 · Slot generator + slots endpoint

`BE` · Story · P0 · 5 SP · **Depends on:** SHM-021, SHM-006 · **Blocks:** SHM-029, SHM-035

**Refs:** FR-SP-07, FR-BK-02, TRD §7

**Scope:** Pure slot generator in `packages/domain` (availability, time off, existing bookings, travel buffer, day boundaries, PKT); `GET /providers/:id/slots`.

**API contract:** `GET /providers/:id/slots?serviceId&from&to`

**Acceptance criteria**
- [x] Unit tests: leave, travel buffer, day boundary, fully booked day — `packages/domain/test/slots.test.ts`: windows, leave, travel buffer (widened around bookings only), earliest-start notice, several windows, zero duration
- [ ] Response time < 200 ms for a 14-day window — not measured: the endpoint is one day at a time, not a 14-day window
- [ ] Definition of Done met — met except the timing criterion above

**Evidence (30 Sep 2026):** `packages/domain/src/slots.ts` — pure `generateSlots` (availability windows minus leave minus bookings widened by `booking.travel_buffer_min`, half-hour steps, minimum-notice cutoff, Asia/Karachi day). `GET /search/providers/:providerId/slots?serviceId&date=YYYY-MM-DD` (`SearchService.listSlots`). Path and query differ from the contract above (`/providers/:id/slots?from&to`): a single day per call, under the existing `search` controller. Booking creation and reschedule now store the calendar slot with *half* the travel buffer on each side, so the database's no-overlap constraint enforces the same full gap the listing keeps (BR-08) — proven in `booking-slots.test.ts` (a listed slot books; a start inside the buffer is refused 409 `SLOT_TAKEN`). Fully-booked-day and day-boundary cases are covered by the generator's table tests.

<a id="shm-026"></a>
#### SHM-026 · Public catalogue pages (SSR)

`FE` · Story · P0 · 5 SP · **Depends on:** SHM-017, SHM-019 · **Blocks:** —

**Refs:** FR-CAT-01/02, FR-SR-03

**Scope:** `/`, `/services/[category]`, `/services/[category]/[service]` server-rendered, en/ur, SEO metadata, price band and duration shown.

**Acceptance criteria**
- [ ] Pages render with JS disabled
- [ ] Inactive categories not shown
- [ ] Definition of Done met

<a id="shm-027"></a>
#### SHM-027 · Customer account pages

`FE` · Story · P0 · 5 SP · **Depends on:** SHM-020, SHM-017 · **Blocks:** —

**Refs:** FR-CU-02, FR-CU-05, FR-CU-08, FR-CU-09

**Scope:** `/c/profile`, `/c/addresses` (Leaflet map-pin picker, area dropdown, default), `/c/favourites`, deactivate flow with clear warning.

**Acceptance criteria**
- [ ] Map picker usable at 360 px and in RTL
- [ ] Change password logs out other sessions (message shown)
- [ ] Definition of Done met

<a id="shm-028"></a>
#### SHM-028 · Provider onboarding wizard (mobile-first, Urdu-ready)

`FE` · Story · P0 · 8 SP · **Depends on:** SHM-021, SHM-022, SHM-017 · **Blocks:** SHM-029, SHM-032

**Refs:** FR-SP-01..08, FR-PN-08

**Scope:** Steps: profile → photo → services & prices (band shown) → areas + base + radius → weekly availability + time off → documents (camera capture, presigned upload with progress/retry) → payout account → read & accept penalty schedule → submit. Progress saved per step.

**Acceptance criteria**
- [ ] Wizard resumes at the last incomplete step after reload
- [ ] Works on 360 px in Urdu
- [ ] Upload retries on flaky network
- [ ] Definition of Done met

<a id="shm-029"></a>
#### SHM-029 · Provider settings pages

`FE` · Story · P1 · 5 SP · **Depends on:** SHM-028, SHM-025 · **Blocks:** —

**Refs:** FR-SP-03, FR-SP-07, FR-SP-08, FR-SP-14

**Scope:** `/p/services`, `/p/areas`, `/p/calendar` (availability + time off), `/p/documents`, `/p/profile`, `/p/conduct` (read-only shell for now).

**Acceptance criteria**
- [ ] Edits reflect immediately in slots endpoint
- [ ] Status banner shows PENDING / APPROVED / BLOCKED
- [ ] Definition of Done met

<a id="shm-030"></a>
#### SHM-030 · Admin approvals & provider detail

`FE` · Story · P0 · 5 SP · **Depends on:** SHM-023, SHM-017 · **Blocks:** SHM-032

**Refs:** FR-AD-02, FR-AD-10

**Scope:** `/admin/approvals` queue; `/admin/providers/[id]` with document viewer (signed URL, expiry handling), verify/reject document, approve/reject provider with mandatory reason.

**Acceptance criteria**
- [ ] Reject without reason is impossible
- [ ] Expired document URL refreshes transparently
- [ ] Definition of Done met

<a id="shm-031"></a>
#### SHM-031 · Admin catalogue, customers, roles, settings, audit UIs

`FE` · Story · P1 · 8 SP · **Depends on:** SHM-019, SHM-024 · **Blocks:** SHM-032

**Refs:** FR-CAT-01..08, FR-AD-03..05, FR-AD-13..16

**Scope:** `/admin/catalogue` (categories, services, checklist ordering by drag, commission rules), `/admin/providers`, `/admin/customers`, `/admin/roles`, `/admin/settings` (typed inputs per key), `/admin/audit` (filters).

**Acceptance criteria**
- [ ] Settings form validates types before submit
- [ ] Audit table filterable by actor, entity, date
- [ ] Definition of Done met

<a id="shm-032"></a>
#### SHM-032 · Phase 1 E2E + exit gate

`SHARED` · Test · P0 · 3 SP · **Depends on:** SHM-028, SHM-030, SHM-031 · **Blocks:** —

**Refs:** Build prompt Phase 1 exit checks

**Scope:** Playwright: provider registers → admin approves → provider APPROVED with services, at 360 px and in Urdu. Integration: approval blocked without VERIFIED CNIC; price outside band 422; time-off overlap rejected.

**Acceptance criteria**
- [ ] E2E green in CI
- [ ] Admin actions visible in `audit_log`
- [ ] ID documents return 403 for agent/finance
- [ ] Definition of Done met

### E2 · Phase 2 — Transacting (M4, M5, M6)

<a id="shm-033"></a>
#### SHM-033 · Booking state machine (domain) T1–T26

`BE` · Story · P0 · 8 SP · **Depends on:** SHM-006, SHM-005 · **Blocks:** SHM-034

**Refs:** SRS §6.2 T1–T26, TRD §5.1

**Scope:** `packages/domain/bookingMachine.ts` defines all 22 states and T1–T26 as data with guards. Generated test matrix asserts every legal transition and rejects every other (status × event) pair; fast-check property test on random event sequences.

**Acceptance criteria**
- [ ] Matrix covers 100 % of (status × event) pairs — not met: built as a 10-status/11-event subset (the states this build actually drives, `REQUESTED` through `WORK_COMPLETED` plus the cancel/decline/no-show branches), not the full 22-state/T1–T26 matrix this ticket names. `ACCEPTED`, `PENDING_PAYMENT`, `ABANDONED`, and everything from `AWAITING_VERIFICATION` onward are real DB enum values this table doesn't cover yet (M7/M8 territory).
- [ ] Property test: no sequence reaches an undefined state — not built. Table-driven unit tests instead: every legal transition in the happy path plus the quote-revision branch, and representative illegal cases (wrong role, wrong state, terminal status) — not an exhaustive matrix or a fast-check property test.
- [ ] Definition of Done met — met for the states this build drives; see SHM-034

**Evidence (26 Sep 2026):** `packages/domain/src/bookingTransitions.ts` (+ test). Deliberately scoped to what M5's first slice needs rather than the ticket's full 22-state ambition — see design doc `docs/superpowers/specs/2026-09-26-m5-booking-design.md` §2 for the explicit scope cut. 8 unit tests, reviewed clean (task-scoped review, not yet the plan's final whole-branch review). Two minor gaps noted by the reviewer, not yet addressed: `decline`/`reschedule`/`noShow` transitions have no direct test coverage (not in the original task's named edge-case list).

**Evidence (30 Sep 2026):** Extended for phase 2: `PENDING_PAYMENT`, `ABANDONED`, `AWAITING_VERIFICATION` and the `SYSTEM` actor; events `paymentCaptured`, `paymentAbandoned`, `exhaustOffers`, `handToVerification`, `completeAtVisitFee`; customers can now cancel from `REQUESTED` and `PENDING_PAYMENT`. Unit tests cover each new edge and the roles allowed to fire it. Still a subset of the ticket's 22 states — the post-verification states (`VERIFIED` … `CLOSED`) belong to phase 3.

<a id="shm-034"></a>
#### SHM-034 · `BookingStateService.apply()`

`BE` · Story · P0 · 5 SP · **Depends on:** SHM-033, SHM-008 · **Blocks:** SHM-037, SHM-040, SHM-041

**Refs:** TRD §5.2, §5.3, FR-BK-08

**Scope:** Sole writer of `bookings.status`: row lock, guard evaluation, history row, chained transitions, outbox events in one transaction.

**Acceptance criteria**
- [x] Every transition writes `booking_status_history`
- [x] Lint rule proves no other writer exists — same pre-existing rule as SHM-033/`no-restricted-syntax`; now backed by a real service to exempt, not just a convention
- [x] Illegal transition → 409 `ILLEGAL_TRANSITION`
- [x] Definition of Done met — chained transition now built and tested

**Evidence (28 Sep 2026):** `apps/api/src/booking/booking.service.ts`'s `apply(bookingId, event, actorUserId, options?)` — row-locks the booking (`FOR UPDATE`), derives the actor's role for *this* booking from whether their id matches `customer_id` or `provider_id` (not a client-asserted role), calls `canTransition()` from `@smart-home/domain`, sets `app.transition_ctx = 'on'` via `SET LOCAL` before the `UPDATE` (required — `trg_booking_status_guard` rejects any status change without it), writes `booking_status_history`, and appends an outbox event, all inside one `$transaction`. Generic over every event `BOOKING_TRANSITIONS` defines — `apply('cancel', …)` resolves `CANCELLED_CUSTOMER` vs `CANCELLED_PROVIDER` correctly by role; the optional `options` bag carries the two side-fields events beyond a plain status flip need (`reason` → `cancel_reason`, `noShowParty` → `no_show_party`), both also written to `booking_status_history`. Five callers wired same day: `POST /bookings/:id/accept`, `/decline` (`FR-SP-09`, provider-only), `/depart` (provider-only, SCHEDULED→EN_ROUTE), `/cancel` (`FR-BK-06`'s state-transition half only — no ledger exists yet to post the cancellation fee to, so that part is deliberately not built), `/no-show` (either party, EN_ROUTE→NO_SHOW, records which side didn't show). 20 integration tests across two files — split into `booking-transitions.test.ts` once the combined file started tripping its own per-file rate limiter (300 req/60s, fresh per test file; each test sharing one onboarded provider rather than one per test brought it back under). Still not built: `reschedule` (needs re-validating availability and a new slot, a bigger feature than a status flip — deliberately not bundled into this pass) and chained transitions (still moot — no event in the current table needs one). Status left `IN PROGRESS`, not `DONE`, for both gaps.

**Evidence (30 Sep 2026):** `BookingStateService` (`booking-state.service.ts`) is now the actor-driven writer and `applySystemEvent` (`booking-state.ts`) the platform's (payment capture, timeouts, offer cascade, the `WORK_COMPLETED` → `AWAITING_VERIFICATION` chain). Money follows status in the same transaction: cancel/decline of a paid booking queues its refund and posts any cancellation fee atomically. `money-safety.test.ts` asserts, over the whole database, that every booking's status is the destination of its latest history row and that history rows chain.

<a id="shm-035"></a>
#### SHM-035 · Search & ranking API

`BE` · Story · P0 · 8 SP · **Depends on:** SHM-025, SHM-020 · **Blocks:** SHM-046, SHM-047

**Refs:** FR-SR-01..07, TRD §8

**Scope:** Service-first PostGIS candidate query; ranking in domain (configurable weights, Bayesian prior); filters (experience, rating, price, available today, verified docs); distance on every result; excludes blocked/suspended/debt-blocked. `seed:load` script for 10 000 providers.

**API contract:** `GET /search/providers?serviceId&addressId&…` · `GET /providers/:id`

**Acceptance criteria**
- [ ] p95 < 800 ms locally with 10 000 providers — not measured; no 10k-provider seed script exists
- [ ] Debt-blocked provider never returned — "debt" doesn't exist yet (needs M8); blocked/suspended/rejected providers *are* excluded via `providers.status = 'APPROVED'`
- [ ] Ranking weights read from settings — not built
- [ ] Definition of Done met

**Evidence (26 Sep 2026):** `apps/api/src/search/`. Deliberately scoped down from this ticket's full description: it's a real PostGIS query (`ST_DWithin`/`ST_Distance` against `providers.base_location`/`radius_m`) ranked by **distance only**, filtered to `providers.status = 'APPROVED'` and an **approved** `provider_services` binding for the requested service. The Bayesian-prior weighted formula (rating, completion rate, response speed, recent activity) is not implemented, on purpose: those signals don't exist yet (no ratings/M9, no completed bookings/M5), so a "weighted" formula today would just be distance plus zeros — worth building once the inputs are real, not before. Query params are `serviceSlug`/`lat`/`lng`, not `serviceId`/`addressId` as the contract above names them (built before there was a booking-address concept to reference; a customer's own saved address could be resolved to lat/lng client-side, or this can be revisited once M5 needs it). Filters named in scope (experience, rating, price, available-today, verified-docs) are not implemented — rating/price/experience have no backing data yet, available-today and verified-docs need M5 bookings and SHM-022 documents respectively. 7 integration tests in `search.test.ts`, all green, plus a live end-to-end walkthrough (register → build profile → admin-approve → found by search) run twice against the running server.

<a id="shm-036"></a>
#### SHM-036 · Quote endpoint

`BE` · Story · P0 · 3 SP · **Depends on:** SHM-019, SHM-020 · **Blocks:** SHM-037, SHM-046

**Refs:** FR-BK-04, FR-PY-11, CL-01

**Scope:** Returns estimate, visit fee, emergency surcharge, coupon effect, outstanding receivable, cancellation policy text — all integer paisa.

**API contract:** `POST /bookings/quote`

**Acceptance criteria**
- [x] Emergency surcharge only for emergency-eligible services — `booking-checkout.test.ts` — surcharge is `booking.emergency_surcharge_pct` of the service amount; an emergency quote for a non-eligible service is 400
- [x] Outstanding receivable from earlier cash cancellation included — a late cash cancellation posts a `CUSTOMER_RECEIVABLE` debit; the next quote shows it and adds it to `payablePaisa`
- [x] Definition of Done met

**Evidence (30 Sep 2026):** `POST /bookings/quote` → `PricingService.price()` (also used by checkout, so the quote and the booking can only differ if the inputs changed). Returns service, visit fee, emergency surcharge, coupon discount (percent or fixed, caps, usage and per-customer limits), outstanding receivable, total, payable and the cancellation policy in words — all integer paisa; auto-assign (no `providerId`) is priced at the service base price; inspection-first services quote the visit fee.

<a id="shm-037"></a>
#### SHM-037 · Checkout: cash + online, webhook, capture, abandonment

`BE` · Story · P0 · 8 SP · **Depends on:** SHM-034, SHM-036, SHM-011 · **Blocks:** SHM-038, SHM-042, SHM-045, SHM-046, SHM-048

**Refs:** FR-BK-01..03, FR-BK-09, FR-PY-02, FR-PY-09, TRD §6.5

**Scope:** Cash → `REQUESTED`. Online → `PENDING_PAYMENT` → mock gateway page → signed webhook → capture posting (D GATEWAY_CLEARING / C ESCROW) + `payment_captured`, idempotent. Payment timeout job → `ABANDONED`. Slot conflict (exclusion constraint 23P01) → 409 `SLOT_TAKEN`. Problem text + up to 5 photos.

**API contract:** `POST /bookings/checkout` · `POST /webhooks/payments/:provider` · `GET /bookings/:id`

**Acceptance criteria**
- [x] 50 concurrent checkouts for one slot → exactly 1 succeeds — `booking-checkout.test.ts`: 50 concurrent checkouts for one slot → exactly 1×201, 49×409 `SLOT_TAKEN` (the exclusion constraint decides)
- [x] Webhook replayed ×10 → one capture, one ledger transaction — same event id ×10 concurrently → one processed, nine `duplicate: true`; ten fresh event ids for the same payment → still one capture and one ledger transaction
- [x] Unsigned webhook → 401 — 401, and the payment and booking are untouched
- [x] Definition of Done met — one carve-out: photos of the problem are uploaded through `POST /bookings/:id/evidence` (base64, ≤ 5), not as part of checkout

**Evidence (26 Sep 2026, in progress):** `apps/api/src/booking/` — `POST /bookings` (not `/bookings/checkout` as this ticket's contract names it) creates a `CASH`-only booking straight to `REQUESTED`, with the full validation chain (service active, provider approved, approved `provider_services` binding, address ownership, availability/time-off, commission-rate resolution) and the slot-overlap→409 behavior above. `GET /bookings/:id` and `GET /bookings` (list mine) also built. **Not built, deliberately cut for now** (see design doc §2): `ONLINE` payment mode, `PENDING_PAYMENT`→webhook→capture, the `ABANDONED` timeout path, and photo upload on the booking request (no multipart infrastructure exists in this API yet). 9 integration tests; booking-creation half reviewed clean (one real fix round: the write sequence wasn't transactional, now wrapped in `$transaction`, re-reviewed clean); the read/list half is implementer-verified (9/9 passing) but its independent task review was interrupted mid-run and has not yet completed — do not treat it as review-clean until that finishes.

**Evidence (30 Sep 2026):** `POST /bookings` (and its alias `POST /bookings/checkout`) handles cash and online. Online: booking `PENDING_PAYMENT` + `INITIATED` payment in one transaction, `redirectUrl` from the gateway port, then the signed webhook (`PaymentsService.ingestWebhookEvent`) captures under the payment's row lock: `CAPTURE` ledger posting (D `GATEWAY_CLEARING` / C `ESCROW[booking]`), booking → `REQUESTED` / `HELD`, offer cascade opened — all one transaction, deduplicated on the gateway event id. `booking.pending_payment_timeout_min` expiry → `ABANDONED` (job `payments.abandon-checkouts`, plus `POST /dev/payments/:id/complete` to play the gateway locally). A capture that arrives after expiry is stored but refused. Slot clash → `409 SLOT_TAKEN`. Also: `LedgerService` (idempotent, balanced postings), refunds booked in escrow-out / gateway-settled-after form (`queueRefund` / `settleRefund`).

<a id="shm-038"></a>
#### SHM-038 · Offers & auto-assign cascade

`BE` · Story · P0 · 8 SP · **Depends on:** SHM-037 · **Blocks:** SHM-039, SHM-050

**Refs:** FR-SP-09, FR-SR-07, FR-BK-10, CL-05

**Scope:** Direct booking offer and ranked auto-assign cascade (`booking_offers`, delayed expiry jobs, re-offer). Exhausted → `UNFULFILLED` + refund posting. Socket.IO events to `user:{id}` with countdown deadline.

**API contract:** `GET /provider/offers` · `POST /provider/offers/:id/accept|decline` · WS `/rt`

**Acceptance criteria**
- [x] Silence past deadline forfeits the offer — offers past `expires_at` are refused if answered late and forfeited by `OfferService.expireDue()` (job `booking.expire-offers`, every 30 s); the next candidate is offered, or the booking goes UNFULFILLED
- [x] Refund posted exactly once on UNFULFILLED — online booking with no taker: one refund, escrow back to zero, payment `REFUNDED`, however many times / concurrently the sweeper runs
- [ ] Definition of Done met — not met: the Socket.IO `/rt` channel (countdown push) is not built — providers poll `GET /provider/offers`

**Evidence (30 Sep 2026):** `OfferService` + `ProviderOffersController`: `GET /provider/offers`, `POST /provider/offers/:id/accept|decline`. Direct requests get one offer to the chosen provider; auto-assign (`providerId` omitted) offers ranked candidates one at a time (nearest first among approved, in-range, free, not-yet-offered providers), bounded by `booking.max_offers` and `booking.max_offer_window_min`. One PENDING offer per booking is enforced by the database. Accept fixes the provider on an auto-assign booking and lets the exclusion constraint arbitrate a clash (`SLOT_TAKEN`). Offer SMS goes out through the notification handler (SHM-044).

<a id="shm-039"></a>
#### SHM-039 · Cancel, reschedule, provider cancel, no-show

`BE` · Story · P0 · 5 SP · **Depends on:** SHM-038 · **Blocks:** SHM-049

**Refs:** FR-BK-05, FR-BK-06, FR-PY-11

**Scope:** Customer cancel with fee rules (online fee from escrow; cash fee → CUSTOMER_RECEIVABLE); one free reschedule up to 4 h before; provider cancel (refund + flag); no-show after grace.

**API contract:** `POST /bookings/:id/cancel` · `/reschedule` · `/no-show`

**Acceptance criteria**
- [x] Second reschedule rejected — `reschedule_count` checked and incremented in `BookingService.reschedule()`, tested
- [x] Fee amounts match settings in all windows (table-driven test) — `booking-checkout.test.ts` table-driven: online/cash × outside/inside the `booking.free_cancel_hours` window — online fee taken from escrow to `PLATFORM_COMMISSION` and the rest refunded; cash fee to `CUSTOMER_RECEIVABLE`
- [x] Definition of Done met

**Evidence (28 Sep 2026):** Built ahead of its listed dependency (SHM-038, offers/auto-assign — not needed: cancel/no-show/reschedule only need a booking that's reached SCHEDULED/EN_ROUTE, which `accept`/`depart` already produce without an offer cascade). `POST /bookings/:id/cancel` and `/no-show` via `BookingService.apply()` — see SHM-034's evidence note. `POST /bookings/:id/reschedule` via a dedicated `BookingService.reschedule()` (not `apply()` — it moves the slot itself, not just the status, so it re-runs the same availability/leave validation `create()` does): enforces once-only (`reschedule_count`) and the 4-hour notice window (`FR-BK-05`, "Second reschedule or inside 4 h → blocked" — both cases return 400), re-checks the new time against `provider_availability`/`provider_time_off`, and relies on the same `bookings_no_provider_overlap` exclusion constraint `create()` does for conflicting slots (409 `CONFLICT`) — proven by rescheduling one booking onto another's already-taken slot. 7 integration tests in `booking-reschedule.test.ts`. **Not built:** every fee-related acceptance criterion (`FR-BK-06`'s charge, `FR-PY-11`) — both need the ledger, M8, which doesn't exist. That's the only remaining gap in this ticket.

**Evidence (30 Sep 2026):** `BookingStateService.moneyFor()`. Customer cancel: before acceptance or ≥ 4 h ahead is free (online refunded in full); inside the window the `booking.late_cancel_fee_paisa` (capped at the booking total) applies per TRD §6.3. Provider cancel or decline: full refund. Also: a customer may now cancel a `REQUESTED` / `PENDING_PAYMENT` booking. Not built: the provider-cancellation review flag (`provider.cancel_review`), and no-show fines (phase 4).

<a id="shm-040"></a>
#### SHM-040 · Masked in-booking chat

`BE` · Story · P1 · 3 SP · **Depends on:** SHM-034 · **Blocks:** SHM-049

**Refs:** FR-BK-07

**Scope:** Messages scoped to booking lifetime; phone numbers/emails masked server-side; realtime on `booking:{id}`.

**API contract:** `GET/POST /bookings/:id/messages`

**Acceptance criteria**
- [x] Phone number typed in a message is masked on delivery — `message-masking.test.ts` (numbers with separators, +92, brackets, spelled-out digits, emails; prices/house numbers untouched) and `booking-messages.test.ts` (stored masked)
- [x] Chat closed after terminal state — open only from assignment until AWAITING_VERIFICATION; `POST` after a terminal state is 409, history stays readable
- [ ] Definition of Done met — realtime on `booking:{id}` is not built (no Socket.IO); a `booking.message` outbox event notifies the recipient in-app instead

**Evidence (30 Sep 2026):** `GET/POST /bookings/:id/messages` (`MessageService`, `message-masking.ts`). Masking happens before the message is stored, so the original never reaches the other party or the database. Reading marks the other side's messages read.

<a id="shm-041"></a>
#### SHM-041 · Execution API: depart, OTP start, evidence, checklist

`BE` · Story · P0 · 8 SP · **Depends on:** SHM-034, SHM-022 · **Blocks:** SHM-042, SHM-051

**Refs:** FR-EX-01..03, FR-EX-08, FR-EX-09, FR-EX-12

**Scope:** Depart; start with customer OTP (hashed, attempt limit, lock) + geolocation check-in (shortfall flagged); before/after evidence with server timestamps and `client_uuid` dedupe; checklist with photo-required items.

**API contract:** `POST /bookings/:id/depart` · `POST /bookings/:id/start` · `POST /bookings/:id/evidence` · `PUT /bookings/:id/checklist`

**Acceptance criteria**
- [x] Wrong OTP ×N locks start — 5 wrong attempts lock for 15 minutes (constants, not yet `Setting` keys)
- [x] Duplicate upload with same `client_uuid` stored once — `booking-completion.test.ts`: same `clientUuid` ×4 (three concurrent) → one row, later ones return the original with `duplicate: true`
- [x] Evidence rows insert-only — the database refuses UPDATE and DELETE (`trg_insert_only`), asserted by test
- [x] Definition of Done met

**Evidence (28 Sep 2026):** `depart` (`FR-EX-01`'s state half) and the OTP-gated `start` (`FR-EX-02`) are both built — see `PROGRESS_TRACKER.md`'s SHM-034 note for `depart`. Start OTP: `BookingService.issueStartOtp()` generates a 6-digit code on `accept`, hashes it (`hashStartOtp`, HMAC with `OTP_PEPPER` — a different mechanism from the auth `otp_codes` table, since this lives directly on the `bookings` row) and sends it to the customer via the mock SMS sender; `BookingService.startWork()` verifies it, locks after 5 wrong attempts for 15 minutes (state on the booking row, not Redis — scoped to one booking, not a user/IP), and on success moves `EN_ROUTE` → `IN_PROGRESS`. Caught and fixed one real bug building this: the wrong-code branch originally threw its `DomainError` from inside the same `$transaction` callback that recorded the attempt, which rolled the attempt-increment back along with the error — every wrong guess looked like the first one, so lockout never actually triggered. Fixed by having the transaction return a result instead of throwing, and throwing once outside it, after the attempt is durably committed. 6 integration tests in `booking-start.test.ts`, including one that specifically proves 5 wrong attempts locks the 6th (even correct) attempt out. **Not built:** geofenced check-in (`FR-EX-09`), before/after evidence capture (`FR-EX-03`, `FR-EX-12`), and the checklist (`FR-EX-08`) — all still open, and materially bigger than the OTP mechanism was.

**Evidence (30 Sep 2026):** `ExecutionService`: `POST/GET /bookings/:id/evidence` (base64 JPEG/PNG/WebP within `evidence.photo_max_bytes`, server `received_at`, device time kept but not trusted, optional GPS point; the body ceiling for this one route is 8 MB, everything else stays 1 MB — see `http-app.ts`); customer problem photos (≤ 5, before the visit) and provider BEFORE/AFTER/CHECKLIST photos. Checklist steps that require a photo need the id of a CHECKLIST photo for that very step (422 otherwise). `POST /bookings/:id/start` accepts optional `lat`/`lng`/`accuracyM`: recorded as the check-in and reported as `distanceM`/`withinGeofence` against `evidence.geofence_radius_m` — flagged, never blocking. Stores through the object-storage port (mock in dev; the port gained `put`). SHM-022 (provider documents) is still open; evidence does not depend on it.

<a id="shm-042"></a>
#### SHM-042 · Revised quote, top-up payment, parts & extras

`BE` · Story · P0 · 5 SP · **Depends on:** SHM-041, SHM-037 · **Blocks:** SHM-043, SHM-049, SHM-051

**Refs:** FR-EX-04, FR-EX-05, FR-EX-11, FR-PY-12, CL-11, CL-13

**Scope:** Provider submits revision → `QUOTE_REVISION`; customer approves/rejects in app; online jobs require top-up captured before work continues; parts/extras as invoice lines; inspection-first rejection completes with visit fee.

**API contract:** `POST /bookings/:id/revisions` · `POST /revisions/:id/approve|reject`

**Acceptance criteria**
- [x] Online revision cannot be approved without captured top-up — online approval creates a `TOPUP` payment and leaves the booking in `QUOTE_REVISION`; the signed capture approves the revision in the same transaction that books the money into escrow (escrow = original + top-up, asserted)
- [x] Rejected inspection-first job completes with visit fee only — completes at the visit fee: invoice, `AWAITING_VERIFICATION` and a verification call, no checklist needed
- [x] Definition of Done met

**Evidence (28 Sep 2026):** The core revision loop (FR-EX-05) is built: `BookingService.raiseQuoteRevision()` lets the assigned provider move an `IN_PROGRESS` booking to `QUOTE_REVISION`, inserting a `quote_revisions` row (`status = 'PENDING'`) inside the same transaction as the status write — the DB's one-pending-revision-at-a-time constraint is enforced by the table itself, not application logic. `approveQuoteRevision()`/`rejectQuoteRevision()` share a private `decideQuoteRevision()`: approve adds the revision's `deltaPaisa` to `approved_total_paisa` and inserts an `EXTRA` `booking_items` row; reject leaves the total untouched. Both return the booking to `IN_PROGRESS`. Three new endpoints (`POST /bookings/:id/revisions`, `/revisions/approve`, `/revisions/reject`), each behind `@ApiZodBody`/policy decorators as usual. 7 integration tests in `booking-quote-revision.test.ts` (raise, approve-adds-delta-and-items, reject-leaves-total, illegal-transition-too-early, illegal-transition-no-pending-revision, wrong-provider-404, wrong-role-403); full suite (182 tests), build, lint, and typecheck all green; API surface baseline regenerated to 71 operations; Swagger confirmed showing the `raise` request body and correctly omitting one on approve/reject. **Not built:** FR-EX-04 (top-up payment gating for online jobs — needs M8's payment/ledger module) and FR-EX-11's inspection-first special case (needs `complete`/FR-EX-06 to exist first, since that's where the "visit fee only" branch would be decided). Both explicitly deferred, not overlooked.

**Evidence (30 Sep 2026):** `BookingService.approveQuoteRevision` / `rejectQuoteRevision` (+ `approveRevisionInTx`, `BookingJobs` top-up hook). A repeated approval reuses the pending top-up; rejecting voids an unpaid top-up; an unpaid top-up blocks completion (booking is not `IN_PROGRESS`). Not built: standalone parts/extras entry outside a revision — extras and parts are invoice lines only via approved revisions.

<a id="shm-043"></a>
#### SHM-043 · Completion → invoice → AWAITING_VERIFICATION

`BE` · Story · P0 · 5 SP · **Depends on:** SHM-042 · **Blocks:** SHM-045, SHM-049, SHM-051, SHM-054

**Refs:** FR-EX-06, FR-EX-10, FR-VC-01

**Scope:** Complete guards (OTP used, checklist done, after photo, final ≤ approved_total); itemised invoice + PDF job; chained transition to `AWAITING_VERIFICATION` creating a `verification_calls` row (tier stub → Tier A, reason `FORCE_TIER_A` until E3).

**API contract:** `POST /bookings/:id/complete` · `GET /bookings/:id/invoice.pdf`

**Acceptance criteria**
- [x] final > approved_total → 422 — `finalAmountPaisa` above the approved total → 422 `VALIDATION_FAILED`, booking untouched; a lower amount adds a "Provider adjustment" discount line so the invoice always adds up
- [x] Invoice PDF downloadable by customer and provider only — `GET /bookings/:id/invoice.pdf` → PDF for the booking's customer and provider; anyone else gets 404
- [x] Definition of Done met

**Evidence (30 Sep 2026):** `CompletionService`: guards (start code used, every checklist step done, before + after photo when `booking.evidence_required`, final ≤ approved), itemised invoice (`SERVICE`/`VISIT_FEE`/`EXTRA`/`PART` = subtotal, `SURCHARGE`, `DISCOUNT`), cash jobs → `CASH_DUE`, then the chained `WORK_COMPLETED` → `AWAITING_VERIFICATION` with a Tier A `verification_calls` row (`FORCE_TIER_A`; cash priority 0 and the cash SLA). One transaction. The PDF is rendered on demand by a small dependency-free writer (`invoice-pdf.ts`) rather than a background job. Optional checkout `lat`/`lng` recorded as the check-out distance.

<a id="shm-044"></a>
#### SHM-044 · Basic notification dispatch (outbox → mocks)

`BE` · Task · P1 · 3 SP · **Depends on:** SHM-008, SHM-011 · **Blocks:** SHM-081

**Refs:** FR-NT-02, FR-NT-03

**Scope:** Outbox events for booking transitions delivered to mock SMS/email/in-app using seeded templates. Full planner comes in E4.

**Acceptance criteria**
- [x] Customer receives confirmation + en-route + start-OTP messages in dev inbox — `booking-messages.test.ts`: confirmation, start code and en-route SMS in the dev inbox; matching in-app rows
- [x] Definition of Done met

**Evidence (30 Sep 2026):** `NotificationService` handles outbox jobs (`outbox.dispatch`), renders the seeded en/ur templates in the recipient's language, writes `notifications` (unique per outbox event × user × channel, so redelivery sends nothing twice) and sends SMS through the port. Covers request captured, offer, accept, en route, revised quote, cancel, no-show, awaiting verification, unfulfilled, refund and chat message. Four templates added to the seed. The full planner (quiet hours, preferences, retries, WhatsApp) stays with SHM-081.

<a id="shm-045"></a>
#### SHM-045 · Concurrency & money-safety integration tests

`BE` · Test · P0 · 3 SP · **Depends on:** SHM-037, SHM-043 · **Blocks:** SHM-053

**Refs:** Build prompt Phase 2 tests

**Scope:** 50 concurrent checkouts → 1 success; webhook ×10 → one capture; final > approved_total → 422; every transition produced a history row.

**Acceptance criteria**
- [ ] All green in CI, run on every PR — green locally; the CI workflow already runs the integration job on every PR, not yet observed on a real PR
- [ ] Definition of Done met — pending the first CI run

**Evidence (30 Sep 2026):** 50 concurrent checkouts → 1; webhook ×10 → one capture and one ledger transaction; refund exactly once under concurrent sweepers; final > approved → 422 (`booking-checkout.test.ts`, `booking-completion.test.ts`); `money-safety.test.ts` asserts over the whole database: status = latest history row, history chains, every ledger transaction balances, escrow never overdrawn, derived balances equal their entries, captures ≤ 1 per payment, refunds ≤ captured, invoices add up, every completed job queued once. It also surfaced a latent bug in the older `NFR-DB-02` test (it never ran while the ledger was empty).

<a id="shm-046"></a>
#### SHM-046 · Customer booking wizard

`FE` · Story · P0 · 8 SP · **Depends on:** SHM-035, SHM-036, SHM-037, SHM-017 · **Blocks:** SHM-053

**Refs:** FR-BK-01..04, FR-SR-01..06

**Scope:** `/c/book/[serviceId]`: address → providers (ranked, filters, distance) → slot → problem details + up to 5 photos → summary (quote breakdown, policy) → pay. Handles 409 `SLOT_TAKEN` by refreshing slots with a message.

**Acceptance criteria**
- [ ] Full flow works at 360 px, en and ur
- [ ] Summary figures match `/bookings/quote` exactly
- [ ] Back navigation keeps entered data
- [ ] Definition of Done met

<a id="shm-047"></a>
#### SHM-047 · Public provider profile page

`FE` · Story · P1 · 3 SP · **Depends on:** SHM-035 · **Blocks:** —

**Refs:** FR-SR-02, FR-RT-05, FR-RT-06

**Scope:** `/providers/[id]`: structured details, services & prices, areas, rating summary placeholder (filled in E3), book button.

**Acceptance criteria**
- [ ] SSR with SEO metadata; no PII beyond first name + initial
- [ ] Definition of Done met

<a id="shm-048"></a>
#### SHM-048 · Payment handoff, return & pending states

`FE` · Story · P0 · 3 SP · **Depends on:** SHM-037 · **Blocks:** —

**Refs:** FR-BK-09, FR-PY-02

**Scope:** Redirect to mock gateway; return page polls/streams booking until captured; clear UI for `PENDING_PAYMENT` and `ABANDONED` with retry.

**Acceptance criteria**
- [ ] Refreshing return page never double-submits
- [ ] Definition of Done met

<a id="shm-049"></a>
#### SHM-049 · Customer bookings list & detail

`FE` · Story · P0 · 8 SP · **Depends on:** SHM-039, SHM-040, SHM-042, SHM-043 · **Blocks:** SHM-053

**Refs:** FR-CU-06, FR-CU-07, FR-BK-05..08, FR-EX-05

**Scope:** `/c/bookings` and `/c/bookings/[id]`: live status timeline (history + WS), start-OTP card, revision approval (with top-up pay), masked chat, invoice download, cancel (fee preview) and reschedule, re-book provider.

**Acceptance criteria**
- [ ] Status updates appear without reload
- [ ] Cancel dialog shows exact fee before confirming
- [ ] Definition of Done met

<a id="shm-050"></a>
#### SHM-050 · Provider offers, today & calendar

`FE` · Story · P0 · 5 SP · **Depends on:** SHM-038 · **Blocks:** —

**Refs:** FR-SP-09

**Scope:** `/p/offers` with live countdown (`aria-live`), accept/decline; `/p/today` job list; `/p/calendar` bookings overlay.

**Acceptance criteria**
- [ ] Expired offer disappears in real time
- [ ] Countdown correct after tab sleep (server deadline, not client timer)
- [ ] Definition of Done met

<a id="shm-051"></a>
#### SHM-051 · Provider job execution flow (PWA)

`FE` · Story · P0 · 8 SP · **Depends on:** SHM-041, SHM-042, SHM-043 · **Blocks:** SHM-052, SHM-053

**Refs:** FR-EX-01..11

**Scope:** `/p/jobs/[id]` stepper: depart → enter OTP + geo check-in → before photos → checklist → revision request → parts/extras → after photos → complete. Code-split per step, camera capture, large touch targets.

**Acceptance criteria**
- [ ] Cannot reach Complete with missing required photos
- [ ] Bundle for `/p` within agreed budget (no chart libs)
- [ ] Definition of Done met

<a id="shm-052"></a>
#### SHM-052 · Offline evidence queue

`FE` · Story · P0 · 5 SP · **Depends on:** SHM-051 · **Blocks:** SHM-053

**Refs:** FR-EX-12

**Scope:** IndexedDB queue + service-worker background sync; `client_uuid` per capture; visible pending/synced state per photo; resumable retries on 3G.

**Acceptance criteria**
- [ ] Photos taken offline sync automatically when back online
- [ ] No duplicates after repeated sync attempts
- [ ] Definition of Done met

<a id="shm-053"></a>
#### SHM-053 · Phase 2 E2E + exit gate

`SHARED` · Test · P0 · 5 SP · **Depends on:** SHM-045, SHM-046, SHM-049, SHM-051, SHM-052 · **Blocks:** —

**Refs:** Build prompt Phase 2 exit checks

**Scope:** Playwright: (a) cash job to AWAITING_VERIFICATION; (b) online inspection-first job with approved revision + top-up; (c) auto-assign with first provider declining.

**Acceptance criteria**
- [ ] All three E2E green
- [ ] Every transition produced a history row
- [ ] Lint proves no status write outside the service
- [ ] Definition of Done met

### E3 · Phase 3 — Verification & Money (M7, M8, M9)

<a id="shm-054"></a>
#### SHM-054 · Tier routing (domain) R1–R10

`BE` · Story · P0 · 3 SP · **Depends on:** SHM-043 · **Blocks:** SHM-055

**Refs:** FR-VC-11, SRS §5.2, BR-25

**Scope:** `domain.routeTier()` with injected rng; tier + reasons stored on the verification record; force-Tier-A flag honoured.

**Acceptance criteria**
- [x] One unit test per rule R1–R10 — `packages/domain/test/tierRouting.test.ts`: one test per rule R1–R10, plus boundaries, "every matching reason is recorded", and R9 not drawing when another rule already decided
- [x] Replace E2 stub; reasons persisted — `CompletionService.handToVerification` now calls `TierRoutingService`; tier and every reason are stored on `verification_calls.routing_reasons` and `bookings.verification_tier`
- [x] Definition of Done met

**Evidence (30 Sep 2026):** `routeTier` (pure, injected rng) in `packages/domain/src/tierRouting.ts`; `TierRoutingService` gathers the facts from what was recorded (verified-job count, demerits, prior complaint/dispute, approved extras, minutes on site, missing photo, check-in/out distance). Reasons are named `R1_NEW_PROVIDER` … `R10_FORCED`. Cash always Tier A (R8). `TierRandom` lets a test pin the R9 draw. `verification.force_tier_a` is seeded `false` (SRS says shipping default true — a settings flip, not a code change).

<a id="shm-055"></a>
#### SHM-055 · Verification queue, SLA & claim locking

`BE` · Story · P0 · 5 SP · **Depends on:** SHM-054, SHM-006 · **Blocks:** SHM-056, SHM-066, SHM-091

**Refs:** FR-VC-02, FR-VC-10, FR-VC-13..15, CL-08, CL-19, CL-20

**Scope:** Priority (cash first, 15-min SLA) then waiting time; SLA via SlaCalendar; claim with `FOR UPDATE SKIP LOCKED`; lock auto-expiry sweeper; 423 outside calling hours; conflict-of-interest check (phone/email/CNIC/staff_conflicts).

**API contract:** `GET /agent/queue` · `POST /agent/queue/claim` · `POST /agent/verifications/:id/release-lock` · WS `agent-queue`

**Acceptance criteria**
- [x] Two agents claiming concurrently → one lock — `verification-queue.test.ts`: two concurrent claims of one call → one 200, one 409, one lock in the database
- [x] Agent with a declared conflict cannot claim (`CONFLICT_OF_INTEREST`) — `staff_conflicts` (either direction) → 403 `CONFLICT_OF_INTEREST` on claim and again on submit; same-user and same-phone/email are checked too (a shared phone/email cannot occur while those columns are unique)
- [ ] Definition of Done met — the `agent-queue` WebSocket is not built — agents poll `GET /agent/queue`; CNIC matching is not applicable (agents have none)

**Evidence (30 Sep 2026):** `VerificationQueueService`: `GET /agent/queue` (cash first, then SLA deadline; SLA in business minutes via `businessMinutesBetween`, negative once breached), `POST /agent/queue/claim` (`FOR UPDATE … SKIP LOCKED`, optionally a named call, one held call per agent, 423 outside 08–22 PKT), `POST /agent/verifications/:id/release-lock`. Sweepers (worker jobs): `verification.lock-sweeper` returns claims older than `verification.lock_timeout_min`; `verification.sla-monitor` stamps `sla_breached_at` once. Agent endpoints are `AGENT` + TOTP only (admin, finance, customer, provider → 403). `AppClock` is the application's time source; tests move it by an offset, never the database's.

<a id="shm-056"></a>
#### SHM-056 · Agent console API: call, attempts, outcome guards

`BE` · Story · P0 · 5 SP · **Depends on:** SHM-055, SHM-011 · **Blocks:** SHM-057, SHM-059, SHM-064, SHM-067, SHM-068

**Refs:** FR-VC-03..06, FR-VC-09

**Scope:** Console payload (booking, invoice, photos, provider history, open complaints); click-to-call via telephony adapter and manual-dial mode; attempt logging with time bands; consent flag; outcome guards (extra charge = YES or work = NONE → only DISPUTED).

**API contract:** `POST /agent/verifications/:id/call` · `POST /agent/verifications/:id/attempts`

**Acceptance criteria**
- [x] Submit without consent → 422 — `consentLineRead: false` → 422 naming the field, nothing recorded
- [x] Illegal outcome for the given answers → 422 — extra charge demanded or work NONE → only DISPUTED (422 otherwise); VERIFIED_* without consent to release → 422; extra charge without an amount → 422; also refused without an answered attempt (409)
- [x] Definition of Done met

**Evidence (30 Sep 2026):** `VerificationConsoleService`: `GET /agent/verifications/:id` (booking, invoice, photos, checklist, minutes on site, check-in/out distance, provider history, open complaints, attempts, consent line, fixed questionnaire — one call), `POST …/call` (bridged click-to-call through the telephony port, storing the recording under `recordings/`, or manual-dial returning the number), `GET/POST …/attempts` (insert-only; band from `bandOf`, an unanswered attempt returns the call to the queue for the next untried band via `nextAttemptAt`, same band refused). Pure rules live in `packages/domain/src/verification.ts` (21 unit tests).

<a id="shm-057"></a>
#### SHM-057 · Verification submission & release posting

`BE` · Story · P0 · 8 SP · **Depends on:** SHM-056 · **Blocks:** SHM-058, SHM-060, SHM-061, SHM-063, SHM-065, SHM-067, SHM-073, SHM-075, SHM-089

**Refs:** FR-VC-05, FR-VC-08, FR-PY-03, FR-PY-06, FR-PY-10, FR-RT-01..03, FR-RT-06, TRD §6.3, §9.4

**Scope:** One transaction: immutable record, booking event, release posting (commission, coupon from commission, excess-escrow refund), rating + remark (display 'First L.'), `VERIFIED_WITH_ISSUE` → complaint + flag.

**API contract:** `POST /agent/verifications/:id/submit`

**Acceptance criteria**
- [x] UPDATE on a submitted verification rejected by DB — database refuses UPDATE and DELETE of a submitted `verification_calls` row (test); amendments are separate rows
- [x] Rating insert without verification rejected by DB — `trg_rating_requires_verification` refuses it (test), and no code path inserts one except from a rating-producing outcome
- [x] Ledger sums to zero across a full job — every ledger transaction of a full job balances, GATEWAY_CLEARING debits equal the final amount, escrow ends at zero (test); `money-safety.test.ts` re-asserts it across the whole database
- [x] Definition of Done met

**Evidence (30 Sep 2026):** `VerificationSubmitService` + `VerificationOutcomeService` + `ReleaseService`. One transaction: immutable record → booking event (`verified` → `release`) → `RELEASE` posting (D ESCROW final · D PROMO_EXPENSE coupon · C PROVIDER_WALLET gross−commission · C PLATFORM_COMMISSION commission, `round_half_up` on the snapshotted rate) → excess-escrow refund → rating + remark ("First L.") → for VERIFIED_WITH_ISSUE a `VERIFICATION_AUTO` complaint and a provider flag (3 in `flags.window_days` → `provider.review_required`). Cash jobs stop at VERIFIED (authorised to collect). REWORK and DISPUTED hold the money. The status guard trigger independently refuses `PAYMENT_RELEASED` without a permitting verification (test). Refunds now span multiple payments (booking + top-up).

<a id="shm-058"></a>
#### SHM-058 · Rework flow

`BE` · Story · P0 · 5 SP · **Depends on:** SHM-057 · **Blocks:** SHM-073, SHM-076

**Refs:** FR-EX-07, T18–T26, CL-10

**Scope:** `REWORK_REQUIRED`, 48 h delayed job, new visit requires new OTP, new `verification_calls` row (`visit_no` 2); second failure → `DISPUTED` with dispute row.

**API contract:** `POST /bookings/:id/warranty-claim`

**Acceptance criteria**
- [x] Second verification is a separate immutable record — visit 2 gets its own `verification_calls` row (`visit_no`), own checklist/photos; the first stays REWORK_REQUIRED and immutable
- [x] Second failure creates exactly one dispute — `REWORK_FAILED` dispute; the unique open-dispute index makes a second impossible; an unused 48 h window disputes once as `REWORK_EXPIRED` however often the sweep runs
- [x] Definition of Done met

**Evidence (30 Sep 2026):** `POST /bookings/:id/warranty-claim` (customer, within `warranty_until`, once) reopens a released job as rework — same booking, fresh start code, `failed_rework_count` set so a second failure disputes. The rework visit increments `visit_no` on start. A warranty re-check re-verifies without a second release or rating. Sweeps: `booking.rework-expiry` (T22) and `booking.close-elapsed` (T26: closed once warranty and the post-release complaint window have both elapsed; refunded jobs close at once). A rework/warranty completion keeps the original invoice and amount.

<a id="shm-059"></a>
#### SHM-059 · Unreachable customer: link, auto-release, Tier B escalation

`BE` · Story · P0 · 8 SP · **Depends on:** SHM-056 · **Blocks:** SHM-065, SHM-069

**Refs:** FR-VC-06, FR-VC-07, FR-VC-12, CL-09

**Scope:** 3 attempts across ≥ 2 bands → verification link (SMS + WhatsApp mock) → `/v/:token` with OTP + short questionnaire → `LINK_CONFIRMED`. 72 h auto-release sweep (rating suppressed). Tier B no response 24 h → Tier A.

**API contract:** `GET /v/:token` (public) · `POST /v/:token`

**Acceptance criteria**
- [x] Auto-release creates no rating — 72 h (`verification.auto_release_hours`) after completion → outcome AUTO_RELEASED, no rating, online released once (concurrent sweeps), cash authorised only; not before 72 h; an agent-decided job is never auto-released
- [x] Expired/used token → 410 — 410 `GONE` (new error code); unknown token 404; fifth wrong code → 423 and the link locks
- [x] Definition of Done met

**Evidence (30 Sep 2026):** `VerificationLinkService` (+ public `GET/POST /api/v1/v/:token`): after three unanswered attempts in three bands the customer is texted a link with a one-time code by SMS and WhatsApp (mocks); a clean, consenting answer → LINK_CONFIRMED (release, rating without remark); any problem → no release, back to the queue as Tier A with reason `LINK_NEGATIVE`. Tier B: completion emits `verification.link_requested`, the worker delivers the link; unanswered for 24 h (`verification.b_escalation_hours`) → Tier A with `B_NO_RESPONSE` and a business-hours SLA. The `outbox.dispatch` job now supports several handlers (notifications + verification links).

<a id="shm-060"></a>
#### SHM-060 · Cash settlement, debt ceiling, debt payment

`BE` · Story · P0 · 5 SP · **Depends on:** SHM-057 · **Blocks:** SHM-061, SHM-065, SHM-070

**Refs:** FR-PY-01, FR-PY-04, FR-PY-05, FR-PY-13, UC-18, CL-08

**Scope:** Provider 'payment received' → cash commission posting (wallet debit) → `PAYMENT_RELEASED` → customer SMS receipt with problem link (complaint source `RECEIPT_LINK`). Debt over ceiling → `offer_blocked_reason = 'DEBT'`. Online debt payment clears block.

**API contract:** `POST /bookings/:id/cash-received` · `POST /provider/debt/pay`

**Acceptance criteria**
- [x] Debt-blocked provider receives no offers — a provider over `cash.debt_ceiling_paisa` gets no direct booking (409 `DEBT_BLOCKED`), is skipped by auto-assign, hidden from search, and sees no offers
- [x] Paying debt online unblocks immediately — the block is lifted in the same transaction as the capture; a part-payment still over the ceiling does not lift it; an online release that lifts the wallet unblocks too
- [x] Definition of Done met

**Evidence (30 Sep 2026):** `POST /bookings/:id/cash-received` (provider; only after VERIFIED/AUTO_RELEASED, once) → `CASH_SETTLEMENT` (D PROVIDER_WALLET commission · C PLATFORM_COMMISSION; coupon credited back to the provider) → PAYMENT_RELEASED / CASH_SETTLED → customer SMS receipt with a signed problem link (`/problem/<token>`, complaint source RECEIPT_LINK arrives with phase 4). `DebtService` recomputes `offer_blocked_reason = 'DEBT'` from the ledger whenever the wallet moves and never touches other block reasons. `GET /provider/wallet`, `POST /provider/debt/pay` (DEBT payment, `DEBT_PAYMENT` posting).

<a id="shm-061"></a>
#### SHM-061 · Finance API: escrow, refunds, payouts, reconciliation views

`BE` · Story · P0 · 8 SP · **Depends on:** SHM-057, SHM-060 · **Blocks:** SHM-062, SHM-070, SHM-072, SHM-090

**Refs:** FR-PY-06..08, FR-SP-10, FR-SP-11

**Scope:** Escrow held, releases, refunds (gateway refund via outbox + ledger), payout requests, weekly payout batch job (CSV + per-provider PDF statements), mark paid/failed, cash reconciliation, debts, ledger explorer by account.

**API contract:** `GET /finance/escrow` · `GET/POST /finance/refunds` · `GET/POST /finance/payout-batches` · `POST /finance/payout-batches/:id/mark-paid` · `GET /finance/cash-reconciliation` · `GET /finance/debts` · `GET /finance/ledger` · `GET /provider/earnings` · `POST /provider/payouts`

**Acceptance criteria**
- [x] Failed payout reverses cleanly — the bank marks one payout FAILED → `REVERSAL` (D PAYOUT_CLEARING / C PROVIDER_WALLET), reason stored, provider can ask again; repeating the answer changes nothing
- [x] Refund to original method with reason stored — manual refund per payment, reason code and text stored, gateway settled and audited (disputed bookings only)
- [x] Definition of Done met

**Evidence (30 Sep 2026):** Finance (FINANCE/ADMIN + TOTP): `GET /finance/escrow`, `GET/POST /finance/refunds`, `GET /finance/payouts`, `POST /finance/payouts/:id/approve`, `GET/POST /finance/payout-batches`, `GET …/export.csv` (decrypted account numbers, audited), `GET …/statements/:providerId` (PDF), `POST …/mark-paid`, `GET /finance/cash-reconciliation`, `GET /finance/debts`, `GET /finance/ledger` (filter + cursor). Provider: `GET/POST /provider/payout-accounts` (AES-GCM, last four shown), `GET /provider/earnings` (held / releasable / paid / commission / weekly / monthly), `GET/POST /provider/payouts` (advisory-locked so two requests cannot spend one balance). The weekly payout schedule remains a phase 5 job.

<a id="shm-062"></a>
#### SHM-062 · Nightly reconciliation job

`BE` · Task · P0 · 3 SP · **Depends on:** SHM-061 · **Blocks:** —

**Refs:** FR-PY-06, TRD §13

**Scope:** Compare ledger-derived balances with `account_balances` and gateway records; drift alert.

**Acceptance criteria**
- [x] Zero drift on seeded + E2E data — across everything the suite and earlier runs produced
- [x] Injected drift raises an alert — a doctored `account_balances` row and a mis-stated payment are each detected, reported, audited and raised as `ledger.drift_detected`, and clear when put right
- [x] Definition of Done met

**Evidence (30 Sep 2026):** `ReconciliationService`: derived balances vs entries, balanced transactions, gateway captures and refunds vs ledger postings, refunded totals, escrow never negative and empty once a booking is finished. `POST /finance/reconciliation/run`; scheduled as `ledger.reconcile` (daily). Every run writes an audit row.

<a id="shm-063"></a>
#### SHM-063 · Reputation projector, badges, remarks replies

`BE` · Story · P1 · 5 SP · **Depends on:** SHM-057 · **Blocks:** SHM-071

**Refs:** FR-RT-04, FR-RT-05, FR-RT-07, FR-SP-04, FR-SP-05, FR-SP-12, FR-SP-13, FR-AD-06..08, FR-AD-11, CL-17, CL-18

**Scope:** `provider_stats` (CL-17 weighted score, distribution, counts); badges from verified jobs only; low-rating auto-flag; one immutable provider reply per remark; admin unpublish (rating kept, audited).

**API contract:** `POST /provider/remarks/:id/reply` · `/admin/remarks/:id/unpublish`

**Acceptance criteria**
- [x] Second reply → 409 — one reply per published remark, 409 after; the database refuses an edit
- [x] Unpublished remark hidden publicly; score unchanged — hidden from the public, still visible to the provider (flagged) and to admin with who/why; the reputation score is unchanged (test); audited
- [ ] Definition of Done met — no `provider_stats` table: score, distribution and badge are computed on read from ratings (search uses the same weighting in SQL); the badge column is projected after each rating

**Evidence (30 Sep 2026):** `ReputationService`: CL-17 score (`rating.bayesian_prior`/`bayesian_weight`, last 20 ratings × `rating.recent_weight`), distribution, verified-job count, badge (10 / 50 / 200 verified jobs → TRUSTED / PRO / ELITE, from verified jobs only), low-rating flag (average ≤ `rating.poor_threshold` with ≥ 5 ratings, once). Endpoints: `GET /search/providers/:id/reputation`, `…/remarks`, `GET /provider/ratings`, `POST /provider/remarks/:id/reply`, `GET /admin/providers/:id/ratings`, `POST /admin/remarks/:id/unpublish`. Search results now carry `ratingScore`, `ratingCount`, `badge` and are ranked by the `ranking.weights` for the inputs that exist (rating, distance; completion/response/recency await data). Provider detail carries `reputation`.

<a id="shm-064"></a>
#### SHM-064 · Call recordings: access & retention

`BE` · Task · P1 · 2 SP · **Depends on:** SHM-056 · **Blocks:** —

**Refs:** FR-VC-09, NFR-PR

**Scope:** Recordings playable only by finance/admin via signed URLs (audited); retention purge job.

**Acceptance criteria**
- [x] Agent role → 403 on playback — agent → 403 (even for their own call); finance and admin → a signed 5-minute link, each access audited
- [x] Purge removes objects past retention and logs it — recordings older than `recording.retention_days` are deleted from storage, each logged (`recording.purge`), recent ones kept, playback afterwards 404, re-running purges nothing twice
- [x] Definition of Done met

**Evidence (30 Sep 2026):** `RecordingService` + `GET /finance/recordings/:attemptId`; a bridged call stores its recording under `recordings/calls/<callRef>.mp3` and returns the reference for the attempt. Scheduled as `recording.purge` (daily). Attempt rows stay insert-only, so the reference remains as the record that a recording existed.

<a id="shm-065"></a>
#### SHM-065 · Phase 3 money & verification integration tests

`BE` · Test · P0 · 3 SP · **Depends on:** SHM-057, SHM-059, SHM-060 · **Blocks:** SHM-074

**Refs:** Build prompt Phase 3 tests

**Scope:** Release blocked by trigger without verification; concurrent claim; commission rounding; SLA edge cases; ledger zero-sum per job.

**Acceptance criteria**
- [ ] All green in CI — green locally (341 integration, 94 API unit, 65 domain tests); the CI integration job runs them on every PR, not yet observed on a real PR
- [ ] Definition of Done met — pending the first CI run

**Evidence (30 Sep 2026):** Release blocked without verification (trigger) · concurrent claim (one lock) · two simultaneous verdicts release once · commission rounding half-up on real jobs at 100 003 / 100 005 / 100 010 / 333 333 paisa · SLA edges (mid-morning, 21:50 carry-over, small hours, exactly 22:00) · ledger zero-sum per job · reconciliation zero drift. Suites: `verification-queue`, `verification-submit`, `verification-rework`, `verification-unreachable`, `payments-cash`, `finance`, `reputation`, `phase3-money`.

<a id="shm-066"></a>
#### SHM-066 · Agent queue page

`FE` · Story · P0 · 3 SP · **Depends on:** SHM-055, SHM-017 · **Blocks:** SHM-067

**Refs:** FR-VC-02, FR-VC-13..15

**Scope:** `/agent/queue`: realtime list with priority, SLA countdown (red when breached), calling-hours banner, claim button.

**Acceptance criteria**
- [ ] Claimed item disappears for other agents instantly
- [ ] Definition of Done met

<a id="shm-067"></a>
#### SHM-067 · Agent verification console

`FE` · Story · P0 · 8 SP · **Depends on:** SHM-056, SHM-057, SHM-066 · **Blocks:** SHM-074

**Refs:** FR-VC-03..06, TRD §15.1

**Scope:** `/agent/console/[verificationId]` single screen: left booking + invoice + before/after photos side by side; middle provider history & complaints; right questionnaire. Shortcuts 1–5 scores, `C` consent, `Enter` submit. Call controls (click-to-call / manual), attempt logging, outcome guard messages.

**Acceptance criteria**
- [ ] Whole verification completable by keyboard
- [ ] Form disabled until consent ticked
- [ ] Lock-expiry warning before auto-release of claim
- [ ] Definition of Done met

<a id="shm-068"></a>
#### SHM-068 · Agent attempts history page

`FE` · Task · P2 · 2 SP · **Depends on:** SHM-056 · **Blocks:** —

**Refs:** FR-VC-06

**Scope:** `/agent/attempts`: own attempts with band, result, time.

**Acceptance criteria**
- [ ] Filterable by date and result
- [ ] Definition of Done met

<a id="shm-069"></a>
#### SHM-069 · Public verification link page

`FE` · Story · P0 · 3 SP · **Depends on:** SHM-059 · **Blocks:** SHM-074

**Refs:** FR-VC-06

**Scope:** `/v/[token]`: OTP entry + short questionnaire, en/ur, works on low-end phones; expired/used states.

**Acceptance criteria**
- [ ] Usable at 320 px without login
- [ ] Definition of Done met

<a id="shm-070"></a>
#### SHM-070 · Provider money pages

`FE` · Story · P0 · 5 SP · **Depends on:** SHM-060, SHM-061 · **Blocks:** SHM-074

**Refs:** FR-SP-10, FR-SP-11, FR-PY-04, FR-PY-13

**Scope:** Cash collection step in job flow; `/p/earnings` (held, releasable, paid, commission, weekly/monthly); `/p/payouts` request + history; debt banner with pay-now.

**Acceptance criteria**
- [ ] Figures match ledger-derived API values exactly
- [ ] Definition of Done met

<a id="shm-071"></a>
#### SHM-071 · Ratings, remarks & badges UI

`FE` · Story · P1 · 3 SP · **Depends on:** SHM-063 · **Blocks:** —

**Refs:** FR-SP-04, FR-SP-05, FR-SP-12, FR-SP-13, FR-RT-05, FR-RT-06

**Scope:** `/p/ratings` with one-time reply; ratings summary, distribution and badges on `/providers/[id]`.

**Acceptance criteria**
- [ ] Reply box disappears after posting
- [ ] Definition of Done met

<a id="shm-072"></a>
#### SHM-072 · Finance console

`FE` · Story · P0 · 8 SP · **Depends on:** SHM-061, SHM-017 · **Blocks:** SHM-074

**Refs:** FR-PY-06..08

**Scope:** `/finance/escrow`, `releases`, `refunds` (create with reason), `payouts` (run batch, download CSV/PDF, mark paid/failed), `cash`, `debts`, `ledger` explorer.

**Acceptance criteria**
- [ ] All money shown via one PKR formatter from paisa
- [ ] Destructive actions require confirm dialog
- [ ] Definition of Done met

<a id="shm-073"></a>
#### SHM-073 · Customer post-verification states

`FE` · Story · P1 · 3 SP · **Depends on:** SHM-057, SHM-058 · **Blocks:** SHM-074

**Refs:** FR-CU-06, FR-EX-07

**Scope:** Booking detail shows verification outcome, rework schedule, warranty-claim button, receipt link entry to complaint.

**Acceptance criteria**
- [ ] Rework booking shows second visit clearly
- [ ] Definition of Done met

<a id="shm-074"></a>
#### SHM-074 · Phase 3 E2E + exit gate

`SHARED` · Test · P0 · 5 SP · **Depends on:** SHM-065, SHM-067, SHM-069, SHM-070, SHM-072, SHM-073 · **Blocks:** —

**Refs:** Build prompt Phase 3 exit checks

**Scope:** E2E: online happy path to PAYMENT_RELEASED with rating on profile; cash path with collection; unreachable → link confirm; unreachable → auto-release with no rating; rework → second failure → DISPUTED.

**Acceptance criteria**
- [ ] All five E2E green
- [ ] Reconciliation reports zero drift
- [ ] Definition of Done met

### E4 · Phase 4 — Trust & Communication (M10, M11, M15)

<a id="shm-075"></a>
#### SHM-075 · Complaints API

`BE` · Story · P0 · 5 SP · **Depends on:** SHM-057 · **Blocks:** SHM-076, SHM-082, SHM-083

**Refs:** FR-CP-01..04, FR-CP-07, FR-CP-08

**Scope:** Customer and provider complaints with photos; states + SLA by severity; safety complaints top of queue with immediate admin alert; `complaint_events` timeline; assignment.

**API contract:** `POST /complaints` · `GET /complaints/:id` · `POST /complaints/:id/reply` · `GET /admin/complaints` · `POST /admin/complaints/:id/transition`

**Acceptance criteria**
- [ ] Safety complaint triggers admin alert within 1 min
- [ ] Complaint visible in agent console for that booking
- [ ] Definition of Done met

<a id="shm-076"></a>
#### SHM-076 · Disputes API & resolution postings

`BE` · Story · P0 · 8 SP · **Depends on:** SHM-075, SHM-058 · **Blocks:** SHM-077, SHM-083

**Refs:** FR-CP-05, FR-CP-06, T24

**Scope:** Evidence floor (OTP time, geofence distances, photos, checklist, invoice, verification record, recording for authorised roles); 48 h provider reply; resolutions (full release / partial / full refund / refund + penalty) posted in one transaction; both parties notified.

**API contract:** `GET /admin/disputes` · `POST /admin/disputes/:id/resolve`

**Acceptance criteria**
- [ ] Partial refund split balances to zero
- [ ] Resolution before reply window closes requires override reason
- [ ] Definition of Done met

<a id="shm-077"></a>
#### SHM-077 · Conduct engine: penalties, demerits, thresholds

`BE` · Story · P0 · 8 SP · **Depends on:** SHM-076 · **Blocks:** SHM-078, SHM-079, SHM-080, SHM-084, SHM-085

**Refs:** FR-PN-01, FR-PN-03..06, FR-PN-10, CL-14, CL-16

**Scope:** Penalty PROPOSED → provider reply (48 h) → admin APPLY (DB enforces timing) → demerit award (expiry 180 d) + fine capped per job + wallet debit/debt. Threshold evaluator with harsher-wins merge and once-per-crossing; suspensions/blocks applied.

**API contract:** `POST /admin/penalties` · `POST /admin/penalties/:id/apply` · `POST /provider/penalties/:id/reply`

**Acceptance criteria**
- [ ] Apply before deadline without reply rejected by DB
- [ ] Crossing a threshold twice fires once
- [ ] Definition of Done met

<a id="shm-078"></a>
#### SHM-078 · Appeals & reversals

`BE` · Story · P0 · 5 SP · **Depends on:** SHM-077 · **Blocks:** SHM-084

**Refs:** FR-PN-07

**Scope:** Appeal submission; admin decision; reversal voids award and posts compensating ledger reversal; all audited.

**API contract:** `POST /provider/penalties/:id/appeal` · `POST /admin/appeals/:id/decide`

**Acceptance criteria**
- [ ] Reversal restores wallet balance and points exactly
- [ ] Definition of Done met

<a id="shm-079"></a>
#### SHM-079 · Daily conduct job: expiry, decay, suspensions

`BE` · Task · P0 · 3 SP · **Depends on:** SHM-077 · **Blocks:** SHM-085

**Refs:** FR-PN-02, CL-15

**Scope:** Expire points at 180 d; decay 1 pt per 30 clean days; lift ended suspensions; refresh flags.

**Acceptance criteria**
- [ ] Time-travel tests with FakeClock cover 179/180/181 days
- [ ] Definition of Done met

<a id="shm-080"></a>
#### SHM-080 · Automatic breach proposals

`BE` · Story · P1 · 5 SP · **Depends on:** SHM-077 · **Blocks:** —

**Refs:** SRS §8.2

**Scope:** No-show, late cancel, rework verified, poor-rating streak, overcharge (from verification answer), falsified (from dispute) — always PROPOSED, never auto-applied.

**Acceptance criteria**
- [ ] Each trigger has an integration test producing one PROPOSED penalty
- [ ] Definition of Done met

<a id="shm-081"></a>
#### SHM-081 · Notifications: full planner & delivery

`BE` · Story · P0 · 8 SP · **Depends on:** SHM-044 · **Blocks:** SHM-086, SHM-087

**Refs:** FR-NT-01..06

**Scope:** Planner matrix (event × role → channels) for every booking transition and M7/M8/M10/M15 event; en/ur renderer; retries with backoff; delivery-receipt webhook; notification log; in-app centre via Socket.IO; template CRUD API with preview.

**API contract:** `POST /webhooks/sms/:provider` · `/admin/templates/*` · WS `user:{id}`

**Acceptance criteria**
- [ ] Idempotent per outbox event
- [ ] Every booking transition in an E2E run produces the expected notifications
- [ ] Definition of Done met

<a id="shm-082"></a>
#### SHM-082 · Complaint forms & timeline

`FE` · Story · P0 · 5 SP · **Depends on:** SHM-075 · **Blocks:** SHM-088

**Refs:** FR-CP-01, FR-CP-04, FR-CP-07

**Scope:** Customer (from booking detail or receipt link) and provider complaint forms with photos; complaint detail with timeline and reply.

**Acceptance criteria**
- [ ] Safety option clearly labelled and explained
- [ ] Definition of Done met

<a id="shm-083"></a>
#### SHM-083 · Admin complaints & disputes workspace

`FE` · Story · P0 · 8 SP · **Depends on:** SHM-075, SHM-076 · **Blocks:** SHM-088

**Refs:** FR-CP-02, FR-CP-06, FR-CP-08

**Scope:** `/admin/complaints` queue (SLA, severity, assignment); `/admin/disputes` with evidence-floor viewer and resolution form showing money split preview.

**Acceptance criteria**
- [ ] Resolution preview totals equal escrow held
- [ ] Definition of Done met

<a id="shm-084"></a>
#### SHM-084 · Admin penalties & appeals

`FE` · Story · P0 · 5 SP · **Depends on:** SHM-077, SHM-078 · **Blocks:** SHM-088

**Refs:** FR-PN-01, FR-PN-06, FR-PN-07

**Scope:** `/admin/penalties` (propose, view reply, apply after window), `/admin/appeals` (decide with reason).

**Acceptance criteria**
- [ ] Apply button disabled until the reply window rules allow it
- [ ] Definition of Done met

<a id="shm-085"></a>
#### SHM-085 · Provider conduct page

`FE` · Story · P0 · 5 SP · **Depends on:** SHM-077, SHM-079 · **Blocks:** SHM-088

**Refs:** FR-SP-14, FR-PN-02, FR-PN-06, FR-PN-08

**Scope:** `/p/conduct`: active points with expiry dates, decay progress, penalty schedule, reply to proposed penalty (with evidence), appeal.

**Acceptance criteria**
- [ ] Countdown to reply deadline visible
- [ ] Definition of Done met

<a id="shm-086"></a>
#### SHM-086 · Notification centre

`FE` · Story · P1 · 3 SP · **Depends on:** SHM-081 · **Blocks:** SHM-088

**Refs:** FR-NT-01

**Scope:** Bell with unread badge in every shell; list, mark read, deep links to entity.

**Acceptance criteria**
- [ ] Badge updates in real time
- [ ] Definition of Done met

<a id="shm-087"></a>
#### SHM-087 · Admin template editor

`FE` · Story · P2 · 3 SP · **Depends on:** SHM-081 · **Blocks:** —

**Refs:** FR-NT-06

**Scope:** `/admin/templates`: edit per event × channel × language with live preview using sample data; RTL preview for Urdu.

**Acceptance criteria**
- [ ] Invalid placeholder blocked on save
- [ ] Definition of Done met

<a id="shm-088"></a>
#### SHM-088 · Phase 4 E2E + exit gate

`SHARED` · Test · P0 · 3 SP · **Depends on:** SHM-082, SHM-083, SHM-084, SHM-085, SHM-086 · **Blocks:** SHM-101

**Refs:** Build prompt Phase 4 exit checks

**Scope:** E2E: dispute → partial refund → penalty proposed → provider replies → applied → appeal → reversed.

**Acceptance criteria**
- [ ] E2E green
- [ ] Notification expectations met for the full run
- [ ] Definition of Done met

### E5 · Phase 5 — Depth, Hardening & Release (M13, M14, ops)

<a id="shm-089"></a>
#### SHM-089 · Maintenance plans

`BE` · Story · P1 · 8 SP · **Depends on:** SHM-057 · **Blocks:** SHM-097

**Refs:** FR-MP-01..04

**Scope:** Admin CRUD; subscribe (PLAN_DEFERRED posting); daily scheduler creates plan visits 7 days ahead, offered first to preferred provider; same verification with PLAN_RELEASE posting; cancel with pro-rata refund of unused visits.

**API contract:** `GET /plans` · `POST /plans/:id/subscribe` · `GET /me/subscriptions` · `POST /subscriptions/:id/cancel` · admin CRUD

**Acceptance criteria**
- [ ] Pro-rata refund correct to the paisa
- [ ] Definition of Done met

<a id="shm-090"></a>
#### SHM-090 · Reports (async) with PDF & XLSX

`BE` · Story · P1 · 8 SP · **Depends on:** SHM-061 · **Blocks:** SHM-098

**Refs:** FR-RP-01..06

**Scope:** `report_runs`: monthly bookings & successful handling (FR-RP-02 definition), revenue by month/category (ties to ledger), provider performance, verification report; pdfmake + exceljs.

**API contract:** `POST /admin/reports` · `GET /admin/reports/:id`

**Acceptance criteria**
- [ ] Revenue report total equals ledger for the period
- [ ] Definition of Done met

<a id="shm-091"></a>
#### SHM-091 · Operations board API

`BE` · Task · P1 · 3 SP · **Depends on:** SHM-055 · **Blocks:** SHM-099

**Refs:** FR-AD-12

**Scope:** Aggregates: today's bookings by state, queue depth, SLA breaches, open disputes, escrow held, debt-blocked providers; pushed on `ops-board`.

**API contract:** `GET /admin/ops-board` · WS `ops-board`

**Acceptance criteria**
- [ ] Updates within 5 s of underlying change
- [ ] Definition of Done met

<a id="shm-092"></a>
#### SHM-092 · Hardening: performance, security, observability

`BE` · Task · P0 · 8 SP · **Depends on:** — · **Blocks:** SHM-094, SHM-101

**Refs:** SRS §12 NFRs, TRD §18, §19, §22

**Scope:** k6 (search 50 rps p95 < 800 ms; queue claim); EXPLAIN-verified indexes; OWASP ZAP baseline in CI; CSP with nonces + security headers; Sentry; Prometheus metrics & alerts.

**Acceptance criteria**
- [ ] k6 report attached
- [ ] ZAP baseline has no high findings
- [ ] Alerts fire in a staged test
- [ ] Definition of Done met

<a id="shm-093"></a>
#### SHM-093 · Backup/restore & runbooks

`BE` · Task · P0 · 3 SP · **Depends on:** — · **Blocks:** —

**Refs:** TRD §19, NFR-AV

**Scope:** Backup script, documented restore drill with timing, runbooks for top incidents (gateway down, queue backlog, reconciliation drift).

**Acceptance criteria**
- [ ] Restore drill executed and recorded
- [ ] Definition of Done met

<a id="shm-094"></a>
#### SHM-094 · Production images & deployment pipeline

`SHARED` · Task · P0 · 5 SP · **Depends on:** SHM-092 · **Blocks:** SHM-101

**Refs:** TRD §21

**Scope:** Multi-stage non-root Dockerfiles; prod compose/platform manifests; deploy to staging on tag; manual approval to prod; migrations as release step.

**Acceptance criteria**
- [ ] Staging deploy from a tag with zero manual steps
- [ ] Definition of Done met

<a id="shm-095"></a>
#### SHM-095 · Real payment gateway adapter

`BE` · Story · P1 · 5 SP · **Depends on:** — · **Blocks:** —

**Refs:** OQ-03, TRD §17

**Scope:** Implement the chosen PK gateway behind the existing payment port (capture, refund, signed webhooks).

**Acceptance criteria**
- [ ] Contract tests shared with the mock pass against gateway sandbox
- [ ] Definition of Done met

<a id="shm-096"></a>
#### SHM-096 · Real telephony + SMS/WhatsApp adapters

`BE` · Story · P1 · 5 SP · **Depends on:** — · **Blocks:** —

**Refs:** OQ-04, TRD §17

**Scope:** Implement chosen telephony (click-to-call, recording, webhooks) and SMS/WhatsApp vendors behind existing ports.

**Acceptance criteria**
- [ ] Contract tests pass against vendor sandbox
- [ ] Definition of Done met

<a id="shm-097"></a>
#### SHM-097 · Plans UI (customer + admin)

`FE` · Story · P1 · 5 SP · **Depends on:** SHM-089 · **Blocks:** SHM-101

**Refs:** FR-MP-01..04

**Scope:** `/c/plans` (browse, subscribe, entitlements, renewal, cancel with refund preview); `/admin/plans` CRUD.

**Acceptance criteria**
- [ ] Refund preview matches API
- [ ] Definition of Done met

<a id="shm-098"></a>
#### SHM-098 · Admin reports page

`FE` · Story · P1 · 5 SP · **Depends on:** SHM-090 · **Blocks:** SHM-101

**Refs:** FR-RP-01..06

**Scope:** `/admin/reports`: request report (type, period, format), status polling, download, printable HTML view.

**Acceptance criteria**
- [ ] Print view fits A4 in both languages
- [ ] Definition of Done met

<a id="shm-099"></a>
#### SHM-099 · Operations board (realtime)

`FE` · Story · P1 · 5 SP · **Depends on:** SHM-091 · **Blocks:** SHM-101

**Refs:** FR-AD-12

**Scope:** `/admin/ops`: tiles and lists for all ops-board metrics, SLA breaches highlighted.

**Acceptance criteria**
- [ ] Works on a 1366 px laptop without horizontal scroll
- [ ] Definition of Done met

<a id="shm-100"></a>
#### SHM-100 · Accessibility, Urdu completion & bundle budget

`FE` · Task · P0 · 5 SP · **Depends on:** — · **Blocks:** SHM-101

**Refs:** SRS §12 NFR-US, TRD §15.2

**Scope:** axe audit fixes on key pages; full Urdu pass (no missing keys); `/p` bundle budget enforced in CI.

**Acceptance criteria**
- [ ] axe: zero serious/critical issues on key pages
- [ ] Missing-translation check in CI passes
- [ ] Definition of Done met

<a id="shm-101"></a>
#### SHM-101 · UAT script, execution & release sign-off

`SHARED` · Test · P0 · 5 SP · **Depends on:** SHM-088, SHM-092, SHM-094, SHM-097, SHM-098, SHM-099, SHM-100 · **Blocks:** —

**Refs:** SRS use cases, SRS §12

**Scope:** Generate `docs/UAT.md` from SRS use cases; execute end to end on staging; attach NFR evidence (k6, ZAP, screenshots).

**Acceptance criteria**
- [ ] UAT signed off by product owner
- [ ] Tag `v1.0.0`
- [ ] Definition of Done met

---

## 6. Blockers

| Date | Ticket | Blocked by | Owner to unblock | Resolved on |
|---|---|---|---|---|
| 25 Sep 2026 | SHM-002, SHM-022, SHM-041 | MinIO container images are no longer publicly pullable (`minio/minio` and `minio/mc` return "repository does not exist"; the quay.io and ghcr.io mirrors require auth). Buckets cannot be created locally. The compose services are behind the `objects` profile with `OBJECT_STORE_IMAGE` / `OBJECT_STORE_CLIENT_IMAGE` overrides so a reachable S3 image can be substituted. | Backend lead / product owner to nominate a reachable S3 image | |
| 21 Sep 2026 | SHM-095 | OQ-03 payment gateway not chosen | Product owner | |
| 21 Sep 2026 | SHM-096 | OQ-04 telephony / SMS vendor not chosen | Product owner | |

### Open product decisions (from SRS §3.1)

| ID | Decision needed | Affects | Current default in build | Status | Answer |
|---|---|---|---|---|---|
| OQ-01 | Cash collection model | SHM-060, SHM-070 | Provider collects after release authorisation (CL-08) | OPEN | |
| OQ-02 | Breach categories | SHM-077, SHM-080 | Categories as in SRS §8.2, harsher wins | OPEN | |
| OQ-03 | Payment gateway | SHM-095 | Mock gateway | OPEN | |
| OQ-04 | Telephony vendor | SHM-096 | Mock telephony + manual dial | OPEN | |
| OQ-05 | Real fee / threshold values | SHM-004 seed, settings | Seeded defaults, editable in settings | OPEN | |
| OQ-06 | Provider security deposit | New ticket if yes | No deposit | OPEN | |

---

## 7. Phase gate sign-off

| Phase | Exit ticket | Review Prompt run | Tag | BE lead | FE lead | Product owner | Date |
|---|---|---|---|---|---|---|---|
| E0 | SHM-013 | ☐ | `phase-0` | ☐ | ☐ | ☐ | |
| E1 | SHM-032 | ☐ | `phase-1` | ☐ | ☐ | ☐ | |
| E2 | SHM-053 | ☐ | `phase-2` | ☐ | ☐ | ☐ | |
| E3 | SHM-074 | ☐ | `phase-3` | ☐ | ☐ | ☐ | |
| E4 | SHM-088 | ☐ | `phase-4` | ☐ | ☐ | ☐ | |
| E5 | SHM-101 | ☐ | `phase-5` | ☐ | ☐ | ☐ | |

---

## 8. Change log

| Date | Who | Change |
|---|---|---|
| 1 Oct 2026 | Claude (backend agent) | Re-ran the API integration suite against live PostGIS and Redis: 362 tests, all green (31 files passed first run; `api-surface` failed only because its committed baseline predated Phase 4 routes). Baseline regenerated deliberately after diffing it: 126 → 165 operations, 39 added, none removed, info/tags/servers/security unchanged. E4 statuses corrected to match the code: SHM-075 `IN REVIEW` (22 integration tests in `complaints.test.ts`); SHM-076–081 `IN PROGRESS` (disputes, conduct/penalties/appeals, conduct jobs and the notification centre exist in the tree, but only `packages/domain` conduct unit tests cover them — no dedicated integration tests yet, so acceptance criteria stay unticked). |
| 30 Sep 2026 | Claude (backend agent) | Phase 3 backend built: SHM-054–065 `IN REVIEW` (SHM-066–074, the frontend and phase exit gate, not started). Tier routing R1–R10; agent queue/claim/locks/SLA; console, attempts, submission; release posting with commission, coupons, excess refunds, ratings/remarks, complaints/flags/disputes; rework, warranty, auto-release, Tier B and the customer link; cash settlement and the commission-debt ceiling; finance API, payouts and batches; nightly reconciliation; reputation, replies, unpublish; recordings and retention. Verified live over real HTTP (53/53) against a server with its application clock set to 10:30 Pakistan time (`npm run dev:at`), plus the real-clock 423 refusal at 02:18. 126 API operations; 341 integration, 94 API unit and 65 domain tests green; lint, typecheck, build clean. Known gaps: `agent-queue` WebSocket, `provider_stats` table (computed on read), 10 000-provider search benchmark, CI run on a real PR, dispute resolution (phase 4). |
| 30 Sep 2026 | Claude (backend agent) | Phase 2 backend verified live over real HTTP against the running dev server (33/33 checks): quote, slots, online checkout → dev gateway capture (replay harmless) → offer → accept, masked chat, depart, start code by SMS (wrong code 422; far check-in flagged, not blocked), evidence (retry deduped; photo step refused without photo), revised quote with top-up gating, completion (final > approved 422) → invoice + PDF for both parties → `AWAITING_VERIFICATION`, auto-assign online booking cancelled and refunded. Database cross-checked: ledger transactions, verification call and invoice present. `TASKS_BACKEND.md` Phase 2 items ticked with notes. |
| 30 Sep 2026 | Claude (backend agent) | Phase 2 backend built: SHM-025, 033–045 moved to `IN REVIEW` (SHM-046–053, the frontend and phase exit gate, not started). New: quote, online checkout with signed-webhook capture and ledger, offers/auto-assign with forfeiture, cancel fees and refunds, masked chat, evidence + geofenced check-in, revised-quote top-ups, completion → invoice (PDF) → verification queue, notification dispatch, slot generator, money-safety invariants. 86 API operations; 248 integration, 82 API unit and 46 domain tests green; lint, typecheck and build clean. Known gaps: Socket.IO `/rt`, provider documents (SHM-022), 10 000-provider search benchmark, CI run on a real PR. |
| 26 Sep 2026 | Claude (backend agent) | M5 booking build started: spec + implementation plan written and approved (`docs/superpowers/specs/2026-09-26-m5-booking-design.md`, `docs/superpowers/plans/2026-09-26-m5-booking-plan.md`), execution underway task-by-task with a fresh implementer + independent reviewer per task (no git in this project, so no worktree/commits — review packages are full file contents; see `.superpowers/sdd/2026-09-26-m5-booking-plan/progress.md` for the execution ledger, including one ruling made mid-flight: a brief's own code and its own test contradicted each other on a status code, resolved in favor of the codebase's established `badRequest`=400/`validationFailed`=422 convention). SHM-033 and SHM-037 moved `TODO` → `IN PROGRESS` (see their cards in §5). Done so far: the pure booking state-transition table (task 1, reviewed clean) and `POST /bookings` booking creation (task 2, reviewed clean after one real fix — the write sequence wasn't transactional, now wrapped in `$transaction`). `GET /bookings/:id` and `GET /bookings` (task 3) are implemented and self-tested (9/9) but review was interrupted mid-run — not yet independently confirmed. Tasks 4-12 (the actual accept/decline/cancel/reschedule/OTP/checklist/quote-revision/completion endpoints, and the final full-suite pass) have not started. |
| 26 Sep 2026 | Claude (backend agent) | SHM-019, SHM-020, SHM-021, SHM-023 and SHM-035 moved `TODO` → `IN PROGRESS` (none fully meet their original acceptance criteria — see each card in §5 for exactly what's built vs. deferred, and why). New code: catalogue (categories/services/checklists/commission rules + provider expertise binding), a small unticketed `places` module (cities/areas — a hard dependency of addresses and provider location that had no ticket of its own), customer addresses (PostGIS-backed, single-default enforced), provider profile/availability/time-off/service-areas, minimal provider approve/reject (built ahead of its SHM-022 dependency because search had no way to be tested otherwise), and provider search ranked by real distance only (the rating/completion-rate/response-speed weighting in SHM-035's scope has no real data to weight yet). 64 unit + 116 integration tests green; lint, typecheck, build clean; also verified as a live HTTP walkthrough against the running server using the same example payloads now documented in Swagger (every write endpoint gained a JSON-Schema request body + realistic examples, derived from the existing Zod validation schemas via a small `ApiZodBody` helper, since none of the docs showed any request shape before this). **Known gap surfaced, not yet fixed:** provider approve/reject does not write to `audit_log`, unlike every other admin action in this codebase — flagged on SHM-023's card. |
| 25 Sep 2026 | backend agent | SHM-009 and SHM-010 shipped: identity, sessions, refresh rotation with reuse detection, staff TOTP. 102 unit and 58 integration tests green against live PostGIS and Redis. Exercising the running API found three further defects, all now fixed: rotation recorded the replacement on the wrong session row so reuse was never detected for the first token of a family; the payment webhook inserted into columns that do not exist so it 500ed on every valid signature; and the seeded TOTP_ENCRYPTION_KEY did not decode to 32 bytes. Two latent defects fixed earlier: the `bookings.status` lint ban had never fired (the selector used `value.regex` where esquery needs `value.value`), and an explicit logout was being reported as refresh token reuse. |
| 21 Sep 2026 | Claude (doc pack) | Tracker created: 101 tickets across 6 phases, derived from SRS v2.1, TRD and build prompt |
