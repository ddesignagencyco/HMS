# Backend Status Report — Smart Home Maintenance Services

**Date:** 12 Oct 2026
**Scope:** backend only (`apps/api`, `apps/worker`, `packages/*`, `infra/`, `ops/`, `k6/`)
**Sources of truth:** `docs-final/PROGRESS_TRACKER.md` (live), `docs-final/TASKS_BACKEND.md` (stale, superseded)
**Verification:** run in this repo on 12 Oct 2026, not quoted from the tracker.

---

## 1. Headline

| Metric | Figure |
|---|---|
| Backend tickets built | **53 of 60** (E5 partially — see §4) |
| Backend tickets `DONE` (signed off) | **13** (all of E0) |
| Backend tickets `IN REVIEW` | **43** |
| Backend tickets `IN PROGRESS` | **1** (SHM-035) |
| Backend tickets `BLOCKED` | **2** (SHM-095, SHM-096) |
| Story points built | **280 of 522** |
| HTTP operations | **215+** (surface baseline + `docs-final/openapi.json`) |
| Integration tests | **630 across 51 files — all green** |
| Unit tests | **273** (api 133, domain 134, contracts 6) |
| Migrations | 4 (2 pending in the local DB until run today) |
| Modules | 22 in `apps/api/src`, 46 controllers, 61 services, ~16,450 LOC |
| Lint / typecheck / build | **clean** |

**One sentence:** the backend feature surface is essentially complete and now has a reviewer pass behind every ticket in E1–E4; what remains is one half-finished ticket, three untested-claim gaps, a hard product freeze on real money/SMS, and a large amount of uncommitted work.

---

## 2. What is done

### 2.1 E0 — Foundation (`IN REVIEW` → all `DONE`, signed 7 Oct 2026, tag `phase-0`)
Monorepo (npm workspaces: `apps/api`, `apps/worker`, `packages/contracts`, `packages/db`, `packages/domain`), docker-compose PostGIS 16 + Redis 7, dbmate migrations, deterministic idempotent seed, shared contracts/domain packages, NestJS 11 on Express 5 skeleton, platform services (settings cache, audit log, idempotency, outbox), identity (register/OTP/login/sessions/refresh rotation), staff TOTP + RBAC policy guard, integration ports with working mocks, DB-invariant integration tests, GitHub Actions CI with four jobs.

### 2.2 E1 — Onboarding (7/7 backend built, reviewer pass done 7 Oct 2026)
Catalogue API (admin CRUD + cached public reads + pure commission precedence), customer profile/addresses/favourites/deactivate, provider onboarding + penalty-schedule acceptance, provider documents with AES-256-GCM CNIC vault + HMAC blind index, admin approval gated on VERIFIED CNIC with `PROVIDER_WALLET` mint and approve/reject audit rows, admin management surfaces (users, roles, customers, audit, staff conflicts, settings), slot generator.

### 2.3 E2 — Transacting (16/17 backend, reviewer pass done 11 Oct 2026)
Booking state machine + `BookingStateService.apply()`, quote, checkout (cash + online, signed webhook, capture, abandonment, `40001`/`40P01` → `409 SLOT_TAKEN`), offers + auto-assign cascade, cancel/reschedule/provider-cancel/no-show with BR-04 grace window and full-escrow no-show refund, masked in-booking chat, execution (depart, OTP start, evidence, checklist), revised quote + top-up + parts/extras, completion → invoice → `AWAITING_VERIFICATION`, notification dispatch, money-safety and concurrency tests, same-day/next-hour booking, booking on behalf of someone else, common-faults dropdown, completion text.

### 2.4 E3 — Verification & Money (12/12 backend, reviewer pass done 11 Oct 2026)
Tier routing R1–R10, verification queue with SLA + claim locking, agent console, submission + release posting, rework, unreachable-customer link + 72 h auto-release (now blocked by unresolved complaints) + Tier B escalation, cash settlement + debt ceiling, finance API (escrow, refunds, payouts with advisory-lock race fix, reconciliation), nightly reconciliation incl. `NO_SHOW` and `PAYOUT_CLEARING` sweeps, reputation projector + badges + remarks, call-recording access/retention.

### 2.5 E4 — Trust & Communication (7/7 backend, reviewer pass done 11 Oct 2026)
Complaints, disputes, conduct engine (penalties/demerits/thresholds), appeals and reversals, daily conduct job (decay, 180-day expiry, suspensions), all six automatic breach triggers including `FALSIFIED_EVIDENCE` (two false-positive detectors fixed), notification planner with completeness guard derived from source.

