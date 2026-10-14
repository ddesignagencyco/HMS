# View-by-View Test Matrix — HMS Web

**Run:** 2026-10-14, against the live dev stack (API :3000, web `next dev` :3001, Supabase storage, dev mock payment gateway).
**Evidence:** produced by browser scripts (playwright-core) run during the audit; the scripts and their artifacts were removed afterwards at the owner's request, so the results recorded here are the record.

## Status key

| Status | Meaning |
|---|---|
| **PASS** | Exercised in a real browser: loads, primary actions work against the live API, no console errors / crashes / failed calls / overflow |
| **PASS (fixed)** | A defect was reproduced in the browser, fixed, and the view re-checked |
| **LOAD ONLY** | Crawled (direct load, refresh, access control, layout at desktop-en and 360-ur, no errors), but its forms/actions were **not** driven in the browser — covered by component tests only |
| **OPEN** | A known defect remains (see `pre-production-audit.md`) |
| **NOT VERIFIED** | Not runtime-tested: blocked by environment or not reached before the run was stopped |

Access control (all roles): every portal area redirects an anonymous visitor to `/auth/sign-in?returnTo=…`, and each signed-in role is sent to its own home when opening another role's area — verified in the browser for ANON, CUSTOMER, PROVIDER, AGENT, ADMIN and FINANCE.

Responsive: CUSTOMER 153/154, PROVIDER 206/224, AGENT 34/42 crawl visits passed across 360/375/390/412/430/820/1440 × en/ur; **no horizontal overflow anywhere**; `/ur` renders `lang=ur dir=rtl`. ANON full matrix stopped at ~311/340 (quick matrix desktop-en + 360-ur passed for every public route). Failures are listed per route below.

## Public (anonymous)

| Route | Status | Evidence / notes |
|---|---|---|
| `/{locale}` home | PASS (fixed) | hero search now offers every service, not only plumbing (D5) |
| `/services` | PASS (fixed) | search 28→2, empty state, clear restores; back/forward between categories fixed (D3, browser re-run blocked by load) |
| `/services/[slug]` | PASS | unknown slug → branded not-found (soft 404, HTTP 200 — P3) |
| `/providers` | PASS (fixed) | results match API; forever-skeleton with no location fixed; heading counts shown cards; duplicate ids fixed. Min-price filter re-check NOT VERIFIED (rate-limited run) |
| `/providers/[providerId]` | PASS | renders, slots listed; slot → Book hand-off NOT VERIFIED; unknown/malformed id → not-found |
| `/book/[slug]` | PASS (fixed) | full CASH booking created in browser (SHM-0000012); review step now shows the time (D1-booking) |
| `/plans` | PASS | real plan data |
| `/track` | PASS (fixed) | no authenticated calls for visitors (D1-public) |
| `/how-verification-works`, `/contact`, `/privacy`, `/terms` | PASS | |
| `/receipt/[token]` | PASS (invalid token) | valid-token complaint flow NOT VERIFIED (needs a cash-receipt SMS token) |
| `/verification/[token]` | PASS (invalid token) | valid texted-link flow NOT VERIFIED |
| `/checkout/return` | NOT VERIFIED | outcome mapping unit-tested (`checkout-return.test.ts`); live online payment blocked (see below) |
| Unmatched `/{locale}/…` | OPEN (P3) | Next's default unbranded English 404 |

## Auth

| Route | Status | Evidence / notes |
|---|---|---|
| `/auth/sign-in` | PASS (fixed) | wrong password / unknown user same generic 401; `returnTo` honoured; external and `//` returnTo rejected; staff TOTP right/wrong code; **password-in-URL before hydration fixed (AUTH-1)** |
| `/auth/register` | PASS (fixed) | validation, throwaway account created, OTP verify; phone field mangling fixed (AUTH-3) |
| `/auth/verify` | PASS | wrong code → attempts left; dev-inbox code signs in |
| `/auth/totp` | PASS (fixed) | anonymous → sign-in with returnTo; customer → security (AUTH-2) |
| `/auth/forgot`, `/auth/reset-password` | LOAD ONLY | forms not driven in the browser (covered by component tests) |
| `/auth/sign-out` | LOAD ONLY | now calls `POST /auth/logout`; refresh-cookie revocation check written, not run |

## Customer

| Route | Status | Evidence / notes |
|---|---|---|
| `/account` | LOAD ONLY | dashboard confirm-work callout covered by tests |
| `/account/bookings` | LOAD ONLY | one stuck-busy visit under parallel load (en/desktop) — did not reproduce on its own |
| `/account/bookings/[id]` | PASS (fixed) | start code, AWAITING_VERIFICATION, **Confirm the work** form validated and SATISFIED submitted (200); progress card fixed (D3-booking); invalid/foreign id → not-found |
| `/account/addresses` | LOAD ONLY | dropdown-over-map stacking **PASS** (elementFromPoint); CRUD not driven |
| `/account/favourites`, `/account/messages`, `/account/plans`, `/account/profile`, `/account/security` | LOAD ONLY | actions not driven in the browser (covered by component tests) |

