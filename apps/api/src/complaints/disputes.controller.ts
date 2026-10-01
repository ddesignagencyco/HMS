// apps/api/src/complaints/disputes.controller.ts
import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentPrincipal, PolicyDecorator, type AuthenticatedPrincipal } from '../common/policy.js';
import { ApiQueryField, ApiZodBody } from '../common/swagger.js';
import { parseWith } from '../common/validation.js';
import { DisputesService } from './disputes.service.js';

const ADMIN = { roles: ['ADMIN'], totpRequired: true } as const;

const resolveSchema = z
  .object({
    resolution: z.enum(['FULL_RELEASE', 'PARTIAL_RELEASE', 'FULL_REFUND', 'REFUND_WITH_PENALTY']),
    releasePaisa: z.number().int().positive().optional(),
    note: z.string().trim().min(3).max(2000),
    overrideReason: z.string().trim().min(5).max(500).optional(),
    breachCode: z.string().trim().min(2).max(60).optional(),
    excessPaisa: z.number().int().positive().optional()
  })
  .strict();
const replySchema = z.object({ reply: z.string().trim().min(1).max(3000) }).strict();
const listQuery = z.object({ status: z.enum(['OPEN', 'AWAITING_PROVIDER_REPLY', 'READY', 'RESOLVED']).optional() }).strict();

@ApiTags('disputes')
@ApiBearerAuth('access-token')
@Controller()
export class DisputesController {
  constructor(@Inject(DisputesService) private readonly disputes: DisputesService) {}

  @Get('admin/disputes')
  @PolicyDecorator(ADMIN)
  @ApiOperation({ summary: 'The dispute queue', description: 'Admin only. Open disputes first, oldest first, with the reply deadline and whether the provider has replied. Filter by status.' })
  @ApiQueryField('status', { description: 'OPEN, AWAITING_PROVIDER_REPLY, READY or RESOLVED' })
  async list(@Query() query: unknown) {
    return this.disputes.list(parseWith(listQuery, query).status);
  }

  @Get('admin/disputes/:id')
  @PolicyDecorator(ADMIN)
  @ApiOperation({
    summary: 'Open a dispute: the evidence floor',
    description:
      "Admin only. Everything needed to rule: the money held and the job's final amount; when the start code was used; geofence distances against the radius; every photo and checklist step; the invoice; each verification record with the questionnaire answers; the call attempts (with which have recordings — play them via /finance/recordings); the complaints; the provider's reply; and the booking's full history."
  })
  async one(@Param('id', ParseUUIDPipe) id: string) {
    return this.disputes.evidenceFloor(id, true);
  }

  @Post('admin/disputes/:id/resolve')
  @HttpCode(200)
  @PolicyDecorator(ADMIN)
  @ApiOperation({
    summary: 'Rule on a dispute',
    description:
      "Admin only. FULL_RELEASE pays the provider the job and returns any excess escrow to the customer; PARTIAL_RELEASE (`releasePaisa`) pays the provider that much and refunds the rest; FULL_REFUND returns everything held; REFUND_WITH_PENALTY does the same and proposes a penalty (`breachCode`). The split always adds up to exactly what was held. Ruling before the provider's reply window closes without a reply needs an `overrideReason` (409 otherwise). Postings, refund, booking state, the record and notices to both parties commit together."
  })
  @ApiZodBody(resolveSchema, { default: { summary: 'Split the difference', value: { resolution: 'PARTIAL_RELEASE', releasePaisa: 60000, note: 'The photos show the repair was only partly done' } } })
  async resolve(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.disputes.resolve(principal.userId, id, parseWith(resolveSchema, body));
  }

  @Get('provider/disputes')
  @PolicyDecorator({ roles: ['PROVIDER'] })
  @ApiOperation({ summary: 'See my disputes', description: 'Disputes on your jobs, with the reply deadline and the ruling once made.' })
  async mine(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.disputes.listForProvider(principal.userId);
  }

  @Get('provider/disputes/:id')
  @PolicyDecorator({ roles: ['PROVIDER'] })
  @ApiOperation({ summary: 'Read a dispute on my job', description: 'The evidence the admin will see (photos, checklist, invoice, verification answers, complaints), so you can answer it. Recordings and the agent are not shown.' })
  async oneMine(@Param('id', ParseUUIDPipe) id: string, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.disputes.getForProvider(principal.userId, id);
  }

  @Post('provider/disputes/:id/reply')
  @HttpCode(200)
  @PolicyDecorator({ roles: ['PROVIDER'] })
  @ApiOperation({ summary: 'Reply to a dispute', description: 'Your right of reply before the ruling — once. Replying makes the dispute ready for an admin to rule without an override.' })
  @ApiZodBody(replySchema, { default: { summary: 'My side', value: { reply: 'The work was completed; the customer signed off in the chat.' } } })
  async reply(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.disputes.reply(principal.userId, id, parseWith(replySchema, body).reply);
  }
}
