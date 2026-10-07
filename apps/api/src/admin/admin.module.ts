import { Module } from '@nestjs/common';
import { AdminAuditController } from './admin-audit.controller.js';
import { AdminCustomersController } from './admin-customers.controller.js';
import { AdminRolesController } from './admin-roles.controller.js';
import { AdminStaffConflictsController } from './admin-staff-conflicts.controller.js';
import { AdminUsersController } from './admin-users.controller.js';
import { AdminService } from './admin.service.js';

@Module({
  controllers: [AdminUsersController, AdminRolesController, AdminCustomersController, AdminStaffConflictsController, AdminAuditController],
  providers: [AdminService]
})
export class AdminModule {}
