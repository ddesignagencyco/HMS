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
 * two workers at once â€” every one re-checks the row inside its own transaction and a lost race simply does nothing.
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
   * provider is not held up forever by an unreachable customer. No rating is published â€” nobody actually confirmed anything â€” and the
   * customer keeps a complaint window. Cash is authorised to collect, as for any other release.
   *
   * **A job with an unresolved complaint is never auto-released.** An unreachable customer is silent, but a customer who has
   * filed a complaint has spoken â€” and `ComplaintsService.openDispute` exists precisely because a complaint about a job still
   * awaiting verification should freeze the money rather than let it drain through escrow. Nothing required that escalation to
   * happen within the 72 hours, so the sweep used to release the money out from under a live complaint and leave the admin
   * deciding it post-release, when a refund has to be drawn from the provider's wallet instead of escrow. The sweep now leaves
   * those bookings alone: the complaint's own SLA is what should get an admin to it, and the complaint queue already alerts them.
   *
   * **The same applies to a customer who has answered "no" (FR-VC-16).** The in-app form lets a customer say the work was not
   * acceptable, that none of it was done, or that money was demanded beyond the price. That releases nothing and escalates the
   * case to Tier A at priority 0 â€” the exact opposite of the silence this sweep exists for. Releasing the money 72 hours later
   * would settle the job against a customer who told us it was wrong and was waiting for somebody to call them back. The
   * escalation records `CUSTOMER_NOT_ACCEPTED` or `CUSTOMER_INTEGRITY_FLAG` in `routing_reasons`, and this sweep skips those
   * calls outright, exactly as it skips a booking with a live complaint.
   *
   * Not time-boxed, and deliberately: the alternative was to expire the protection after the escalation's own SLA, which is 30
   * business minutes and therefore always lapses long before the 72-hour cutoff it was meant to override â€” a guard that can never
   * fire is not a guard. A customer who rejected the job has said something true about it, and paying the provider anyway on a
   * timer is the one outcome nobody involved asked for. What makes the case findable instead is the escalation itself: Tier A,
   * priority 0, with a fresh SLA that `verification.sla-monitor` flags as breached so it sits overdue in the queue until an agent
   * works it. The same exposure as any Tier A job nobody picks up, which is the existing system's, not this form's.
   */
  async autoRelease(): Promise<number> {
    const hours = await this.settings.getNumber('verification.auto_release_hours');
    const cutoff = new Date(this.clock.now().getTime() - hours * 3_600_000);
    const due = await this.prisma.$queryRaw<{ verificationId: string; bookingId: string }[]>(
      Prisma.sql`SELECT v.id as "verificationId", b.id as "bookingId" FROM verification_calls v JOIN bookings b ON b.id = v.booking_id
WHERE b.status = 'AWAITING_VERIFICATION' AND v.submitted_at IS NULL AND b.completed_at <= ${cutoff.toISOString()}::timestamptz AND v.status IN ('QUEUED','LOCKED')
          AND NOT EXISTS (SELECT 1 FROM complaints c WHERE c.booking_id = b.id AND c.status NOT IN ('RESOLVED','REJECTED'))
          AND NOT (v.routing_reasons && ARRAY['CUSTOMER_NOT_ACCEPTED','CUSTOMER_INTEGRITY_FLAG']::text[])`
    );
    let released = 0;
    const refundIds: string[] = [];
    for (const call of due) {
      const done = await this.prisma.$transaction(async tx => {
        const locked = await tx.$queryRaw<{ id: string; negated: boolean }[]>(
          Prisma.sql`SELECT id, (routing_reasons && ARRAY['CUSTOMER_NOT_ACCEPTED','CUSTOMER_INTEGRITY_FLAG']::text[]) as negated
            FROM verification_calls WHERE id = ${call.verificationId}::uuid AND submitted_at IS NULL FOR UPDATE SKIP LOCKED`
        );
        // The customer saying "no" between this sweep's SELECT and this transaction must stop the release
        // just as much as one that was already on the record when the sweep started.
        if (locked[0] === undefined || locked[0].negated) return null;
        const booking = await VerificationOutcomeService.loadBooking(tx, call.bookingId);
        const statuses = await tx.$queryRaw<{ status: string }[]>(Prisma.sql`SELECT status::text FROM bookings WHERE id = ${call.bookingId}::uuid`);
        if (statuses[0]?.status !== 'AWAITING_VERIFICATION') return null;
        // Re-checked under the lock: a complaint raised between the sweep's SELECT and this transaction
        // must stop the release just as much as one that was already open.
        const complained = await tx.$queryRaw<{ n: bigint }[]>(
          Prisma.sql`SELECT count(*)::bigint as n FROM complaints WHERE booking_id = ${call.bookingId}::uuid AND status NOT IN ('RESOLVED','REJECTED')`
        );
        if ((complained[0]?.n ?? 0n) > 0n) return null;
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
