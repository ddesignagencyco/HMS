// apps/api/src/payment/dev-payments.controller.ts
import { Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'node:crypto';
import { DomainError } from '../common/domain-error.js';
import { Public } from '../common/policy.js';
import { EnvironmentService } from '../config/environment.service.js';
import { PaymentsService } from './payments.service.js';

/** Kept out of the integrations module on purpose: PaymentsService depends on that module for the gateway port, so importing it back would be a cycle. */
@ApiTags('development')
@Controller('dev/payments')
export class DevPaymentsController {
  constructor(
    @Inject(EnvironmentService) private readonly environment: EnvironmentService,
    @Inject(PaymentsService) private readonly payments: PaymentsService
  ) {}

  @Get(':paymentId')
  @Public()
  @ApiOperation({
    summary: 'Mock payment page (where the mock gateway redirects to)',
    description: "Development-only stand-in for a payment provider's hosted page. Returns what would be shown; use POST /dev/payments/{paymentId}/complete to pay or fail it."
  })
  async page(@Param('paymentId', ParseUUIDPipe) paymentId: string, @Query('returnUrl') returnUrl?: string) {
    this.assertEnabled();
    return { paymentId, returnUrl: returnUrl ?? null, actions: { pay: `/api/v1/dev/payments/${paymentId}/complete?outcome=captured`, fail: `/api/v1/dev/payments/${paymentId}/complete?outcome=failed` } };
  }

  @Post(':paymentId/complete')
  @HttpCode(200)
  @Public()
  @ApiOperation({
    summary: 'Complete a mock payment',
    description: "Development-only: plays the part of the gateway, delivering its 'payment captured' (or 'failed') event through the same path as a real signed webhook, so a whole online checkout can be driven locally."
  })
  async complete(@Param('paymentId', ParseUUIDPipe) paymentId: string, @Query('outcome') outcome?: string) {
    this.assertEnabled();
    const type = outcome === 'failed' ? 'payment.failed' : 'payment.captured';
    return this.payments.ingestWebhookEvent('mock', { eventId: `dev-${randomUUID()}`, paymentId, type, occurredAt: new Date().toISOString(), payload: { source: 'dev-console' } });
  }

  private assertEnabled(): void {
    if (!this.environment.values.DEV_INBOX_ENABLED) throw new DomainError('FORBIDDEN', 'Development endpoints are disabled in this environment');
  }
}
