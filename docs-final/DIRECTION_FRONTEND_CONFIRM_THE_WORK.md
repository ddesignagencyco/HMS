# FR-VC-16 — Frontend direction: "Confirm the work"

Implementation brief for the customer-side work confirmation and rating form
(SRS FR-VC-16…FR-VC-19). Read `API_HANDOFF.md` §2.4.1 first — this document is the
*how*, not the *what*.

---

## 1. What problem this screen solves, in one line

A booking finishes, and the customer is left waiting for a phone call that may never
come — so the provider's money sits in escrow for up to 72 hours and the customer is
never asked what they thought of the work. This screen is the exit that was missing.
**It is not a nice-to-have next to the call flow. It is the only flow some jobs will
ever have.**

## 2. Where it goes

| Placement | Rule |
|---|---|
| Booking detail screen | The primary entry point. A persistent card whenever `canSelfVerify` is true. |
| Job-complete confirmation | After `POST /bookings/{id}/complete` succeeds, navigate to detail with the card in focus. The provider taps "done", the customer's phone now has the prompt. |
| Push notification | Fire a customer push on `booking.linkConfirmed`… **not built yet** — see §8. Until then, the customer must reach the form from the app on their own. Do not build the flow assuming a push exists. |

Do **not** put this behind a "Rate your provider" menu item people have to go looking
for. The rating and the payment release are the same act, and separating them is what
made the rating get lost in the first place.

## 3. The two endpoints

```
GET  /api/v1/bookings/{bookingId}/verification/confirmation
POST /api/v1/bookings/{bookingId}/verification/confirmation
```

Standard bearer auth, `CUSTOMER` role. No OTP, no token. Prefix is `/api/v1`.

### 3.1 `GET` — render from this, not from the booking status

```jsonc
{
  "bookingCode": "BK-7F2A91",
  "serviceName": "Leak repair",
  "providerFirstName": "Bilal",
  "paymentMode": "ONLINE",          // or "CASH"
  "amountPaisa": 350000,            // integer paisa — divide by 100 for PKR
  "canSubmit": true,
  "blockedReason": null,            // a customer-readable sentence when canSubmit is false
  "questions": [ /* same shape as GET /v/{token}; render from it, do not hardcode */ ]
}
```

**`GET` is always 200 for your own booking.** Never treat "form unavailable" as an
error state — there is no error to render, only a `blockedReason` to show. A client
that gets a 404/409 here has nothing to put on screen.

You also get `canSelfVerify` on every booking row (`GET /bookings/{id}`,
`GET /bookings`). Use it to decide whether to show the card; use `canSubmit` +
`blockedReason` for what to say inside it. They can disagree in one direction only —
an agent can claim the call between the two requests.

The `blockedReason` strings you will meet verbatim:

| String | Show |
|---|---|
| `One of our team is calling you about this job right now.` | "We'll call you shortly" + hide the button |
| `This job has already been paid for.` | Success state, no button |
| `This job has already been confirmed.` | Success state, no button |
| `Self-confirmation is switched off. Our team will call you to confirm this job.` | Informational, no button |

Do not pattern-match these strings for logic. They are for humans; the boolean is for
you. (They are also free to be reworded without a version bump.)

### 3.2 `POST` — the body

```jsonc
{
  "workCompleted": "FULL",           // "FULL" | "PARTIAL" | "NONE"
  "quality": 5,                      // 1–5 each, all four REQUIRED, always
  "punctuality": 5,
  "conduct": 4,
  "cleanliness": 5,
  "extraChargeDemanded": false,
  "consentToRelease": true,          // the explicit "yes, release my money"
  "outcome": "SATISFIED",            // "SATISFIED" | "WITH_ISSUE" | "NOT_ACCEPTABLE"
  "remark": "Sorted it first time."  // optional, max 1000
}
```

Three gotchas, all of which the API enforces:

1. **All four ratings are required even when the customer picks `NOT_ACCEPTABLE`.**
   This looks wrong and is deliberate — the answers are stored on the verification
   record for whoever picks the case up next. Validate them, do not skip the step.
2. **`consentToRelease` must be a separate, explicit tick.** It is the consent the
   release is recorded against. Do not fold it into the submit button; a `422` comes
   back without it, and a customer who did not mean to consent must be able to back out.
3. **The client does not get to decide the outcome.** `workCompleted: "NONE"` or
   `extraChargeDemanded: true` overrides whatever `outcome` says, and the server
   escalates regardless. If you build a UI that lets a customer say "everything was
   fine" and "no work was done" at once, you get a `422`. Prevent that combination in
   the form: choosing either of those should force the "there was a problem" path and
   clear `consentToRelease`.

### 3.3 `POST` — the response

