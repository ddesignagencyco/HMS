# Runbook: background queue backlog

**Alerts that use this:** `OutboxBacklogGrowing`, `QueueBacklogLarge`, `NoWorkersActive`, `JobFailureRateHigh`

Background work is how this platform does the things customers actually notice: sending
notifications, taking payments, releasing money to providers. A growing backlog is therefore more
serious than it looks — every minute it grows, bookings are completing without anyone being told.

## 1. Read the shape before touching anything

```bash
curl -s http://localhost:3000/metrics | grep -E '^shm_queue_(depth|active|delayed)|^shm_outbox'
```

| Depth | Active | Reading |
|---|---|---|
| high | > 0 | Genuinely slow. Work is being done, just too slowly. Go to §3. |
| high | 0 | **The workers are not running.** Go to §2. This is the important one. |
| low | 0 | Nothing to do. Either healthy and idle, or the workers are gone *and* the queue is empty. Check §2 anyway. |

`shm_outbox_oldest_seconds` is the single most useful number here: it is the age of the oldest
event nobody has processed, and it keeps growing through everything else.

## 2. Workers are not running

```bash
docker compose ps worker
docker compose logs --tail 200 worker
```

Common causes, in the order they actually happen:

- **The worker is running the old build** against a new database schema. A missing column shows up as
  a Prisma error at the first query and the worker exits. Redeploy the worker before debugging
  further — this is the usual cause after a migration.
- **Redis is unreachable** — BullMQ cannot reach Redis, so there is nowhere to claim jobs from. See
  [api-down.md §3](./api-down.md).
- **A poison message** has exhausted its retries and the worker gave up. The failed job is in the
  dead-letter set; see §4.

## 3. Workers are running and it is genuinely slow

The usual cause is **one slow job type blocking the queue**, not general slowness.

```bash
curl -s http://localhost:3000/metrics | grep shm_jobs_total
```

Per *job name*:

- One name dominating the failure or duration count → that job is the problem.
- Everything uniformly slow → the database is the bottleneck. `NoWorkersActive` would not have fired,
  so this is throughput, not a stall.

If it is one job type, the safe move is to **drain that queue** rather than scale more workers onto
it. Taking more workers on a queue whose jobs are individually slow makes every job slower:

```bash
# Pause producers of that queue first, or new work arrives faster than it drains.
docker compose logs --tail 50 worker | grep <job-name>
```

## 4. Poison messages

A job that fails deterministically (a malformed webhook, a report referencing a deleted booking) will
retry until it exhausts its attempts and then block the queue behind it if it was ordered first.

Find it:

```bash
# BullMQ keeps its state in Redis, not in Postgres -- there is no `bullmq_failed` table to query.
docker exec smart-home-redis redis-cli ZCARD 'bull:outbox:failed'
docker exec smart-home-redis redis-cli ZRANGE 'bull:outbox:failed' 0 4
```

**Inspect before deleting.** A failed job is evidence: it usually points at a bug worth a ticket.
The usual resolution is to fix the cause and let the job through, not to clear the queue and hope.

## 5. Recovering

Once the workers are healthy the backlog drains on its own — no action needed, and *forcing* a flush
while the underlying cause is still present just makes it recur.

Watch it drain:

```bash
watch -n 5 'curl -s http://localhost:3000/metrics | grep -E "^shm_queue_depth|^shm_outbox_oldest"'
```

Close the incident when `shm_outbox_oldest_seconds` is back near zero **and** falling. If depth is
falling but the oldest-event age is not, you are draining recent work while the old item is stuck —
which usually means one job is failing repeatedly while everything else looks healthy.

## When to escalate

Escalate rather than continuing to debug when:

- **Money is moving through the queue.** Payout disbursement and payment release are background work
  here, so a stalled queue is not a queue of notifications — it is a queue of money that has been
  earned and not paid. Get finance involved immediately rather than after you have understood it.
- **The backlog is growing and you do not know why.** A backlog you cannot explain is worse than a
  large one you can: you cannot tell whether it will drain, and an unbounded queue eventually takes
  the database down with it.
- **Restoring or requeueing is the only option left.** Clearing a queue by hand is destructive and
  should not be a responder's unilateral decision — some jobs may be the only record of a money
  movement. Get a second person.
- **It has been more than 30 minutes.** By then the affected parties are customers and providers who
  have been told nothing, and the communications problem starts compounding the technical one.

> **Do not clear the failed queue to make the dashboard look better.** A failed job is evidence, and
> deleting it destroys the only record of what a job was trying to do. Fix the cause and let the job
> through.
