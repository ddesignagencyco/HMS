<!-- GENERATED FILE - DO NOT EDIT.
     Produced by `npm run api:handoff --workspace @smart-home/api`, from the live application.
     Re-run it whenever an API is added or changed, and edit API_HANDOFF.md for the contracts. -->

# API index — 179 operations

Generated 2026-10-07 from version `1.0.0`. Base path `api/v1`;
OpenAPI at `api/docs`. This table is the exhaustive list; `API_HANDOFF.md` adds the contracts you cannot
infer from a path.

## Identity & sessions

| Operation | Role | Summary |
|---|---|---|
| `POST /api/v1/auth/login` | PUBLIC | Log in with a password |
| `POST /api/v1/auth/logout` | PUBLIC | Log out |
| `GET /api/v1/auth/me` | AUTHENTICATED | Get your own profile |
| `POST /api/v1/auth/otp/request` | PUBLIC | Send a one-time verification code |
| `POST /api/v1/auth/otp/verify` | PUBLIC | Verify a one-time code |
| `POST /api/v1/auth/password/forgot` | PUBLIC | Request a password reset code |
| `POST /api/v1/auth/password/reset` | PUBLIC | Reset your password |
| `POST /api/v1/auth/refresh` | PUBLIC | Get a new access token |
| `POST /api/v1/auth/register` | PUBLIC | Sign up for a new account |
| `GET /api/v1/auth/session` | AUTHENTICATED | Ask whether there is a session, without failing when there is not |
| `DELETE /api/v1/auth/totp` | AUTHENTICATED | Turn off two-factor authentication |
| `POST /api/v1/auth/totp/setup` | AUTHENTICATED | Start setting up two-factor authentication |
| `POST /api/v1/auth/totp/verify` | AUTHENTICATED | Confirm and turn on two-factor authentication |

## Catalogue & places (public browsing)

| Operation | Role | Summary |
|---|---|---|
| `GET /api/v1/catalogue/categories` | AUTHENTICATED | Browse the service categories |
| `GET /api/v1/catalogue/categories/{slug}/services` | AUTHENTICATED | Browse the services in a category |
| `GET /api/v1/catalogue/services/{slug}` | AUTHENTICATED | Get one service, including its checklist |
| `GET /api/v1/catalogue/services/{slug}/issue-options` | AUTHENTICATED | The common faults a customer can pick from when booking this service |

## Search & reputation (public)

| Operation | Role | Summary |
|---|---|---|
| `GET /api/v1/search/providers` | AUTHENTICATED | Find providers who offer a service near a point |
| `GET /api/v1/search/providers/{providerId}` | AUTHENTICATED | Get a provider’s full public profile |
| `GET /api/v1/search/providers/{providerId}/next-slots` | AUTHENTICATED | When is this provider next free? |
| `GET /api/v1/search/providers/{providerId}/remarks` | AUTHENTICATED | A provider’s published remarks |
| `GET /api/v1/search/providers/{providerId}/reputation` | AUTHENTICATED | A provider’s public reputation |
| `GET /api/v1/search/providers/{providerId}/slots` | AUTHENTICATED | List the times a provider can be booked on a day |

## Customer profile & addresses

| Operation | Role | Summary |
|---|---|---|
| `GET /api/v1/customer/addresses` | CUSTOMER | List my saved addresses |
| `POST /api/v1/customer/addresses` | CUSTOMER | Save a new address |
| `DELETE /api/v1/customer/addresses/{id}` | CUSTOMER | Remove a saved address |
| `PATCH /api/v1/customer/addresses/{id}` | CUSTOMER | Update a saved address |

## Booking lifecycle