```jsonc
{
  "outcome": "CONFIRMED",            // "CONFIRMED" | "CONFIRMED_WITH_ISSUE" | "ESCALATED"
  "bookingId": "…",
  "bookingStatus": "PAYMENT_RELEASED",
  "message": "Thank you. The payment has been released…",  // render VERBATIM
  "booking": { /* the full refreshed booking row */ }
}
```

Render `message` verbatim. It is the only place the three outcomes are phrased in
words that have been checked against what actually happened to the money.

| `outcome` | `bookingStatus` (ONLINE) | `bookingStatus` (CASH) | Screen |
|---|---|---|---|
| `CONFIRMED` | `PAYMENT_RELEASED` | `VERIFIED` | Thank-you + the rating summary |
| `CONFIRMED_WITH_ISSUE` | `PAYMENT_RELEASED` | `VERIFIED` | Thank-you + "we've told the provider" |
| `ESCALATED` | `AWAITING_VERIFICATION` | `AWAITING_VERIFICATION` | "Someone will call you" — **not** an error |

**For a cash job the form never returns `PAYMENT_RELEASED`.** It authorises the
handover and notifies the provider; they then tap "payment received"
(`POST /bookings/{id}/cash-received`, gated on `booking.canConfirmCashReceived`). Do
not show the customer a "paid" state on a cash job from this response — check
`paymentMode` first.

## 4. `ESCALATED` is the one to get right

It is not a failure, and it is not a dispute. It is the same destination the texted
link sends a negative answer to, and it means: *nothing was released, a person is now
on it, here is what you said.*

- Do **not** render a red error, a retry button, or a "something went wrong".
- Do **not** offer to submit again. The form is single-use per job; the case belongs
  to someone at the platform now.
- Do show the customer that their money has **not** moved and is still held. That is
  the whole reassurance the screen has to give.
- The customer can still raise a complaint separately (`POST /complaints`) — offer the
  link, do not force it.

## 5. Error handling

| Status | Cause | What to do |
|---|---|---|
| `422` | Answers contradict the outcome; missing `consentToRelease` | Show `errors[].message` against the offending field. The API names the field in `path`. |
| `409` | Agent mid-call, job already settled, or the ops switch is off | Show `detail` verbatim. **Re-`GET`** — the booking has probably moved on. Do not retry the POST. |
| `404` | Not your booking | Route away. (Another customer's booking is deliberately indistinguishable from one that does not exist.) |
| `401` | Session gone | Normal re-auth path. |

`409` on this endpoint is routine, not exceptional: an agent picking up the call
mid-tap is a normal race. Treat it as "the state moved, re-read it", not as an error
to surface loudly.

## 6. Derived flags — use them, do not re-derive

Two new fields on every booking row:

- `canSelfVerify` — show the card. Derived from the state machine server-side.
- `canConfirmCashReceived` — **unchanged**, and still the only correct gate for the
  provider's "payment received" button. `paymentStatus` becomes `CASH_DUE` at
  *completion*, long before verification authorises the handover; gating on it shows a
  button the API will reject with a `409`. See `API_HANDOFF.md` §2.5.

## 7. Accessibility and locale

- The four ratings are 1–5. Render as a radio group with a visible label each, not
  stars alone — a star control communicates badly to a screen reader and the API wants
  four distinct integers.
- `remark` is published under the customer's **first name and initial only**
  (FR-RT-06). Do not render, store or display the full name anywhere near the remark.
- Both `en` and `ur` labels are required. Urdu is a first-class locale here, not a
  translation afterthought.
- The booking-completion push/SMS already tells the customer something happened. This
  screen is what they land on.

## 8. Not built yet — do not code against these

| Missing | Impact on you |
|---|---|
| A customer push/SMS for "your job is done, confirm it" | The form is reachable only from the app. **Ship the in-app entry point first**; it is the thing that actually fixes the stuck-payment problem. |
| A standalone "rate a provider later" endpoint | Ratings exist **only** as a by-product of verification. There is no post-hoc review form. Do not design one around this screen. |
| Editing or withdrawing a submitted rating | Ratings are insert-only, at the database. Build the thank-you screen accordingly — nothing is editable afterwards. |
| Provider-side visibility of "customer rated you X" | Not surfaced in the provider UI yet. |

## 9. Definition of done

- [ ] Card appears on booking detail whenever `canSelfVerify`, and disappears after submit
- [ ] Unavailable states render `blockedReason` — no blank space, no error styling
- [ ] All four ratings always required, including on the "not acceptable" path
- [ ] `consentToRelease` is its own explicit tick, clearable
- [ ] `workCompleted: NONE` / `extraChargeDemanded` force the problem path in the UI
- [ ] `message` rendered verbatim on all three outcomes
- [ ] Cash jobs never show a "paid" state from this response
- [ ] `ESCALATED` renders as reassurance, not an error, with no retry
- [ ] `422` field errors map to inputs; `409` re-fetches and shows `detail`
- [ ] Remark UI never displays the customer's full name
- [ ] `en` and `ur` complete
