// apps/api/src/platform/metrics.service.ts
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { QueueRegistry } from '../queues/queue.registry.js';

export const QUEUES = ['outbox', 'notifications', 'payments', 'verification', 'projections'] as const;

/**
 * NFR-OBS / SHM-092: the numbers a pager is built from.
 *
 * Three questions an operator actually asks of a running system — how fast is it answering, what is
 * the background work doing, and is anything stuck — and one metric for each.
 *
 * Queue depths and the outbox gauges are recomputed **on scrape**, not pushed by the workers. A
 * counter would drift the moment a worker died, and a worker dying is exactly when the number
 * matters. Reading the truth on demand means the metric cannot report a healthy backlog after the
 * thing that drains it has stopped.
 *
 * `prom-client`'s default metrics (process, event loop, GC) are on: they are free, and "the box was
 * out of memory" is otherwise invisible until it turns into a post-mortem.
 */
@Injectable()
export class MetricsService implements OnModuleInit, OnModuleDestroy {
  readonly registry = new Registry();

  readonly httpRequests = new Counter({
    name: 'shm_http_requests_total',
    help: 'HTTP requests served, by method, route and status',
    labelNames: ['method', 'route', 'status'],
    registers: [this.registry]
  });

  readonly httpDuration = new Histogram({
    name: 'shm_http_request_duration_seconds',
    help: 'HTTP request duration in seconds, by method and route',
    // Buckets chosen for a consumer API whose stated budget is 800 ms (FR-SR-07): 0.75 and 1 are the
    // buckets an alert would fire on, so they are not rounded away into each other.
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5],
    labelNames: ['method', 'route'],
    registers: [this.registry]
  });

  readonly jobsRun = new Counter({
    name: 'shm_jobs_total',
    help: 'Background jobs executed, by name and outcome',
    labelNames: ['name', 'outcome'],
    registers: [this.registry]
  });

  readonly reconciliationDrift = new Counter({
    name: 'shm_reconciliation_drift_total',
    help: 'Ledger drift found by the nightly reconciliation, by check',
    labelNames: ['check'],
    registers: [this.registry]
  });

  private readonly queueDepth = new Gauge({
    name: 'shm_queue_depth',
    help: 'Jobs waiting in a background queue',
    labelNames: ['queue'],
    registers: [this.registry]
  });

  private readonly queueActive = new Gauge({
    name: 'shm_queue_active',
    help: 'Jobs currently being processed',
    labelNames: ['queue'],
    registers: [this.registry]
  });

  private readonly queueDelayed = new Gauge({
    name: 'shm_queue_delayed',
    help: 'Jobs waiting for their retry time',
    labelNames: ['queue'],
    registers: [this.registry]
  });

  private readonly undispatched = new Gauge({
    name: 'shm_outbox_undispatched',
    help: 'Outbox events written but never dispatched',
    registers: [this.registry]
  });

  private readonly oldestUndispatched = new Gauge({
    name: 'shm_outbox_oldest_seconds',
    help: 'Age in seconds of the oldest undispatched outbox event',
    registers: [this.registry]
  });

  private readonly escrowHeld = new Gauge({
    name: 'shm_escrow_held_paisa',
    help: 'Money currently held in escrow, in paisa',
    registers: [this.registry]
  });

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(QueueRegistry) private readonly queues: QueueRegistry
  ) {}

  onModuleInit(): void {
    collectDefaultMetrics({ register: this.registry });
  }

  onModuleDestroy(): void {
    this.registry.clear();
  }

  /**
   * The route label must be the *matched* route, never the raw URL. `/bookings/{id}` and
   * `/bookings/9f3a…` are one series; as raw paths they would be one series per booking, which is
   * unbounded cardinality and a metric store that dies of its own success.
   */
  recordRequest(method: string, route: string, status: number, seconds: number): void {
    this.httpRequests.inc({ method, route, status: String(status) });
    this.httpDuration.observe({ method, route }, seconds);
  }

  async refreshGauges(): Promise<void> {
    for (const name of QUEUES) {
      const queue = this.queues.queue(name);
      const [waiting, active, delayed] = await Promise.all([queue.getWaitingCount(), queue.getActiveCount(), queue.getDelayedCount()]);
      this.queueDepth.set({ queue: name }, waiting);
      this.queueActive.set({ queue: name }, active);
      this.queueDelayed.set({ queue: name }, delayed);
    }

    // The number that says the platform has stopped working: events written to the outbox that
    // nothing has picked up. Derived rather than counted, so a stopped dispatcher shows up as a
    // growing age instead of a frozen gauge.
    const stale = await this.prisma.$queryRaw<{ n: number; age: number | null }[]>(Prisma.sql`
      SELECT count(*)::int as n, extract(epoch FROM (now() - max(created_at)))::float8 as age FROM outbox_events WHERE processed_at IS NULL`);
    this.undispatched.set(stale[0]?.n ?? 0);
    this.oldestUndispatched.set(Math.max(0, stale[0]?.age ?? 0));

    const escrow = await this.prisma.$queryRaw<{ held: bigint }[]>(Prisma.sql`
      SELECT coalesce(sum(b.balance), 0)::bigint as held FROM ledger_accounts a JOIN account_balances b ON b.account_id = a.id WHERE a.type = 'ESCROW' AND b.balance > 0`);
    // Paisa, as a number. It is a gauge, not money in flight, and Prometheus holds doubles; the
    // authoritative figure is always the ledger, and this is a rough shape for an alert.
    this.escrowHeld.set(Number(escrow[0]?.held ?? 0n));
  }

  async metrics(): Promise<string> {
    await this.refreshGauges();
    return this.registry.metrics();
  }
}