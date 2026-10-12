# Runbook: the API is down or erroring

**Alerts that use this:** `ApiDown`, `HighErrorRate`, `HighLatencyOverall`

The first question is always the same: **is the API down, or is something it depends on down?** They
look identical from the outside — customers see failing requests either way — and they have completely
different fixes.

## 1. Is it actually down?

```bash
curl -fsS http://localhost:3000/health/live     # process is up and responding
curl -fsS http://localhost:3000/health/ready    # process is up AND its dependencies are reachable
```

| `live` | `ready` | Meaning |
|---|---|---|
| fails | — | The process is not serving. Go to §2. |
| passes | fails | A dependency is unreachable. Go to §3. This is the common one. |
| passes | passes | The API is healthy. Go to §4 — you have a different problem. |

`live` and `ready` are deliberately different: `live` answers "is this process running", `ready`
answers "should traffic be sent here". Configuring a load balancer to poll `live` is a mistake that
turns a database outage into an API outage.

## 2. The process is down

```bash
docker compose ps api                    # or: systemctl status smart-home-api
docker compose logs --tail 200 api
```

Look for, in order:

- **OOM killed** — `dmesg -T | grep -i "killed process"`. Raise the container's memory limit, or find
  the leak in the process metrics (`process_resident_memory_bytes` from the default collectors).
- **A crash at startup** — almost always the environment schema refusing to boot. Read the first
  line of the log; it names the variable and what was expected. This is deliberate: a deployment
  with a development secret fails to start rather than starting insecurely.
- **A port already in use** — usually a previous process that did not exit.

## 3. A dependency is unreachable

`health/ready` names which one. In rough order of likelihood:

| Check | Command | Healthy looks like |
|---|---|---|
| Database | `docker exec smart-home-postgis pg_isready -U smart_home -d smart_home` | `accepting connections` |
| Redis | `docker exec smart-home-redis redis-cli ping` | `PONG` |

If the database is refusing connections, check disk space first. A full Postgres volume refuses
connections before it does anything else, and it looks identical to a crash.

**If Redis is down**, the API stays up and booking requests will start failing — the rate limiter and
the settings cache both need it. Restarting Redis is safe: the settings cache rebuilds itself from
the database, and the rate-limit windows reset (which briefly permits a burst).

## 4. The API is healthy but requests are failing

Check what is actually failing before assuming the cause:

```bash
curl -s http://localhost:3000/metrics | grep -E '^shm_http_requests_total|^shm_queue_depth'
```

- Errors concentrated on **one route label** → that route's bug, not a platform failure.
- Errors spread across all routes, with `shm_queue_depth` climbing → the workers are down. Go to
  [queue-backlog.md](./queue-backlog.md).
- Every 5xx with healthy dependencies → read the Sentry project for the stack. The error is already
  scrubbed of CNICs, phone numbers and tokens, so it is safe to paste into a ticket.

## 5. Confirming it is over

Do not close on "requests are succeeding again" alone. Confirm the metric that alerted has actually
recovered — the alert has a `for:` duration precisely so it does not flap, and it will stay firing
until it does.

```bash
curl -s http://localhost:3000/metrics | grep shm_outbox_oldest_seconds
```

An outbox backlog that is draining *is* the system recovering. One that is still growing means the
API is answering requests while nothing is processing the work behind them, which looks like health
on every dashboard and is not.

## When to escalate

Escalate rather than continuing to debug when:

- **The database is gone and not coming back within a few minutes.** Restore is the only answer, and
  the decision about whether to restore takes longer than the restore itself — so start the
  conversation early. See [restore-drill.md](./restore-drill.md).
- **You cannot tell whether data is being written.** An API that is up but writing nothing looks
  exactly like an API that is up and working. If in doubt, escalate; do not restart repeatedly hoping
  it helps, because a restart mid-write is how a recoverable outage becomes a reconciliation drift.
- **Money is involved.** Any 5xx on a capture, release or payout path goes straight to whoever owns
  finance, even if the cause looks infrastructural. The cause is diagnosable later; the window in
  which a customer's money is in an unknown state is not recoverable later.
- **It has been more than 15 minutes.** Past that, the outage is more expensive than the risk of a
  wrong call.

Escalating early is not a failure of diligence here. The failure mode this runbook is written against
is a responder who stayed alone with it for an hour.
