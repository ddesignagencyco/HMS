# Project Progress — HMS Web

**Last Updated:** 2026-10-13  
**Quality Status:** **ALL 47 TEST SUITES PASS (635/635 TESTS)** · **PRODUCTION BUILD GREEN (135 ROUTES)** · **TYPESCRIPT 0 ERRORS** · **ESLINT 0 ERRORS**  

---

## 1. Executive Summary & Verification Milestones

All frontend modules in `apps/web` have undergone complete verification, field-by-field contract auditing, and real-data integration against the live backend API:

* **Authentication & Session:** Complete lifecycle verified (register, OTP verify, password reset, login, single-flight refresh, logout, `/auth/session` probe, TOTP enrollment/validation).
* **Catalogue, Places & Search:** Real cities, areas, categories, services, provider profiles, and slots. Honest handling of null ratings and coordinates.
* **Booking Lifecycle & Checkout:** 6-step checkout verified end-to-end:
  - Address selection & inline creation.
  - Provider selection with verified qualifications and sanitized bios (no developer seed text).
  - Available calendar slots with clean 30-minute period grouping (Morning, Afternoon, Evening).
  - Immediate emergency dispatch window auto-assigned (`now + 60 mins`) upon emergency selection, unblocking checkout.
  - Server-calculated line-item quotes, issue options, cancellation policy agreement, and payment mode selection.
* **Payments & Invoice:**
  - Removed all demo payment buttons from customer-facing booking details (`/account/bookings/:id`) and return pages (`/checkout/return`).
  - Dedicated "Pay Now" link leading directly to the payment gateway simulation with automatic redirect back to `returnUrl`.
  - Corporate royal-blue branded Invoice PDF downloads (`/api/v1/bookings/:id/invoice.pdf`) with PAID badge, tax lines, and breakdown.
* **Provider Job Execution (`/provider/jobs/:id`):**
  - Converted page-level red error alerts to non-intrusive toast notifications (`toast.error`).
  - Removed raw latitude/longitude coordinates (`31.52040, 74.35870`) from customer address card.
  - Synchronized photo uploads: attaching a before or after photo in `PhotosCard` automatically links to and ticks the corresponding checklist item, eliminating duplicate uploads.
  - Fixed photo persistence on hard refresh with multi-segment storage routing.
* **Aesthetics & Micro-copy Polish:**
  - Replaced technical developer jargon (*"the API refuses it"*, *"the API refuses completion"*) across both English and Urdu dictionaries with user-centric phrasing.
  - Cleaned customer portal sidebar by removing redundant "Customer Portal" subtitle under user's name.
* **Customer Portal (`/account/*`):** Profile, addresses (CRUD), favourites, bookings, complaints, and dedicated inbox messaging.
* **Provider Portal (`/provider/*`):** Daily agenda, live offers, calendar availability, services catalog, service areas, CNIC/documents, earnings, held escrow metrics, payouts, ratings with replies, conduct, and job execution.
* **Admin Console (`/admin/*`):** Real-time operations board (`AdminOps`), approvals with document preview modal, complaints, disputes, penalties, appeals, settings, and audit logs. All raw UUIDs replaced with human-readable badges and names.
* **Finance Portal (`/finance/*`):** Live escrow balances, releases, customer refunds, provider payouts, cash collection reconciliation, debts, and double-entry ledger.

---

## 2. Recent Key UX & Integration Improvements (2026-10-13)

| Improvement Area | Prior Behavior | Updated Behavior |
|---|---|---|
| **Demo Payment UI** | Showed "Complete Demo Payment" button on booking detail and return screens. | Removed all demo buttons; always provides seamless "Pay Now" link directly to the gateway. |
| **API Error Display** | Large intrusive red error banners on provider job screen. | Seamless toast notifications via `react-hot-toast` (`toast.error`). |
| **Address Coordinates** | Raw numerical latitude/longitude (`31.52040, 74.35870`) rendered. | Raw coordinates removed; displays clean address lines and area name. |
| **Developer Jargon** | Mentions of "API refuses it" in tooltips and guidance notes. | Clean user-friendly messaging in English and Urdu dictionaries. |
| **Photo Uploads** | Provider had to upload before/after photos twice (in photos card and checklist). | Uploads are cross-synchronized; one upload satisfies both requirements. |
| **Photo Availability** | Photos showed "Photo unavailable" after hard refresh due to nested URI path decoding. | Nested storage keys correctly resolved and rendered. |
| **Customer Sidebar** | Redundant "Customer Portal" subtitle displayed under customer's name. | Subtitle omitted for customer portal, keeping sidebar neat and aligned. |
| **Emergency Booking** | Blocked with "No start times are free on this day" when emergency was checked. | Automatically assigns immediate 60-minute dispatch slot, allowing instant checkout continuation. |
| **Time Slot Organization** | Unorganized flat grid of dozens of time buttons. | Grouped into clean 30-minute intervals by period (Morning, Afternoon, Evening). |

### 2026-10-14 — FR-VC-16 "Confirm the work" (backend `618c471`)

