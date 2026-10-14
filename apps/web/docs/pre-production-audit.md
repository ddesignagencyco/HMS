# Pre-Production Audit — HMS Web

**Date:** 2026-10-14 · **Branch:** `feat/web-frontend-integrations` (uncommitted work on top of `730b092`) · **Scope:** `apps/web` only. Nothing outside `apps/web` was modified (checked with `git status`).

Companion documents: `view-test-matrix.md` (every route), `api-coverage-audit.md` (every API operation), `backend_requirement.md` (BE-001…BE-034).

---

## A. Release decision: **NOT READY**

The web application is substantially better than at the start of the audit, and every frontend defect reproduced in the browser has been fixed. It still cannot ship, for four reasons, **three of which the frontend cannot fix**:

1. **Backend P0s block core journeys** (`backend_requirement.md` BE-001…BE-005 and BE-016):
   - **Job, complaint, dispute and verification photos all 404 under Supabase storage.** The verification agent can't see the evidence they're required to check.
   - **The customer's "Confirm the work" form can be submitted again after an escalation**, which releases money on a case under review.
   - **An online booking whose payment page was lost can never be paid.** There's no retry endpoint, so the customer is stranded in "Awaiting payment". The web says so honestly and offers cancel.
   - **Public search reveals a customer's saved location** to anyone holding the address id.
   - **Plan subscriptions are active before payment.**
   - **Opening the admin/finance ops board crashed the entire API process** (BE-016, found in the staff pass). The web no longer opens that stream; the backend still needs fixing before anyone re-enables it.
2. **Admin and finance (29 routes) are now verified in the browser** after TOTP was re-enrolled for the dev accounts: 38/38 checks passed (desktop · en). Their 360px/Urdu layouts were not re-checked.
3. **The online-payment journey was not runtime-verified.** The test provider's service fell into re-approval mid-run (caused by the audit, now guarded against — see D-P1 below), and no other bookable provider exists in the dev data.
4. **The API went down twice during testing.** At least part of the "500 under load" (BE-017) was the BE-016 crash; re-test once that's fixed.

**Ready for:** an internal demo of the cash booking flow, customer/provider portals and agent console. **Not ready for:** real customers or real money.

---

## B. Coverage (actual counts)

| Measure | Count |
|---|---|
| Routes discovered (`page.tsx` files) | **78** |
| Routes exercised in a browser | 77 (all except `/checkout/return`) |
| — PASS / PASS after fix | 64 |
| — load-verified only (actions covered by component tests) | 12 |
| — open defect | 1 (`/provider/messages` label clipped) |
| Not runtime-verified | 1 (`/checkout/return` — online payment journey) |
| Crawl visits (role × route × locale × viewport) | ~800 (quick matrix ~150 + full matrix CUSTOMER 154, PROVIDER 224, AGENT 42, ANON ~311 of 340) |
| User journeys run end to end in the browser | 10 (incl. admin + finance pass, 38/38): anon discovery · register+OTP · sign-in/returnTo/TOTP · CASH booking → accept → start code → photos → complete → confirm-the-work · provider screens · throwaway provider onboarding (18 steps) · agent claim/console/submit · map/dropdown stacking · responsive matrix |
| API operations inventoried | **225** in Swagger = 225 in the generated surface; **226** implemented (`GET /metrics` excluded from Swagger) |
| — integrated in the web | 207 |
| — not required by the UI | 13 (infra, webhooks, dev mock gateway/storage, alternative checkout) |
| — backend exists, no web screen | 5 (admin create category/service, checklist editor, issue-options editor, service-approval queue) |
| — contract mismatches remaining | 0 known (≈45 fixed in the preceding contract audit; see `PROJECT_PROGRESS.md`) |
| Backend requirements documented | 34 (BE-001…BE-034; 6 P0, 11 P1) |

### Defects found and fixed in this audit (browser-reproduced)

| Priority | Fixed | Outstanding (frontend) |
|---|---|---|
| P0 | 2 | 0 |
| P1 | 4 | 0 |
| P2 | 16 | 2 |
| P3 | 10 | 8 |

**P0**
- **Ops board crashed the API** (backend bug BE-016, frontend-triggered): opening `/admin/ops` or `/finance/ops` opened the SSE stream, which kills the API process. → The board polls the REST snapshot every 15 s, with a manual refresh, behind `LIVE_STREAM_AVAILABLE = false` (`features/admin/ops-board.tsx`). Test: `tests/admin/ops-board-stream.test.tsx`; browser check confirmed the API stays up.
- `formatMoney` rounded paisa away (Rs 1,912.50 shown as "Rs 1,913"; Rs 2.50 as "Rs 3") on every money screen. → Exact rupees and paisa (`lib/utils.ts`). Tests: `tests/shared/utils.test.ts`, `tests/plans/plans-views.test.tsx`.

