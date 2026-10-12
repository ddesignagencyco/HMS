# API Integration Tracker — HMS Web

**Last Updated:** 2026-10-08  
**Scope:** Frontend ↔ Backend Contract Mapping & Live Integration Status  
**All Modules Audited:** Authentication, Catalogue, Places, Search, Booking, Customer, Provider, Agent, Admin, Finance  

---

## 1. Summary Status by Module

| # | Module | Endpoints Wired | Status | Data Source |
|---|---|---|---|---|
| 1 | **Authentication & Session** | 12 / 12 | ✅ Complete | Live Backend API |
| 2 | **Search, Catalogue & Places** | 10 / 10 | ✅ Complete | Live Backend API |
| 3 | **Booking & Lifecycle** | 14 / 14 | ✅ Complete | Live Backend API |
| 4 | **Customer Portal** | 12 / 12 | ✅ Complete | Live Backend API |
| 5 | **Provider Portal** | 14 / 14 | ✅ Complete | Live Backend API |
| 6 | **Verification Agent Console** | 5 / 5 | ✅ Complete | Live Backend API |
| 7 | **Finance Portal** | 8 / 8 | ✅ Complete | Live Backend API |
| 8 | **Administration Console** | 18 / 18 | ✅ Complete | Live Backend API |
| 9 | **Notifications & Alerts** | 2 / 2 | ✅ Complete | Live Backend API |

**Total Live Endpoints Integrated:** **95+ API routes** actively wired and verified. Zero mock data dependencies remain in active portal views.

---

## 2. Detailed Integration Map

### Module 1 — Authentication & Session
* `POST /api/v1/auth/register` — `src/features/auth/register-form.tsx`
* `POST /api/v1/auth/login` — `src/features/auth/sign-in-form.tsx`
* `POST /api/v1/auth/otp/request` — `src/features/auth/verify-otp-form.tsx`, `forgot-form.tsx`
* `POST /api/v1/auth/otp/verify` — `src/features/auth/verify-otp-form.tsx`
* `POST /api/v1/auth/refresh` — `src/lib/api/client.ts` (single-flight refresh loop with replay)
* `POST /api/v1/auth/logout` — `src/features/auth/session.tsx`
* `GET /api/v1/auth/session` — `src/features/auth/session.tsx` (primary cookie-authenticated probe, zero 401s on anon visits)
* `GET /api/v1/auth/me` — `src/features/auth/session.tsx`
* `POST /api/v1/auth/password/forgot` — `src/features/auth/forgot-form.tsx`
* `POST /api/v1/auth/password/reset` — `src/features/auth/reset-password-form.tsx`
* `POST /api/v1/auth/totp/setup` — `src/features/auth/totp-form.tsx`
* `POST /api/v1/auth/totp/verify` — `src/features/auth/totp-form.tsx`
* `DELETE /api/v1/auth/totp` — `src/features/auth/totp-form.tsx`

### Module 2 — Catalogue, Places & Public Search
* `GET /api/v1/catalogue/categories` — `src/features/catalogue/api.ts`
* `GET /api/v1/catalogue/categories/:slug/services` — `src/features/catalogue/api.ts`
* `GET /api/v1/catalogue/services/:slug` — `src/features/catalogue/api.ts`
* `GET /api/v1/catalogue/services/:slug/issue-options` — `src/features/booking/booking-flow.tsx`
* `GET /api/v1/places/cities` — `src/features/places/api.ts`
* `GET /api/v1/places/cities/:cityId/areas` — `src/features/places/api.ts`
* `GET /api/v1/search/providers` — `src/features/search/api.ts`
* `GET /api/v1/search/providers/:providerId` — `src/features/search/api.ts`
* `GET /api/v1/search/providers/:providerId/reputation` — `src/features/search/api.ts`
* `GET /api/v1/search/providers/:providerId/remarks` — `src/features/search/api.ts`
* `GET /api/v1/search/providers/:providerId/slots` — `src/features/search/api.ts`

