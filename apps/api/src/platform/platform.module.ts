import { Global, Module } from '@nestjs/common';
import { AppClock } from './app-clock.js';
import { AuditService } from './audit.service.js';
import { OutboxDispatcher } from './outbox.dispatcher.js';
import { PaymentWebhookController } from './payment-webhook.controller.js';
import { SettingsController } from './settings.controller.js';
import { MetricsService } from './metrics.service.js';
import { MetricsController } from '../health/metrics.controller.js';
import { SettingsService } from './settings.service.js';

@Global()
@Module({
  controllers: [SettingsController, PaymentWebhookController, MetricsController],
  providers: [SettingsService, AuditService, OutboxDispatcher, AppClock, MetricsService],
  exports: [SettingsService, AuditService, OutboxDispatcher, AppClock, MetricsService]
})
export class PlatformModule {}
