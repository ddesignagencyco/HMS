// apps/api/src/provider/provider.module.ts
import { Module } from '@nestjs/common';
import { AvailabilityService } from './availability.service.js';
import { ProfileService } from './profile.service.js';
import { ProviderApprovalAdminController } from './provider-approval-admin.controller.js';
import { ProviderApprovalService } from './provider-approval.service.js';
import { ProviderDocumentsAdminController } from './provider-documents-admin.controller.js';
import { ProviderDocumentsController } from './provider-documents.controller.js';
import { ProviderDocumentsService } from './provider-documents.service.js';
import { ProviderController } from './provider.controller.js';
import { ServiceAreasService } from './service-areas.service.js';
import { TimeOffService } from './time-off.service.js';
import { UploadsController } from './uploads.controller.js';

@Module({
  controllers: [ProviderController, ProviderApprovalAdminController, ProviderDocumentsController, ProviderDocumentsAdminController, UploadsController],
  providers: [ProfileService, AvailabilityService, TimeOffService, ServiceAreasService, ProviderApprovalService, ProviderDocumentsService]
})
export class ProviderModule {}
