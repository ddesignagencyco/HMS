import { Controller, Get, Inject, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/policy.js';
import { ApiQueryField } from '../common/swagger.js';
import { parseWith } from '../common/validation.js';
import { providerSearchQuerySchema, slotsQuerySchema } from './search.schemas.js';
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
      "Starts from a service (not a person): pass the service's slug and the customer's coordinates. Returns only approved providers with an approved offer for that service, whose configured radius covers the given point, ranked by distance. Rating/completion-rate weighting is not applied yet — there's no verified rating or booking history to weight by until later modules exist."
  })
  @ApiQueryField('serviceSlug', { required: true, description: 'Which service to find providers for, e.g. "leak-repair" (see GET /catalogue/services/{slug}).' })
  @ApiQueryField('lat', { required: true, type: 'number', description: "The customer's latitude, e.g. 31.5204 (Lahore)." })
  @ApiQueryField('lng', { required: true, type: 'number', description: "The customer's longitude, e.g. 74.3587 (Lahore)." })
  async searchProviders(@Query() query: unknown) {
    return { items: await this.search.searchProviders(parseWith(providerSearchQuerySchema, query)) };
  }

  @Get('providers/:providerId/slots')
  @Public()
  @ApiOperation({
    summary: 'List the times a provider can be booked on a day',
    description:
      "Start times (every half hour) at which this provider is free for the full length of the chosen service on the given local day: inside their declared hours, clear of leave and of their other bookings plus the travel buffer, and at least an hour from now. A time listed here can still be taken by someone else a moment later; checkout then answers 409 SLOT_TAKEN."
  })
  @ApiQueryField('serviceId', { required: true, type: 'number', description: 'Which service the slot is for; its duration sets the slot length.' })
  @ApiQueryField('date', { required: true, description: 'The local (Asia/Karachi) day, as YYYY-MM-DD.' })
  async slots(@Param('providerId', ParseUUIDPipe) providerId: string, @Query() query: unknown) {
    return this.search.listSlots(providerId, parseWith(slotsQuerySchema, query));
  }

  @Get('providers/:providerId')
  @Public()
  @ApiOperation({ summary: 'Get a provider’s full public profile', description: 'Returns an approved provider’s profile along with every service they are approved to offer (with price) and the areas they serve. A provider who is not approved looks the same as one that does not exist.' })
  async providerDetail(@Param('providerId', ParseUUIDPipe) providerId: string) {
    return this.search.getProviderDetail(providerId);
  }
}
