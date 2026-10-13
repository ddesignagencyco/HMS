# Project Review — Smart Home Maintenance Services
### Full meeting pack · plain English · 13 Oct 2026

> **How to use this document.** Sections 1–5 are the story ("what is this, what did we
> build, how do we know it works"). Section 6 is the delta ("what changed since the last
> review"). Sections 7–9 are the honest part ("what is not done, what is risky, what we
> need from you"). Section 10 is a Q&A sheet so nobody is surprised in the room.

---

## 1. What this product is, in one paragraph

It is an app like a taxi app, but for home repairs. A customer searches for an
electrician / plumber / AC technician, books a time slot, pays money, the tradesman
does the job, uploads photos, and gets paid. The one big difference from a normal
marketplace: **we never pay the tradesman just because he says the job is finished.**

Instead:
1. The customer's money is **held safely** by the platform (this is called *escrow*).
2. Our staff **calls the customer** to check the work was really done and is good.
3. Only after the customer confirms does the money get **released** to the tradesman.
4. If something goes wrong, there is a complaint → dispute → penalty → appeal process.

Ratings can only be left for jobs that were checked this way. **The database itself
refuses a rating without a verification record** — not just the application code.

Launch plan: one city (Lahore), six service categories, English + Urdu, Pakistani
rupees, Pakistan time. Money is stored as whole *paisa* (integers), never as decimals,
so rounding errors are impossible.

**Users:** Customer · Provider (tradesman) · Verification agent (calls customers) ·
Finance officer (refunds/payouts) · Administrator (approves tradesmen, settles disputes,
changes settings).

---

## 2. The one rule that shapes every design decision

> **The platform is the "middleman of record".** It holds the money, the evidence, the
> verification outcome and the reputation.

Everything in this codebase exists to defend that rule:

- Money never moves on a verbal claim — it needs a verification record.
- Ratings cannot exist without a verification record (database constraint).
- Only approved tradesmen can be offered jobs.
- Every staff action (approve, reject, refund, release) is written to an audit log.
- Money is held in the platform's own ledger, so refunds and payouts are traceable.

If a proposed feature breaks one of these rules, the feature is wrong, not the rule.

---

## 3. Where we started, and where we are now

We planned the work in five phases. Here they are in plain English:

| Phase | Plain-English meaning | State |
|---|---|---|
| **E0 — Foundation** | Build the skeleton: repo structure, database, login, roles, audit trail, CI pipeline | ✅ **Complete and signed off** (tag `phase-0`) |
| **E1 — Onboarding** | Get customers and tradesmen into the system, and let an admin approve a tradesman | ✅ **Built + reviewer pass done** (7/7) |
| **E2 — Doing the job** | Search, book, pay, the tradesman travels and works, uploads proof, quotes extra work | ✅ **Built + reviewer pass done** (16/17) |
| **E3 — Checking & paying** | Verification queue, staff calling customers, releasing money, refunds, payouts, nightly reconciliation, ratings | ✅ **Built + reviewer pass done** (12/12) |
| **E4 — Trust & communication** | Complaints, disputes, penalty engine, appeals, automated breach detection, notification planner | ✅ **Built + reviewer pass done** (7/7) |
| **E5 — Depth & release** | Subscription plans, PDF/Excel reports, ops dashboard, monitoring & alerts, backups & restore drills, 10,000-user load test, search ranking | 🟡 **Built but NOT yet committed/pushed** |

**One-sentence summary:** the feature surface of the product is essentially complete.
What is left is one half-finished ticket, three untested claims, a hard product freeze on
real money and real SMS, and a lot of finished work that is still only on someone's laptop.

---

## 4. What was actually built (the numbers)

### 4.1 Headline figures

| What | Figure |
|---|---|
| Backend tickets built | **53 of 60** |
| Tickets formally signed off (`DONE`) | **13** (all of E0) |
| Tickets in review | **43** |
| Story points built | **280 of 522** |
| HTTP endpoints (API surface) | **215+** (190 documented paths in the generated OpenAPI spec) |
| Integration tests | **630 across 68 files — all green** |
| Unit tests | **273** (API 133, business rules 134, contracts 6) |
| Database tables (Prisma models) | **75** |
| Database migrations | **4** |
| Backend modules | **23 areas, 45 controllers, 61 services** |
| TypeScript code | **248 files, ~29,300 lines** |
| Lint / typecheck / build | **clean** |
| Runbooks (what-to-do-when-X-breaks) | **6** |

### 4.2 Which module is how big

| Module | Lines | Module | Lines | Module | Lines |
|---|---|---|---|---|---|
| booking | 2,937 | identity | 1,212 | notification | 633 |
| payment | 1,560 | verification | 1,244 | conduct | 647 |
| provider | 1,071 | complaints | 905 | platform | 507 |
| plans | 910 | catalogue | 787 | search | 561 |
| admin | 576 | reputation | 322 | finance | 398 |

The size tells the story: **booking** and **payment** are the two biggest pieces, which is
exactly right — that is where the money and the rules live.

### 4.3 Feature-by-feature, in plain English

**E0 — Foundation**
Monorepo with five workspaces (API server, background worker, shared contracts, database,
pure business rules). PostGIS 16 + Redis 7 in Docker. Versioned database migrations. A
deterministic seed (same fake data every time, so tests are repeatable). Shared type
contracts and error codes so the frontend cannot invent its own. NestJS 11 on Express 5.
Platform services: settings cache, audit log, idempotency (so a double tap on "Pay" cannot
charge twice), and an outbox (reliable event delivery). Register / OTP / login / sessions /
refresh-token rotation. Staff two-factor (TOTP) plus a role-permission guard. Integration
ports with working mock gateways. GitHub Actions CI with four jobs.

**E1 — Onboarding**
Service catalogue with admin CRUD, fast cached public reads, and a **commission
precedence** rule (some services earn more than others; the rule that decides which wins is
pure and tested). Customer profile, addresses, favourites, deactivate. Provider onboarding
with penalty-schedule acceptance. Provider documents stored in an **AES-256-GCM encrypted
vault** for the national ID (CNIC) with an **HMAC blind index** for searching it — so we can
find a record without ever storing the ID in readable form. Admin approval **hard-gated on a
verified CNIC**, with an approve/reject audit row and a provider wallet minted on approval.
Admin screens for users, roles, customers, audit, staff conflicts and settings. A slot
generator for availability.

**E2 — Doing the job**
A booking state machine with one single function (`BookingStateService.apply()`) that all
status changes must go through. Quotes and checkout (cash and online, with a signed webhook,
capture, abandonment handling, and a real answer when the gateway says "slot already taken").
Offers with an auto-assign cascade. Cancel / reschedule / provider-cancel / no-show, with the
business-rule grace window and a **full escrow refund on no-show**. Masked in-booking chat
(phone numbers hidden both ways). Job execution: depart, OTP to start work, photo evidence,
checklist. Revised quotes and top-ups for extra parts. Completion → invoice → waiting for
verification → notification dispatch. Money-safety and concurrency tests. Same-day booking,
next-hour booking, booking on behalf of someone else (e.g. a relative), common-faults
dropdown, completion notes.

**E3 — Checking & paying**
Tier routing R1–R10 (how hard each job is to verify). A verification queue with SLA timers
and claim-locking so two agents cannot grab the same job. An agent console. Submission and
release posting. Rework loop. An "unreachable customer" link, a 72-hour automatic release
(now correctly blocked by unresolved complaints) and Tier B escalation. Cash settlement with
a debt ceiling. Finance API: escrow, refunds, and payouts with an **advisory-lock race fix**
(two simultaneous payouts for the same provider could previously double-pay). Nightly
reconciliation including `NO_SHOW` and `PAYOUT_CLEARING` sweeps. Reputation projector,
badges and remarks. Call-recording access control and retention rules.

**E4 — Trust & communication**
Complaints. Disputes. A conduct engine (penalties, demerit points, thresholds). Appeals and
reversals. A daily conduct job (demerit decay, 180-day expiry, suspensions). **All six
automatic breach triggers**, including falsified-evidence detection — where two false-positive
detectors were found and fixed. A notification planner that refuses to send an incomplete
message (the guard is derived from the source templates, not hand-maintained).

**E5 — Depth & release**
Maintenance plans: subscribe, deferred revenue per subscription, a daily scheduler, and
pro-rata cancellation. Asynchronous reports with real PDF and XLSX output. An operations board
with a live stream. Hardening: Prometheus `/metrics`, 8 alert rules, Sentry error scrubbing,
Content-Security-Policy nonces, a ZAP security scan job, and index work driven by `EXPLAIN`
plans. Backup and restore scripts plus 5 operational runbooks including a full restore drill.
A 10,000-provider load dataset and a k6 load harness. Search filters, and the three ranking
weights that were dead code now wired up.

---

## 5. How do we know it actually works? (quality evidence)

This is the part we should be most confident about, because these are checked by machines,
not by opinion.

### 5.1 Test coverage
- **630 integration tests across 68 files** (up from 248 at the start of this phase).
- **273 unit tests** on the pure business rules.
- Several tests are **mutation-verified** — we deliberately break the code to prove the test
  actually catches the bug, rather than just passing.

### 5.2 Money cannot be corrupted
Money is protected at **four independent layers**, so a mistake has to get past all four:
1. API contracts accept money as `bigint` only.
2. Business-rule package has paisa conversion helpers.
3. **ESLint bans** `Number()` on any money value — and a fixture test proves each ban fires.
4. The database stores money in `bigint` columns.

### 5.3 Booking status cannot be corrupted
`bookings.status` is guarded at **three layers**: the state-service convention, a database
trigger (`trg_booking_status_guard`), and ESLint rules that catch even raw SQL writes.

### 5.4 The database model matches the documentation
CI builds the schema **twice** — once by replaying every migration, once by applying the
documented `schema.sql` — then diffs the live database catalogues (**1,312 objects**). If the
code and the documentation disagree, CI fails.

### 5.5 No stray work markers
Zero `TODO` / `FIXME` / `XXX` / `HACK` markers across 374 scanned backend source files.

### 5.6 API cannot drift silently
A committed `api-surface.baseline.json` is compared in CI, so nobody can change or remove an
endpoint without the pipeline noticing.

### 5.7 Automated checks that exist
- **Lint** — clean across all 5 workspaces
- **Typecheck** — clean across all 5 workspaces
- **Unit tests** — 273 passed
- **Integration tests** — 636 passed against a freshly migrated and seeded database (13 Oct)

---

## 6. What changed in the project since the last review

### 6.1 The big change: the release build now exists

| Area | What is new since the last review |
|---|---|
| **Containers & deployment** | Multi-stage, non-root Docker images for **API**, **worker** and **migrate**. A production Docker Compose file. A GitHub Actions workflow that builds images and tags them to a registry on a git tag. **All three images were built and booted locally against a seeded PostGIS/Redis.** This is SHM-094 moving from "not started" to "in review". |
| **Reports** | Real PDF and Excel generation, running as background jobs with a `report_runs` table, plus two new migrations. |
| **Operations board** | An internal dashboard API with a live event stream (SHM-091). |
| **Monitoring** | Prometheus `/metrics` endpoint, a worker metrics port, 8 alert rules, and Sentry error scrubbing. |
| **Security** | CSP nonces; a fix so `/api/docs` (Swagger) renders instead of showing a blank page; the ZAP scan job pinned to a commit SHA for reproducibility. |
| **Payments (dev only)** | The mock gateway's Pay and Fail links now actually work when clicked — you can demo the full payment flow end to end without a real gateway. |
| **Bookings** | `canConfirmCashReceived` flag on the booking row, and an endpoint so a customer can retrieve their start code on their own screen. Both traps are now documented in the code. |
| **Load & performance** | 10,000-provider seed dataset, k6 load harness, and a real measurement of the search endpoint. |
| **Backups** | Backup and restore scripts plus a full restore drill. |

### 6.2 New defects we found and fixed while doing that work
- **Schema documentation was out of date** after the `report_runs` migration — corrected.
- **Metrics tests were flaky** — the allowlist depended on whether a garbage-collection had
  happened. Now deterministic.
- **Two false positives** in the falsified-evidence detector — a false accusation against a
  tradesman would have caused an automatic penalty. Fixed, plus new HTTP-surface tests.
- **Swagger rendered blank** because our own Content-Security-Policy blocked its scripts.
- **Money bug class**: a `Number()` call on a paisa value could have lost precision — the
  lint ban and a sweep across the codebase removed every instance.

### 6.3 A correction to something we told you before
The first k6 load test reported a **fake 105 ms response time**. 90% of the requests had
actually been rejected with `429 Too Many Requests`. The corrected measurement is
**49.7 requests/second at 400.3 ms p95** against an 800 ms budget. We are telling you this
because the first number looked much better than reality, and we would rather report the
truth than a flattering graph.

---

## 7. What is NOT finished (the honest list)

### 7.1 Real code gaps

| Item | State | Effort | Why it matters |
|---|---|---|---|
| **No real-time channel** (no WebSockets) | Providers *poll* for offers; agents *poll* for queue; chat uses a queued event | 3–5 days | Slower and drains phone battery. Three tickets carry an unticked "definition of done" purely because of this. |
| **Background worker has zero tests** | The worker runs **17 repeatable jobs** and all the schedulers — none are exercised by tests | 1–2 days | The cheapest way to find a silent breakage before a customer does |
| **Booking state machine is a subset** | 10 statuses / 11 events, not the full 22-state matrix; no property test | 2–3 days | Post-verification states were deferred and never folded back in |
| **Auto-assign ignores ranking weights** | Offers are ordered by distance only, even though ranking weights exist | 0.5 day | The requirement says "offer to *ranked* candidates" — currently it is distance under another name |
| **`provider_stats` table never created** (SHM-063) | Ranking weights are recomputed on every read | 1–2 days | Wasted database work on every search |
| **Notification gaps** (SHM-081) | Retry/backoff, SMS delivery receipts, template CRUD + preview, admin screen, Urdu fallback | 2–3 days | Messages can be lost or never translated |
| **`fineFor` job-value cap bug** (SHM-077) | When there is no booking, the cap collapses to the maximum fine | 0.5 day | Automatic penalties outside a booking are effectively uncapped |
| **180-day expiry boundary not pinned** | The test clock uses real elapsed time so `<= now` and `< now` cannot be told apart | 0.5 day | Needs a fully deterministic test clock |
| **Search & ranking ticket SHM-035** | Work is done and measured, the ticket card is just not closed | 0.5 day | Bookkeeping, not engineering |
| **Workmanship warranty (FR-EX-07)** | Document says one thing, code says another | 0.5 day | Needs a decision, not more code |

### 7.2 Gaps that are not code

| Gap | Who fixes it |
|---|---|
| **CI has never run on a real pull request.** The workflow exists and its 4 jobs are sound; we ran the integration job's suite locally and it passed 636/636. But no GitHub run has ever been observed. | Repo admin — open one PR |
| **Branch protection is off.** `quality` and `integration` are not required checks, so a failing PR could still be merged. | Repo admin — one GitHub setting |
| **Security scan (ZAP) never actually run** against a deployed system; marked "continue on error" | Needs a deployed target |
| **Alert rules never fired.** 8 rules written, nothing to fire them in. | Needs a staging environment |
| **Backend/frontend contract mismatch**: `GET /me/subscriptions` returns `visitCount`, the frontend expects `totalVisits` | Backend + frontend agreement |

### 7.3 ⚠️ The single biggest risk: finished work that only exists on one laptop

`git status` currently shows **4 modified files and 11 untracked paths** — including the
whole container/deploy pipeline, the production compose file, the Prometheus configuration,
the deployment runbook and CI secrets template.

**Risk in plain English:** if anyone runs a stray `git checkout .`, switches branches, or has a
failed stash, a month of reviewed, tested work disappears with **no copy on the server**. This
is a one-command fix and it should be the first thing we do.

---

## 8. Decisions we need from the product owner

These have been open since **21 Sep** and no amount of engineering will close them. We need
a decision, or we stay blocked.

| ID | Question | What we built meanwhile | If it stays open |
|---|---|---|---|
| **OQ-03** | Which payment gateway? (JazzCash, Easypaisa, Stripe…) | Mock gateway | Real online payments cannot start |
| **OQ-04** | Which SMS / WhatsApp provider? | Mock gateway | Real SMS/OTP cannot start |
| **OQ-01** | Who collects cash — provider or platform? | Provider collects after release | Two features rest on an assumption |
| **OQ-02** | Final list of breach categories and penalties | SRS §8.2, "harsher rule wins" | Penalty behaviour is provisional |
| **OQ-05** | Real fee and threshold values | Seeded placeholder numbers | All money figures in the demo are fictional |
| **OQ-06** | Do providers pay a security deposit? | No deposit | If yes, no ticket exists yet |

**Technical detail worth knowing:** the configuration schema currently **rejects any payment
or SMS provider other than "mock" — in every environment, including production**. This is
deliberate, so we cannot accidentally go live with a fake gateway. Relaxing it is one schema
change, because the adapters already sit behind ports.

**One contradiction to resolve:** the specification targets **50 requests/second** for search,
but the global per-IP rate limit allows **5 requests/second**. Both describe the same setting
and they differ by 10×. We deliberately did **not** just raise the limit. Options: (a) give
search its own read-only budget per user, (b) lower the requirement to what one address can
realistically serve, (c) measure the target across many source IPs and keep the per-IP cap
purely as an abuse guard.

**One process blocker:** **no frontend lead has been assigned.** This is outside the backend,
but it blocks all five phase exit gates. Assigning a frontend lead unblocks more than any
backend task on this list.

---

## 9. Recommended next steps, in order

### Do today — risk removal, no decisions needed
1. **Commit and push the whole working tree and open a PR.** Also the only way to ever see CI
   run on a real PR.
2. **Turn on branch protection**, marking `quality` and `integration` as required. One setting.
3. **Tidy the tracker** — it still shows SHM-090 to 093 as TODO even though they are done, has
   duplicate cards, and quotes four different test counts on four different dates. Also mark
   `TASKS_BACKEND.md` as archived so nobody plans from it — it is materially out of date.

### This week — close the honest remainder
4. Close SHM-035. The work is done; the paperwork is lagging.
5. File the two unticketed defects properly: auto-assign must use ranking weights; create
   `provider_stats`.
6. Fix `fineFor`'s job-value cap and add the missing test.
7. Make the test clock deterministic, then pin the 180-day expiry boundary exactly.
8. Wire `db:reset` to flush the settings cache (a reset that is not a reset causes false
   readings) and prove it with the mutation check that caught it.
9. Write a worker test suite that boots all 17 jobs against a live Redis.
10. Decide the real-time question: build WebSockets for offers / agent queue / chat, **or**
    change the three "definition of done" items that depend on it. Right now three tickets
    cannot meet their own definition of done.

### Blocked — needs escalation
11. OQ-03 and OQ-04 (gateway, SMS provider) plus the config change that makes a non-mock
    provider legal in production.
12. The 50 rps vs. 5 rps contradiction — pick option (a), (b) or (c).
13. Name a frontend lead.

### To release
14. Finish SHM-094: container images, tag-based deploy, and a staging host.
15. Run the ZAP baseline scan, commit the reviewed baseline, and stop ignoring its failures.

---

## 10. Meeting Q&A cheat sheet

**"Is the backend finished?"**
The feature surface is essentially complete — 53 of 60 tickets, all of E0–E4 built and
reviewed. It is not *releasable* yet: real payment and SMS providers are still undecided,
there is no staging environment, and one ticket is unfinished.

**"How do we know it is not full of bugs?"**
903 automated tests (630 integration + 273 unit), clean lint and typecheck, and money and
booking-status rules enforced in four and three independent layers respectively. The database
schema is diffed against its own documentation in CI across 1,312 objects.

**"What is the biggest technical risk?"**
Uncommitted work on one machine. Second is the absence of a real-time channel, which is
currently causing three tickets to fail their own completion criteria.

**"Can we demo it?"**
Yes — the mock payment gateway now works end to end, so Pay and Fail can be clicked through
in a demo. But remember all money figures are placeholder values until OQ-05 is decided.

**"What did we get wrong that we should own?"**
The first load test reported a fake 105 ms response time because 90% of requests were being
rate-limited away. Also, the automatic falsified-evidence detector had two false positives,
which could have penalised an innocent tradesman. Both are fixed; both are the kind of thing
we now test for specifically.

**"What is the single most valuable thing the product owner can do today?"**
Commit and push the working tree, and assign a frontend lead. The first protects a month of
finished work; the second unblocks all five phase gates.

**"When can we go live?"**
Not before a staging environment exists, the ZAP scan has run, the alert rules have actually
fired once, the real payment/SMS providers are chosen, and CI has been observed on a real
pull request with branch protection on. Those are the gates — not more feature code.

---

## Appendix A — Sources

| Document | What it is |
|---|---|
| `docs-final/README.md` | Index of the documentation set |
| `docs-final/SRS.md` | Software Requirements Specification v2.1 — the requirements of record |
| `docs-final/TRD.md` | Technical design |
| `docs-final/ERD.md` + `schema.sql` | Data model |
| `docs-final/PROGRESS_TRACKER.md` | Live ticket tracker (260 KB — the working source of truth) |
| `docs-final/TASKS_BACKEND.md` | **Stale** — superseded by the tracker; do not plan from it |
| `docs-final/API_HANDOFF.md` + `openapi.json` | Frontend handoff and the generated API spec |
| `docs-final/BACKEND_STATUS_REPORT.md` | The detailed engineering status report this pack is summarised from |
| `docs-final/runbooks/` | 6 operational runbooks (API down, gateway down, queue backlog, reconciliation drift, restore drill, deploy) |

## Appendix B — Repository layout

| Path | Contents |
|---|---|
| `apps/api` | The backend server (23 module areas, 45 controllers, 61 services) |
| `apps/worker` | Background worker — reminders, nightly reconciliation, schedulers |
| `packages/contracts` | Shared names, types and error codes |
| `packages/db` | Migrations, schema, seed data, backup/restore scripts |
| `packages/domain` | Pure business rules with no framework (booking steps, money, working hours) |
| `infra/` | Docker Compose for local development and for production, Prometheus config |
| `ops/` | Alert rules and Prometheus scrape config |
| `k6/` | Load-test harness and results |
| `docs-final/` | All requirements, design and status documentation |
| `test/`, `*.test.ts` | Integration test suites |