| Operation | Role | Summary |
|---|---|---|
| `GET /api/v1/bookings` | AUTHENTICATED | List my bookings |
| `POST /api/v1/bookings` | AUTHENTICATED | Check out a booking |
| `GET /api/v1/bookings/{id}` | AUTHENTICATED | Read one booking |
| `POST /api/v1/bookings/{id}/accept` | AUTHENTICATED | Accept a booking request |
| `POST /api/v1/bookings/{id}/cancel` | AUTHENTICATED | Cancel a scheduled booking |
| `POST /api/v1/bookings/{id}/cash-received` | AUTHENTICATED | Confirm the customer paid cash |
| `GET /api/v1/bookings/{id}/checklist` | AUTHENTICATED | Read the service’s checklist for this booking |
| `POST /api/v1/bookings/{id}/checklist/{itemId}` | AUTHENTICATED | Mark a checklist item done |
| `POST /api/v1/bookings/{id}/complete` | AUTHENTICATED | Mark the job complete |
| `POST /api/v1/bookings/{id}/decline` | AUTHENTICATED | Decline a booking request |
| `POST /api/v1/bookings/{id}/depart` | AUTHENTICATED | Mark yourself en route |
| `GET /api/v1/bookings/{id}/evidence` | AUTHENTICATED | List a booking’s photos |
| `POST /api/v1/bookings/{id}/evidence` | AUTHENTICATED | Upload a photo |
| `GET /api/v1/bookings/{id}/invoice.pdf` | AUTHENTICATED | Download the invoice |
| `GET /api/v1/bookings/{id}/messages` | AUTHENTICATED | Read the booking chat |
| `POST /api/v1/bookings/{id}/messages` | AUTHENTICATED | Send a chat message |
| `POST /api/v1/bookings/{id}/no-show` | AUTHENTICATED | Report a no-show |
| `GET /api/v1/bookings/{id}/on-behalf-contact` | AUTHENTICATED | Who will receive the provider, when the booking is for someone else |
| `POST /api/v1/bookings/{id}/reschedule` | AUTHENTICATED | Reschedule a booking |
| `POST /api/v1/bookings/{id}/revisions` | AUTHENTICATED | Raise a revised quote for extra work |
| `POST /api/v1/bookings/{id}/revisions/approve` | AUTHENTICATED | Approve the pending revised quote |
| `POST /api/v1/bookings/{id}/revisions/reject` | AUTHENTICATED | Reject the pending revised quote |
| `GET /api/v1/bookings/{id}/service-address` | AUTHENTICATED | Where this job is |
| `POST /api/v1/bookings/{id}/start` | AUTHENTICATED | Start the job with the customer’s code |
| `POST /api/v1/bookings/{id}/warranty-claim` | AUTHENTICATED | Claim under warranty |
| `POST /api/v1/bookings/checkout` | AUTHENTICATED | Check out a booking (alias of POST /bookings) |
| `POST /api/v1/bookings/quote` | AUTHENTICATED | Price a booking before committing to it |

## Provider offers & job execution

| Operation | Role | Summary |
|---|---|---|
| `GET /api/v1/provider/offers` | PROVIDER | List the jobs currently offered to me |
| `POST /api/v1/provider/offers/{id}/accept` | PROVIDER | Accept an offered job |
| `POST /api/v1/provider/offers/{id}/decline` | PROVIDER | Decline an offered job |

## Provider onboarding & availability

| Operation | Role | Summary |
|---|---|---|
| `GET /api/v1/provider/availability` | PROVIDER | Read my weekly availability calendar |
| `PUT /api/v1/provider/availability` | PROVIDER | Replace my weekly availability calendar |
| `GET /api/v1/provider/documents` | PROVIDER | List my uploaded documents |
| `POST /api/v1/provider/documents` | PROVIDER | Submit an identity document |
| `GET /api/v1/provider/profile` | PROVIDER | Read my provider profile |
| `PATCH /api/v1/provider/profile` | PROVIDER | Update my provider profile |
| `GET /api/v1/provider/service-areas` | PROVIDER | List the areas I serve |
| `PUT /api/v1/provider/service-areas` | PROVIDER | Replace the areas I serve |
| `GET /api/v1/provider/time-off` | PROVIDER | List my recorded leave periods |
| `POST /api/v1/provider/time-off` | PROVIDER | Record a leave period |
| `DELETE /api/v1/provider/time-off/{id}` | PROVIDER | Cancel a leave period |

## Provider services & pricing

