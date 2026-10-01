// apps/api/src/notification/notification.module.ts
import { Global, Module } from '@nestjs/common';
import { NotificationCentreService } from './notification-centre.service.js';
import { NotificationController } from './notification.controller.js';
import { NotificationService } from './notification.service.js';
import { ReminderService } from './reminder.service.js';
import { TemplateService } from './template.service.js';

@Global()
@Module({
  controllers: [NotificationController],
  providers: [NotificationService, NotificationCentreService, TemplateService, ReminderService],
  exports: [NotificationService, NotificationCentreService, TemplateService, ReminderService]
})
export class NotificationModule {}
