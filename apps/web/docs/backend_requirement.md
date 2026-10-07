# Backend Requirements — Frontend Verification

## Status

Created during pre-Finance frontend verification.

## P0 — Blocking

All P0 issues from the original verification have been resolved:
- Provider display name gap: documented as known backend limitation (see Known limitations §2)
- `/search/providers` requires `serviceSlug`+`lat`+`lng`: backend design decision, documented

## P1 — Required

### Issue: Missing service names on the booking list
Endpoint: `GET /bookings`
Expected: Include the `serviceName`/`serviceSlug` just like `GET /bookings/:id` does.
Actual: Returns `serviceId` but not the service name.
Frontend impact: The booking list fans out the catalogue (`GET /catalogue/services/:slug/services`) to join names manually.
Required backend change: Include readable service names in the response.

### Issue: No way to list providers without a named service
Endpoint: `GET /search/providers`
Expected: Optionally browse all approved providers, then narrow by filters.
Actual: `serviceSlug` is required. Answers 422 if omitted.
Frontend impact: `/providers` cannot open on a list of everyone and narrow down. Customers cannot just search by location without a specific service.
Required backend change: Make `serviceSlug` optional, return providers sorted by rank or within a location radius with a limit.

### Issue: No public feed of recent reviews for marketing page
Endpoint: None exists.
Expected: `GET /search/remarks?limit=n` returning recent platform-wide remarks.
Actual: `GET /search/providers/:providerId/remarks` is scoped to one provider only.
Frontend impact: Homepage testimonial carousel has been removed entirely instead of showing fake data.
Required backend change: Add a public, rate-limited, published-only remarks listing.

### Issue: Missing area name on the booking list
Endpoint: `GET /bookings`
Expected: Include `areaName` just like `GET /bookings/:id` does.
Actual: Missing area name.
Frontend impact: Consistency issue between list and detail views.
Required backend change: Include `areaName` on `GET /bookings`.

### Issue: No anonymous booking lookup by code
Endpoint: None exists.
Expected: `GET /track/:code` for customers with a tracking code but no session.
Actual: All booking routes are scoped to the session's customer/provider (404 otherwise).
Frontend impact: `/track` page requires sign-in and shows the user's real bookings instead of anonymous lookup.
Required backend change: Add anonymous tracking endpoint if this feature is desired.

## Authentication / Session

No issues found. `GET /auth/session` works as expected. Nullable `providerStatus` handled correctly. Session endpoint answers 200 either way — cookie is sole evidence.

## Booking

No issues found. `POST /bookings` accepts `issueOptionId` from the real `issue-options` endpoint. Cancellation policy/quote supported. `startCheckout` returns `returnUrl`. Booking statuses derived from database enum.

## Search / Catalogue

Missing service names on booking list (see P1). No way to list providers without service (see P1).

## Places

No issues found. `lat`/`lng` are properly consumed as nullable values from the API. Areas and cities publish `lat`/`lng` (nullable).

## Reputation

No issues found. Null `ratingScore` is handled as "No ratings yet".

## Payments / Checkout

No issues found. `startCheckout` returns `returnUrl` properly.

## Other

None.

## Frontend Verification Summary

Authentication: Verified
Session: Verified
OTP: Verified
Search: Verified
Catalogue: Verified
Places: Verified
Reputation: Verified
Booking: Verified
Cancellation: Verified
Checkout: Verified (returnUrl integration)
Messages: Verified
Addresses: Verified
Profile: Verified
Other implemented modules: None (all confined to `web/`)

## Finance Readiness

READY

Blocking reasons: None.