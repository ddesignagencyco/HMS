import { Inject, Injectable, Logger, OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EnvironmentService } from '../config/environment.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { QueueRegistry, type QueueName } from '../queues/queue.registry.js';
import { outboxQueueFor } from './audit.service.js';

export type OutboxRow = { id: bigint; type: string; payload: Prisma.JsonValue };

export type OutboxDispatchResult = { claimed: number; enqueued: number };

export const OUTBOX_BATCH_SIZE = 100;

@Injectable()
export class OutboxDispatcher implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxDispatcher.name);
  private timer: NodeJS.Timeout | undefined;
  private polling = false;

  private readonly pollIntervalMs: number;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(QueueRegistry) private readonly queues: QueueRegistry,
    @Inject(EnvironmentService) environment: EnvironmentService
  ) {
    this.pollIntervalMs = environment.values.OUTBOX_POLL_INTERVAL_MS;
  }

  onModuleInit(): void {
    this.start();
  }

  onApplicationShutdown(): void {
    this.stop();
  }

  start(): void {
    if (this.timer !== undefined) return;
    this.timer = setInterval(() => {
      // A failed sweep (database briefly unreachable, shutting down) must not become an unhandled rejection; the next tick retries.
      this.poll().catch((error: unknown) => this.logger.warn(`outbox sweep failed: ${error instanceof Error ? error.message : String(error)}`));
    }, this.pollIntervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer === undefined) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  async poll(limit = OUTBOX_BATCH_SIZE): Promise<OutboxDispatchResult> {
    if (this.polling) return { claimed: 0, enqueued: 0 };
    this.polling = true;
    try {
      return await this.claimAndDispatch(limit);
    } finally {
      this.polling = false;
    }
  }

  private async claimAndDispatch(limit: number): Promise<OutboxDispatchResult> {
    const claimed = await this.prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<OutboxRow[]>(
        Prisma.sql`SELECT id, type, payload FROM outbox_events WHERE processed_at IS NULL ORDER BY id FOR UPDATE SKIP LOCKED LIMIT ${limit}`
      );
      for (const row of rows) {
        await tx.$executeRaw(Prisma.sql`UPDATE outbox_events SET attempts = attempts + 1, last_error = NULL WHERE id = ${row.id}`);
      }
      return rows;
    });
    let enqueued = 0;
    for (const row of claimed) {
      const queue: QueueName = outboxQueueFor(row.type);
      await this.queues.enqueue(queue, 'outbox.dispatch', { outboxId: row.id.toString(), eventType: row.type, payload: row.payload }, `outbox-${row.id.toString()}`);
      await this.prisma.$executeRaw(Prisma.sql`UPDATE outbox_events SET processed_at = now() WHERE id = ${row.id}`);
      enqueued += 1;
    }
    return { claimed: claimed.length, enqueued };
  }
}
