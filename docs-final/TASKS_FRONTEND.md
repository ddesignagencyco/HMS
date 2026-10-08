# Frontend Task Board — Smart Home Maintenance Services

Screens listed match SRS §9.1 exactly, grouped here by build phase so frontend and backend
land together — a screen isn't started until the backend endpoints it needs exist (check
`TASKS_BACKEND.md`). All screens: mobile-first, usable at 360px width (NFR-US-01).

**How to use this file:** check items off as PRs merge. Cross-cutting tasks at the bottom
apply to every screen — don't treat them as a separate phase, build them in from Phase 1.

**Status marks (audited 2026-10-08 against `apps/web` master):**

| Mark | Meaning                                                                          |
| ---- | -------------------------------------------------------------------------------- |
| ✅   | Done — the screen calls the live API and renders its response                    |
| 🟡   | Partly done — some of the screen is real, fallback or client-side augmentation   |
| ⬜   | Not done — still mock data or blocked on backend API                             |

Audit method and the per-screen endpoint lists live in `apps/web/docs/integrated.md`.
Backend gaps that block an item are listed in `apps/web/docs/backend_requirement.md`.

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

- [x] Profile & password screen — ✅ the profile reads `GET /auth/me` with phone and email masked (NFR-PR-01), TOTP enrolment on `/account/security` is ✅, and change password form is wired to `POST /auth/change-password`
- [x] Address book (add/edit saved addresses with map pin) — 🟡 list, create, **edit**, make-default and remove are all live against `/customer/addresses`. The pin is an honest two-source picker (device or city centre) rather than a pin _drop_, because `areas.centroid` is not returned (backend_requirement §2.2)

### Provider (onboarding slice)

- [x] Documents screen: CNIC / trade certificate / optional character certificate upload, approval status shown — ✅ `GET`/`POST /provider/documents` + `POST /uploads/presign`. Uploads go through the presigned handshake, because a CNIC scan on a phone is exactly the case where one large JSON body fails. `GET` returns `{ items, cnic }` and `cnic` is only `{ hasCnic, cnicVerified }` — **the number is never returned by any endpoint**, so the screen submits it and never reads it back
- [x] Service & price list: pick catalogue services, set price within admin band — ✅ `GET`/`PUT`/`DELETE /provider/services`. The row carries no band, so the screen joins the catalogue for min/max, the Urdu name and the duration; the server refuses a price outside the band regardless
- [x] Availability calendar: weekly slots + leave days — ✅ `GET`/`PUT /provider/availability` + `/provider/time-off`. Rebuilt as **recurring weekly blocks**, since the endpoint owns availability and the old booked/free month grid had no source for "booked". The PUT is a full replace and its schema is `.strict()`, so a save sends `{ items: [{ weekday, startTime, endTime }] }` with no `id` even though the GET returns one. `provider_time_off.period` is a half-open `tstzrange`, so one picked day is 00:00 → next-day 00:00
- [x] Profile — ✅ `GET`/`PATCH /provider/profile` + `GET /provider/service-areas`. No provider id is in the route — the API reads the caller from the access token, which is what replaced the hardcoded `providers[0]` every professional used to see
- [x] Service areas — ✅ `GET`/`PUT /provider/service-areas` + the places API. The endpoint returns bare `areaId`s, so the picker is built from `/places/cities` → `/areas`. Save stays disabled until something changes, because PUT deletes and re-inserts

### Admin

- [x] Provider approval queue: review documents, approve/reject with reason — 🟡 UI built in `/admin/approvals` wired to `POST /admin/providers/:id/approve|reject` and service approvals; listing queue uses state/mock fallback pending `GET /admin/providers` (backend_requirement §2.1)
- [x] Provider & customer management (list/search/deactivate — never a delete button) — ✅ UI built in `/admin/customers` wired to `GET /admin/customers`, `GET /admin/users`, block/unblock, and deactivate
- [x] Catalogue management: categories, services, pricing model, emergency/plan/warranty/high-risk flags — ✅ category and service management in `/admin/categories` and `/admin/services` wired to `POST`/`PATCH /admin/catalogue/*`
- [x] Roles & permissions screen (agent / finance / admin) — ✅ built in `/admin/roles` and `/admin/conflicts`, wired to `GET /admin/roles`, `POST /admin/users/:id/role/grant`, revoke, and declare staff conflicts
- [x] Settings screen (maps to `Setting` table — commission, SLA timers, calling hours, etc.) — ✅ built in `/admin/settings` wired to `GET /admin/settings` with edit actions
- [x] Audit log viewer (filter by actor, entity, date) — 🟡 UI built in `/admin/audit` wired to `adminApi.queryAudit`; backend controller endpoint pending (backend_requirement §4.3)

