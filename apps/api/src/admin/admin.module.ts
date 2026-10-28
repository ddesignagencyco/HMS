import { Module } from '@nestjs/common';
import { AdminAuditController } from './admin-audit.controller.js';
import { AdminCustomersController } from './admin-customers.controller.js';
import { AdminRolesController } from './admin-roles.controller.js';
import { AdminStaffConflictsController } from './admin-staff-conflicts.controller.js';
import { AdminUsersController } from './admin-users.controller.js';
import { AdminService } from './admin.service.js';
import { OpsBoardController } from './ops-board.controller.js';
import { OpsBoardService } from './ops-board.service.js';

@Module({
  // SHM-091: the operations board and its live stream. Staff-only and TOTP-gated — the escrow
  // figure on it is the platform's held money, so it is not something a logged-in agent sees.
  controllers: [AdminUsersController, AdminRolesController, AdminCustomersController, AdminStaffConflictsController, AdminAuditController, OpsBoardController],
  providers: [AdminService, OpsBoardService]
})
export class AdminModule {}
