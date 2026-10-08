# Backend Requirements & API Contract Audit — HMS Platform

**Last Updated:** 2026-10-08  
**Scope:** Full-Stack QA, Media Architecture, Search Engine & TASKS_FRONTEND.md Gap Audit  
**Author:** Frontend Engineering & Full-Stack QA Team  
**Target:** Backend Development Team (`apps/api`)  

---

## Executive Summary

Following a comprehensive UI inspection, API contract verification, and review against `docs-final/TASKS_FRONTEND.md` and live NestJS controller schemas in `apps/api/src/`, this document outlines all functional gaps, missing endpoints, schema constraints, and architectural requirements needed by the frontend web application.

The frontend (`apps/web`) has been stabilized to 100% test pass rate (45/45 suites, 628+ tests passing) with all available APIs wired. Where the backend lacks capabilities, client-side fallbacks (such as client-side sorting and chaining photo uploads post-creation) have been built. However, the items documented below are critical for production scalability, marketplace usability, and feature completeness.

---

## 1. P0 — Image Upload & Media Architecture Requirements

### P0.1 — Initial Problem Photos on Booking Creation (`POST /bookings`)
* **Endpoint:** `POST /api/v1/bookings`
* **Controller:** `apps/api/src/booking/booking.controller.ts`
* **Schema:** `bookingCreateSchema` in `apps/api/src/booking/booking.schemas.ts`
* **Current Behavior:**
  - `bookingCreateSchema` is `.strict()` and only accepts `providerId`, `serviceId`, `addressId`, `scheduledStart`, `scheduledEnd`, `problemText`, `issueOptionId`, `paymentMode`, `isEmergency`, `couponCode`, and `onBehalfOf`.
  - It strictly rejects any image attachments (`422 VALIDATION_FAILED` with `unrecognized_keys`).
  - Previously, the UI on Step 4 of checkout displayed static text: *"You can add up to five photos of the problem from the booking page once the booking exists."*
  - The frontend has now added an interactive photo picker with thumbnail previews, and asynchronously uploads them via `POST /api/v1/bookings/:id/evidence` immediately after the booking ID is issued.
* **Required Backend Enhancement:**
  - Update `POST /api/v1/bookings` to accept an optional `photos` array directly:
    ```json
    {
      "serviceId": 7,
      "addressId": "00000000-0000-4000-8000-000000000001",
      "scheduledStart": "2026-10-10T09:00:00.000Z",
      "scheduledEnd": "2026-10-10T10:30:00.000Z",
      "problemText": "Kitchen drain leaking under sink",
      "photos": [
        {
          "contentType": "image/jpeg",
          "contentBase64": "..."
        }
      ]
    }
    ```
  - Upon booking creation in Prisma transaction, atomically create up to 5 rows in `job_evidence` with `kind: 'CUSTOMER_PROBLEM'` and store the image bytes in the `evidence` bucket.

---

### P0.2 — Customer & Provider Profile Avatar / Photo Upload
* **Endpoints:**
  - Customer: `PATCH /api/v1/me`
  - Provider: `PATCH /api/v1/provider/profile`
* **Current Behavior:**
  - `profileUpdateSchema` in `customer.schemas.ts` accepts only `{ firstName, lastName, locale }`.
  - `profileUpdateSchema` in `provider.schemas.ts` accepts only `{ bio, experienceYears, qualification, cityId, baseAddressText, lat, lng, radiusM }`.
  - Neither entity nor database table (`users`, `providers`) possesses an `avatar_url` or `photo_key` column.
  - Across the entire web application (navigation headers, customer profile, provider dashboard, reviews, chat threads, and search cards), avatars must fall back to rendered letter monograms.
* **Required Backend Enhancement:**
  1. Add `avatar_key` column to `users` and/or `providers` tables.
  2. Implement dedicated avatar upload endpoints:
     - `POST /api/v1/me/avatar` (Customer avatar upload, max 5 MB).
     - `POST /api/v1/provider/avatar` (Provider professional portrait photo, max 5 MB).
     - Both endpoints should accept `{ contentType: 'image/jpeg' | 'image/png' | 'image/webp', contentBase64: string }` or multipart, upload to an `avatars` bucket, and save `avatar_key`.
  3. Include `avatarUrl` in `GET /auth/me`, `GET /auth/session`, `GET /me`, `GET /search/providers`, and `GET /search/providers/:id`.

