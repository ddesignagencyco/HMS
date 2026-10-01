// apps/api/src/payment/provider-money.controller.ts
import { Body, Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentPrincipal, PolicyDecorator, type AuthenticatedPrincipal } from '../common/policy.js';
import { ApiZodBody } from '../common/swagger.js';
import { parseWith } from '../common/validation.js';
import { ProviderMoneyService } from './provider-money.service.js';

const payDebtSchema = z.object({ amountPaisa: z.number().int().positive().optional() }).strict();

@ApiTags('payment')
@ApiBearerAuth('access-token')
@Controller('provider')
export class ProviderMoneyController {
  constructor(@Inject(ProviderMoneyService) private readonly money: ProviderMoneyService) {}

  @Get('wallet')
  @PolicyDecorator({ roles: ['PROVIDER'] })
  @ApiOperation({
    summary: 'See my wallet and commission debt',
    description: "What the platform owes you (`balancePaisa`), or, when it is negative, the commission you owe from cash jobs (`debtPaisa`). Above `debtCeilingPaisa` you stop receiving new offers (`offersBlocked`) until you pay it down."
  })
  async wallet(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.money.wallet(principal.userId);
  }

  @Post('debt/pay')
  @HttpCode(200)
  @PolicyDecorator({ roles: ['PROVIDER'] })
  @ApiOperation({
    summary: 'Pay commission debt online',
    description: 'Starts an online payment towards your commission debt (all of it unless you give an amount) and returns where to pay. The moment the payment is confirmed your wallet is credited and, if that brings you under the ceiling, you receive offers again.'
  })
  @ApiZodBody(payDebtSchema, { default: { summary: 'Pay the whole debt', value: {} } })
  async payDebt(@Body() body: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.money.payDebt(principal.userId, parseWith(payDebtSchema, body ?? {}).amountPaisa);
  }
}
