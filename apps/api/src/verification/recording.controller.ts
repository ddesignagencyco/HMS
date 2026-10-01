// apps/api/src/verification/recording.controller.ts
import { Controller, Get, Inject, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, PolicyDecorator, type AuthenticatedPrincipal } from '../common/policy.js';
import { RecordingService } from './recording.service.js';

@ApiTags('verification')
@ApiBearerAuth('access-token')
@Controller('finance/recordings')
export class RecordingController {
  constructor(@Inject(RecordingService) private readonly recordings: RecordingService) {}

  @Get(':attemptId')
  @PolicyDecorator({ roles: ['FINANCE', 'ADMIN'], totpRequired: true })
  @ApiOperation({
    summary: 'Play a call recording',
    description:
      'Finance and admin only — agents cannot play recordings, even their own (403). Returns a short-lived signed link to the recording of one call attempt, and records who asked in the audit log. 404 if the attempt had no recording or it has passed its retention period and been deleted.'
  })
  async play(@Param('attemptId', ParseUUIDPipe) attemptId: string, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    const role = principal.roles.includes('FINANCE') ? 'FINANCE' : 'ADMIN';
    return this.recordings.access(attemptId, { userId: principal.userId, role });
  }
}