---

### P0.3 — Provider Name & Profile Photo in Public Search (`GET /search/providers`)
* **Endpoint:** `GET /api/v1/search/providers`, `GET /api/v1/search/providers/:providerId`
* **Controller:** `apps/api/src/search/search.controller.ts`
* **Service:** `apps/api/src/search/search.service.ts:205`
* **Current Behavior:**
  - The SQL query joins `providers p` with `provider_services ps`, projecting: `providerId`, `bio`, `experienceYears`, `qualification`, `pricePaisa`, `distanceM`, `radiusM`, `badge`, `ratingCount`, `ratingScore`.
  - The query **does not join `users`**, omitting the provider's `first_name`, `last_name`, and any profile photo.
  - As a result, search result cards cannot show the provider's name (only their qualification, e.g., "Licensed plumber") and must display an initial letter monogram instead of a profile picture.
* **Required Backend Enhancement:**
  - In `search.service.ts`, join `users u ON u.id = p.user_id`.
  - Project `u.first_name AS "firstName"`, `u.last_name AS "lastName"`, and `photoUrl` (derived from `avatar_key`).
  - Note: `GET /me/favourites` in `favourites.service.ts` already performs this join successfully.

---

### P0.4 — Production Storage URLs & Direct Streaming vs Dev Storage Envelopes
* **Endpoints:** Evidence URLs and document links across the API.
* **Current Behavior:**
  - In development, `DevStorageController` serves files from `/api/v1/dev/storage/:bucket/:key`, returning a JSON envelope: `{ contentType: string, contentBase64: string }`.
  - The frontend has had to build custom unwrapping components (`EvidenceImage` in `evidence-image.tsx`) that fetch the JSON, decode base64 into a data URL, and render it.
* **Required Backend Enhancement:**
  - In production environments, file URLs returned by the API (evidence, avatars, invoice PDFs) must be direct HTTPS URLs:
    - Either signed S3/MinIO/GCS download URLs with expiry (e.g. 1 hour).
    - Or an authenticated API streaming endpoint (`GET /api/v1/storage/:bucket/:key`) that streams binary bytes directly with `Content-Type: image/jpeg` and `Cache-Control: public, max-age=86400`, allowing standard browser `<img>` tags and CDN edge caching to work natively without client-side JSON decoding.

---

### P0.5 — Provider Identity Document Previews & Thumbnails
* **Endpoints:** `GET /api/v1/provider/documents`
* **Controller:** `apps/api/src/provider/provider-documents.service.ts`
* **Current Behavior:**
  - `GET /provider/documents` returns `{ items: [{ id, docType, status, reviewNote, createdAt }], cnic }`.
  - The endpoint provides zero URLs or preview keys for the documents the provider uploaded.
  - While hiding the raw CNIC number is correct for privacy (AES-256-GCM encrypted), the provider has no way to preview their uploaded trade certificates or check if an image was legible.
* **Required Backend Enhancement:**
  - Return a short-lived signed view URL for non-CNIC documents (trade certificates, character certificates) so providers can view their uploaded files.

---

### P0.6 — Catalogue Categories & Services Cover Images
* **Endpoints:** `GET /api/v1/catalogue/categories`, `GET /api/v1/catalogue/services`
* **Current Behavior:**
  - Categories and services schemas do not contain any `iconUrl`, `imageUrl`, or `coverPhotoUrl` fields.
  - The frontend home and catalogue explorer pages currently map category slugs to SVG vector icons and local static art.
* **Required Backend Enhancement:**
  - Add `icon_url` and `cover_image_url` to `categories` and `services` tables and expose them in the API responses.

---

## 2. P1 — Provider Search Engine Gaps (`GET /search/providers`)

