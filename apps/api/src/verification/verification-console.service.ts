// apps/api/src/verification/verification-console.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TIME_BANDS, bandOf, isWithinBusinessHours, nextAttemptAt, paisaToNumber, type TimeBand } from '@smart-home/domain';
import { DomainError, notFound } from '../common/domain-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { OBJECT_STORAGE, TELEPHONY } from '../integrations/integrations.module.js';
import type { ObjectStoragePort, TelephonyPort } from '../integrations/ports.js';
import { AppClock } from '../platform/app-clock.js';
import { SettingsService } from '../platform/settings.service.js';
import type { AttemptInput } from './verification.schemas.js';
import { VerificationLinkService } from './verification-link.service.js';

/** The consent line an agent reads before recording (NFR-PR-02, FR-VC-09). */
export const CONSENT_LINE = 'This call may be recorded to confirm your job with Smart Home Maintenance Services. Do you agree to continue?';

export const QUESTIONNAIRE = [
  { key: 'workCompleted', label: 'Was the work completed?', answers: ['FULL', 'PARTIAL', 'NONE'] },
  { key: 'ratings', label: 'Rate quality, punctuality, conduct and cleanliness, 1 to 5 each' },
  { key: 'extraChargeDemanded', label: 'Was any amount demanded beyond the approved price?', answers: [true, false], followUp: 'extraChargeAmountPaisa' },
  { key: 'uniformWorn', label: 'Did the provider arrive in uniform?', answers: [true, false] },
  { key: 'ownTools', label: 'Did the provider bring their own tools?', answers: [true, false] },
  { key: 'consentToRelease', label: 'Do you agree to release payment to the provider?', answers: [true, false] },
  { key: 'remark', label: 'Customer remark (transcribed)', optional: true }
] as const;

type Locked = { id: string; bookingId: string; visitNo: number };

/**
 * FR-VC-03..06 / FR-VC-09: what an agent sees and does while holding a call. Every method here first checks the agent
 * really holds the lock on this call — the console for someone else's call is a 404, as if it did not exist.
 */