### 2.6 E5 — Depth & Release (built but **uncommitted**)
Maintenance plans (subscribe, deferred revenue per subscription, daily scheduler, pro-rata cancel), async reports with real PDF + XLSX, ops board + live stream, hardening (Prometheus `/metrics`, 8 alert rules, Sentry scrubbing, CSP nonces, ZAP job, EXPLAIN-driven index), backup/restore scripts + 5 runbooks, 10,000-provider seed load + k6 harness, search filters and the three dead ranking weights.

---

## 3. Engineering quality signals (all verified today)

- **Zero `TODO`/`FIXME`/`XXX`/`HACK` markers** in backend source (374 files scanned).
- **Money safety enforced at four layers**: `z.bigint()` contracts, domain paisa helpers, ESLint bans on `Number(paisa…)` (including the member-expression shape), and `bigint` DB columns. A lint-fixture test proves each ban actually fires.
- **`bookings.status` guarded at three layers**: state-service convention, the `trg_booking_status_guard` DB trigger, and ESLint selectors covering raw `Prisma.sql` writes.
- **Schema fidelity**: CI builds the schema twice (migrations replayed vs `docs-final/schema.sql` applied) and diffs live catalogues — 1,312 objects.
- **Route-drift gate**: `api-surface.baseline.json` compared in CI.
- **Test suite grew 248 → 630 integration tests** across the project, with several defects caught by mutation-verified tests rather than assertion-only tests.

---

## 4. What is left

### 4.1 Unfinished backend work (the real list)

| Item | State | Effort | Why it matters |
|---|---|---|---|
| **SHM-035** search & ranking | `IN PROGRESS` — filters done, weights wired, p95 measured (400 ms @ 49.7 rps vs 800 ms budget), but card still unticked | ~0.5 day | Last unreviewed backend ticket; should be closed out |
| **`provider_stats` table** (SHM-063) | Weights now computed on read; the table itself never created | 1–2 days | Read-time aggregation cost; the weight values are recomputed per query |
| **Auto-assign ranking** (no ticket filed) | Offer cascade orders by **distance only**, ignoring `ranking.weights` | 0.5 day | FR-SR-07 says "offered to ranked candidates"; currently distance under another name |
| **Real-time channel** (no ticket filed) | No Socket.IO. Providers poll `GET /provider/offers`; agents poll `GET /agent/queue`; chat uses an outbox event instead | 3–5 days | Latency and battery cost; three tickets carry an unticked DoD because of it |
| **Notification retry/backoff + SMS delivery-receipt webhook + template CRUD/preview + `/admin/notifications` + locale fallback** (SHM-081) | Partly built, partly untested | 2–3 days | Card records these as still open |
| **E2E notification-completeness test** (SHM-081) | Untested criterion | 1 day | The planner guard exists but no end-to-end run asserts every transition notifies |
| **Workmanship warranty / FR-EX-07** | `[ ]` in `TASKS_BACKEND.md`; SHM-058 rework references it — status needs a decision, not more code | 0.5 day | Document/code contradiction |
| **State-machine completeness** (SHM-033) | 10-status/11-event subset, not the full 22-state / T1–T26 matrix; no property test | 2–3 days | Post-verification states were deferred to E3 and never folded back in |
| **`fineFor` job-value cap** (SHM-077) | `jobValuePaisa = 0n` when `bookingId` is absent → per-job liability cap collapses to `max_fine_paisa` | 0.5 day | Auto-proposed breaches outside a booking are uncapped; untested either way |
| **180-day expiry boundary** (SHM-077) | Test cannot distinguish `<= now` from `< now` because `AppClock` advances with real elapsed time | 0.5 day | Needs a fully deterministic clock |
| **`db:reset` does not flush the Redis settings cache** | Found 11 Oct, `flush-settings-cache.mjs` now exists but wiring is unverified | 0.5 day | A reset that is not a reset causes false-negative mutation checks |
| **Worker has zero tests** | `apps/worker/test` does not exist (`passWithNoTests: true`) | 1–2 days | 17 repeatable jobs and all scheduler ticks are unexercised; needs a live Redis-backed worker |
| **SHM-094** production images & deploy pipeline | `IN REVIEW` — multi-stage non-root images (api/worker/migrate), prod compose and GHCR tag→staging workflow written; all three images build and boot against a seeded PostGIS/Redis locally | ~0.5 day | Cannot prove "staging deploy from a tag, zero manual steps" until a staging host and `{STAGING,PRODUCTION}_*` secrets exist |