### P1.1 — Requirement for All 3 Mandatory Parameters (`serviceSlug`, `lat`, `lng`)
* **Endpoint:** `GET /api/v1/search/providers`
* **Controller:** `apps/api/src/search/search.controller.ts:32`
* **Schema:** `providerSearchQuerySchema` in `apps/api/src/search/search.schemas.ts:3`
* **Current Behavior:**
  - The schema is `.strict()` and mandates `serviceSlug`, `lat`, and `lng`.
  - Omitting any of them returns `422 VALIDATION_FAILED`.
  - A user visiting `/providers` cannot browse available professionals in their city generally or see top-rated providers without picking a specific service first.
* **Required Backend Enhancement:**
  - Make `serviceSlug`, `lat`, and `lng` optional.
  - Allow querying by `cityId` or `areaId` directly. When `serviceSlug` is omitted, return all approved providers within the city ranked by reputation.

---

### P1.2 — Server-Side Sorting, Filtering & Pagination
* **Current Behavior:**
  - `providerSearchQuerySchema` rejects any additional query parameters (`sortBy`, `minRating`, `maxPrice`, `page`, `limit`).
  - The frontend has now implemented client-side sorting (by distance, rating, price, experience) and filtering (minimum rating, badge, keyword search) over the returned array.
  - However, when providers grow beyond 20–50 items, client-side pagination and sorting cannot substitute for database-level query optimization.
* **Required Backend Enhancement:**
  - Update `providerSearchQuerySchema` to accept:
    * `sortBy: 'default' | 'distance' | 'rating' | 'price_asc' | 'price_desc' | 'experience'`
    * `minRating: number` (e.g., 4.0, 4.5)
    * `minPricePaisa: number`, `maxPricePaisa: number`
    * `badgeOnly: boolean`
    * `q: string` (text search against qualification, bio, and provider name)
    * `page: number`, `limit: number` (default 20, max 100)
  - Return pagination metadata envelope: `{ items: ProviderSearchResultRow[], total: number, page: number, limit: number }`.

---

## 3. P1 — System-Wide Pagination, High-Volume Data & Query Filtering Requirements

### P1.3 — Core Architectural Need & Standard Pagination Envelope
Across the HMS platform, multiple listing endpoints currently return unpaginated arrays or rely on arbitrary hardcoded limits (such as `LIMIT 500` in SQL). As the platform handles thousands of active bookings, providers, customers, ledger entries, notifications, and audit records, returning unbounded arrays will cause:
1. **Severe Memory & Database Load:** Node.js memory exhaustion and excessive database table scans.
2. **Browser Performance Degradation:** Rendering hundreds of unpaged DOM nodes causes UI lag and mobile viewport slowdowns.
3. **Lack of User Navigation:** Users cannot jump to specific pages, filter by date ranges, or sort by business priority.

#### Unified Pagination Standards for `apps/api`:

#### Standard A: Offset / Page-Based Standard (For Tables & Grid Views)
Used for user registers, disputes, complaints, provider search, and debts:
* **Request Query Parameters:**
  * `page`: integer $\ge 1$ (default: `1`)
  * `limit`: integer $1..100$ (default: `20`)
  * `sortBy`: string matching sortable database columns (e.g., `createdAt`, `amountPaisa`, `rating`, `scheduledStart`)
  * `sortOrder`: `'asc'` | `'desc'` (default: `'desc'`)
* **Standard Response Envelope:**
  ```json
  {
    "items": [...],
    "pagination": {
      "total": 1420,
      "page": 1,
      "pageSize": 20,
      "totalPages": 71,
      "hasMore": true
    }
  }
  ```

#### Standard B: Cursor-Based Standard (For High-Throughput Append Logs & Streams)
Used for Double-Entry Ledger, Notifications, and Audit Logs:
* **Request Query Parameters:**
  * `limit`: integer $1..200$ (default: `50`)
  * `before`: integer ID or ISO timestamp token
  * `after`: integer ID or ISO timestamp token
* **Standard Response Envelope:**
  ```json
  {
    "items": [...],
    "pagination": {
      "limit": 50,
      "nextBefore": 10370,
      "prevAfter": 10420,
      "hasMore": true,
      "totalCount": 184920
    }
  }
  ```

---

### P1.4 — Detailed Listing Endpoints Requiring Pagination

