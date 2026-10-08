import { Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, PolicyDecorator, type AuthenticatedPrincipal } from '../common/policy.js';
import { ApiQueryField } from '../common/swagger.js';
import { parseWith } from '../common/validation.js';
import { AdminService } from './admin.service.js';
import { listCustomersQuerySchema } from './admin.schemas.js';

@ApiTags('admin')
@ApiBearerAuth('access-token')
@Controller('admin/customers')
export class AdminCustomersController {
  constructor(@Inject(AdminService) private readonly admin: AdminService) {}

  @Get()
  @PolicyDecorator({ roles: ['ADMIN'], totpRequired: true })
  @ApiOperation({ summary: 'List customer accounts', description: 'Admin only. The customer side of the management surface (FR-AD-05), searchable by name, email or phone.' })
  @ApiQueryField('q', { description: 'Name, email or phone substring.' })
  async list(@Query() query: unknown) {
    return { items: await this.admin.listCustomers(parseWith(listCustomersQuerySchema, query)) };
  }

  @Post(':customerId/deactivate')
  @HttpCode(200)
  @PolicyDecorator({ roles: ['ADMIN'], totpRequired: true })
  @ApiOperation({ summary: 'Deactivate a customer', description: 'Soft deactivation only (FR-AD-09): the account is disabled and its sessions revoked, never deleted.' })
  async deactivate(@Param('customerId', ParseUUIDPipe) customerId: string, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.admin.deactivateUser(principal.userId, customerId);
  }
}
