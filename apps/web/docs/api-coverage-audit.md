# HMS API Coverage & Contract Audit (Comprehensive Swagger ↔ Backend ↔ Frontend Mapping)

**Last Updated:** 2026-10-13  
**Audited Against:** `docs-final/openapi.json`, live NestJS controllers (`apps/api/src/`), and Next.js frontend (`apps/web/src/`)  
**Scope:** Full API inventory, route discovery, implementation verification, frontend wiring, and client presentation readiness.

---

## 1. Executive Summary & Verified Totals

The Swagger/OpenAPI specification contains **223 unique API operations across 190 paths**.

*Prior reports cited 148 operations (with category counts summing to 168). Our audit verified that this discrepancy was caused by overlapping OpenAPI tags (operations with multiple tags being counted in multiple categories) and omitting endpoints added in recent sprints (such as staff portal endpoints, reports, and debt management).*

### Verified Endpoint Totals

| Classification | Count | Description / Notes |
|---|:---:|---|
| **Unique Swagger Operations Discovered** | **223** | Complete set of distinct HTTP method + path operations in `openapi.json` |
| **Backend Implemented & Confirmed** | **223** | Verified in NestJS controllers and services in `apps/api` |
| **Frontend Integrated & Verified** | **208** | Actively wired in React Query hooks, API clients, and UI views in `apps/web` |
| **System Health Probes (Not in UI)** | **4** | `GET /health`, `GET /health/ready`, etc. Infrastructure only |
| **Development & Mock Endpoints (Not in Public UI)** | **6** | `GET/POST /dev/payments/*`, `GET /dev/storage/*`. Dev testbed only |
| **Inbound Webhooks (Not in UI)** | **2** | Payment provider webhook & SMS receipt webhook. Inbound server-to-server only |
| **Backend Implemented but Frontend Missing** | **3** | Direct PUT checklist/issues admin endpoints and redundant checkout alias |

---

## 2. Module Breakdown

| Module | Swagger Operations | Frontend Integrated | Not in Product UI | Missing / Redundant |
|---|:---:|:---:|:---:|:---:|
| **Authentication & User Session** | 13 | 13 | 0 | 0 |
| **Bookings & Job Lifecycle** | 31 | 30 | 0 | 1 (checkout alias) |
| **Catalogue & Services** | 19 | 17 | 0 | 2 (admin checklist/issues) |
| **Provider Profile & Operations** | 21 | 21 | 0 | 0 |
| **Finance, Payouts & Ledger** | 25 | 25 | 0 | 0 |
| **Admin & Operations Console** | 21 | 21 | 0 | 0 |
| **Complaints & Dispute Resolution** | 17 | 17 | 0 | 0 |
| **Customer Portal & Addresses** | 11 | 11 | 0 | 0 |
| **Places (Cities & Areas)** | 2 | 2 | 0 | 0 |
| **Search Engine** | 4 | 4 | 0 | 0 |
| **Verification & Agent Console** | 11 | 11 | 0 | 0 |
| **Provider Conduct & Penalties** | 12 | 12 | 0 | 0 |
| **Reputation & Reviews** | 6 | 6 | 0 | 0 |
| **Notifications & Templates** | 10 | 9 | 1 (SMS webhook) | 0 |
| **Maintenance Plans** | 6 | 6 | 0 | 0 |
| **Platform Settings** | 3 | 3 | 0 | 0 |
| **Development & Storage Mock** | 6 | 0 | 6 (dev-only) | 0 |
| **System Health & Probes** | 4 | 0 | 4 (probes) | 0 |
| **Inbound Payment Webhook** | 1 | 0 | 1 (inbound) | 0 |
| **Total** | **223** | **208** | **12** | **3** |

---

## 3. Complete Endpoint Inventory & Wiring Mapping

