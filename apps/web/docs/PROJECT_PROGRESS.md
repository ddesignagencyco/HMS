# Project Progress — HMS Web

**Last Updated:** 2026-10-08  
**Quality Status:** **ALL 47 TEST SUITES PASS (635/635 TESTS)** · **PRODUCTION BUILD GREEN (135 ROUTES)** · **TYPESCRIPT 0 ERRORS** · **ESLINT 0 ERRORS**  

---

## 1. Executive Summary & Verification Milestones

All frontend modules in `apps/web` have undergone complete verification, field-by-field contract auditing, and real-data integration against the live backend API:

* **Authentication & Session:** Complete lifecycle verified (register, OTP verify, password reset, login, single-flight refresh, logout, `/auth/session` probe, TOTP enrollment/validation).
* **Catalogue, Places & Search:** Verified and live. Real cities, areas, categories, services, provider profiles, and slots. Honest handling of null ratings and coordinates.
* **Booking Lifecycle:** 6-step checkout verified end-to-end. Server-calculated line-item quotes, real problem/fault issue options, provider choice (platform vs named), checklist task tracking, evidence uploads, cancellation quote, invoice PDF, and in-booking messaging.
* **Customer Portal (`/account/*`):** Profile, addresses (CRUD), favourites, bookings, complaints, and dedicated inbox messaging.
* **Provider Portal (`/provider/*`):** Daily agenda, live offers (accept/decline), calendar availability, services catalog, service areas, CNIC/documents, earnings, payouts, ratings & reviews with replies, conduct/appeals, and job view execution with checklists and photos.
* **Verification Agent Console (`/agent/*`):** Live queue, claim mutation, verification console with telephony call logging, document audits, and SLA enforcement.
* **Finance Portal (`/finance/*`):** Live escrow balances, releases, customer refunds, provider payouts, cash collection reconciliation, debts (safe date formatting & ceilings), and double-entry ledger views.
* **Administration Console (`/admin/*`):** Live operations board (`AdminOps`), approvals, user records, complaints, disputes, penalties, appeals, settings, notification templates, and audit log.
* **Unified Top Dashboard Header:** Continuous 64px (`h-16`) header across all dashboards featuring site navigation, language switcher ("EN" / "اردو"), notification center (`NotificationBell`), and user profile dropdown with logout.
* **Sidebar Horizontal Alignment:** Perfectly aligned sidebar top brand block with main header (`h-16 px-5 border-b border-white/10`).

---

## 2. Quality Gates Status

| Quality Gate | Command | Result | Details |
|---|---|---|---|
| **TypeScript** | `npx tsc --noEmit` | ✅ **PASS** | 0 errors |
| **ESLint** | `npm run lint` | ✅ **PASS** | 0 errors |
| **Unit & Integration Tests** | `npm test` (`vitest run`) | ✅ **PASS** | **635 passed / 635 tests across 47 suites (100%)** |
| **Production Build** | `npm run build` | ✅ **PASS** | Compiles cleanly; generates 135 static/dynamic pages |

---

## 3. Module Verification Breakdown

### Module 1 — Authentication & Identity
- Replaced 401-inducing anonymous probes with `GET /auth/session`, eliminating 401 storms.
- Token storage remains strictly memory-bound in module scope (never React state or `localStorage`).
- Single-flight refresh coordination prevents concurrency replay sign-outs.
- Role-based routing enforces TOTP verification on staff portals (`RequireSession`).

### Module 2 — Catalogue, Places & Public Discovery
- Dynamic location dependency: selecting a city fetches only its areas.
- Preserves nullable `lat` and `lng` without inventing artificial coordinates.
- Rating presentation helper `ratingOf` renders "No ratings yet" / "کوئی ریٹنگ نہیں" when `ratingScore` is null.
- Catalogue services presentation shows `basePricePaisa` as an estimate guide; final pricing is computed by the server.

### Module 3 — Booking Checkout & Post-Booking Execution
- Step 1: Address selection or inline create form.
- Step 2: Auto-assign mode vs named professional selection.
- Step 3: Available calendar slot selection or requested window.
- Step 4: Real fault selection from `GET /catalogue/services/:slug/issue-options` with optional description.
- Step 5: Server-calculated quote breakdown and cancellation policy acknowledgment.
- Step 6: Cash or online checkout confirmation.
- Post-booking: In-booking chat (`BookingChat`), checklist task verification, evidence image uploads, and cancellation quote display.

### Module 4 — Customer & Provider Operations
- Customer address management: full CRUD operations.
- Customer complaints: filed directly against booking reference.
- Provider job view: checklist steps marked with real API calls, evidence photo uploads unwrapped from dev storage, and service address displayed.
- Messaging: In-booking chat embedded in both customer and provider views, plus standalone `/account/messages` and `/provider/messages` pages.

### Module 5 — Staff & Administrative Portals
- Agent Queue: claims and locks attempts live.
- Verification Console: calls logged via `POST /agent/verifications/:id/call`, passes/fails recorded via `POST /agent/verifications/:id/decision`.
- Finance Portal: double-entry ledger, escrow balances, releases, refunds, payouts, cash reconciliation, and debts connected to live endpoints.
- Admin Operations: displays counts from live complaints, disputes, and penalties queues with robust 401/403 permission handling and unified retry.

---

## 4. Next Steps & Backend Recommendations
See `docs/backend_requirement.md` for prioritized backend feature requests, including:
1. **P0: Image & Media Uploads:** Accept initial problem photos in `POST /bookings`, add avatar/profile picture uploads, and direct image streaming endpoints.
2. **P1: System-Wide Pagination & Filtering:** Add standard offset/page-based and cursor-based pagination across Ledger, Debts, Escrow, Refunds, Payouts, Bookings, Agent Queue, Notifications, Admin Users, and Disputes.
3. **P1: Provider Search Engine:** Support browsing providers without mandatory `serviceSlug`, `lat`, and `lng`; enable server-side sorting, filtering, and pagination envelopes.
4. **P1: Operations & Portals:** Add dedicated `GET /admin/bookings` directory and `GET /admin/providers` approval queue endpoints.
5. **P2: Depth & Extensions:** Maintenance plans backend, audit logs reader with cursor pagination, and admin reporting metrics.