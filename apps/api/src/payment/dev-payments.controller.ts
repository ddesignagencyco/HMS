// apps/api/src/payment/dev-payments.controller.ts
import { Controller, Get, Headers, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
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
  async page(
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @Query('returnUrl') returnUrl?: string,
    @Headers('accept') accept?: string,
    @Res({ passthrough: true }) res?: Response
  ) {
    this.assertEnabled();
    const payUrl = `/api/v1/dev/payments/${paymentId}/complete?outcome=captured${returnUrl ? `&returnUrl=${encodeURIComponent(returnUrl)}` : ''}`;
    const failUrl = `/api/v1/dev/payments/${paymentId}/complete?outcome=failed${returnUrl ? `&returnUrl=${encodeURIComponent(returnUrl)}` : ''}`;

    if (accept?.includes('text/html') && res) {
      res.setHeader('Content-Type', 'text/html');
      return res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SmartHome Pay — Gateway Simulation</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-slate-900 text-slate-100 flex min-h-screen items-center justify-center p-4 antialiased">
  <div class="w-full max-w-md rounded-2xl bg-slate-800 border border-slate-700/80 shadow-2xl p-6 sm:p-8">
    <div class="flex items-center justify-between border-b border-slate-700/60 pb-5">
      <div class="flex items-center gap-3">
        <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white font-bold text-lg shadow-lg shadow-blue-500/30">
          ⚡
        </div>
        <div>
          <h1 class="text-base font-bold text-white tracking-tight">SmartHome Pay</h1>
          <p class="text-xs text-blue-400 font-medium">Gateway Simulator (Sandbox)</p>
        </div>
      </div>
      <span class="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-400 border border-emerald-500/20">
        SSL Encrypted
      </span>
    </div>

    <div class="my-6 rounded-xl bg-slate-900/80 border border-slate-700/40 p-4 space-y-2.5 text-xs">
      <div class="flex justify-between text-slate-400">
        <span>Payment ID</span>
        <span class="font-mono text-slate-200">${paymentId.slice(0, 13)}...</span>
      </div>
      <div class="flex justify-between text-slate-400">
        <span>Environment</span>
        <span class="text-amber-400 font-medium">Development Mock</span>
      </div>
      <div class="flex justify-between text-slate-400">
        <span>Authorization</span>
        <span class="text-emerald-400 font-medium">Ready to Capture</span>
      </div>
    </div>

    <p class="text-xs text-slate-300 mb-6 leading-relaxed">
      This is a sandbox simulation of the external banking gateway (JazzCash / EasyPaisa / Card). Confirm payment capture below to simulate successful payment settlement.
    </p>

    <div class="space-y-3">
      <a href="${payUrl}" class="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-600/25 hover:bg-emerald-500 transition-all text-center">
        ✓ Confirm & Authorize Payment
      </a>
      <a href="${failUrl}" class="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-700/80 px-4 py-2.5 text-xs font-medium text-slate-300 hover:bg-slate-700 hover:text-white transition-all text-center">
        Cancel / Simulate Failed Payment
      </a>
    </div>

    <p class="mt-6 text-center text-[11px] text-slate-400">
      Upon authorization, you will be redirected automatically back to the booking confirmation and invoice download page.
    </p>
  </div>
</body>
</html>`);
    }

    return {
      paymentId,
      returnUrl: returnUrl ?? null,
      actions: {
        pay: { method: 'GET', url: payUrl },
        fail: { method: 'GET', url: failUrl }
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
  async completeGet(
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @Query('outcome') outcome?: string,
    @Query('returnUrl') returnUrl?: string,
    @Res({ passthrough: true }) res?: Response
  ) {
    const result = await this.complete(paymentId, outcome);
    if (returnUrl && res) {
      res.redirect(returnUrl);
      return;
    }
    return result;
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