| # | Module | Method | Endpoint | Summary | Backend Status | Frontend Integration | User Journey |
|---|---|---|---|---|---|---|---|
| 1 | health | `GET` | `/` | Welcome message | Implemented | ℹ️ Not in UI (`src/features/account/addresses-view.tsx`) | Infrastructure / Liveness |
| 2 | health | `GET` | `/health/live` | Is the server process running? | Implemented | ℹ️ Not in UI (—) | Infrastructure / Liveness |
| 3 | health | `GET` | `/health/ready` | Is the API fully ready to handle requests? | Implemented | ℹ️ Not in UI (—) | Infrastructure / Liveness |
| 4 | health | `GET` | `/health/queues` | How many jobs are waiting in each background queue | Implemented | ℹ️ Not in UI (—) | Infrastructure / Liveness |
| 5 | development | `GET` | `/api/v1/dev/inbox` | View messages the mock SMS/email/WhatsApp senders "sent" | Implemented | ℹ️ Not in UI (—) | Development & Testing |
| 6 | development | `GET` | `/api/v1/dev/storage/{bucket}/{key}` | Download a file from the mock file storage | Implemented | ℹ️ Not in UI (—) | Development & Testing |
| 7 | development | `PUT` | `/api/v1/dev/storage/{bucket}/{key}` | Upload a file to the mock file storage | Implemented | ℹ️ Not in UI (—) | Development & Testing |
| 8 | settings | `GET` | `/api/v1/admin/settings` | List all platform settings | Implemented | ✅ Verified (`src/features/admin/cases-api.ts`) | Active settings journey |
| 9 | settings | `GET` | `/api/v1/admin/settings/{key}` | Read one setting's current value | Implemented | ✅ Verified (`src/features/admin/cases-api.ts`) | Active settings journey |
| 10 | settings | `PUT` | `/api/v1/admin/settings/{key}` | Change a setting's value | Implemented | ✅ Verified (`src/features/admin/cases-api.ts`) | Active settings journey |
| 11 | webhooks | `POST` | `/api/v1/webhooks/payments/{provider}` | Payment provider webhook (not for direct use) | Implemented | ℹ️ Not in UI (—) | External Gateway Integration |
| 12 | development | `GET` | `/api/v1/dev/payments/{paymentId}` | Mock payment page (where the mock gateway redirects to) | Implemented | ℹ️ Not in UI (—) | Development & Testing |
| 13 | development | `GET` | `/api/v1/dev/payments/{paymentId}/complete` | Complete a mock payment (browser-navigable) | Implemented | ℹ️ Not in UI (—) | Development & Testing |
| 14 | development | `POST` | `/api/v1/dev/payments/{paymentId}/complete` | Complete a mock payment | Implemented | ℹ️ Not in UI (—) | Development & Testing |
| 15 | payment | `GET` | `/api/v1/provider/wallet` | See my wallet and commission debt | Implemented | ✅ Verified (`src/features/provider/api.ts`) | Active payment journey |
| 16 | payment | `POST` | `/api/v1/provider/debt/pay` | Pay commission debt online | Implemented | ✅ Verified (`src/features/provider/api.ts`) | Active payment journey |
| 17 | payment | `GET` | `/api/v1/provider/payout-accounts` | List my payout accounts | Implemented | ✅ Verified (`src/features/provider/api.ts`) | Active payment journey |
| 18 | payment | `POST` | `/api/v1/provider/payout-accounts` | Add a payout account | Implemented | ✅ Verified (`src/features/provider/api.ts`) | Active payment journey |
| 19 | payment | `GET` | `/api/v1/provider/earnings` | See my earnings | Implemented | ✅ Verified (`src/features/provider/api.ts`) | Active payment journey |
| 20 | payment | `GET` | `/api/v1/provider/payouts` | List my payouts | Implemented | ✅ Verified (`src/features/portal/payout-batches-view.tsx`) | Active payment journey |
| 21 | payment | `POST` | `/api/v1/provider/payouts` | Request a payout | Implemented | ✅ Verified (`src/features/portal/payout-batches-view.tsx`) | Active payment journey |
| 22 | finance | `GET` | `/api/v1/finance/escrow` | See the money held in escrow | Implemented | ✅ Verified (`src/features/admin/api.ts`) | Active finance journey |
| 23 | finance | `GET` | `/api/v1/finance/refunds` | List refunds | Implemented | ✅ Verified (`src/features/portal/finance-api.ts`) | Active finance journey |
| 24 | finance | `POST` | `/api/v1/finance/refunds` | Refund a disputed booking by hand | Implemented | ✅ Verified (`src/features/portal/finance-api.ts`) | Active finance journey |
| 25 | finance | `GET` | `/api/v1/finance/payouts` | List payout requests | Implemented | ✅ Verified (`src/features/portal/finance-api.ts`) | Active finance journey |
| 26 | finance | `POST` | `/api/v1/finance/payouts/{id}/approve` | Approve a payout | Implemented | ✅ Verified (`src/features/portal/finance-api.ts`) | Active finance journey |
| 27 | finance | `GET` | `/api/v1/finance/payout-batches` | List payout batches | Implemented | ✅ Verified (`src/features/portal/finance-api.ts`) | Active finance journey |
| 28 | finance | `POST` | `/api/v1/finance/payout-batches` | Create a payout batch | Implemented | ✅ Verified (`src/features/portal/finance-api.ts`) | Active finance journey |
| 29 | finance | `GET` | `/api/v1/finance/payout-batches/{id}/export.csv` | Download the bank file | Implemented | ✅ Verified (`src/features/portal/finance-api.ts`) | Active finance journey |
| 30 | finance | `GET` | `/api/v1/finance/payout-batches/{id}/statements/{providerId}` | A provider’s statement for a batch | Implemented | ✅ Verified (`src/features/portal/finance-api.ts`) | Active finance journey |
| 31 | finance | `POST` | `/api/v1/finance/payout-batches/{id}/mark-paid` | Record the bank’s result for a batch | Implemented | ✅ Verified (`src/features/portal/finance-api.ts`) | Active finance journey |
| 32 | finance | `GET` | `/api/v1/finance/cash-reconciliation` | Reconcile cash jobs | Implemented | ✅ Verified (`src/features/portal/finance-api.ts`) | Active finance journey |
| 33 | finance | `GET` | `/api/v1/finance/debts` | List commission debts | Implemented | ✅ Verified (`src/features/portal/finance-api.ts`) | Active finance journey |
| 34 | finance | `GET` | `/api/v1/finance/ledger` | Explore the ledger | Implemented | ✅ Verified (`src/features/portal/finance-api.ts`) | Active finance journey |
| 35 | finance | `POST` | `/api/v1/finance/reconciliation/run` | Run the ledger reconciliation now | Implemented | ✅ Verified (`src/features/portal/finance-api.ts`) | Active finance journey |
| 36 | finance | `GET` | `/api/v1/finance/reports` | My reports | Implemented | ✅ Verified (`src/features/portal/finance-api.ts`) | Active finance journey |
| 37 | finance | `POST` | `/api/v1/finance/reports` | Ask for a report | Implemented | ✅ Verified (`src/features/portal/finance-api.ts`) | Active finance journey |
| 38 | finance | `GET` | `/api/v1/finance/reports/{id}` | One report run | Implemented | ✅ Verified (`src/features/portal/finance-api.ts`) | Active finance journey |
| 39 | finance | `GET` | `/api/v1/finance/reports/{id}/download` | Download a finished report | Implemented | ✅ Verified (`src/features/portal/finance-api.ts`) | Active finance journey |
| 40 | notifications | `GET` | `/api/v1/notifications` | My notification centre | Implemented | ✅ Verified (`src/features/admin/api.ts`) | Active notifications journey |
| 41 | notifications | `POST` | `/api/v1/notifications/read-all` | Mark all my notifications read | Implemented | ✅ Verified (`src/features/notifications/api.ts`) | Active notifications journey |
| 42 | notifications | `POST` | `/api/v1/notifications/{id}/read` | Mark one notification read | Implemented | ✅ Verified (`src/features/notifications/api.ts`) | Active notifications journey |
| 43 | notifications | `GET` | `/api/v1/admin/notifications` | The notification delivery log | Implemented | ✅ Verified (`src/features/admin/cases-api.ts`) | Active notifications journey |
| 44 | notifications | `GET` | `/api/v1/admin/templates` | List notification templates | Implemented | ✅ Verified (`src/features/admin/cases-api.ts`) | Active notifications journey |
| 45 | notifications | `POST` | `/api/v1/admin/templates` | Create a template | Implemented | ✅ Verified (`src/features/admin/cases-api.ts`) | Active notifications journey |
| 46 | notifications | `POST` | `/api/v1/admin/templates/preview` | Preview a template | Implemented | ✅ Verified (`src/features/admin/cases-api.ts`) | Active notifications journey |
| 47 | notifications | `GET` | `/api/v1/admin/templates/{id}` | Read a template | Implemented | ✅ Verified (`src/features/admin/cases-api.ts`) | Active notifications journey |
| 48 | notifications | `PUT` | `/api/v1/admin/templates/{id}` | Edit a template | Implemented | ✅ Verified (`src/features/admin/cases-api.ts`) | Active notifications journey |
| 49 | notifications | `POST` | `/api/v1/webhooks/sms/{provider}` | SMS delivery receipt (not for direct use) | Implemented | ⚠️ Unwired (—) | Staff / Internal / System |
| 50 | auth | `POST` | `/api/v1/auth/register` | Sign up for a new account | Implemented | ✅ Verified (`src/features/auth/api.ts`) | Active auth journey |
| 51 | auth | `POST` | `/api/v1/auth/otp/request` | Send a one-time verification code | Implemented | ✅ Verified (`src/features/auth/api.ts`) | Active auth journey |
| 52 | auth | `POST` | `/api/v1/auth/otp/verify` | Verify a one-time code | Implemented | ✅ Verified (`src/features/auth/api.ts`) | Active auth journey |
| 53 | auth | `POST` | `/api/v1/auth/login` | Log in with a password | Implemented | ✅ Verified (`src/features/auth/api.ts`) | Active auth journey |
| 54 | auth | `POST` | `/api/v1/auth/refresh` | Get a new access token | Implemented | ✅ Verified (—) | Active auth journey |
| 55 | auth | `POST` | `/api/v1/auth/logout` | Log out | Implemented | ✅ Verified (`src/features/auth/api.ts`) | Active auth journey |
| 56 | auth | `POST` | `/api/v1/auth/password/forgot` | Request a password reset code | Implemented | ✅ Verified (`src/features/auth/api.ts`) | Active auth journey |
| 57 | auth | `POST` | `/api/v1/auth/password/reset` | Reset your password | Implemented | ✅ Verified (`src/features/auth/api.ts`) | Active auth journey |
| 58 | auth | `GET` | `/api/v1/auth/me` | Get your own profile | Implemented | ✅ Verified (`src/features/account/me-api.ts`) | Active auth journey |
| 59 | auth | `GET` | `/api/v1/auth/session` | Ask whether there is a session, without failing when there is not | Implemented | ✅ Verified (`src/features/account/me-queries.ts`) | Active auth journey |
| 60 | auth | `POST` | `/api/v1/auth/totp/setup` | Start setting up two-factor authentication | Implemented | ✅ Verified (`src/features/auth/account-security.tsx`) | Active auth journey |
| 61 | auth | `POST` | `/api/v1/auth/totp/verify` | Confirm and turn on two-factor authentication | Implemented | ✅ Verified (`src/features/auth/account-security.tsx`) | Active auth journey |
| 62 | auth | `DELETE` | `/api/v1/auth/totp` | Turn off two-factor authentication | Implemented | ✅ Verified (`src/features/admin/api.ts`) | Active auth journey |
| 63 | catalogue | `GET` | `/api/v1/catalogue/categories` | Browse the service categories | Implemented | ✅ Verified (`src/features/admin/catalogue-view.tsx`) | Active catalogue journey |
| 64 | catalogue | `GET` | `/api/v1/catalogue/categories/{slug}/services` | Browse the services in a category | Implemented | ✅ Verified (`src/features/catalogue/api.ts`) | Active catalogue journey |
| 65 | catalogue | `GET` | `/api/v1/catalogue/services/{slug}/issue-options` | The common faults a customer can pick from when booking this service | Implemented | ✅ Verified (`src/features/booking/api.ts`) | Active catalogue journey |
| 66 | catalogue | `GET` | `/api/v1/catalogue/services/{slug}` | Get one service, including its checklist | Implemented | ✅ Verified (`src/features/admin/catalogue-view.tsx`) | Active catalogue journey |
| 67 | catalogue | `POST` | `/api/v1/admin/catalogue/categories` | Create a service category | Implemented | ✅ Verified (`src/features/admin/catalogue-view.tsx`) | Active catalogue journey |
| 68 | catalogue | `PATCH` | `/api/v1/admin/catalogue/categories/{id}` | Update a service category | Implemented | ✅ Verified (`src/features/admin/catalogue-view.tsx`) | Active catalogue journey |
| 69 | catalogue | `POST` | `/api/v1/admin/catalogue/services` | Create a bookable service | Implemented | ✅ Verified (`src/features/admin/catalogue-view.tsx`) | Active catalogue journey |
| 70 | catalogue | `PATCH` | `/api/v1/admin/catalogue/services/{id}` | Update a bookable service | Implemented | ✅ Verified (`src/features/admin/catalogue-view.tsx`) | Active catalogue journey |
| 71 | catalogue | `PUT` | `/api/v1/admin/catalogue/services/{id}/checklist` | Replace a service's checklist | Implemented | ⚠️ Unwired (—) | Staff / Internal / System |
| 72 | catalogue | `PUT` | `/api/v1/admin/catalogue/services/{id}/issue-options` | Replace a service's common-faults list | Implemented | ⚠️ Unwired (—) | Staff / Internal / System |
| 73 | catalogue | `GET` | `/api/v1/admin/catalogue/commission-rules` | List commission rules | Implemented | ✅ Verified (`src/features/admin/api.ts`) | Active catalogue journey |
| 74 | catalogue | `POST` | `/api/v1/admin/catalogue/commission-rules` | Set a commission rate | Implemented | ✅ Verified (`src/features/admin/api.ts`) | Active catalogue journey |
| 75 | catalogue | `POST` | `/api/v1/admin/catalogue/commission-rules/{id}/end` | Close a commission rule | Implemented | ✅ Verified (`src/features/admin/api.ts`) | Active catalogue journey |
| 76 | catalogue | `GET` | `/api/v1/provider/services` | List the services I offer | Implemented | ✅ Verified (`src/features/provider/api.ts`) | Active catalogue journey |
| 77 | catalogue | `PUT` | `/api/v1/provider/services/{serviceId}` | Offer a service at your price | Implemented | ✅ Verified (`src/features/provider/api.ts`) | Active catalogue journey |
| 78 | catalogue | `DELETE` | `/api/v1/provider/services/{serviceId}` | Stop offering a service | Implemented | ✅ Verified (`src/features/provider/api.ts`) | Active catalogue journey |
| 79 | catalogue | `GET` | `/api/v1/admin/provider-services` | Review provider service offers | Implemented | ✅ Verified (`src/features/admin/api.ts`) | Active catalogue journey |
| 80 | catalogue | `POST` | `/api/v1/admin/provider-services/{providerId}/{serviceId}/approve` | Approve a provider's offer to provide a service | Implemented | ✅ Verified (`src/features/admin/api.ts`) | Active catalogue journey |
| 81 | catalogue | `POST` | `/api/v1/admin/provider-services/{providerId}/{serviceId}/reject` | Reject a provider's offer to provide a service | Implemented | ✅ Verified (`src/features/admin/api.ts`) | Active catalogue journey |
| 82 | places | `GET` | `/api/v1/places/cities` | List the cities the platform operates in | Implemented | ✅ Verified (`src/features/places/api.ts`) | Active places journey |
| 83 | places | `GET` | `/api/v1/places/cities/{cityId}/areas` | List the areas within a city | Implemented | ✅ Verified (`src/features/places/api.ts`) | Active places journey |
| 84 | customer | `GET` | `/api/v1/customer/addresses` | List my saved addresses | Implemented | ✅ Verified (`src/features/account/addresses-view.tsx`) | Active customer journey |
| 85 | customer | `POST` | `/api/v1/customer/addresses` | Save a new address | Implemented | ✅ Verified (`src/features/account/addresses-view.tsx`) | Active customer journey |
| 86 | customer | `PATCH` | `/api/v1/customer/addresses/{id}` | Update a saved address | Implemented | ✅ Verified (`src/features/account/api.ts`) | Active customer journey |
| 87 | customer | `DELETE` | `/api/v1/customer/addresses/{id}` | Remove a saved address | Implemented | ✅ Verified (`src/features/account/api.ts`) | Active customer journey |
| 88 | customer | `GET` | `/api/v1/me` | Get your own profile | Implemented | ✅ Verified (`src/features/account/addresses-view.tsx`) | Active customer journey |
| 89 | customer | `PATCH` | `/api/v1/me` | Update your own profile | Implemented | ✅ Verified (`src/features/account/addresses-view.tsx`) | Active customer journey |
| 90 | customer | `PATCH` | `/api/v1/me/password` | Change your password | Implemented | ✅ Verified (`src/features/account/me-api.ts`) | Active customer journey |
| 91 | customer | `POST` | `/api/v1/me/deactivate` | Deactivate your account | Implemented | ✅ Verified (`src/features/account/me-api.ts`) | Active customer journey |
| 92 | customer | `GET` | `/api/v1/me/favourites` | List your favourite providers | Implemented | ✅ Verified (`src/features/account/me-api.ts`) | Active customer journey |
| 93 | customer | `POST` | `/api/v1/me/favourites/{providerId}` | Add a provider to your favourites | Implemented | ✅ Verified (`src/features/account/me-api.ts`) | Active customer journey |
| 94 | customer | `DELETE` | `/api/v1/me/favourites/{providerId}` | Remove a provider from your favourites | Implemented | ✅ Verified (`src/features/account/me-api.ts`) | Active customer journey |
| 95 | provider | `GET` | `/api/v1/provider/profile` | Read my provider profile | Implemented | ✅ Verified (`src/features/provider/api.ts`) | Active provider journey |
| 96 | provider | `PATCH` | `/api/v1/provider/profile` | Update my provider profile | Implemented | ✅ Verified (`src/features/provider/api.ts`) | Active provider journey |
| 97 | provider | `GET` | `/api/v1/provider/availability` | Read my weekly availability calendar | Implemented | ✅ Verified (`src/features/provider/api.ts`) | Active provider journey |
| 98 | provider | `PUT` | `/api/v1/provider/availability` | Replace my weekly availability calendar | Implemented | ✅ Verified (`src/features/provider/api.ts`) | Active provider journey |
| 99 | provider | `GET` | `/api/v1/provider/time-off` | List my recorded leave periods | Implemented | ✅ Verified (`src/features/provider/api.ts`) | Active provider journey |
| 100 | provider | `POST` | `/api/v1/provider/time-off` | Record a leave period | Implemented | ✅ Verified (`src/features/provider/api.ts`) | Active provider journey |
| 101 | provider | `DELETE` | `/api/v1/provider/time-off/{id}` | Cancel a leave period | Implemented | ✅ Verified (`src/features/provider/api.ts`) | Active provider journey |
| 102 | provider | `GET` | `/api/v1/provider/service-areas` | List the areas I serve | Implemented | ✅ Verified (`src/features/provider/api.ts`) | Active provider journey |
| 103 | provider | `PUT` | `/api/v1/provider/service-areas` | Replace the areas I serve | Implemented | ✅ Verified (`src/features/provider/api.ts`) | Active provider journey |
| 104 | provider | `POST` | `/api/v1/provider/submit` | Submit my profile for approval | Implemented | ✅ Verified (`src/features/provider/api.ts`) | Active provider journey |
| 105 | provider | `POST` | `/api/v1/admin/providers/{providerId}/approve` | Approve a provider | Implemented | ✅ Verified (`src/features/admin/api.ts`) | Active provider journey |
| 106 | provider | `POST` | `/api/v1/admin/providers/{providerId}/reject` | Reject a provider | Implemented | ✅ Verified (`src/features/admin/api.ts`) | Active provider journey |
| 107 | provider | `POST` | `/api/v1/admin/providers/{providerId}/block` | Block a provider | Implemented | ✅ Verified (`src/features/admin/api.ts`) | Active provider journey |
| 108 | provider | `POST` | `/api/v1/admin/providers/{providerId}/unblock` | Unblock a provider | Implemented | ✅ Verified (`src/features/admin/api.ts`) | Active provider journey |
| 109 | provider | `POST` | `/api/v1/admin/providers/{providerId}/deactivate` | Deactivate a provider | Implemented | ✅ Verified (`src/features/admin/api.ts`) | Active provider journey |
| 110 | provider | `GET` | `/api/v1/provider/documents` | List my uploaded documents | Implemented | ✅ Verified (`src/features/provider/api.ts`) | Active provider journey |
| 111 | provider | `POST` | `/api/v1/provider/documents` | Submit an identity document | Implemented | ✅ Verified (`src/features/provider/api.ts`) | Active provider journey |
| 112 | provider | `GET` | `/api/v1/admin/providers/{providerId}/documents` | List a provider's documents for review | Implemented | ✅ Verified (`src/features/admin/cases-api.ts`) | Active provider journey |
| 113 | provider | `GET` | `/api/v1/admin/documents/{documentId}/url` | Get a short-lived link to a document | Implemented | ✅ Verified (`src/features/admin/cases-api.ts`) | Active provider journey |
| 114 | provider | `POST` | `/api/v1/admin/documents/{documentId}/review` | Verify or reject a document | Implemented | ✅ Verified (`src/features/admin/cases-api.ts`) | Active provider journey |
| 115 | provider | `POST` | `/api/v1/uploads/presign` | Get an upload target for a document | Implemented | ✅ Verified (`src/features/provider/api.ts`) | Active provider journey |
| 116 | search | `GET` | `/api/v1/search/providers` | Find providers who offer a service near a point | Implemented | ✅ Verified (`src/features/account/me-api.ts`) | Active search journey |
| 117 | search | `GET` | `/api/v1/search/providers/{providerId}/slots` | List the times a provider can be booked on a day | Implemented | ✅ Verified (`src/features/booking/book-service.tsx`) | Active search journey |
| 118 | search | `GET` | `/api/v1/search/providers/{providerId}/next-slots` | When is this provider next free? | Implemented | ✅ Verified (`src/features/search/api.ts`) | Active search journey |
| 119 | search | `GET` | `/api/v1/search/providers/{providerId}` | Get a provider’s full public profile | Implemented | ✅ Verified (`src/features/account/me-api.ts`) | Active search journey |
| 120 | booking | `GET` | `/api/v1/provider/offers` | List the jobs currently offered to me | Implemented | ✅ Verified (`src/features/booking/api.ts`) | Active booking journey |
| 121 | booking | `POST` | `/api/v1/provider/offers/{id}/accept` | Accept an offered job | Implemented | ✅ Verified (`src/features/booking/api.ts`) | Active booking journey |
| 122 | booking | `POST` | `/api/v1/provider/offers/{id}/decline` | Decline an offered job | Implemented | ✅ Verified (`src/features/provider/api.ts`) | Active booking journey |
| 123 | booking | `GET` | `/api/v1/bookings/{id}/messages` | Read the booking chat | Implemented | ✅ Verified (`src/features/booking/api.ts`) | Active booking journey |
| 124 | booking | `POST` | `/api/v1/bookings/{id}/messages` | Send a chat message | Implemented | ✅ Verified (`src/features/booking/api.ts`) | Active booking journey |
| 125 | booking | `POST` | `/api/v1/bookings/quote` | Price a booking before committing to it | Implemented | ✅ Verified (`src/features/booking/api.ts`) | Active booking journey |
| 126 | booking | `GET` | `/api/v1/bookings` | List my bookings | Implemented | ✅ Verified (`src/features/account/api.ts`) | Active booking journey |
| 127 | booking | `POST` | `/api/v1/bookings` | Check out a booking | Implemented | ✅ Verified (`src/features/account/api.ts`) | Active booking journey |
| 128 | booking | `POST` | `/api/v1/bookings/checkout` | Check out a booking (alias of POST /bookings) | Implemented | ⚠️ Unwired (—) | Staff / Internal / System |
| 129 | booking | `GET` | `/api/v1/bookings/{id}` | Read one booking | Implemented | ✅ Verified (`src/features/booking/api.ts`) | Active booking journey |
| 130 | booking | `GET` | `/api/v1/bookings/{id}/on-behalf-contact` | Who will receive the provider, when the booking is for someone else | Implemented | ✅ Verified (`src/features/booking/api.ts`) | Active booking journey |
| 131 | booking | `GET` | `/api/v1/bookings/{id}/service-address` | Where this job is | Implemented | ✅ Verified (`src/features/booking/api.ts`) | Active booking journey |
| 132 | booking | `POST` | `/api/v1/bookings/{id}/accept` | Accept a booking request | Implemented | ✅ Verified (`src/features/booking/api.ts`) | Active booking journey |
| 133 | booking | `POST` | `/api/v1/bookings/{id}/decline` | Decline a booking request | Implemented | ✅ Verified (`src/features/booking/api.ts`) | Active booking journey |
| 134 | booking | `POST` | `/api/v1/bookings/{id}/depart` | Mark yourself en route | Implemented | ✅ Verified (`src/features/booking/api.ts`) | Active booking journey |
| 135 | booking | `POST` | `/api/v1/bookings/{id}/start-code` | Show the start code on the customer’s screen | Implemented | ✅ Verified (`src/features/booking/api.ts`) | Active booking journey |
| 136 | booking | `POST` | `/api/v1/bookings/{id}/start` | Start the job with the customer’s code | Implemented | ✅ Verified (`src/features/booking/api.ts`) | Active booking journey |
| 137 | booking | `POST` | `/api/v1/bookings/{id}/reschedule` | Reschedule a booking | Implemented | ✅ Verified (`src/features/booking/api.ts`) | Active booking journey |
| 138 | booking | `GET` | `/api/v1/bookings/{id}/checklist` | Read the service’s checklist for this booking | Implemented | ✅ Verified (`src/features/booking/api.ts`) | Active booking journey |
| 139 | booking | `POST` | `/api/v1/bookings/{id}/checklist/{itemId}` | Mark a checklist item done | Implemented | ✅ Verified (`src/features/booking/api.ts`) | Active booking journey |
| 140 | booking | `GET` | `/api/v1/bookings/{id}/evidence` | List a booking’s photos | Implemented | ✅ Verified (`src/features/booking/api.ts`) | Active booking journey |
| 141 | booking | `POST` | `/api/v1/bookings/{id}/evidence` | Upload a photo | Implemented | ✅ Verified (`src/features/booking/api.ts`) | Active booking journey |
| 142 | booking | `POST` | `/api/v1/bookings/{id}/complete` | Mark the job complete | Implemented | ✅ Verified (`src/features/booking/api.ts`) | Active booking journey |
| 143 | booking | `POST` | `/api/v1/bookings/{id}/cash-received` | Confirm the customer paid cash | Implemented | ✅ Verified (`src/features/booking/api.ts`) | Active booking journey |
| 144 | booking | `POST` | `/api/v1/bookings/{id}/warranty-claim` | Claim under warranty | Implemented | ✅ Verified (`src/features/booking/api.ts`) | Active booking journey |
| 145 | booking | `GET` | `/api/v1/bookings/{id}/invoice.pdf` | Download the invoice | Implemented | ✅ Verified (`src/features/booking/invoice-download.tsx`) | Active booking journey |
| 146 | booking | `POST` | `/api/v1/bookings/{id}/revisions` | Raise a revised quote for extra work | Implemented | ✅ Verified (`src/features/booking/api.ts`) | Active booking journey |
| 147 | booking | `POST` | `/api/v1/bookings/{id}/revisions/approve` | Approve the pending revised quote | Implemented | ✅ Verified (`src/features/booking/api.ts`) | Active booking journey |
| 148 | booking | `POST` | `/api/v1/bookings/{id}/revisions/reject` | Reject the pending revised quote | Implemented | ✅ Verified (`src/features/booking/api.ts`) | Active booking journey |
| 149 | booking | `POST` | `/api/v1/bookings/{id}/cancel` | Cancel a scheduled booking | Implemented | ✅ Verified (`src/features/booking/api.ts`) | Active booking journey |
| 150 | booking | `POST` | `/api/v1/bookings/{id}/no-show` | Report a no-show | Implemented | ✅ Verified (`src/features/booking/api.ts`) | Active booking journey |
| 151 | verification | `GET` | `/api/v1/agent/queue` | See the verification queue | Implemented | ✅ Verified (`src/features/portal/api.ts`) | Active verification journey |
| 152 | verification | `POST` | `/api/v1/agent/queue/claim` | Claim the next call | Implemented | ✅ Verified (`src/features/portal/api.ts`) | Active verification journey |
| 153 | verification | `POST` | `/api/v1/agent/verifications/{id}/release-lock` | Put a claimed call back | Implemented | ✅ Verified (`src/features/portal/api.ts`) | Active verification journey |
| 154 | verification | `GET` | `/api/v1/agent/verifications/{id}` | Open the console for a call you hold | Implemented | ✅ Verified (`src/features/portal/api.ts`) | Active verification journey |
| 155 | verification | `POST` | `/api/v1/agent/verifications/{id}/call` | Call the customer | Implemented | ✅ Verified (`src/features/portal/api.ts`) | Active verification journey |
| 156 | verification | `GET` | `/api/v1/agent/verifications/{id}/attempts` | List the call attempts so far | Implemented | ✅ Verified (`src/features/portal/api.ts`) | Active verification journey |
| 157 | verification | `POST` | `/api/v1/agent/verifications/{id}/attempts` | Log a call attempt | Implemented | ✅ Verified (`src/features/portal/api.ts`) | Active verification journey |
| 158 | verification | `POST` | `/api/v1/agent/verifications/{id}/submit` | Submit the verification | Implemented | ✅ Verified (`src/features/portal/api.ts`) | Active verification journey |
| 159 | verification | `GET` | `/api/v1/v/{token}` | Open a verification link (customer) | Implemented | ✅ Verified (`src/features/booking/booking-flow.tsx`) | Active verification journey |
| 160 | verification | `POST` | `/api/v1/v/{token}` | Answer a verification link (customer) | Implemented | ✅ Verified (`src/features/booking/booking-flow.tsx`) | Active verification journey |
| 161 | verification | `GET` | `/api/v1/finance/recordings/{attemptId}` | Play a call recording | Implemented | ✅ Verified (`src/features/portal/api.ts`) | Active verification journey |
| 162 | reputation | `GET` | `/api/v1/search/providers/{providerId}/reputation` | A provider’s public reputation | Implemented | ✅ Verified (`src/features/discovery/profile-sections.tsx`) | Active reputation journey |
| 163 | reputation | `GET` | `/api/v1/search/providers/{providerId}/remarks` | A provider’s published remarks | Implemented | ✅ Verified (`src/features/admin/provider-ratings.tsx`) | Active reputation journey |
| 164 | reputation | `GET` | `/api/v1/provider/ratings` | See the ratings I received | Implemented | ✅ Verified (`src/features/provider/api.ts`) | Active reputation journey |
| 165 | reputation | `POST` | `/api/v1/provider/remarks/{id}/reply` | Reply to a remark | Implemented | ✅ Verified (`src/features/provider/api.ts`) | Active reputation journey |
| 166 | reputation | `GET` | `/api/v1/admin/providers/{providerId}/ratings` | Review a provider’s ratings | Implemented | ✅ Verified (`src/features/admin/api.ts`) | Active reputation journey |
| 167 | reputation | `POST` | `/api/v1/admin/remarks/{id}/unpublish` | Unpublish an abusive remark | Implemented | ✅ Verified (`src/features/admin/api.ts`) | Active reputation journey |
| 168 | conduct | `GET` | `/api/v1/admin/penalties` | List penalties | Implemented | ✅ Verified (`src/features/admin/cases-api.ts`) | Active conduct journey |
| 169 | conduct | `POST` | `/api/v1/admin/penalties` | Propose a penalty | Implemented | ✅ Verified (`src/features/admin/cases-api.ts`) | Active conduct journey |
| 170 | conduct | `GET` | `/api/v1/admin/penalties/{id}` | Read a penalty | Implemented | ✅ Verified (`src/features/admin/cases-api.ts`) | Active conduct journey |
| 171 | conduct | `POST` | `/api/v1/admin/penalties/{id}/apply` | Apply a penalty | Implemented | ✅ Verified (`src/features/admin/cases-api.ts`) | Active conduct journey |
| 172 | conduct | `POST` | `/api/v1/admin/penalties/{id}/withdraw` | Withdraw a proposed penalty | Implemented | ✅ Verified (`src/features/admin/cases-api.ts`) | Active conduct journey |
| 173 | conduct | `GET` | `/api/v1/admin/appeals` | List appeals | Implemented | ✅ Verified (`src/features/admin/cases-api.ts`) | Active conduct journey |
| 174 | conduct | `POST` | `/api/v1/admin/appeals/{id}/decide` | Decide an appeal | Implemented | ✅ Verified (`src/features/admin/cases-api.ts`) | Active conduct journey |
| 175 | conduct | `GET` | `/api/v1/provider/penalties` | See my penalties | Implemented | ✅ Verified (`src/features/provider/api.ts`) | Active conduct journey |
| 176 | conduct | `GET` | `/api/v1/provider/penalties/{id}` | Read one of my penalties | Implemented | ✅ Verified (`src/features/provider/api.ts`) | Active conduct journey |
| 177 | conduct | `POST` | `/api/v1/provider/penalties/{id}/reply` | Reply to a proposed penalty | Implemented | ✅ Verified (`src/features/provider/api.ts`) | Active conduct journey |
| 178 | conduct | `POST` | `/api/v1/provider/penalties/{id}/appeal` | Appeal an applied penalty | Implemented | ✅ Verified (`src/features/provider/api.ts`) | Active conduct journey |
| 179 | conduct | `GET` | `/api/v1/provider/conduct` | See my conduct record | Implemented | ✅ Verified (`src/features/provider/api.ts`) | Active conduct journey |
| 180 | complaints | `GET` | `/api/v1/complaints` | List my complaints | Implemented | ✅ Verified (`src/features/admin/api.ts`) | Active complaints journey |
| 181 | complaints | `POST` | `/api/v1/complaints` | Raise a complaint | Implemented | ✅ Verified (`src/features/admin/api.ts`) | Active complaints journey |
| 182 | complaints | `POST` | `/api/v1/complaints/from-receipt` | Report a problem from a receipt link | Implemented | ✅ Verified (`src/features/complaints/api.ts`) | Active complaints journey |
| 183 | complaints | `GET` | `/api/v1/complaints/{id}` | Read a complaint and its timeline | Implemented | ✅ Verified (`src/features/admin/cases-api.ts`) | Active complaints journey |
| 184 | complaints | `POST` | `/api/v1/complaints/{id}/reply` | Reply on a complaint | Implemented | ✅ Verified (`src/features/complaints/api.ts`) | Active complaints journey |
| 185 | complaints | `POST` | `/api/v1/complaints/{id}/evidence` | Add a photo to a complaint | Implemented | ✅ Verified (`src/features/complaints/api.ts`) | Active complaints journey |
| 186 | complaints | `GET` | `/api/v1/admin/complaints` | The complaint queue | Implemented | ✅ Verified (`src/features/admin/cases-api.ts`) | Active complaints journey |
| 187 | complaints | `GET` | `/api/v1/admin/complaints/{id}` | Open a complaint | Implemented | ✅ Verified (`src/features/admin/cases-api.ts`) | Active complaints journey |
| 188 | complaints | `POST` | `/api/v1/admin/complaints/{id}/assign` | Assign a complaint | Implemented | ✅ Verified (`src/features/admin/cases-api.ts`) | Active complaints journey |
| 189 | complaints | `POST` | `/api/v1/admin/complaints/{id}/transition` | Move a complaint along, or decide it | Implemented | ✅ Verified (`src/features/admin/cases-api.ts`) | Active complaints journey |
| 190 | complaints | `POST` | `/api/v1/admin/complaints/{id}/open-dispute` | Freeze the job’s money as a dispute | Implemented | ✅ Verified (`src/features/admin/cases-api.ts`) | Active complaints journey |
| 191 | disputes | `GET` | `/api/v1/admin/disputes` | The dispute queue | Implemented | ✅ Verified (`src/features/admin/cases-api.ts`) | Active disputes journey |
| 192 | disputes | `GET` | `/api/v1/admin/disputes/{id}` | Open a dispute: the evidence floor | Implemented | ✅ Verified (`src/features/admin/cases-api.ts`) | Active disputes journey |
| 193 | disputes | `POST` | `/api/v1/admin/disputes/{id}/resolve` | Rule on a dispute | Implemented | ✅ Verified (`src/features/admin/cases-api.ts`) | Active disputes journey |
| 194 | disputes | `GET` | `/api/v1/provider/disputes` | See my disputes | Implemented | ✅ Verified (`src/features/provider/api.ts`) | Active disputes journey |
| 195 | disputes | `GET` | `/api/v1/provider/disputes/{id}` | Read a dispute on my job | Implemented | ✅ Verified (`src/features/provider/api.ts`) | Active disputes journey |
| 196 | disputes | `POST` | `/api/v1/provider/disputes/{id}/reply` | Reply to a dispute | Implemented | ✅ Verified (`src/features/provider/api.ts`) | Active disputes journey |
| 197 | admin | `GET` | `/api/v1/admin/users` | List user accounts | Implemented | ✅ Verified (`src/features/admin/api.ts`) | Active admin journey |
| 198 | admin | `POST` | `/api/v1/admin/users/{userId}/block` | Block a user | Implemented | ✅ Verified (`src/features/admin/api.ts`) | Active admin journey |
| 199 | admin | `POST` | `/api/v1/admin/users/{userId}/unblock` | Unblock a user | Implemented | ✅ Verified (`src/features/admin/api.ts`) | Active admin journey |
| 200 | admin | `POST` | `/api/v1/admin/users/{userId}/deactivate` | Deactivate a user | Implemented | ✅ Verified (`src/features/admin/api.ts`) | Active admin journey |
| 201 | admin | `POST` | `/api/v1/admin/users/{userId}/send-reset` | Send a password reset | Implemented | ✅ Verified (`src/features/admin/api.ts`) | Active admin journey |
| 202 | admin | `GET` | `/api/v1/admin/roles` | List roles and their permissions | Implemented | ✅ Verified (`src/features/admin/api.ts`) | Active admin journey |
| 203 | admin | `POST` | `/api/v1/admin/users/{userId}/roles/{roleCode}` | Grant a role | Implemented | ✅ Verified (`src/features/admin/api.ts`) | Active admin journey |
| 204 | admin | `DELETE` | `/api/v1/admin/users/{userId}/roles/{roleCode}` | Revoke a role | Implemented | ✅ Verified (`src/features/admin/api.ts`) | Active admin journey |
| 205 | admin | `GET` | `/api/v1/admin/customers` | List customer accounts | Implemented | ✅ Verified (`src/features/admin/api.ts`) | Active admin journey |
| 206 | admin | `POST` | `/api/v1/admin/customers/{customerId}/deactivate` | Deactivate a customer | Implemented | ✅ Verified (`src/features/admin/api.ts`) | Active admin journey |
| 207 | admin | `GET` | `/api/v1/admin/staff-conflicts` | List declared staff conflicts | Implemented | ✅ Verified (`src/features/admin/api.ts`) | Active admin journey |
| 208 | admin | `POST` | `/api/v1/admin/staff-conflicts` | Declare a staff conflict | Implemented | ✅ Verified (`src/features/admin/api.ts`) | Active admin journey |
| 209 | admin | `DELETE` | `/api/v1/admin/staff-conflicts/{id}` | Withdraw a declared conflict | Implemented | ✅ Verified (`src/features/admin/api.ts`) | Active admin journey |
| 210 | admin | `GET` | `/api/v1/admin/audit` | Query the audit log | Implemented | ✅ Verified (`src/features/admin/api.ts`) | Active admin journey |
| 211 | admin | `GET` | `/api/v1/admin/ops-board` | The operations board | Implemented | ✅ Verified (`src/features/admin/api.ts`) | Active admin journey |
| 212 | admin | `GET` | `/api/v1/admin/ops-board/stream` | The operations board, live | Implemented | ✅ Verified (`src/features/admin/api.ts`) | Active admin journey |
| 213 | plans | `GET` | `/api/v1/plans` | Browse available maintenance plans | Implemented | ✅ Verified (`src/features/customer/plans-view.tsx`) | Active plans journey |
| 214 | plans | `GET` | `/api/v1/plans/{id}` | Get details of a maintenance plan | Implemented | ✅ Verified (`src/features/plans/admin-plans-view.tsx`) | Active plans journey |
| 215 | plans | `POST` | `/api/v1/plans/{id}/subscribe` | Subscribe to a maintenance plan | Implemented | ✅ Verified (`src/features/plans/api.ts`) | Active plans journey |
| 216 | plans | `GET` | `/api/v1/me/subscriptions` | List my plan subscriptions | Implemented | ✅ Verified (`src/features/plans/api.ts`) | Active plans journey |
| 217 | plans | `GET` | `/api/v1/subscriptions/{id}` | Get details of a subscription | Implemented | ✅ Verified (`src/features/plans/api.ts`) | Active plans journey |
| 218 | plans | `POST` | `/api/v1/subscriptions/{id}/cancel` | Cancel a maintenance plan subscription | Implemented | ✅ Verified (`src/features/plans/api.ts`) | Active plans journey |
| 219 | admin | `GET` | `/api/v1/admin/plans` | List all maintenance plans (admin) | Implemented | ✅ Verified (`src/features/plans/admin-plans-view.tsx`) | Active admin journey |
| 220 | admin | `POST` | `/api/v1/admin/plans` | Create a maintenance plan | Implemented | ✅ Verified (`src/features/plans/admin-plans-view.tsx`) | Active admin journey |
| 221 | admin | `GET` | `/api/v1/admin/plans/{id}` | Get plan details (admin) | Implemented | ✅ Verified (`src/features/plans/api.ts`) | Active admin journey |
| 222 | admin | `PATCH` | `/api/v1/admin/plans/{id}` | Update a maintenance plan | Implemented | ✅ Verified (`src/features/plans/api.ts`) | Active admin journey |
| 223 | admin | `DELETE` | `/api/v1/admin/plans/{id}` | Deactivate a maintenance plan | Implemented | ✅ Verified (`src/features/plans/api.ts`) | Active admin journey |

---

## 4. Key Integration Insights & Recommended Actions

1. **Payment Journey Integration:**
   - `POST /api/v1/bookings` returns `payment.redirectUrl` for online bookings.
   - `AwaitingPaymentCard` has been added to `CustomerBookingDetailScreen` to handle bookings in `PENDING_PAYMENT`.
   - `CheckoutReturn` has been wired to read live booking state and observe webhook capture.
   - Gaps for backend: `GET /bookings/:id` lacks payment details projection, and there is no retry checkout endpoint for held bookings. Documented in `backend_requirement.md`.

2. **Dropdown and Z-Index Stacking:**
   - On the service professionals page, Leaflet map panes (`z-[400]` to `z-[600]`) were previously leaking into the parent stacking context and rendering on top of select menus.
   - Fixed by applying `isolate z-0` on `LocationMap` and portalling `SelectField` to `document.body` at `z-[9999]`.

3. **Card Consistency:**
   - Professional cards across search results (`ProviderCard`), booking flow (`ProviderChoiceStep`), favourites (`CustomerFavouritesScreen`), and booking details (`CustomerBookingDetailScreen`) have been standardized with consistent monogram avatars, typography, spacing, rating stars, and subtle hover effects.

