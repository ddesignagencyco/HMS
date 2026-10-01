// apps/api/src/booking/message.controller.ts
import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentPrincipal, PolicyDecorator, type AuthenticatedPrincipal } from '../common/policy.js';
import { ApiZodBody } from '../common/swagger.js';
import { parseWith } from '../common/validation.js';
import { MessageService } from './message.service.js';

const messageSchema = z.object({ body: z.string().trim().min(1).max(2000) }).strict();

@ApiTags('booking')
@ApiBearerAuth('access-token')
@Controller('bookings/:id/messages')
export class MessageController {
  constructor(@Inject(MessageService) private readonly messages: MessageService) {}

  @Get()
  @PolicyDecorator({ roles: ['CUSTOMER', 'PROVIDER'] })
  @ApiOperation({
    summary: 'Read the booking chat',
    description: "The conversation between the booking's customer and provider, oldest first; reading marks the other side's messages as read. `open` says whether new messages can still be sent. Anyone else gets a 404."
  })
  async list(@Param('id', ParseUUIDPipe) id: string, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.messages.list(id, principal.userId);
  }

  @Post()
  @HttpCode(201)
  @PolicyDecorator({ roles: ['CUSTOMER', 'PROVIDER'] })
  @ApiOperation({
    summary: 'Send a chat message',
    description:
      "Sends a message to the other party, from the moment a provider is assigned until the job is finished or cancelled (409 after that). Phone numbers and email addresses are replaced with [number hidden] / [email hidden] before the message is stored, and the response says whether that happened (masked)."
  })
  @ApiZodBody(messageSchema, { default: { summary: 'Ask about access', value: { body: 'I am at the gate, which floor are you on?' } } })
  async send(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.messages.send(id, principal.userId, parseWith(messageSchema, body).body);
  }
}