| Area | Prior Behavior | Updated Behavior |
|---|---|---|
| **Confirm the work** | A finished job waited on an agent's call (or a 72-hour auto-release); the customer had no way to confirm or rate it. | `ConfirmWorkSection` on `/account/bookings/:id` (shown from `canSelfVerify`): server-driven questionnaire, four required 1–5 radio ratings, explicit release consent, "no work"/"extra charge" force the problem path, `422` → field errors, `409` → re-read + `detail`, `ESCALATED` as reassurance with no retry, cash never shown as paid. Full `en` + `ur`. |
| **Entry points** | Dashboard counted `AWAITING_VERIFICATION` as neither live nor anything; nothing pointed at the form. | "Finished jobs waiting for you" callout on `/account` and `/account/bookings`, plus a per-row "Confirm the work" link, all deep-linking to `#confirm-work` (scrolled to and focused). |
| **Bookings tabs** | `PENDING_PAYMENT`, `ACCEPTED`, `WORK_COMPLETED`, `REWORK_REQUIRED`, `VERIFIED`, `DISPUTED` fell into "Closed". | Grouped as live / finishing, so jobs needing action aren't filed with history. |
| **Booking detail** | Raw `paymentStatus` (`CASH_DUE`), hardcoded en/ur ternary for the profile link, provider UUID read to screen readers, warranty offered at every status, complaint/warranty panels opened off-screen. | Localized payment-status labels, dictionary string, UUID removed, warranty only at `PAYMENT_RELEASED`, panels scroll into view. |
| **Dashboard money held** | Summed `quotedAmountPaisa`, ignoring revisions and the final figure. | Sums `finalAmountPaisa ?? approvedTotalPaisa`. |
| **Provider job** | Auto-release notice was a hardcoded en/ur ternary; `Date.now()` read during render (lint error). | Dictionary string; clock seeded once. Cash hint now says the customer can confirm in their app. |

Backend gaps found while building this (form reopens after `ESCALATED`, English-only server sentences, no notification, no read-back) are logged in `backend_requirement.md` §5.

### 2026-10-14 — Supabase Storage (backend `bbdb868`, `STORAGE_PROVIDER=supabase`)

| Area | Prior Behavior | Updated Behavior |
|---|---|---|
| **Provider documents upload** | Inline base64 to `POST /provider/documents` (1 MB body limit → real CNIC photos refused); JPEG/PNG/PDF only. | Presigned: `POST /uploads/presign` → PUT bytes (typed) straight to the Supabase signed upload URL → record `storageKey`. Adds WebP and MP4/WebM/MOV video (50 MB), with "uploading"/"saving" steps shown. |
| **Stored media rendering** | `EvidenceImage` always rendered `<img>` and assumed the dev JSON envelope; English-only failure text. | `StoredMedia`: real signed URLs load directly; `<img>` / `<video>` / PDF tile chosen by content type; mock envelope still supported; localized "File unavailable". |
| **Admin document preview** | `<img>` only (PDF/video broken); "Preview Unavailable in Dev Storage" hardcoded. | Fetches the signed file, renders image, video player or PDF viewer by its real type; "open in new tab"; retry re-signs the 5-minute link; en + ur. |
| **Types** | Evidence/complaint/document types listed 3 image types. | Match the backend's widened `evidenceContentTypes`, `complaintMediaTypes`, `documentContentTypes`. |

**Blocking backend bug:** evidence URLs (booking, complaint, dispute, verification console) are still built as `/dev/storage/...`, which reads the in-memory mock, so under Supabase they 404. See `backend_requirement.md` P0.4.

### 2026-10-14 — Full contract audit: web vs API

Every web API call was checked against the API's controllers, strict zod schemas and response shapes (4 domains, ~200 endpoints). About 45 web-side defects were fixed; backend-only findings went to `backend_requirement.md`. Highlights:

| Area | Was broken | Now |
|---|---|---|
| Customer booking page | No cancel/reschedule/no-show; "Pay now" fell back to a hand-built dev-gateway URL | `BookingActionsCard` mounted; only the API's own `redirectUrl` (kept in `payment-link.ts`) |
| Provider onboarding | Certificate uploads 422 (`TRADE_CERT`/`CHARACTER_CERT`); no screen set city/base location, so submit could never pass | Enums match `packages/contracts`; profile has "Where you work from" |
| Provider money/disputes | Payout/document statuses blank; dispute reply sent `{ body }`; debt invisible | Real enums; `{ reply }` + disputes screen; debt notice + pay |
| Discovery | Fabricated provider names from an id hash; plan subscribe never opened the gateway | Qualification label only; `redirectUrl` + absolute `returnUrl` |
| Texted links | `/v/:token` and `/problem/:token` were 404s | Config redirects to the localized pages |
| Checkout return | `ABANDONED` shown as "Payment Confirmed!" | `checkoutOutcome()` status mapping |
| Provider job | Rework couldn't start; BEFORE photo picker en route (409); checklist ticked by guesswork | Fixed gating; explicit ticks only; provider cancel/no-show |
| Verification console | WITH_ISSUE and extra-charge submits always 422; canned text published as the customer's review | Consent + amount captured; only the customer's words sent |
| Finance | Payout batch marked PAID before the bank paid; escrow/payout columns read phantom fields; FINANCE couldn't reach ops/reports | Create → bank result per payout; real fields; `/finance/ops`, `/finance/reports` |

Verification: `tsc` 0 errors · 61 test files / 762 tests pass · `next build` green · lint: 19 errors, all on lines from earlier commits (none new).

---

## 3. Documentation Structure

All current system documentation is maintained within `apps/web/docs/`:
1. `apps/web/docs/PROJECT_PROGRESS.md` — Progress report and verified milestones (this document).
2. `apps/web/docs/backend_requirement.md` — Complete backend architectural requirements, missing endpoints, and contract requests.
3. `apps/web/docs/api-coverage-audit.md` & `.json` — Full REST API surface audit mapping backend controllers to frontend features.
4. `apps/web/docs/COMPLETE_SYSTEM_WORKFLOWS.md` — Complete end-to-end system flow diagrams and state transitions.