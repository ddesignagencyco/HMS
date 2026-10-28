# Frontend Direction: Emergency Booking Fallbacks & Scheduled Job Timing Gates

Implementation brief for the frontend engineering team covering two critical booking lifecycle rules:
1. **Emergency Booking Fallback**: How the client app handles emergency bookings when zero slots are available for the current day.
2. **Scheduled Start Guard**: Preventing providers from departing or starting jobs before the scheduled date and time window.

Companion document to `API_HANDOFF.md` (§2.2 Booking Flow & §2.3 Provider Execution) and `SRS.md` (FR-CAT-06, FR-BK-01..04, FR-EX-02).

---

## Part 1: Emergency Booking When No Slots Available Today

### 1.1 The Problem
A customer has an urgent home crisis (e.g., burst pipe, electrical blackout, active water/gas leak) and selects an emergency-eligible service (`is_emergency_eligible = true`) with the emergency toggle active (`isEmergency: true`, incurring the 25% surcharge).
When browsing slots for **Today**, the response is empty (`items: []`) because:
- The specifically selected provider is fully booked, off-duty, or has finished their declared hours for today (`provider_availability`).
- Or, under auto-assign, all regular working windows for the day have passed or are filled.

The app must **never leave the user at a dead end** ("No slots available, please try another day"). For emergencies, abandonment means property damage.

---

### 1.2 The Three-Tier Fallback Strategy

```
                                [ Customer requests Emergency Booking Today ]
                                                    │
                                     Does selected provider have slots today?
                                          ├── YES ──> Proceed to normal emergency checkout
                                          └── NO
                                                    │
                                   ▼ [ TIER 1: AUTO-ASSIGN FALLBACK ]
                        "Provider is booked. Broadcast to nearest on-call tech?"
                                          ├── YES ──> Checkout with providerId: undefined (Auto-assign)
                                          │           (OfferService broadcasts to nearby providers)
                                          └── NO / No tech accepts within 60 min
                                                    │
                                   ▼ [ TIER 2: PRIORITY MORNING SLOT ]
                       "Book first emergency priority slot tomorrow (08:00 AM)"
                                          ├── YES ──> Checkout with tomorrow's earliest slot
                                          └── NO
                                                    │
                                   ▼ [ TIER 3: EMERGENCY HOTLINE ]
                       "Call 24/7 Ops Desk directly: 042-111-SMART"
```

---

### 1.3 Implementation Details for Tier 1: Auto-Assign Emergency Broadcast

#### When to trigger:
When `GET /api/v1/search/providers/:id/slots?date=YYYY-MM-DD` returns `items: []` for today's date, or when customer selects "Emergency Mode" on service details.

#### Frontend UI behavior:
1. Show a prominent **Emergency Dispatch Modal / Banner**:
   > **"Technician Fully Booked Today"**
   > *"Bilal has no remaining slots today. We can immediately broadcast your emergency to all verified technicians within your area."*
   > `[ Dispatch Nearest Technician ]` `[ Pick Another Time ]`

2. When the user taps `[ Dispatch Nearest Technician ]`:
   - Calculate `scheduledStart`: Current time + `booking.min_notice_min` (30 minutes rounded to next 15/30-min mark).
   - Calculate `scheduledEnd`: `scheduledStart + service.expectedDurationMin`.
   - Call `POST /api/v1/bookings/quote` with:
     ```jsonc
     {
       "serviceId": 1,
       "isEmergency": true
       // providerId is deliberately omitted
     }
     ```
   - Call `POST /api/v1/bookings` with:
     ```jsonc
     {
       "serviceId": 1,
       "addressId": "00000000-0000-0000-0000-000000000000",
       "paymentMode": "ONLINE", // or "CASH"
       "isEmergency": true,
       "scheduledStart": "2026-10-13T16:00:00.000Z",
       "scheduledEnd": "2026-10-13T17:30:00.000Z"
       // providerId is omitted -> backend sets is_auto_assign = true
     }
     ```

3. **Waiting & Search Screen (Customer UX)**:
   - Display active radar / search animation: *"Contacting nearby emergency technicians..."*
   - Polling / Status: Poll `GET /api/v1/bookings/{id}` every 5 seconds.
   - When a provider accepts: Status changes from `REQUESTED` to `SCHEDULED`. Navigate immediately to live tracking screen.

4. **Auto-Assign Timeout & Guarantee**:
   - The backend runs an offer window timer: `booking.max_offer_window_min` (60 minutes).
   - If no provider accepts within 60 minutes:
     - Backend transitions booking to `UNFULFILLED`.
     - Backend automatically executes a **100% instant refund** for online payments (`payments.queueRefund` with `reasonCode: 'UNFULFILLED'`).
     - Frontend receives status `UNFULFILLED` and shows:
       > *"We could not find an available technician in your area right now. Your payment has been 100% refunded to your original payment method. Would you like to reserve the first slot tomorrow morning?"*

---

### 1.4 Implementation Details for Tier 2: Priority First-Slot Tomorrow

If the customer declines auto-assign, or if it is late night (outside operational hours):
1. Call `GET /api/v1/search/providers/:id/next-slots?serviceId={serviceId}&limit=5`.
2. Find the earliest slot starting tomorrow:
   ```jsonc
   // Example response item
   { "start": "2026-10-14T03:00:00.000Z", "end": "2026-10-14T04:30:00.000Z" } // 08:00 AM PKT
   ```
3. Highlight with an **"Urgent Priority"** badge:
   > *"Earliest Priority Arrival: Tomorrow at 08:00 AM"*
   > `[ Book Priority Morning Slot ]`

---

### 1.5 Implementation Details for Tier 3: 24/7 Operations Helpline

