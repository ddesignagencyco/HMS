// apps/api/src/verification/verification-sweeps.service.ts
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { addBusinessMinutes } from '@smart-home/domain';
import { applySystemEvent } from '../booking/booking-state.js';
import { PrismaService } from '../database/prisma.service.js';
import { BookingStateService } from '../booking/booking-state.service.js';
import { AppClock } from '../platform/app-clock.js';
import { QueueRegistry } from '../queues/queue.registry.js';
import { SettingsService } from '../platform/settings.service.js';
import { VerificationOutcomeService } from './verification-outcome.service.js';
import { VerificationQueueService } from './verification-queue.service.js';

/**
 * The scheduled halves of verification (worker jobs): flag SLA breaches, return abandoned claims, escalate silent Tier B
 * jobs, release what nobody could verify in 72 hours, and end rework windows nobody used. Each is safe to run twice or on
 * two workers at once — every one re-checks the row inside its own transaction and a lost race simply does nothing.
 */
@Injectable()
export class VerificationSweepsService implements OnModuleInit {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(AppClock) private readonly clock: AppClock,
    @Inject(QueueRegistry) private readonly queues: QueueRegistry,
    @Inject(VerificationQueueService) private readonly queue: VerificationQueueService,
    @Inject(VerificationOutcomeService) private readonly outcomes: VerificationOutcomeService,
    @Inject(BookingStateService) private readonly bookingState: BookingStateService
  ) {}

  onModuleInit(): void {
    this.queues.registerScheduled('verification.sla-monitor', async () => void (await this.queue.flagSlaBreaches()));
    this.queues.registerScheduled('verification.lock-sweeper', async () => void (await this.queue.sweepExpiredLocks()));
    this.queues.registerScheduled('verification.auto-release', async () => void (await this.autoRelease()));
    this.queues.registerScheduled('verification.b-escalation', async () => void (await this.escalateTierB()));
    this.queues.registerScheduled('booking.close-elapsed', async () => void (await this.closeElapsed()));
    this.queues.registerScheduled('booking.rework-expiry', async () => void (await this.expireRework()));
  }

  /**
   * FR-VC-12: a Tier B job whose customer never answered the link within `verification.b_escalation_hours` becomes a Tier A
   * call. Its SLA starts now, in business minutes, and the reason is added to the record.
   */
  async escalateTierB(): Promise<number> {
    const now = this.clock.now();
    const due = await this.prisma.$queryRaw<{ id: string; priority: number; paymentMode: string }[]>(
      Prisma.sql`SELECT v.id, v.priority, b.payment_mode::text as "paymentMode" FROM verification_calls v JOIN bookings b ON b.id = v.booking_id
        WHERE v.tier = 'B' AND v.status = 'QUEUED' AND v.submitted_at IS NULL AND v.sla_due_at <= ${now.toISOString()}::timestamptz`
    );
    let escalated = 0;
    for (const call of due) {
      const minutes = await this.settings.getNumber(call.paymentMode === 'CASH' ? 'verification.cash_sla_min' : 'verification.sla_min');
      const dueAt = addBusinessMinutes(now, minutes);
      const changed = await this.prisma.$executeRaw(
        Prisma.sql`UPDATE verification_calls SET tier = 'A'::verification_tier, routing_reasons = array_append(routing_reasons, 'B_NO_RESPONSE'), next_attempt_at = ${now.toISOString()}::timestamptz,
            sla_due_at = ${dueAt.toISOString()}::timestamptz WHERE id = ${call.id}::uuid AND tier = 'B' AND status = 'QUEUED' AND submitted_at IS NULL`
      );
      if (changed > 0) {
        escalated += 1;
        await this.prisma.$executeRaw(Prisma.sql`UPDATE bookings SET verification_tier = 'A'::verification_tier WHERE id = (SELECT booking_id FROM verification_calls WHERE id = ${call.id}::uuid)`);
      }
    }
    return escalated;
  }

  /**
   * FR-VC-07 / CL-09: 72 hours (`verification.auto_release_hours`) after completion with no verification, the job is released so a
   * provider is not held up forever by an unreachable customer. No rating is published — nobody actually confirmed anything — and the
   * customer keeps a complaint window. Cash is authorised to collect, as for any other release.
   */
  async autoRelease(): Promise<number> {
    const hours = await this.settings.getNumber('verification.auto_release_hours');
    const cutoff = new Date(this.clock.now().getTime() - hours * 3_600_000);
    const due = await this.prisma.$queryRaw<{ verificationId: string; bookingId: string }[]>(
      Prisma.sql`SELECT v.id as "verificationId", b.id as "bookingId" FROM verification_calls v JOIN bookings b ON b.id = v.booking_id
        WHERE b.status = 'AWAITING_VERIFICATION' AND v.submitted_at IS NULL AND b.completed_at <= ${cutoff.toISOString()}::timestamptz AND v.status IN ('QUEUED','LOCKED')`
    );
    let released = 0;
    const refundIds: string[] = [];
    for (const call of due) {
      const done = await this.prisma.$transaction(async tx => {
        const locked = await tx.$queryRaw<{ id: string }[]>(
          Prisma.sql`SELECT id FROM verification_calls WHERE id = ${call.verificationId}::uuid AND submitted_at IS NULL FOR UPDATE SKIP LOCKED`
        );
        if (locked[0] === undefined) return null;
        const booking = await VerificationOutcomeService.loadBooking(tx, call.bookingId);
        const statuses = await tx.$queryRaw<{ status: string }[]>(Prisma.sql`SELECT status::text FROM bookings WHERE id = ${call.bookingId}::uuid`);
        if (statuses[0]?.status !== 'AWAITING_VERIFICATION') return null;
        await tx.$executeRaw(
          Prisma.sql`UPDATE verification_calls SET status = 'SUBMITTED'::verification_status, outcome = 'AUTO_RELEASED'::verification_outcome, submitted_at = now(), locked_by = NULL, locked_at = NULL WHERE id = ${call.verificationId}::uuid`
        );
        return this.outcomes.permitRelease(tx, { booking, verificationId: call.verificationId, event: 'autoRelease', actor: { userId: null, role: 'SYSTEM' } });
      });
      if (done !== null) {
        released += 1;
        refundIds.push(...done.refundIds);
      }
    }
    await this.bookingState.settleRefunds(refundIds);
    return released;
  }

  /** T22: the provider had `rework.window_hours` to come back and did not; that counts as a failed rework, so the case goes to the disputes queue. */
  async expireRework(): Promise<number> {
    const hours = await this.settings.getNumber('rework.window_hours');
    const cutoff = new Date(this.clock.now().getTime() - hours * 3_600_000);
    const due = await this.prisma.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT b.id FROM bookings b WHERE b.status = 'REWORK_REQUIRED'
        AND (SELECT h.created_at FROM booking_status_history h WHERE h.booking_id = b.id AND h.to_status = 'REWORK_REQUIRED' ORDER BY h.id DESC LIMIT 1) <= ${cutoff.toISOString()}::timestamptz`
    );
    let expired = 0;
    for (const { id } of due) {
      const done = await this.prisma.$transaction(async tx => {
        const booking = await VerificationOutcomeService.loadBooking(tx, id);
        const statuses = await tx.$queryRaw<{ status: string }[]>(Prisma.sql`SELECT status::text FROM bookings WHERE id = ${id}::uuid`);
        if (statuses[0]?.status !== 'REWORK_REQUIRED') return false;
        await this.outcomes.openDispute(tx, { booking, origin: 'REWORK_EXPIRED', event: 'reworkWindowExpired', actor: { userId: null, role: 'SYSTEM' } });
        return true;
      });
      if (done) expired += 1;
    }
    return expired;
  }

  /**
   * T26: a released job closes once both its warranty and the customer's post-release complaint window
   * (`verification.post_release_complaint_days`) have run out, and a refunded one closes at once. Closed is final.
   */
  async closeElapsed(): Promise<number> {
    const complaintDays = await this.settings.getNumber('verification.post_release_complaint_days');
    const now = this.clock.now();
    const due = await this.prisma.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT id FROM bookings WHERE status IN ('REFUNDED','PARTIALLY_REFUNDED')
          OR (status = 'PAYMENT_RELEASED' AND greatest(coalesce(warranty_until, released_at), released_at + make_interval(days => ${complaintDays}::int)) <= ${now.toISOString()}::timestamptz)`
    );
    let closed = 0;
    for (const { id } of due) {
      const moved = await this.prisma.$transaction(tx => applySystemEvent(tx, id, 'close', { reason: 'warranty and complaint window elapsed' }));
      if (moved !== null) closed += 1;
    }
    return closed;
  }
}
