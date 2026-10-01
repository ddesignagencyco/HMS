import { Body, Controller, Headers, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { DomainError } from '../common/domain-error.js';
import { Public } from '../common/policy.js';
import { ApiZodBody } from '../common/swagger.js';
import { parseWith } from '../common/validation.js';
import { PAYMENT_GATEWAY } from '../integrations/integrations.module.js';
import type { ParsedPaymentEvent, PaymentGatewayPort } from '../integrations/ports.js';
import { PaymentsService, type WebhookIngestResult } from '../payment/payments.service.js';

const providerSchema = z.enum(['mock']);
const eventSchema = z.object({ eventId: z.string().min(1).max(200), paymentId: z.string().uuid(), type: z.string().min(1).max(100), occurredAt: z.string().min(1), payload: z.record(z.unknown()) });

@ApiTags('webhooks')
@Controller('webhooks/payments')
export class PaymentWebhookController {
  constructor(
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGatewayPort,
    @Inject(PaymentsService) private readonly payments: PaymentsService
  ) {}

  @Post(':provider')
  @HttpCode(202)
  @Public()
  @ApiOperation({
    summary: 'Payment provider webhook (not for direct use)',
    description:
      "Called automatically by the payment gateway to report events like a completed or failed payment. The request must carry the gateway's signature to prove it is genuine. If the same event is delivered more than once (gateways commonly retry), later copies are recognized and safely ignored instead of being processed twice."
  })
  @ApiZodBody(eventSchema, {
    default: { summary: 'Payment captured', value: { eventId: 'evt_1', paymentId: '11111111-1111-1111-1111-111111111111', type: 'payment.captured', occurredAt: '2026-01-01T00:00:00Z', payload: {} } }
  })
  async receive(
    @Req() request: Request,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() body: unknown,
    @Param('provider') rawProvider: string
  ): Promise<WebhookIngestResult> {
    const { provider } = parseWith(z.object({ provider: providerSchema }).strict(), { provider: rawProvider });
    const rawBody = (request.rawBody ?? Buffer.from(JSON.stringify(body))).toString('utf8');
    let parsed: ParsedPaymentEvent;
    try {
      parsed = this.gateway.verifyWebhook(headers, rawBody);
    } catch (error) {
      throw new DomainError('UNAUTHENTICATED', error instanceof Error ? error.message : 'Webhook signature verification failed');
    }
    const event = parseWith(eventSchema, parsed);

    return this.payments.ingestWebhookEvent(provider, event);
  }
}
