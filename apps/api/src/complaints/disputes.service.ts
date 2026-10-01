// apps/api/src/complaints/disputes.service.ts
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { paisaToNumber } from '@smart-home/domain';
import { DomainError, notFound } from '../common/domain-error.js';
import { ConductService } from '../conduct/conduct.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { BookingStateService } from '../booking/booking-state.service.js';
import { applySystemEvent } from '../booking/booking-state.js';
import { ReleaseService } from '../payment/release.service.js';
import { PaymentsService } from '../payment/payments.service.js';
import { AppClock } from '../platform/app-clock.js';
import { AuditService, appendOutboxEvent } from '../platform/audit.service.js';
import { SettingsService } from '../platform/settings.service.js';
import { QueueRegistry } from '../queues/queue.registry.js';
import { VerificationOutcomeService } from '../verification/verification-outcome.service.js';

export type ResolveInput = {
  resolution: 'FULL_RELEASE' | 'PARTIAL_RELEASE' | 'FULL_REFUND' | 'REFUND_WITH_PENALTY';
  /** PARTIAL_RELEASE only: how much of the held money goes to the provider. The rest goes back to the customer. */
  releasePaisa?: number | undefined;
  note: string;
  /** Required to rule before the provider's reply window has closed without a reply. */
  overrideReason?: string | undefined;
  /** REFUND_WITH_PENALTY only: the breach to propose, and the amount an excess-based fine is a multiple of. */
  breachCode?: string | undefined;
  excessPaisa?: number | undefined;
};

/**
 * FR-CP-05 / FR-CP-06 / UC-14 / T24: a job whose money is frozen (a DISPUTED booking) gets an admin's ruling. The admin sees the evidence floor — start code time, geofence
 * distances, photos, checklist, invoice, every verification record — and the provider has a right of reply first (`penalty.reply_hours`). The ruling splits
 * what is held in escrow between provider and customer; the split always adds up to exactly what was held, and the postings, the refund, the booking's new
 * state, the dispute's record and both parties' notices all commit together or not at all.
 */