| Endpoint | Target Domain | Current State & Limitation | Required Query Parameters & Behavior | Response Format |
|---|---|---|---|---|
| `GET /api/v1/finance/ledger` | Finance | Uses `before` cursor and `limit` (max 200). Missing `totalCount`, date range filters, and transaction type filters. | Add `from` & `to` (ISO dates), `accountType`, `transactionType` (`CAPTURE`, `RELEASE`, `REFUND`), `direction` (`DEBIT`, `CREDIT`), and return `totalCount`. | Standard B (Cursor) |
| `GET /api/v1/finance/debts` | Finance | Returns unpaginated array `{ totalDebtPaisa, items: [...] }`. Hundreds of providers will overwhelm response. | Add `page`, `limit` (default 20, max 100), `isBlocked` boolean filter, sort by `debtPaisa` desc/asc. | Standard A (Page-based) |
| `GET /api/v1/finance/escrow` | Finance | Hardcoded to `LIMIT 500` in SQL with no pagination. | Remove hardcoded 500 limit. Support `page`, `limit`, filter by `status` and `paymentMode`. | Standard A (Page-based) |
| `GET /api/v1/finance/refunds` | Finance | Unpaginated array of refunds. | Add `page`, `limit`, filter by `status` (`PENDING`, `COMPLETED`, `REJECTED`), and date range `from`/`to`. | Standard A (Page-based) |
| `GET /api/v1/finance/payouts` | Finance / Provider | Unpaginated list of payout requests. | Add `page`, `limit`, `status` (`REQUESTED`, `PROCESSING`, `PAID`, `REJECTED`), date range. | Standard A (Page-based) |
| `GET /api/v1/finance/payout-batches` | Finance | Unpaginated list of payout batches. | Add `page`, `limit`, `status` (`PENDING`, `PAID`). | Standard A (Page-based) |
| `GET /api/v1/finance/cash-reconciliation` | Finance | Unpaginated reconciliation records. | Add `page`, `limit`, filter by reconciled status and date range. | Standard A (Page-based) |
| `GET /api/v1/bookings` | Customer & Provider | Unpaginated array of all lifetime bookings. | Add `page`, `limit`, filter by `status` (or multi-status comma-separated), `dateFrom`, `dateTo`, sorting by `scheduledStart`. | Standard A (Page-based) |
| `GET /api/v1/agent/queue` | Operations Agent | Unpaginated queue of jobs awaiting verification. | Add `page`, `limit`, `slaBreached: boolean`, sort by `slaDueAt` ASC (most urgent first). | Standard A (Page-based) |
| `GET /api/v1/notifications` | All Users | Notification list grows unbounded. | Add `limit` (default 20, max 50), `before` cursor, `unreadOnly: boolean`, return `X-Unread-Count` response header. | Standard B (Cursor) |
| `GET /api/v1/provider/ratings` | Provider / Public | Unpaginated list of customer reviews. | Add `page`, `limit`, filter by `minScore` (1..5), `hasReply: boolean`, sort by date. | Standard A (Page-based) |
| `GET /api/v1/admin/customers` | Admin | Missing pagination and search query. | Add `q` (name, email, phone search), `status` (`ACTIVE`, `LOCKED`, `DEACTIVATED`), `page`, `limit` (default 20). | Standard A (Page-based) |
| `GET /api/v1/admin/providers` | Admin | Currently missing queue endpoint for applicant providers. | Add `status` (`PENDING_APPROVAL`, `APPROVED`, `BLOCKED`, `SUSPENDED`), `cityId`, `tradeId`, `page`, `limit`. | Standard A (Page-based) |
| `GET /api/v1/admin/disputes` | Admin | Unpaginated disputes list. | Add `page`, `limit`, `status` (`OPEN`, `RESOLVED`, `REJECTED`), `origin`, sort by urgency. | Standard A (Page-based) |
| `GET /api/v1/complaints` | Admin / Operations | Unpaginated complaints list. | Add `page`, `limit`, `status` (`PENDING`, `INVESTIGATING`, `RESOLVED`), `severity`, `slaBreached: boolean`. | Standard A (Page-based) |
| `GET /api/v1/admin/audit-logs` | Admin | Millions of high-frequency audit rows. | Mandatory cursor-based pagination: `before`, `limit`, `actorUserId`, `entityType`, `action`, `dateFrom`, `dateTo`. | Standard B (Cursor) |
| `GET /api/v1/search/providers` | Customer / Public | Rigid `.strict()` query without pagination metadata. | Add `page`, `limit` (default 12, max 50), returning `totalCount` and `totalPages` to power search pagination controls. | Standard A (Page-based) |

