import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { calculatePlanCancellationRefund, distributePlanVisits, paisaToNumber } from '@smart-home/domain';
import { randomUUID } from 'node:crypto';
import { badRequest, notFound } from '../common/domain-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { LedgerService } from '../payment/ledger.service.js';
import { PaymentsService } from '../payment/payments.service.js';
import { appendOutboxEvent, AuditService } from '../platform/audit.service.js';
import type { PlanCreateInput, PlanSubscribeInput, PlanUpdateInput } from './plans.schemas.js';

@Injectable()
export class PlansService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PaymentsService) private readonly payments: PaymentsService,
    @Inject(LedgerService) private readonly ledger: LedgerService,
    @Inject(AuditService) private readonly audit: AuditService
  ) {}

  /** Public browse: lists active maintenance plans with included services and visit allocations. */
  async listPublicPlans() {
    const plans = await this.prisma.$queryRaw<
      {
        id: string;
        nameEn: string;
        nameUr: string;
        description: string;
        pricePaisa: bigint;
        durationMonths: number;
        isActive: boolean;
      }[]
    >(
      Prisma.sql`SELECT id, name_en as "nameEn", name_ur as "nameUr", description, price_paisa as "pricePaisa",
          duration_months as "durationMonths", is_active as "isActive"
        FROM plans WHERE is_active = true ORDER BY price_paisa ASC`
    );

    return Promise.all(
      plans.map(async plan => {
        const services = await this.prisma.$queryRaw<
          {
            serviceId: number;
            serviceNameEn: string;
            serviceNameUr: string;
            visitsIncluded: number;
            intervalDays: number;
          }[]
        >(
          Prisma.sql`SELECT ps.service_id as "serviceId", s.name_en as "serviceNameEn", s.name_ur as "serviceNameUr",
              ps.visits_included as "visitsIncluded", ps.interval_days as "intervalDays"
            FROM plan_services ps
            JOIN services s ON s.id = ps.service_id
            WHERE ps.plan_id = ${plan.id}::uuid
            ORDER BY ps.service_id ASC`
        );
        return {
          ...plan,
          pricePaisa: paisaToNumber(plan.pricePaisa),
          services
        };
      })
    );
  }

  /** Public: get single plan details. */
  async getPublicPlan(id: string) {
    const plans = await this.prisma.$queryRaw<
      {
        id: string;
        nameEn: string;
        nameUr: string;
        description: string;
        pricePaisa: bigint;
        durationMonths: number;
        isActive: boolean;
      }[]
    >(
      Prisma.sql`SELECT id, name_en as "nameEn", name_ur as "nameUr", description, price_paisa as "pricePaisa",
          duration_months as "durationMonths", is_active as "isActive"
        FROM plans WHERE id = ${id}::uuid AND is_active = true`
    );
    const plan = plans[0];
    if (plan === undefined) throw notFound('Plan');

    const services = await this.prisma.$queryRaw<
      {
        serviceId: number;
        serviceNameEn: string;
        serviceNameUr: string;
        visitsIncluded: number;
        intervalDays: number;
      }[]
    >(
      Prisma.sql`SELECT ps.service_id as "serviceId", s.name_en as "serviceNameEn", s.name_ur as "serviceNameUr",
          ps.visits_included as "visitsIncluded", ps.interval_days as "intervalDays"
        FROM plan_services ps
        JOIN services s ON s.id = ps.service_id
        WHERE ps.plan_id = ${plan.id}::uuid
        ORDER BY ps.service_id ASC`
    );

    return {
      ...plan,
      pricePaisa: paisaToNumber(plan.pricePaisa),
      services
    };
  }

  /** Admin: list all plans including inactive ones and subscription counts. */
  async adminListPlans() {
    const plans = await this.prisma.$queryRaw<
      {
        id: string;
        nameEn: string;
        nameUr: string;
        description: string;
        pricePaisa: bigint;
        durationMonths: number;
        isActive: boolean;
        createdAt: Date;
        activeSubscriptionsCount: bigint;
      }[]
    >(
      Prisma.sql`SELECT p.id, p.name_en as "nameEn", p.name_ur as "nameUr", p.description, p.price_paisa as "pricePaisa",
          p.duration_months as "durationMonths", p.is_active as "isActive", p.created_at as "createdAt",
          COUNT(s.id) FILTER (WHERE s.status = 'ACTIVE')::bigint as "activeSubscriptionsCount"
        FROM plans p
        LEFT JOIN subscriptions s ON s.plan_id = p.id
        GROUP BY p.id
        ORDER BY p.created_at DESC`
    );

    return Promise.all(
      plans.map(async p => {
        const services = await this.prisma.$queryRaw<
          {
            serviceId: number;
            serviceNameEn: string;
            visitsIncluded: number;
            intervalDays: number;
          }[]
        >(
          Prisma.sql`SELECT ps.service_id as "serviceId", s.name_en as "serviceNameEn",
              ps.visits_included as "visitsIncluded", ps.interval_days as "intervalDays"
            FROM plan_services ps
            JOIN services s ON s.id = ps.service_id
            WHERE ps.plan_id = ${p.id}::uuid
            ORDER BY ps.service_id ASC`
        );
        return {
          ...p,
          pricePaisa: paisaToNumber(p.pricePaisa),
          activeSubscriptionsCount: Number(p.activeSubscriptionsCount),
          services
        };
      })
    );
  }

  /** Admin: create a new maintenance plan. */
  async adminCreatePlan(actorUserId: string, input: PlanCreateInput) {
    return this.prisma.$transaction(async tx => {
      // Verify services exist
      for (const item of input.services) {
        const check = await tx.$queryRaw<{ id: number }[]>(
          Prisma.sql`SELECT id FROM services WHERE id = ${item.serviceId} AND is_active = true`
        );
        if (check[0] === undefined) throw badRequest(`Service ${item.serviceId} is not active or does not exist`);
      }

      const inserted = await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`INSERT INTO plans(name_en, name_ur, description, price_paisa, duration_months, is_active)
          VALUES (${input.nameEn}, ${input.nameUr}, ${input.description}, ${BigInt(input.pricePaisa)}, ${input.durationMonths}, true)
          RETURNING id`
      );
      const planId = inserted[0]?.id;
      if (planId === undefined) throw new Error('Failed to create plan');

      for (const item of input.services) {
        await tx.$executeRaw(
          Prisma.sql`INSERT INTO plan_services(plan_id, service_id, visits_included, interval_days)
            VALUES (${planId}::uuid, ${item.serviceId}, ${item.visitsIncluded}, ${item.intervalDays})`
        );
      }

      await this.audit.append(
        {
          actorUserId,
          actorRole: 'ADMIN',
          action: 'plan.create',
          entityType: 'plan',
          entityId: planId,
          after: { ...input }
        },
        tx
      );

      return { id: planId, ...input };
    });
  }

  /** Admin: update an existing maintenance plan. */
  async adminUpdatePlan(actorUserId: string, id: string, input: PlanUpdateInput) {
    return this.prisma.$transaction(async tx => {
      const existing = await tx.$queryRaw<{ id: string; nameEn: string; nameUr: string; description: string; pricePaisa: bigint; durationMonths: number; isActive: boolean }[]>(
        Prisma.sql`SELECT id, name_en as "nameEn", name_ur as "nameUr", description, price_paisa as "pricePaisa", duration_months as "durationMonths", is_active as "isActive"
          FROM plans WHERE id = ${id}::uuid FOR UPDATE`
      );
      const plan = existing[0];
      if (plan === undefined) throw notFound('Plan');

      const nameEn = input.nameEn ?? plan.nameEn;
      const nameUr = input.nameUr ?? plan.nameUr;
      const description = input.description ?? plan.description;
      const pricePaisa = input.pricePaisa !== undefined ? BigInt(input.pricePaisa) : plan.pricePaisa;
      const durationMonths = input.durationMonths ?? plan.durationMonths;
      const isActive = input.isActive ?? plan.isActive;

      await tx.$executeRaw(
        Prisma.sql`UPDATE plans SET name_en = ${nameEn}, name_ur = ${nameUr}, description = ${description},
            price_paisa = ${pricePaisa}, duration_months = ${durationMonths}, is_active = ${isActive}
          WHERE id = ${id}::uuid`
      );

      await this.audit.append(
        {
          actorUserId,
          actorRole: 'ADMIN',
          action: 'plan.update',
          entityType: 'plan',
          entityId: id,
          before: { nameEn: plan.nameEn, nameUr: plan.nameUr, description: plan.description, pricePaisa: paisaToNumber(plan.pricePaisa), durationMonths: plan.durationMonths, isActive: plan.isActive },
          after: { nameEn, nameUr, description, pricePaisa: paisaToNumber(pricePaisa), durationMonths, isActive }
        },
        tx
      );

      return { id, nameEn, nameUr, description, pricePaisa: paisaToNumber(pricePaisa), durationMonths, isActive };
    });
  }

  /** Admin: deactivate a plan. */
  async adminDeactivatePlan(actorUserId: string, id: string) {
    return this.prisma.$transaction(async tx => {
      const existing = await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT id FROM plans WHERE id = ${id}::uuid FOR UPDATE`
      );
      if (existing[0] === undefined) throw notFound('Plan');

      await tx.$executeRaw(Prisma.sql`UPDATE plans SET is_active = false WHERE id = ${id}::uuid`);

      await this.audit.append(
        {
          actorUserId,
          actorRole: 'ADMIN',
          action: 'plan.deactivate',
          entityType: 'plan',
          entityId: id
        },
        tx
      );

      return { id, isActive: false };
    });
  }

  /**
   * Customer: Subscribe to a maintenance plan.
   * Generates subscription, distributes plan visits with exact paisa integrity,
   * creates the payment, and posts PLAN_PURCHASE to the double-entry ledger.
   */
  async subscribe(customerUserId: string, planId: string, input: PlanSubscribeInput) {
    const plans = await this.prisma.$queryRaw<
      { id: string; nameEn: string; pricePaisa: bigint; durationMonths: number; isActive: boolean }[]
    >(
      Prisma.sql`SELECT id, name_en as "nameEn", price_paisa as "pricePaisa", duration_months as "durationMonths", is_active as "isActive"
        FROM plans WHERE id = ${planId}::uuid`
    );
    const plan = plans[0];
    if (plan === undefined || !plan.isActive) throw badRequest('Plan is not available for subscription');

    // Verify address belongs to customer
    const addresses = await this.prisma.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT id FROM addresses WHERE id = ${input.addressId}::uuid AND customer_id = ${customerUserId}::uuid AND archived_at IS NULL`
    );
    if (addresses[0] === undefined) throw badRequest('Address is invalid or does not belong to you');

    // If preferred provider given, verify approved
    if (input.preferredProviderId !== null && input.preferredProviderId !== undefined) {
      const providers = await this.prisma.$queryRaw<{ userId: string }[]>(
        Prisma.sql`SELECT user_id as "userId" FROM providers WHERE user_id = ${input.preferredProviderId}::uuid AND status = 'APPROVED'`
      );
      if (providers[0] === undefined) throw badRequest('Preferred provider is not available');
    }

    const planServices = await this.prisma.$queryRaw<
      { serviceId: number; visitsIncluded: number; intervalDays: number }[]
    >(
      Prisma.sql`SELECT service_id as "serviceId", visits_included as "visitsIncluded", interval_days as "intervalDays"
        FROM plan_services WHERE plan_id = ${planId}::uuid ORDER BY service_id ASC`
    );
    if (planServices.length === 0) throw badRequest('Plan has no services configured');

    const result = await this.prisma.$transaction(async tx => {
      const now = new Date();
      // Ends at duration_months in the future
      const endsAt = new Date(now);
      endsAt.setMonth(endsAt.getMonth() + plan.durationMonths);

      const insertedSub = await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`INSERT INTO subscriptions(customer_id, plan_id, address_id, preferred_provider_id, starts_at, ends_at, status)
          VALUES (${customerUserId}::uuid, ${planId}::uuid, ${input.addressId}::uuid, ${input.preferredProviderId ?? null}::uuid, ${now.toISOString()}::timestamptz, ${endsAt.toISOString()}::timestamptz, 'ACTIVE'::subscription_status)
          RETURNING id`
      );
      const subscriptionId = insertedSub[0]?.id;
      if (subscriptionId === undefined) throw new Error('Failed to create subscription');

      // Distribute plan visits with exact paisa split
      const scheduledVisits = distributePlanVisits(plan.pricePaisa, planServices, now);

      for (const visit of scheduledVisits) {
        await tx.$executeRaw(
          Prisma.sql`INSERT INTO plan_visits(subscription_id, service_id, due_date, value_paisa, status)
            VALUES (${subscriptionId}::uuid, ${visit.serviceId}, ${visit.dueDate.toISOString().slice(0, 10)}::date, ${visit.valuePaisa}, 'PENDING'::plan_visit_status)`
        );
      }

      // Create payment
      const paymentId = await this.payments.createPayment(tx, {
        bookingId: null,
        subscriptionId,
        payerUserId: customerUserId,
        amountPaisa: plan.pricePaisa,
        purpose: 'PLAN',
        keySuffix: randomUUID()
      });

      // Post plan purchase directly into ledger: D GATEWAY_CLEARING · C PLAN_DEFERRED[subscription_id]
      await this.ledger.post(tx, {
        type: 'PLAN_PURCHASE',
        idempotencyKey: `plan-purchase:${subscriptionId}`,
        memo: `Subscription purchase for plan ${plan.nameEn}`,
        lines: [
          { account: 'GATEWAY_CLEARING', direction: 'DEBIT', amountPaisa: plan.pricePaisa },
          { account: 'PLAN_DEFERRED', direction: 'CREDIT', amountPaisa: plan.pricePaisa, subscriptionId }
        ]
      });

      await appendOutboxEvent(tx, {
        aggregate: 'subscription',
        aggregateId: subscriptionId,
        type: 'subscription.created',
        payload: {
          subscriptionId,
          customerId: customerUserId,
          planId,
          visitsCount: scheduledVisits.length,
          pricePaisa: plan.pricePaisa.toString()
        }
      });

      return {
        subscriptionId,
        paymentId,
        startsAt: now,
        endsAt,
        visitsCount: scheduledVisits.length
      };
    });

    const checkout = await this.payments.startCheckout(
      result.paymentId,
      { userId: customerUserId },
      input.returnUrl ?? `/me/subscriptions`
    );

    return {
      ...result,
      checkout
    };
  }

  /** Customer: List my subscriptions. */
  async listCustomerSubscriptions(customerUserId: string) {
    const subscriptions = await this.prisma.$queryRaw<
      {
        id: string;
        planId: string;
        planNameEn: string;
        planNameUr: string;
        status: string;
        startsAt: Date;
        endsAt: Date;
        cancelledAt: Date | null;
        createdAt: Date;
        addressLabel: string;
        addressLine1: string;
        preferredProviderId: string | null;
        totalVisits: bigint;
        pendingVisits: bigint;
        bookedVisits: bigint;
        consumedVisits: bigint;
        refundedVisits: bigint;
      }[]
    >(
      Prisma.sql`SELECT s.id, s.plan_id as "planId", p.name_en as "planNameEn", p.name_ur as "planNameUr",
          s.status, s.starts_at as "startsAt", s.ends_at as "endsAt", s.cancelled_at as "cancelledAt", s.created_at as "createdAt",
          a.label as "addressLabel", a.line1 as "addressLine1", s.preferred_provider_id as "preferredProviderId",
          COUNT(pv.id)::bigint as "totalVisits",
          COUNT(pv.id) FILTER (WHERE pv.status = 'PENDING')::bigint as "pendingVisits",
          COUNT(pv.id) FILTER (WHERE pv.status = 'BOOKED')::bigint as "bookedVisits",
          COUNT(pv.id) FILTER (WHERE pv.status = 'CONSUMED')::bigint as "consumedVisits",
          COUNT(pv.id) FILTER (WHERE pv.status = 'REFUNDED')::bigint as "refundedVisits"
        FROM subscriptions s
        JOIN plans p ON p.id = s.plan_id
        JOIN addresses a ON a.id = s.address_id
        LEFT JOIN plan_visits pv ON pv.subscription_id = s.id
        WHERE s.customer_id = ${customerUserId}::uuid
        GROUP BY s.id, p.name_en, p.name_ur, a.label, a.line1
        ORDER BY s.created_at DESC`
    );

    // These are COUNT(pv.id) — a count of visits, never paisa — so a JS number is correct and lossless. The
    // eslint money ban fires only because `totalVisits`/`refundedVisits` contain the words "total" and "refund";
    // renaming the API's own fields to dodge a linter would be the wrong trade, so the ban is stood down here.
    /* eslint-disable no-restricted-syntax */
    return subscriptions.map(({ totalVisits, pendingVisits, bookedVisits, consumedVisits, refundedVisits, ...rest }) => ({
      ...rest,
      visitCount: Number(totalVisits),
      pendingVisits: Number(pendingVisits),
      bookedVisits: Number(bookedVisits),
      consumedVisits: Number(consumedVisits),
      refundedVisits: Number(refundedVisits)
    }));
    /* eslint-enable no-restricted-syntax */
  }

  /** Customer / Admin: Read a single subscription with its scheduled visits. */
  async getSubscription(actor: { userId: string; roles: readonly string[] }, id: string) {
    const subscriptions = await this.prisma.$queryRaw<
      {
        id: string;
        customerId: string;
        planId: string;
        planNameEn: string;
        planNameUr: string;
        planPricePaisa: bigint;
        status: string;
        startsAt: Date;
        endsAt: Date;
        cancelledAt: Date | null;
        createdAt: Date;
        addressId: string;
        addressLabel: string;
        addressLine1: string;
        preferredProviderId: string | null;
      }[]
    >(
      Prisma.sql`SELECT s.id, s.customer_id as "customerId", s.plan_id as "planId", p.name_en as "planNameEn", p.name_ur as "planNameUr",
          p.price_paisa as "planPricePaisa", s.status, s.starts_at as "startsAt", s.ends_at as "endsAt",
          s.cancelled_at as "cancelledAt", s.created_at as "createdAt", s.address_id as "addressId",
          a.label as "addressLabel", a.line1 as "addressLine1", s.preferred_provider_id as "preferredProviderId"
        FROM subscriptions s
        JOIN plans p ON p.id = s.plan_id
        JOIN addresses a ON a.id = s.address_id
        WHERE s.id = ${id}::uuid`
    );
    const sub = subscriptions[0];
    if (sub === undefined) throw notFound('Subscription');

    const isStaff = actor.roles.includes('ADMIN') || actor.roles.includes('FINANCE') || actor.roles.includes('AGENT');
    if (!isStaff && sub.customerId !== actor.userId) throw notFound('Subscription');

    const visits = await this.prisma.$queryRaw<
      {
        id: string;
        serviceId: number;
        serviceNameEn: string;
        dueDate: Date;
        valuePaisa: bigint;
        bookingId: string | null;
        status: string;
      }[]
    >(
      Prisma.sql`SELECT pv.id, pv.service_id as "serviceId", s.name_en as "serviceNameEn",
          pv.due_date as "dueDate", pv.value_paisa as "valuePaisa", pv.booking_id as "bookingId", pv.status
        FROM plan_visits pv
        JOIN services s ON s.id = pv.service_id
        WHERE pv.subscription_id = ${id}::uuid
        ORDER BY pv.due_date ASC`
    );

    return {
      ...sub,
      planPricePaisa: paisaToNumber(sub.planPricePaisa),
      visits: visits.map(v => ({
        ...v,
        valuePaisa: paisaToNumber(v.valuePaisa)
      }))
    };
  }

  /**
   * Cancel subscription: refunds unused visits pro-rata.
   * D PLAN_DEFERRED[subscription_id] refundPaisa · C GATEWAY_CLEARING refundPaisa.
   */
  async cancelSubscription(actor: { userId: string; roles: readonly string[] }, id: string, reason?: string) {
    return this.prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<
        { id: string; customerId: string; status: string }[]
      >(
        Prisma.sql`SELECT id, customer_id as "customerId", status FROM subscriptions WHERE id = ${id}::uuid FOR UPDATE`
      );
      const sub = rows[0];
      if (sub === undefined) throw notFound('Subscription');

      const isStaff = actor.roles.includes('ADMIN');
      if (!isStaff && sub.customerId !== actor.userId) throw notFound('Subscription');
      if (sub.status !== 'ACTIVE') throw badRequest(`Subscription is already ${sub.status.toLowerCase()}`);

      const visits = await tx.$queryRaw<
        { id: string; status: 'PENDING' | 'BOOKED' | 'CONSUMED' | 'FORFEITED' | 'REFUNDED'; valuePaisa: bigint }[]
      >(
        Prisma.sql`SELECT id, status, value_paisa as "valuePaisa" FROM plan_visits WHERE subscription_id = ${id}::uuid FOR UPDATE`
      );

      const refundCalculation = calculatePlanCancellationRefund(visits);

      await tx.$executeRaw(
        Prisma.sql`UPDATE subscriptions SET status = 'CANCELLED'::subscription_status, cancelled_at = now() WHERE id = ${id}::uuid`
      );

      await tx.$executeRaw(
        Prisma.sql`UPDATE plan_visits SET status = 'REFUNDED'::plan_visit_status WHERE subscription_id = ${id}::uuid AND status = 'PENDING'`
      );

      if (refundCalculation.refundPaisa > 0n) {
        await this.ledger.post(tx, {
          type: 'REFUND',
          idempotencyKey: `cancel-plan:${id}`,
          memo: `Pro-rata cancellation refund for plan subscription: ${reason ?? 'Customer cancelled'}`,
          createdBy: actor.userId,
          lines: [
            { account: 'PLAN_DEFERRED', direction: 'DEBIT', amountPaisa: refundCalculation.refundPaisa, subscriptionId: id },
            { account: 'GATEWAY_CLEARING', direction: 'CREDIT', amountPaisa: refundCalculation.refundPaisa }
          ]
        });
      }

      await this.audit.append(
        {
          actorUserId: actor.userId,
          actorRole: isStaff ? 'ADMIN' : 'CUSTOMER',
          action: 'subscription.cancel',
          entityType: 'subscription',
          entityId: id,
          after: {
            reason: reason ?? null,
            refundedVisitsCount: refundCalculation.refundableVisitsCount,
            refundPaisa: refundCalculation.refundPaisa.toString()
          }
        },
        tx
      );

      await appendOutboxEvent(tx, {
        aggregate: 'subscription',
        aggregateId: id,
        type: 'subscription.cancelled',
        payload: {
          subscriptionId: id,
          refundedVisitsCount: refundCalculation.refundableVisitsCount,
          refundPaisa: refundCalculation.refundPaisa.toString()
        }
      });

      return {
        subscriptionId: id,
        status: 'CANCELLED',
        refundedVisitsCount: refundCalculation.refundableVisitsCount,
        refundPaisa: paisaToNumber(refundCalculation.refundPaisa)
      };
    });
  }
}