| Operation | Role | Summary |
|---|---|---|
| `GET /api/v1/provider/services` | PROVIDER | List the services I offer |
| `DELETE /api/v1/provider/services/{serviceId}` | PROVIDER | Stop offering a service |
| `PUT /api/v1/provider/services/{serviceId}` | PROVIDER | Offer a service at your price |

## Uploads (presigned targets)

| Operation | Role | Summary |
|---|---|---|
| `POST /api/v1/uploads/presign` | AUTHENTICATED | Get an upload target for a document |

## Provider money

| Operation | Role | Summary |
|---|---|---|
| `POST /api/v1/provider/debt/pay` | PROVIDER | Pay commission debt online |
| `GET /api/v1/provider/earnings` | PROVIDER | See my earnings |
| `GET /api/v1/provider/payout-accounts` | PROVIDER | List my payout accounts |
| `POST /api/v1/provider/payout-accounts` | PROVIDER | Add a payout account |
| `GET /api/v1/provider/payouts` | PROVIDER | List my payouts |
| `POST /api/v1/provider/payouts` | PROVIDER | Request a payout |
| `GET /api/v1/provider/wallet` | PROVIDER | See my wallet and commission debt |

## Verification agent console

| Operation | Role | Summary |
|---|---|---|
| `GET /api/v1/agent/queue` | AGENT | See the verification queue |
| `POST /api/v1/agent/queue/claim` | AGENT | Claim the next call |
| `GET /api/v1/agent/verifications/{id}` | AGENT | Open the console for a call you hold |
| `GET /api/v1/agent/verifications/{id}/attempts` | AGENT | List the call attempts so far |
| `POST /api/v1/agent/verifications/{id}/attempts` | AGENT | Log a call attempt |
| `POST /api/v1/agent/verifications/{id}/call` | AGENT | Call the customer |
| `POST /api/v1/agent/verifications/{id}/release-lock` | AGENT | Put a claimed call back |
| `POST /api/v1/agent/verifications/{id}/submit` | AGENT | Submit the verification |

## Customer verification link

| Operation | Role | Summary |
|---|---|---|
| `GET /api/v1/v/{token}` | AUTHENTICATED | Open a verification link (customer) |
| `POST /api/v1/v/{token}` | AUTHENTICATED | Answer a verification link (customer) |

## Provider reputation & conduct

| Operation | Role | Summary |
|---|---|---|
| `GET /api/v1/admin/providers/{providerId}/ratings` | ADMIN | Review a provider’s ratings |
| `POST /api/v1/admin/remarks/{id}/unpublish` | ADMIN | Unpublish an abusive remark |
| `GET /api/v1/provider/conduct` | PROVIDER | See my conduct record |
| `GET /api/v1/provider/penalties` | PROVIDER | See my penalties |
| `GET /api/v1/provider/penalties/{id}` | PROVIDER | Read one of my penalties |
| `POST /api/v1/provider/penalties/{id}/appeal` | PROVIDER | Appeal an applied penalty |
| `POST /api/v1/provider/penalties/{id}/reply` | PROVIDER | Reply to a proposed penalty |
| `GET /api/v1/provider/ratings` | PROVIDER | See the ratings I received |
| `POST /api/v1/provider/remarks/{id}/reply` | PROVIDER | Reply to a remark |

## Complaints (raised by either party)

| Operation | Role | Summary |
|---|---|---|
| `GET /api/v1/complaints` | AUTHENTICATED | List my complaints |
| `POST /api/v1/complaints` | AUTHENTICATED | Raise a complaint |
| `GET /api/v1/complaints/{id}` | AUTHENTICATED | Read a complaint and its timeline |
| `POST /api/v1/complaints/{id}/evidence` | AUTHENTICATED | Add a photo to a complaint |
| `POST /api/v1/complaints/{id}/reply` | AUTHENTICATED | Reply on a complaint |
| `POST /api/v1/complaints/from-receipt` | AUTHENTICATED | Report a problem from a receipt link |

## Disputes (a provider sees these)