---

## 4. P1 — Admin & Operations Gaps Identified in TASKS_FRONTEND.md

### P1.5 — Admin Provider Approval Queue with Status Filtering
* **Reference in TASKS_FRONTEND.md:** Phase 1 — Admin (`Provider approval queue: review documents, approve/reject with reason — ⬜ blocked`)
* **Current Behavior:**
  - The only admin user listing endpoint is `GET /api/v1/admin/users?role=PROVIDER`, which exposes `user_status` (`ACTIVE`, `LOCKED`, `DEACTIVATED`) but **not `provider_status`** (`PENDING_APPROVAL`, `APPROVED`, `SUSPENDED`, `BLOCKED`).
  - While decision mutations exist (`POST /admin/providers/:id/approve` and `reject`), there is no query endpoint to load the queue of applicants awaiting decision.
* **Required Backend Enhancement:**
  - Add `GET /api/v1/admin/providers?status=PENDING_APPROVAL` returning applicant name, phone, trade, city, pending documents count, and application timestamp with pagination.

---

### P1.6 — Platform-Wide Admin Bookings Directory
* **Reference in TASKS_FRONTEND.md:** Phase 3/5 — Admin (`Operations board: today's bookings by state... ⬜ blocked: GET /bookings is CUSTOMER, PROVIDER only`)
* **Current Behavior:**
  - `GET /api/v1/bookings` is scoped strictly to the authenticated customer or provider.
  - The operations control room (`/admin/ops`) has no endpoint to list platform-wide bookings.
* **Required Backend Enhancement:**
  - Add `GET /api/v1/admin/bookings` with filtering by:
    * `status` (or multiple statuses)
    * `dateFrom`, `dateTo`
    * `cityId`
    * `providerId`, `customerId`
    * `isEmergency: boolean`
    * Standard pagination (`page`, `limit`).

---

### P1.7 — Checklist Items Admin Reader
* **Current Behavior:**
  - Admins can write checklists via `PUT /admin/catalogue/services/:id/checklist`, but cannot read existing checklists via a `GET` endpoint.
* **Required Backend Enhancement:**
  - Add `GET /api/v1/admin/catalogue/services/:id/checklist`.

---

## 5. P2 — Additional Features Blocked by Backend in TASKS_FRONTEND.md

### P2.1 — Maintenance Plans Backend
* **Reference in TASKS_FRONTEND.md:** Phase 5 — Customer (`Maintenance plans: browse, subscribe, view remaining entitlements & renewal date, cancel — ⬜ no maintenance-plan endpoint exists on the API`)
* **Current Behavior:**
  - The frontend has UI for maintenance plans (`/plans`), but `apps/api` has no tables, schemas, or controllers for plans.
* **Required Backend Enhancement:**
  - Implement `PlansController` (`GET /plans`, `POST /plans/:id/subscribe`, `GET /me/plan`, `POST /me/plan/cancel`).

---

### P2.2 — Admin Reporting Engine
* **Reference in TASKS_FRONTEND.md:** Phase 5 — Admin (`Reports screen: monthly, revenue, provider performance, verification — ⬜ blocked on GET /admin/reports`)
* **Current Behavior:**
  - `GET /api/v1/admin/reports` does not exist; reporting views cannot fetch aggregate metrics.
* **Required Backend Enhancement:**
  - Implement `GET /api/v1/admin/reports` supporting report types: `MONTHLY_REVENUE`, `PROVIDER_PERFORMANCE`, `VERIFICATION_SUMMARY`, `DISPUTE_METRICS`.

---

### P2.3 — Audit Log Reader
* **Reference in TASKS_FRONTEND.md:** Phase 1 — Admin (`Audit log viewer — ⬜ blocked: audit_log is written by AuditService but no controller reads it`)
* **Current Behavior:**
  - `audit_log` rows are recorded in PostgreSQL by `AuditService`, but there is no admin API route to query them.
