// apps/api/src/booking/booking.module.ts
import { Module } from '@nestjs/common';
import { BookingController } from './booking.controller.js';
import { BookingJobs } from './booking.jobs.js';
import { BookingService } from './booking.service.js';
import { BookingStateService } from './booking-state.service.js';
import { CompletionService } from './completion.service.js';
import { ExecutionService } from './execution.service.js';
import { MessageController } from './message.controller.js';
import { MessageService } from './message.service.js';
import { OfferService } from './offer.service.js';
import { ProviderOffersController } from './provider-offers.controller.js';
import { TierRandom, TierRoutingService } from './tier-routing.service.js';
import { PricingService } from './pricing.service.js';

@Module({
  controllers: [ProviderOffersController, MessageController, BookingController],
  providers: [BookingService, BookingStateService, OfferService, PricingService, ExecutionService, CompletionService, MessageService, TierRoutingService, TierRandom, BookingJobs],
  exports: [BookingService, BookingStateService, OfferService]
})
export class BookingModule {}