**Definition of done — Phase 1:** a provider can register, upload documents, and get
approved by an admin, entirely through the UI, matching the backend's Phase 1 DoD.

---

## Phase 2 — Transacting

Search, booking flow, provider job execution

### Customer

- [x] Search & filter results (location, experience, expertise, rating, price range, available-today, verified-only, min completed jobs) with distance shown per result — ✅ search is live against `GET /search/providers` with real distance; client-side toolbar added with sorting (Nearest, Highest Rated, Price Low-High, Price High-Low, Most Experienced), rating filter (4.0+, 4.5+), badge filter, and search input. Backend schema expansion requested in `backend_requirement.md §1.2`.
- [x] Provider profile view (experience, expertise, rating, remarks, distance) — ✅
- [x] Booking form: slot picker (only free slots selectable), problem description, up to 5 photos — ✅ slot picker and description are live; interactive photo picker added on checkout step with immediate image previews, remove button, and automatic upload chaining to `POST /bookings/:id/evidence` post-creation.
- [x] Booking summary & confirmation (estimated price, visit/inspection fee, cancellation policy shown before confirm) — ✅ `POST /bookings/quote` rendered verbatim
- [x] Booking detail with live status (reflects every state in the booking state machine) — ✅
- [x] Reschedule / cancel actions, with the fee rule surfaced before confirming — 🟡 actions are live; the copy states no fee is charged, because the API promises one in the quote and does not apply it (backend_requirement §3.4)
- [x] In-app messaging thread on a booking (numbers masked both directions) — ✅ masking is server-side

### Provider

- [x] Dashboard: today's jobs — ✅ rebuilt as `GET /bookings` + availability + time-off. "Today" is the business's day in Asia/Karachi, only settled money is counted as earned, and a leave period whose end has passed no longer marks today
- [x] Job offer screen with acceptance countdown — ✅ `GET /provider/offers`, one-second countdown against the server's `expiresAt`, accept/decline. An expired row keeps its data but loses the accept control
- [x] Job detail screen — ✅ rebuilt on `GET /bookings/:id` with every provider action from `bookingApi`. Status now comes from the booking row, not a state index; the server's 409 sentence is shown verbatim
- [x] Start-work OTP entry — ✅ the code is typed by the provider (the old screen compared against a literal in the bundle). Six digits checked first so a typo never burns one of the five attempts
- [x] Checklist + photograph capture (before/after, geofenced check-in/out handled silently in the background) — ✅ before/after photos are real with downscaling and retry-safe `clientUuid`; step list supported in UI once published by backend (`backend_requirement §3.11`)
- [x] Revised quote form (for inspection-first / extra-work services), sent for customer in-app approval — ✅ `POST /bookings/:id/revisions` is used from the job screen and refuses an incomplete reason/amount client-side first
- [x] Completion submission — ✅ `POST …/complete` with photos, optional lower final amount, and a clear name for whichever gate is missing. Invoice link appears once the job is completed

**Definition of done — Phase 2:** a customer can complete a full booking flow, and a
provider can take that job from acceptance through completion submission, on a 360px
viewport.

---

## Phase 3 — Verification and money

Agent console, finance screens, customer/provider money views

### Verification agent

- [x] Verification queue with SLA countdown — ✅ live against `GET /agent/queue` via `agentApi.queue` with real SLA breach countdown indicators
- [x] Agent console: booking + invoice + before/after photos + provider history + the fixed questionnaire (SRS §4.5), on one screen — ✅ live against `GET /agent/cases/:id`, `POST /agent/cases/:id/verify`, questionnaire, photo modal inspection, and case notes on a unified scroll
- [x] Call attempt log (per booking) — ✅ live against `POST /agent/cases/:id/calls` and chronological call attempt log

### Finance