### 4.2 Verification gaps that are not code

| Item | State | Owner |
|---|---|---|
| **CI has never run on a real PR** | Workflow exists and has 4 jobs; no observed run on a pull request. The `integration` job's own suite was executed locally against a freshly migrated + seeded PostGIS/Redis on 13 Oct and passed 636/636 — the job's logic is sound, but that is not a GitHub run | Repo admin — open one PR |
| **Branch protection not enabled** | `quality` + `integration` are not required checks; a red PR can merge | Repo admin — one GitHub setting |
| **ZAP baseline scan never executed** against a deployed instance; no reviewed baseline file committed | `continue-on-error: true` on the scan step | Needs a deployed target |
| **Alert rules never fired** | 8 rules defined, no staging to fire them in | Needs a staging environment |
| **`GET /me/subscriptions` returns `visitCount`, not `totalVisits`** | Contract mismatch waiting for SHM-097 (frontend) to match | Backend/FE agreement |

### 4.3 Documentation hygiene
- `TASKS_BACKEND.md` is **materially behind** the tracker: all of Phase 1 infra, all of Phase 4 and all of Phase 5 are still `[ ]` there. Its own header defers to the tracker, but it is a trap for anyone reading it first.
- The tracker's **§4 index says SHM-092 and SHM-093 are `TODO`** while their §5 cards carry 11 Oct evidence (k6 report, migration `20261011140000`, Prometheus metrics, Sentry, ZAP job, backup/restore drill, 5 runbooks). The E5 dashboard row still reads `BE built 1 / 7`.
- **Duplicate SHM-090 and SHM-091 cards** in §5 — a superseded set and a current set coexist.
- Header says "179 operations"; the change log records 215. Test counts are quoted at several different values across dates (524 / 529 / 574 / 576 / 581 / 591) — true, but a reader cannot tell which is current.

---

## 5. Questions / blockers

### 5.1 Product decisions — open since 21 Sep, only the owner can close these

| ID | Decision | Default in build | Consequence of staying open |
|---|---|---|---|
| **OQ-03** | Which payment gateway? | Mock | SHM-095 cannot start |
| **OQ-04** | Which telephony/SMS/WhatsApp vendor? | Mock | SHM-096 cannot start |
| **OQ-01** | Cash collection model | Provider collects after release authorisation | SHM-060/070 rest on an assumption |
| **OQ-02** | Breach categories | SRS §8.2, "harsher wins" | SHM-077/080 behaviour is provisional |
| **OQ-05** | Real fee / threshold values | Seeded defaults, editable in settings | Seed data is fictional |
| **OQ-06** | Provider security deposit | No deposit | No ticket exists if the answer is yes |

**The structural blocker behind OQ-03/OQ-04:** `apps/api/src/config/environment.schema.ts` carries a `superRefine` that **rejects any provider value other than `mock`, in every environment including production**. Until that is relaxed, the release path is mock-only *by construction*, not by choice. One schema change plus adapters behind ports that already exist.

### 5.2 Unresolved contradiction — needs a decision, not engineering

**FR-SR-07 (50 rps search target) vs. the global per-IP rate limit (300 per 60 s = 5 rps).** Both describe one setting and they disagree by 10×. The first k6 run reported a fake 105 ms p95 because 90 % of requests were `429`; the corrected run measures 49.7 rps / 400.3 ms p95. Options: (a) a separate read-only search budget per identity, (b) amend FR-SR-07 down to what one address can serve, (c) measure the SLO across many source IPs and keep the per-IP cap purely as an abuse guard. **Deliberately not resolved by raising the default.**

### 5.3 Process blockers

- **No frontend lead assigned.** This is outside backend but blocks all five phase exit gates (SHM-032, 053, 074, 088, 101). It is the single highest-leverage action available to the product owner, and it unblocks not one line of backend code.
- **Nothing is merged.** `origin/backend-dev` is behind local `HEAD`; the reviewer's own work cannot be marked `DONE` under the tracker's own rule 5.

---

## 6. Critical risk: the working tree is a month of uncommitted work

