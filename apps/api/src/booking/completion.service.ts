// apps/api/src/booking/completion.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { paisaToNumber } from '@smart-home/domain';
import { DomainError, conflict, notFound } from '../common/domain-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { AppClock } from '../platform/app-clock.js';
import { appendOutboxEvent } from '../platform/audit.service.js';
import { SettingsService } from '../platform/settings.service.js';
import { applySystemEvent } from './booking-state.js';
import { BookingStateService } from './booking-state.service.js';
import { BOOKING_COLUMNS, toBookingRow, type BookingRow, type BookingRowRaw } from './booking.row.js';
import type { BookingCompleteInput } from './booking.schemas.js';
import { ExecutionService } from './execution.service.js';
import { addBusinessMinutes } from '@smart-home/domain';
import { TierRoutingService } from './tier-routing.service.js';
import { renderInvoicePdf, type InvoiceDocument } from './invoice-pdf.js';

export type CompletedBooking = BookingRow & { invoice: { number: string; totalPaisa: number }; checkout?: { distanceM: number; withinGeofence: boolean } };

/**
 * FR-EX-06 / FR-EX-10 / FR-VC-01: finishing a job. The provider's "complete" is refused unless the
 * job can honestly be called done — start code used, every checklist step ticked (photo steps with their
 * photo), before and after photos on file — and never for more than the customer approved. When it passes,
 * the invoice, the final amount, the status change and the hand-off to verification all commit together:
 * there is no moment where a job is complete but unbilled, or billed but not queued for verification.
 */
