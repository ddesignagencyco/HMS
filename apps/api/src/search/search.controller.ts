import { Controller, Get, Inject, Param, ParseUUIDPipe, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ACCESS_TOKEN_VERIFIER, type AccessTokenVerifier } from '../common/access-token.port.js';
import { ApiPageQuery } from '../common/paging.js';
import { notFound } from '../common/domain-error.js';
import { Public, type AuthenticatedRequest } from '../common/policy.js';
import { ApiQueryField } from '../common/swagger.js';
import { parseWith } from '../common/validation.js';
import { providerSearchQuerySchema, nextSlotsQuerySchema, slotsQuerySchema } from './search.schemas.js';
import { SearchService } from './search.service.js';

/** A malformed provider id is a provider that does not exist: 404, the same answer a well-formed unknown id gets. */
const providerIdPipe = new ParseUUIDPipe({ exceptionFactory: () => notFound('Provider') });

@ApiTags('search')
@Controller('search')
export class SearchController {
  constructor(
    @Inject(SearchService) private readonly search: SearchService,
    @Inject(ACCESS_TOKEN_VERIFIER) private readonly tokens: AccessTokenVerifier
  ) {}

  /** The route is public, so a bearer token is read here when one is sent: only a signed-in customer may search around a saved address. A bad token is simply an anonymous caller. */
  private async customerOf(request: AuthenticatedRequest): Promise<string | undefined> {
    const header = request.headers.authorization;
    if (header === undefined || !header.startsWith('Bearer ')) return undefined;
    try {
      const claims = await this.tokens.verify(header.slice('Bearer '.length).trim());
      return claims.roles.includes('CUSTOMER') ? claims.userId : undefined;
    } catch {
      return undefined;
    }
  }

  @Get('providers')
  @Public()
  @ApiOperation({
    summary: 'Find providers who offer a service near a point',
    description:
      "Starts from a service (not a person): pass the service's slug and either the customer's coordinates or `addressId`. Returns only approved providers with an approved offer for that service, whose configured radius covers the given point, ranked by a weighted blend of rating and distance (`ranking.weights`, rating 0.35 and distance 0.25 by default), then by distance. `ratingScore` is the provider's weighted score, or null when nobody has rated them yet — rank on it, do not render it as a rating. The optional filters are applied *before* ranking, so a narrowed search really is narrowed: `minExperienceYears`, `minCompletedJobs`, `minPricePaisa`/`maxPricePaisa`, `availableToday` (a real free slot later today, local time) and `verifiedDocsOnly` (at least one document verified)."
  })
  @ApiQueryField('serviceSlug', { required: false, description: 'Which service to find providers for, e.g. "leak-repair" (see GET /catalogue/services/{slug}). Optional: without it every provider in range is listed once, at their lowest approved price, ranked across services.' })
  @ApiQueryField('sort', { required: false, description: 'distance | rating | price_asc | price_desc | experience. Omitted = the weighted ranking. Ties fall back to the weighted ranking.' })
  @ApiQueryField('minRating', { required: false, type: 'number', description: 'Only providers whose published rating (0-5) is at least this. Unrated providers are excluded when it is set.' })
  @ApiPageQuery()
  @ApiQueryField('lat', {
    required: false,
    type: 'number',
    description: "The customer's latitude, e.g. 31.5204 (Lahore). Required with `lng` unless `addressId` is given."
  })
  @ApiQueryField('lng', {
    required: false,
    type: 'number',
    description: "The customer's longitude, e.g. 74.3587 (Lahore). Required with `lat` unless `addressId` is given."
  })
  @ApiQueryField('addressId', { required: false, description: "One of the signed-in customer's own saved addresses, resolved server-side to its point. Alternative to lat/lng. Anyone else (anonymous, another customer, a non-customer) gets 404, as for an address that does not exist." })
  @ApiQueryField('minExperienceYears', { required: false, type: 'number', description: 'Only providers with at least this many years of experience (FR-SR-02).' })
  @ApiQueryField('minCompletedJobs', { required: false, type: 'number', description: 'Only providers who have completed at least this many jobs (FR-SR-03).' })
  @ApiQueryField('minPricePaisa', { required: false, type: 'number', description: 'Lowest acceptable price for this service, in paisa (FR-SR-04).' })
  @ApiQueryField('maxPricePaisa', { required: false, type: 'number', description: 'Highest acceptable price for this service, in paisa (FR-SR-04).' })
  @ApiQueryField('availableToday', { required: false, type: 'boolean', description: 'Only providers with a free slot later today in their own local time (FR-SR-05).' })
  @ApiQueryField('verifiedDocsOnly', { required: false, type: 'boolean', description: 'Only providers with at least one verified document (FR-SR-07).' })
  async searchProviders(@Query() query: unknown, @Req() request: AuthenticatedRequest) {
    return this.search.searchProviders(parseWith(providerSearchQuerySchema, query), await this.customerOf(request));
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
  async slots(@Param('providerId', providerIdPipe) providerId: string, @Query() query: unknown) {
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
  async nextSlots(@Param('providerId', providerIdPipe) providerId: string, @Query() query: unknown) {
    return this.search.listNextSlots(providerId, parseWith(nextSlotsQuerySchema, query));
  }

  @Get('providers/:providerId')
  @Public()
  @ApiOperation({
    summary: 'Get a provider’s full public profile',
    description:
      'Returns an approved provider’s profile along with every service they are approved to offer (with price) and the areas they serve. A provider who is not approved looks the same as one that does not exist.'
  })
  async providerDetail(@Param('providerId', providerIdPipe) providerId: string) {
    return this.search.getProviderDetail(providerId);
  }
}
