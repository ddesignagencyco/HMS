# Frontend Task Board — Smart Home Maintenance Services

Screens listed match SRS §9.1 exactly, grouped here by build phase so frontend and backend
land together — a screen isn't started until the backend endpoints it needs exist (check
`TASKS_BACKEND.md`). All screens: mobile-first, usable at 360px width (NFR-US-01).

**How to use this file:** check items off as PRs merge. Cross-cutting tasks at the bottom
apply to every screen — don't treat them as a separate phase, build them in from Phase 1.

**Status marks (audited 2026-10-06 against `apps/web` @ `52d8a7e`):**

| Mark | Meaning                                                                          |
| ---- | -------------------------------------------------------------------------------- |
| ✅   | Done — the screen calls the live API and renders its response                    |
| 🟡   | Partly done — some of the screen is real, the rest still reads `src/lib/data.ts` |
| ⬜   | Not done — still mock data, no endpoint called                                   |

Audit method and the per-screen endpoint lists live in `apps/web/docs/integrated.md`.
Backend gaps that block an item are listed in `apps/web/docs/BACKEND_REQUIREMENTS.md`.

---

## Phase 1 — Foundation

Public pages, auth, provider onboarding, admin approval

### Public

- [x] Home + service categories — ✅ hero search, category cards and the service list all read the API. Home-page photography stays in `features/home/catalogue-art.ts` — the API publishes no image field, so the art is keyed by slug and deliberately carries no catalogue data
- [x] Service listing (per category) — ✅
- [x] Registration (customer, provider — provider flow includes document upload) — 🟡 `POST /auth/register` is live; the document-upload step has no backend to upload to (BACKEND_REQUIREMENTS §6.1)
- [x] Login — ✅
- [x] Password recovery (email or SMS code) — ✅

### Customer (auth shell only — dashboard proper starts Phase 2)

- [ ] Profile & password screen — 🟡 the profile reads `GET /auth/me` with the phone and email **masked** (NFR-PR-01), and TOTP enrolment on `/account/security` is ✅. Still missing: a password-change screen — no authenticated password-update route exists on the API
- [x] Address book (add/edit saved addresses with map pin) — 🟡 list, create, **edit**, make-default and remove are all live against `/customer/addresses`. The pin is still an honest two-source picker (device or city centre) rather than a pin _drop_, because `areas.centroid` is not returned (BACKEND_REQUIREMENTS §2.2)

### Provider (onboarding slice)

- [ ] Documents screen: CNIC / trade certificate / optional character certificate upload, approval status shown — ⬜ **no backend at all** (BACKEND_REQUIREMENTS §6.1)
- [ ] Service & price list: pick catalogue services, set price within admin band — ⬜ screen not built; `features/provider/api.ts` now types `GET`/`PUT`/`DELETE /provider/services`, which already returns each service's own price and approval status
- [ ] Availability calendar: weekly slots + leave days — ⬜ screen not built. The endpoint is **recurring weekly blocks + leave**, not a per-day booked/free grid, so the view must be redesigned against `AvailabilityBlock`; typed in `features/provider/api.ts`
- [x] Profile — ✅ `GET`/`PATCH /provider/profile` + `GET /provider/service-areas`. No provider id is in the route — the API reads the caller from the access token, which is what replaced the hardcoded `providers[0]` every professional used to see

### Admin

- [ ] Provider approval queue: review documents, approve/reject with reason — ⬜ **blocked**: `POST /admin/providers/:id/approve|reject` exist but there is no list endpoint, so the queue has nothing to render (BACKEND_REQUIREMENTS §0.2.2)
- [ ] Provider & customer management (list/search/deactivate — never a delete button) — ⬜ **blocked** on `GET /admin/providers` and `GET /admin/customers` (§0.2.2, §0.2.3)
- [ ] Catalogue management: categories, services, pricing model, emergency/plan/warranty/high-risk flags — ⬜ write endpoints exist and are unused (`POST`/`PATCH /admin/catalogue/*`)
- [ ] Roles & permissions screen (agent / finance / admin) — ⬜ **blocked** on `GET /admin/roles` (§0.2.6)
- [ ] Settings screen (maps to `Setting` table — commission, SLA timers, calling hours, etc.) — ⬜ `GET /admin/settings` exists and is unused; inputs are `readOnly`
- [ ] Audit log viewer (filter by actor, entity, date) — ⬜ **blocked**: `audit_log` is written by `AuditService` but no controller reads it (§0.2.5)

**Definition of done — Phase 1:** a provider can register, upload documents, and get
approved by an admin, entirely through the UI, matching the backend's Phase 1 DoD.

---

## Phase 2 — Transacting

Search, booking flow, provider job execution

### Customer

