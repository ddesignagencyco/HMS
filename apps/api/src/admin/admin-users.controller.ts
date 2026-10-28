import { Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, PolicyDecorator, type AuthenticatedPrincipal } from '../common/policy.js';
import { ApiQueryField } from '../common/swagger.js';
import { parseWith } from '../common/validation.js';
import { AdminService } from './admin.service.js';
import { listUsersQuerySchema } from './admin.schemas.js';

@ApiTags('admin')
@ApiBearerAuth('access-token')
@Controller('admin/users')
export class AdminUsersController {
  constructor(@Inject(AdminService) private readonly admin: AdminService) {}

  @Get()
  @PolicyDecorator({ roles: ['ADMIN'], totpRequired: true })
  @ApiOperation({ summary: 'List user accounts', description: 'Admin only. Filter by role, account status or a name/email/phone substring. Passwords are never returned.' })
  @ApiQueryField('role', { description: 'Only users holding this role, e.g. PROVIDER.' })
  @ApiQueryField('status', { description: 'Only users in this status: ACTIVE, LOCKED or DEACTIVATED.' })
  @ApiQueryField('q', { description: 'Name, email or phone substring.' })
  async list(@Query() query: unknown) {
    return { items: await this.admin.listUsers(parseWith(listUsersQuerySchema, query)) };
  }

  @Post(':userId/block')
  @HttpCode(200)
  @PolicyDecorator({ roles: ['ADMIN'], totpRequired: true })
  @ApiOperation({ summary: 'Block a user', description: 'Locks the account and revokes every active session. Soft only — the account and its history stay.' })
  async block(@Param('userId', ParseUUIDPipe) userId: string, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.admin.blockUser(principal.userId, userId);
  }

  @Post(':userId/unblock')
  @HttpCode(200)
  @PolicyDecorator({ roles: ['ADMIN'], totpRequired: true })
  @ApiOperation({ summary: 'Unblock a user', description: 'Returns a locked account to active. Sessions are not resurrected; the user signs in afresh.' })
  async unblock(@Param('userId', ParseUUIDPipe) userId: string, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.admin.unblockUser(principal.userId, userId);
  }

  @Post(':userId/deactivate')
  @HttpCode(200)
  @PolicyDecorator({ roles: ['ADMIN'], totpRequired: true })
  @ApiOperation({ summary: 'Deactivate a user', description: 'Soft deactivation only (FR-AD-09): the account is disabled and its sessions revoked, but no row is deleted.' })
  async deactivate(@Param('userId', ParseUUIDPipe) userId: string, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.admin.deactivateUser(principal.userId, userId);
  }

  @Post(':userId/send-reset')
  @HttpCode(200)
  @PolicyDecorator({ roles: ['ADMIN'], totpRequired: true })
  @ApiOperation({ summary: 'Send a password reset', description: 'Triggers the reset code on the account owner\'s own phone/email. The admin never sees or sets a password (FR-AD-04).' })
  async sendReset(@Param('userId', ParseUUIDPipe) userId: string, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.admin.sendPasswordReset(principal.userId, userId);
  }
}
