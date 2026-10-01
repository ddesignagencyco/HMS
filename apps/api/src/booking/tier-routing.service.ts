// apps/api/src/booking/tier-routing.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { routeTier, type TierRoutingResult } from '@smart-home/domain';
import { SettingsService } from '../platform/settings.service.js';
import type { BookingRowRaw } from './booking.row.js';

/**
 * Where R9's random draw comes from: `Math.random`, unless a test pins it. Kept as its own provider so a test can make the
 * sample deterministic without touching a global.
 */
@Injectable()
export class TierRandom {
  private override: (() => number) | null = null;

  draw(): number {
    return this.override === null ? Math.random() : this.override();
  }

  /** Tests only: pin the draw (e.g. `() => 0.99` = never sampled). Pass null to restore. */
  pin(source: (() => number) | null): void {
    this.override = source;
  }
}

export type TierDecision = TierRoutingResult;

/**
 * FR-VC-11 / SRS §5.2: gathers the facts the routing rules need from what was really recorded on the job
 * — never from what the provider claims — and hands them to the pure `routeTier` from the domain package.
 * Runs inside the completion transaction, so it sees exactly the evidence the completion was accepted on.
 */
@Injectable()
export class TierRoutingService {
  constructor(
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(TierRandom) private readonly random: TierRandom
  ) {}

  async route(tx: Prisma.TransactionClient, booking: BookingRowRaw & { visitNo: number }, finalPaisa: bigint): Promise<TierDecision> {
    const providerId = booking.providerId;
    const facts = await tx.$queryRaw<
      {
        verifiedJobs: bigint;
        highRisk: boolean;
        expectedMin: number;
        demerits: bigint;
        priorComplaint: boolean;
        approvedExtras: boolean;
        minutesOnSite: number;
        missingPhoto: boolean;
        checkinDistance: number | null;
        checkoutDistance: number | null;
      }[]
    >(
      Prisma.sql`SELECT
          (SELECT count(DISTINCT v.booking_id) FROM verification_calls v JOIN bookings pb ON pb.id = v.booking_id
            WHERE pb.provider_id = ${providerId}::uuid AND v.outcome IN ('VERIFIED_SATISFIED','VERIFIED_WITH_ISSUE','LINK_CONFIRMED'))::bigint as "verifiedJobs",
          s.is_high_risk as "highRisk", s.expected_duration_min as "expectedMin",
          coalesce((SELECT sum(points_remaining) FROM demerit_awards WHERE provider_id = ${providerId}::uuid AND voided_at IS NULL AND points_remaining > 0), 0)::bigint as demerits,
          (EXISTS (SELECT 1 FROM complaints c JOIN bookings cb ON cb.id = c.booking_id WHERE cb.customer_id = ${booking.customerId}::uuid AND cb.provider_id = ${providerId}::uuid)
            OR EXISTS (SELECT 1 FROM disputes d JOIN bookings db ON db.id = d.booking_id WHERE db.customer_id = ${booking.customerId}::uuid AND db.provider_id = ${providerId}::uuid AND d.booking_id <> ${booking.id}::uuid)) as "priorComplaint",
          EXISTS (SELECT 1 FROM quote_revisions r WHERE r.booking_id = ${booking.id}::uuid AND r.status = 'APPROVED') as "approvedExtras",
          coalesce(EXTRACT(EPOCH FROM (now() - b.start_otp_verified_at)) / 60, 0)::float8 as "minutesOnSite",
          EXISTS (SELECT 1 FROM job_checklist_results r JOIN service_checklist_items i ON i.id = r.checklist_item_id
            WHERE r.booking_id = ${booking.id}::uuid AND r.visit_no = ${booking.visitNo} AND i.requires_photo AND r.evidence_id IS NULL) as "missingPhoto",
          b.checkin_distance_m as "checkinDistance", b.checkout_distance_m as "checkoutDistance"
        FROM bookings b JOIN services s ON s.id = b.service_id WHERE b.id = ${booking.id}::uuid`
    );
    const fact = facts[0];
    if (fact === undefined) throw new Error('Booking vanished while routing its verification');

    const geofence = await this.settings.getNumber('evidence.geofence_radius_m');
    return routeTier(
      {
        paymentMode: booking.paymentMode === 'CASH' ? 'CASH' : 'ONLINE',
        providerVerifiedJobs: Number(fact.verifiedJobs),
        finalAmountPaisa: finalPaisa,
        serviceIsHighRisk: fact.highRisk,
        evidence: {
          minutesOnSite: fact.minutesOnSite,
          expectedDurationMin: fact.expectedMin,
          missingRequiredPhoto: fact.missingPhoto,
          checkinOutsideGeofence: (fact.checkinDistance ?? 0) > geofence || (fact.checkoutDistance ?? 0) > geofence
        },
        providerActiveDemeritPoints: Number(fact.demerits),
        priorComplaintOrDispute: fact.priorComplaint,
        hasApprovedExtras: fact.approvedExtras
      },
      {
        firstJobs: await this.settings.getNumber('tier.first_jobs'),
        valueThresholdPaisa: BigInt(await this.settings.getNumber('tier.value_threshold_paisa')),
        minTimeRatio: await this.settings.getNumber('tier.min_time_ratio'),
        sampleRate: await this.settings.getNumber('tier.sample_rate'),
        forceTierA: await this.settings.getBoolean('verification.force_tier_a')
      },
      () => this.random.draw()
    );
  }
}