@Injectable()
export class CompletionService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(BookingStateService) private readonly state: BookingStateService,
    @Inject(ExecutionService) private readonly execution: ExecutionService,
    @Inject(TierRoutingService) private readonly routing: TierRoutingService,
    @Inject(AppClock) private readonly clock: AppClock
  ) {}

  async complete(bookingId: string, providerId: string, input: BookingCompleteInput): Promise<CompletedBooking> {
    return this.prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<(BookingRowRaw & { visitNo: number })[]>(
        Prisma.sql`SELECT ${BOOKING_COLUMNS}, visit_no as "visitNo" FROM bookings WHERE id = ${bookingId}::uuid FOR UPDATE`
      );
      const row = rows[0];
      if (row === undefined || row.providerId !== providerId) throw notFound('Booking');
      if (row.status !== 'IN_PROGRESS') throw new DomainError('ILLEGAL_TRANSITION', `Cannot complete a booking in status ${row.status}`);

      if (row.startOtpVerifiedAt === null) throw conflict('The job was never started with the customer’s code');

      const outstanding = await tx.$queryRaw<{ id: number }[]>(
        Prisma.sql`SELECT c.id FROM service_checklist_items c
          WHERE c.service_id = ${row.serviceId} AND c.is_active = true
            AND NOT EXISTS (SELECT 1 FROM job_checklist_results r WHERE r.booking_id = ${bookingId}::uuid AND r.checklist_item_id = c.id AND r.visit_no = ${row.visitNo} AND r.done)`
      );
      if (outstanding.length > 0) throw conflict('Not every checklist item has been completed');

      if (await this.settings.getBoolean('booking.evidence_required')) {
        const kinds = await tx.$queryRaw<{ kind: string }[]>(
          Prisma.sql`SELECT DISTINCT kind::text as kind FROM job_evidence WHERE booking_id = ${bookingId}::uuid AND visit_no = ${row.visitNo} AND kind IN ('BEFORE','AFTER')`
        );
        const have = new Set(kinds.map(entry => entry.kind));
        if (!have.has('BEFORE')) throw conflict('A before photo is required to complete the job');
        if (!have.has('AFTER')) throw conflict('An after photo is required to complete the job');
      }

      const approved = row.approvedTotalPaisa;
      // A rework or warranty visit repairs the same job at the same price: the amount and invoice were settled on the first visit.
      const finalPaisa = row.visitNo > 1 ? (row.finalAmountPaisa ?? approved) : input.finalAmountPaisa === undefined ? approved : BigInt(input.finalAmountPaisa);
      if (finalPaisa > approved) {
        throw new DomainError('VALIDATION_FAILED', 'The final amount cannot exceed what the customer approved', [
          { path: 'finalAmountPaisa', code: 'too_big', message: `finalAmountPaisa cannot exceed the approved total of ${paisaToNumber(approved)}` }
        ]);
      }
      if (row.visitNo === 1 && finalPaisa < approved) {
        const reduction = approved - finalPaisa;
        await tx.$executeRaw(
          Prisma.sql`INSERT INTO booking_items(booking_id, kind, description, quantity, unit_price_paisa, amount_paisa)
            VALUES (${bookingId}::uuid, 'DISCOUNT'::item_kind, 'Provider adjustment', 1, ${-reduction}, ${-reduction})`
        );
      }

      let checkout: { distanceM: number; withinGeofence: boolean } | undefined;
      if (input.lat !== undefined && input.lng !== undefined) {
        checkout = await this.execution.recordCheckin(tx, bookingId, 'checkout', { lat: input.lat, lng: input.lng, accuracyM: input.accuracyM });
      }

      await this.state.applyInTx(tx, bookingId, 'complete', providerId);
      const invoice = await this.bill(tx, row, finalPaisa);
      const booking = await this.handToVerification(tx, row, finalPaisa);
      return { ...booking, invoice, ...(checkout === undefined ? {} : { checkout }) };
    });
  }

  /**
   * FR-EX-11: the customer rejected the extra work on an inspection-first job. The job is over at the
   * visit fee alone, so it skips the checklist and photo guards (there was nothing to fix) and goes
   * straight to billing and verification. Runs inside the rejecting transaction.
   */
  async completeAtVisitFee(tx: Prisma.TransactionClient, bookingId: string): Promise<BookingRow> {
    const rows = await tx.$queryRaw<(BookingRowRaw & { visitNo: number })[]>(
      Prisma.sql`SELECT ${BOOKING_COLUMNS}, visit_no as "visitNo" FROM bookings WHERE id = ${bookingId}::uuid FOR UPDATE`
    );
    const row = rows[0];
    if (row === undefined) throw notFound('Booking');
    const moved = await applySystemEvent(tx, bookingId, 'completeAtVisitFee', { reason: 'inspection-first work rejected; visit fee only' });
    if (moved === null) throw new DomainError('ILLEGAL_TRANSITION', `Cannot complete a booking in status ${row.status}`);
    await this.bill(tx, row, row.approvedTotalPaisa);
    return this.handToVerification(tx, row, row.approvedTotalPaisa);
  }

  /** Builds the itemised invoice from the booking's lines and records the final amount. */
  private async bill(tx: Prisma.TransactionClient, row: BookingRowRaw, finalPaisa: bigint): Promise<{ number: string; totalPaisa: number }> {
    const existing = await tx.$queryRaw<{ number: string }[]>(Prisma.sql`SELECT number FROM invoices WHERE booking_id = ${row.id}::uuid`);
    if (existing[0] !== undefined) {
      await tx.$executeRaw(Prisma.sql`UPDATE bookings SET completed_at = now() WHERE id = ${row.id}::uuid`);
      return { number: existing[0].number, totalPaisa: paisaToNumber(finalPaisa) };
    }
    const sums = await tx.$queryRaw<{ subtotal: bigint; surcharge: bigint; discount: bigint }[]>(
      Prisma.sql`SELECT coalesce(sum(amount_paisa) FILTER (WHERE kind IN ('SERVICE','VISIT_FEE','EXTRA','PART')), 0)::bigint as subtotal,
                        coalesce(sum(amount_paisa) FILTER (WHERE kind = 'SURCHARGE'), 0)::bigint as surcharge,
                        coalesce(-sum(amount_paisa) FILTER (WHERE kind = 'DISCOUNT'), 0)::bigint as discount
        FROM booking_items WHERE booking_id = ${row.id}::uuid`
    );
    const { subtotal, surcharge, discount } = sums[0] ?? { subtotal: 0n, surcharge: 0n, discount: 0n };
    if (subtotal + surcharge - discount !== finalPaisa) throw new Error(`Invoice lines (${subtotal + surcharge - discount}) do not add up to the final amount (${finalPaisa})`);

    const invoices = await tx.$queryRaw<{ number: string }[]>(
      Prisma.sql`INSERT INTO invoices(booking_id, subtotal_paisa, surcharge_paisa, discount_paisa, total_paisa) VALUES (${row.id}::uuid, ${subtotal}, ${surcharge}, ${discount}, ${finalPaisa}) RETURNING number`
    );
    await tx.$executeRaw(
      Prisma.sql`UPDATE bookings SET final_amount_paisa = ${finalPaisa}, completed_at = now(),
        payment_status = CASE WHEN payment_mode = 'CASH' THEN 'CASH_DUE'::booking_payment_status ELSE payment_status END WHERE id = ${row.id}::uuid`
    );
    return { number: invoices[0]?.number ?? '', totalPaisa: paisaToNumber(finalPaisa) };
  }

  /**
   * TRD §5.2's chained transition: WORK_COMPLETED immediately becomes AWAITING_VERIFICATION and a verification
   * record is queued, routed by `routeTier` (SHM-054) with every matching reason stored. Tier A waits in the agent
   * queue with an SLA counted only inside calling hours (BR-13/CL-19): cash jobs jump the queue (priority 0) with the
   * shorter SLA, since the provider is holding the customer's cash. Tier B waits for the customer's one-tap link and
   * escalates to Tier A if nothing comes back in `verification.b_escalation_hours`.
   */
  private async handToVerification(tx: Prisma.TransactionClient, row: BookingRowRaw & { visitNo: number }, finalPaisa: bigint): Promise<BookingRow> {
    const cash = row.paymentMode === 'CASH';
    const decision = await this.routing.route(tx, row, finalPaisa);
    await applySystemEvent(tx, row.id, 'handToVerification', { metadata: { tier: decision.tier, reasons: decision.reasons } });

    let dueAt: Date;
    if (decision.tier === 'A') {
      const slaMinutes = await this.settings.getNumber(cash ? 'verification.cash_sla_min' : 'verification.sla_min');
      dueAt = addBusinessMinutes(this.clock.now(), slaMinutes);
    } else {
      dueAt = new Date(this.clock.now().getTime() + (await this.settings.getNumber('verification.b_escalation_hours')) * 3_600_000);
    }
    const created = await tx.$queryRaw<{ id: string }[]>(
      Prisma.sql`INSERT INTO verification_calls(booking_id, visit_no, tier, routing_reasons, priority, sla_due_at)
        VALUES (${row.id}::uuid, ${row.visitNo}, ${decision.tier}::verification_tier, ${decision.reasons}::text[], ${cash ? 0 : 1}, ${dueAt.toISOString()}::timestamptz)
        ON CONFLICT (booking_id, visit_no) DO NOTHING RETURNING id`
    );
    // Tier B: nobody phones; the customer is asked once, by link. The SMS is sent by the worker from this event, not from inside this transaction.
    if (decision.tier === 'B' && created[0] !== undefined) {
      await appendOutboxEvent(tx, { aggregate: 'verification', aggregateId: created[0].id, type: 'verification.link_requested', payload: { bookingId: row.id, verificationId: created[0].id } });
    }
    await tx.$executeRaw(Prisma.sql`UPDATE bookings SET verification_tier = ${decision.tier}::verification_tier WHERE id = ${row.id}::uuid`);
    const refreshed = await tx.$queryRaw<BookingRowRaw[]>(Prisma.sql`SELECT ${BOOKING_COLUMNS} FROM bookings WHERE id = ${row.id}::uuid`);
    return toBookingRow(refreshed[0] as BookingRowRaw);
  }

  /** The invoice as a PDF, for the booking's customer or provider and nobody else (anyone else gets the same 404 as a booking that does not exist). */
  async invoicePdf(bookingId: string, actorUserId: string): Promise<{ filename: string; content: Buffer }> {
    const docs = await this.prisma.$queryRaw<
      {
        number: string;
        issuedAt: Date;
        code: string;
        serviceName: string;
        customerName: string;
        providerName: string;
        subtotal: bigint;
        surcharge: bigint;
        discount: bigint;
        total: bigint;
      }[]
    >(
      Prisma.sql`SELECT i.number, i.issued_at as "issuedAt", b.code, s.name_en as "serviceName", trim(cu.first_name || ' ' || cu.last_name) as "customerName",
          trim(pu.first_name || ' ' || pu.last_name) as "providerName", i.subtotal_paisa as subtotal, i.surcharge_paisa as surcharge, i.discount_paisa as discount, i.total_paisa as total
        FROM invoices i JOIN bookings b ON b.id = i.booking_id JOIN services s ON s.id = b.service_id JOIN users cu ON cu.id = b.customer_id JOIN users pu ON pu.id = b.provider_id
        WHERE b.id = ${bookingId}::uuid AND (b.customer_id = ${actorUserId}::uuid OR b.provider_id = ${actorUserId}::uuid)`
    );
    const doc = docs[0];
    if (doc === undefined) throw notFound('Invoice');
    const lines = await this.prisma.$queryRaw<{ description: string; amountPaisa: bigint }[]>(
      Prisma.sql`SELECT description, amount_paisa as "amountPaisa" FROM booking_items WHERE booking_id = ${bookingId}::uuid ORDER BY created_at, id`
    );
    const document: InvoiceDocument = {
      number: doc.number,
      issuedAt: doc.issuedAt,
      bookingCode: doc.code,
      serviceName: doc.serviceName,
      customerName: doc.customerName,
      providerName: doc.providerName,
      lines,
      subtotalPaisa: doc.subtotal,
      surchargePaisa: doc.surcharge,
      discountPaisa: doc.discount,
      totalPaisa: doc.total
    };
    return { filename: `${doc.number}.pdf`, content: renderInvoicePdf(document) };
  }
}
