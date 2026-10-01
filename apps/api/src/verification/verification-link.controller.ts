// apps/api/src/verification/verification-link.controller.ts
import { Body, Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Public } from '../common/policy.js';
import { ApiZodBody } from '../common/swagger.js';
import { parseWith } from '../common/validation.js';
import { VerificationLinkService } from './verification-link.service.js';

const score = z.number().int().min(1).max(5);

const responseSchema = z
  .object({
    otp: z.string().trim().regex(/^\d{6}$/, 'The code is 6 digits'),
    workCompleted: z.enum(['FULL', 'PARTIAL', 'NONE']),
    quality: score,
    punctuality: score,
    conduct: score,
    cleanliness: score,
    extraChargeDemanded: z.boolean(),
    consentToRelease: z.boolean()
  })
  .strict();

const tokenSchema = z.string().min(20).max(100);

@ApiTags('verification')
@Controller('v')
export class VerificationLinkController {
  constructor(@Inject(VerificationLinkService) private readonly links: VerificationLinkService) {}

  @Get(':token')
  @Public()
  @ApiOperation({
    summary: 'Open a verification link (customer)',
    description: 'What a customer sees when they open the link we texted them: enough to recognise the job, and the short questionnaire. The one-time code from the text is asked for when they answer. 404 for an unknown link; 410 once it has expired or been used.'
  })
  async describe(@Param('token') token: string) {
    return this.links.describe(parseWith(tokenSchema, token));
  }

  @Post(':token')
  @HttpCode(200)
  @Public()
  @ApiOperation({
    summary: 'Answer a verification link (customer)',
    description:
      "Confirms the job with the code from the text plus the short questionnaire. A clean, consenting answer confirms the job and releases payment. Any sign of a problem (work not done, extra money asked for, no consent) releases nothing and sends the case to a person, who will call. 422 for a wrong code (the fifth wrong code returns 423 and locks the link); 410 for an expired or used link."
  })
  @ApiZodBody(responseSchema, { default: { summary: 'Everything was fine', value: { otp: '123456', workCompleted: 'FULL', quality: 5, punctuality: 5, conduct: 5, cleanliness: 4, extraChargeDemanded: false, consentToRelease: true } } })
  async respond(@Param('token') token: string, @Body() body: unknown) {
    return this.links.respond(parseWith(tokenSchema, token), parseWith(responseSchema, body));
  }
}
