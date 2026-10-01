// apps/api/src/verification/verification.controller.ts
import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, PolicyDecorator, type AuthenticatedPrincipal } from '../common/policy.js';
import { ApiZodBody } from '../common/swagger.js';
import { parseWith } from '../common/validation.js';
import { attemptSchema, callSchema, claimSchema, submitSchema } from './verification.schemas.js';
import { VerificationConsoleService } from './verification-console.service.js';
import { VerificationQueueService } from './verification-queue.service.js';
import { VerificationSubmitService } from './verification-submit.service.js';

const AGENT = { roles: ['AGENT'], totpRequired: true } as const;

@ApiTags('verification')
@ApiBearerAuth('access-token')
@Controller('agent')
export class VerificationController {
  constructor(
    @Inject(VerificationQueueService) private readonly queue: VerificationQueueService,
    @Inject(VerificationConsoleService) private readonly console: VerificationConsoleService,
    @Inject(VerificationSubmitService) private readonly submitter: VerificationSubmitService
  ) {}

  @Get('queue')
  @PolicyDecorator(AGENT)
  @ApiOperation({
    summary: 'See the verification queue',
    description:
      "Tier A calls waiting to be made or already claimed, in the order to work them: the call you hold first, then cash jobs (15-minute SLA), then by SLA deadline. `slaRemainingMinutes` counts only calling hours (08:00–22:00 Pakistan time) and goes negative once the SLA is breached."
  })
  async list(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return { items: await this.queue.list(principal.userId) };
  }

  @Post('queue/claim')
  @HttpCode(200)
  @PolicyDecorator(AGENT)
  @ApiOperation({
    summary: 'Claim the next call',
    description:
      "Locks a call to you so nobody else can work it. Leave `verificationId` out to take the best available one, or name the one you picked from the queue (409 if someone else got there first). You can hold one call at a time — claiming again returns the one you hold. 423 outside calling hours; 403 CONFLICT_OF_INTEREST if you are linked to the job (same person, phone, email, or a declared conflict). An unused claim expires on its own after `verification.lock_timeout_min`. Returns `{ item: null }` when nothing is waiting."
  })
  @ApiZodBody(claimSchema, { default: { summary: 'Take the best available call', value: {} } })
  async claim(@Body() body: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    const { verificationId } = parseWith(claimSchema, body ?? {});
    return { item: await this.queue.claim(principal.userId, verificationId) };
  }

  @Post('verifications/:id/release-lock')
  @HttpCode(200)
  @PolicyDecorator(AGENT)
  @ApiOperation({ summary: 'Put a claimed call back', description: 'Gives up your claim so another agent can take the call. Only the agent holding it can do this.' })
  async releaseLock(@Param('id', ParseUUIDPipe) id: string, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.queue.releaseLock(principal.userId, id);
  }

  @Get('verifications/:id')
  @PolicyDecorator(AGENT)
  @ApiOperation({
    summary: 'Open the console for a call you hold',
    description:
      "Everything needed on one screen: the booking and invoice, before/after photos and the checklist, how long the provider was on site, the provider's history (verified jobs, rating, open complaints, flags, demerits), this call's earlier attempts, the consent line to read, and the fixed questionnaire. 404 unless you hold this call."
  })
  async open(@Param('id', ParseUUIDPipe) id: string, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.console.console(principal.userId, id);
  }

  @Post('verifications/:id/call')
  @HttpCode(200)
  @PolicyDecorator(AGENT)
  @ApiOperation({
    summary: 'Call the customer',
    description: "Click-to-call: pass your `agentEndpoint` and the telephony service rings you and bridges the customer, recording the call. Leave it out to dial by hand — you get the customer's number instead. Either way, log the outcome with `POST .../attempts`."
  })
  @ApiZodBody(callSchema, { default: { summary: 'Bridge to my desk phone', value: { agentEndpoint: '+923001112233' } } })
  async call(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.console.call(principal.userId, id, parseWith(callSchema, body ?? {}).agentEndpoint);
  }

  @Get('verifications/:id/attempts')
  @PolicyDecorator(AGENT)
  @ApiOperation({ summary: 'List the call attempts so far', description: 'Every attempt on this call, oldest first: time, band, duration and result.' })
  async attempts(@Param('id', ParseUUIDPipe) id: string, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return { items: await this.console.listAttempts(principal.userId, id) };
  }

  @Post('verifications/:id/attempts')
  @PolicyDecorator(AGENT)
  @ApiOperation({
    summary: 'Log a call attempt',
    description:
      "Records one attempt, never editable afterwards. An unanswered attempt returns the call to the queue for a different time band (08–12, 12–17, 17–22); after three unanswered attempts across at least two bands the customer is sent the one-tap verification link and the call waits for their answer or the 72-hour auto-release. An answered attempt keeps the call with you so you can submit."
  })
  @ApiZodBody(attemptSchema, { default: { summary: 'Customer did not pick up', value: { result: 'NO_ANSWER', durationSeconds: 25 } } })
  async logAttempt(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.console.logAttempt(principal.userId, id, parseWith(attemptSchema, body));
  }

  @Post('verifications/:id/submit')
  @HttpCode(200)
  @PolicyDecorator(AGENT)
  @ApiOperation({
    summary: 'Submit the verification',
    description:
      "Records the fixed questionnaire and the outcome, permanently. 422 if the consent line was not read, or the outcome is not one the answers allow (an extra charge demanded, or no work done, allows only DISPUTED). VERIFIED_* releases the money (online) or authorises the provider to collect (cash), publishes the rating and remark, and — for VERIFIED_WITH_ISSUE — opens a complaint and flags the provider. REWORK_REQUIRED holds the funds and sends the provider back (a second failure is a dispute). DISPUTED freezes the funds for the admin queue. It all happens in one transaction."
  })
  @ApiZodBody(submitSchema, {
    default: {
      summary: 'A satisfied customer',
      value: { workCompleted: 'FULL', quality: 5, punctuality: 4, conduct: 5, cleanliness: 4, extraChargeDemanded: false, uniformWorn: true, ownTools: true, consentLineRead: true, consentToRelease: true, outcome: 'VERIFIED_SATISFIED', remark: 'Fixed the leak, tidy work.' }
    }
  })
  async submit(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.submitter.submit(principal.userId, id, parseWith(submitSchema, body));
  }
}
