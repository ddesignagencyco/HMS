// apps/api/src/verification/verification-queue.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { businessMinutesBetween, isWithinBusinessHours } from '@smart-home/domain';
import { DomainError, notFound } from '../common/domain-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { appendOutboxEvent } from '../platform/audit.service.js';
import { AppClock } from '../platform/app-clock.js';
import { SettingsService } from '../platform/settings.service.js';

export type QueueItem = {
  id: string;
  bookingId: string;
  bookingCode: string;
  serviceName: string;
  paymentMode: string;
  visitNo: number;
  tier: string;
  routingReasons: string[];
  priority: number;
  status: string;
  slaDueAt: Date;
  /** Business minutes left before the SLA is breached; negative once it has been. */
  slaRemainingMinutes: number;
  slaBreached: boolean;
  nextAttemptAt: Date;
  lockedByMe: boolean;
  lockedAt: Date | null;
  attempts: number;
};

type QueueRow = Omit<QueueItem, 'slaRemainingMinutes' | 'slaBreached' | 'lockedByMe' | 'attempts'> & { lockedBy: string | null; attempts: bigint };

const QUEUE_COLUMNS = Prisma.sql`v.id, v.booking_id as "bookingId", b.code as "bookingCode", s.name_en as "serviceName", b.payment_mode as "paymentMode", v.visit_no as "visitNo",
  v.tier::text as tier, v.routing_reasons as "routingReasons", v.priority, v.status::text as status, v.sla_due_at as "slaDueAt", v.next_attempt_at as "nextAttemptAt",
  v.locked_by as "lockedBy", v.locked_at as "lockedAt", (SELECT count(*) FROM verification_call_attempts a WHERE a.verification_call_id = v.id) as attempts`;

/**
 * FR-VC-02 / FR-VC-10 / FR-VC-13..15 / CL-19 / CL-20: the agents' work queue. Cash first (15-minute SLA), then oldest
 * SLA deadline; SLA time counts only inside calling hours. An item is claimed with `FOR UPDATE SKIP LOCKED`, so two
 * agents reaching for the same call can never both get it, and a claim expires (`verification.lock_timeout_min`) so a
 * call abandoned by an agent who walked away returns to the queue by itself.
 */
