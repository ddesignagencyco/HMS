// apps/api/src/payment/finance.controller.ts
import { Body, Controller, Get, Header, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentPrincipal, PolicyDecorator, type AuthenticatedPrincipal } from '../common/policy.js';
import { ApiQueryField, ApiZodBody } from '../common/swagger.js';
import { parseWith } from '../common/validation.js';
import { FinanceService } from './finance.service.js';
import { PayoutsService } from './payouts.service.js';
import { ReconciliationService } from './reconciliation.service.js';

const FINANCE = { roles: ['FINANCE', 'ADMIN'], totpRequired: true } as const;

const refundSchema = z
  .object({
    bookingId: z.string().uuid(),
    amountPaisa: z.number().int().positive(),
    reasonCode: z.string().trim().min(2).max(60),
    reasonText: z.string().trim().max(500).optional()
  })
  .strict();

const batchSchema = z.object({ periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict();

const markSchema = z
  .object({
    results: z
      .array(z.object({ payoutId: z.string().uuid(), status: z.enum(['PAID', 'FAILED']), failureReason: z.string().trim().max(300).optional() }).strict())
      .min(1)
      .optional()
  })
  .strict();

const statusQuery = z.object({ status: z.string().trim().max(30).optional() }).strict();

const ledgerQuery = z
  .object({
    accountType: z.enum(['GATEWAY_CLEARING', 'ESCROW', 'PROVIDER_WALLET', 'PLATFORM_COMMISSION', 'PENALTY_INCOME', 'CUSTOMER_COMPENSATION', 'PROMO_EXPENSE', 'CUSTOMER_RECEIVABLE', 'PLAN_DEFERRED', 'PAYOUT_CLEARING']).optional(),
    ownerId: z.string().uuid().optional(),
    bookingId: z.string().uuid().optional(),
    before: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50)
  })
  .strict();

@ApiTags('finance')
@ApiBearerAuth('access-token')
@Controller('finance')
export class FinanceController {
  constructor(
    @Inject(FinanceService) private readonly finance: FinanceService,
    @Inject(PayoutsService) private readonly payouts: PayoutsService,
    @Inject(ReconciliationService) private readonly reconciliation: ReconciliationService
  ) {}

  @Get('escrow')
  @PolicyDecorator(FINANCE)
  @ApiOperation({ summary: 'See the money held in escrow', description: 'Customer money currently held per booking, with the booking’s state and the total held. Read straight from the ledger.' })
  async escrow() {
    return this.finance.escrow();
  }

  @Get('refunds')
  @PolicyDecorator(FINANCE)
  @ApiOperation({ summary: 'List refunds', description: 'Every refund with its reason, the payment it goes back to, and whether the gateway has completed it. Filter by status (PENDING, SUCCEEDED, FAILED).' })
  @ApiQueryField('status', { description: 'PENDING, SUCCEEDED or FAILED' })
  async refunds(@Query() query: unknown) {
    return this.finance.refunds(parseWith(statusQuery, query).status);
  }

  @Post('refunds')
  @HttpCode(201)
  @PolicyDecorator(FINANCE)
  @ApiOperation({
    summary: 'Refund a disputed booking by hand',
    description: "Refunds part or all of the money held for a disputed booking back to the original payment method, with the reason stored. 409 for a booking that is not disputed (the ordinary flows own the money everywhere else); 400 for more than is held."
  })
  @ApiZodBody(refundSchema, { default: { summary: 'Refund part of a disputed job', value: { bookingId: '00000000-0000-4000-8000-000000000000', amountPaisa: 100000, reasonCode: 'DISPUTE_PARTIAL', reasonText: 'Half the work was not done' } } })
  async refund(@Body() body: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.finance.refund(principal.userId, parseWith(refundSchema, body));
  }

  @Get('payouts')
  @PolicyDecorator(FINANCE)
  @ApiOperation({ summary: 'List payout requests', description: 'Providers’ payout requests and where each stands (REQUESTED, APPROVED, IN_BATCH, PAID, FAILED). Filter by status.' })
  @ApiQueryField('status', { description: 'REQUESTED, APPROVED, IN_BATCH, PAID or FAILED' })
  async payoutList(@Query() query: unknown) {
    return { items: await this.payouts.list(parseWith(statusQuery, query).status) };
  }

  @Post('payouts/:id/approve')
  @HttpCode(200)
  @PolicyDecorator(FINANCE)
  @ApiOperation({ summary: 'Approve a payout', description: "Moves the amount out of the provider's wallet into payout clearing, once. 409 if it is not a pending request or the wallet no longer covers it." })
  async approve(@Param('id', ParseUUIDPipe) id: string, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.payouts.approve(id, principal.userId);
  }

  @Get('payout-batches')
  @PolicyDecorator(FINANCE)
  @ApiOperation({ summary: 'List payout batches', description: 'Batches sent to the bank, newest first, with totals and status.' })
  async batches() {
    return { items: await this.payouts.listBatches() };
  }

  @Post('payout-batches')
  @HttpCode(201)
  @PolicyDecorator(FINANCE)
  @ApiOperation({ summary: 'Create a payout batch', description: 'Gathers every approved payout that is not yet in a batch into one bank file. 409 if there is nothing to batch.' })
  @ApiZodBody(batchSchema, { default: { summary: 'The week to Sunday', value: { periodStart: '2026-10-05', periodEnd: '2026-10-11' } } })
  async createBatch(@Body() body: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    const { periodStart, periodEnd } = parseWith(batchSchema, body);
    return this.payouts.createBatch(principal.userId, periodStart, periodEnd);
  }

  @Get('payout-batches/:id/export.csv')
  @PolicyDecorator(FINANCE)
  @Header('Content-Type', 'text/csv')
  @ApiOperation({ summary: 'Download the bank file', description: 'The batch as CSV with full account numbers, for uploading to the bank. Every download is written to the audit log.' })
  async exportCsv(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) response: Response, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    response.setHeader('Content-Disposition', `attachment; filename="payout-batch-${id}.csv"`);
    return new StreamableFile(Buffer.from(await this.payouts.exportCsv(id, principal.userId), 'utf8'));
  }

  @Get('payout-batches/:id/statements/:providerId')
  @PolicyDecorator(FINANCE)
  @Header('Content-Type', 'application/pdf')
  @ApiOperation({ summary: 'A provider’s statement for a batch', description: 'A PDF listing that provider’s payouts in the batch.' })
  async statement(@Param('id', ParseUUIDPipe) id: string, @Param('providerId', ParseUUIDPipe) providerId: string) {
    return new StreamableFile(await this.payouts.statementPdf(id, providerId));
  }

  @Post('payout-batches/:id/mark-paid')
  @HttpCode(200)
  @PolicyDecorator(FINANCE)
  @ApiOperation({
    summary: 'Record the bank’s result for a batch',
    description:
      "Leave the body empty to mark every payout in the batch paid. Or list each payout as PAID or FAILED: a failed one goes straight back into the provider's wallet with the reason stored, so the ledger reverses cleanly and they can request again. Safe to repeat — a payout already settled is skipped."
  })
  @ApiZodBody(markSchema, { default: { summary: 'One paid, one failed', value: { results: [{ payoutId: '00000000-0000-4000-8000-000000000000', status: 'FAILED', failureReason: 'Account closed' }] } } })
  async markPaid(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.payouts.markBatch(id, principal.userId, parseWith(markSchema, body ?? {}).results);
  }

  @Get('cash-reconciliation')
  @PolicyDecorator(FINANCE)
  @ApiOperation({ summary: 'Reconcile cash jobs', description: 'Per provider: cash jobs settled and the commission they produced, jobs verified but not yet confirmed as paid (the provider may be holding cash), and their wallet.' })
  async cash() {
    return this.finance.cashReconciliation();
  }

  @Get('debts')
  @PolicyDecorator(FINANCE)
  @ApiOperation({ summary: 'List commission debts', description: 'Providers whose wallet is negative, largest debt first, and whether their offers are blocked.' })
  async debts() {
    return this.finance.debts();
  }

  @Get('ledger')
  @PolicyDecorator(FINANCE)
  @ApiOperation({ summary: 'Explore the ledger', description: 'Ledger entries, newest first, filtered by account type, provider (owner) or booking. Page with `before` set to the previous `nextBefore`.' })
  @ApiQueryField('accountType', { description: 'e.g. ESCROW, PROVIDER_WALLET, PLATFORM_COMMISSION' })
  @ApiQueryField('ownerId', { description: 'The provider (or customer) an account belongs to' })
  @ApiQueryField('bookingId', { description: 'Only entries of this booking’s transactions' })
  @ApiQueryField('before', { type: 'number', description: 'Return entries with an id below this' })
  @ApiQueryField('limit', { type: 'number', description: '1–200, default 50' })
  async ledger(@Query() query: unknown) {
    return this.finance.ledger(parseWith(ledgerQuery, query));
  }

  @Post('reconciliation/run')
  @HttpCode(200)
  @PolicyDecorator(FINANCE)
  @ApiOperation({ summary: 'Run the ledger reconciliation now', description: 'Checks derived balances, ledger balance, gateway records and escrow against the ledger entries. Returns every drift found; any drift is also logged, audited and raised as an event. The same check runs nightly.' })
  async reconcile(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.reconciliation.run(principal.userId);
  }
}
