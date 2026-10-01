// apps/api/src/payment/release.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { commissionOnPaisa } from '@smart-home/domain';
import { PrismaService } from '../database/prisma.service.js';
import { DebtService } from './debt.service.js';
import { LedgerService } from './ledger.service.js';
import { PaymentsService } from './payments.service.js';

export type ReleaseFacts = {
  bookingId: string;
  providerId: string;
  /** What the customer owes for the job: the invoice total, after any coupon. */
  finalPaisa: bigint;
  /** The coupon the platform absorbs (bookings.discount_paisa). The provider is still paid on the price before it. */
  discountPaisa: bigint;
  commissionRateBp: number;
  paymentMode: 'CASH' | 'ONLINE';
};

export type ReleaseResult = { grossPaisa: bigint; commissionPaisa: bigint; providerPaisa: bigint; refundIds: string[] };

/**
 * FR-PY-03 / FR-PY-06 / TRD §6.3: the only code that moves a job's money to the provider. It is called from exactly two
 * places — a release-permitting verification outcome (or the auto-release rule), and the provider confirming cash — and the
 * `bookings_status_guard` trigger independently refuses to mark a booking PAYMENT_RELEASED without one of those, so there is no
 * other road to a payout. Commission is `round_half_up(gross × rate)` with the rate snapshotted on the booking at checkout.
 */