- [x] Search & filter results (location, experience, expertise, rating, price range, available-today, verified-only, min completed jobs) with distance shown per result — 🟡 search is live and distance is real; only service/city/point filters exist. Rating, price range, available-today, verified-only and min-jobs are **not filterable** — `/search/providers` is `.strict()` with 3 keys (BACKEND_REQUIREMENTS §2.1)
- [x] Provider profile view (experience, expertise, rating, remarks, distance) — ✅
- [x] Booking form: slot picker (only free slots selectable), problem description, up to 5 photos — 🟡 slot picker and description are live; the 5-photo upload is on the **booking detail** page, not this flow
- [x] Booking summary & confirmation (estimated price, visit/inspection fee, cancellation policy shown before confirm) — ✅ `POST /bookings/quote` rendered verbatim
- [x] Booking detail with live status (reflects every state in the booking state machine) — ✅
- [x] Reschedule / cancel actions, with the fee rule surfaced before confirming — 🟡 actions are live; the copy states no fee is charged, because the API promises one in the quote and does not apply it (BACKEND_REQUIREMENTS §3.4)
- [x] In-app messaging thread on a booking (numbers masked both directions) — ✅ masking is server-side

### Provider

- [ ] Dashboard: today's jobs — ⬜ every provider screen hardcodes `providers[0]` as "me"
- [ ] Job offer screen with acceptance countdown — ⬜ typed in `features/provider/api.ts` (`useProviderOffers`, `liveOffers`, `acceptOffer`, `declineOffer`); screen not built
- [ ] Job detail screen — ⬜ all actions are now typed in `bookingApi` (`accept`/`decline`/`depart`/`start`/`checklist`/`complete`/`cash-received`/`revisions`); screen not built
- [ ] Start-work OTP entry — ⬜ code is compared against a literal
- [ ] Checklist + photograph capture (before/after, geofenced check-in/out handled silently in the background) — ⬜ photos are hardcoded Unsplash URLs
- [ ] Revised quote form (for inspection-first / extra-work services), sent for customer in-app approval — ⬜ `POST /bookings/:id/revisions` exists; the route is `POST /bookings/:id/quote` and does **not** exist (BACKEND_REQUIREMENTS §3.3)
- [ ] Completion submission: parts/materials entry, itemised invoice preview — ⬜

**Definition of done — Phase 2:** a customer can complete a full booking flow, and a
provider can take that job from acceptance through completion submission, on a 360px
viewport.

---

## Phase 3 — Verification and money

Agent console, finance screens, customer/provider money views

### Verification agent

- [ ] Verification queue with SLA countdown — ⬜ `/agent/queue` exists and is unused
- [ ] Agent console: booking + invoice + before/after photos + provider history + the fixed questionnaire (SRS §4.5), on one screen — this is the screen efficiency note in SRS §2.3 calls out explicitly, so keep it to one scroll, no tab-hopping — ⬜ commit action is an `alert()`
- [ ] Call attempt log (per booking) — ⬜

### Finance

- [ ] Escrow held view — ⬜ `/finance/escrow` exists and is unused
- [ ] Release queue — ⬜
- [ ] Refunds screen — ⬜ `GET`/`POST /finance/refunds` exist and are unused
- [ ] Payout batch screen — ⬜
- [ ] Cash reconciliation screen — ⬜
- [ ] Commission debt list — ⬜

### Customer

- [ ] Booking history with status, invoice, provider, and the verification-call feedback — 🟡 `/account/bookings` is ✅; the `/account` dashboard beside it is still mock, so one customer has two sources of truth
- [ ] Invoice view (itemised: service, extras, parts, surcharge, discount, total) — ⬜ no UI; only `GET /bookings/:id/invoice.pdf`, which 404s until completion, and no endpoint returns the line items (BACKEND_REQUIREMENTS §3.6)
- [ ] Re-book a previous provider from history — ⬜ the only re-book link is dead — `?rebook=` is never read by `/book/[slug]`
- [ ] Favourite providers list — ⬜

### Provider

- [ ] Earnings dashboard: held / releasable / paid, commission deducted, weekly/monthly totals — ⬜ `/provider/earnings` exists and is unused
- [ ] Payout request screen — ⬜ `/provider/payouts` exists and is unused
- [ ] Ratings & remarks view (read-only, published-from-verified-call only) — ⬜
- [ ] Reply to a remark (one reply, not editable after posting) — ⬜ `POST /provider/remarks/:id/reply` exists and is unused

**Definition of done — Phase 3:** every screen a verification agent needs is on one page;
customers and providers can see money move (held → released) without contacting support.

---

## Phase 4 — Trust and communication

Complaints, disputes, penalties, notifications

### Customer

