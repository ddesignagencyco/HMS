# API Coverage & Integration Audit

**Generated:** 2026-10-14 from `apps/api/test/api-surface.baseline.json` (the API's own generated route surface) cross-checked against `docs-final/openapi.json` and the controller decorators, then mapped to `apps/web/src` call sites.

## Reconciled totals

| Measure | Count | Source |
|---|---|---|
| Operations in Swagger (`docs-final/openapi.json`) | 225 | every method+path under `paths` |
| Operations in the generated route surface | 225 | `api-surface.baseline.json` — identical set to Swagger (0 differences either way) |
| Route decorators in controllers | 226 | `@Get/@Post/@Put/@Patch/@Delete/@Sse` across `*.controller.ts` |
| Implemented but absent from Swagger | 1 | `GET /metrics` (`health/metrics.controller.ts`) — Prometheus scrape, intentionally undocumented |
| **Integrated in the web** | **207** | at least one call site in `apps/web/src` (excluding tests) |
| of which runtime-verified in the browser audit | 0 | see `pre-production-audit.md` journeys |
| Not required by the UI | 13 | infrastructure, webhooks, dev-only, alternative route |
| Backend exists, frontend integration missing | 5 | listed below |

**The old "148 operations / 168 by category" figures were both wrong.** Counting by *first* tag gives exactly 225 (booking 31 · admin 21 · provider 21 · catalogue 19 · finance 18 · verification 13 · auth 13 · conduct 12 · complaints 11 · customer 11 · notifications 10 · payment 7 · disputes 6 · reputation 6 · development 6 · plans 6 · health 4 · search 4 · settings 3 · places 2 · webhooks 1). Neither old figure can be reproduced from the current spec; they most likely date from an older surface (before the staff, reports, plans and debt endpoints) and/or counted multi-tagged operations more than once.

## Per-operation table

| Tag | Method | Path | Purpose | Web call site / reason | Status |
|---|---|---|---|---|---|
| health | `GET` | `/` | Welcome message | API root — infrastructure | Not required by the UI |
| conduct | `GET` | `/api/v1/admin/appeals` | List appeals | `features/admin/cases-api.ts:310` | Integrated — contract checked, runtime pending |
| conduct | `POST` | `/api/v1/admin/appeals/{id}/decide` | Decide an appeal | `features/admin/cases-api.ts:315` | Integrated — contract checked, runtime pending |
| admin | `GET` | `/api/v1/admin/audit` | Query the audit log | `features/admin/api.ts:287` | Integrated — contract checked, runtime pending |
| catalogue | `POST` | `/api/v1/admin/catalogue/categories` | Create a service category | No "create category" control in /admin/catalogue | Backend exists — frontend integration missing |
| catalogue | `PATCH` | `/api/v1/admin/catalogue/categories/{id}` | Update a service category | `features/admin/catalogue-view.tsx:147` | Integrated — contract checked, runtime pending |
| catalogue | `GET` | `/api/v1/admin/catalogue/commission-rules` | List commission rules | `features/admin/api.ts:358`, `features/admin/api.ts:373` | Integrated — contract checked, runtime pending |
| catalogue | `POST` | `/api/v1/admin/catalogue/commission-rules` | Set a commission rate | `features/admin/api.ts:394` | Integrated — contract checked, runtime pending |
| catalogue | `POST` | `/api/v1/admin/catalogue/commission-rules/{id}/end` | Close a commission rule | `features/admin/api.ts:398` | Integrated — contract checked, runtime pending |
| catalogue | `POST` | `/api/v1/admin/catalogue/services` | Create a bookable service | No "create service" control in /admin/catalogue | Backend exists — frontend integration missing |
| catalogue | `PATCH` | `/api/v1/admin/catalogue/services/{id}` | Update a bookable service | `features/admin/catalogue-view.tsx:202` | Integrated — contract checked, runtime pending |
| catalogue | `PUT` | `/api/v1/admin/catalogue/services/{id}/checklist` | Replace a service's checklist | No checklist editor in /admin/catalogue | Backend exists — frontend integration missing |
| catalogue | `PUT` | `/api/v1/admin/catalogue/services/{id}/issue-options` | Replace a service's common-faults list | No issue-options editor in /admin/catalogue | Backend exists — frontend integration missing |
| complaints | `GET` | `/api/v1/admin/complaints` | The complaint queue | `features/admin/cases-api.ts:266`, `features/admin/ops-view.tsx:174` | Integrated — contract checked, runtime pending |
| complaints | `GET` | `/api/v1/admin/complaints/{id}` | Open a complaint | `features/admin/cases-api.ts:269` | Integrated — contract checked, runtime pending |
| complaints | `POST` | `/api/v1/admin/complaints/{id}/assign` | Assign a complaint | `features/admin/cases-api.ts:273` | Integrated — contract checked, runtime pending |
| complaints | `POST` | `/api/v1/admin/complaints/{id}/open-dispute` | Freeze the job’s money as a dispute | `features/admin/cases-api.ts:280` | Integrated — contract checked, runtime pending |
| complaints | `POST` | `/api/v1/admin/complaints/{id}/transition` | Move a complaint along, or decide it | `features/admin/cases-api.ts:277` | Integrated — contract checked, runtime pending |
| admin | `GET` | `/api/v1/admin/customers` | List customer accounts | `features/admin/api.ts:242`, `features/admin/ops-view.tsx:178` | Integrated — contract checked, runtime pending |
| admin | `POST` | `/api/v1/admin/customers/{customerId}/deactivate` | Deactivate a customer | `features/admin/api.ts:262` | Integrated — contract checked, runtime pending |
| disputes | `GET` | `/api/v1/admin/disputes` | The dispute queue | `features/admin/cases-api.ts:285`, `features/admin/ops-view.tsx:175` | Integrated — contract checked, runtime pending |
| disputes | `GET` | `/api/v1/admin/disputes/{id}` | Open a dispute: the evidence floor | `features/admin/cases-api.ts:289` | Integrated — contract checked, runtime pending |
| disputes | `POST` | `/api/v1/admin/disputes/{id}/resolve` | Rule on a dispute | `features/admin/cases-api.ts:293` | Integrated — contract checked, runtime pending |
| provider | `POST` | `/api/v1/admin/documents/{documentId}/review` | Verify or reject a document | `features/admin/cases-api.ts:366` | Integrated — contract checked, runtime pending |
| provider | `GET` | `/api/v1/admin/documents/{documentId}/url` | Get a short-lived link to a document | `features/admin/cases-api.ts:362` | Integrated — contract checked, runtime pending |
| notifications | `GET` | `/api/v1/admin/notifications` | The notification delivery log | `features/admin/cases-api.ts:332` | Integrated — contract checked, runtime pending |
| admin | `GET` | `/api/v1/admin/ops-board` | The operations board | `features/admin/api.ts:356` | Integrated — contract checked, runtime pending |
| admin | `GET` | `/api/v1/admin/ops-board/stream` | The operations board, live | `features/admin/api.ts:448` | Integrated — contract checked, runtime pending |
| conduct | `GET` | `/api/v1/admin/penalties` | List penalties | `features/admin/cases-api.ts:298`, `features/admin/ops-view.tsx:176` | Integrated — contract checked, runtime pending |
| conduct | `POST` | `/api/v1/admin/penalties` | Propose a penalty | `features/admin/cases-api.ts:303` | Integrated — contract checked, runtime pending |
| conduct | `GET` | `/api/v1/admin/penalties/{id}` | Read a penalty | `features/admin/cases-api.ts:300` | Integrated — contract checked, runtime pending |
| conduct | `POST` | `/api/v1/admin/penalties/{id}/apply` | Apply a penalty | `features/admin/cases-api.ts:306` | Integrated — contract checked, runtime pending |
| conduct | `POST` | `/api/v1/admin/penalties/{id}/withdraw` | Withdraw a proposed penalty | `features/admin/cases-api.ts:308` | Integrated — contract checked, runtime pending |
| admin | `GET` | `/api/v1/admin/plans` | List all maintenance plans (admin) | `features/plans/api.ts:8`, `features/plans/api.ts:322` | Integrated — contract checked, runtime pending |
| admin | `POST` | `/api/v1/admin/plans` | Create a maintenance plan | `features/plans/api.ts:327` | Integrated — contract checked, runtime pending |
| admin | `DELETE` | `/api/v1/admin/plans/{id}` | Deactivate a maintenance plan | `features/plans/api.ts:347` | Integrated — contract checked, runtime pending |
| admin | `GET` | `/api/v1/admin/plans/{id}` | Get plan details (admin) | `features/plans/api.ts:324` | Integrated — contract checked, runtime pending |
| admin | `PATCH` | `/api/v1/admin/plans/{id}` | Update a maintenance plan | `features/plans/api.ts:340` | Integrated — contract checked, runtime pending |
| catalogue | `GET` | `/api/v1/admin/provider-services` | Review provider service offers | Service-approval queue not listed; approve/reject exist on the provider detail screen | Backend exists — frontend integration missing |
| catalogue | `POST` | `/api/v1/admin/provider-services/{providerId}/{serviceId}/approve` | Approve a provider's offer to provide a service | `features/admin/api.ts:328` | Integrated — contract checked, runtime pending |
| catalogue | `POST` | `/api/v1/admin/provider-services/{providerId}/{serviceId}/reject` | Reject a provider's offer to provide a service | `features/admin/api.ts:331` | Integrated — contract checked, runtime pending |
| provider | `POST` | `/api/v1/admin/providers/{providerId}/approve` | Approve a provider | `features/admin/api.ts:305` | Integrated — contract checked, runtime pending |
| provider | `POST` | `/api/v1/admin/providers/{providerId}/block` | Block a provider | `features/admin/api.ts:316` | Integrated — contract checked, runtime pending |
| provider | `POST` | `/api/v1/admin/providers/{providerId}/deactivate` | Deactivate a provider | `features/admin/api.ts:324` | Integrated — contract checked, runtime pending |
| provider | `GET` | `/api/v1/admin/providers/{providerId}/documents` | List a provider's documents for review | `features/admin/cases-api.ts:359` | Integrated — contract checked, runtime pending |
| reputation | `GET` | `/api/v1/admin/providers/{providerId}/ratings` | Review a provider’s ratings | `features/admin/api.ts:409` | Integrated — contract checked, runtime pending |
| provider | `POST` | `/api/v1/admin/providers/{providerId}/reject` | Reject a provider | `features/admin/api.ts:312` | Integrated — contract checked, runtime pending |
| provider | `POST` | `/api/v1/admin/providers/{providerId}/unblock` | Unblock a provider | `features/admin/api.ts:320` | Integrated — contract checked, runtime pending |
| reputation | `POST` | `/api/v1/admin/remarks/{id}/unpublish` | Unpublish an abusive remark | `features/admin/api.ts:424` | Integrated — contract checked, runtime pending |
| admin | `GET` | `/api/v1/admin/roles` | List roles and their permissions | `features/admin/api.ts:265` | Integrated — contract checked, runtime pending |
| settings | `GET` | `/api/v1/admin/settings` | List all platform settings | `components/workspace-shell.tsx:294`, `features/admin/cases-api.ts:320` | Integrated — contract checked, runtime pending |
| settings | `GET` | `/api/v1/admin/settings/{key}` | Read one setting's current value | `features/admin/cases-api.ts:322` | Integrated — contract checked, runtime pending |
| settings | `PUT` | `/api/v1/admin/settings/{key}` | Change a setting's value | `features/admin/cases-api.ts:325` | Integrated — contract checked, runtime pending |
| admin | `GET` | `/api/v1/admin/staff-conflicts` | List declared staff conflicts | `features/admin/api.ts:276` | Integrated — contract checked, runtime pending |
| admin | `POST` | `/api/v1/admin/staff-conflicts` | Declare a staff conflict | `features/admin/api.ts:279` | Integrated — contract checked, runtime pending |
| admin | `DELETE` | `/api/v1/admin/staff-conflicts/{id}` | Withdraw a declared conflict | `features/admin/api.ts:282` | Integrated — contract checked, runtime pending |
| notifications | `GET` | `/api/v1/admin/templates` | List notification templates | `features/admin/cases-api.ts:340` | Integrated — contract checked, runtime pending |
| notifications | `POST` | `/api/v1/admin/templates` | Create a template | `features/admin/cases-api.ts:350` | Integrated — contract checked, runtime pending |
| notifications | `GET` | `/api/v1/admin/templates/{id}` | Read a template | `features/admin/cases-api.ts:342` | Integrated — contract checked, runtime pending |
| notifications | `PUT` | `/api/v1/admin/templates/{id}` | Edit a template | `features/admin/cases-api.ts:353` | Integrated — contract checked, runtime pending |
| notifications | `POST` | `/api/v1/admin/templates/preview` | Preview a template | `features/admin/cases-api.ts:347` | Integrated — contract checked, runtime pending |
| admin | `GET` | `/api/v1/admin/users` | List user accounts | `features/admin/api.ts:238` | Integrated — contract checked, runtime pending |
| admin | `POST` | `/api/v1/admin/users/{userId}/block` | Block a user | `features/admin/api.ts:245` | Integrated — contract checked, runtime pending |
| admin | `POST` | `/api/v1/admin/users/{userId}/deactivate` | Deactivate a user | `features/admin/api.ts:251` | Integrated — contract checked, runtime pending |
| admin | `DELETE` | `/api/v1/admin/users/{userId}/roles/{roleCode}` | Revoke a role | `features/admin/api.ts:273` | Integrated — contract checked, runtime pending |
| admin | `POST` | `/api/v1/admin/users/{userId}/roles/{roleCode}` | Grant a role | `features/admin/api.ts:269` | Integrated — contract checked, runtime pending |
| admin | `POST` | `/api/v1/admin/users/{userId}/send-reset` | Send a password reset | `features/admin/api.ts:259` | Integrated — contract checked, runtime pending |
| admin | `POST` | `/api/v1/admin/users/{userId}/unblock` | Unblock a user | `features/admin/api.ts:248` | Integrated — contract checked, runtime pending |
| verification | `GET` | `/api/v1/agent/queue` | See the verification queue | `features/portal/api.ts:222` | Integrated — contract checked, runtime pending |
| verification | `POST` | `/api/v1/agent/queue/claim` | Claim the next call | `features/portal/api.ts:230` | Integrated — contract checked, runtime pending |
| verification | `GET` | `/api/v1/agent/verifications/{id}` | Open the console for a call you hold | `features/portal/api.ts:253` | Integrated — contract checked, runtime pending |
| verification | `GET` | `/api/v1/agent/verifications/{id}/attempts` | List the call attempts so far | `features/portal/api.ts:275` | Integrated — contract checked, runtime pending |
| verification | `POST` | `/api/v1/agent/verifications/{id}/attempts` | Log a call attempt | `features/portal/api.ts:290` | Integrated — contract checked, runtime pending |
| verification | `POST` | `/api/v1/agent/verifications/{id}/call` | Call the customer | `features/portal/api.ts:264` | Integrated — contract checked, runtime pending |
| verification | `POST` | `/api/v1/agent/verifications/{id}/release-lock` | Put a claimed call back | `features/portal/api.ts:241` | Integrated — contract checked, runtime pending |
| verification | `POST` | `/api/v1/agent/verifications/{id}/submit` | Submit the verification | `features/portal/api.ts:301` | Integrated — contract checked, runtime pending |
| auth | `POST` | `/api/v1/auth/login` | Log in with a password | `features/auth/api.ts` | Integrated — contract checked, runtime pending |
| auth | `POST` | `/api/v1/auth/logout` | Log out | `features/auth/api.ts (sign-out-screen.tsx, session.tsx)` | Integrated — contract checked, runtime pending |
| auth | `GET` | `/api/v1/auth/me` | Get your own profile | `features/auth/api.ts:93`, `lib/api/client.ts:146` | Integrated — contract checked, runtime pending |
| auth | `POST` | `/api/v1/auth/otp/request` | Send a one-time verification code | `features/auth/api.ts` | Integrated — contract checked, runtime pending |
| auth | `POST` | `/api/v1/auth/otp/verify` | Verify a one-time code | `features/auth/api.ts` | Integrated — contract checked, runtime pending |
| auth | `POST` | `/api/v1/auth/password/forgot` | Request a password reset code | `features/auth/api.ts` | Integrated — contract checked, runtime pending |
| auth | `POST` | `/api/v1/auth/password/reset` | Reset your password | `features/auth/api.ts` | Integrated — contract checked, runtime pending |
| auth | `POST` | `/api/v1/auth/refresh` | Get a new access token | `lib/api/client.ts:194` | Integrated — contract checked, runtime pending |
| auth | `POST` | `/api/v1/auth/register` | Sign up for a new account | `features/auth/api.ts` | Integrated — contract checked, runtime pending |
| auth | `GET` | `/api/v1/auth/session` | Ask whether there is a session, without failing when there is not | `features/account/me-queries.ts:65`, `features/auth/api.ts:109` | Integrated — contract checked, runtime pending |
| auth | `DELETE` | `/api/v1/auth/totp` | Turn off two-factor authentication | `features/auth/api.ts:127` | Integrated — contract checked, runtime pending |
| auth | `POST` | `/api/v1/auth/totp/setup` | Start setting up two-factor authentication | `features/auth/api.ts:120` | Integrated — contract checked, runtime pending |
| auth | `POST` | `/api/v1/auth/totp/verify` | Confirm and turn on two-factor authentication | `features/auth/api.ts:124` | Integrated — contract checked, runtime pending |
| booking | `GET` | `/api/v1/bookings` | List my bookings | `features/booking/api.ts:445`, `features/booking/api.ts:541` | Integrated — contract checked, runtime pending |
| booking | `POST` | `/api/v1/bookings` | Check out a booking | `features/booking/api.ts:429` | Integrated — contract checked, runtime pending |
| verification | `GET` | `/api/v1/bookings/{bookingId}/verification/confirmation` | Open the "confirm the work" form (customer) | `features/verification/api.ts:147` | Integrated — contract checked, runtime pending |
| verification | `POST` | `/api/v1/bookings/{bookingId}/verification/confirmation` | Confirm the work and rate the provider (customer) | `features/verification/api.ts (selfConfirmationApi.submit)` | Integrated — contract checked, runtime pending |
| booking | `GET` | `/api/v1/bookings/{id}` | Read one booking | `features/booking/api.ts:436` | Integrated — contract checked, runtime pending |
| booking | `POST` | `/api/v1/bookings/{id}/accept` | Accept a booking request | `features/booking/api.ts:548` | Integrated — contract checked, runtime pending |
| booking | `POST` | `/api/v1/bookings/{id}/cancel` | Cancel a scheduled booking | `features/booking/api.ts:449` | Integrated — contract checked, runtime pending |
| booking | `POST` | `/api/v1/bookings/{id}/cash-received` | Confirm the customer paid cash | `features/booking/api.ts:580` | Integrated — contract checked, runtime pending |
| booking | `GET` | `/api/v1/bookings/{id}/checklist` | Read the service’s checklist for this booking | `features/booking/api.ts:488` | Integrated — contract checked, runtime pending |
| booking | `POST` | `/api/v1/bookings/{id}/checklist/{itemId}` | Mark a checklist item done | `features/booking/api.ts:567` | Integrated — contract checked, runtime pending |
| booking | `POST` | `/api/v1/bookings/{id}/complete` | Mark the job complete | `features/booking/api.ts:576` | Integrated — contract checked, runtime pending |
| booking | `POST` | `/api/v1/bookings/{id}/decline` | Decline a booking request | `features/booking/api.ts:551` | Integrated — contract checked, runtime pending |
| booking | `POST` | `/api/v1/bookings/{id}/depart` | Mark yourself en route | `features/booking/api.ts:554` | Integrated — contract checked, runtime pending |
| booking | `GET` | `/api/v1/bookings/{id}/evidence` | List a booking’s photos | `features/booking/api.ts:479` | Integrated — contract checked, runtime pending |
| booking | `POST` | `/api/v1/bookings/{id}/evidence` | Upload a photo | `features/booking/api.ts:496` | Integrated — contract checked, runtime pending |
| booking | `GET` | `/api/v1/bookings/{id}/invoice.pdf` | Download the invoice | `features/booking/invoice-download.tsx:58` | Integrated — contract checked, runtime pending |
| booking | `GET` | `/api/v1/bookings/{id}/messages` | Read the booking chat | `features/booking/api.ts:503` | Integrated — contract checked, runtime pending |
| booking | `POST` | `/api/v1/bookings/{id}/messages` | Send a chat message | `features/booking/api.ts:508` | Integrated — contract checked, runtime pending |
| booking | `POST` | `/api/v1/bookings/{id}/no-show` | Report a no-show | `features/booking/api.ts:476` | Integrated — contract checked, runtime pending |
| booking | `GET` | `/api/v1/bookings/{id}/on-behalf-contact` | Who will receive the provider, when the booking is for someone else | `features/booking/api.ts:520` | Integrated — contract checked, runtime pending |
| booking | `POST` | `/api/v1/bookings/{id}/reschedule` | Reschedule a booking | `features/booking/api.ts:453` | Integrated — contract checked, runtime pending |
| booking | `POST` | `/api/v1/bookings/{id}/revisions` | Raise a revised quote for extra work | `features/booking/api.ts:584` | Integrated — contract checked, runtime pending |
| booking | `POST` | `/api/v1/bookings/{id}/revisions/approve` | Approve the pending revised quote | `features/booking/api.ts:462` | Integrated — contract checked, runtime pending |
| booking | `POST` | `/api/v1/bookings/{id}/revisions/reject` | Reject the pending revised quote | `features/booking/api.ts:465` | Integrated — contract checked, runtime pending |
| booking | `GET` | `/api/v1/bookings/{id}/service-address` | Where this job is | `features/booking/api.ts:492` | Integrated — contract checked, runtime pending |
| booking | `POST` | `/api/v1/bookings/{id}/start` | Start the job with the customer’s code | `features/booking/api.ts:561` | Integrated — contract checked, runtime pending |
| booking | `POST` | `/api/v1/bookings/{id}/start-code` | Show the start code on the customer’s screen | `features/booking/api.ts:536` | Integrated — contract checked, runtime pending |
| booking | `POST` | `/api/v1/bookings/{id}/warranty-claim` | Claim under warranty | `features/booking/api.ts:472` | Integrated — contract checked, runtime pending |
| booking | `POST` | `/api/v1/bookings/checkout` | Check out a booking (alias of POST /bookings) | Alternative create-and-pay route; the web books via POST /bookings, which returns the same payment redirect | Not required by the UI |
| booking | `POST` | `/api/v1/bookings/quote` | Price a booking before committing to it | `features/booking/api.ts:408` | Integrated — contract checked, runtime pending |
| catalogue | `GET` | `/api/v1/catalogue/categories` | Browse the service categories | `components/ui/primitives.tsx:29`, `features/catalogue/api.ts:97` | Integrated — contract checked, runtime pending |
| catalogue | `GET` | `/api/v1/catalogue/categories/{slug}/services` | Browse the services in a category | `features/catalogue/api.ts:100` | Integrated — contract checked, runtime pending |
| catalogue | `GET` | `/api/v1/catalogue/services/{slug}` | Get one service, including its checklist | `features/catalogue/api.ts:130` | Integrated — contract checked, runtime pending |
| catalogue | `GET` | `/api/v1/catalogue/services/{slug}/issue-options` | The common faults a customer can pick from when booking this service | `features/catalogue/api.ts:136` | Integrated — contract checked, runtime pending |
| complaints | `GET` | `/api/v1/complaints` | List my complaints | `features/complaints/api.ts:140` | Integrated — contract checked, runtime pending |
| complaints | `POST` | `/api/v1/complaints` | Raise a complaint | `features/complaints/api.ts:138` | Integrated — contract checked, runtime pending |
| complaints | `GET` | `/api/v1/complaints/{id}` | Read a complaint and its timeline | `features/complaints/api.ts:142` | Integrated — contract checked, runtime pending |
| complaints | `POST` | `/api/v1/complaints/{id}/evidence` | Add a photo to a complaint | `features/complaints/api.ts:156` | Integrated — contract checked, runtime pending |
| complaints | `POST` | `/api/v1/complaints/{id}/reply` | Reply on a complaint | `features/complaints/api.ts:153` | Integrated — contract checked, runtime pending |
| complaints | `POST` | `/api/v1/complaints/from-receipt` | Report a problem from a receipt link | `features/complaints/api.ts:188` | Integrated — contract checked, runtime pending |
| customer | `GET` | `/api/v1/customer/addresses` | List my saved addresses | `features/account/api.ts:68` | Integrated — contract checked, runtime pending |
| customer | `POST` | `/api/v1/customer/addresses` | Save a new address | `features/account/api.ts:73` | Integrated — contract checked, runtime pending |
| customer | `DELETE` | `/api/v1/customer/addresses/{id}` | Remove a saved address | `features/account/api.ts:87` | Integrated — contract checked, runtime pending |
| customer | `PATCH` | `/api/v1/customer/addresses/{id}` | Update a saved address | `features/account/api.ts:80` | Integrated — contract checked, runtime pending |
| development | `GET` | `/api/v1/dev/inbox` | View messages the mock SMS/email/WhatsApp senders "sent" | Development only (dev OTP inbox); used by e2e scripts, never by the product UI | Not required by the UI |
| development | `GET` | `/api/v1/dev/payments/{paymentId}` | Mock payment page (where the mock gateway redirects to) | Development mock gateway page — the API sends the browser here via redirectUrl in dev | Not required by the UI |
| development | `GET` | `/api/v1/dev/payments/{paymentId}/complete` | Complete a mock payment (browser-navigable) | Development mock gateway | Not required by the UI |
| development | `POST` | `/api/v1/dev/payments/{paymentId}/complete` | Complete a mock payment | Development mock gateway | Not required by the UI |
| development | `GET` | `/api/v1/dev/storage/{bucket}/{key}` | Download a file from the mock file storage | Development mock storage; still emitted by the API for evidence URLs (backend BE-001) | Not required by the UI |
| development | `PUT` | `/api/v1/dev/storage/{bucket}/{key}` | Upload a file to the mock file storage | Development mock storage presigned PUT target | Not required by the UI |
| finance | `GET` | `/api/v1/finance/cash-reconciliation` | Reconcile cash jobs | `features/portal/finance-api.ts:248` | Integrated — contract checked, runtime pending |
| finance | `GET` | `/api/v1/finance/debts` | List commission debts | `features/portal/finance-api.ts:255`, `features/portal/finance-views.tsx:886` | Integrated — contract checked, runtime pending |
| finance | `GET` | `/api/v1/finance/escrow` | See the money held in escrow | `features/admin/api.ts:345`, `features/auth/routing.ts:12` | Integrated — contract checked, runtime pending |
| finance | `GET` | `/api/v1/finance/ledger` | Explore the ledger | `features/portal/finance-api.ts:262`, `features/portal/finance-views.tsx:887` | Integrated — contract checked, runtime pending |
| finance | `GET` | `/api/v1/finance/payout-batches` | List payout batches | `features/portal/finance-api.ts:152`, `features/portal/finance-api.ts:325` | Integrated — contract checked, runtime pending |
| finance | `POST` | `/api/v1/finance/payout-batches` | Create a payout batch | `features/portal/finance-api.ts:336` | Integrated — contract checked, runtime pending |
| finance | `GET` | `/api/v1/finance/payout-batches/{id}/export.csv` | Download the bank file | `features/portal/finance-api.ts:381` | Integrated — contract checked, runtime pending |
| finance | `POST` | `/api/v1/finance/payout-batches/{id}/mark-paid` | Record the bank’s result for a batch | `features/portal/finance-api.ts:354` | Integrated — contract checked, runtime pending |
| finance | `GET` | `/api/v1/finance/payout-batches/{id}/statements/{providerId}` | A provider’s statement for a batch | `features/portal/finance-api.ts:385` | Integrated — contract checked, runtime pending |
| finance | `GET` | `/api/v1/finance/payouts` | List payout requests | `app/[locale]/(portal)/finance/payout-batches/page.tsx:6`, `features/portal/finance-api.ts:234` | Integrated — contract checked, runtime pending |
| finance | `POST` | `/api/v1/finance/payouts/{id}/approve` | Approve a payout | `features/portal/finance-api.ts:242` | Integrated — contract checked, runtime pending |
| finance | `POST` | `/api/v1/finance/reconciliation/run` | Run the ledger reconciliation now | `features/portal/finance-api.ts:368` | Integrated — contract checked, runtime pending |
| verification | `GET` | `/api/v1/finance/recordings/{attemptId}` | Play a call recording | `features/portal/api.ts:330` | Integrated — contract checked, runtime pending |
| finance | `GET` | `/api/v1/finance/refunds` | List refunds | `features/portal/finance-api.ts:216`, `features/portal/finance-views.tsx:883` | Integrated — contract checked, runtime pending |
| finance | `POST` | `/api/v1/finance/refunds` | Refund a disputed booking by hand | `features/portal/finance-api.ts:227` | Integrated — contract checked, runtime pending |
| finance | `GET` | `/api/v1/finance/reports` | My reports | `features/portal/finance-api.ts:289` | Integrated — contract checked, runtime pending |
| finance | `POST` | `/api/v1/finance/reports` | Ask for a report | `features/portal/finance-api.ts:303` | Integrated — contract checked, runtime pending |
| finance | `GET` | `/api/v1/finance/reports/{id}` | One report run | `features/portal/finance-api.ts:313` | Integrated — contract checked, runtime pending |
| finance | `GET` | `/api/v1/finance/reports/{id}/download` | Download a finished report | `features/portal/finance-api.ts:378` | Integrated — contract checked, runtime pending |
| customer | `GET` | `/api/v1/me` | Get your own profile | `features/account/me-api.ts:1`, `features/account/me-api.ts:103` | Integrated — contract checked, runtime pending |
| customer | `PATCH` | `/api/v1/me` | Update your own profile | `features/account/me-api.ts:106` | Integrated — contract checked, runtime pending |
| customer | `POST` | `/api/v1/me/deactivate` | Deactivate your account | `features/account/me-api.ts:120` | Integrated — contract checked, runtime pending |
| customer | `GET` | `/api/v1/me/favourites` | List your favourite providers | `features/account/me-api.ts:123`, `features/discovery/provider-profile.tsx:191` | Integrated — contract checked, runtime pending |
| customer | `DELETE` | `/api/v1/me/favourites/{providerId}` | Remove a provider from your favourites | `features/account/me-api.ts` | Integrated — contract checked, runtime pending |
| customer | `POST` | `/api/v1/me/favourites/{providerId}` | Add a provider to your favourites | `features/account/me-api.ts` | Integrated — contract checked, runtime pending |
| customer | `PATCH` | `/api/v1/me/password` | Change your password | `features/account/me-api.ts:113` | Integrated — contract checked, runtime pending |
| plans | `GET` | `/api/v1/me/subscriptions` | List my plan subscriptions | `features/plans/api.ts:310`, `features/plans/customer-plans-view.tsx:303` | Integrated — contract checked, runtime pending |
| notifications | `GET` | `/api/v1/notifications` | My notification centre | `features/notifications/api.ts:26` | Integrated — contract checked, runtime pending |
| notifications | `POST` | `/api/v1/notifications/{id}/read` | Mark one notification read | `features/notifications/api.ts:41` | Integrated — contract checked, runtime pending |
| notifications | `POST` | `/api/v1/notifications/read-all` | Mark all my notifications read | `features/notifications/api.ts:51` | Integrated — contract checked, runtime pending |
| places | `GET` | `/api/v1/places/cities` | List the cities the platform operates in | `features/places/api.ts:48`, `features/provider/areas-view.tsx:16` | Integrated — contract checked, runtime pending |
| places | `GET` | `/api/v1/places/cities/{cityId}/areas` | List the areas within a city | `features/places/api.ts:49` | Integrated — contract checked, runtime pending |
| plans | `GET` | `/api/v1/plans` | Browse available maintenance plans | `app/[locale]/(public)/how-verification-works/page.tsx:124`, `app/[locale]/(public)/plans/page.tsx:20` | Integrated — contract checked, runtime pending |
| plans | `GET` | `/api/v1/plans/{id}` | Get details of a maintenance plan | `features/plans/api.ts:292` | Integrated — contract checked, runtime pending |
| plans | `POST` | `/api/v1/plans/{id}/subscribe` | Subscribe to a maintenance plan | `features/plans/api.ts` | Integrated — contract checked, runtime pending |
| provider | `GET` | `/api/v1/provider/availability` | Read my weekly availability calendar | `features/provider/api.ts:623` | Integrated — contract checked, runtime pending |
| provider | `PUT` | `/api/v1/provider/availability` | Replace my weekly availability calendar | `features/provider/api.ts:624` | Integrated — contract checked, runtime pending |
| conduct | `GET` | `/api/v1/provider/conduct` | See my conduct record | `features/provider/api.ts:663`, `features/provider/dashboard-view.tsx:282` | Integrated — contract checked, runtime pending |
| payment | `POST` | `/api/v1/provider/debt/pay` | Pay commission debt online | `features/provider/api.ts:651` | Integrated — contract checked, runtime pending |
| disputes | `GET` | `/api/v1/provider/disputes` | See my disputes | `features/provider/api.ts:672` | Integrated — contract checked, runtime pending |
| disputes | `GET` | `/api/v1/provider/disputes/{id}` | Read a dispute on my job | `features/provider/api.ts:673` | Integrated — contract checked, runtime pending |
| disputes | `POST` | `/api/v1/provider/disputes/{id}/reply` | Reply to a dispute | `features/provider/api.ts:677` | Integrated — contract checked, runtime pending |
| provider | `GET` | `/api/v1/provider/documents` | List my uploaded documents | `features/provider/api.ts:654`, `features/provider/dashboard-view.tsx:134` | Integrated — contract checked, runtime pending |
| provider | `POST` | `/api/v1/provider/documents` | Submit an identity document | `features/provider/api.ts:655` | Integrated — contract checked, runtime pending |
| payment | `GET` | `/api/v1/provider/earnings` | See my earnings | `features/provider/api.ts:637` | Integrated — contract checked, runtime pending |
| booking | `GET` | `/api/v1/provider/offers` | List the jobs currently offered to me | `features/provider/api.ts:631`, `features/provider/dashboard-view.tsx:226` | Integrated — contract checked, runtime pending |
| booking | `POST` | `/api/v1/provider/offers/{id}/accept` | Accept an offered job | `features/provider/api.ts:632` | Integrated — contract checked, runtime pending |
| booking | `POST` | `/api/v1/provider/offers/{id}/decline` | Decline an offered job | `features/provider/api.ts:634` | Integrated — contract checked, runtime pending |
| payment | `GET` | `/api/v1/provider/payout-accounts` | List my payout accounts | `features/provider/api.ts:645` | Integrated — contract checked, runtime pending |
| payment | `POST` | `/api/v1/provider/payout-accounts` | Add a payout account | `features/provider/api.ts:646` | Integrated — contract checked, runtime pending |
| payment | `GET` | `/api/v1/provider/payouts` | List my payouts | `features/portal/payout-batches-view.tsx:14`, `features/provider/api.ts:639` | Integrated — contract checked, runtime pending |
| payment | `POST` | `/api/v1/provider/payouts` | Request a payout | `features/provider/api.ts:644` | Integrated — contract checked, runtime pending |
| conduct | `GET` | `/api/v1/provider/penalties` | See my penalties | `features/provider/api.ts:664` | Integrated — contract checked, runtime pending |
| conduct | `GET` | `/api/v1/provider/penalties/{id}` | Read one of my penalties | `features/provider/api.ts:665` | Integrated — contract checked, runtime pending |
| conduct | `POST` | `/api/v1/provider/penalties/{id}/appeal` | Appeal an applied penalty | `features/provider/api.ts:669` | Integrated — contract checked, runtime pending |
| conduct | `POST` | `/api/v1/provider/penalties/{id}/reply` | Reply to a proposed penalty | `features/provider/api.ts:668` | Integrated — contract checked, runtime pending |
| provider | `GET` | `/api/v1/provider/profile` | Read my provider profile | `components/workspace-shell.tsx:292`, `features/provider/api.ts:609` | Integrated — contract checked, runtime pending |
| provider | `PATCH` | `/api/v1/provider/profile` | Update my provider profile | `features/provider/api.ts:610` | Integrated — contract checked, runtime pending |
| reputation | `GET` | `/api/v1/provider/ratings` | See the ratings I received | `features/provider/api.ts:658` | Integrated — contract checked, runtime pending |
| reputation | `POST` | `/api/v1/provider/remarks/{id}/reply` | Reply to a remark | `features/provider/api.ts:660` | Integrated — contract checked, runtime pending |
| provider | `GET` | `/api/v1/provider/service-areas` | List the areas I serve | `features/provider/api.ts:619` | Integrated — contract checked, runtime pending |
| provider | `PUT` | `/api/v1/provider/service-areas` | Replace the areas I serve | `features/provider/api.ts:620` | Integrated — contract checked, runtime pending |
| catalogue | `GET` | `/api/v1/provider/services` | List the services I offer | `features/provider/api.ts:613`, `features/provider/submit-card.tsx:48` | Integrated — contract checked, runtime pending |
| catalogue | `DELETE` | `/api/v1/provider/services/{serviceId}` | Stop offering a service | `features/provider/api.ts:616` | Integrated — contract checked, runtime pending |
| catalogue | `PUT` | `/api/v1/provider/services/{serviceId}` | Offer a service at your price | `features/provider/api.ts:615` | Integrated — contract checked, runtime pending |
| provider | `POST` | `/api/v1/provider/submit` | Submit my profile for approval | `features/provider/api.ts:707` | Integrated — contract checked, runtime pending |
| provider | `GET` | `/api/v1/provider/time-off` | List my recorded leave periods | `features/provider/api.ts:626` | Integrated — contract checked, runtime pending |
| provider | `POST` | `/api/v1/provider/time-off` | Record a leave period | `features/provider/api.ts:627` | Integrated — contract checked, runtime pending |
| provider | `DELETE` | `/api/v1/provider/time-off/{id}` | Cancel a leave period | `features/provider/api.ts:628` | Integrated — contract checked, runtime pending |
| payment | `GET` | `/api/v1/provider/wallet` | See my wallet and commission debt | `features/provider/api.ts:638` | Integrated — contract checked, runtime pending |
| search | `GET` | `/api/v1/search/providers` | Find providers who offer a service near a point | `features/booking/booking-flow.tsx:86`, `features/discovery/provider-card.tsx:13` | Integrated — contract checked, runtime pending |
| search | `GET` | `/api/v1/search/providers/{providerId}` | Get a provider’s full public profile | `features/search/api.ts:150` | Integrated — contract checked, runtime pending |
| search | `GET` | `/api/v1/search/providers/{providerId}/next-slots` | When is this provider next free? | `features/search/api.ts:180` | Integrated — contract checked, runtime pending |
| reputation | `GET` | `/api/v1/search/providers/{providerId}/remarks` | A provider’s published remarks | `features/search/api.ts:156` | Integrated — contract checked, runtime pending |
| reputation | `GET` | `/api/v1/search/providers/{providerId}/reputation` | A provider’s public reputation | `features/search/api.ts:153` | Integrated — contract checked, runtime pending |
| search | `GET` | `/api/v1/search/providers/{providerId}/slots` | List the times a provider can be booked on a day | `features/search/api.ts:162` | Integrated — contract checked, runtime pending |
| plans | `GET` | `/api/v1/subscriptions/{id}` | Get details of a subscription | `features/plans/api.ts:293` | Integrated — contract checked, runtime pending |
| plans | `POST` | `/api/v1/subscriptions/{id}/cancel` | Cancel a maintenance plan subscription | `features/plans/api.ts` | Integrated — contract checked, runtime pending |
| provider | `POST` | `/api/v1/uploads/presign` | Get an upload target for a document | `features/uploads/api.ts:36` | Integrated — contract checked, runtime pending |
| verification | `GET` | `/api/v1/v/{token}` | Open a verification link (customer) | `features/portal/api.ts:311`, `features/verification/api.ts:65` | Integrated — contract checked, runtime pending |
| verification | `POST` | `/api/v1/v/{token}` | Answer a verification link (customer) | `features/portal/api.ts:322`, `features/verification/api.ts:74` | Integrated — contract checked, runtime pending |
| webhooks | `POST` | `/api/v1/webhooks/payments/{provider}` | Payment provider webhook (not for direct use) | Gateway → API, server to server | Not required by the UI |
| notifications | `POST` | `/api/v1/webhooks/sms/{provider}` | SMS delivery receipt (not for direct use) | SMS provider → API, server to server | Not required by the UI |
| health | `GET` | `/health/live` | Is the server process running? | Liveness probe — infrastructure | Not required by the UI |
| health | `GET` | `/health/queues` | How many jobs are waiting in each background queue | Queue health — infrastructure | Not required by the UI |
| health | `GET` | `/health/ready` | Is the API fully ready to handle requests? | Readiness probe — infrastructure | Not required by the UI |