* **Required Backend Enhancement:**
  - Implement `GET /api/v1/admin/audit-logs` with filters for `actorUserId`, `entityType`, `action`, and `dateRange` with cursor pagination.

---

### P2.4 — Roles & Permissions Management API
* **Reference in TASKS_FRONTEND.md:** Phase 1 — Admin (`Roles & permissions screen — ⬜ blocked on GET /admin/roles`)
* **Current Behavior:**
  - Roles are hardcoded in policy decorators (`CUSTOMER`, `PROVIDER`, `ADMIN`, `AGENT`, `FINANCE`); there is no API to inspect role capabilities or assign staff permissions dynamically.
* **Required Backend Enhancement:**
  - Implement `GET /api/v1/admin/roles` and `PATCH /api/v1/admin/users/:id/role`.

---

### P2.5 — Public Feed of Verified Recent Reviews
* **Reference in TASKS_FRONTEND.md:** Phase 3 — Customer / Public
* **Current Behavior:**
  - Only `GET /api/v1/search/providers/:providerId/remarks` exists (per provider).
  - There is no platform-wide endpoint to display verified recent customer reviews on the homepage.
* **Required Backend Enhancement:**
  - Implement `GET /api/v1/search/remarks?limit=10` returning published, verified platform reviews with customer first name, service name, score, and remarks text.

---

## 6. Summary Endpoint Action Checklist for Backend Team

| Priority | Endpoint | Method | Status | Description |
|---|---|---|---|---|
| **P0** | `/api/v1/bookings` | `POST` | Update | Accept `photos` array directly on booking creation. |
| **P0** | `/api/v1/me/avatar` | `POST` | **New** | Upload customer profile picture. |
| **P0** | `/api/v1/provider/avatar` | `POST` | **New** | Upload provider professional portrait. |
| **P0** | `/api/v1/search/providers` | `GET` | Update | Join `users` table: return `firstName`, `lastName`, and `avatarUrl`. |
| **P0** | `/api/v1/storage/*` | `GET` | Update | Stream direct binary with `Content-Type` headers in production. |
| **P1** | `/api/v1/finance/ledger` | `GET` | Update | Add `totalCount`, date ranges `from`/`to`, `type`, and `direction` filters. |
| **P1** | `/api/v1/finance/debts` | `GET` | Update | Add page-based pagination (`page`, `limit`), sort by `debtPaisa`, `isBlocked` filter. |
| **P1** | `/api/v1/finance/escrow` | `GET` | Update | Remove hardcoded `LIMIT 500`, add pagination and status filters. |
| **P1** | `/api/v1/finance/refunds` | `GET` | Update | Add pagination (`page`, `limit`) and status filter. |
| **P1** | `/api/v1/finance/payouts` | `GET` | Update | Add pagination (`page`, `limit`) and status filter. |
| **P1** | `/api/v1/bookings` | `GET` | Update | Add pagination (`page`, `limit`), status filter, date ranges. |
| **P1** | `/api/v1/agent/queue` | `GET` | Update | Add pagination (`page`, `limit`) and `slaBreached` filter. |
| **P1** | `/api/v1/notifications` | `GET` | Update | Add cursor pagination (`before`, `limit`), `unreadOnly` filter. |
| **P1** | `/api/v1/search/providers` | `GET` | Update | Make `serviceSlug`, `lat`, `lng` optional; add sorting, filtering, and pagination envelope. |
| **P1** | `/api/v1/admin/providers` | `GET` | **New** | Queue of providers filtered by `provider_status` (`PENDING_APPROVAL`) with pagination. |
| **P1** | `/api/v1/admin/bookings` | `GET` | **New** | Platform-wide bookings directory for ops console with pagination. |
| **P2** | `/api/v1/plans` | `GET`/`POST` | **New** | Maintenance plans catalog and subscriptions. |
| **P2** | `/api/v1/admin/reports` | `GET` | **New** | Platform operational and revenue reports. |
| **P2** | `/api/v1/admin/audit-logs` | `GET` | **New** | Audit trail inquiry endpoint with cursor pagination. |
| **P2** | `/api/v1/search/remarks` | `GET` | **New** | Global verified review feed for public homepage. |