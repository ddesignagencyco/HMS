// apps/api/src/notification/notification.controller.ts
import { Body, Controller, Get, Headers, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { DomainError } from '../common/domain-error.js';
import { CurrentPrincipal, PolicyDecorator, Public, type AuthenticatedPrincipal } from '../common/policy.js';
import { ApiQueryField, ApiZodBody } from '../common/swagger.js';
import { parseWith } from '../common/validation.js';
import { EnvironmentService } from '../config/environment.service.js';
import { assertMockSignature } from '../integrations/mocks.js';
import { NotificationCentreService } from './notification-centre.service.js';
import { NotificationService } from './notification.service.js';
import { TemplateService } from './template.service.js';

const ANY_USER = { roles: ['CUSTOMER', 'PROVIDER', 'AGENT', 'FINANCE', 'ADMIN'] } as const;
const ADMIN = { roles: ['ADMIN'], totpRequired: true } as const;

const ownQuery = z.object({ unread: z.enum(['true', 'false']).optional(), limit: z.coerce.number().int().min(1).max(100).default(30) }).strict();
const logQuery = z
  .object({
    userId: z.string().uuid().optional(),
    eventKey: z.string().trim().max(100).optional(),
    channel: z.enum(['SMS', 'EMAIL', 'IN_APP', 'WHATSAPP']).optional(),
    status: z.enum(['QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'READ']).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50)
  })
  .strict();
const templateListQuery = z.object({ eventKey: z.string().trim().max(100).optional(), channel: z.enum(['SMS', 'EMAIL', 'IN_APP', 'WHATSAPP']).optional(), locale: z.enum(['en', 'ur']).optional() }).strict();
const templateBody = z.object({ subject: z.string().trim().max(200).nullable().optional(), body: z.string().trim().min(1).max(1000), isActive: z.boolean().optional() }).strict();
const templateCreate = templateBody.extend({ eventKey: z.string().trim().min(3).max(100), channel: z.enum(['SMS', 'EMAIL', 'IN_APP', 'WHATSAPP']), locale: z.enum(['en', 'ur']) }).strict();
const previewSchema = z.object({ body: z.string().max(1000), subject: z.string().max(200).nullable().optional(), variables: z.record(z.string()).optional() }).strict();
const receiptSchema = z.object({ messageId: z.string().min(1).max(200), status: z.enum(['DELIVERED', 'FAILED']), occurredAt: z.string().datetime(), error: z.string().max(300).optional() }).strict();

@ApiTags('notifications')
@ApiBearerAuth('access-token')
@Controller()
export class NotificationController {
  constructor(
    @Inject(NotificationCentreService) private readonly centre: NotificationCentreService,
    @Inject(NotificationService) private readonly notifications: NotificationService,
    @Inject(TemplateService) private readonly templates: TemplateService,
    @Inject(EnvironmentService) private readonly environment: EnvironmentService
  ) {}

  @Get('notifications')
  @PolicyDecorator(ANY_USER)
  @ApiOperation({ summary: 'My notification centre', description: 'Your in-app notifications, newest first, with the count of unread ones. `unread=true` for unread only. Written in your language.' })
  @ApiQueryField('unread', { description: 'true for unread only' })
  @ApiQueryField('limit', { type: 'number', description: '1–100, default 30' })
  async own(@Query() query: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    const { unread, limit } = parseWith(ownQuery, query);
    return this.centre.listOwn(principal.userId, { unreadOnly: unread === 'true', limit });
  }

  @Post('notifications/read-all')
  @HttpCode(200)
  @PolicyDecorator(ANY_USER)
  @ApiOperation({ summary: 'Mark all my notifications read', description: 'Marks every unread in-app notification of yours as read and says how many.' })
  async readAll(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.centre.markAllRead(principal.userId);
  }

  @Post('notifications/:id/read')
  @HttpCode(200)
  @PolicyDecorator(ANY_USER)
  @ApiOperation({ summary: 'Mark one notification read', description: 'Marks one of your in-app notifications as read. Someone else’s is a 404.' })
  async read(@Param('id', ParseUUIDPipe) id: string, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.centre.markRead(principal.userId, id);
  }

  @Get('admin/notifications')
  @PolicyDecorator(ADMIN)
  @ApiOperation({ summary: 'The notification delivery log', description: 'Admin only. Every notification with its recipient, channel, template, status (QUEUED, SENT, DELIVERED, FAILED, READ), the reason if it failed and how many attempts were made. Filter by user, event, channel or status.' })
  @ApiQueryField('userId', { description: 'Only this recipient' })
  @ApiQueryField('eventKey', { description: 'e.g. booking.accepted' })
  @ApiQueryField('channel', { description: 'SMS, EMAIL, IN_APP or WHATSAPP' })
  @ApiQueryField('status', { description: 'QUEUED, SENT, DELIVERED, FAILED or READ' })
  async log(@Query() query: unknown) {
    return this.centre.log(parseWith(logQuery, query));
  }

  @Get('admin/templates')
  @PolicyDecorator(ADMIN)
  @ApiOperation({ summary: 'List notification templates', description: 'Admin only. Every template per event × channel × language, and the placeholders a template may use.' })
  @ApiQueryField('eventKey', { description: 'e.g. booking.accepted' })
  @ApiQueryField('channel', { description: 'SMS, EMAIL, IN_APP or WHATSAPP' })
  @ApiQueryField('locale', { description: 'en or ur' })
  async listTemplates(@Query() query: unknown) {
    return this.templates.list(parseWith(templateListQuery, query));
  }

  @Post('admin/templates/preview')
  @HttpCode(200)
  @PolicyDecorator(ADMIN)
  @ApiOperation({ summary: 'Preview a template', description: 'Admin only. Renders a draft with sample values (or your own `variables`) and lists any placeholder the system would not fill in, without saving anything.' })
  @ApiZodBody(previewSchema, { default: { summary: 'Preview', value: { body: 'Hello, {{providerName}} is on the way for {{serviceName}}.' } } })
  async preview(@Body() body: unknown) {
    return this.templates.preview(parseWith(previewSchema, body));
  }

  @Get('admin/templates/:id')
  @PolicyDecorator(ADMIN)
  @ApiOperation({ summary: 'Read a template', description: 'Admin only.' })
  async getTemplate(@Param('id', ParseUUIDPipe) id: string) {
    return this.templates.get(id);
  }

  @Post('admin/templates')
  @HttpCode(201)
  @PolicyDecorator(ADMIN)
  @ApiOperation({ summary: 'Create a template', description: 'Admin only. A new event × channel × language. 409 if it already exists; 422 for a placeholder the system does not fill in. Audited.' })
  @ApiZodBody(templateCreate, { default: { summary: 'An Urdu SMS', value: { eventKey: 'booking.confirmed', channel: 'SMS', locale: 'ur', body: 'آپ کا وزٹ {{slotLabel}} کو تصدیق شدہ ہے۔' } } })
  async createTemplate(@Body() body: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.templates.create(principal.userId, parseWith(templateCreate, body));
  }

  @Put('admin/templates/:id')
  @PolicyDecorator(ADMIN)
  @ApiOperation({ summary: 'Edit a template', description: 'Admin only. Changes the wording (and optionally switches it off) — takes effect for the next notification, no deploy. 422 for a placeholder the system does not fill in. Audited with the old text.' })
  @ApiZodBody(templateBody, { default: { summary: 'New wording', value: { body: 'Your {{serviceName}} visit is confirmed for {{slotLabel}}.' } } })
  async updateTemplate(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.templates.update(principal.userId, id, parseWith(templateBody, body));
  }

  @Post('webhooks/sms/:provider')
  @HttpCode(202)
  @Public()
  @ApiOperation({
    summary: 'SMS delivery receipt (not for direct use)',
    description: "Called by the SMS provider to say a message was delivered or failed. Must carry the provider's signature (401 otherwise). Moves the notification from SENT to DELIVERED, or FAILED with the reason; a repeated or out-of-order receipt changes nothing."
  })
  @ApiZodBody(receiptSchema, { default: { summary: 'Delivered', value: { messageId: 'abc-123', status: 'DELIVERED', occurredAt: '2026-10-05T10:31:00Z' } } })
  async receipt(@Req() request: Request, @Headers() headers: Record<string, string | string[] | undefined>, @Body() body: unknown, @Param('provider') provider: string) {
    if (provider !== 'mock') throw new DomainError('NOT_FOUND', 'Unknown SMS provider');
    const rawBody = (request.rawBody ?? Buffer.from(JSON.stringify(body))).toString('utf8');
    try {
      assertMockSignature(this.environment.values.MOCK_PAYMENT_WEBHOOK_SECRET, headers, rawBody);
    } catch (error) {
      throw new DomainError('UNAUTHENTICATED', error instanceof Error ? error.message : 'Webhook signature verification failed');
    }
    const receipt = parseWith(receiptSchema, body);
    const outcome = await this.notifications.applyDeliveryReceipt({ messageId: receipt.messageId, status: receipt.status, error: receipt.error, occurredAt: new Date(receipt.occurredAt) });
    return { accepted: true, ...outcome };
  }
}
