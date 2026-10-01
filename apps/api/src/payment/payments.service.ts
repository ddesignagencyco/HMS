// apps/api/src/payment/payments.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DomainError, notFound } from '../common/domain-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { PAYMENT_GATEWAY } from '../integrations/integrations.module.js';
import type { ParsedPaymentEvent, PaymentGatewayPort } from '../integrations/ports.js';
import { applySystemEvent } from '../booking/booking-state.js';
import { appendOutboxEvent } from '../platform/audit.service.js';
import { SettingsService } from '../platform/settings.service.js';
import { DebtService } from './debt.service.js';
import { LedgerService } from './ledger.service.js';

export type WebhookIngestResult = { accepted: true; duplicate: boolean; eventId: string; matchedPayment: boolean };

export type PaymentPurpose = 'BOOKING' | 'TOPUP' | 'DEBT';

/** Called inside the capture transaction once a captured payment has moved its booking to REQUESTED — the offer cascade hooks in here. */
export type BookingRequestedHook = (tx: Prisma.TransactionClient, bookingId: string) => Promise<void>;

/** Called inside the capture transaction once a top-up payment is captured, so the held revision can be approved atomically with the money. */
export type TopupCapturedHook = (tx: Prisma.TransactionClient, paymentId: string) => Promise<void>;

