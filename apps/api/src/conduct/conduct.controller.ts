// apps/api/src/conduct/conduct.controller.ts
import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentPrincipal, PolicyDecorator, type AuthenticatedPrincipal } from '../common/policy.js';
import { ApiQueryField, ApiZodBody } from '../common/swagger.js';
import { parseWith } from '../common/validation.js';
import { ConductService } from './conduct.service.js';

const ADMIN = { roles: ['ADMIN'], totpRequired: true } as const;
const PROVIDER = { roles: ['PROVIDER'] } as const;

const proposeSchema = z
  .object({
    providerId: z.string().uuid(),
    breachCode: z.string().trim().min(2).max(60),
    bookingId: z.string().uuid().optional(),
    complaintId: z.string().uuid().optional(),
    disputeId: z.string().uuid().optional(),
    excessPaisa: z.number().int().positive().optional(),
    evidence: z.record(z.unknown()).optional()
  })
  .strict();
const replySchema = z.object({ reply: z.string().trim().min(1).max(2000) }).strict();
const appealSchema = z.object({ grounds: z.string().trim().min(10).max(2000) }).strict();
const withdrawSchema = z.object({ reason: z.string().trim().min(3).max(500) }).strict();
const decideSchema = z
  .object({ decision: z.enum(['UPHELD', 'REVERSED', 'PARTIAL']), note: z.string().trim().min(3).max(1000), refundFinePaisa: z.number().int().positive().optional() })
  .strict();
const listQuery = z.object({ status: z.string().trim().max(30).optional(), providerId: z.string().uuid().optional() }).strict();

@ApiTags('conduct')
@ApiBearerAuth('access-token')
@Controller()
export class ConductController {
  constructor(@Inject(ConductService) private readonly conduct: ConductService) {}

  @Post('admin/penalties')
  @HttpCode(201)
  @PolicyDecorator(ADMIN)
  @ApiOperation({
    summary: 'Propose a penalty',
    description:
      "Admin only. Proposes a penalty for a breach on the demerit schedule, with the evidence. Nothing happens to the provider yet: they are shown the evidence and have 48 hours to reply. The fine follows the breach's rule and is capped at the job's value plus the maximum fine; give `excessPaisa` for fines that are a multiple of an overcharge."
  })
  @ApiZodBody(proposeSchema, { default: { summary: 'Overcharging', value: { providerId: '00000000-0000-4000-8000-000000000000', breachCode: 'OVERCHARGE', bookingId: '00000000-0000-4000-8000-000000000001', excessPaisa: 200000, evidence: { note: 'Customer confirmed on the verification call' } } } })
  async propose(@Body() body: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    const { excessPaisa, ...input } = parseWith(proposeSchema, body);
    return this.conduct.proposeByAdmin(principal.userId, { ...input, ...(excessPaisa === undefined ? {} : { excessPaisa: BigInt(excessPaisa) }) });
  }

  @Get('admin/penalties')
  @PolicyDecorator(ADMIN)
  @ApiOperation({ summary: 'List penalties', description: 'Admin only. Newest first; filter by status (PROPOSED, APPLIED, APPEALED, UPHELD, REVERSED, WITHDRAWN) or provider.' })
  @ApiQueryField('status', { description: 'PROPOSED, APPLIED, APPEALED, UPHELD, REVERSED or WITHDRAWN' })
  @ApiQueryField('providerId', { description: 'Only this provider' })
  async list(@Query() query: unknown) {
    const { status, providerId } = parseWith(listQuery, query);
    return { items: await this.conduct.list(status, providerId) };
  }

