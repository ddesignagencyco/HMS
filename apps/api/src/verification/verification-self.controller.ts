// apps/api/src/verification/verification-self.controller.ts
import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, PolicyDecorator, type AuthenticatedPrincipal } from '../common/policy.js';
import { ApiZodBody } from '../common/swagger.js';
import { parseWith } from '../common/validation.js';
import { selfVerifySchema } from './verification.schemas.js';
import { VerificationSelfService } from './verification-self.service.js';

const CUSTOMER = { roles: ['CUSTOMER'] } as const;

/**
 * FR-VC-16, and the reason this exists: a customer whose verification agent never called had no way to
 * finish their own job. The 72-hour auto-release was the only exit, it released the money without ever
 * asking them, and it published no rating â€” so the job was settled and the customer's opinion of the work
 * was silently discarded. This is the exit that was missing, and it needs no token and no OTP because
 * the customer is already signed in.
 */
@ApiTags('verification')
@ApiBearerAuth('access-token')
@Controller('bookings/:bookingId/verification')
export class VerificationSelfController {
  constructor(@Inject(VerificationSelfService) private readonly self: VerificationSelfService) {}

  @Get('confirmation')
  @PolicyDecorator(CUSTOMER)
  @ApiOperation({
    summary: 'Open the "confirm the work" form (customer)',
    description:
      'Everything the form needs to render, plus `canSubmit` and, when it is false, a `blockedReason` written for the customer to read. Always 200 for your own booking â€” the form being unavailable is an answer, not an error, and a client handed only a status code has nothing to show. 404 for a booking that is not yours.'
  })
  async describe(@Param('bookingId', ParseUUIDPipe) bookingId: string, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.self.describe(bookingId, principal.userId);
  }

  @Post('confirmation')
  @HttpCode(200)
  @PolicyDecorator(CUSTOMER)
  @ApiOperation({
    summary: 'Confirm the work and rate the provider (customer)',
    description:
      "Closes the verification yourself: rate the provider on quality, punctuality, conduct and cleanliness, and say whether the job was done. `SATISFIED` releases the payment and publishes the rating; `WITH_ISSUE` releases it too but opens a quality complaint and flags the provider. Either way the release is yours to make â€” this is your money, already paid and held. For a cash job the form authorises the handover and the provider then confirms they were paid (`canConfirmCashReceived` on the booking). `NOT_ACCEPTABLE`, or saying no work was done, or saying money was demanded beyond the agreed price, releases nothing and puts the case in front of a person at the top of the queue instead; the booking stays AWAITING_VERIFICATION. 409 when the form is not currently available â€” an agent is mid-call, or the job is already settled â€” with the reason in `detail`; 422 when the answers contradict the outcome."
  })
  @ApiZodBody(selfVerifySchema, {
    default: {
      summary: 'Everything was fine',
      value: { workCompleted: 'FULL', quality: 5, punctuality: 5, conduct: 5, cleanliness: 4, extraChargeDemanded: false, consentToRelease: true, outcome: 'SATISFIED', remark: 'Fixed it first time, very tidy.' }
    }
  })
  async confirm(@Param('bookingId', ParseUUIDPipe) bookingId: string, @Body() body: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.self.submit(bookingId, principal.userId, parseWith(selfVerifySchema, body));
  }
}
