// apps/api/src/reputation/reputation.controller.ts
import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentPrincipal, Public, PolicyDecorator, type AuthenticatedPrincipal } from '../common/policy.js';
import { ApiQueryField, ApiZodBody } from '../common/swagger.js';
import { parseWith } from '../common/validation.js';
import { ReputationService } from './reputation.service.js';

const replySchema = z.object({ body: z.string().trim().min(1).max(1000) }).strict();
const unpublishSchema = z.object({ reason: z.string().trim().min(3).max(500) }).strict();
const limitQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }).strict();

@ApiTags('reputation')
@Controller()
export class ReputationController {
  constructor(@Inject(ReputationService) private readonly reputation: ReputationService) {}

  @Get('search/providers/:providerId/reputation')
  @Public()
  @ApiOperation({
    summary: 'A provider’s public reputation',
    description:
      'The published score (average of the four criteria, weighted toward the last 20 jobs and pulled toward a neutral prior for providers with few ratings), how many ratings it rests on, the spread across 1–5 stars, verified jobs and badge. `score` is null when `ratingCount` is 0 — nobody has rated this provider yet, so there is nothing to display. The number that exists internally for ranking purposes is the prior, and it is deliberately not published as if it were a rating.'
  })
  async publicReputation(@Param('providerId', ParseUUIDPipe) providerId: string) {
    return this.reputation.publicReputation(providerId);
  }

  @Get('search/providers/:providerId/remarks')
  @Public()
  @ApiOperation({
    summary: 'A provider’s published remarks',
    description:
      'Customer remarks from verified jobs, newest first, shown as first name and last initial only, each with the provider’s reply if they gave one. `reply` is an object `{ body, createdAt }` when there is a reply and `null` when there is not — it is not a string. Unpublished remarks never appear.'
  })
  @ApiQueryField('limit', { type: 'number', description: '1–100, default 20' })
  async remarks(@Param('providerId', ParseUUIDPipe) providerId: string, @Query() query: unknown) {
    return { items: await this.reputation.publicRemarks(providerId, parseWith(limitQuery, query).limit) };
  }

  @Get('provider/ratings')
  @PolicyDecorator({ roles: ['PROVIDER'] })
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'See the ratings I received',
    description: 'Every rating you have received with its four criteria, and the remark that came with it (including any an admin unpublished), your reply, and your overall reputation.'
  })
  async own(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.reputation.ownRatings(principal.userId);
  }

  @Post('provider/remarks/:id/reply')
  @HttpCode(201)
  @PolicyDecorator({ roles: ['PROVIDER'] })
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Reply to a remark', description: 'One reply per published remark, up to 1000 characters, visible next to it. It cannot be edited afterwards; a second reply is 409.' })
  @ApiZodBody(replySchema, { default: { summary: 'A courteous reply', value: { body: 'Thank you — glad the leak is fixed.' } } })
  async reply(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.reputation.reply(principal.userId, id, parseWith(replySchema, body).body);
  }

  @Get('admin/providers/:providerId/ratings')
  @PolicyDecorator({ roles: ['ADMIN'], totpRequired: true })
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Review a provider’s ratings',
    description: 'Admin only. Every rating and remark for a provider, unpublished ones included with who removed them and why, and their overall reputation.'
  })
  async adminRatings(@Param('providerId', ParseUUIDPipe) providerId: string) {
    return this.reputation.adminView(providerId);
  }

  @Post('admin/remarks/:id/unpublish')
  @HttpCode(200)
  @PolicyDecorator({ roles: ['ADMIN'], totpRequired: true })
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Unpublish an abusive remark',
    description: 'Admin only. Hides the remark from the public; the rating behind it stays in the provider’s score. The reason is recorded and the action audited.'
  })
  @ApiZodBody(unpublishSchema, { default: { summary: 'Abusive language', value: { reason: 'Contains personal abuse' } } })
  async unpublish(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.reputation.unpublish(principal.userId, id, parseWith(unpublishSchema, body).reason);
  }
}