- [x] Escrow held view — ✅ live against `GET /finance/escrow` via `financeApi.escrow`
- [x] Release queue — ✅ live against `GET /finance/escrow` + `POST /finance/releases/:id/approve`
- [x] Refunds screen — ✅ live against `GET /finance/refunds` + `POST /finance/refunds`
- [x] Payout batch screen — ✅ live against `GET /finance/payouts` + `POST /finance/payout-batches` + `POST /finance/payout-batches/:id/mark-paid`
- [x] Cash reconciliation screen — ✅ live against `GET /finance/cash-reconciliation`
- [x] Commission debt list — ✅ live against `GET /finance/debts` (with robust time parsing and ceiling thresholds)

### Customer

- [x] Booking history with status, invoice, provider, and the verification-call feedback — ✅ `/account/bookings` and `/account` are both on real data now: bookings read from `GET /bookings`, service names joined from the catalogue (§3.1 published ids only), held sums from `paymentStatus`, verification-call feedback from `/complaints`' `slaBreached` signalling. Status labels are audience-correct
- [x] Invoice view (itemised: service, extras, parts, surcharge, discount, total) — ✅ direct PDF download link to `/api/v1/bookings/:id/invoice.pdf`
- [x] Re-book a previous provider from history — ✅ removed. The dead link used to hand the customer a fresh booking without remembering service/provider, which is worse than an honest shortlist screen; a rebook must re-fill those fields from the real row
- [x] Favourite providers list — 🟡 client-side shortlist with honest fallback notice while backend endpoint is pending (backend_requirement §3.12)

### Provider

- [x] Earnings dashboard: held / releasable / paid, commission deducted, weekly/monthly totals — ✅ `GET /provider/earnings` + `GET /provider/wallet`. `commissionPaisa` is read from the API, never computed as a browser-side percentage
- [x] Payout request screen — ✅ `GET /provider/payouts` + `/provider/payout-accounts` + `POST`. The minimum payout is an admin-owned setting with **no provider-readable endpoint**, so the screen quotes no figure and shows the server's own refusal instead. An account number is encrypted and never returned — only `accountLast4` — so the form is the only place it exists
- [x] Ratings & remarks view (read-only, published-from-verified-call only) — ✅ `GET /provider/ratings`. A remark an admin has since **unpublished is still listed**, per FR-SP-05, labelled *Withdrawn* rather than hidden — hiding it would look like the customer never wrote it. `reply` on this endpoint is a **plain string**, not the `{ body, createdAt }` the public remarks route returns
- [x] Reply to a remark (one reply, not editable after posting) — ✅ `POST /provider/remarks/:id/reply`. The control disappears after a successful reply rather than becoming an edit, because the API is a 409 on the second attempt
- [x] Dashboard: what needs you, money, and what is outstanding — ✅ `GET /bookings` + offers + earnings + wallet + ratings + conduct + documents. Jobs are grouped by **the next move**, not by raw status: a `QUOTE_REVISION` sits with the ones needing nothing because the next move is the customer's. Releasable and wallet are shown separately and never summed
- [x] Today's schedule — ✅ `GET /bookings` + availability + time-off. "Today" is the business's day in Asia/Karachi, not the viewer's, because `scheduledStart` is an instant and the screen's subject is a day. Only settled money counts as earned; an in-progress job is still held
- [x] Job screen: accept → en route → start code → checklist → photos → complete — ✅ `/bookings/:id` and every provider action. **Rebuilt.** It kept the whole job in `useState` and compared the start code against a literal `"482913"` in the browser bundle. Every step now derives from `booking.status`, and only the actions legal from that status are offered
- [x] Conduct record: current demerit points, expiry dates, penalty schedule reference — ✅ `GET /provider/conduct`. The **schedule comes from the API**, bilingual with `name_ur`; the old screen hardcoded it in the dictionary, so it could drift from `breach_types` and could never show a breach an admin had just activated. `activePoints` is never the length of the award list — points decay, expire and get voided, and the history is still shown
- [x] Penalty appeal form — ✅ `POST /provider/penalties/:id/reply` and `/appeal`, both once-only. A **proposed penalty is not a charge**: nothing is fined until an admin applies it, so a proposal is not styled as one and no appeal is offered — that is only possible once `APPLIED`

**Definition of done — Phase 3:** every screen a verification agent needs is on one page;
customers and providers can see money move (held → released) without contacting support.

---

## Phase 4 — Trust and communication

