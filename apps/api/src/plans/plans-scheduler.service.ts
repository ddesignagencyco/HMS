import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { OfferService } from '../booking/offer.service.js';
import { SettingsService } from '../platform/settings.service.js';
import { appendOutboxEvent } from '../platform/audit.service.js';

@Injectable()
export class PlanSchedulerService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(OfferService) private readonly offer: OfferService,
    @Inject(SettingsService) private readonly settings: SettingsService
  ) {}

  /**
   * FR-MP-02: Daily job creates plan bookings for visits due within the horizon (default 7 days).
   * Offered first to the subscription's preferred provider if set.
   * Runs idempotently: only visits in PENDING status with no booking_id are scheduled.
   */
  async scheduleDueVisits(horizonDays = 7): Promise<{ scheduledCount: number }> {
    const dueVisits = await this.prisma.$queryRaw<
      {
        id: string;
        subscriptionId: string;
        serviceId: number;
        dueDate: Date;
        valuePaisa: bigint;
        customerId: string;
        addressId: string;
        preferredProviderId: string | null;
        expectedDurationMin: number;
      }[]
    >(
      Prisma.sql`SELECT pv.id, pv.subscription_id as "subscriptionId", pv.service_id as "serviceId",
          pv.due_date as "dueDate", pv.value_paisa as "valuePaisa",
          s.customer_id as "customerId", s.address_id as "addressId",
          s.preferred_provider_id as "preferredProviderId",
          srv.expected_duration_min as "expectedDurationMin"
        FROM plan_visits pv
        JOIN subscriptions s ON s.id = pv.subscription_id
        JOIN services srv ON srv.id = pv.service_id
        WHERE pv.status = 'PENDING'
          AND pv.booking_id IS NULL
          AND s.status = 'ACTIVE'
          AND pv.due_date <= CURRENT_DATE + make_interval(days => ${horizonDays}::int)
        ORDER BY pv.due_date ASC`
    );

    let scheduledCount = 0;
    const travelBufferMin = await this.settings.getNumber('booking.travel_buffer_min');

    for (const visit of dueVisits) {
      let scheduled = false;
      await this.prisma.$transaction(async tx => {
        // Re-check lock on visit to prevent race
        const locked = await tx.$queryRaw<{ id: string; status: string }[]>(
          Prisma.sql`SELECT id, status FROM plan_visits WHERE id = ${visit.id}::uuid AND status = 'PENDING' AND booking_id IS NULL FOR UPDATE`
        );
        if (locked[0] === undefined) return;

        // Schedule start at 10:00 AM local time on due date
        const scheduledStart = new Date(visit.dueDate);
        scheduledStart.setUTCHours(5, 0, 0, 0); // 10:00 AM PKT is 05:00 UTC
        const scheduledEnd = new Date(scheduledStart.getTime() + visit.expectedDurationMin * 60_000);

        // Resolve commission rate for the service/category
        const serviceRows = await tx.$queryRaw<{ categoryId: number }[]>(
          Prisma.sql`SELECT category_id as "categoryId" FROM services WHERE id = ${visit.serviceId}`
        );
        const categoryId = serviceRows[0]?.categoryId ?? null;
        const commissionRows = await tx.$queryRaw<{ rateBp: number }[]>(
          Prisma.sql`SELECT rate_bp as "rateBp" FROM commission_rules
            WHERE effective_from <= now() AND (effective_to IS NULL OR effective_to > now())
              AND ((scope = 'PROVIDER' AND provider_id = ${visit.preferredProviderId ?? null}::uuid) OR (scope = 'CATEGORY' AND category_id = ${categoryId}) OR scope = 'GLOBAL')
            ORDER BY effective_from DESC LIMIT 1`
        );
        const commissionRateBp = commissionRows[0]?.rateBp ?? 1500;

        const slotRange = Prisma.sql`tstzrange(${new Date(scheduledStart.getTime() - travelBufferMin * 30_000).toISOString()}::timestamptz, ${new Date(scheduledEnd.getTime() + travelBufferMin * 30_000).toISOString()}::timestamptz, '[)')`;

        const insertedBooking = await tx.$queryRaw<{ id: string }[]>(
          Prisma.sql`INSERT INTO bookings(customer_id, provider_id, service_id, address_id, subscription_id, status,
              payment_mode, payment_status, is_emergency, is_auto_assign, slot, scheduled_start, scheduled_end,
              problem_text, quoted_amount_paisa, approved_total_paisa, final_amount_paisa, discount_paisa, commission_rate_bp)
            VALUES (${visit.customerId}::uuid, ${visit.preferredProviderId ?? null}::uuid, ${visit.serviceId},
              ${visit.addressId}::uuid, ${visit.subscriptionId}::uuid, 'REQUESTED'::booking_status,
              'ONLINE'::payment_mode, 'HELD'::booking_payment_status, false, ${visit.preferredProviderId === null},
              ${slotRange}, ${scheduledStart.toISOString()}::timestamptz, ${scheduledEnd.toISOString()}::timestamptz,
              'Scheduled plan maintenance visit', ${visit.valuePaisa}, ${visit.valuePaisa}, ${visit.valuePaisa},
              0, ${commissionRateBp})
            RETURNING id`
        );

        const bookingId = insertedBooking[0]?.id;
        if (bookingId === undefined) throw new Error('Failed to create plan visit booking');

        // Link booking to plan visit
        await tx.$executeRaw(
          Prisma.sql`UPDATE plan_visits SET booking_id = ${bookingId}::uuid, status = 'BOOKED'::plan_visit_status WHERE id = ${visit.id}::uuid`
        );

        // Open offer for the booking (offers first to preferred provider if set, or cascades)
        await this.offer.open(tx, bookingId);

        await appendOutboxEvent(tx, {
          aggregate: 'plan_visit',
          aggregateId: visit.id,
          type: 'plan_visit.booked',
          payload: { visitId: visit.id, bookingId, subscriptionId: visit.subscriptionId }
        });

        // Counted only once the transaction has committed: incrementing inside it would report a visit as
        // scheduled even if the commit later failed, and the count is what the daily job logs.
        scheduled = true;
      });
      if (scheduled) scheduledCount += 1;
    }

    return { scheduledCount };
  }
}