**P1**
- **Password in the URL:** sign-in/register submitted before hydration put the identifier and password in the URL as a GET query. → Forms use `method="post"`, and the submit button stays disabled until hydrated (`features/auth/auth-fields.tsx` + 8 forms). Test: `tests/auth/submit-button.test.tsx`; browser A3.
- **One-click service removal:** "Stop offering" deleted an approved service in one click, and re-adding requires admin re-approval (this broke the test environment mid-run). → Confirmation step with a warning (`provider/services-view.tsx`). Test updated.
- **Pre-ticked consent:** the verification console's consent-line checkbox started ticked, recording a reading nobody did. → Starts unticked, and submit is blocked without it (`portal/verification-console.tsx`).
- **`/track` and anonymous visitors:** it fired authenticated reads (401 + refresh) for anonymous visitors. → Gated to customers (`discovery/track-booking.tsx`). Test: `tests/providers/track-booking-gate.test.tsx`.

**P2** (16):
- **Booking:** review step never showed the time, and slots were grouped on the browser's clock rather than Karachi's; "Complete" offered with checklist steps still open.
- **Auth:** `/auth/totp` stuck on a skeleton and showed the staff card to customers; phone field mangled typed numbers.
- **Discovery:**
  - forever skeletons on providers search with no location or an inverted price band, and the heading counted hidden cards;
  - services back/forward kept the old category;
  - duplicate form ids (labels pointing at hidden inputs);
  - hero search listed only plumbing.
- **Provider:**
  - out-of-band price errors in paisa, and an empty price sent as Rs 0;
  - wrong limit text (0–70 years, 1–100 km);
  - clearing the bio silently reverted;
  - leave errors shown in the wrong card;
  - overlapping availability windows saved;
  - payout ceilings shown in paisa and rounded.
- **Agent console:** no way to release a claimed call; silent claim failures and mislabelled stat cards.

**P3** (10):
- "Add a window" always picked Sunday.
- Document picker kept the old file name.
- No max length on reply/appeal boxes.
- Malformed provider id now returns not-found.
- Select focus ring.
- Disabled refinements panel made `inert`.
- Short phone flagged one submit late.
- Progress card listed a step never reached.
- `.gitignore` had two patterns glued together, so e2e screenshots weren't ignored.
- Dev password hardcoded as a fallback in three dev scripts (now required from the environment).

---

## C. Test results (exact commands, this run)

| Command (from `apps/web`) | Result |
|---|---|
| `npx tsc --noEmit` | **pass** — 0 errors |
| `npx eslint src --quiet` | **19 errors, all pre-existing** (every one blamed to an earlier commit: `any` in `location-map.tsx`/`phone-field.tsx`/`address-step.tsx`, `set-state-in-effect` in 4 files); **0 introduced** |
| `npx vitest run` | **pass** — final run: 68 files, 788 passed, 5 skipped, 0 failed (an intermediate run failed one test that pinned the old rounded money format; it was updated to the exact paisa values) |
| `npx next build` | **pass** — exit 0, "Compiled successfully in 110s", all routes generated (incl. the new `/finance/ops`, `/finance/reports`, `/provider/disputes`; redirects for `/v/:token` and `/problem/:token` registered) |
| Browser (playwright-core scripts, since removed) | ~840 route visits + 10 journeys; summarised in `view-test-matrix.md` |

---

## D. Outstanding risks

| ID | Severity | Where | Impact | Next action |
|---|---|---|---|---|
| BE-001…005 | P0 | backend | see §A | backend team |
| BE-016 | P0 | backend | ops-board stream crashes the API; live updates disabled in the web meanwhile | backend fix, then set `LIVE_STREAM_AVAILABLE = true` |
| Online payment journey | P0 (verification gap) | `/book`, dev gateway, `/checkout/return`, "Pay now" | false-success/dead-end paths unverified live (unit-tested) | the test provider is approved again — re-test the online booking path in the browser |
| Staff layouts | P2 (verification gap) | admin/finance at 360px and Urdu | not re-checked | responsive pass |
| BE-017 | P1 | API | intermittent 500 on sign-in under light concurrency | backend load test |
| FE-01 | P2 | `lib/api/client.ts` | two tabs refreshing together can sign each other out (with BE-027) | cross-tab lock (`navigator.locks`) around refresh |
| FE-02 | P2 | `components/site-header.tsx` | mobile nav drawer: Escape doesn't close it, no scroll lock, no focus trap, no `aria-expanded` | a11y fix |
| FE-03 | P3 | `/provider/messages` | message label clipped at every width | layout fix |
| FE-04 | P3 | unmatched `/{locale}/*` | Next's default unbranded English 404 | `[locale]/[...rest]/page.tsx` → `notFound()` |
| FE-05 | P3 | `features/auth/schemas.ts`, agent console | validation messages and agent console largely English-only on Urdu pages | translate |
| FE-06 | P3 | `features/auth/session.tsx`, deactivate | stale signed-in state if refresh fails after session check; deactivation doesn't clear the in-memory token | session hardening |
| FE-07 | P3 | various | small touch targets (agent queue buttons, password reveal, nav button); English-only aria-labels in catalogue filters | a11y polish |
| FE-08 | P3 | booking photo step | two sentences contradict each other ("uploaded with your booking" vs "add them once the booking exists") | copy |
| FE-09 | P3 | phone field | digits typed without `+` into a selected field guess another country | input handling |
| Not run | — | auth parts D–G, booking phases 2 | session/logout revocation, reset/change password, deactivation, profile/address CRUD, favourites, plans subscribe, bell, messages; NOT_ACCEPTABLE→escalated, reschedule, complaint, cancel paths | re-test these flows in the browser |

