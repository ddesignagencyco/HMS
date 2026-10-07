import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PolicyDecorator } from '../common/policy.js';
import { ApiQueryField } from '../common/swagger.js';
import { parseWith } from '../common/validation.js';
import { AdminService } from './admin.service.js';
import { auditQuerySchema } from './admin.schemas.js';

@ApiTags('admin')
@ApiBearerAuth('access-token')
@Controller('admin/audit')
export class AdminAuditController {
  constructor(@Inject(AdminService) private readonly admin: AdminService) {}

  @Get()
  @PolicyDecorator({ roles: ['ADMIN'], totpRequired: true })
  @ApiOperation({ summary: 'Query the audit log', description: 'Admin only. The append-only record of privileged actions (FR-AD-14), newest first, filterable by action, actor, entity and time range.' })
  @ApiQueryField('action', { description: 'Exact action, e.g. provider.approve.' })
  @ApiQueryField('actorUserId', { description: 'Only rows written by this user id.' })
  @ApiQueryField('entityType', { description: 'Only rows about this kind of entity, e.g. user.' })
  @ApiQueryField('entityId', { description: 'Only rows about this entity id.' })
  @ApiQueryField('from', { description: 'ISO timestamp lower bound (inclusive).' })
  @ApiQueryField('to', { description: 'ISO timestamp upper bound (inclusive).' })
  async query(@Query() query: unknown) {
    return { items: await this.admin.queryAudit(parseWith(auditQuerySchema, query)) };
  }
}
