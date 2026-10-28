# Frontend Direction: Scheduling Gates, Provider Badges, Accept-Then-Decline Penalty, Address Lock, Service Values, Homes Plans

Implementation brief for the frontend engineering team covering six backend changes just shipped on `backend-dev`. Companion document to `API_HANDOFF.md`, `SRS.md`, and `DIRECTION_FRONTEND_EMERGENCY_AND_SCHEDULED_BOOKINGS.md` (that doc's Part 2, "Scheduled Start Timing Guards", described the *intended* behaviour; this one documents what the backend now actually enforces, including the exact error code and the two settings the countdowns must be computed from).

---

## 1. Scheduled Start Timing Gates (now enforced server-side)

A new error code, **`TOO_EARLY`** (HTTP 400), is returned by three endpoints when called before the job's scheduled window allows it. This closes the gap described in the companion doc — these gates were previously only a frontend convention; they are now enforced by the API itself, so a frontend that skips its own countdown logic will simply get a 400 back.

| Endpoint | Earliest allowed | Driven by |
|---|---|---|
| `POST /bookings/:id/depart` | `scheduledStart - booking.travel_buffer_min` (default **30 min**) | Same setting as the existing travel buffer |
| `POST /bookings/:id/start-code` | Status is already `EN_ROUTE`, **or** `scheduledStart - booking.early_start_grace_min` (default **15 min**) | New setting |
| `POST /bookings/:id/start` | `scheduledStart - booking.early_start_grace_min` (default **15 min**) | New setting |

Both settings are readable from `GET /admin/settings` (or wherever the app already reads `booking.travel_buffer_min` for the existing depart-countdown UI) — do not hardcode 30/15, they are configurable.

**Error shape** (RFC7807 `application/problem+json`, same envelope as every other domain error):
```jsonc
{
  "type": "https://smart-home.local/problems/too-early",
  "title": "Too Early",
  "status": 400,
  "detail": "You cannot depart earlier than 30 minutes before the scheduled visit."
}
```
`start-code` and `start` return the same shape with their own `detail` text ("Your start code will be shown once your technician departs, or 15 minutes before the scheduled visit." / "Cannot start job before the scheduled appointment time (scheduled: 2026-10-30T10:00:00.000Z).").

**Frontend action required:**
- Provider app: keep disabling "Depart" until `scheduledStart - travel_buffer_min`, and disabling the start-code/OTP entry screen until `scheduledStart - early_start_grace_min` — this was already the recommended UX, it is now also the enforced floor. If the countdown logic has any edge-case gap, the 400 is the backstop; show its `detail` verbatim rather than a generic error.
- Customer app: `requestStartCode` (`POST /bookings/:id/start-code`) can now 400 with `TOO_EARLY` instead of returning a code — show the same "will be shown once your technician departs" message the companion doc already specifies, driven by the real error now instead of a client-side guess.

---

## 2. Provider Badges Now Require Admin Approval

Badges (`TRUSTED` / `PRO` / `ELITE`) are still computed automatically from verified-job counts, but a newly computed tier **no longer appears publicly until an admin approves it**. The `Reputation` response shape gained one field:

```ts
type Reputation = {
  score: number | null;
  ratingCount: number;
  distribution: { '1': number; '2': number; '3': number; '4': number; '5': number };
  verifiedJobs: number;
  badge: string | null;        // unchanged shape — but now always the admin-approved badge
  pendingBadge: string | null; // NEW — the computed badge awaiting approval, if different from `badge`
};
```

- **`GET /search/providers/:id/reputation`** (public profile): `pendingBadge` is always `null` here — the public profile must never show an unapproved tier. Nothing else to change; `badge` behaves exactly as before.
- **`GET /provider/ratings`** (provider's own dashboard): now may return a non-null `pendingBadge`. Show a small "Pending admin approval: ELITE" banner near the current badge when this is set — do not treat it as the provider's live badge.
- **`GET /admin/providers/:providerId/ratings`** (admin view): same `pendingBadge` field, for the same reason.

**New admin endpoints** (admin app only, all `roles: ['ADMIN']` + TOTP):
| Method & path | Purpose |
|---|---|
| `GET /admin/providers/badges/pending` | List every provider with a pending tier change, oldest first: `{ items: [{ providerId, currentBadge, pendingBadge, pendingSince }] }` |
| `POST /admin/providers/:providerId/badge/approve` | Approves — the pending tier becomes the live, public badge. Returns `{ providerId, badge }`. |
| `POST /admin/providers/:providerId/badge/reject` | Rejects — live badge is untouched, pending is cleared. Body: `{ "reason": "..." }` (3–500 chars). Returns `{ providerId, badge }`. |

Build an admin queue screen off `GET /admin/providers/badges/pending` with Approve/Reject actions, mirroring the existing provider-onboarding approval screen if one already exists.

---

## 3. New Penalty: Accepting a Job Then Cancelling

A provider who accepts a booking and later cancels it was previously only penalized if the cancellation landed inside the free-cancel window (`LATE_CANCEL`). Cancelling well ahead of time had **no** consequence. There is now a second, lighter breach type for exactly that gap:

| Code | When it fires | Points | Fine |
|---|---|---|---|
| `LATE_CANCEL` (existing) | Provider cancels inside `booking.free_cancel_hours` of the slot | 3 | PKR 500 |
| **`ACCEPTED_THEN_DECLINED`** (new) | Provider cancels **outside** that window, after having accepted | 2 | PKR 200 |

No API shape changed — this surfaces through the same places `LATE_CANCEL` already does (the provider's conduct/penalty history, any admin penalty queue, and push/SMS notifications driven by `penalty.proposed` events). **If the provider app or admin app has a hardcoded map of breach codes to display labels, add `ACCEPTED_THEN_DECLINED` → "Cancelled after accepting the job"** so it doesn't fall through to a raw code or a blank label.

---

## 4. Address Locked While Booked On Someone Else's Behalf

When a customer books "for someone else" (`isOnBehalf: true`), the address they picked is now locked against edits for as long as that booking is active. New error code **`ADDRESS_LOCKED`** (HTTP 409):

```jsonc
{
  "type": "https://smart-home.local/problems/address-locked",
  "title": "Address Locked",
  "status": 409,
  "detail": "This address cannot be changed while it is in use for an active booking made on someone else's behalf."
}
```

- `PATCH /customer/addresses/:id` — returns `ADDRESS_LOCKED` **only when the edit touches location** (`line1`, `line2`, `areaId`, or `lat`/`lng`). Editing just `label`, `notes`, or `isDefault` on a locked address still succeeds.
- `DELETE /customer/addresses/:id` (archive) — returns `ADDRESS_LOCKED` unconditionally while locked.
- The lock clears itself automatically once the booking reaches a terminal status (`CLOSED`, `CANCELLED_CUSTOMER`, `CANCELLED_PROVIDER`, `NO_SHOW`, `REFUNDED`, `UNFULFILLED`, `ABANDONED`) — no separate "unlock" action exists or is needed.

**Frontend action required:** in the saved-addresses screen, catch `ADDRESS_LOCKED` on edit/delete and show something like *"This address can't be changed right now — it's in use for an active booking made on someone else's behalf."* rather than a generic failure toast. Consider greying out the location fields (keeping label/notes editable) on an address you already know is tied to an open on-behalf booking, to avoid the round-trip.

---

## 5. Services Must Have Real Prices (admin catalogue UI only)

`POST /admin/catalogue/services` and `PATCH /admin/catalogue/services/:id` now reject `basePricePaisa` or `minPricePaisa` of `0` with the standard `422 VALIDATION_FAILED` zod error — both must be positive integers. `maxPricePaisa` and `visitFeePaisa` are unaffected (still `>= 0`). Only relevant to the admin catalogue management screen; customer- and provider-facing service listings are unchanged.

---

## 6. Seeded "Homes" Subscription Plans

Two real subscription plans now exist in every freshly seeded environment (no new endpoints — the existing `GET /plans`, `GET /plans/:id`, `POST /plans/:id/subscribe` already serve them):

- **Home Essentials** — PKR 5,200 / 12 months — 2× AC service, 1× switch & socket repair.
- **Home Care Plus** — PKR 14,500 / 12 months — 4× AC service, 2× washing machine repair, 2× switch & socket repair.

If the plans screen currently shows an empty state because no plan data existed in dev/staging, it should now render these two real cards after the next `db:seed` run.

---

## 7. Definition of Done for Frontend Implementation

- [ ] Depart / start-code / start all handle `TOO_EARLY` with the server's `detail` text, not just client-side disabling.
- [ ] Provider's own reputation screen shows `pendingBadge` as a distinct "awaiting approval" state, never as the live badge.
- [ ] Public provider profile never renders a pending badge (it won't receive one, but don't special-case around it either).
- [ ] Admin app has a badges-pending queue with approve/reject, calling the three new `admin/providers/.../badge/*` endpoints.
- [ ] Breach-code label maps (provider conduct history, admin penalty queue) include `ACCEPTED_THEN_DECLINED`.
- [ ] Saved-addresses screen surfaces `ADDRESS_LOCKED` with a specific message, distinct from a generic save failure.
- [ ] Admin catalogue form validates price fields client-side too, so a zero price is caught before the round-trip.
