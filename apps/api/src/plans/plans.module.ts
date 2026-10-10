import { Module, OnModuleInit, Inject } from '@nestjs/common';
import { BookingModule } from '../booking/booking.module.js';
import { PaymentModule } from '../payment/payment.module.js';
import { QueueRegistry } from '../queues/queue.registry.js';
import { PlansAdminController } from './plans-admin.controller.js';
import { PlansController } from './plans.controller.js';
import { PlanSchedulerService } from './plans-scheduler.service.js';
import { PlansService } from './plans.service.js';
import { SubscriptionsController } from './subscriptions.controller.js';

@Module({
  imports: [PaymentModule, BookingModule],
  controllers: [PlansController, SubscriptionsController, PlansAdminController],
  providers: [PlansService, PlanSchedulerService],
  exports: [PlansService, PlanSchedulerService]
})
export class PlansModule implements OnModuleInit {
  constructor(
    @Inject(QueueRegistry) private readonly queues: QueueRegistry,
    @Inject(PlanSchedulerService) private readonly scheduler: PlanSchedulerService
  ) {}

  onModuleInit(): void {
    // Registers the handler for repeatable scheduler tick
    this.queues.registerScheduled('plans.schedule-visits', async () => {
      await this.scheduler.scheduleDueVisits(7);
    });
  }
}
