// apps/api/src/booking/pricing.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { percentOfPaisa, paisaToNumber } from '@smart-home/domain';
import { badRequest, notFound } from '../common/domain-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { SettingsService } from '../platform/settings.service.js';

export type QuoteInput = { providerId?: string | undefined; serviceId: number; isEmergency?: boolean | undefined; couponCode?: string | undefined };

export type QuoteLine = { kind: 'SERVICE' | 'VISIT_FEE' | 'SURCHARGE' | 'DISCOUNT'; description: string; amountPaisa: number };

export type Quote = {
  currency: 'PKR';
  servicePaisa: number;
  visitFeePaisa: number;
  emergencySurchargePaisa: number;
  discountPaisa: number;
  /** What the booking itself costs: service + visit fee + surcharge - discount. This is what the booking's quoted/approved amounts start at. */
  totalPaisa: number;
  /** Cash a customer still owes from an earlier cancelled cash job (FR-PY-11); collected separately, not part of the booking total. */
  outstandingReceivablePaisa: number;
  /** What the customer settles in all: the booking total plus any outstanding receivable. */
  payablePaisa: number;
  lines: QuoteLine[];
  cancellationPolicy: string;
};

export type PricedBooking = { quote: Quote; couponId: string | null; categoryId: number; pricingModel: string };

const percentOf = (basePaisa: bigint, percent: number): bigint => percentOfPaisa(basePaisa, BigInt(Math.round(percent * 100)));

/**
 * FR-BK-04 / CL-01: the single place a booking's price is worked out. The quote
 * endpoint and checkout both go through `price()`, so what the customer was
 * shown and what the booking is created at can only differ if the inputs changed.
 * All arithmetic is bigint paisa; nothing here touches a float except the
 * percentage settings, which are rounded to basis points first.
 */
