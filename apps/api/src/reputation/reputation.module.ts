// apps/api/src/reputation/reputation.module.ts
import { Global, Module } from '@nestjs/common';
import { ReputationController } from './reputation.controller.js';
import { ReputationService } from './reputation.service.js';

@Global()
@Module({ controllers: [ReputationController], providers: [ReputationService], exports: [ReputationService] })
export class ReputationModule {}