### Module 3 — Booking Lifecycle & Chat
* `POST /api/v1/bookings/quote` — `src/features/booking/api.ts` (server-side line-item pricing)
* `POST /api/v1/bookings` — `src/features/booking/api.ts` (checkout submission)
* `GET /api/v1/bookings` — `src/features/booking/api.ts` (customer/provider booking list with serviceName & areaName)
* `GET /api/v1/bookings/:id` — `src/features/booking/api.ts` (booking detail + cancellation quote)
* `POST /api/v1/bookings/:id/cancel` — `src/features/booking/api.ts`
* `POST /api/v1/bookings/:id/reschedule` — `src/features/booking/api.ts`
* `GET /api/v1/bookings/:id/checklist` — `src/features/provider/job-view.tsx` (real checklist tasks)
* `GET /api/v1/bookings/:id/service-address` — `src/features/provider/job-view.tsx`
* `POST /api/v1/bookings/:id/evidence` — `src/features/provider/job-view.tsx`, `booking-detail-view.tsx`
* `GET /api/v1/bookings/:id/invoice.pdf` — `src/features/provider/job-view.tsx`
* `GET /api/v1/bookings/:id/messages` — `src/features/booking/booking-chat.tsx`, `inbox-view.tsx`
* `POST /api/v1/bookings/:id/messages` — `src/features/booking/booking-chat.tsx`, `inbox-view.tsx`

### Module 4 — Customer Portal (`/account/*`)
* `GET /api/v1/customer/addresses` — `src/features/account/api.ts`
* `POST /api/v1/customer/addresses` — `src/features/account/api.ts`
* `PATCH /api/v1/customer/addresses/:id` — `src/features/account/api.ts`
* `DELETE /api/v1/customer/addresses/:id` — `src/features/account/api.ts`
* `GET /api/v1/me/favourites` — `src/features/customer/favourites-view.tsx`
* `POST /api/v1/me/favourites` — `src/features/discovery/save-provider-button.tsx`
* `DELETE /api/v1/me/favourites/:providerId` — `src/features/discovery/save-provider-button.tsx`
* `GET /api/v1/me` — `src/features/account/api.ts`
* `PATCH /api/v1/me` — `src/features/account/api.ts`
* `POST /api/v1/complaints` — `src/features/customer/booking-detail-view.tsx`

### Module 5 — Provider Portal (`/provider/*`)
* `GET /api/v1/provider/today` — `src/features/provider/today-view.tsx`
* `GET /api/v1/provider/offers` — `src/features/provider/offers-view.tsx`
* `POST /api/v1/provider/offers/:id/accept` — `src/features/provider/offers-view.tsx`
* `POST /api/v1/provider/offers/:id/decline` — `src/features/provider/offers-view.tsx`
* `GET /api/v1/provider/calendar` — `src/features/provider/calendar-view.tsx`
* `PUT /api/v1/provider/calendar` — `src/features/provider/calendar-view.tsx`
* `GET /api/v1/provider/services` — `src/features/provider/services-view.tsx`
* `PUT /api/v1/provider/services` — `src/features/provider/services-view.tsx`
* `GET /api/v1/provider/service-areas` — `src/features/provider/areas-view.tsx`
* `PUT /api/v1/provider/service-areas` — `src/features/provider/areas-view.tsx`
* `GET /api/v1/provider/documents` — `src/features/provider/documents-view.tsx`
* `POST /api/v1/provider/documents` — `src/features/provider/documents-view.tsx`
* `GET /api/v1/provider/earnings` — `src/features/provider/earnings-view.tsx`
* `GET /api/v1/provider/payouts` — `src/features/provider/payouts-view.tsx`
* `GET /api/v1/provider/ratings` — `src/features/provider/ratings-view.tsx`
* `POST /api/v1/provider/ratings/:id/reply` — `src/features/provider/ratings-view.tsx`
* `GET /api/v1/provider/conduct` — `src/features/provider/conduct-view.tsx`
* `POST /api/v1/provider/penalties/:id/reply` — `src/features/provider/conduct-view.tsx`
* `POST /api/v1/provider/penalties/:id/appeal` — `src/features/provider/conduct-view.tsx`

