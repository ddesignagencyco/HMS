// apps/api/src/admin/ops-board.service.ts
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { QueueRegistry } from '../queues/queue.registry.js';
import { RedisService } from '../database/redis.module.js';

export type OpsBoard = {
  generatedAt: string;
  bookingsToday: { total: number; byStatus: Record<string, number> };
  queueDepth: { outbox: number; notifications: number; payments: number; verification: number; projections: number };
  slaBreaches: { verifications: number; complaints: number };
  openDisputes: { total: number; awaitingReply: number };
  escrow: { heldPaisa: string; bookingsHolding: number };
  debtBlockedProviders: number;
  /** Anything that is wrong right now and a person should look at, worst first. */
  alerts: { severity: 'CRITICAL' | 'WARNING' | 'INFO'; code: string; detail: string; count: number }[];
};

/**
 * FR-AD-12: what an operator sees on one screen when they come in. Every figure is a real query
 * against the table it describes — nothing is kept up to date incrementally, because an ops board
 * that silently drifts from the thing it is reporting is worse than no ops board: the whole value
 * is "can I trust this".
 *
 * The board is expensive relative to an ordinary read (about a dozen aggregate queries), so it is
 * computed **once every `OPS_BOARD_INTERVAL_MS`** by a scheduled job, cached in Redis, and pushed to
 * subscribers. That is what makes "updates within 5 s of the underlying change" true without every
 * open browser tab running a dozen queries every five seconds.
 */
const OPS_BOARD_INTERVAL_MS = 5_000;
const CACHE_KEY = 'ops-board';

@Injectable()
export class OpsBoardService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OpsBoardService.name);
  private readonly subscribers = new Set<(board: OpsBoard) => void>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(QueueRegistry) private readonly queues: QueueRegistry
  ) {}

  onModuleInit(): void {
    // Refreshed on an in-process interval, deliberately not a REPEATABLE_JOBS tick. Five seconds is
    // a display cadence, and the push to subscribers has to happen in the process holding them —
    // the API. A queue tick would run in the worker, which has no subscribers, so the board would
    // be recomputed there and never pushed. (This used to also register an `ops-board.refresh`
    // scheduled task, which nothing ever scheduled; the interval is the only mechanism that works.)
    this.timer = setInterval(() => {
      void this.refresh().catch(error => this.logger.error(`ops board refresh failed: ${(error as Error).message}`));
    }, OPS_BOARD_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.subscribers.clear();
  }

  /** The cached board, computed on first use so a cold API still answers the REST call. */
  async current(): Promise<OpsBoard> {
    const cached = await this.redis.client.get(CACHE_KEY);
    if (cached !== null) return JSON.parse(cached) as OpsBoard;
    return this.refresh();
  }

  /** Recomputes, caches and pushes. Returns the fresh board. */
  async refresh(): Promise<OpsBoard> {
    const board = await this.compute();
    await this.redis.client.set(CACHE_KEY, JSON.stringify(board), 'EX', OPS_BOARD_INTERVAL_MS * 3);
    for (const subscriber of this.subscribers) subscriber(board);
    return board;
  }

  subscribe(listener: (board: OpsBoard) => void): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  private async compute(): Promise<OpsBoard> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const statuses = await this.prisma.$queryRaw<{ status: string; n: number }[]>(
      Prisma.sql`SELECT status::text as status, count(*)::int as n FROM bookings WHERE created_at >= ${todayStart.toISOString()}::timestamptz GROUP BY 1`
    );
    const total = statuses.reduce((sum, row) => sum + row.n, 0);

    const verifications = await this.prisma.$queryRaw<{ n: number }[]>(
      Prisma.sql`SELECT count(*)::int as n FROM verification_calls WHERE submitted_at IS NULL AND sla_due_at <= now() AND status IN ('QUEUED','LOCKED')`
    );
    const complaints = await this.prisma.$queryRaw<{ n: number }[]>(
      Prisma.sql`SELECT count(*)::int as n FROM complaints WHERE status NOT IN ('RESOLVED','REJECTED') AND sla_due_at <= now()`
    );
    const disputes = await this.prisma.$queryRaw<{ total: number; awaiting: number }[]>(
      Prisma.sql`SELECT count(*)::int as total, count(*) FILTER (WHERE status = 'OPEN')::int as awaiting FROM disputes WHERE status <> 'RESOLVED'`
    );
    const escrow = await this.prisma.$queryRaw<{ held: bigint; bookings: number }[]>(
      Prisma.sql`SELECT coalesce(sum(b.balance), 0)::bigint as held, count(*)::int as bookings
        FROM ledger_accounts a JOIN account_balances b ON b.account_id = a.id WHERE a.type = 'ESCROW' AND b.balance > 0`
    );
    const debtBlocked = await this.prisma.$queryRaw<{ n: number }[]>(
      Prisma.sql`SELECT count(*)::int as n FROM providers WHERE offer_blocked_reason = 'DEBT'`
    );

    const depth: OpsBoard['queueDepth'] = { outbox: 0, notifications: 0, payments: 0, verification: 0, projections: 0 };
    for (const name of ['outbox', 'notifications', 'payments', 'verification', 'projections'] as const) {
      depth[name] = await this.queues.queue(name).getWaitingCount();
    }

    const alerts: OpsBoard['alerts'] = [];
    // Worst first, so an operator reads the top of the list and knows where to start.
    if ((complaints[0]?.n ?? 0) > 0) {
      alerts.push({ severity: 'CRITICAL', code: 'complaint_sla_breached', detail: 'complaints past their first-response SLA', count: complaints[0]!.n });
    }
    if ((verifications[0]?.n ?? 0) > 0) {
      alerts.push({ severity: 'CRITICAL', code: 'verification_sla_breached', detail: 'verification calls past their SLA with nobody assigned', count: verifications[0]!.n });
    }
    if ((disputes[0]?.awaiting ?? 0) > 0) {
      alerts.push({ severity: 'WARNING', code: 'dispute_awaiting_provider', detail: 'disputes still inside the provider reply window', count: disputes[0]!.awaiting });
    }
    if ((debtBlocked[0]?.n ?? 0) > 0) {
      alerts.push({ severity: 'WARNING', code: 'debt_blocked_providers', detail: 'providers blocked for exceeding their commission debt ceiling', count: debtBlocked[0]!.n });
    }
    if (depth.outbox > 100) {
      alerts.push({ severity: 'WARNING', code: 'outbox_backlog', detail: 'outbox events waiting to be dispatched', count: depth.outbox });
    }

    return {
      generatedAt: new Date().toISOString(),
      bookingsToday: { total, byStatus: Object.fromEntries(statuses.map(row => [row.status, row.n])) },
      queueDepth: depth,
      slaBreaches: { verifications: verifications[0]?.n ?? 0, complaints: complaints[0]?.n ?? 0 },
      openDisputes: { total: disputes[0]?.total ?? 0, awaitingReply: disputes[0]?.awaiting ?? 0 },
      escrow: { heldPaisa: (escrow[0]?.held ?? 0n).toString(), bookingsHolding: escrow[0]?.bookings ?? 0 },
      debtBlockedProviders: debtBlocked[0]?.n ?? 0,
      alerts
    };
  }
}