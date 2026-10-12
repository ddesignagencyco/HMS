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
Backend gaps that block an item are listed in `apps/web/docs/backend_requirement.md` — the
single authoritative file. (The old `BACKEND_REQUIREMENTS.md` was deleted; several rows in
this board still cited it, and those citations are fixed here.)

---

## Phase 1 — Foundation

Public pages, auth, provider onboarding, admin approval

### Public

- [x] Home + service categories — ✅ hero search, category cards and the service list all read the API. Home-page photography stays in `features/home/catalogue-art.ts` — the API publishes no image field, so the art is keyed by slug and deliberately carries no catalogue data
- [x] Service listing (per category) — ✅
- [x] Registration (customer, provider — provider flow includes document upload) — 🟡 `POST /auth/register` is live; the document-upload step has no backend to upload to (backend_requirement.md §6.1)
- [x] Login — ✅
- [x] Password recovery (email or SMS code) — ✅

### Customer (auth shell only — dashboard proper starts Phase 2)

- [ ] Profile & password screen — 🟡 the profile reads `GET /auth/me` with the phone and email **masked** (NFR-PR-01), and TOTP enrolment on `/account/security` is ✅. Still missing: a password-change screen — no authenticated password-update route exists on the API
- [x] Address book (add/edit saved addresses with map pin) — 🟡 list, create, **edit**, make-default and remove are all live against `/customer/addresses`. The pin is still an honest two-source picker (device or city centre) rather than a pin _drop_, because `areas.centroid` is not returned (backend_requirement.md §2.2)

### Provider (onboarding slice)

- [x] Documents screen: CNIC / trade certificate / optional character certificate upload, approval status shown — ✅ `GET`/`POST /provider/documents` + `POST /uploads/presign`. Uploads go through the presigned handshake, because a CNIC scan on a phone is exactly the case where one large JSON body fails. `GET` returns `{ items, cnic }` and `cnic` is only `{ hasCnic, cnicVerified }` — **the number is never returned by any endpoint**, so the screen submits it and never reads it back
- [x] Service & price list: pick catalogue services, set price within admin band — ✅ `GET`/`PUT`/`DELETE /provider/services`. The row carries no band, so the screen joins the catalogue for min/max, the Urdu name and the duration; the server refuses a price outside the band regardless
- [x] Availability calendar: weekly slots + leave days — ✅ `GET`/`PUT /provider/availability` + `/provider/time-off`. Rebuilt as **recurring weekly blocks**, since the endpoint owns availability and the old booked/free month grid had no source for "booked". The PUT is a full replace and its schema is `.strict()`, so a save sends `{ items: [{ weekday, startTime, endTime }] }` with no `id` even though the GET returns one. `provider_time_off.period` is a half-open `tstzrange`, so one picked day is 00:00 → next-day 00:00
- [x] Profile — ✅ `GET`/`PATCH /provider/profile` + `GET /provider/service-areas`. No provider id is in the route — the API reads the caller from the access token, which is what replaced the hardcoded `providers[0]` every professional used to see
- [x] Service areas — ✅ `GET`/`PUT /provider/service-areas` + the places API. The endpoint returns bare `areaId`s, so the picker is built from `/places/cities` → `/areas`. Save stays disabled until something changes, because PUT deletes and re-inserts

### Admin

- [x] Provider approval queue: review documents, approve/reject with reason — ✅ built on `GET /admin/users?role=PROVIDER` and `GET /admin/providers/:providerId/documents`. **Still blocked on A1** (`backend_requirement.md`): there is no `GET /admin/providers`, and `GET /admin/users` publishes `user_status` but not `provider_status`, so the queue cannot filter to "awaiting decision" and says so on screen instead of labelling every row approved. Approval is gated on `cnic.cnicVerified`, which is what the API actually enforces
- [x] Provider & customer management (list/search/deactivate — never a delete button) — ✅ `GET /admin/users` (+ `role`, `status`, `q`), `GET /admin/customers`, `POST :userId/{block,unblock,deactivate,send-reset}`. The old booking-count and lifetime-spend columns are **removed rather than estimated** — no endpoint returns them (A2). A 403 is never rendered as an empty list, and nothing is hard-deleted: the database forbids deletes outright
- [x] Catalogue management: categories, services, pricing model, emergency/plan/warranty/high-risk flags — ✅ `POST`/`PATCH /admin/catalogue/{categories,services}` plus the commission rules. The list *is* the public catalogue, so an admin edits exactly what a customer sees. Checklist and issue-option routes are **write-only** (no reader anywhere in the API), so they are not on the screen and the gap is written up (A4)
- [x] Roles & permissions screen (agent / finance / admin) — ✅ `GET /admin/roles`, `POST`/`DELETE /admin/users/:userId/roles/:roleCode`, `GET/POST /admin/staff-conflicts`. A 403 here is "this is not an admin session", not "there are no roles"
- [x] Settings screen (maps to `Setting` table — commission, SLA timers, calling hours, etc.) — ✅ `GET /admin/settings`, `GET`/`PUT /admin/settings/:key`. Inputs are editable and the editor is chosen by the value's current type, because `SettingRow.value` is a real union. One key per request is the API's shape, so a group of changes is N round trips (A8)
- [x] Audit log viewer (filter by actor, entity, date) — ✅ `GET /admin/audit` (+ `action`, `actorUserId`, `entityType`, `entityId`, `from`, `to`)

**Definition of done — Phase 1:** a provider can register, upload documents, and get
approved by an admin, entirely through the UI, matching the backend's Phase 1 DoD.