@Injectable()
export class ReleaseService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LedgerService) private readonly ledger: LedgerService,
    @Inject(PaymentsService) private readonly payments: PaymentsService,
    @Inject(DebtService) private readonly debt: DebtService
  ) {}

  /**
   * A dispute ruling that pays the provider for part of the job (T24). `amountPaisa` of the escrow goes to the provider on the same terms as a full
   * release — commission on their price, the coupon's platform-absorbed share credited — pro-rated to the part released. Returns what was paid.
   * D ESCROW amount · D PROMO_EXPENSE share · C PROVIDER_WALLET (gross − commission) · C PLATFORM_COMMISSION commission
   */
  async releasePartOnline(tx: Prisma.TransactionClient, facts: ReleaseFacts, amountPaisa: bigint, actorUserId: string | null): Promise<{ grossPaisa: bigint; commissionPaisa: bigint; providerPaisa: bigint }> {
    if (amountPaisa <= 0n) return { grossPaisa: 0n, commissionPaisa: 0n, providerPaisa: 0n };
    const couponShare = facts.finalPaisa > 0n ? (facts.discountPaisa * amountPaisa) / facts.finalPaisa : 0n;
    const gross = amountPaisa + couponShare;
    const commission = commissionOnPaisa(gross, BigInt(facts.commissionRateBp));
    const provider = gross - commission;
    await this.ledger.post(tx, {
      type: 'RELEASE', bookingId: facts.bookingId, idempotencyKey: `release-dispute:${facts.bookingId}`, memo: 'Disputed job: part released to provider', createdBy: actorUserId,
      lines: [
        { account: 'ESCROW', direction: 'DEBIT', amountPaisa, bookingId: facts.bookingId },
        ...(couponShare > 0n ? [{ account: 'PROMO_EXPENSE' as const, direction: 'DEBIT' as const, amountPaisa: couponShare }] : []),
        { account: 'PROVIDER_WALLET', direction: 'CREDIT', amountPaisa: provider, ownerUserId: facts.providerId },
        ...(commission > 0n ? [{ account: 'PLATFORM_COMMISSION' as const, direction: 'CREDIT' as const, amountPaisa: commission }] : [])
      ]
    });
    await this.debt.refreshBlock(tx, facts.providerId);
    return { grossPaisa: gross, commissionPaisa: commission, providerPaisa: provider };
  }

  /**
   * A cash job has no escrow, so a ruling that the customer is owed money is settled between the platform and the provider: the provider's wallet
   * pays into CUSTOMER_COMPENSATION (a debt to the provider if it goes negative), and finance pays the customer from there. D PROVIDER_WALLET / C CUSTOMER_COMPENSATION
   */
  async compensateFromProvider(tx: Prisma.TransactionClient, bookingId: string, providerId: string, amountPaisa: bigint, actorUserId: string | null): Promise<void> {
    if (amountPaisa <= 0n) return;
    await this.ledger.post(tx, {
      type: 'ADJUSTMENT', bookingId, idempotencyKey: `dispute-compensation:${bookingId}`, memo: 'Disputed cash job: provider owes the customer', createdBy: actorUserId,
      lines: [
        { account: 'PROVIDER_WALLET', direction: 'DEBIT', amountPaisa, ownerUserId: providerId },
        { account: 'CUSTOMER_COMPENSATION', direction: 'CREDIT', amountPaisa }
      ]
    });
    await this.debt.refreshBlock(tx, providerId);
  }

  /** Marks a booking's money as settled: stamps the release time and starts the warranty clock. */
  async settleStatus(tx: Prisma.TransactionClient, bookingId: string, paymentStatus: 'RELEASED' | 'CASH_SETTLED'): Promise<void> {
    await this.markReleased(tx, bookingId, paymentStatus);
  }

  private split(facts: ReleaseFacts): { gross: bigint; commission: bigint; provider: bigint } {
    // The provider's price before the coupon; the coupon is the platform's cost, not a cut to the provider.
    const gross = facts.finalPaisa + facts.discountPaisa;
    const commission = commissionOnPaisa(gross, BigInt(facts.commissionRateBp));
    return { gross, commission, provider: gross - commission };
  }

  /**
   * Online: escrow pays the provider (less commission), the platform absorbs the coupon as promo expense, and any escrow the
   * final amount did not need (the provider charged less than approved) goes back to the customer.
   * D ESCROW final · D PROMO_EXPENSE coupon · C PROVIDER_WALLET (gross − commission) · C PLATFORM_COMMISSION commission
   */
  async releaseOnline(tx: Prisma.TransactionClient, facts: ReleaseFacts, actorUserId: string | null): Promise<ReleaseResult> {
    const { gross, commission, provider } = this.split(facts);
    const escrowRows = await tx.$queryRaw<{ balance: bigint | null }[]>(
      Prisma.sql`SELECT b.balance FROM ledger_accounts a LEFT JOIN account_balances b ON b.account_id = a.id WHERE a.type = 'ESCROW' AND a.booking_id = ${facts.bookingId}::uuid FOR UPDATE OF a`
    );
    const escrow = escrowRows[0]?.balance ?? 0n;
    if (escrow < facts.finalPaisa) throw new Error(`Escrow (${escrow}) does not cover the final amount (${facts.finalPaisa}) for booking ${facts.bookingId}`);

    const lines = [
      { account: 'ESCROW' as const, direction: 'DEBIT' as const, amountPaisa: facts.finalPaisa, bookingId: facts.bookingId },
      ...(facts.discountPaisa > 0n ? [{ account: 'PROMO_EXPENSE' as const, direction: 'DEBIT' as const, amountPaisa: facts.discountPaisa }] : []),
      { account: 'PROVIDER_WALLET' as const, direction: 'CREDIT' as const, amountPaisa: provider, ownerUserId: facts.providerId },
      ...(commission > 0n ? [{ account: 'PLATFORM_COMMISSION' as const, direction: 'CREDIT' as const, amountPaisa: commission }] : [])
    ];
    await this.ledger.post(tx, { type: 'RELEASE', bookingId: facts.bookingId, idempotencyKey: `release:${facts.bookingId}`, memo: 'Escrow released to provider', createdBy: actorUserId, lines });

    const excess = escrow - facts.finalPaisa;
    const refundIds = excess > 0n ? await this.payments.queueRefund(tx, { bookingId: facts.bookingId, amountPaisa: excess, reasonCode: 'EXCESS_ESCROW', idempotencyKey: `release-excess:${facts.bookingId}`, requestedBy: actorUserId }) : [];

    await this.markReleased(tx, facts.bookingId, 'RELEASED');
    await this.debt.refreshBlock(tx, facts.providerId);
    return { grossPaisa: gross, commissionPaisa: commission, providerPaisa: provider, refundIds };
  }

  /**
   * Cash: the customer paid the provider directly, so there is no escrow to release. The platform's books catch up: the
   * provider owes the commission (their wallet goes down — negative is debt, FR-PY-05) and is owed any coupon the platform absorbed.
   * D PROVIDER_WALLET commission · C PLATFORM_COMMISSION commission, and D PROMO_EXPENSE coupon · C PROVIDER_WALLET coupon
   */
  async settleCash(tx: Prisma.TransactionClient, facts: ReleaseFacts, actorUserId: string | null): Promise<ReleaseResult> {
    const { gross, commission, provider } = this.split(facts);
    const lines = [
      ...(commission > 0n
        ? [
            { account: 'PROVIDER_WALLET' as const, direction: 'DEBIT' as const, amountPaisa: commission, ownerUserId: facts.providerId },
            { account: 'PLATFORM_COMMISSION' as const, direction: 'CREDIT' as const, amountPaisa: commission }
          ]
        : []),
      ...(facts.discountPaisa > 0n
        ? [
            { account: 'PROMO_EXPENSE' as const, direction: 'DEBIT' as const, amountPaisa: facts.discountPaisa },
            { account: 'PROVIDER_WALLET' as const, direction: 'CREDIT' as const, amountPaisa: facts.discountPaisa, ownerUserId: facts.providerId }
          ]
        : [])
    ];
    if (lines.length >= 2) await this.ledger.post(tx, { type: 'CASH_SETTLEMENT', bookingId: facts.bookingId, idempotencyKey: `cash-settlement:${facts.bookingId}`, memo: 'Commission on a cash job', createdBy: actorUserId, lines });
    await this.markReleased(tx, facts.bookingId, 'CASH_SETTLED');
    await this.debt.refreshBlock(tx, facts.providerId);
    return { grossPaisa: gross, commissionPaisa: commission, providerPaisa: provider, refundIds: [] };
  }

  private async markReleased(tx: Prisma.TransactionClient, bookingId: string, paymentStatus: 'RELEASED' | 'CASH_SETTLED'): Promise<void> {
    await tx.$executeRaw(
      Prisma.sql`UPDATE bookings b SET payment_status = ${paymentStatus}::booking_payment_status, released_at = now(),
          warranty_until = CASE WHEN s.warranty_days > 0 THEN now() + make_interval(days => s.warranty_days) ELSE NULL END
        FROM services s WHERE b.id = ${bookingId}::uuid AND s.id = b.service_id`
    );
  }
}