| Operation | Role | Summary |
|---|---|---|
| `GET /api/v1/provider/disputes` | PROVIDER | See my disputes |
| `GET /api/v1/provider/disputes/{id}` | PROVIDER | Read a dispute on my job |
| `POST /api/v1/provider/disputes/{id}/reply` | PROVIDER | Reply to a dispute |

## Finance

| Operation | Role | Summary |
|---|---|---|
| `GET /api/v1/finance/cash-reconciliation` | FINANCE | Reconcile cash jobs |
| `GET /api/v1/finance/debts` | FINANCE | List commission debts |
| `GET /api/v1/finance/escrow` | FINANCE | See the money held in escrow |
| `GET /api/v1/finance/ledger` | FINANCE | Explore the ledger |
| `GET /api/v1/finance/payout-batches` | FINANCE | List payout batches |
| `POST /api/v1/finance/payout-batches` | FINANCE | Create a payout batch |
| `GET /api/v1/finance/payout-batches/{id}/export.csv` | FINANCE | Download the bank file |
| `POST /api/v1/finance/payout-batches/{id}/mark-paid` | FINANCE | Record the bank’s result for a batch |
| `GET /api/v1/finance/payout-batches/{id}/statements/{providerId}` | FINANCE | A provider’s statement for a batch |
| `GET /api/v1/finance/payouts` | FINANCE | List payout requests |
| `POST /api/v1/finance/payouts/{id}/approve` | FINANCE | Approve a payout |
| `POST /api/v1/finance/reconciliation/run` | FINANCE | Run the ledger reconciliation now |
| `GET /api/v1/finance/recordings/{attemptId}` | FINANCE | Play a call recording |
| `GET /api/v1/finance/refunds` | FINANCE | List refunds |
| `POST /api/v1/finance/refunds` | FINANCE | Refund a disputed booking by hand |

## Admin: catalogue & providers

| Operation | Role | Summary |
|---|---|---|
| `POST /api/v1/admin/catalogue/categories` | ADMIN | Create a service category |
| `PATCH /api/v1/admin/catalogue/categories/{id}` | ADMIN | Update a service category |
| `GET /api/v1/admin/catalogue/commission-rules` | ADMIN | List commission rules |
| `POST /api/v1/admin/catalogue/commission-rules` | ADMIN | Set a commission rate |
| `POST /api/v1/admin/catalogue/commission-rules/{id}/end` | ADMIN | Close a commission rule |
| `POST /api/v1/admin/catalogue/services` | ADMIN | Create a bookable service |
| `PATCH /api/v1/admin/catalogue/services/{id}` | ADMIN | Update a bookable service |
| `PUT /api/v1/admin/catalogue/services/{id}/checklist` | ADMIN | Replace a service's checklist |
| `PUT /api/v1/admin/catalogue/services/{id}/issue-options` | ADMIN | Replace a service's common-faults list |
| `POST /api/v1/admin/documents/{documentId}/review` | ADMIN | Verify or reject a document |
| `GET /api/v1/admin/documents/{documentId}/url` | ADMIN | Get a short-lived link to a document |
| `GET /api/v1/admin/provider-services` | ADMIN | Review provider service offers |
| `POST /api/v1/admin/provider-services/{providerId}/{serviceId}/approve` | ADMIN | Approve a provider's offer to provide a service |
| `POST /api/v1/admin/provider-services/{providerId}/{serviceId}/reject` | ADMIN | Reject a provider's offer to provide a service |
| `POST /api/v1/admin/providers/{providerId}/approve` | ADMIN | Approve a provider |
| `GET /api/v1/admin/providers/{providerId}/documents` | ADMIN | List a provider's documents for review |
| `POST /api/v1/admin/providers/{providerId}/reject` | ADMIN | Reject a provider |

## Admin: complaints, disputes & conduct

