import { Global, Module } from '@nestjs/common';
import { AppClock } from './app-clock.js';
import { AuditService } from './audit.service.js';
import { OutboxDispatcher } from './outbox.dispatcher.js';
import { PaymentWebhookController } from './payment-webhook.controller.js';
import { SettingsController } from './settings.controller.js';
import { SettingsService } from './settings.service.js';

@Global()
@Module({
  controllers: [SettingsController, PaymentWebhookController],
  providers: [SettingsService, AuditService, OutboxDispatcher, AppClock],
  exports: [SettingsService, AuditService, OutboxDispatcher, AppClock]
})
export class PlatformModule {}