### Module 6 — Verification Agent Console (`/agent/*`)
* `GET /api/v1/agent/queue` — `src/features/portal/staff-views.tsx`
* `POST /api/v1/agent/queue/:id/claim` — `src/features/portal/staff-views.tsx`
* `GET /api/v1/agent/verifications/:id` — `src/features/portal/verification-console.tsx`
* `POST /api/v1/agent/verifications/:id/call` — `src/features/portal/verification-console.tsx`
* `POST /api/v1/agent/verifications/:id/decision` — `src/features/portal/verification-console.tsx`

### Module 7 — Finance Portal (`/finance/*`)
* `GET /api/v1/finance/escrow` — `src/features/portal/finance-views.tsx`, `admin/ops-view.tsx` (total held paisa + escrow records)
* `GET /api/v1/finance/releases` — `src/features/portal/finance-views.tsx`
* `GET /api/v1/finance/refunds` — `src/features/portal/finance-views.tsx`
* `GET /api/v1/finance/payouts` — `src/features/portal/finance-views.tsx`
* `GET /api/v1/finance/cash-reconciliation` — `src/features/portal/finance-views.tsx`
* `GET /api/v1/finance/debts` — `src/features/portal/finance-views.tsx`
* `GET /api/v1/finance/ledger` — `src/features/portal/finance-views.tsx`

### Module 8 — Administration Console (`/admin/*`)
* `GET /api/v1/admin/complaints` — `src/features/admin/cases-queries.ts`, `ops-view.tsx`
* `GET /api/v1/admin/complaints/:id` — `src/features/admin/cases-queries.ts`
* `POST /api/v1/admin/complaints/:id/assign` — `src/features/admin/cases-queries.ts`
* `POST /api/v1/admin/complaints/:id/transition` — `src/features/admin/cases-queries.ts`
* `POST /api/v1/admin/complaints/:id/open-dispute` — `src/features/admin/cases-queries.ts`
* `GET /api/v1/admin/disputes` — `src/features/admin/cases-queries.ts`, `ops-view.tsx`
* `GET /api/v1/admin/disputes/:id` — `src/features/admin/cases-queries.ts`
* `POST /api/v1/admin/disputes/:id/resolve` — `src/features/admin/cases-queries.ts`
* `GET /api/v1/admin/penalties` — `src/features/admin/cases-queries.ts`, `ops-view.tsx`
* `POST /api/v1/admin/penalties` — `src/features/admin/cases-queries.ts`
* `POST /api/v1/admin/penalties/:id/apply` — `src/features/admin/cases-queries.ts`
* `POST /api/v1/admin/penalties/:id/withdraw` — `src/features/admin/cases-queries.ts`
* `GET /api/v1/admin/appeals` — `src/features/admin/cases-queries.ts`
* `POST /api/v1/admin/appeals/:id/decide` — `src/features/admin/cases-queries.ts`
* `GET /api/v1/admin/users` — `src/features/admin/queries.ts`
* `GET /api/v1/admin/providers/:id/documents` — `src/features/admin/queries.ts`
* `POST /api/v1/admin/documents/:id/review` — `src/features/admin/queries.ts`
* `GET /api/v1/admin/settings` — `src/features/admin/cases-queries.ts`
* `PUT /api/v1/admin/settings/:key` — `src/features/admin/cases-queries.ts`
* `GET /api/v1/admin/templates` — `src/features/admin/cases-queries.ts`
* `GET /api/v1/admin/notifications` — `src/features/admin/cases-queries.ts`
* `GET /api/v1/admin/audit` — `src/features/admin/queries.ts`

### Module 9 — Notifications & Platform Header
* `GET /api/v1/notifications` — `src/components/notification-bell.tsx`
* `POST /api/v1/notifications/:id/read` — `src/components/notification-bell.tsx`
