// apps/api/src/provider/provider-documents-admin.controller.ts
import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, PolicyDecorator, type AuthenticatedPrincipal } from '../common/policy.js';
import { ApiZodBody } from '../common/swagger.js';
import { parseWith } from '../common/validation.js';
import { documentReviewSchema } from './provider-documents.schemas.js';
import { ProviderDocumentsService } from './provider-documents.service.js';

/**
 * FR-AD-10 / NFR-PR-03: the admin side of identity-document review.
 *
 * Every route here is `roles: ['ADMIN'], totpRequired: true`, which is what makes the
 * SHM-022 criterion "agent and finance roles get 403" hold — the policy guard rejects
 * a role that is not listed before the handler ever runs, so an agent cannot reach a
 * provider's CNIC scan by any route in this controller.
 */
@ApiTags('provider')
@ApiBearerAuth('access-token')
@Controller('admin')
export class ProviderDocumentsAdminController {
  constructor(@Inject(ProviderDocumentsService) private readonly documents: ProviderDocumentsService) {}

  @Get('providers/:providerId/documents')
  @PolicyDecorator({ roles: ['ADMIN'], totpRequired: true })
  @ApiOperation({
    summary: "List a provider's documents for review",
    description: 'Admin only (403 for agents and finance). Returns every document the provider has submitted with its review state. Fetch a file with the signed-url route below.'
  })
  async listForProvider(@Param('providerId', ParseUUIDPipe) providerId: string) {
    const [items, cnic] = await Promise.all([this.documents.listForProvider(providerId), this.documents.cnicReviewState(providerId)]);
    return { items, cnic };
  }

  @Get('documents/:documentId/url')
  @PolicyDecorator({ roles: ['ADMIN'], totpRequired: true })
  @ApiOperation({
    summary: 'Get a short-lived link to a document',
    description:
      'Admin only (403 for agents and finance). Returns a signed link valid for five minutes and records the view in the audit log, with the admin who asked. 404 if the file is not in storage.'
  })
  async documentUrl(@Param('documentId', ParseUUIDPipe) documentId: string, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.documents.signedUrl(documentId, { userId: principal.userId, role: 'ADMIN' });
  }

  @Post('documents/:documentId/review')
  @HttpCode(200)
  @PolicyDecorator({ roles: ['ADMIN'], totpRequired: true })
  @ApiOperation({
    summary: 'Verify or reject a document',
    description: 'Admin only. A rejection requires a note, because it is what the provider is told. The decision is written to the audit log.'
  })
  @ApiZodBody(documentReviewSchema, { default: { summary: 'Reject a blurry scan', value: { status: 'REJECTED', note: 'The CNIC number is not legible — please re-upload a clearer photo.' } } })
  async review(@Param('documentId', ParseUUIDPipe) documentId: string, @Body() body: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.documents.review(documentId, principal.userId, parseWith(documentReviewSchema, body));
  }
}
