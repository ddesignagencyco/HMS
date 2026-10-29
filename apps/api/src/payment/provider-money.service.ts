// apps/api/src/payment/provider-money.service.ts
import { pick, rupees, type Locale } from '../common/locale.js';
import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { paisaToNumber } from '@smart-home/domain';
import { badRequest } from '../common/domain-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { SettingsService } from '../platform/settings.service.js';
import { DebtService } from './debt.service.js';
import { PaymentsService } from './payments.service.js';

/** A provider's own view of their money and the ways to act on it. */
@Injectable()
export class ProviderMoneyService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(DebtService) private readonly debt: DebtService,
    @Inject(PaymentsService) private readonly payments: PaymentsService,
    @Inject(SettingsService) private readonly settings: SettingsService
  ) {}

  async wallet(providerId: string) {
    const wallet = await this.debt.wallet(this.prisma, providerId);
    return {
      balancePaisa: paisaToNumber(wallet.balancePaisa),
      debtPaisa: paisaToNumber(wallet.debtPaisa),
      debtCeilingPaisa: paisaToNumber(wallet.ceilingPaisa),
      offersBlocked: wallet.offerBlockedReason !== null,
      offerBlockedReason: wallet.offerBlockedReason,
      // BE-020: the admin setting, so the payout screen can say "minimum Rs X" before a request is refused.
      minPayoutPaisa: await this.settings.getNumber('payout.min_amount_paisa')
    };
  }

  /**
   * FR-PY-13: clear commission debt online. Defaults to the whole debt; a smaller amount is fine (it may be enough to get under the ceiling), a
   * larger one is refused — there is nothing to overpay into. The wallet and the offer block change only when the gateway confirms the payment.
   */
  async payDebt(providerId: string, amountPaisa: number | undefined, locale: Locale = 'en'): Promise<{ paymentId: string; redirectUrl: string; amountPaisa: number }> {
    const wallet = await this.debt.wallet(this.prisma, providerId);
    if (wallet.debtPaisa <= 0n) throw badRequest(pick(locale, { en: 'You have no commission debt to pay', ur: 'آپ کے ذمے کمیشن کا کوئی بقایا نہیں ہے' }));
    const amount = amountPaisa === undefined ? wallet.debtPaisa : BigInt(amountPaisa);
    if (amount <= 0n || amount > wallet.debtPaisa) throw badRequest(pick(locale, { en: `Pay between ${rupees(1)} and your debt of ${rupees(wallet.debtPaisa)}`, ur: `${rupees(1, 'ur')} سے لے کر اپنے بقایا ${rupees(wallet.debtPaisa, 'ur')} تک ادا کریں` }));
    const paymentId = await this.prisma.$transaction(tx => this.payments.createPayment(tx, { bookingId: null, payerUserId: providerId, amountPaisa: amount, purpose: 'DEBT', keySuffix: randomUUID() }));
    const checkout = await this.payments.startCheckout(paymentId, { userId: providerId }, '/provider/wallet');
    return { ...checkout, amountPaisa: paisaToNumber(amount) };
  }
}
