# Runbook: reconciliation drift

**Alerts that use this:** `ReconciliationDriftFound`, `EscrowBalanceDropped`

**Read this before doing anything.** This platform treats the ledger as the sole authority for money.
Bookings, payouts and commission figures are all *derived* from it. If the ledger does not balance,
every number anyone is shown — including the ones a customer is looking at — is untrustworthy.

**Do not "fix" this by adjusting a balance.** A discrepancy is a symptom of a bug; writing a
correcting entry by hand makes the books balance and destroys the evidence of what went wrong.

## 1. Find out which check failed

**Where the detail lives is not obvious, and the obvious place is the wrong one.** `audit_log` has a
`ledger.reconcile` row, but it records only a **count** — `{"checks": 9, "drift": 2}`. The actual
findings are in the outbox event, whose payload carries the first 50 drifts with their expected and
actual values:

```sql
SELECT created_at, payload
FROM outbox_events
WHERE type = 'ledger.drift_detected' AND processed_at IS NULL
ORDER BY created_at DESC
LIMIT 5;
```

```json
{"drift": [{"check": "payout_clearing", "subject": "…", "expected": "…", "actual": "…"}]}
```

> **Operational consequence, and a real gap.** The detail of a money discrepancy lives only in an
> outbox row that the dispatcher will eventually clear. `audit_log` keeps the count forever; the
> specifics do not. If the outbox is pruned — and retention is a sensible thing to do to a table
> that grows forever — the evidence of *what* drifted is gone, and what survives is "2 drifts" with
> no way to investigate. Persisting the findings to their own table should happen before this system
> handles real money. It is called out here rather than quietly worked around.

The count history, which does survive:

```sql
SELECT created_at, after
FROM audit_log
WHERE action = 'ledger.reconcile'
ORDER BY created_at DESC
LIMIT 20;
```

The `check` field names the invariant. The two that matter most:

| Check | What it means when it fires |
|---|---|
| `PAYOUT_CLEARING` | The payout clearing account does not equal the sum of open payouts. Money approved for payout is not where the system thinks it is. |
| `ESCROW_HOLDS` | Escrow does not equal the sum of bookings that should be holding money. Either money is held for work that finished, or it was released for work that did not. |

## 2. Work out which side is wrong

Every drift is one of two things, and they need opposite responses:

1. **The ledger is right and a derived figure is stale.** Usually a projection or a cache that did
   not refresh. Low severity — but confirm before assuming.
2. **A ledger entry is genuinely missing or duplicated.** A write path that lost a transaction, or a
   retry that wrote twice. This is the real bug and it is a code defect.

Narrow it down by comparing the two sides directly:

```sql
-- Escrow held vs. what should be holding it
SELECT
  (SELECT coalesce(sum(b.balance), 0) FROM ledger_accounts a
     JOIN account_balances b ON b.account_id = a.id WHERE a.type = 'ESCROW') AS escrow_held,
  (SELECT coalesce(sum(approved_total_paisa - COALESCE(released_paisa, 0)), 0)
     FROM bookings WHERE status IN ('CLOSED','AWAITING_VERIFICATION') ) AS should_be_held;
```

## 3. Where the likely cause is

If the ledger is genuinely wrong, the entry was written outside the normal paths. In order of
likelihood:

- **A webhook processed twice.** Payment webhooks are the classic source: a duplicate delivery that
  was not idempotent. `payment_events` is unique on `(gateway, gateway_event_id)`, so look for a
  provider that sent the same event twice and was accepted once — the drift would come from the
  *second* processing path, not from a duplicate row.
- **A retry that raced an original.** Any queue job whose work is not idempotent can do this.
- **A manual correction.** Someone with admin access adjusted a balance.

Every one of these should be accompanied by an audit row. If there is no audit row for the change,
that is itself the finding, and the ticket should say so.

## 4. Resolving

1. **Fix the code** that produced the entry. Without this, the next occurrence re-breaks the books.
2. **Record the correcting entry** through the ledger service, with an audit row saying what it
   corrects and why. Never a bare SQL `UPDATE` on a balance — a balance edited by hand has no trail,
   which is the entire thing that went missing.
3. **Re-run the reconciliation.** It is a normal admin action and needs no special tooling:

```sql
-- the run this produces leaves a ledger.reconcile audit row and, if it still finds drift,
-- a fresh ledger.drift_detected outbox event with the current findings in its payload
SELECT count(*) FROM audit_log WHERE action = 'ledger.reconcile' AND created_at > now() - interval '1 hour';
```

Confirm the finding is gone by re-reading the outbox payload (§1). Note that the *old* `ledger.drift_detected`
rows remain — they are history, and deleting them destroys the evidence trail that §3 depends on.

## 5. Confirming

The alert clears on its own once `shm_reconciliation_drift_total` stops increasing. What matters is
that a *new* run produces no drift:

```bash
curl -s http://localhost:3000/metrics | grep shm_reconciliation_drift_total
```

A counter that is still climbing means the drift is recurring, not resolved. See "when to escalate"
below — three occurrences of the same check is an engineer problem, not an on-call one.

## When to escalate

Stop and escalate rather than continuing if:

- The drift involves **escrow** and the cause is not immediately obvious. Money held for the wrong
  booking is a customer-facing problem, and a wrong correction is worse than an unresolved one.
- The same check has fired **three times**. That is a recurring bug, not an incident, and it needs an
  engineer rather than an on-call responder.
- Any correcting entry would be **large**. Above roughly one month's commission, get a second person
  to review the entry before it is written.
