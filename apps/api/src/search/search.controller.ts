import { Controller, Get, Inject, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/policy.js';
import { ApiQueryField } from '../common/swagger.js';
import { parseWith } from '../common/validation.js';
import { providerSearchQuerySchema, nextSlotsQuerySchema, slotsQuerySchema } from './search.schemas.js';
import { SearchService } from './search.service.js';

@ApiTags('search')
@Controller('search')
export class SearchController {
  constructor(@Inject(SearchService) private readonly search: SearchService) {}

  @Get('providers')
  @Public()
  @ApiOperation({
    summary: 'Find providers who offer a service near a point',
    description:
      "Starts from a service (not a person): pass the service's slug and the customer's coordinates. Returns only approved providers with an approved offer for that service, whose configured radius covers the given point, ranked by a weighted blend of rating and distance (`ranking.weights`, rating 0.35 and distance 0.25 by default), then by distance. `ratingScore` is the provider's weighted score, or null when nobody has rated them yet — rank on it, do not render it as a rating."
  })
  @ApiQueryField('serviceSlug', { required: true, description: 'Which service to find providers for, e.g. "leak-repair" (see GET /catalogue/services/{slug}).' })
  @ApiQueryField('lat', {
    required: true,
    type: 'number',
    description: "The customer's latitude, e.g. 31.5204 (Lahore). An area's own lat/lng from GET /places/cities/{cityId}/areas can be used when the exact point is not known."
  })
  @ApiQueryField('lng', {
    required: true,
    type: 'number',
    description: "The customer's longitude, e.g. 74.3587 (Lahore). An area's own lng from GET /places/cities/{cityId}/areas can be used when the exact point is not known."
  })
  async searchProviders(@Query() query: unknown) {
    return { items: await this.search.searchProviders(parseWith(providerSearchQuerySchema, query)) };
  }

  @Get('providers/:providerId/slots')
  @Public()
  @ApiOperation({
    summary: 'List the times a provider can be booked on a day',
    description:
      'Start times (every half hour) at which this provider is free for the full length of the chosen service on the given local day: inside their declared hours, clear of leave and of their other bookings plus the travel buffer, and at least `booking.min_notice_min` from now (30 minutes by default). A time listed here can still be taken by someone else a moment later; checkout then answers 409 SLOT_TAKEN. For "soonest available" rather than a named date, use GET /search/providers/{providerId}/next-slots.'
  })
  @ApiQueryField('serviceId', { required: true, type: 'number', description: 'Which service the slot is for; its duration sets the slot length.' })
  @ApiQueryField('date', { required: true, description: 'The local (Asia/Karachi) day, as YYYY-MM-DD.' })
  async slots(@Param('providerId', ParseUUIDPipe) providerId: string, @Query() query: unknown) {
    return this.search.listSlots(providerId, parseWith(slotsQuerySchema, query));
  }

  @Get('providers/:providerId/next-slots')
  @Public()
  @ApiOperation({
    summary: 'When is this provider next free?',
    description:
      'Same-day and short-notice booking. Answers the question a customer actually asks at 21:00 — "can someone come today?" / "can I book for the next hour?" — by returning the soonest start times across the coming days rather than the slots for one named date. Start times are at least `booking.min_notice_min` from now (30 minutes by default), inside the provider\'s declared hours, and clear of leave and their other bookings. The first item is the earliest they can be at the door. An empty list means they have no availability in the next `booking.next_slot_days` days. Each time is still a candidate, not a guarantee: someone else may take it, and checkout then answers 409 SLOT_TAKEN.'
  })
  @ApiQueryField('serviceId', { required: true, type: 'number', description: 'Which service the slot is for; its duration sets the slot length.' })
  @ApiQueryField('limit', { required: false, type: 'number', description: 'How many soonest start times to return (1–20, default 5).' })
  async nextSlots(@Param('providerId', ParseUUIDPipe) providerId: string, @Query() query: unknown) {
    return this.search.listNextSlots(providerId, parseWith(nextSlotsQuerySchema, query));
  }

  @Get('providers/:providerId')
  @Public()
  @ApiOperation({
    summary: 'Get a provider’s full public profile',
    description:
      'Returns an approved provider’s profile along with every service they are approved to offer (with price) and the areas they serve. A provider who is not approved looks the same as one that does not exist.'
  })
  async providerDetail(@Param('providerId', ParseUUIDPipe) providerId: string) {
    return this.search.getProviderDetail(providerId);
  }
}
