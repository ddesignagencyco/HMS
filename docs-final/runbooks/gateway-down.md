# Runbook: the payment gateway is down

**Alerts that use this:** contributes to `HighErrorRate`; there is no dedicated rule, and §3 explains
why that is deliberate rather than an omission.

The gateway is an external dependency this platform cannot fix, cannot degrade gracefully for money
movements, and cannot retry into compliance. Everything below is about deciding, quickly and correctly,
between **taking the money later** and **taking it wrong**.

## 1. Establish the scope

```bash
curl -s "http://localhost:3000/api/v1/health/ready"
curl -s http://localhost:3000/metrics | grep -E 'shm_http_requests_total\{.*5[0-9][0-9]|shm_jobs_total\{.*outbox'
```

| Symptom | Reading |
|---|---|
| Captures fail, everything else is fine | The gateway is down. Continue. |
| Captures succeed but *releases* fail | The gateway is up; this is a **ledger** problem, not a gateway problem. Go to [reconciliation-drift.md](./reconciliation-drift.md). |
| Only one webhook delivery is failing | Probably not an outage. §4. |

## 2. What the platform does while the gateway is down

This matters more than any command below, so it is stated first.

**A booking is never blocked by the gateway.** Money is captured *before* work starts, and a booking
that cannot be paid for is not created — the customer is told, and nothing half-done is left behind.
So a gateway outage means **new bookings stop**, not that existing ones break. In-flight bookings
continue, complete, and land in the auto-release path as normal.

**That is the dangerous part.** Releases that fire while the gateway is down either fail and retry —
fine — or, worse, accumulate until a batch goes out in a burst when the gateway returns. So:

```sql
-- What is waiting to be paid out, and how old is it
SELECT status, count(*), min(created_at)
FROM payouts GROUP BY status;
```

## 3. There is deliberately no `GatewayDown` alert

Worth explaining, because its absence looks like an oversight.

An alert on gateway health would fire for *every* gateway blip, including the brief ones the gateway
recovers from on its own before any customer notices. Since customers are **not** blocked by a payment
failure in any flow that has already started — the booking simply is not created — a gateway alert has
no customer-facing consequence to justify waking anyone at 3am for.

What does have a consequence is **money that cannot move**: captured payments not released, and
provider payouts not disbursed. That is what the `OutboxBacklogGrowing`, `QueueBacklogLarge` and
`JobFailureRateHigh` rules cover, and those fire on the platform's own state rather than on a vendor's.

> **If the vendor has a status page, put it in the alert description for the queue rules.** A responder
> staring at a backlog they cannot fix should be told in the first line where to look for whether the
> vendor has already said what happened.

## 4. Is it an outage, or just this webhook?

Most "gateway problems" are one malformed delivery. Check before treating it as an outage:

```sql
SELECT id, gateway, type, received_at, processed_at
FROM payment_events
WHERE processed_at IS NULL
ORDER BY received_at DESC
LIMIT 20;
```

One unprocessed row repeated is a **poison webhook**, not an outage: it will retry until its attempts
are exhausted. Fix the cause and let it through — do not delete it. `payment_events` is keyed on
`(gateway, gateway_event_id)`, which is what makes a duplicate delivery idempotent, so the log is the
audit trail for money that moved.

## 5. While it is down

- **Do not switch the gateway.** The `PAYMENT_PROVIDER` value is validated at boot; changing it
  requires a deployment, and starting a second gateway mid-outage does not migrate money that is
  already in flight at the first one.
- **Do not hand-enter payments** to work around it. Money that entered without a captured webhook has
  no settlement trail, and the reconciliation will flag it as drift with no way to explain it.
- **Tell whoever is watching the queue**, not the whole team. The escalation path for a vendor outage
  is the vendor, not this codebase.

## 6. When it comes back

Confirm the backlog actually drains — the same rule as [queue-backlog.md §5](./queue-backlog.md):
depth falling is not enough if the oldest item's age is not.

```sql
-- Captured but never released: this number should be falling
SELECT count(*) FROM bookings WHERE status = 'AWAITING_VERIFICATION';

-- Any drift the outage caused. Drift detail lives in the outbox event, not in audit_log --
-- see reconciliation-drift.md for why that matters.
SELECT created_at, payload
FROM outbox_events
WHERE type = 'ledger.drift_detected' AND processed_at IS NULL
ORDER BY created_at DESC;
```

If the reconciliation flags anything after a gateway outage, it is almost certainly a capture that
arrived late — after the booking had already been resolved by a retry path. Treat it as
[reconciliation-drift.md](./reconciliation-drift.md) and **do not** correct it by hand.