@Injectable()
export class PricingService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SettingsService) private readonly settings: SettingsService
  ) {}

  async price(customerId: string, input: QuoteInput): Promise<PricedBooking> {
    const services = await this.prisma.$queryRaw<{ categoryId: number; pricingModel: string; visitFeePaisa: bigint; isEmergencyEligible: boolean; nameEn: string; basePricePaisa: bigint }[]>(
      Prisma.sql`SELECT category_id as "categoryId", pricing_model as "pricingModel", visit_fee_paisa as "visitFeePaisa", is_emergency_eligible as "isEmergencyEligible", name_en as "nameEn", base_price_paisa as "basePricePaisa"
        FROM services WHERE id = ${input.serviceId} AND is_active = true`
    );
    const service = services[0];
    if (service === undefined) throw notFound('Service');

    // Auto-assign (no provider chosen yet) is priced at the service's base price; a chosen provider at their own approved price.
    let providerPrice = service.basePricePaisa;
    if (input.providerId !== undefined) {
      const priced = await this.prisma.$queryRaw<{ pricePaisa: bigint }[]>(
        Prisma.sql`SELECT ps.price_paisa as "pricePaisa" FROM provider_services ps JOIN providers p ON p.user_id = ps.provider_id
          WHERE ps.provider_id = ${input.providerId}::uuid AND ps.service_id = ${input.serviceId} AND ps.status = 'APPROVED' AND p.status = 'APPROVED'`
      );
      const chosen = priced[0]?.pricePaisa;
      if (chosen === undefined) throw notFound('Provider');
      providerPrice = chosen;
    }

    if (input.isEmergency === true && !service.isEmergencyEligible) throw badRequest('This service is not available as an emergency booking');

    // An inspection-first job is charged the visit fee up front; the work itself is quoted on site (FR-EX-05/FR-EX-11).
    const inspectionFirst = service.pricingModel === 'INSPECTION_FIRST';
    const servicePaisa = inspectionFirst ? service.visitFeePaisa : providerPrice;
    const visitFeePaisa = inspectionFirst ? 0n : service.visitFeePaisa;
    const surchargePct = input.isEmergency === true ? await this.settings.getNumber('booking.emergency_surcharge_pct') : 0;
    const emergencySurchargePaisa = percentOf(servicePaisa, surchargePct);

    const gross = servicePaisa + visitFeePaisa + emergencySurchargePaisa;
    const { discountPaisa, couponId } = await this.discountFor(customerId, input.couponCode, gross);
    const totalPaisa = gross - discountPaisa;

    const receivable = await this.prisma.$queryRaw<{ owed: bigint | null }[]>(
      Prisma.sql`SELECT -b.balance as owed FROM ledger_accounts a JOIN account_balances b ON b.account_id = a.id WHERE a.type = 'CUSTOMER_RECEIVABLE' AND a.owner_user_id = ${customerId}::uuid`
    );
    const owed = receivable[0]?.owed ?? 0n;
    const outstandingReceivablePaisa = owed > 0n ? owed : 0n;

    const lines: QuoteLine[] = [{ kind: 'SERVICE', description: inspectionFirst ? `${service.nameEn} (inspection visit)` : service.nameEn, amountPaisa: paisaToNumber(servicePaisa) }];
    if (visitFeePaisa > 0n) lines.push({ kind: 'VISIT_FEE', description: 'Visit fee', amountPaisa: paisaToNumber(visitFeePaisa) });
    if (emergencySurchargePaisa > 0n) lines.push({ kind: 'SURCHARGE', description: 'Emergency surcharge', amountPaisa: paisaToNumber(emergencySurchargePaisa) });
    if (discountPaisa > 0n) lines.push({ kind: 'DISCOUNT', description: 'Coupon discount', amountPaisa: -paisaToNumber(discountPaisa) });

    return {
      couponId,
      categoryId: service.categoryId,
      pricingModel: service.pricingModel,
      quote: {
        currency: 'PKR',
        servicePaisa: paisaToNumber(servicePaisa),
        visitFeePaisa: paisaToNumber(visitFeePaisa),
        emergencySurchargePaisa: paisaToNumber(emergencySurchargePaisa),
        discountPaisa: paisaToNumber(discountPaisa),
        totalPaisa: paisaToNumber(totalPaisa),
        outstandingReceivablePaisa: paisaToNumber(outstandingReceivablePaisa),
        payablePaisa: paisaToNumber(totalPaisa + outstandingReceivablePaisa),
        lines,
        cancellationPolicy: await this.cancellationPolicy()
      }
    };
  }

  /**
   * FR-BK-06 in words, built from the same two settings `BookingStateService.moneyFor`
   * reads when it decides whether a fee is due — one source, so the promise made
   * at quote time and the money taken at cancel time cannot drift apart.
   */
  async cancellationPolicy(): Promise<string> {
    const hours = await this.settings.getNumber('booking.free_cancel_hours');
    const fee = await this.settings.getNumber('booking.late_cancel_fee_paisa');
    return `Free cancellation up to ${hours} hours before your slot. After that a cancellation fee of PKR ${(fee / 100).toFixed(2)} applies. You can reschedule once, free of charge, up to ${hours} hours before your slot.`;
  }

  /**
   * The same rule as data, for a booking that already exists: what cancelling
   * *this* booking now would cost. `GET /bookings/:id` returns it so the detail
   * page can state the rule at the moment the customer decides, rather than
   * only quoting a generic policy at checkout.
   */
  async cancellationQuote(booking: {
    status: string;
    scheduledStart: Date;
    approvedTotalPaisa: number | bigint;
  }): Promise<{ freeCancelHours: number; lateCancelFeePaisa: number; hoursUntilStart: number; isLate: boolean; feeDuePaisa: number }> {
    const freeHours = await this.settings.getNumber('booking.free_cancel_hours');
    const configured = await this.settings.getNumber('booking.late_cancel_fee_paisa');
    const hoursUntilStart = Math.round(((booking.scheduledStart.getTime() - Date.now()) / 3_600_000) * 10) / 10;
    // Mirrors `moneyFor`: a fee is only due once the provider has accepted and
    // the slot is inside the free window. Before acceptance, or when the booking
    // is not one the customer can be charged for, it is zero.
    const isLate = booking.status === 'SCHEDULED' && hoursUntilStart < freeHours;
    const total = typeof booking.approvedTotalPaisa === 'bigint' ? paisaToNumber(booking.approvedTotalPaisa) : booking.approvedTotalPaisa;
    const feeDuePaisa = isLate ? Math.min(configured, total) : 0;
    return { freeCancelHours: freeHours, lateCancelFeePaisa: configured, hoursUntilStart, isLate, feeDuePaisa };
  }

  private async discountFor(customerId: string, code: string | undefined, grossPaisa: bigint): Promise<{ discountPaisa: bigint; couponId: string | null }> {
    if (code === undefined) return { discountPaisa: 0n, couponId: null };
    const coupons = await this.prisma.$queryRaw<{ id: string; kind: string; value: number; maxDiscountPaisa: bigint | null; usageLimit: number | null; perCustomerLimit: number }[]>(
      Prisma.sql`SELECT id, kind, value, max_discount_paisa as "maxDiscountPaisa", usage_limit as "usageLimit", per_customer_limit as "perCustomerLimit"
        FROM coupons WHERE code = ${code}::citext AND is_active = true AND valid_from <= now() AND valid_to >= now()`
    );
    const coupon = coupons[0];
    if (coupon === undefined) throw badRequest('That coupon code is not valid');
    const used = await this.prisma.$queryRaw<{ total: bigint; mine: bigint }[]>(
      Prisma.sql`SELECT count(*)::bigint as total, count(*) FILTER (WHERE customer_id = ${customerId}::uuid)::bigint as mine FROM coupon_redemptions WHERE coupon_id = ${coupon.id}::uuid`
    );
    if (coupon.usageLimit !== null && (used[0]?.total ?? 0n) >= BigInt(coupon.usageLimit)) throw badRequest('That coupon has been fully redeemed');
    if ((used[0]?.mine ?? 0n) >= BigInt(coupon.perCustomerLimit)) throw badRequest('You have already used that coupon');

    let discount = coupon.kind === 'PERCENT' ? (grossPaisa * BigInt(coupon.value)) / 10_000n : BigInt(coupon.value);
    if (coupon.maxDiscountPaisa !== null && discount > coupon.maxDiscountPaisa) discount = coupon.maxDiscountPaisa;
    if (discount > grossPaisa) discount = grossPaisa;
    return { discountPaisa: discount, couponId: coupon.id };
  }
}