@Injectable()
export class PaymentsService {
  private bookingRequestedHook: BookingRequestedHook | undefined;
  private topupCapturedHook: TopupCapturedHook | undefined;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGatewayPort,
    @Inject(LedgerService) private readonly ledger: LedgerService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(DebtService) private readonly debt: DebtService
  ) {}

  onBookingRequested(hook: BookingRequestedHook): void {
    this.bookingRequestedHook = hook;
  }

  onTopupCaptured(hook: TopupCapturedHook): void {
    this.topupCapturedHook = hook;
  }

  /** Inserts the INITIATED payment row inside the caller's transaction, so it exists iff the booking/revision it pays for does. */
  async createPayment(tx: Prisma.TransactionClient, input: { bookingId: string | null; payerUserId: string; amountPaisa: bigint; purpose: PaymentPurpose; keySuffix: string }): Promise<string> {
    const timeoutMin = await this.settings.getNumber('booking.pending_payment_timeout_min');
    const rows = await tx.$queryRaw<{ id: string }[]>(
      Prisma.sql`INSERT INTO payments(purpose, booking_id, payer_user_id, gateway, amount_paisa, idempotency_key, expires_at)
        VALUES (${input.purpose}::payment_purpose, ${input.bookingId}::uuid, ${input.payerUserId}::uuid, 'mock', ${input.amountPaisa},
          ${`${input.purpose.toLowerCase()}:${input.bookingId ?? input.payerUserId}:${input.keySuffix}`}, now() + make_interval(mins => ${timeoutMin}::int))
        RETURNING id`
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new Error('Payment insert did not return a row');
    return id;
  }

  /** Talks to the gateway (never inside a database transaction) and records its reference. */
  async startCheckout(paymentId: string, customer: { userId: string }, returnUrl: string): Promise<{ paymentId: string; redirectUrl: string }> {
    const rows = await this.prisma.$queryRaw<{ amountPaisa: bigint; idempotencyKey: string }[]>(Prisma.sql`SELECT amount_paisa as "amountPaisa", idempotency_key as "idempotencyKey" FROM payments WHERE id = ${paymentId}::uuid`);
    const payment = rows[0];
    if (payment === undefined) throw notFound('Payment');
    const checkout = await this.gateway.createCheckout({ paymentId, amount: payment.amountPaisa, currency: 'PKR', customer, returnUrl, idempotencyKey: payment.idempotencyKey });
    await this.prisma.$executeRaw(Prisma.sql`UPDATE payments SET gateway_ref = ${checkout.providerRef} WHERE id = ${paymentId}::uuid`);
    return { paymentId, redirectUrl: checkout.redirectUrl };
  }

  /**
   * Stores a verified gateway event (deduplicated on the gateway's own event id)
   * and applies its effect in the same transaction, so "stored" and "applied"
   * can never disagree: a replayed event stops at the dedupe insert and
   * changes nothing, and a crash mid-apply rolls the event row back with it so
   * the gateway's retry is processed for real.
   */
  async ingestWebhookEvent(provider: string, event: ParsedPaymentEvent): Promise<WebhookIngestResult> {
    const outcome = await this.prisma.$transaction(async tx => {
      // Everything about one payment is serialised on its row lock, taken before the dedupe insert: two deliveries racing for the
      // same payment queue here instead of deadlocking on the event/ledger rows, and the loser then sees the winner's committed effect.
      const [payment] = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM payments WHERE id = ${event.paymentId}::uuid FOR UPDATE`);
      const paymentId = payment?.id ?? null;
      const rows = await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`INSERT INTO payment_events(gateway, gateway_event_id, payment_id, type, payload)
          VALUES (${provider}, ${event.eventId}, ${paymentId}::uuid, ${event.type}, ${JSON.stringify({ ...event.payload, gatewayOccurredAt: event.occurredAt })}::jsonb)
          ON CONFLICT (gateway, gateway_event_id) DO NOTHING RETURNING id`
      );
      const stored = rows[0];
      if (stored === undefined) return { inserted: false, matched: paymentId !== null };
      if (paymentId !== null) {
        await this.applyPaymentEvent(tx, paymentId, event.type);
        await tx.$executeRaw(Prisma.sql`UPDATE payment_events SET processed_at = now() WHERE id = ${stored.id}::uuid`);
        await appendOutboxEvent(tx, { aggregate: 'payment', aggregateId: paymentId, type: 'payment.webhook.received', payload: { eventId: event.eventId, type: event.type, paymentId } });
      }
      return { inserted: true, matched: paymentId !== null };
    });
    return { accepted: true, duplicate: !outcome.inserted, eventId: event.eventId, matchedPayment: outcome.matched };
  }

  private async applyPaymentEvent(tx: Prisma.TransactionClient, paymentId: string, type: string): Promise<void> {
    if (type === 'payment.captured') await this.capture(tx, paymentId);
    else if (type === 'payment.failed' || type === 'payment.expired') await this.fail(tx, paymentId, type === 'payment.failed' ? 'FAILED' : 'EXPIRED');
    // Any other event type is stored for audit but has no money effect.
  }

  private async capture(tx: Prisma.TransactionClient, paymentId: string): Promise<void> {
    const rows = await tx.$queryRaw<{ id: string; bookingId: string | null; purpose: string; amountPaisa: bigint; status: string }[]>(
      Prisma.sql`SELECT id, booking_id as "bookingId", purpose, amount_paisa as "amountPaisa", status FROM payments WHERE id = ${paymentId}::uuid FOR UPDATE`
    );
    const payment = rows[0];
    if (payment === undefined) throw notFound('Payment');
    if (payment.purpose === 'DEBT') return this.captureDebt(tx, paymentId, payment.status, payment.amountPaisa);
    // A capture that arrives for a payment already expired/failed is refused rather than resurrected: the booking may
    // have been released back to the market already. It is stored for reconciliation, not applied.
    if (payment.status !== 'INITIATED' || payment.bookingId === null) return;

    if (payment.purpose === 'BOOKING') {
      const bookings = await tx.$queryRaw<{ status: string }[]>(Prisma.sql`SELECT status FROM bookings WHERE id = ${payment.bookingId}::uuid FOR UPDATE`);
      if (bookings[0]?.status !== 'PENDING_PAYMENT') return;
    }

    await tx.$executeRaw(Prisma.sql`UPDATE payments SET status = 'CAPTURED'::payment_status, captured_at = now() WHERE id = ${paymentId}::uuid`);
    await this.ledger.post(tx, {
      type: 'CAPTURE',
      bookingId: payment.bookingId,
      idempotencyKey: `capture:${paymentId}`,
      memo: `Gateway capture for ${payment.purpose.toLowerCase()} payment`,
      lines: [
        { account: 'GATEWAY_CLEARING', direction: 'DEBIT', amountPaisa: payment.amountPaisa },
        { account: 'ESCROW', direction: 'CREDIT', amountPaisa: payment.amountPaisa, bookingId: payment.bookingId }
      ]
    });

    if (payment.purpose === 'BOOKING') {
      await applySystemEvent(tx, payment.bookingId, 'paymentCaptured', { paymentStatus: 'HELD', metadata: { paymentId } });
      await appendOutboxEvent(tx, { aggregate: 'payment', aggregateId: paymentId, type: 'payment.captured', payload: { paymentId, bookingId: payment.bookingId, amountPaisa: payment.amountPaisa.toString() } });
      if (this.bookingRequestedHook !== undefined) await this.bookingRequestedHook(tx, payment.bookingId);
    } else if (this.topupCapturedHook !== undefined) {
      await this.topupCapturedHook(tx, paymentId);
    }
  }

  /** FR-PY-13: a provider clears commission debt online. D GATEWAY_CLEARING / C PROVIDER_WALLET, and the offer block is lifted the moment the wallet is back under the ceiling. */
  private async captureDebt(tx: Prisma.TransactionClient, paymentId: string, status: string, amountPaisa: bigint): Promise<void> {
    if (status !== 'INITIATED') return;
    const payers = await tx.$queryRaw<{ payer: string }[]>(Prisma.sql`SELECT payer_user_id as payer FROM payments WHERE id = ${paymentId}::uuid`);
    const providerId = payers[0]?.payer;
    if (providerId === undefined) return;
    await tx.$executeRaw(Prisma.sql`UPDATE payments SET status = 'CAPTURED'::payment_status, captured_at = now() WHERE id = ${paymentId}::uuid`);
    await this.ledger.post(tx, {
      type: 'DEBT_PAYMENT',
      idempotencyKey: `capture:${paymentId}`,
      memo: 'Provider paid commission debt online',
      createdBy: providerId,
      lines: [
        { account: 'GATEWAY_CLEARING', direction: 'DEBIT', amountPaisa },
        { account: 'PROVIDER_WALLET', direction: 'CREDIT', amountPaisa, ownerUserId: providerId }
      ]
    });
    await this.debt.refreshBlock(tx, providerId);
    await appendOutboxEvent(tx, { aggregate: 'payment', aggregateId: paymentId, type: 'payment.debt_paid', payload: { paymentId, providerId, amountPaisa: amountPaisa.toString() } });
  }

  private async fail(tx: Prisma.TransactionClient, paymentId: string, status: 'FAILED' | 'EXPIRED'): Promise<void> {
    const rows = await tx.$queryRaw<{ bookingId: string | null; purpose: string; status: string }[]>(
      Prisma.sql`SELECT booking_id as "bookingId", purpose, status FROM payments WHERE id = ${paymentId}::uuid FOR UPDATE`
    );
    const payment = rows[0];
    if (payment === undefined || payment.status !== 'INITIATED') return;
    await tx.$executeRaw(Prisma.sql`UPDATE payments SET status = ${status}::payment_status WHERE id = ${paymentId}::uuid`);
    if (payment.purpose === 'BOOKING' && payment.bookingId !== null) {
      await applySystemEvent(tx, payment.bookingId, 'paymentAbandoned', { paymentStatus: 'NONE', reason: `payment ${status.toLowerCase()}` });
    }
  }

  /**
   * BR-05: an online checkout holds its slot only for `booking.pending_payment_timeout_min`.
   * Expiring the payment and abandoning the booking happen in one transaction per booking, and a
   * payment captured a moment earlier is untouched (its status is no longer INITIATED).
   */
  async abandonExpiredCheckouts(): Promise<number> {
    const due = await this.prisma.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT id FROM payments WHERE purpose = 'BOOKING' AND status = 'INITIATED' AND expires_at IS NOT NULL AND expires_at <= now()`
    );
    let abandoned = 0;
    for (const { id } of due) {
      await this.prisma.$transaction(async tx => {
        const before = await tx.$queryRaw<{ status: string }[]>(Prisma.sql`SELECT status FROM payments WHERE id = ${id}::uuid`);
        if (before[0]?.status !== 'INITIATED') return;
        await this.fail(tx, id, 'EXPIRED');
        abandoned += 1;
      });
    }
    return abandoned;
  }

  /**
   * Books a refund out of escrow: the ledger posting, the refunds row and the payments counter move
   * together inside the caller's transaction, so a booking is refunded exactly once per idempotency key.
   * The gateway call happens afterwards in `settleRefund` — money is already earmarked, the gateway
   * only has to be told, and a failed call can be retried without posting twice.
   *
   * A booking can have been paid in more than one go (the booking, then a top-up for extra work). The refund is
   * taken from those payments oldest first, one refund row per payment, so each goes back to the card that paid it.
   * Returns the ids of the refund rows created (empty when there was nothing to refund).
   */
  async queueRefund(tx: Prisma.TransactionClient, input: { bookingId: string; amountPaisa: bigint; reasonCode: string; idempotencyKey: string; requestedBy?: string | null }): Promise<string[]> {
    const payments = await tx.$queryRaw<{ id: string; amountPaisa: bigint; refundedPaisa: bigint }[]>(
      Prisma.sql`SELECT id, amount_paisa as "amountPaisa", refunded_paisa as "refundedPaisa" FROM payments
        WHERE booking_id = ${input.bookingId}::uuid AND purpose IN ('BOOKING','TOPUP') AND status IN ('CAPTURED','PARTIALLY_REFUNDED') ORDER BY captured_at, id FOR UPDATE`
    );
    const created: string[] = [];
    let remaining = input.amountPaisa;
    for (const payment of payments) {
      if (remaining <= 0n) break;
      const refundable = payment.amountPaisa - payment.refundedPaisa;
      const amount = remaining > refundable ? refundable : remaining;
      if (amount <= 0n) continue;
      const key = `${input.idempotencyKey}:${payment.id}`;
      const existing = await tx.$queryRaw<{ id: string; amountPaisa: bigint }[]>(Prisma.sql`SELECT id, amount_paisa as "amountPaisa" FROM refunds WHERE idempotency_key = ${key}`);
      if (existing[0] !== undefined) {
        created.push(existing[0].id);
        remaining -= existing[0].amountPaisa;
        continue;
      }
      const ledgerTransactionId = await this.ledger.post(tx, {
        type: 'REFUND',
        bookingId: input.bookingId,
        idempotencyKey: `refund:${key}`,
        memo: input.reasonCode,
        createdBy: input.requestedBy ?? null,
        lines: [
          { account: 'ESCROW', direction: 'DEBIT', amountPaisa: amount, bookingId: input.bookingId },
          { account: 'GATEWAY_CLEARING', direction: 'CREDIT', amountPaisa: amount }
        ]
      });
      const refunds = await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`INSERT INTO refunds(payment_id, booking_id, amount_paisa, reason_code, idempotency_key, ledger_transaction_id, requested_by)
          VALUES (${payment.id}::uuid, ${input.bookingId}::uuid, ${amount}, ${input.reasonCode}, ${key}, ${ledgerTransactionId}::uuid, ${input.requestedBy ?? null}::uuid) RETURNING id`
      );
      const refundId = refunds[0]?.id;
      if (refundId === undefined) throw new Error('Refund insert did not return a row');
      const fully = payment.refundedPaisa + amount >= payment.amountPaisa;
      await tx.$executeRaw(
        Prisma.sql`UPDATE payments SET refunded_paisa = refunded_paisa + ${amount}, status = ${fully ? 'REFUNDED' : 'PARTIALLY_REFUNDED'}::payment_status WHERE id = ${payment.id}::uuid`
      );
      await appendOutboxEvent(tx, { aggregate: 'refund', aggregateId: refundId, type: 'refund.queued', payload: { refundId, bookingId: input.bookingId, amountPaisa: amount.toString() } });
      created.push(refundId);
      remaining -= amount;
    }
    if (created.length > 0) {
      const state = await tx.$queryRaw<{ captured: bigint; refunded: bigint }[]>(
        Prisma.sql`SELECT coalesce(sum(amount_paisa), 0)::bigint as captured, coalesce(sum(refunded_paisa), 0)::bigint as refunded FROM payments WHERE booking_id = ${input.bookingId}::uuid AND purpose IN ('BOOKING','TOPUP') AND status IN ('CAPTURED','PARTIALLY_REFUNDED','REFUNDED')`
      );
      const fully = (state[0]?.refunded ?? 0n) >= (state[0]?.captured ?? 0n);
      await tx.$executeRaw(Prisma.sql`UPDATE bookings SET payment_status = ${fully ? 'REFUNDED' : 'PARTIALLY_REFUNDED'}::booking_payment_status WHERE id = ${input.bookingId}::uuid`);
    }
    return created;
  }

  /**
   * Goodwill or ruling after the job's money has already gone to the provider (a complaint outcome, FR-CP-06): the customer is refunded to their original
   * method and the *platform* bears it — D CUSTOMER_COMPENSATION / C GATEWAY_CLEARING — because there is no escrow left to draw on. Capped at what the payment
   * still has left to refund. Returns the refund ids to settle with the gateway once the transaction commits.
   */
  async compensate(tx: Prisma.TransactionClient, input: { bookingId: string; amountPaisa: bigint; reasonCode: string; reasonText?: string | undefined; idempotencyKey: string; requestedBy: string }): Promise<string[]> {
    const payments = await tx.$queryRaw<{ id: string; amountPaisa: bigint; refundedPaisa: bigint }[]>(
      Prisma.sql`SELECT id, amount_paisa as "amountPaisa", refunded_paisa as "refundedPaisa" FROM payments WHERE booking_id = ${input.bookingId}::uuid AND purpose IN ('BOOKING','TOPUP') AND status IN ('CAPTURED','PARTIALLY_REFUNDED') ORDER BY captured_at, id FOR UPDATE`
    );
    const available = payments.reduce((sum, payment) => sum + (payment.amountPaisa - payment.refundedPaisa), 0n);
    if (input.amountPaisa > available) throw new DomainError('CONFLICT', `Only ${available} paisa of this booking's payment can still be refunded`);
    const created: string[] = [];
    let remaining = input.amountPaisa;
    for (const payment of payments) {
      if (remaining <= 0n) break;
      const refundable = payment.amountPaisa - payment.refundedPaisa;
      const amount = remaining > refundable ? refundable : remaining;
      if (amount <= 0n) continue;
      const key = `${input.idempotencyKey}:${payment.id}`;
      const ledgerTransactionId = await this.ledger.post(tx, {
        type: 'REFUND', bookingId: input.bookingId, idempotencyKey: `refund:${key}`, memo: input.reasonCode, createdBy: input.requestedBy,
        lines: [
          { account: 'CUSTOMER_COMPENSATION', direction: 'DEBIT', amountPaisa: amount },
          { account: 'GATEWAY_CLEARING', direction: 'CREDIT', amountPaisa: amount }
        ]
      });
      const refunds = await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`INSERT INTO refunds(payment_id, booking_id, amount_paisa, reason_code, reason_text, idempotency_key, ledger_transaction_id, requested_by)
          VALUES (${payment.id}::uuid, ${input.bookingId}::uuid, ${amount}, ${input.reasonCode}, ${input.reasonText ?? null}, ${key}, ${ledgerTransactionId}::uuid, ${input.requestedBy}::uuid) RETURNING id`
      );
      const refundId = refunds[0]?.id;
      if (refundId === undefined) throw new Error('Refund insert did not return a row');
      const fully = payment.refundedPaisa + amount >= payment.amountPaisa;
      await tx.$executeRaw(Prisma.sql`UPDATE payments SET refunded_paisa = refunded_paisa + ${amount}, status = ${fully ? 'REFUNDED' : 'PARTIALLY_REFUNDED'}::payment_status WHERE id = ${payment.id}::uuid`);
      await appendOutboxEvent(tx, { aggregate: 'refund', aggregateId: refundId, type: 'refund.queued', payload: { refundId, bookingId: input.bookingId, amountPaisa: amount.toString() } });
      created.push(refundId);
      remaining -= amount;
    }
    return created;
  }

  /** Tells the gateway about a queued refund. Safe to retry: the gateway call carries the refund's idempotency key. */
  async settleRefund(refundId: string): Promise<void> {
    const rows = await this.prisma.$queryRaw<{ gatewayRef: string | null; amountPaisa: bigint; reason: string; key: string; status: string }[]>(
      Prisma.sql`SELECT p.gateway_ref as "gatewayRef", r.amount_paisa as "amountPaisa", r.reason_code as reason, r.idempotency_key as key, r.status
        FROM refunds r JOIN payments p ON p.id = r.payment_id WHERE r.id = ${refundId}::uuid`
    );
    const refund = rows[0];
    if (refund === undefined) throw notFound('Refund');
    if (refund.status !== 'PENDING') return;
    if (refund.gatewayRef === null) throw new DomainError('ADAPTER_UNAVAILABLE', 'The payment has no gateway reference to refund against');
    const result = await this.gateway.refund({ providerRef: refund.gatewayRef, amount: refund.amountPaisa, reason: refund.reason, idempotencyKey: refund.key });
    await this.prisma.$executeRaw(
      Prisma.sql`UPDATE refunds SET status = ${result.status}::refund_status, gateway_refund_ref = ${result.refundRef}, completed_at = CASE WHEN ${result.status} = 'PENDING' THEN NULL ELSE now() END WHERE id = ${refundId}::uuid`
    );
  }
}
