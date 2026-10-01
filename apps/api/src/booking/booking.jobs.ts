// apps/api/src/booking/booking.jobs.ts
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { PaymentsService } from '../payment/payments.service.js';
import { QueueRegistry } from '../queues/queue.registry.js';
import { BookingService } from './booking.service.js';
import { OfferService } from './offer.service.js';

/**
 * Wires the booking module into the payment module's capture flow and into the
 * scheduler. Kept here, rather than in the payment module, so payments never
 * import bookings: a captured payment just calls the hooks it was given.
 */
@Injectable()
export class BookingJobs implements OnModuleInit {
  constructor(
    @Inject(PaymentsService) private readonly payments: PaymentsService,
    @Inject(OfferService) private readonly offers: OfferService,
    @Inject(BookingService) private readonly bookings: BookingService,
    @Inject(QueueRegistry) private readonly queues: QueueRegistry,
    @Inject(PrismaService) private readonly prisma: PrismaService
  ) {}

  onModuleInit(): void {
    this.payments.onBookingRequested(async (tx, bookingId) => {
      const rows = await tx.$queryRaw<{ customerId: string }[]>(Prisma.sql`SELECT customer_id as "customerId" FROM bookings WHERE id = ${bookingId}::uuid`);
      if (rows[0] !== undefined) await this.bookings.redeemCoupon(tx, bookingId, rows[0].customerId);
      await this.offers.open(tx, bookingId);
    });
    // A captured top-up approves the revision it was paid for, in the transaction that books the money into escrow.
    this.payments.onTopupCaptured(async (tx, paymentId) => {
      const revisions = await tx.$queryRaw<{ id: string; bookingId: string; customerId: string }[]>(
        Prisma.sql`SELECT r.id, r.booking_id as "bookingId", b.customer_id as "customerId" FROM quote_revisions r JOIN bookings b ON b.id = r.booking_id
          WHERE r.topup_payment_id = ${paymentId}::uuid AND r.status = 'PENDING' FOR UPDATE OF r`
      );
      const revision = revisions[0];
      if (revision === undefined) return;
      await tx.$queryRaw(Prisma.sql`SELECT id FROM bookings WHERE id = ${revision.bookingId}::uuid FOR UPDATE`);
      await this.bookings.approveRevisionInTx(tx, revision.bookingId, revision.id, revision.customerId);
    });
    this.queues.registerScheduled('booking.expire-offers', async () => void (await this.offers.expireDue()));
    this.queues.registerScheduled('payments.abandon-checkouts', async () => void (await this.payments.abandonExpiredCheckouts()));
  }
}
