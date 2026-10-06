// apps/api/src/provider/uploads.controller.ts
import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, PolicyDecorator, type AuthenticatedPrincipal } from '../common/policy.js';
import { ApiZodBody } from '../common/swagger.js';
import { parseWith } from '../common/validation.js';
import { documentPresignSchema } from './provider-documents.schemas.js';
import { ProviderDocumentsService } from './provider-documents.service.js';

/**
 * FR-SP-06: the generic upload handshake. Kept off `/provider` because a real object
 * store URL is not namespaced per subject, but the key it mints is scoped to the
 * caller — so the provider who requested it is the only one who can confirm it.
 */
@ApiTags('provider')
@ApiBearerAuth('access-token')
@Controller('uploads')
export class UploadsController {
  constructor(@Inject(ProviderDocumentsService) private readonly documents: ProviderDocumentsService) {}

  @Post('presign')
  @HttpCode(200)
  @PolicyDecorator({ roles: ['PROVIDER'] })
  @ApiOperation({
    summary: 'Get an upload target for a document',
    description:
      'Returns a short-lived signed upload URL plus the storage key to confirm the file under. Upload the bytes to the URL, then POST /provider/documents with that key. Only JPEG, PNG and PDF are accepted, up to 5 MB.'
  })
  @ApiZodBody(documentPresignSchema, { default: { summary: 'A CNIC front scan', value: { docType: 'CNIC_FRONT', contentType: 'image/jpeg' } } })
  async presign(@Body() body: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.documents.presign(principal.userId, parseWith(documentPresignSchema, body));
  }
}
