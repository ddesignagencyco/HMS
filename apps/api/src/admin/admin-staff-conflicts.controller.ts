import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, PolicyDecorator, type AuthenticatedPrincipal } from '../common/policy.js';
import { ApiZodBody } from '../common/swagger.js';
import { parseWith } from '../common/validation.js';
import { AdminService } from './admin.service.js';
import { staffConflictCreateSchema } from './admin.schemas.js';

@ApiTags('admin')
@ApiBearerAuth('access-token')
@Controller('admin/staff-conflicts')
export class AdminStaffConflictsController {
  constructor(@Inject(AdminService) private readonly admin: AdminService) {}

  @Get()
  @PolicyDecorator({ roles: ['ADMIN'], totpRequired: true })
  @ApiOperation({ summary: 'List declared staff conflicts', description: 'Admin only. The declared conflicts of interest (FR-AD-16, CL-19) that the verification assignment path consults.' })
  async list() {
    return { items: await this.admin.listStaffConflicts() };
  }

  @Post()
  @HttpCode(201)
  @PolicyDecorator({ roles: ['ADMIN'], totpRequired: true })
  @ApiOperation({ summary: 'Declare a staff conflict', description: 'Records that two users must not be assigned each other\'s work. Re-declaring the same pair updates the reason.' })
  @ApiZodBody(staffConflictCreateSchema, { default: { summary: 'Declare a conflict', value: { staffUserId: '00000000-0000-0000-0000-000000000000', otherUserId: '00000000-0000-0000-0000-000000000000', reason: 'Immediate family member' } } })
  async declare(@Body() body: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.admin.declareStaffConflict(principal.userId, parseWith(staffConflictCreateSchema, body));
  }

  @Delete(':id')
  @HttpCode(204)
  @PolicyDecorator({ roles: ['ADMIN'], totpRequired: true })
  @ApiOperation({ summary: 'Withdraw a declared conflict', description: 'Removes a declaration once it no longer applies.' })
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    await this.admin.removeStaffConflict(principal.userId, id);
  }
}