---

## Phase 2 — Transacting

Search, booking flow, provider job execution

### Customer

- [x] Search & filter results (location, experience, expertise, rating, price range, available-today, verified-only, min completed jobs) with distance shown per result — 🟡 search is live and distance is real; only service/city/point filters exist. Rating, price range, available-today, verified-only and min-jobs are **not filterable** — `/search/providers` is `.strict()` with 3 keys (backend_requirement.md §2.1)
- [x] Provider profile view (experience, expertise, rating, remarks, distance) — ✅
- [x] Booking form: slot picker (only free slots selectable), problem description, up to 5 photos — 🟡 slot picker and description are live; the 5-photo upload is on the **booking detail** page, not this flow
- [x] Booking summary & confirmation (estimated price, visit/inspection fee, cancellation policy shown before confirm) — ✅ `POST /bookings/quote` rendered verbatim
- [x] Booking detail with live status (reflects every state in the booking state machine) — ✅
- [x] Reschedule / cancel actions, with the fee rule surfaced before confirming — 🟡 actions are live; the copy states no fee is charged, because the API promises one in the quote and does not apply it (backend_requirement.md §3.4)
- [x] In-app messaging thread on a booking (numbers masked both directions) — ✅ masking is server-side

### Provider

- [x] Dashboard: today's jobs — ✅ rebuilt as `GET /bookings` + availability + time-off. "Today" is the business's day in Asia/Karachi, only settled money is counted as earned, and a leave period whose end has passed no longer marks today
- [x] Job offer screen with acceptance countdown — ✅ `GET /provider/offers`, one-second countdown against the server's `expiresAt`, accept/decline. An expired row keeps its data but loses the accept control
- [x] Job detail screen — ✅ rebuilt on `GET /bookings/:id` with every provider action from `bookingApi`. Status now comes from the booking row, not a state index; the server's 409 sentence is shown verbatim
- [x] Start-work OTP entry — ✅ the code is typed by the provider (the old screen compared against a literal in the bundle). Six digits checked first so a typo never burns one of the five attempts
- [ ] Checklist + photograph capture (before/after, geofenced check-in/out handled silently in the background) — 🟡 before/after photos are real with downscaling and a retry-safe `clientUuid`. The step list itself is still a gap: `POST …/complete` enforces it, but no endpoint publishes the steps or their `itemId` (backend_requirement.md §3.11), so nothing can be rendered or ticked
- [x] Revised quote form (for inspection-first / extra-work services), sent for customer in-app approval — ✅ `POST /bookings/:id/revisions` is used from the job screen and refuses an incomplete reason/amount client-side first
- [x] Completion submission — ✅ `POST …/complete` with photos, optional lower final amount, and a clear name for whichever gate is missing. Invoice link appears once the job is completed

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

- [x] Booking history with status, invoice, provider, and the verification-call feedback — ✅ `/account/bookings` and `/account` are both on real data now: bookings read from `GET /bookings`, service names joined from the catalogue (§3.1 published ids only), held sums from `paymentStatus`, verification-call feedback from `/complaints`' `slaBreached` signalling. Status labels are audience-correct
- [ ] Invoice view (itemised: service, extras, parts, surcharge, discount, total) — ⬜ no UI; only `GET /bookings/:id/invoice.pdf`, which 404s until completion, and no endpoint returns the line items (backend_requirement.md §3.6)
- [x] Re-book a previous provider from history — ✅ removed. The dead link used  to hand the customer a fresh booking without remembering service/provider, which is worse than an honest shortlist screen; a rebook must re-fill those fields from the real row
- [ ] Favourite providers list — ⬜ table and composite id exist, no endpoint: `grep -ri favourite apps/api/src` returns zero (backend_requirement.md §3.12). Screen explains this rather than rendering an empty heart list

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

- [ ] Complaint form (attach to a booking, photo evidence) — ⬜ a form exists in `customer-views.tsx` but **nothing imports it** — dead code, no route

### Provider

- [ ] Complaint form (unsafe premises / non-payment / abusive conduct) — ⬜ `POST /complaints` exists and is unused
- [x] Conduct record: current demerit points, expiry dates, penalty schedule reference — ✅ see Phase 3 above
- [x] Penalty appeal form — ✅ see Phase 3 above

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

- [x] Maintenance plans: browse, subscribe, view remaining entitlements & renewal date, cancel — ✅ SHM-089 landed `apps/api/src/plans/*` on 2026-10-12 and all three screens are on it. `/plans` and `/account/plans` read `GET /plans`; the account screen reads `GET /me/subscriptions`, subscribes through `POST /plans/:id/subscribe` and follows the returned `checkout.returnUrl`; it cancels through `POST /subscriptions/:id/cancel` and reads the per-visit schedule from `GET /subscriptions/:id`. The public page's three invented tiers (Rs 4,900 / 8,900 / 14,900) are **deleted** — no row in the database ever agreed with them. Verified in a real browser against a published plan (`apps/web/e2e/verify-plans.cjs`). Remaining gaps: B1–B4 in `apps/web/docs/backend_requirement.md`

### Admin

- [x] Maintenance plan management: list including unpublished, create, edit, deactivate — ✅ the five `/admin/plans` routes are consumed by a real editor. `DELETE` is a deactivation (`is_active = false`) and the confirmation says so: nobody is charged and no existing subscription is cancelled. Republishing is a `PATCH` with `isActive: true`. The service list can only be set at creation — `planUpdateSchema` has no `services` key — so the edit form omits that control and states why (B1).

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
