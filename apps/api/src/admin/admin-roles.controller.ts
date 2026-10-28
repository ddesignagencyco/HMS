import { Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, PolicyDecorator, type AuthenticatedPrincipal } from '../common/policy.js';
import { parseWith } from '../common/validation.js';
import { AdminService } from './admin.service.js';
import { roleCodeSchema } from './admin.schemas.js';

@ApiTags('admin')
@ApiBearerAuth('access-token')
@Controller('admin')
export class AdminRolesController {
  constructor(@Inject(AdminService) private readonly admin: AdminService) {}

  @Get('roles')
  @PolicyDecorator({ roles: ['ADMIN'], totpRequired: true })
  @ApiOperation({ summary: 'List roles and their permissions', description: 'Admin only. The RBAC matrix (FR-AD-13): each role with the permission codes it grants.' })
  async listRoles() {
    return { items: await this.admin.listRoles() };
  }

  @Post('users/:userId/roles/:roleCode')
  @HttpCode(200)
  @PolicyDecorator({ roles: ['ADMIN'], totpRequired: true })
  @ApiOperation({ summary: 'Grant a role', description: 'Adds a role to a user. A user may hold several roles (e.g. staff who is also a customer). Idempotent.' })
  async grant(@Param('userId', ParseUUIDPipe) userId: string, @Param('roleCode') roleCode: string, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.admin.grantRole(principal.userId, userId, parseWith(roleCodeSchema, roleCode));
  }

  @Delete('users/:userId/roles/:roleCode')
  @HttpCode(200)
  @PolicyDecorator({ roles: ['ADMIN'], totpRequired: true })
  @ApiOperation({ summary: 'Revoke a role', description: 'Removes a role from a user. The change takes effect on the next access token the user obtains.' })
  async revoke(@Param('userId', ParseUUIDPipe) userId: string, @Param('roleCode') roleCode: string, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.admin.revokeRole(principal.userId, userId, parseWith(roleCodeSchema, roleCode));
  }
}
