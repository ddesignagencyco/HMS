// apps/api/src/payment/provider-payouts.controller.ts
import { Body, Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentPrincipal, PolicyDecorator, type AuthenticatedPrincipal } from '../common/policy.js';
import { ApiZodBody } from '../common/swagger.js';
import { parseWith } from '../common/validation.js';
import { PayoutsService } from './payouts.service.js';

const accountSchema = z
  .object({
    kind: z.enum(['BANK', 'WALLET']),
    accountTitle: z.string().trim().min(2).max(120),
    institution: z.string().trim().min(2).max(120),
    accountNumber: z.string().trim().min(6).max(40),
    isDefault: z.boolean().optional()
  })
  .strict();

const payoutSchema = z.object({ amountPaisa: z.number().int().positive(), payoutAccountId: z.string().uuid() }).strict();

@ApiTags('payment')
@ApiBearerAuth('access-token')
@Controller('provider')
export class ProviderPayoutsController {
  constructor(@Inject(PayoutsService) private readonly payouts: PayoutsService) {}

  @Get('payout-accounts')
  @PolicyDecorator({ roles: ['PROVIDER'] })
  @ApiOperation({ summary: 'List my payout accounts', description: 'Bank or mobile-wallet accounts you can be paid into. Only the last four digits are ever shown.' })
  async accounts(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return { items: await this.payouts.listAccounts(principal.userId) };
  }

  @Post('payout-accounts')
  @HttpCode(201)
  @PolicyDecorator({ roles: ['PROVIDER'] })
  @ApiOperation({ summary: 'Add a payout account', description: 'Registers a bank or mobile-wallet account. The number is stored encrypted; your first account becomes the default.' })
  @ApiZodBody(accountSchema, { default: { summary: 'A bank account', value: { kind: 'BANK', accountTitle: 'Bilal Ahmed', institution: 'HBL', accountNumber: '01234567890123' } } })
  async addAccount(@Body() body: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.payouts.addAccount(principal.userId, parseWith(accountSchema, body));
  }

  @Get('earnings')
  @PolicyDecorator({ roles: ['PROVIDER'] })
  @ApiOperation({
    summary: 'See my earnings',
    description: 'Held (your share of jobs whose money is still in escrow), releasable (your wallet, less payouts already requested), paid out to date, commission deducted, and what was released each week and month.'
  })
  async earnings(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.payouts.earnings(principal.userId);
  }

  @Get('payouts')
  @PolicyDecorator({ roles: ['PROVIDER'] })
  @ApiOperation({ summary: 'List my payouts', description: 'Your payout requests and where each stands, with the reason if the bank rejected one.' })
  async list(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return { items: await this.payouts.listForProvider(principal.userId) };
  }

  @Post('payouts')
  @HttpCode(201)
  @PolicyDecorator({ roles: ['PROVIDER'] })
  @ApiOperation({
    summary: 'Request a payout',
    description: "Asks for part or all of your releasable wallet balance to be paid into one of your accounts. At least the minimum payout (`payout.min_amount_paisa`); 409 for more than you can currently request."
  })
  @ApiZodBody(payoutSchema, { default: { summary: 'Request a payout', value: { amountPaisa: 200000, payoutAccountId: '00000000-0000-4000-8000-000000000000' } } })
  async request(@Body() body: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    const { amountPaisa, payoutAccountId } = parseWith(payoutSchema, body);
    return this.payouts.request(principal.userId, amountPaisa, payoutAccountId);
  }
}
