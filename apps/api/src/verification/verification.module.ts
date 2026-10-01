// apps/api/src/verification/verification.module.ts
import { Module } from '@nestjs/common';
import { BookingModule } from '../booking/booking.module.js';
import { RecordingController } from './recording.controller.js';
import { RecordingService } from './recording.service.js';
import { VerificationLinkController } from './verification-link.controller.js';
import { VerificationLinkService } from './verification-link.service.js';
import { VerificationConsoleService } from './verification-console.service.js';
import { VerificationController } from './verification.controller.js';
import { VerificationOutcomeService } from './verification-outcome.service.js';
import { VerificationQueueService } from './verification-queue.service.js';
import { VerificationSubmitService } from './verification-submit.service.js';
import { VerificationSweepsService } from './verification-sweeps.service.js';

@Module({
  imports: [BookingModule],
  controllers: [VerificationController, VerificationLinkController, RecordingController],
  providers: [VerificationQueueService, VerificationConsoleService, VerificationOutcomeService, VerificationSubmitService, VerificationSweepsService, VerificationLinkService, RecordingService],
  exports: [VerificationQueueService, VerificationOutcomeService, VerificationSweepsService, VerificationLinkService]
})
export class VerificationModule {}
