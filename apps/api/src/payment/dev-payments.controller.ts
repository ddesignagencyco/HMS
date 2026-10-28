// apps/api/src/payment/dev-payments.controller.ts
import { Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'node:crypto';
import { DomainError, validationFailed } from '../common/domain-error.js';
import { Public } from '../common/policy.js';
import { EnvironmentService } from '../config/environment.service.js';
import { PaymentsService } from './payments.service.js';

/** Kept out of the integrations module on purpose: PaymentsService depends on that module for the gateway port, so importing it back would be a cycle. */
@ApiTags('development')
@Controller('dev/payments')
export class DevPaymentsController {
  /** What `?outcome=` is allowed to say. Anything else is refused rather than guessed at. */
  private static readonly OUTCOMES = ['captured', 'failed'] as const;

  constructor(
    @Inject(EnvironmentService) private readonly environment: EnvironmentService,
    @Inject(PaymentsService) private readonly payments: PaymentsService
  ) {}

  @Get(':paymentId')
  @Public()
  @ApiOperation({
    summary: 'Mock payment page (where the mock gateway redirects to)',
    description:
      "Development-only stand-in for a payment provider's hosted page. The `actions` it returns are absolute-enough paths that work in a browser: open either one and it completes the payment, by GET as well as POST. In production this is the provider's own page and none of this exists."
  })
  async page(@Param('paymentId', ParseUUIDPipe) paymentId: string, @Query('returnUrl') returnUrl?: string) {
    this.assertEnabled();
    return {
      paymentId,
      returnUrl: returnUrl ?? null,
      // Named per verb, because the failure this page caused was a browser GETting a POST-only URL
      // and getting a 404 with no hint that the method was the problem.
      actions: {
        pay: { method: 'GET', url: `/api/v1/dev/payments/${paymentId}/complete?outcome=captured` },
        fail: { method: 'GET', url: `/api/v1/dev/payments/${paymentId}/complete?outcome=failed` }
      }
    };
  }

  @Post(':paymentId/complete')
  @HttpCode(200)
  @Public()
  @ApiOperation({
    summary: 'Complete a mock payment',
    description:
      "Development-only: plays the part of the gateway, delivering its 'payment captured' (or 'failed') event through the same path as a real signed webhook, so a whole online checkout can be driven locally. Also accepts GET, so the links on the mock payment page work when they are simply clicked."
  })
  async completePost(@Param('paymentId', ParseUUIDPipe) paymentId: string, @Query('outcome') outcome?: string) {
    return this.complete(paymentId, outcome);
  }

  /**
   * The same operation by GET. A hosted payment page is a web page: its Pay and Cancel controls are
   * links, and a mock that only answers POST cannot be driven by a human clicking through checkout.
   * The route stays `@Public()` and dev-gated, so this adds no reachable surface in production —
   * `DEV_INBOX_ENABLED` is false there and the whole controller refuses.
   */
  @Get(':paymentId/complete')
  @Public()
  @ApiOperation({ summary: 'Complete a mock payment (browser-navigable)', description: 'Identical to POST /dev/payments/{paymentId}/complete. Exists so the Pay and Fail links on the mock payment page work when clicked.' })
  async completeGet(@Param('paymentId', ParseUUIDPipe) paymentId: string, @Query('outcome') outcome?: string) {
    return this.complete(paymentId, outcome);
  }

  private async complete(paymentId: string, outcome: string | undefined) {
    this.assertEnabled();
    // A missing or misspelled `outcome` used to fall through to `payment.captured`, so `?outcome=succes`
    // captured money. On a payment path, an unrecognised value is a mistake to name, not a default.
    if (outcome === undefined || !DevPaymentsController.OUTCOMES.includes(outcome as (typeof DevPaymentsController.OUTCOMES)[number])) {
      throw validationFailed([
        {
          path: 'outcome',
          code: 'unknown_outcome',
          message: `outcome must be one of ${DevPaymentsController.OUTCOMES.join(', ')}`
        }
      ]);
    }
    const type = outcome === 'failed' ? 'payment.failed' : 'payment.captured';
    return this.payments.ingestWebhookEvent('mock', { eventId: `dev-${randomUUID()}`, paymentId, type, occurredAt: new Date().toISOString(), payload: { source: 'dev-console' } });
  }

  private assertEnabled(): void {
    if (!this.environment.values.DEV_INBOX_ENABLED) throw new DomainError('FORBIDDEN', 'Development endpoints are disabled in this environment');
  }
}