**Production-readiness checks (frontend):**
- No `dangerouslySetInnerHTML` and no `console.log` anywhere in `src`.
- `returnTo` goes through `safeReturnTo`; external and `//` URLs were rejected in the browser.
- `/dev/` URLs appear in comments only.
- `demo-impersonator-bar.tsx` is not imported anywhere (dead code, not shipped).
- The payment redirect URL is kept in `localStorage`. It's the gateway link, not a credential.

**Test-data side effects** (dev DB only, via the app's own API; no seeded data deleted):
- New bookings SHM-0000012 (SCHEDULED) and SHM-0000007 (moved to VERIFIED/CASH_DUE, with evidence added).
- SHM-0000009 submitted as DISPUTED by the agent.
- One remark reply on the test provider.
- Throwaway customer and provider accounts.
- agent2 enrolled in TOTP.
- The test provider's leak-repair service was withdrawn by an audit script, then **re-approved by admin** (state restored).
- **TOTP was reset and re-enrolled for `admin@` and `finance@smart-home.local` in the local dev DB** (with the owner's go-ahead). Their old authenticator entries no longer work; new secrets were generated by the API's setup flow and not stored in the repo.

---

## E. Files changed (this audit; earlier work in `PROJECT_PROGRESS.md`)

- **Auth:**
  - `features/auth/{auth-fields,sign-in-form,register-form,forgot-form,reset-password-form,change-password-form,verify-otp-form,totp-form,account-security,phone-field,schemas,routing}.tsx/ts`
- **Booking and customer:**
  - `features/booking/booking-flow.tsx`
  - `features/customer/booking-detail-view.tsx`
  - `features/provider/job-view.tsx`
- **Provider:**
  - `features/provider/{services-view,profile-view,calendar-view,documents-view,payouts-view,ratings-view,conduct-view}.tsx`
- **Portal (agent/staff):**
  - `features/portal/{verification-console,staff-views}.tsx`
- **Discovery and shared components:**
  - `features/discovery/{track-booking,providers-search,catalogue-explorer,search-refinements}.tsx`
  - `features/home/hero-search.tsx`
  - `components/select-field.tsx`
  - `app/[locale]/(public)/providers/[providerId]/page.tsx`
- **Shared:**
  - `lib/utils.ts` (`formatMoney`)
  - `lib/dictionaries.ts` (en + ur)
- **Tests:**
  - new: `tests/auth/submit-button.test.tsx`, `tests/booking/review-schedule.test.ts`, `tests/customer/booking-progress.test.ts`, `tests/providers/track-booking-gate.test.tsx`, `tests/services/catalogue-explorer-history.test.tsx`, `tests/home/hero-search.test.tsx`
  - updated: phone-field, schemas, totp-form, routing, job-view, services-view, utils, plans-views
- **Ops board:** `features/admin/ops-board.tsx`, test `tests/admin/ops-board-stream.test.tsx`
- **Repo hygiene:** `.gitignore` (glued `/e2e/*.png` pattern fixed)
  - `e2e/verify-plans.cjs`, `scripts/dev-totp.mjs`, `scripts/dev-admin-plans.mjs` (no hardcoded password)
- **Docs:**
  - this file, `view-test-matrix.md`, `api-coverage-audit.md`, `backend_requirement.md` (§7 + BE index)

**Only `apps/web/**` was modified. No backend changes were made. All outstanding backend requirements are documented in `apps/web/docs/backend_requirement.md`.**

**Test scripts:** the browser harness and journey scripts used for this audit (playwright-core, under `apps/web/e2e/audit/`) were **removed afterwards at the owner's request**, together with their screenshots and JSON output. This report, `view-test-matrix.md` and `api-coverage-audit.md` are the record of what was run.
