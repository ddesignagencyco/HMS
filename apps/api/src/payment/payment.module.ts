// apps/api/src/payment/payment.module.ts
import { Global, Module } from '@nestjs/common';
import { LedgerService } from './ledger.service.js';
import { DevPaymentsController } from './dev-payments.controller.js';
import { ProviderMoneyController } from './provider-money.controller.js';
import { ProviderMoneyService } from './provider-money.service.js';
import { FinanceController } from './finance.controller.js';
import { FinanceService } from './finance.service.js';
import { PayoutsService } from './payouts.service.js';
import { ProviderPayoutsController } from './provider-payouts.controller.js';
import { ReconciliationService } from './reconciliation.service.js';
import { DebtService } from './debt.service.js';
import { ReleaseService } from './release.service.js';
import { PaymentsService } from './payments.service.js';

@Global()
@Module({
  controllers: [DevPaymentsController, ProviderMoneyController, ProviderPayoutsController, FinanceController],
  providers: [LedgerService, PaymentsService, ReleaseService, DebtService, ProviderMoneyService, FinanceService, PayoutsService, ReconciliationService],
  exports: [LedgerService, PaymentsService, ReleaseService, DebtService, PayoutsService, ReconciliationService]
})
export class PaymentModule {}