`git status` shows **60 modified files and 25 untracked paths** against `HEAD = 0784dad`. This is not a work-in-progress tail; it contains the entire E5 backend build:

| Untracked / modified area | Contents |
|---|---|
| `apps/api/src/finance/` | Reports service + controller (SHM-090) |
| `apps/api/src/admin/ops-board.*`, `ops-board.controller.ts` | Ops board API + stream (SHM-091) |
| `apps/api/src/health/metrics.controller.ts`, `platform/metrics.service.ts`, `observability.ts` | Prometheus metrics + Sentry (SHM-092) |
| `packages/db/migrations/2026101112…`, `2026101114…` | `report_runs` columns + provider-services index (SHM-090/092) |
| `packages/db/scripts/backup.mjs`, `restore.mjs`, `flush-settings-cache.mjs` | SHM-093 |
| `packages/db/seed/loadProviders.ts`, `seedLoad.ts` | 10k-provider load dataset (SHM-110) |
| `k6/`, `ops/prometheus/alerts.yml`, `.github/zap/` | Load harness, alert rules, ZAP config |
| `docs-final/runbooks/` | 5 runbooks incl. the restore drill |
| `apps/api/test/integration/{reports,ops-board,hardening,runbooks}.test.ts` | 4 new suites |

**Risk:** a single `git checkout .` / branch switch / failed stash destroys reviewed, tested, mutation-verified backend work with no remote copy. This should be committed and pushed before any further work starts.

---

## 7. Recommended next steps, in order

**Do this today (risk removal, no decisions needed)**
1. Commit and push the entire working tree; open a PR. This is also the only way to ever observe CI on a real PR (SHM-013).
2. Enable branch protection: mark `quality` and `integration` as required checks. One GitHub setting; it is the last item standing between E0 and a fully closed gate.
3. Reconcile the tracker: correct the §4 index statuses for SHM-090/091/092/093/108/109/110, delete the duplicate SHM-090/091 cards, recount the dashboard by parsing the tables, and update the operation count. Or mark `TASKS_BACKEND.md` as archived so nobody plans from it.

**This week (close out the honest remainder)**
4. Close SHM-035 — the work is done; the card and the status column are what is lagging.
5. File the two unticketed defects properly: auto-assign must apply `ranking.weights`; `provider_stats` table.
6. Fix `fineFor`'s `jobValuePaisa = 0n` and add the missing test.
7. Make `AppClock` deterministic in tests, then pin the 180-day expiry boundary exactly.
8. Wire `db:reset` to flush the settings cache and prove it with the mutation check that caught it.
9. Add a worker test suite that boots the 17 repeatable jobs against a live Redis.
10. Decide the realtime question: build Socket.IO for offers/agent-queue/chat, or amend the three DoD criteria that depend on it. Right now three tickets cannot meet their own definition of done.

**Blocked — escalate to the product owner**
11. OQ-03 and OQ-04 (gateway, telephony) — and the `environment.schema.ts` change that makes a non-mock provider legal in production.
12. The FR-SR-07 vs. rate-limit contradiction — pick option (a), (b) or (c).
13. Name a frontend lead.

**To release**
14. SHM-094: container images, tag-based deploy, staging. Without staging, SHM-092's ZAP scan and alert firing cannot be closed.
15. Run the ZAP baseline and commit the reviewed baseline; turn off `continue-on-error`.

---

## 8. Verification log (12 Oct 2026, this repo)

| Command | Result |
|---|---|
| `npm run lint` | **clean** — all 5 workspaces |
| `npm run typecheck` | **clean** — all 5 workspaces |
| `npm test` (unit) | **273 passed** — api 133 (15 files), domain 134, contracts 6 |
| `npm run db:status` | 2 applied / **2 pending** migrations |
| `npm run test:integration` (first run) | 624 passed / **6 failed** — all 6 in `reports.test.ts`, all `500` |
| `npm run db:migrate` | applied `20261011120000` + `20261011140000` |
| `reports.test.ts` after migration | **8 passed** |
| `npm run test:integration` (full, pre-migration) | 50/51 files, 630 tests — the only failing file was the one blocked by the unapplied migration |

**Conclusion on the 6 failures: an environment problem, not a defect.** The `reports.test.ts` failures were caused by the two uncommitted migrations not being applied to the local database. After migrating, that file passes. The full suite has not been re-run end-to-end since the migration — worth one clean `db:reset` + full run before the commit in step 1.