  @Get('admin/penalties/:id')
  @PolicyDecorator(ADMIN)
  @ApiOperation({ summary: 'Read a penalty', description: 'Admin only. The penalty with its evidence, the provider’s reply and the reply deadline.' })
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return this.conduct.get(id);
  }

  @Post('admin/penalties/:id/apply')
  @HttpCode(200)
  @PolicyDecorator(ADMIN)
  @ApiOperation({
    summary: 'Apply a penalty',
    description:
      "Admin only. Applies a proposed penalty in one transaction: the fine leaves the provider's wallet (a shortfall becomes commission debt that blocks offers), the demerit points are awarded, any threshold the total has crossed upward fires once, and the harsher of the breach's own consequence and the threshold's is enforced (warning, demotion, suspension or block). 409 until the provider has replied or the 48-hour deadline has passed."
  })
  async apply(@Param('id', ParseUUIDPipe) id: string, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.conduct.apply(principal.userId, id);
  }

  @Post('admin/penalties/:id/withdraw')
  @HttpCode(200)
  @PolicyDecorator(ADMIN)
  @ApiOperation({ summary: 'Withdraw a proposed penalty', description: 'Admin only. Drops a penalty that has not been applied, with a reason. Nothing was ever charged or awarded.' })
  @ApiZodBody(withdrawSchema, { default: { summary: 'Not upheld by the evidence', value: { reason: 'The evidence does not support it' } } })
  async withdraw(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.conduct.withdraw(principal.userId, id, parseWith(withdrawSchema, body).reason);
  }

  @Get('admin/appeals')
  @PolicyDecorator(ADMIN)
  @ApiOperation({ summary: 'List appeals', description: 'Admin only. Appeals against applied penalties; filter by status (OPEN, UPHELD, REVERSED, PARTIAL).' })
  @ApiQueryField('status', { description: 'OPEN, UPHELD, REVERSED or PARTIAL' })
  async appeals(@Query() query: unknown) {
    return { items: await this.conduct.listAppeals(parseWith(listQuery, query).status) };
  }

  @Post('admin/appeals/:id/decide')
  @HttpCode(200)
  @PolicyDecorator(ADMIN)
  @ApiOperation({
    summary: 'Decide an appeal',
    description:
      'Admin only, audited. UPHELD changes nothing. REVERSED undoes the penalty exactly: the demerit points are voided, the fine goes back into the wallet against the original posting, the debt block is re-evaluated and any suspension or block it caused is lifted. PARTIAL refunds part of the fine (`refundFinePaisa`) and keeps the points.'
  })
  @ApiZodBody(decideSchema, { default: { summary: 'Reverse it', value: { decision: 'REVERSED', note: 'The customer’s account was contradicted by the photos' } } })
  async decide(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.conduct.decideAppeal(principal.userId, id, parseWith(decideSchema, body));
  }

  @Get('provider/penalties')
  @PolicyDecorator(PROVIDER)
  @ApiOperation({ summary: 'See my penalties', description: 'Penalties proposed against you and their state, with the breach, the evidence, the fine and the deadline for your reply.' })
  async mine(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return { items: await this.conduct.listForProvider(principal.userId) };
  }

  @Get('provider/penalties/:id')
  @PolicyDecorator(PROVIDER)
  @ApiOperation({ summary: 'Read one of my penalties', description: 'Full detail of a penalty against you, including the evidence shown to you and your reply.' })
  async one(@Param('id', ParseUUIDPipe) id: string, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.conduct.getForProvider(principal.userId, id);
  }

  @Post('provider/penalties/:id/reply')
  @HttpCode(200)
  @PolicyDecorator(PROVIDER)
  @ApiOperation({ summary: 'Reply to a proposed penalty', description: 'Your right of reply: tell your side before the penalty is decided. Once, and only while it is still proposed. A penalty can be applied as soon as you reply or the 48 hours pass.' })
  @ApiZodBody(replySchema, { default: { summary: 'My side', value: { reply: 'The customer asked for extra work on the day and paid for it in cash.' } } })
  async reply(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.conduct.reply(principal.userId, id, parseWith(replySchema, body).reply);
  }

  @Post('provider/penalties/:id/appeal')
  @HttpCode(201)
  @PolicyDecorator(PROVIDER)
  @ApiOperation({ summary: 'Appeal an applied penalty', description: 'Appeals a penalty that has been applied to you, with your grounds. One appeal per penalty. An admin decides it; the decision is recorded in the audit log.' })
  @ApiZodBody(appealSchema, { default: { summary: 'Grounds', value: { grounds: 'The photos show I completed the work and the customer signed off in the chat.' } } })
  async appeal(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.conduct.appeal(principal.userId, id, parseWith(appealSchema, body).grounds);
  }

  @Get('provider/conduct')
  @PolicyDecorator(PROVIDER)
  @ApiOperation({
    summary: 'See my conduct record',
    description: 'Your active demerit points, every award with the date it expires and how many clean days you have accrued towards the next point coming off, any standing suspension or demotion, the thresholds, and the full penalty schedule (the rules you agreed to).'
  })
  async record(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.conduct.record(principal.userId);
  }
}
