// apps/api/src/conduct/conduct-jobs.service.ts
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { AppClock } from '../platform/app-clock.js';
import { AuditService } from '../platform/audit.service.js';
import { SettingsService } from '../platform/settings.service.js';
import { QueueRegistry } from '../queues/queue.registry.js';
import { ReputationService } from '../reputation/reputation.service.js';
import { ConductService } from './conduct.service.js';

export type DailyConductResult = { expired: number; decayed: number; lifted: number; flagsRefreshed: number };

/**
 * FR-PN-02 / CL-15: the daily housekeeping of the conduct record. Points expire in full 180 days after they were awarded; independently,
 * every 30 clean days (no new breach) one point comes off the oldest active award; suspensions that have run their course end; and the
 * low-rating flags are brought up to date. Everything is computed from the application clock and the record's own dates, so running it late
 * catches up exactly, and running it twice changes nothing.
 */
@Injectable()
export class ConductJobsService implements OnModuleInit {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(AppClock) private readonly clock: AppClock,
    @Inject(ConductService) private readonly conduct: ConductService,
    @Inject(ReputationService) private readonly reputation: ReputationService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(QueueRegistry) private readonly queues: QueueRegistry
  ) {}

  onModuleInit(): void {
    this.queues.registerScheduled('conduct.daily', async () => void (await this.runDaily()));
  }

  async runDaily(): Promise<DailyConductResult> {
    const expired = await this.expireAwards();
    const decayed = await this.decay();
    const lifted = await this.liftSuspensions();
    const flagsRefreshed = await this.refreshFlags();
    return { expired, decayed, lifted, flagsRefreshed };
  }

  /** An award is spent the moment it reaches its expiry (`expires_at <= now`): 179 days on it still counts, 180 it does not. */
  async expireAwards(): Promise<number> {
    return this.prisma.$executeRaw(
      Prisma.sql`UPDATE demerit_awards SET points_remaining = 0 WHERE voided_at IS NULL AND points_remaining > 0 AND expires_at <= ${this.clock.now().toISOString()}::timestamptz`
    );
  }

  /** One point off the oldest active award per full `demerit.decay_days` since the last breach or the last decay. */
  async decay(): Promise<number> {
    const now = this.clock.now();
    const decayDays = await this.settings.getNumber('demerit.decay_days');
    const providers = await this.prisma.$queryRaw<{ providerId: string }[]>(
      Prisma.sql`SELECT DISTINCT provider_id as "providerId" FROM demerit_awards WHERE voided_at IS NULL AND points_remaining > 0 AND expires_at > ${now.toISOString()}::timestamptz`
    );
    let decayed = 0;
    for (const { providerId } of providers) {
      decayed += await this.prisma.$transaction(async tx => {
        await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`conduct:${providerId}`}))`);
        const marks = await tx.$queryRaw<{ latest: Date | null }[]>(
          Prisma.sql`SELECT greatest(max(awarded_at), max(last_decay_at)) as latest FROM demerit_awards WHERE provider_id = ${providerId}::uuid AND voided_at IS NULL`
        );
        let cursor = marks[0]?.latest ?? null;
        if (cursor === null) return 0;
        let removed = 0;
        while (new Date(cursor.getTime() + decayDays * 86_400_000).getTime() <= now.getTime()) {
          cursor = new Date(cursor.getTime() + decayDays * 86_400_000);
          const oldest = await tx.$queryRaw<{ id: string }[]>(
            Prisma.sql`SELECT id FROM demerit_awards WHERE provider_id = ${providerId}::uuid AND voided_at IS NULL AND points_remaining > 0 AND expires_at > ${cursor.toISOString()}::timestamptz ORDER BY awarded_at, id LIMIT 1 FOR UPDATE`
          );
          if (oldest[0] === undefined) break;
          await tx.$executeRaw(Prisma.sql`UPDATE demerit_awards SET points_remaining = points_remaining - 1, last_decay_at = ${cursor.toISOString()}::timestamptz WHERE id = ${oldest[0].id}::uuid`);
          removed += 1;
        }
        return removed;
      });
    }
    return decayed;
  }

  /** A suspension that has run its course ends; a 30-day suspension that required re-verification returns the provider to approval, not straight to work. */
  async liftSuspensions(): Promise<number> {
    const now = this.clock.now();
    const suspended = await this.prisma.$queryRaw<{ providerId: string }[]>(Prisma.sql`SELECT user_id as "providerId" FROM providers WHERE status = 'SUSPENDED'`);
    let lifted = 0;
    for (const { providerId } of suspended) {
      const done = await this.prisma.$transaction(async tx => {
        const active = await tx.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*)::bigint as n FROM threshold_events WHERE provider_id = ${providerId}::uuid AND consequence LIKE 'SUSPENSION%' AND effective_until > ${now.toISOString()}::timestamptz`);
        if ((active[0]?.n ?? 0n) > 0n) return false;
        const latest = await tx.$queryRaw<{ consequence: string }[]>(Prisma.sql`SELECT consequence FROM threshold_events WHERE provider_id = ${providerId}::uuid AND consequence LIKE 'SUSPENSION%' ORDER BY effective_until DESC NULLS LAST, created_at DESC LIMIT 1`);
        const reverify = latest[0]?.consequence === 'SUSPENSION_30D_REVERIFY';
        await tx.$executeRaw(Prisma.sql`UPDATE providers SET status = ${reverify ? 'PENDING_APPROVAL' : 'APPROVED'}::provider_status WHERE user_id = ${providerId}::uuid AND status = 'SUSPENDED'`);
        await tx.$executeRaw(Prisma.sql`UPDATE providers SET offer_blocked_reason = NULL WHERE user_id = ${providerId}::uuid AND offer_blocked_reason = 'SUSPENDED'`);
        await this.audit.append({ actorUserId: null, actorRole: 'SYSTEM', action: 'provider.suspension.end', entityType: 'provider', entityId: providerId, after: { reverify } }, tx);
        return true;
      });
      if (done) lifted += 1;
    }
    return lifted;
  }

  async refreshFlags(): Promise<number> {
    const providers = await this.prisma.$queryRaw<{ providerId: string }[]>(
      Prisma.sql`SELECT DISTINCT provider_id as "providerId" FROM ratings UNION SELECT provider_id FROM provider_flags WHERE kind = 'LOW_RATING' AND cleared_at IS NULL`
    );
    for (const { providerId } of providers) await this.prisma.$transaction(tx => this.reputation.refreshLowRatingFlag(tx, providerId));
    return providers.length;
  }
}