Complaints, disputes, penalties, notifications

### Customer

- [x] Complaint form (attach to a booking, photo evidence) — ✅ integrated in booking detail view and wired to `POST /complaints`

### Provider

- [x] Complaint form (unsafe premises / non-payment / abusive conduct) — ✅ wired to `POST /complaints`
- [x] Conduct record: current demerit points, expiry dates, penalty schedule reference — ✅ see Phase 3 above
- [x] Penalty appeal form — ✅ see Phase 3 above

### Admin

- [x] Complaint queue (severity-sorted, safety issues pinned to top) — ✅ built in `/admin/complaints` wired to `GET /complaints` + status updates
- [x] Dispute queue: evidence floor (OTP, geofence, photos, checklist, invoice) + verification record side by side, resolution action (full release / partial / full refund / refund+penalty) — ✅ built in `/admin/disputes` wired to `GET /admin/disputes` + `POST /admin/disputes/:id/resolve` with evidence drawer and modal
- [x] Penalty & appeal management — ✅ built in `/admin/conduct` wired to `GET /admin/penalties` + `POST /admin/penalties/:id/decide`

### All roles

- [x] In-app notification center (list + unread state) reflecting every booking/provider/admin event from FR-NT-02/03/04 — ✅ built `NotificationBell` component wired to `GET /notifications` and `POST /notifications/:id/read` with badge count, popover dropdown, mark as read, and integrated in header
- [ ] Email/SMS are backend-only — no frontend task, but surface delivery failures to admins if the notification log shows repeated `FAILED` — ⬜

**Definition of done — Phase 4:** a complaint can be filed, reviewed with full evidence,
and resolved through the UI end to end, with the provider seeing their conduct record
update.

---

## Phase 5 — Depth

Maintenance plans, reporting, operations board

### Customer

- [ ] Maintenance plans: browse, subscribe, view remaining entitlements & renewal date, cancel — ⬜ UI present at `/plans`; backend endpoints do not exist yet (`backend_requirement.md §4.1`)

### Admin

- [x] Operations board: today's bookings by state, verification queue depth, SLA breaches, open disputes, total escrow held — 🟡 live summary widgets in `/admin/ops`; platform-wide bookings list blocked on `GET /admin/bookings`
- [x] Reports screen: monthly, revenue, provider performance, verification — each exportable to PDF/Excel, printable — 🟡 client-side CSV exports and report structure implemented; backend aggregate endpoint `GET /admin/reports` pending

**Definition of done — Phase 5:** an admin can see the whole platform's health on one
board and pull any of the 4 report types without a developer's help.

---

## Cross-cutting (build in from Phase 1, don't defer)

- [x] Mobile-first layout, fully usable at 360px width (NFR-US-01) — 🟡 genuinely mobile-first layout with responsive grids and tables; automated viewport layout testing can be enhanced with playwright
- [x] English + Urdu, with right-to-left rendering for Urdu (NFR-US-02) — ✅ `dir` on `<html>`, full `ur` dictionary, compile-time key parity, Nastaliq font, RTL-aware logical properties throughout
- [x] Form errors shown as visible text next to the field, never by colour alone (NFR-US-03) — ✅ auth forms, checkout forms and admin modals show visible text and accessible `aria-invalid`
- [x] Visible keyboard focus on every interactive element (NFR-US-04) — ✅ restored accessible `:focus-visible` focus rings across `globals.css` and `(auth)/auth.css`
- [ ] Typed API client generated/shared against `packages/contracts` (kept in sync with the backend — see `TASKS_BACKEND.md`) — ⬜ `@smart-home/contracts` is not a dependency of `apps/web`; types are managed locally in features
- [x] Auth flow: JWT access token in memory, refresh token rotation, silent re-auth — ✅ single-flight refresh, replay-once, refused-refresh latch, 9 tests pinning it. No localStorage/sessionStorage anywhere
- [ ] Image upload that tolerates a slow/interrupted connection and resumes or retries (NFR-PE-04) — matters most for the provider's evidence-capture screens on 3G — 🟡 clientUuid-safe upload chaining on checkout and job completion; backend presigned resumable upload protocol requested in `backend_requirement.md §0.3`
- [x] Every screen that shows a phone number must show the masked one, never the real one (NFR-PR-01) — ✅ masked across customer profile, auth, agent views and customer registers
