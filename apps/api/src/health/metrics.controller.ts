// apps/api/src/health/metrics.controller.ts
import { Controller, Get, Inject } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/policy.js';
import { MetricsService } from '../platform/metrics.service.js';

/**
 * SHM-092 / NFR-OBS: the Prometheus scrape endpoint.
 *
 * `@Public()` on purpose, and worth being explicit about why that is safe here. Everything else
 * behind authentication in this system is business data — bookings, complaints, CNICs, money. This
 * endpoint exposes no business data at all: queue depths, request counts and latency buckets, and
 * two aggregate money *shape* numbers. A metrics endpoint that required a bearer token would be
 * scraped with a token that expires, and the usual answer — an unauthenticated endpoint that leaks
 * anything — does not apply to counters.
 *
 * What it deliberately does **not** expose: any route that could enumerate users, any label carrying
 * an id, and anything per-customer. A scrape should never be able to tell you who a customer is.
 *
 * It is on the same limiter as everything else, and Prometheus scrapes once every 15 seconds against
 * a 300/min budget, so a scrape cannot starve a real customer of their request.
 */
@ApiTags('health')
@Controller('metrics')
export class MetricsController {
  constructor(@Inject(MetricsService) private readonly metrics: MetricsService) {}

  @Get()
  @Public()
  @ApiExcludeEndpoint()
  @ApiOperation({
    summary: 'Prometheus metrics',
    description:
      'Request counts and latency by route, every background queue depth, outbox backlog and age, and escrow held in paisa. Scrape every 15 seconds. No business data and no per-customer labels are exposed.'
  })
  async scrape(): Promise<string> {
    return this.metrics.metrics();
  }
}