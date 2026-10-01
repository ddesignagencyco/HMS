// apps/api/src/booking/provider-offers.controller.ts
import { Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, PolicyDecorator, type AuthenticatedPrincipal } from '../common/policy.js';
import { BookingService } from './booking.service.js';
import { OfferService } from './offer.service.js';

@ApiTags('booking')
@ApiBearerAuth('access-token')
@Controller('provider/offers')
export class ProviderOffersController {
  constructor(
    @Inject(OfferService) private readonly offers: OfferService,
    @Inject(BookingService) private readonly bookings: BookingService
  ) {}

  @Get()
  @PolicyDecorator({ roles: ['PROVIDER'] })
  @ApiOperation({
    summary: 'List the jobs currently offered to me',
    description: 'Returns every open offer made to you whose deadline has not passed, soonest deadline first. Silence past the deadline forfeits the offer and the job moves to the next provider.'
  })
  async list(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return { items: await this.offers.listForProvider(principal.userId) };
  }

  @Post(':id/accept')
  @HttpCode(200)
  @PolicyDecorator({ roles: ['PROVIDER'] })
  @ApiOperation({
    summary: 'Accept an offered job',
    description: 'Takes the job: the booking is scheduled to you and the customer is sent their start code. 409 ILLEGAL_TRANSITION if the offer already expired, was answered, or the booking moved on; 409 SLOT_TAKEN if you became busy at that time in the meantime.'
  })
  async accept(@Param('id', ParseUUIDPipe) id: string, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    const booking = await this.offers.accept(id, principal.userId);
    await this.bookings.issueStartOtp(booking.id);
    return booking;
  }

  @Post(':id/decline')
  @HttpCode(200)
  @PolicyDecorator({ roles: ['PROVIDER'] })
  @ApiOperation({ summary: 'Decline an offered job', description: 'Turns the job down. An auto-assigned job moves on to the next provider; a job requested from you specifically ends UNFULFILLED and the customer is refunded if they had paid.' })
  async decline(@Param('id', ParseUUIDPipe) id: string, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.offers.decline(id, principal.userId);
  }
}
