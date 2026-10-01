import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { IdempotencyInterceptor } from './common/idempotency.interceptor.js';
import { IdempotencyModule } from './common/idempotency.service.js';
import { PolicyGuard } from './common/policy.guard.js';
import { ProblemDetailsFilter } from './common/problem-details.filter.js';
import { NotificationModule } from './notification/notification.module.js';
import { PaymentModule } from './payment/payment.module.js';
import { BookingModule } from './booking/booking.module.js';
import { CatalogueModule } from './catalogue/catalogue.module.js';
import { CustomerModule } from './customer/customer.module.js';
import { EnvironmentModule } from './config/environment.module.js';
import { PrismaModule } from './database/prisma.service.js';
import { RedisModule } from './database/redis.module.js';
import { HealthController } from './health/health.controller.js';
import { IdentityModule } from './identity/identity.module.js';
import { IntegrationsModule } from './integrations/integrations.module.js';
import { PlatformModule } from './platform/platform.module.js';
import { PlacesModule } from './places/places.module.js';
import { ProviderModule } from './provider/provider.module.js';
import { QueueModule } from './queues/queue.registry.js';
import { ComplaintsModule } from './complaints/complaints.module.js';
import { ConductModule } from './conduct/conduct.module.js';
import { ReputationModule } from './reputation/reputation.module.js';
import { VerificationModule } from './verification/verification.module.js';
import { SearchModule } from './search/search.module.js';

@Module({
  imports: [EnvironmentModule, PrismaModule, RedisModule, QueueModule, IntegrationsModule, PlatformModule, PaymentModule, NotificationModule, IdempotencyModule, IdentityModule, CatalogueModule, PlacesModule, CustomerModule, ProviderModule, SearchModule, BookingModule, VerificationModule, ReputationModule, ConductModule, ComplaintsModule],
  controllers: [HealthController],
  providers: [
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
    { provide: APP_GUARD, useClass: PolicyGuard },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor }
  ]
})
export class AppModule {}