| Operation | Role | Summary |
|---|---|---|
| `GET /api/v1/admin/appeals` | ADMIN | List appeals |
| `POST /api/v1/admin/appeals/{id}/decide` | ADMIN | Decide an appeal |
| `GET /api/v1/admin/complaints` | ADMIN | The complaint queue |
| `GET /api/v1/admin/complaints/{id}` | ADMIN | Open a complaint |
| `POST /api/v1/admin/complaints/{id}/assign` | ADMIN | Assign a complaint |
| `POST /api/v1/admin/complaints/{id}/open-dispute` | ADMIN | Freeze the job’s money as a dispute |
| `POST /api/v1/admin/complaints/{id}/transition` | ADMIN | Move a complaint along, or decide it |
| `GET /api/v1/admin/disputes` | ADMIN | The dispute queue |
| `GET /api/v1/admin/disputes/{id}` | ADMIN | Open a dispute: the evidence floor |
| `POST /api/v1/admin/disputes/{id}/resolve` | ADMIN | Rule on a dispute |
| `GET /api/v1/admin/penalties` | ADMIN | List penalties |
| `POST /api/v1/admin/penalties` | ADMIN | Propose a penalty |
| `GET /api/v1/admin/penalties/{id}` | ADMIN | Read a penalty |
| `POST /api/v1/admin/penalties/{id}/apply` | ADMIN | Apply a penalty |
| `POST /api/v1/admin/penalties/{id}/withdraw` | ADMIN | Withdraw a proposed penalty |

## Admin: templates, settings & notifications

| Operation | Role | Summary |
|---|---|---|
| `GET /api/v1/admin/notifications` | ADMIN | The notification delivery log |
| `GET /api/v1/admin/settings` | ADMIN | List all platform settings |
| `GET /api/v1/admin/settings/{key}` | ADMIN | Read one setting's current value |
| `PUT /api/v1/admin/settings/{key}` | ADMIN | Change a setting's value |
| `GET /api/v1/admin/templates` | ADMIN | List notification templates |
| `POST /api/v1/admin/templates` | ADMIN | Create a template |
| `GET /api/v1/admin/templates/{id}` | ADMIN | Read a template |
| `PUT /api/v1/admin/templates/{id}` | ADMIN | Edit a template |
| `POST /api/v1/admin/templates/preview` | ADMIN | Preview a template |

## Notification centre

| Operation | Role | Summary |
|---|---|---|
| `GET /api/v1/notifications` | AUTHENTICATED | My notification centre |
| `POST /api/v1/notifications/{id}/read` | AUTHENTICATED | Mark one notification read |
| `POST /api/v1/notifications/read-all` | AUTHENTICATED | Mark all my notifications read |

## Places (cities & areas)

| Operation | Role | Summary |
|---|---|---|
| `GET /api/v1/places/cities` | AUTHENTICATED | List the cities the platform operates in |
| `GET /api/v1/places/cities/{cityId}/areas` | AUTHENTICATED | List the areas within a city |

## Provider-webhook callbacks (never called by the frontend)

| Operation | Role | Summary |
|---|---|---|
| `POST /api/v1/webhooks/payments/{provider}` | AUTHENTICATED | Payment provider webhook (not for direct use) |
| `POST /api/v1/webhooks/sms/{provider}` | AUTHENTICATED | SMS delivery receipt (not for direct use) |

## Development-only mocks

| Operation | Role | Summary |
|---|---|---|
| `GET /api/v1/dev/inbox` | AUTHENTICATED | View messages the mock SMS/email/WhatsApp senders "sent" |
| `GET /api/v1/dev/payments/{paymentId}` | AUTHENTICATED | Mock payment page (where the mock gateway redirects to) |
| `POST /api/v1/dev/payments/{paymentId}/complete` | AUTHENTICATED | Complete a mock payment |
| `GET /api/v1/dev/storage/{bucket}/{key}` | AUTHENTICATED | Download a file from the mock file storage |
| `PUT /api/v1/dev/storage/{bucket}/{key}` | AUTHENTICATED | Upload a file to the mock file storage |

## Health & welcome

| Operation | Role | Summary |
|---|---|---|
| `GET /` | PUBLIC | Welcome message |
| `GET /health/live` | PUBLIC | Is the server process running? |
| `GET /health/queues` | PUBLIC | How many jobs are waiting in each background queue |
| `GET /health/ready` | PUBLIC | Is the API fully ready to handle requests? |