@Injectable()
export class VerificationQueueService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(AppClock) private readonly clock: AppClock
  ) {}

  private present(row: QueueRow, agentId: string): QueueItem {
    const now = this.clock.now();
    const breached = row.slaDueAt.getTime() < now.getTime();
    const { lockedBy, attempts, ...rest } = row;
    return {
      ...rest,
      attempts: Number(attempts),
      lockedByMe: lockedBy === agentId,
      slaBreached: breached,
      slaRemainingMinutes: breached ? -businessMinutesBetween(row.slaDueAt, now) : businessMinutesBetween(now, row.slaDueAt)
    };
  }

  /** Waiting Tier A calls in the order they should be worked, plus whatever this agent already holds. Items locked by other agents are visible but marked. */
  async list(agentId: string): Promise<QueueItem[]> {
    const rows = await this.prisma.$queryRaw<QueueRow[]>(
      Prisma.sql`SELECT ${QUEUE_COLUMNS} FROM verification_calls v JOIN bookings b ON b.id = v.booking_id JOIN services s ON s.id = b.service_id
        WHERE v.tier = 'A' AND v.status IN ('QUEUED','LOCKED') AND b.status = 'AWAITING_VERIFICATION'
        ORDER BY (v.locked_by = ${agentId}::uuid) DESC NULLS LAST, v.priority, v.sla_due_at, v.created_at LIMIT 200`
    );
    return rows.map(row => this.present(row, agentId));
  }

  /**
   * Takes one call. Without `verificationId` it takes the best available one; with it, that specific call (the agent picked it
   * from the list) — and if another agent got there first the answer is 409, never a shared lock. An agent works one call at
   * a time: claiming while already holding one returns the held one.
   */
  async claim(agentId: string, verificationId?: string): Promise<QueueItem | null> {
    if (!isWithinBusinessHours(this.clock.now())) {
      throw new DomainError('OUTSIDE_CALLING_HOURS', 'Verification calls are only made between 08:00 and 22:00 Pakistan time');
    }
    const held = await this.prisma.$queryRaw<QueueRow[]>(
      Prisma.sql`SELECT ${QUEUE_COLUMNS} FROM verification_calls v JOIN bookings b ON b.id = v.booking_id JOIN services s ON s.id = b.service_id WHERE v.locked_by = ${agentId}::uuid AND v.status = 'LOCKED' ORDER BY v.locked_at LIMIT 1`
    );
    if (held[0] !== undefined) return this.present(held[0], agentId);

    const claimedId = await this.prisma.$transaction(async tx => {
      const candidates = await tx.$queryRaw<{ id: string; bookingId: string }[]>(
        verificationId === undefined
          ? Prisma.sql`SELECT v.id, v.booking_id as "bookingId" FROM verification_calls v JOIN bookings b ON b.id = v.booking_id
              WHERE b.status = 'AWAITING_VERIFICATION' AND v.tier = 'A' AND v.status = 'QUEUED' AND v.next_attempt_at <= ${this.clock.now().toISOString()}::timestamptz
              ORDER BY v.priority, v.sla_due_at, v.created_at FOR UPDATE OF v SKIP LOCKED LIMIT 20`
          : Prisma.sql`SELECT v.id, v.booking_id as "bookingId" FROM verification_calls v JOIN bookings b ON b.id = v.booking_id WHERE b.status = 'AWAITING_VERIFICATION' AND v.id = ${verificationId}::uuid AND v.tier = 'A' AND v.status = 'QUEUED' AND v.next_attempt_at <= ${this.clock.now().toISOString()}::timestamptz FOR UPDATE OF v SKIP LOCKED`
      );
      if (candidates.length === 0) {
        if (verificationId === undefined) return null;
        const exists = await tx.$queryRaw<{ status: string }[]>(Prisma.sql`SELECT status::text FROM verification_calls WHERE id = ${verificationId}::uuid`);
        if (exists[0] === undefined) throw notFound('Verification');
        throw new DomainError('CONFLICT', 'That call is already claimed, not due for another attempt yet, or no longer waiting');
      }
      let sawConflict = false;
      for (const candidate of candidates) {
        if (await this.hasConflictOfInterest(tx, agentId, candidate.bookingId)) {
          sawConflict = true;
          continue;
        }
        await tx.$executeRaw(
          Prisma.sql`UPDATE verification_calls SET status = 'LOCKED'::verification_status, locked_by = ${agentId}::uuid, locked_at = ${this.clock.now().toISOString()}::timestamptz WHERE id = ${candidate.id}::uuid`
        );
        return candidate.id;
      }
      if (sawConflict) throw new DomainError('CONFLICT_OF_INTEREST', 'You are linked to every waiting call, so none can be assigned to you');
      return null;
    });
    if (claimedId === null) return null;
    const rows = await this.prisma.$queryRaw<QueueRow[]>(
      Prisma.sql`SELECT ${QUEUE_COLUMNS} FROM verification_calls v JOIN bookings b ON b.id = v.booking_id JOIN services s ON s.id = b.service_id WHERE v.id = ${claimedId}::uuid`
    );
    return this.present(rows[0] as QueueRow, agentId);
  }

  /**
   * FR-VC-10 / BR-27: an agent must be independent of the job. They are linked to it if they *are* the customer or the
   * provider, share a phone number or email with either, or have a declared conflict (`staff_conflicts`) with either.
   * (A CNIC match is not checked: agents do not register one, only providers do.)
   */
  async hasConflictOfInterest(tx: Prisma.TransactionClient | PrismaService, agentId: string, bookingId: string): Promise<boolean> {
    const rows = await tx.$queryRaw<{ linked: boolean }[]>(
      Prisma.sql`SELECT EXISTS (
          SELECT 1 FROM bookings b
            JOIN users party ON party.id IN (b.customer_id, b.provider_id)
            JOIN users agent ON agent.id = ${agentId}::uuid
          WHERE b.id = ${bookingId}::uuid
            AND (party.id = agent.id OR (party.phone_e164 IS NOT NULL AND party.phone_e164 = agent.phone_e164) OR (party.email IS NOT NULL AND party.email = agent.email)
                 OR EXISTS (SELECT 1 FROM staff_conflicts c WHERE (c.staff_user_id = agent.id AND c.other_user_id = party.id) OR (c.staff_user_id = party.id AND c.other_user_id = agent.id)))
        ) as linked`
    );
    return rows[0]?.linked === true;
  }

  /** Puts a call the agent holds back in the queue. Only the holder can do it; anyone else gets a 404, as if it were not theirs to see. */
  async releaseLock(agentId: string, verificationId: string): Promise<{ released: true }> {
    const updated = await this.prisma.$executeRaw(
      Prisma.sql`UPDATE verification_calls SET status = 'QUEUED'::verification_status, locked_by = NULL, locked_at = NULL
        WHERE id = ${verificationId}::uuid AND locked_by = ${agentId}::uuid AND status = 'LOCKED'`
    );
    if (updated === 0) throw notFound('Verification lock');
    return { released: true };
  }

  /** BR-26: a claim older than `verification.lock_timeout_min` is stale. Returns how many went back to the queue. */
  async sweepExpiredLocks(): Promise<number> {
    const minutes = await this.settings.getNumber('verification.lock_timeout_min');
    const cutoff = new Date(this.clock.now().getTime() - minutes * 60_000);
    return this.prisma.$executeRaw(
      Prisma.sql`UPDATE verification_calls SET status = 'QUEUED'::verification_status, locked_by = NULL, locked_at = NULL WHERE status = 'LOCKED' AND locked_at <= ${cutoff.toISOString()}::timestamptz`
    );
  }

  /** FR-VC-02 / FR-NT-04: stamps the moment an SLA was first missed, so the admin board can show breaches even after they are worked, and alerts the admins once per call. Returns how many were newly flagged. */
  async flagSlaBreaches(): Promise<number> {
    const now = this.clock.now().toISOString();
    const flagged = await this.prisma.$queryRaw<{ id: string; bookingId: string }[]>(
      Prisma.sql`UPDATE verification_calls SET sla_breached_at = ${now}::timestamptz WHERE status IN ('QUEUED','LOCKED') AND sla_breached_at IS NULL AND sla_due_at < ${now}::timestamptz RETURNING id, booking_id as "bookingId"`
    );
    for (const row of flagged) {
      await this.prisma.$transaction(tx => appendOutboxEvent(tx, { aggregate: 'verification', aggregateId: row.id, type: 'verification.sla_breached', payload: { verificationId: row.id, bookingId: row.bookingId } }));
    }
    return flagged.length;
  }
}
