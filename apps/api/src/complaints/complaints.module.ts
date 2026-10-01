// apps/api/src/complaints/complaints.module.ts
import { Module } from '@nestjs/common';
import { BookingModule } from '../booking/booking.module.js';
import { VerificationModule } from '../verification/verification.module.js';
import { ComplaintsController } from './complaints.controller.js';
import { ComplaintsService } from './complaints.service.js';
import { DisputesController } from './disputes.controller.js';
import { DisputesService } from './disputes.service.js';

@Module({
  imports: [BookingModule, VerificationModule],
  controllers: [ComplaintsController, DisputesController],
  providers: [ComplaintsService, DisputesService],
  exports: [ComplaintsService, DisputesService]
})
export class ComplaintsModule {}
