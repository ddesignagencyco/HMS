// apps/api/src/conduct/conduct.module.ts
import { Global, Module } from '@nestjs/common';
import { ConductController } from './conduct.controller.js';
import { ConductJobsService } from './conduct-jobs.service.js';
import { ConductService } from './conduct.service.js';

@Global()
@Module({ controllers: [ConductController], providers: [ConductService, ConductJobsService], exports: [ConductService, ConductJobsService] })
export class ConductModule {}