@Injectable()
export class DisputesService implements OnModuleInit {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(AppClock) private readonly clock: AppClock,
    @Inject(ReleaseService) private readonly release: ReleaseService,
    @Inject(PaymentsService) private readonly payments: PaymentsService,
    @Inject(ConductService) private readonly conduct: ConductService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(BookingStateService) private readonly bookingState: BookingStateService,
    @Inject(QueueRegistry) private readonly queues: QueueRegistry
  ) {}

  onModuleInit(): void {
    this.queues.registerScheduled('dispute.reply-window', async () => void (await this.closeReplyWindows()));
  }

  async list(status: string | undefined) {
    const rows = await this.prisma.$queryRaw<{ id: string; bookingCode: string; origin: string; status: string; replyDueAt: Date | null; providerReplied: boolean; createdAt: Date; resolution: string | null; provider: string }[]>(
      Prisma.sql`SELECT d.id, b.code as "bookingCode", d.origin::text, d.status::text, d.reply_due_at as "replyDueAt", (d.provider_replied_at IS NOT NULL) as "providerReplied", d.created_at as "createdAt", d.resolution::text, trim(u.first_name || ' ' || u.last_name) as provider
        FROM disputes d JOIN bookings b ON b.id = d.booking_id LEFT JOIN users u ON u.id = b.provider_id WHERE (${status ?? null}::text IS NULL OR d.status::text = ${status ?? null}) ORDER BY (d.status = 'RESOLVED'), d.created_at LIMIT 200`
    );
    return { items: rows };
  }

  private async escrowHeld(client: Prisma.TransactionClient | PrismaService, bookingId: string): Promise<bigint> {
    const rows = await client.$queryRaw<{ balance: bigint }[]>(Prisma.sql`SELECT coalesce(b.balance, 0)::bigint as balance FROM ledger_accounts a LEFT JOIN account_balances b ON b.account_id = a.id WHERE a.type = 'ESCROW' AND a.booking_id = ${bookingId}::uuid`);
    return rows[0]?.balance ?? 0n;
  }

  /** The evidence floor (SRS §5.1) plus the record around it. `forAdmin` adds who the agent was and which call attempts have recordings; the provider sees the rest. */
  async evidenceFloor(disputeId: string, forAdmin: boolean) {
    const disputes = await this.prisma.$queryRaw<
      { id: string; bookingId: string; complaintId: string | null; origin: string; status: string; replyDueAt: Date | null; providerReply: string | null; providerRepliedAt: Date | null; resolution: string | null; releasePaisa: bigint | null; refundPaisa: bigint | null; note: string | null; resolvedAt: Date | null; createdAt: Date }[]
    >(
      Prisma.sql`SELECT id, booking_id as "bookingId", complaint_id as "complaintId", origin::text, status::text, reply_due_at as "replyDueAt", provider_reply as "providerReply", provider_replied_at as "providerRepliedAt", resolution::text, release_paisa as "releasePaisa", refund_paisa as "refundPaisa", note, resolved_at as "resolvedAt", created_at as "createdAt"
        FROM disputes WHERE id = ${disputeId}::uuid`
    );
    const dispute = disputes[0];
    if (dispute === undefined) throw notFound('Dispute');
    const bookingId = dispute.bookingId;
    const geofence = await this.settings.getNumber('evidence.geofence_radius_m');
    const bookings = await this.prisma.$queryRaw<
      { code: string; status: string; paymentMode: string; customerName: string; providerId: string; providerName: string; serviceName: string; scheduledStart: Date; problemText: string | null; approved: bigint; final: bigint | null; discount: bigint; startedAt: Date | null; completedAt: Date | null; checkinDistance: number | null; checkoutDistance: number | null; visitNo: number }[]
    >(
      Prisma.sql`SELECT b.code, b.status::text, b.payment_mode::text as "paymentMode", trim(cu.first_name || ' ' || cu.last_name) as "customerName", b.provider_id as "providerId", trim(pu.first_name || ' ' || pu.last_name) as "providerName", s.name_en as "serviceName",
          b.scheduled_start as "scheduledStart", b.problem_text as "problemText", b.approved_total_paisa as approved, b.final_amount_paisa as final, b.discount_paisa as discount, b.start_otp_verified_at as "startedAt", b.completed_at as "completedAt",
          b.checkin_distance_m as "checkinDistance", b.checkout_distance_m as "checkoutDistance", b.visit_no as "visitNo"
        FROM bookings b JOIN services s ON s.id = b.service_id JOIN users cu ON cu.id = b.customer_id JOIN users pu ON pu.id = b.provider_id WHERE b.id = ${bookingId}::uuid`
    );
    const booking = bookings[0];
    if (booking === undefined) throw notFound('Booking');
    const invoice = await this.prisma.$queryRaw<{ number: string; total: bigint }[]>(Prisma.sql`SELECT number, total_paisa as total FROM invoices WHERE booking_id = ${bookingId}::uuid`);
    const lines = await this.prisma.$queryRaw<{ kind: string; description: string; amountPaisa: bigint }[]>(Prisma.sql`SELECT kind::text, description, amount_paisa as "amountPaisa" FROM booking_items WHERE booking_id = ${bookingId}::uuid ORDER BY created_at, id`);
    const evidence = await this.prisma.$queryRaw<{ id: string; kind: string; visitNo: number; receivedAt: Date; storageKey: string }[]>(
      Prisma.sql`SELECT id, kind::text, visit_no as "visitNo", received_at as "receivedAt", storage_key as "storageKey" FROM job_evidence WHERE booking_id = ${bookingId}::uuid ORDER BY received_at, id`
    );
    const checklist = await this.prisma.$queryRaw<{ label: string; requiresPhoto: boolean; done: boolean | null; visitNo: number | null; evidenceId: string | null }[]>(
      Prisma.sql`SELECT i.label_en as label, i.requires_photo as "requiresPhoto", r.done, r.visit_no as "visitNo", r.evidence_id as "evidenceId" FROM service_checklist_items i JOIN bookings b ON b.service_id = i.service_id AND b.id = ${bookingId}::uuid
        LEFT JOIN job_checklist_results r ON r.booking_id = b.id AND r.checklist_item_id = i.id WHERE i.is_active ORDER BY i.position, r.visit_no`
    );
    const verifications = await this.prisma.$queryRaw<
      { id: string; visitNo: number; tier: string; routingReasons: string[]; outcome: string | null; submittedAt: Date | null; workCompleted: string | null; quality: number | null; punctuality: number | null; conduct: number | null; cleanliness: number | null; extraChargeDemanded: boolean | null; extraChargeAmountPaisa: bigint | null; uniformWorn: boolean | null; ownTools: boolean | null; consentToRelease: boolean | null; remark: string | null; agentId: string | null }[]
    >(
      Prisma.sql`SELECT id, visit_no as "visitNo", tier::text, routing_reasons as "routingReasons", outcome::text, submitted_at as "submittedAt", work_completed::text as "workCompleted", quality, punctuality, conduct, cleanliness, extra_charge_demanded as "extraChargeDemanded",
          extra_charge_amount_paisa as "extraChargeAmountPaisa", uniform_worn as "uniformWorn", own_tools as "ownTools", consent_to_release as "consentToRelease", remark_text as remark, agent_id as "agentId" FROM verification_calls WHERE booking_id = ${bookingId}::uuid ORDER BY visit_no`
    );
    const attempts = forAdmin
      ? await this.prisma.$queryRaw<{ id: string; verificationId: string; attemptNo: number; band: string; startedAt: Date; result: string; durationSeconds: number | null; hasRecording: boolean }[]>(
          Prisma.sql`SELECT a.id, a.verification_call_id as "verificationId", a.attempt_no as "attemptNo", a.band::text, a.started_at as "startedAt", a.result::text, a.duration_seconds as "durationSeconds", (a.recording_ref IS NOT NULL) as "hasRecording"
            FROM verification_call_attempts a JOIN verification_calls v ON v.id = a.verification_call_id WHERE v.booking_id = ${bookingId}::uuid ORDER BY v.visit_no, a.attempt_no`
        )
      : [];
    const complaints = await this.prisma.$queryRaw<{ id: string; category: string; severity: string; status: string; description: string }[]>(
      Prisma.sql`SELECT id, category::text, severity::text, status::text, description FROM complaints WHERE booking_id = ${bookingId}::uuid ORDER BY created_at`
    );
    const history = await this.prisma.$queryRaw<{ event: string; from: string | null; to: string; role: string; at: Date }[]>(
      Prisma.sql`SELECT event, from_status::text as "from", to_status::text as "to", actor_role::text as role, created_at as at FROM booking_status_history WHERE booking_id = ${bookingId}::uuid ORDER BY id`
    );
    const held = await this.escrowHeld(this.prisma, bookingId);
    const finalPaisa = booking.final ?? booking.approved;
    const money = (value: bigint | null): number | null => (value === null ? null : paisaToNumber(value));

    return {
      dispute: { id: dispute.id, origin: dispute.origin, status: dispute.status, replyDueAt: dispute.replyDueAt, providerReply: dispute.providerReply, providerRepliedAt: dispute.providerRepliedAt, resolution: dispute.resolution, releasePaisa: money(dispute.releasePaisa), refundPaisa: money(dispute.refundPaisa), note: dispute.note, resolvedAt: dispute.resolvedAt, createdAt: dispute.createdAt, complaintId: dispute.complaintId },
      booking: { id: bookingId, code: booking.code, status: booking.status, paymentMode: booking.paymentMode, serviceName: booking.serviceName, customerName: booking.customerName, providerName: booking.providerName, scheduledStart: booking.scheduledStart, problemText: booking.problemText, approvedTotalPaisa: paisaToNumber(booking.approved), finalAmountPaisa: money(booking.final), discountPaisa: paisaToNumber(booking.discount), visitNo: booking.visitNo },
      money: { escrowHeldPaisa: paisaToNumber(held), finalAmountPaisa: paisaToNumber(finalPaisa), excessPaisa: paisaToNumber(held > finalPaisa ? held - finalPaisa : 0n) },
      evidenceFloor: {
        startCodeVerifiedAt: booking.startedAt,
        completedAt: booking.completedAt,
        minutesOnSite: booking.startedAt !== null && booking.completedAt !== null ? Math.round((booking.completedAt.getTime() - booking.startedAt.getTime()) / 60_000) : null,
        geofence: { radiusM: geofence, checkinDistanceM: booking.checkinDistance, checkoutDistanceM: booking.checkoutDistance, checkinWithin: booking.checkinDistance === null ? null : booking.checkinDistance <= geofence, checkoutWithin: booking.checkoutDistance === null ? null : booking.checkoutDistance <= geofence },
        photos: evidence.map(({ storageKey, ...photo }) => ({ ...photo, url: `/api/v1/dev/storage/evidence/${encodeURIComponent(storageKey)}` })),
        checklist,
        invoice: invoice[0] === undefined ? null : { number: invoice[0].number, totalPaisa: paisaToNumber(invoice[0].total), lines: lines.map(line => ({ kind: line.kind, description: line.description, amountPaisa: paisaToNumber(line.amountPaisa) })) }
      },
      verifications: verifications.map(row => ({ ...row, extraChargeAmountPaisa: money(row.extraChargeAmountPaisa), agentId: forAdmin ? row.agentId : null })),
      callAttempts: attempts,
      complaints,
      statusHistory: history
    };
  }

  async getForProvider(providerId: string, disputeId: string) {
    const rows = await this.prisma.$queryRaw<{ providerId: string }[]>(Prisma.sql`SELECT b.provider_id as "providerId" FROM disputes d JOIN bookings b ON b.id = d.booking_id WHERE d.id = ${disputeId}::uuid`);
    if (rows[0]?.providerId !== providerId) throw notFound('Dispute');
    return this.evidenceFloor(disputeId, false);
  }

  async listForProvider(providerId: string) {
    const rows = await this.prisma.$queryRaw<{ id: string; bookingCode: string; origin: string; status: string; replyDueAt: Date | null; providerReplied: boolean; createdAt: Date; resolution: string | null }[]>(
      Prisma.sql`SELECT d.id, b.code as "bookingCode", d.origin::text, d.status::text, d.reply_due_at as "replyDueAt", (d.provider_replied_at IS NOT NULL) as "providerReplied", d.created_at as "createdAt", d.resolution::text
        FROM disputes d JOIN bookings b ON b.id = d.booking_id WHERE b.provider_id = ${providerId}::uuid ORDER BY d.created_at DESC LIMIT 100`
    );
    return { items: rows };
  }

  /** The provider's right of reply. Once; allowed until the ruling. A reply closes the wait: the dispute is ready for an admin. */
  async reply(providerId: string, disputeId: string, text: string) {
    return this.prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<{ providerId: string; status: string; repliedAt: Date | null }[]>(
        Prisma.sql`SELECT b.provider_id as "providerId", d.status::text, d.provider_replied_at as "repliedAt" FROM disputes d JOIN bookings b ON b.id = d.booking_id WHERE d.id = ${disputeId}::uuid FOR UPDATE OF d`
      );
      const dispute = rows[0];
      if (dispute === undefined || dispute.providerId !== providerId) throw notFound('Dispute');
      if (dispute.status === 'RESOLVED') throw new DomainError('CONFLICT', 'This dispute has already been ruled on');
      if (dispute.repliedAt !== null) throw new DomainError('CONFLICT', 'You have already replied to this dispute');
      await tx.$executeRaw(Prisma.sql`UPDATE disputes SET provider_reply = ${text}, provider_replied_at = ${this.clock.now().toISOString()}::timestamptz, status = 'READY'::dispute_status WHERE id = ${disputeId}::uuid`);
      await appendOutboxEvent(tx, { aggregate: 'dispute', aggregateId: disputeId, type: 'dispute.replied', payload: { disputeId, providerId } });
      return { id: disputeId, status: 'READY' };
    });
  }

  /** Reply windows that ran out with no reply: the dispute is ready for a ruling (no override needed any more). */
  async closeReplyWindows(): Promise<number> {
    return this.prisma.$executeRaw(
      Prisma.sql`UPDATE disputes SET status = 'READY'::dispute_status WHERE status = 'OPEN' AND provider_replied_at IS NULL AND reply_due_at IS NOT NULL AND reply_due_at <= ${this.clock.now().toISOString()}::timestamptz`
    );
  }

  /**
   * UC-14 / T24. Escrow held is E and the job's final amount is F. FULL_RELEASE pays the provider F and returns the excess E−F to the customer; PARTIAL_RELEASE pays the
   * provider `releasePaisa` and returns E−releasePaisa; FULL_REFUND and REFUND_WITH_PENALTY return all of E (the latter also proposes a penalty). The two halves always sum to E, so
   * escrow ends at exactly zero. A cash job holds nothing: its ruling settles commission on what the provider keeps, and what the customer is owed is drawn from the provider's wallet.
   */
  async resolve(adminId: string, disputeId: string, input: ResolveInput) {
    const result = await this.prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<{ bookingId: string; status: string; replyDueAt: Date | null; repliedAt: Date | null; complaintId: string | null }[]>(
        Prisma.sql`SELECT booking_id as "bookingId", status::text, reply_due_at as "replyDueAt", provider_replied_at as "repliedAt", complaint_id as "complaintId" FROM disputes WHERE id = ${disputeId}::uuid FOR UPDATE`
      );
      const dispute = rows[0];
      if (dispute === undefined) throw notFound('Dispute');
      if (dispute.status === 'RESOLVED') throw new DomainError('CONFLICT', 'This dispute has already been ruled on');
      const now = this.clock.now();
      const windowOpen = dispute.repliedAt === null && dispute.replyDueAt !== null && now.getTime() < dispute.replyDueAt.getTime();
      if (windowOpen && (input.overrideReason === undefined || input.overrideReason.trim().length < 5)) {
        throw new DomainError('CONFLICT', `The provider has until ${dispute.replyDueAt?.toISOString() ?? 'the deadline'} to reply. To rule before then, give an override reason`);
      }

      const bookings = await VerificationOutcomeService.loadBooking(tx, dispute.bookingId);
      const statuses = await tx.$queryRaw<{ status: string }[]>(Prisma.sql`SELECT status::text FROM bookings WHERE id = ${dispute.bookingId}::uuid`);
      if (statuses[0]?.status !== 'DISPUTED') throw new DomainError('ILLEGAL_TRANSITION', `The booking is ${statuses[0]?.status ?? 'unknown'}, not disputed`);
      const facts = { bookingId: bookings.id, providerId: bookings.providerId, finalPaisa: bookings.finalAmountPaisa, discountPaisa: bookings.discountPaisa, commissionRateBp: bookings.commissionRateBp, paymentMode: bookings.paymentMode };
      const online = bookings.paymentMode === 'ONLINE';
      const held = online ? await this.escrowHeld(tx, bookings.id) : 0n;
      const final = bookings.finalAmountPaisa;

      // The split. Everything held goes to exactly one of the two.
      let releasePaisa: bigint;
      if (input.resolution === 'FULL_RELEASE') releasePaisa = online ? (final < held ? final : held) : final;
      else if (input.resolution === 'PARTIAL_RELEASE') {
        releasePaisa = BigInt(input.releasePaisa ?? -1);
        const ceiling = online ? (final < held ? final : held) : final;
        if (releasePaisa <= 0n || releasePaisa >= ceiling) throw new DomainError('VALIDATION_FAILED', 'A partial release must be more than nothing and less than the whole job', [{ path: 'releasePaisa', code: 'invalid', message: `releasePaisa must be between 1 and ${paisaToNumber(ceiling) - 1}` }]);
      } else releasePaisa = 0n;
      const refundPaisa = online ? held - releasePaisa : final - releasePaisa;
      if (input.resolution === 'REFUND_WITH_PENALTY' && input.breachCode === undefined) throw new DomainError('VALIDATION_FAILED', 'A refund with penalty needs the breach it is for', [{ path: 'breachCode', code: 'required', message: 'breachCode is required for REFUND_WITH_PENALTY' }]);

      const refundIds: string[] = [];
      if (online) {
        await this.release.releasePartOnline(tx, facts, releasePaisa, adminId);
        if (refundPaisa > 0n) refundIds.push(...(await this.payments.queueRefund(tx, { bookingId: bookings.id, amountPaisa: refundPaisa, reasonCode: `DISPUTE_${input.resolution}`, idempotencyKey: `dispute:${disputeId}`, requestedBy: adminId })));
        await tx.$executeRaw(
          Prisma.sql`UPDATE bookings SET payment_status = ${input.resolution === 'FULL_RELEASE' ? 'RELEASED' : input.resolution === 'PARTIAL_RELEASE' ? 'PARTIALLY_REFUNDED' : 'REFUNDED'}::booking_payment_status,
            released_at = CASE WHEN ${releasePaisa > 0n} THEN ${now.toISOString()}::timestamptz ELSE released_at END WHERE id = ${bookings.id}::uuid`
        );
      } else {
        if (releasePaisa > 0n) await this.release.settleCash(tx, { ...facts, finalPaisa: releasePaisa, discountPaisa: 0n }, adminId);
        await this.release.compensateFromProvider(tx, bookings.id, bookings.providerId, refundPaisa, adminId);
        await tx.$executeRaw(Prisma.sql`UPDATE bookings SET payment_status = ${input.resolution === 'FULL_RELEASE' ? 'CASH_SETTLED' : input.resolution === 'PARTIAL_RELEASE' ? 'PARTIALLY_REFUNDED' : 'REFUNDED'}::booking_payment_status WHERE id = ${bookings.id}::uuid`);
      }

      // The dispute's own record first (the booking guard requires a FULL_RELEASE ruling to exist before it lets money-released status through).
      await tx.$executeRaw(
        Prisma.sql`UPDATE disputes SET status = 'RESOLVED'::dispute_status, resolution = ${input.resolution}::dispute_resolution, release_paisa = ${releasePaisa}, refund_paisa = ${refundPaisa}, resolved_by = ${adminId}::uuid,
          resolved_at = ${now.toISOString()}::timestamptz, note = ${input.overrideReason === undefined ? input.note : `${input.note} [override: ${input.overrideReason}]`} WHERE id = ${disputeId}::uuid`
      );
      const event = input.resolution === 'FULL_RELEASE' ? 'resolveRelease' : input.resolution === 'PARTIAL_RELEASE' ? 'resolvePartial' : 'resolveRefund';
      const moved = await applySystemEvent(tx, bookings.id, event, { actorUserId: adminId, actorRole: 'ADMIN', reason: input.note, metadata: { disputeId, releasePaisa: releasePaisa.toString(), refundPaisa: refundPaisa.toString() } });
      if (moved === null) throw new DomainError('ILLEGAL_TRANSITION', 'The booking could not move out of dispute');

      if (input.resolution === 'REFUND_WITH_PENALTY') {
        await this.conduct.propose(tx, { providerId: bookings.providerId, breachCode: input.breachCode ?? '', proposedBy: adminId, bookingId: bookings.id, disputeId, ...(dispute.complaintId === null ? {} : { complaintId: dispute.complaintId }), excessPaisa: BigInt(input.excessPaisa ?? 0), evidence: { disputeId, note: input.note } });
      }
      if (dispute.complaintId !== null) {
        const mapped = { FULL_RELEASE: 'NO_ACTION', PARTIAL_RELEASE: 'PARTIAL_REFUND', FULL_REFUND: 'FULL_REFUND', REFUND_WITH_PENALTY: 'PROVIDER_PENALTY' }[input.resolution];
        await tx.$executeRaw(Prisma.sql`UPDATE complaints SET status = 'RESOLVED'::complaint_status, resolution = ${mapped}::complaint_resolution, resolution_note = ${`Resolved by dispute: ${input.note}`}, resolved_at = ${now.toISOString()}::timestamptz WHERE id = ${dispute.complaintId}::uuid AND status NOT IN ('RESOLVED','REJECTED')`);
      }
      await this.audit.append({ actorUserId: adminId, actorRole: 'ADMIN', action: 'dispute.resolve', entityType: 'dispute', entityId: disputeId, after: { resolution: input.resolution, releasePaisa: releasePaisa.toString(), refundPaisa: refundPaisa.toString(), override: input.overrideReason ?? null } }, tx);
      await appendOutboxEvent(tx, { aggregate: 'dispute', aggregateId: disputeId, type: 'dispute.resolved', payload: { disputeId, bookingId: bookings.id, customerId: bookings.customerId, providerId: bookings.providerId, resolution: input.resolution, releasePaisa: releasePaisa.toString(), refundPaisa: refundPaisa.toString() } });
      return { refundIds, releasePaisa, refundPaisa, bookingId: bookings.id };
    });
    await this.bookingState.settleRefunds(result.refundIds);
    return { disputeId, resolution: input.resolution, releasePaisa: paisaToNumber(result.releasePaisa), refundPaisa: paisaToNumber(result.refundPaisa) };
  }
}