- [ ] Complaint form (attach to a booking, photo evidence) — ⬜ a form exists in `customer-views.tsx` but **nothing imports it** — dead code, no route

### Provider

- [ ] Complaint form (unsafe premises / non-payment / abusive conduct) — ⬜ `POST /complaints` exists and is unused
- [ ] Conduct record: current demerit points, expiry dates, penalty schedule reference — ⬜ `/provider/conduct` exists and is unused
- [ ] Penalty appeal form — ⬜ `POST /provider/penalties/:id/appeal` exists and is unused

### Admin

- [ ] Complaint queue (severity-sorted, safety issues pinned to top) — ⬜ sorted by date, not severity; no action handlers
- [ ] Dispute queue: evidence floor (OTP, geofence, photos, checklist, invoice) + verification record side by side, resolution action (full release / partial / full refund / refund+penalty) — ⬜ `GET /admin/disputes` + `POST /admin/disputes/:id/resolve` exist and are unused
- [ ] Penalty & appeal management — ⬜

### All roles

- [ ] In-app notification center (list + unread state) reflecting every booking/provider/admin event from FR-NT-02/03/04 — ⬜ no route or component anywhere; `GET /notifications` + both read endpoints exist and are unused
- [ ] Email/SMS are backend-only — no frontend task, but surface delivery failures to admins if the notification log shows repeated `FAILED` — ⬜

**Definition of done — Phase 4:** a complaint can be filed, reviewed with full evidence,
and resolved through the UI end to end, with the provider seeing their conduct record
update.

---

## Phase 5 — Depth

Maintenance plans, reporting, operations board

### Customer

- [ ] Maintenance plans: browse, subscribe, view remaining entitlements & renewal date, cancel — ⬜ **no maintenance-plan endpoint exists on the API**; these screens cannot be made real until it does

### Admin

- [ ] Operations board: today's bookings by state, verification queue depth, SLA breaches, open disputes, total escrow held — ⬜ **blocked**: `GET /bookings` is `CUSTOMER, PROVIDER` only, so an admin has no booking list at all (§0.2.1)
- [ ] Reports screen: monthly, revenue, provider performance, verification — each exportable to PDF/Excel, printable — ⬜ **blocked** on `GET /admin/reports` (§0.2.4); the Export PDF button is inert

**Definition of done — Phase 5:** an admin can see the whole platform's health on one
board and pull any of the 4 report types without a developer's help.

---

## Cross-cutting (build in from Phase 1, don't defer)

- [x] Mobile-first layout, fully usable at 360px width (NFR-US-01) — 🟡 genuinely mobile-first, but **no viewport test exists** — `playwright-core` is a dependency with no config and no imports, and jsdom has no layout engine, so nothing prevents a 360px regression
- [x] English + Urdu, with right-to-left rendering for Urdu (NFR-US-02) — ✅ `dir` on `<html>`, full `ur` dictionary, compile-time key parity, Nastaliq font, RTL-aware logical properties throughout
- [x] Form errors shown as visible text next to the field, never by colour alone (NFR-US-03) — 🟡 the auth forms are exemplary (icon + text + `aria-invalid` + `aria-describedby`); the **booking flow** renders one banner at the bottom of the card, ~70 lines of DOM from the field it refers to
- [ ] Visible keyboard focus on every interactive element (NFR-US-04) — ⬜ `(auth)/auth.css` sets `outline: none !important` on every focusable element on all 7 auth pages, and `globals.css` does the same on all form controls; the remaining signal on auth inputs is `border-color` alone, which is colour-only
- [ ] Typed API client generated/shared against `packages/contracts` (kept in sync with the backend — see `TASKS_BACKEND.md`) — ⬜ `@smart-home/contracts` is **not a dependency of `apps/web`**; every response type is a hand-written mirror, and nothing fails when the two drift
- [x] Auth flow: JWT access token in memory, refresh token rotation, silent re-auth — ✅ single-flight refresh, replay-once, refused-refresh latch, 9 tests pinning it. No localStorage/sessionStorage anywhere
- [ ] Image upload that tolerates a slow/interrupted connection and resumes or retries (NFR-PE-04) — matters most for the provider's evidence-capture screens on 3G — ⬜ single naive base64 POST per file, no retry, no resume, no queue; it **discards the file selection** on failure. `clientUuid` is regenerated per attempt, so the comment claiming duplicates are prevented is not true. `provider-job.tsx` tells the user "an upload resumes from where it stopped", which is currently false
- [ ] Every screen that shows a phone number must show the masked one, never the real one (NFR-PR-01) — ⬜ the auth flows and the customer profile screen now mask correctly, but the admin customer register still renders full numbers for every `ACTIVE` account; the agent console renders **no** number at all despite a dictionary string promising it is masked