## Provider

| Route | Status | Evidence / notes |
|---|---|---|
| `/provider` | PASS | debt notice; one stuck-busy visit (ur/412) under load |
| `/provider/today` | LOAD ONLY | stuck-busy on 2 of 14 visits under parallel load — re-check |
| `/provider/offers` | PASS | offer listed, accept → SCHEDULED |
| `/provider/jobs/[id]` | PASS (fixed) | wrong/right start code, photos (Supabase), complete gated on checklist (D2-booking) |
| `/provider/profile` | PASS (fixed) | base location; clearing bio refused honestly (D4) |
| `/provider/services` | PASS (fixed) | **"Stop offering" now confirms (D1)**; band check in rupees (D2) |
| `/provider/areas` | PASS | |
| `/provider/calendar` | PASS (fixed) | overlap check, leave stored Karachi midnight, add-window day |
| `/provider/documents` | PASS (fixed) | 4 real presigned uploads to Supabase in onboarding run; CNIC rule; picker reset |
| `/provider/earnings` | PASS (fixed) | was rounding paisa (Rs 1,912.50 shown as Rs 1,913) — `formatMoney` fixed |
| `/provider/payouts` | PASS (fixed) | validation only (no money moved); rupee-exact ceilings |
| `/provider/ratings` | PASS (fixed) | reply once, second → 409 shown |
| `/provider/conduct` | PASS | appeal form NOT VERIFIED (no penalties) |
| `/provider/disputes` | PASS | detail/reply NOT VERIFIED (no disputes for this provider) |
| `/provider/messages` | OPEN (P3) | "Write a message" label clipped at every viewport |
| Onboarding (throwaway provider) | PASS | register → DRAFT → missing steps linked → uploads → submit → second submit 409 (18 steps) |

## Verification agent

| Route | Status | Evidence / notes |
|---|---|---|
| `/agent` | PASS (fixed) | queue, claim, error toast, honest stat labels |
| `/agent/verification/[id]` | PASS (fixed) | consent starts unticked (D11), release lock (D12), MANUAL call, DISPUTED submitted on a test booking |
| `/agent/attempts` | PASS | |
| Agent screens in Urdu at 360 | NOT VERIFIED | console largely hardcoded English (P3) |

## Admin (18 routes) and Finance (11 routes)

Run after TOTP was re-enrolled for the dev admin and finance accounts (2026-10-14, desktop · en). Each route was loaded signed in and checked for crashes, failed API calls, a stuck `aria-busy`, and leaked `undefined` / `NaN` / `Invalid Date` / `[object Object]` text. **38/38 checks passed.**

| Route | Status | Evidence / notes |
|---|---|---|
| `/admin` · `/admin/approvals` · `/admin/providers` · `/admin/providers/[id]` · `/admin/providers/[id]/ratings` · `/admin/customers` · `/admin/catalogue` · `/admin/disputes` · `/admin/penalties` · `/admin/appeals` · `/admin/plans` · `/admin/reports` · `/admin/roles` · `/admin/settings` · `/admin/audit` | PASS | render cleanly with live data |
| `/admin/templates` | PASS | preview returns 200 and renders (used to throw on `missing.length`) |
| `/admin/complaints` | PASS | empty queue → empty state; timeline type fix covered by unit test |
| `/admin/ops` | **PASS (fixed)** | **opening this board crashed the whole API** (BE-016, now P0). It now polls `GET /admin/ops-board` every 15 s and never opens the stream; the API was still up 17 s later |
| Document preview (approvals) | PASS | shows an honest "could not be opened" for files stored before the Supabase switch |
| `/finance` · `/finance/ops` · `/finance/releases` · `/finance/refunds` · `/finance/payout-batches` · `/finance/cash` · `/finance/debts` · `/finance/ledger` · `/finance/reports` | PASS | render cleanly; FINANCE reaches ops and reports under `/finance` |
| `/finance/escrow` | PASS | real booking codes in rows |
| `/finance/payouts` | PASS | real requested/paid dates |
| Access control | PASS | FINANCE opening `/admin/ops` is sent to `/finance/…` |
| Admin/finance at 360px and in Urdu | NOT VERIFIED | desktop-en only in this pass |

Mutations that move money (create batch, record bank result, approve payout, refunds, reconciliation run) were **not** executed — verified up to the form only, by design.

## Totals (78 routes = 78 `page.tsx` files under `src/app`)

| Group | Routes | PASS / PASS (fixed) | LOAD ONLY | OPEN | NOT VERIFIED |
|---|---|---|---|---|---|
| Public (incl. `/checkout/return`) | 15 | 14 | 0 | 0 | 1 |
| Auth | 7 | 4 | 3 | 0 | 0 |
| Customer | 9 | 1 | 8 | 0 | 0 |
| Provider | 15 | 13 | 1 | 1 | 0 |
| Agent | 3 | 3 | 0 | 0 | 0 |
| Admin | 18 | 18 | 0 | 0 | 0 |
| Finance | 11 | 11 | 0 | 0 | 0 |
| **Total** | **78** | **64** | **12** | **1** | **1** |
