// apps/api/src/provider/provider-documents.controller.ts
import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post } from '@nestjs/common';
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

  @Get(':documentId/url')
  @PolicyDecorator({ roles: ['PROVIDER'] })
  @ApiOperation({
    summary: 'Get a short-lived link to one of my documents',
    description:
      'Returns a signed link valid for five minutes to a document you uploaded, so you can check it is legible. Not for the CNIC (403: identity documents are only ever seen by an admin); a document that is not yours is a 404, and so is a file that is no longer in storage.'
  })
  async documentUrl(@Param('documentId', ParseUUIDPipe) documentId: string, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.documents.signedUrlForOwner(documentId, principal.userId);
  }

  @Post()
  @HttpCode(201)
  @PolicyDecorator({ roles: ['PROVIDER'] })
  @ApiOperation({
    summary: 'Submit an identity document',
    description:
      'Records a CNIC front/back, trade certificate or optional character certificate. Send either the bytes inline (contentBase64) or a storageKey from POST /uploads/presign. A cnicNumber is encrypted at rest and never returned by any endpoint — only whether one is on file and whether it has been verified. The same CNIC cannot be registered twice. Inline bodies may be up to 8 MB (about a 5 MiB file once base64-encoded); anything larger answers 413 problem+json, and video documents (up to 50 MiB) must go through POST /uploads/presign. A storageKey is checked on confirm: the stored object must be an allowed type and within its size limit (5 MiB, or 50 MiB for video), otherwise 422 UPLOAD_REJECTED and the object is removed.'
  })
  @ApiZodBody(documentSubmitSchema, { default: { summary: 'CNIC front, uploaded inline', value: { docType: 'CNIC_FRONT', contentType: 'image/jpeg', contentBase64: 'iVBORw0KGgoAAAANSUhEUg==', cnicNumber: '35202-1234567-1' } } })
  async submit(@Body() body: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.documents.submit(principal.userId, principal.userId, parseWith(documentSubmitSchema, body));
  }
}
