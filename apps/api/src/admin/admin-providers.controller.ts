import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PROVIDER_STATUSES, listProvidersQuerySchema } from './admin.schemas.js';
import { ApiPageQuery } from '../common/paging.js';
import { PolicyDecorator } from '../common/policy.js';
import { ApiQueryField } from '../common/swagger.js';
import { parseWith } from '../common/validation.js';
import { AdminService } from './admin.service.js';

/** BE-008 (§3.3): the provider approval queue — who is waiting, as opposed to which user accounts exist. */
@ApiTags('admin')
@ApiBearerAuth('access-token')
@Controller('admin/providers')
export class AdminProvidersController {
  constructor(@Inject(AdminService) private readonly admin: AdminService) {}

  @Get()
  @PolicyDecorator({ roles: ['ADMIN'], totpRequired: true })
  @ApiOperation({
    summary: 'List providers by approval status',
    description:
      'Admin only. One row per provider with `providerId`, `name`, `phoneMasked`, `city`, `providerStatus`, `submittedAt` and `pendingDocumentsCount` (documents nobody has reviewed yet). `?status=PENDING_APPROVAL` is the approval queue, oldest submission first. Paged: `{ items, pagination: { total, page, limit, hasMore } }`.'
  })
  @ApiQueryField('status', { enum: PROVIDER_STATUSES, description: 'The provider’s approval status (not the user account status).' })
  @ApiQueryField('q', { description: 'Name or phone substring.' })
  @ApiPageQuery()
  async list(@Query() query: unknown) {
    return this.admin.listProviders(parseWith(listProvidersQuerySchema, query));
  }
}
