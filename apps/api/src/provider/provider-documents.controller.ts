// apps/api/src/provider/provider-documents.controller.ts
import { Body, Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, PolicyDecorator, type AuthenticatedPrincipal } from '../common/policy.js';
import { ApiZodBody } from '../common/swagger.js';
import { parseWith } from '../common/validation.js';
import { documentSubmitSchema } from './provider-documents.schemas.js';
import { ProviderDocumentsService } from './provider-documents.service.js';

/** FR-SP-06: the provider side of identity-document upload — their own documents only. */
@ApiTags('provider')
@ApiBearerAuth('access-token')
@Controller('provider/documents')
export class ProviderDocumentsController {
  constructor(@Inject(ProviderDocumentsService) private readonly documents: ProviderDocumentsService) {}

  @Get()
  @PolicyDecorator({ roles: ['PROVIDER'] })
  @ApiOperation({
    summary: 'List my uploaded documents',
    description: 'Returns every document you have submitted, newest first, with its review state. Upload a replacement if one was rejected.'
  })
  async list(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    const [items, cnic] = await Promise.all([this.documents.listMine(principal.userId), this.documents.cnicReviewState(principal.userId)]);
    return { items, cnic };
  }

  @Post()
  @HttpCode(201)
  @PolicyDecorator({ roles: ['PROVIDER'] })
  @ApiOperation({
    summary: 'Submit an identity document',
    description:
      'Records a CNIC front/back, trade certificate or optional character certificate. Send either the bytes inline (contentBase64) or a storageKey from POST /uploads/presign. A cnicNumber is encrypted at rest and never returned by any endpoint — only whether one is on file and whether it has been verified. The same CNIC cannot be registered twice.'
  })
  @ApiZodBody(documentSubmitSchema, { default: { summary: 'CNIC front, uploaded inline', value: { docType: 'CNIC_FRONT', contentType: 'image/jpeg', contentBase64: 'iVBORw0KGgoAAAANSUhEUg==', cnicNumber: '35202-1234567-1' } } })
  async submit(@Body() body: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.documents.submit(principal.userId, principal.userId, parseWith(documentSubmitSchema, body));
  }
}
