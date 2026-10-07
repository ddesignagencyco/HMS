import { Controller, HttpCode, Inject, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, PolicyDecorator, type AuthenticatedPrincipal } from '../common/policy.js';
import { ProviderAdminService } from './provider-admin.service.js';

@ApiTags('provider')
@ApiBearerAuth('access-token')
@Controller('admin/providers')
export class ProviderAdminController {
  constructor(@Inject(ProviderAdminService) private readonly admin: ProviderAdminService) {}

  @Post(':providerId/block')
  @HttpCode(200)
  @PolicyDecorator({ roles: ['ADMIN'], totpRequired: true })
  @ApiOperation({ summary: 'Block a provider', description: 'Admin only. Moves an approved provider to BLOCKED so they stop receiving work. Separate from a conduct penalty.' })
  async block(@Param('providerId', ParseUUIDPipe) providerId: string, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.admin.block(principal.userId, providerId);
  }

  @Post(':providerId/unblock')
  @HttpCode(200)
  @PolicyDecorator({ roles: ['ADMIN'], totpRequired: true })
  @ApiOperation({ summary: 'Unblock a provider', description: 'Admin only. Returns a BLOCKED provider to APPROVED.' })
  async unblock(@Param('providerId', ParseUUIDPipe) providerId: string, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.admin.unblock(principal.userId, providerId);
  }

  @Post(':providerId/deactivate')
  @HttpCode(200)
  @PolicyDecorator({ roles: ['ADMIN'], totpRequired: true })
  @ApiOperation({ summary: 'Deactivate a provider', description: 'Admin only. Soft deactivation (FR-AD-09): the provider is disabled, never deleted.' })
  async deactivate(@Param('providerId', ParseUUIDPipe) providerId: string, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.admin.deactivate(principal.userId, providerId);
  }
}