For critical emergencies where digital matching fails:
- Render a direct tap-to-call button linking to `tel:+924211176278`.
- Include booking reference ID (if booking was created) so operations agents can immediately locate the customer's address and account.

---

## Part 2: Scheduled Start Timing Guards

### 2.1 The Problem
When a customer schedules a booking for a future date/time (e.g. Friday at 15:00):
- A provider must **not** be allowed to tap "Depart" days or hours in advance.
- A customer must **not** be prompted to share their Start OTP days in advance.
- Work must **never start before the scheduled appointment window**.

If early starts are unconstrained:
- Technicians show up unannounced when customers are away.
- Start codes leak prematurely over phone calls.
- SLA monitoring, warranties, geofencing, and calendar collision detection break.

---

### 2.2 The Three Timing Gates

```
  ┌─────────────────────────────────────────────────────────────────────────────┐
  │                            SCHEDULED START TIME                             │
  │                                   (T = 0)                                   │
  └──────────────────────────────────────┬──────────────────────────────────────┘
                                         │
        T - 30 mins                      │              T - 15 mins
             ▼                           │                   ▼
   [ DEPARTURE UNLOCKED ]                │          [ START OTP REVEALED ]
   Provider may tap "Depart"             │          Customer app displays OTP;
   (booking enters EN_ROUTE)             │          Provider may enter code to start
```

#### Gate 1: Departure Gate (`POST /bookings/:id/depart`)
- **Earliest Allowed**: `scheduledStart - booking.travel_buffer_min` (Default: **30 minutes before scheduled start**).
- **Rule**: If `now < scheduledStart - 30 minutes`:
  - Backend returns `400 BAD_REQUEST` with code `TOO_EARLY`:
    ```jsonc
    {
      "code": "TOO_EARLY",
      "detail": "You cannot depart earlier than 30 minutes before the scheduled visit."
    }
    ```
- **Provider App UX**:
  - The "Depart" button is **disabled** until `scheduledStart - 30 mins`.
  - Display countdown label:
    > *"Departure unlocks at 14:30 (30 mins before appointment)"*

#### Gate 2: Start OTP Visibility Gate (`POST /bookings/:id/start-code`)
- **Earliest Allowed**: On the calendar day of the visit, once booking status is `EN_ROUTE` or within 15 minutes of `scheduledStart`.
- **Rule**:
  - If requested too early, backend/app returns `canShow: false`.
- **Customer App UX**:
  - Before departure window:
    > *"Your 6-digit start code will be generated once your technician departs for your location."*
  - Inside departure window:
    > Show prominent 6-digit PIN card: `[ 8 4 9 2 0 1 ]` with reminder: *"Share this code with your technician only after they arrive at your door."*

#### Gate 3: Work Start Gate (`POST /bookings/:id/start`)
- **Earliest Allowed**: `scheduledStart - 15 minutes` (15-minute early arrival grace window).
- **Hard Rule**:
  - A job scheduled for Friday **cannot** be started on Thursday or Tuesday.
  - A job scheduled for 15:00 **cannot** be started at 12:00.
  - If `now < scheduledStart - 15 minutes`:
    Backend returns `400 BAD_REQUEST` / `DomainError('TOO_EARLY')`:
    ```jsonc
    {
      "code": "TOO_EARLY",
      "detail": "Cannot start job before the scheduled appointment time (Scheduled: 13 Oct 2026, 15:00)."
    }
    ```
- **Provider App UX**:
  - The OTP entry modal displays scheduled time.
  - If provider opens screen before `T - 15m`:
    Input is disabled with notice:
    > *"Scheduled for 15:00. Start verification unlocks at 14:45."*

---

## 3. Frontend Error & Status Handling Matrix

| Endpoint | HTTP Status | Error Code | Frontend User Message | Action Required |
|---|---|---|---|---|
| `POST /bookings` | 400 | `SLOT_TAKEN` | "This slot was just booked by another customer. Please select another time." | Re-fetch slots and refresh calendar grid. |
| `POST /bookings` | 400 | `NOTICE_WINDOW_REFUSED` | "This service requires at least 30 minutes advance notice." | Adjust start time to `now + 30m`. |
| `POST /bookings/:id/depart` | 400 | `TOO_EARLY` | "You cannot depart earlier than 30 minutes before the scheduled visit." | Disable depart button; show countdown to `T - 30m`. |
| `POST /bookings/:id/start` | 400 | `TOO_EARLY` | "Cannot start job before the scheduled appointment time." | Prevent OTP submission; display appointment start time. |
| `POST /bookings/:id/start` | 422 | `OTP_INVALID` | "The start code is incorrect. {N} attempts remaining." | Clear OTP input and shake card. |
| `POST /bookings/:id/start` | 423 | `OTP_LOCKED` | "Too many incorrect attempts. Start verification is locked for 15 minutes." | Show countdown timer; prompt customer to re-issue code. |

---

## 4. Definition of Done for Frontend Implementation

- [ ] **Emergency Auto-Assign Fallback**: When today's slots are empty for an emergency service, UI displays Tier-1 Auto-Dispatch prompt rather than an empty calendar error.
- [ ] **Emergency Timeout Handling**: Customer UI shows active matching animation; gracefully handles `UNFULFILLED` webhook/poll with refund confirmation.
- [ ] **Tomorrow Priority Slot**: Provides single-tap booking for tomorrow's 08:00 AM slot when night-time emergency requests cannot be dispatched.
- [ ] **Provider Depart Countdown**: Provider job card disables "Depart" until `T - 30 minutes` with live countdown.
- [ ] **Customer Start Code Masking**: Customer detail card hides Start OTP until provider is `EN_ROUTE` or within 15 minutes of slot.
- [ ] **Start Verification Timing Gate**: Provider app prevents entering/submitting OTP earlier than 15 minutes prior to `scheduledStart`.