@Injectable()
export class VerificationConsoleService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(AppClock) private readonly clock: AppClock,
    @Inject(TELEPHONY) private readonly telephony: TelephonyPort,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
    @Inject(VerificationLinkService) private readonly links: VerificationLinkService
  ) {}

  async assertHolds(agentId: string, verificationId: string): Promise<Locked> {
    const rows = await this.prisma.$queryRaw<Locked[]>(
      Prisma.sql`SELECT id, booking_id as "bookingId", visit_no as "visitNo" FROM verification_calls WHERE id = ${verificationId}::uuid AND locked_by = ${agentId}::uuid AND status = 'LOCKED'`
    );
    if (rows[0] === undefined) throw notFound('Verification');
    return rows[0];
  }

  /** FR-VC-03: everything the agent needs in one call — booking, invoice, photos, checklist, the provider's record, and this call's history. */
  async console(agentId: string, verificationId: string) {
    const held = await this.assertHolds(agentId, verificationId);

    const heads = await this.prisma.$queryRaw<
      {
        verificationId: string; tier: string; routingReasons: string[]; slaDueAt: Date; priority: number;
        code: string; status: string; paymentMode: string; scheduledStart: Date; scheduledEnd: Date; problemText: string | null;
        approvedTotalPaisa: bigint; finalAmountPaisa: bigint | null; completedAt: Date | null; startedAt: Date | null; checkinDistanceM: number | null; checkoutDistanceM: number | null;
        serviceName: string; expectedDurationMin: number; customerFirstName: string; customerPhone: string | null; providerId: string; providerName: string; providerPhone: string | null;
      }[]
    >(
      Prisma.sql`SELECT v.id as "verificationId", v.tier::text as tier, v.routing_reasons as "routingReasons", v.sla_due_at as "slaDueAt", v.priority,
          b.code, b.status::text as status, b.payment_mode::text as "paymentMode", b.scheduled_start as "scheduledStart", b.scheduled_end as "scheduledEnd", b.problem_text as "problemText",
          b.approved_total_paisa as "approvedTotalPaisa", b.final_amount_paisa as "finalAmountPaisa", b.completed_at as "completedAt", b.start_otp_verified_at as "startedAt",
          b.checkin_distance_m as "checkinDistanceM", b.checkout_distance_m as "checkoutDistanceM", s.name_en as "serviceName", s.expected_duration_min as "expectedDurationMin",
          cu.first_name as "customerFirstName", cu.phone_e164 as "customerPhone", b.provider_id as "providerId", trim(pu.first_name || ' ' || pu.last_name) as "providerName", pu.phone_e164 as "providerPhone"
        FROM verification_calls v JOIN bookings b ON b.id = v.booking_id JOIN services s ON s.id = b.service_id JOIN users cu ON cu.id = b.customer_id JOIN users pu ON pu.id = b.provider_id
        WHERE v.id = ${verificationId}::uuid`
    );
    const head = heads[0];
    if (head === undefined) throw notFound('Verification');

    const invoiceRows = await this.prisma.$queryRaw<{ number: string; subtotal: bigint; surcharge: bigint; discount: bigint; total: bigint }[]>(
      Prisma.sql`SELECT number, subtotal_paisa as subtotal, surcharge_paisa as surcharge, discount_paisa as discount, total_paisa as total FROM invoices WHERE booking_id = ${held.bookingId}::uuid`
    );
    const lines = await this.prisma.$queryRaw<{ kind: string; description: string; amountPaisa: bigint }[]>(
      Prisma.sql`SELECT kind::text, description, amount_paisa as "amountPaisa" FROM booking_items WHERE booking_id = ${held.bookingId}::uuid ORDER BY created_at, id`
    );
    const evidence = await this.prisma.$queryRaw<{ id: string; kind: string; checklistItemId: number | null; receivedAt: Date; storageKey: string }[]>(
      Prisma.sql`SELECT id, kind::text, checklist_item_id as "checklistItemId", received_at as "receivedAt", storage_key as "storageKey" FROM job_evidence
        WHERE booking_id = ${held.bookingId}::uuid AND visit_no = ${held.visitNo} AND kind IN ('BEFORE','AFTER','CHECKLIST') ORDER BY received_at, id`
    );
    const checklist = await this.prisma.$queryRaw<{ id: number; label: string; requiresPhoto: boolean; done: boolean | null; evidenceId: string | null }[]>(
      Prisma.sql`SELECT i.id, i.label_en as label, i.requires_photo as "requiresPhoto", r.done, r.evidence_id as "evidenceId"
        FROM service_checklist_items i JOIN bookings b ON b.service_id = i.service_id AND b.id = ${held.bookingId}::uuid
          LEFT JOIN job_checklist_results r ON r.booking_id = b.id AND r.checklist_item_id = i.id AND r.visit_no = ${held.visitNo} WHERE i.is_active ORDER BY i.position`
    );
    const history = await this.prisma.$queryRaw<{ verifiedJobs: bigint; ratingCount: bigint; averageScore: string | null; openComplaints: bigint; flags90d: bigint; demeritPoints: bigint }[]>(
      Prisma.sql`SELECT
          (SELECT count(DISTINCT v2.booking_id) FROM verification_calls v2 JOIN bookings b2 ON b2.id = v2.booking_id WHERE b2.provider_id = ${head.providerId}::uuid AND v2.outcome IN ('VERIFIED_SATISFIED','VERIFIED_WITH_ISSUE','LINK_CONFIRMED'))::bigint as "verifiedJobs",
          (SELECT count(*) FROM ratings WHERE provider_id = ${head.providerId}::uuid)::bigint as "ratingCount",
          (SELECT round(avg(score), 2)::text FROM ratings WHERE provider_id = ${head.providerId}::uuid) as "averageScore",
          (SELECT count(*) FROM complaints WHERE against_user_id = ${head.providerId}::uuid AND status NOT IN ('RESOLVED','REJECTED'))::bigint as "openComplaints",
          (SELECT count(*) FROM provider_flags WHERE provider_id = ${head.providerId}::uuid AND cleared_at IS NULL AND created_at > now() - interval '90 days')::bigint as "flags90d",
          coalesce((SELECT sum(points_remaining) FROM demerit_awards WHERE provider_id = ${head.providerId}::uuid AND voided_at IS NULL AND points_remaining > 0), 0)::bigint as "demeritPoints"`
    );
    const complaints = await this.prisma.$queryRaw<{ id: string; category: string; severity: string; status: string; description: string; bookingCode: string | null }[]>(
      Prisma.sql`SELECT c.id, c.category::text, c.severity::text, c.status::text, c.description, b.code as "bookingCode" FROM complaints c LEFT JOIN bookings b ON b.id = c.booking_id
        WHERE c.status NOT IN ('RESOLVED','REJECTED') AND (c.booking_id = ${held.bookingId}::uuid OR c.against_user_id = ${head.providerId}::uuid) ORDER BY c.created_at DESC LIMIT 20`
    );
    const attempts = await this.attempts(verificationId);
    const h = history[0];

    return {
      verification: { id: head.verificationId, visitNo: held.visitNo, tier: head.tier, routingReasons: head.routingReasons, priority: head.priority, slaDueAt: head.slaDueAt, attempts },
      booking: {
        id: held.bookingId, code: head.code, status: head.status, serviceName: head.serviceName, paymentMode: head.paymentMode, scheduledStart: head.scheduledStart, scheduledEnd: head.scheduledEnd,
        problemText: head.problemText, approvedTotalPaisa: paisaToNumber(head.approvedTotalPaisa), finalAmountPaisa: head.finalAmountPaisa === null ? null : paisaToNumber(head.finalAmountPaisa), completedAt: head.completedAt, startedAt: head.startedAt,
        minutesOnSite: head.startedAt !== null && head.completedAt !== null ? Math.round((head.completedAt.getTime() - head.startedAt.getTime()) / 60_000) : null,
        expectedDurationMin: head.expectedDurationMin, checkinDistanceM: head.checkinDistanceM, checkoutDistanceM: head.checkoutDistanceM
      },
      customer: { firstName: head.customerFirstName, phone: head.customerPhone },
      provider: { id: head.providerId, name: head.providerName },
      invoice:
        invoiceRows[0] === undefined
          ? null
          : {
              number: invoiceRows[0].number,
              subtotalPaisa: paisaToNumber(invoiceRows[0].subtotal),
              surchargePaisa: paisaToNumber(invoiceRows[0].surcharge),
              discountPaisa: paisaToNumber(invoiceRows[0].discount),
              totalPaisa: paisaToNumber(invoiceRows[0].total),
              lines: lines.map(line => ({ kind: line.kind, description: line.description, amountPaisa: paisaToNumber(line.amountPaisa) }))
            },
      evidence: evidence.map(({ storageKey, ...row }) => ({ ...row, url: `/api/v1/dev/storage/evidence/${encodeURIComponent(storageKey)}` })),
      checklist,
      providerHistory:
        h === undefined
          ? null
          : { verifiedJobs: Number(h.verifiedJobs), ratingCount: Number(h.ratingCount), averageScore: h.averageScore === null ? null : Number(h.averageScore), openComplaints: Number(h.openComplaints), flags90d: Number(h.flags90d), demeritPoints: Number(h.demeritPoints) },
      openComplaints: complaints,
      consentLine: CONSENT_LINE,
      questionnaire: QUESTIONNAIRE,
      outcomes: ['VERIFIED_SATISFIED', 'VERIFIED_WITH_ISSUE', 'REWORK_REQUIRED', 'DISPUTED']
    };
  }

  private async attempts(verificationId: string) {
    return this.prisma.$queryRaw<{ id: string; attemptNo: number; agentId: string; band: string; startedAt: Date; durationSeconds: number | null; result: string; callRef: string | null; notes: string | null }[]>(
      Prisma.sql`SELECT id, attempt_no as "attemptNo", agent_id as "agentId", band::text, started_at as "startedAt", duration_seconds as "durationSeconds", result::text, call_ref as "callRef", notes
        FROM verification_call_attempts WHERE verification_call_id = ${verificationId}::uuid ORDER BY attempt_no`
    );
  }

  async listAttempts(agentId: string, verificationId: string) {
    await this.assertHolds(agentId, verificationId);
    return this.attempts(verificationId);
  }

  /**
   * FR-VC-09: click-to-call. With an agent endpoint the telephony adapter rings the agent and bridges the customer,
   * recording; without one the agent dials by hand and gets the number. Either way the attempt itself is logged
   * separately with `POST .../attempts` — a bridged call that never connects is still an attempt.
   */
  async call(agentId: string, verificationId: string, agentEndpoint: string | undefined) {
    const held = await this.assertHolds(agentId, verificationId);
    if (!isWithinBusinessHours(this.clock.now())) throw new DomainError('OUTSIDE_CALLING_HOURS', 'Verification calls are only made between 08:00 and 22:00 Pakistan time');
    const rows = await this.prisma.$queryRaw<{ phone: string | null }[]>(
      Prisma.sql`SELECT cu.phone_e164 as phone FROM bookings b JOIN users cu ON cu.id = b.customer_id WHERE b.id = ${held.bookingId}::uuid`
    );
    const phone = rows[0]?.phone;
    if (phone === undefined || phone === null) throw new DomainError('CONFLICT', 'The customer has no phone number on file; use the verification link instead');
    if (agentEndpoint === undefined) return { mode: 'MANUAL' as const, customerPhone: phone, consentLine: CONSENT_LINE };
    const bridged = await this.telephony.bridgeCall({ agentEndpoint, customerPhone: phone, record: true });
    // The telephony provider hands the finished recording to our storage; the mock does it straight away. The agent attaches this reference to the attempt they log.
    const recordingRef = `calls/${bridged.callRef}.mp3`;
    await this.storage.put({ key: recordingRef, bucket: 'recordings', content: Buffer.from(`recording of call ${bridged.callRef}`), contentType: 'audio/mpeg' });
    return { mode: 'BRIDGED' as const, callRef: bridged.callRef, status: bridged.status, recordingRef, consentLine: CONSENT_LINE };
  }

  /**
   * FR-VC-06 / SRS §5.5: one call attempt, logged individually and never edited. An unanswered attempt returns the call to the queue for
   * a *different* time band; after `verification.max_attempts` unanswered attempts across at least two bands the customer gets the one-tap
   * verification link (SHM-059) and the call waits for their answer or the 72-hour auto-release.
   */
  async logAttempt(agentId: string, verificationId: string, input: AttemptInput) {
    const held = await this.assertHolds(agentId, verificationId);
    const startedAt = input.startedAt === undefined ? this.clock.now() : new Date(input.startedAt);
    const band = bandOf(startedAt);
    if (band === null) throw new DomainError('OUTSIDE_CALLING_HOURS', 'Calls are only made between 08:00 and 22:00 Pakistan time');

    const previous = await this.prisma.$queryRaw<{ band: TimeBand; result: string }[]>(
      Prisma.sql`SELECT band::text as band, result::text as result FROM verification_call_attempts WHERE verification_call_id = ${verificationId}::uuid ORDER BY attempt_no`
    );
    const unanswered = previous.filter(entry => entry.result !== 'ANSWERED');
    if (input.result !== 'ANSWERED' && unanswered.some(entry => entry.band === band)) {
      throw new DomainError('CONFLICT', 'A call in this time band has already been tried; try again in a different band');
    }

    const durationSeconds = input.durationSeconds ?? null;
    const endedAt = durationSeconds === null ? null : new Date(startedAt.getTime() + durationSeconds * 1000);
    const attemptNo = previous.length + 1;
    const attempt = await this.prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`INSERT INTO verification_call_attempts(verification_call_id, attempt_no, agent_id, band, started_at, ended_at, duration_seconds, result, call_ref, recording_ref, notes)
          VALUES (${verificationId}::uuid, ${attemptNo}, ${agentId}::uuid, ${band}::time_band, ${startedAt.toISOString()}::timestamptz, ${endedAt === null ? null : endedAt.toISOString()}::timestamptz, ${durationSeconds},
            ${input.result}::attempt_result, ${input.callRef ?? null}, ${input.recordingRef ?? null}, ${input.notes ?? null}) RETURNING id`
      );
      const id = rows[0]?.id;
      if (id === undefined) throw new Error('Attempt insert did not return a row');
      if (input.result === 'ANSWERED') return { id, band, attemptNo, nextAttemptAt: null as Date | null, linkSent: false, unanswered: unanswered.length };

      const maxAttempts = await this.settings.getNumber('verification.max_attempts');
      const tried = [...unanswered.map(entry => entry.band), band];
      const distinctBands = new Set(tried).size;
      const exhausted = tried.length >= maxAttempts && distinctBands >= Math.min(2, TIME_BANDS.length);
      const retryAt = exhausted ? new Date(this.clock.now().getTime() + (await this.settings.getNumber('verification.auto_release_hours')) * 3_600_000) : nextAttemptAt(this.clock.now(), tried);
      // Back to the queue, unlocked, not offered again before its next band opens.
      await tx.$executeRaw(
        Prisma.sql`UPDATE verification_calls SET status = 'QUEUED'::verification_status, locked_by = NULL, locked_at = NULL, next_attempt_at = ${retryAt.toISOString()}::timestamptz WHERE id = ${verificationId}::uuid`
      );
      return { id, band, attemptNo, nextAttemptAt: retryAt, linkSent: exhausted, unanswered: tried.length };
    });

    if (attempt.linkSent) await this.links.issue(held.bookingId, verificationId, 'UNREACHABLE');
    return { id: attempt.id, attemptNo: attempt.attemptNo, band: attempt.band, result: input.result, nextAttemptAt: attempt.nextAttemptAt, linkSent: attempt.linkSent };
  }
}
