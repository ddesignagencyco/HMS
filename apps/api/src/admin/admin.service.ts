import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { conflict, notFound } from '../common/domain-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { AuthService } from '../identity/auth.service.js';
import { AuditService } from '../platform/audit.service.js';
import type { AuditQuery, ListCustomersQuery, ListUsersQuery, StaffConflictCreateInput } from './admin.schemas.js';

export type AdminUserRow = { id: string; email: string | null; phoneE164: string | null; firstName: string; lastName: string; status: string; roles: string[]; createdAt: Date };
export type CustomerRow = { userId: string; email: string | null; phoneE164: string | null; firstName: string; lastName: string; status: string; createdAt: Date };
export type RoleRow = { code: string; name: string; permissions: string[] };
export type StaffConflictRow = { id: string; staffUserId: string; otherUserId: string; reason: string; createdBy: string; createdAt: Date };
export type AuditRow = { id: string; actorUserId: string | null; actorRole: string; action: string; entityType: string; entityId: string; before: Prisma.JsonValue; after: Prisma.JsonValue; createdAt: Date };

const ROLE_ARRAY = Prisma.sql`COALESCE((SELECT array_agg(ur.role_code::text ORDER BY ur.role_code) FROM user_roles ur WHERE ur.user_id = u.id), '{}')`;

/**
 * SHM-024: the admin management surfaces that had no API. All user/provider
 * changes here are soft — the database forbids deletes outright (`users_no_delete`,
 * `trg_no_delete`) and FR-AD-09 says deactivation is the only removal. Every
 * mutating method writes an `audit_log` row (FR-AD-14), and anything that locks
 * or deactivates an account also revokes that user's sessions so a live token
 * cannot outlive the decision.
 */
@Injectable()
export class AdminService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AuditService) private readonly audit: AuditService
  ) {}

  // ------------------------------------------------------------------- users

  async listUsers(query: ListUsersQuery): Promise<AdminUserRow[]> {
    const conditions: Prisma.Sql[] = [];
    if (query.role !== undefined) conditions.push(Prisma.sql`EXISTS (SELECT 1 FROM user_roles ur2 WHERE ur2.user_id = u.id AND ur2.role_code = ${query.role})`);
    if (query.status !== undefined) conditions.push(Prisma.sql`u.status = ${query.status}::user_status`);
    if (query.q !== undefined) {
      const like = `%${query.q}%`;
      conditions.push(Prisma.sql`(u.first_name ILIKE ${like} OR u.last_name ILIKE ${like} OR u.email ILIKE ${like} OR u.phone_e164 LIKE ${like})`);
    }
    const where = conditions.length === 0 ? Prisma.empty : Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
    return this.prisma.$queryRaw<AdminUserRow[]>(
      Prisma.sql`SELECT u.id, u.email, u.phone_e164 as "phoneE164", u.first_name as "firstName", u.last_name as "lastName",
          u.status::text as "status", ${ROLE_ARRAY} as roles, u.created_at as "createdAt"
        FROM users u ${where} ORDER BY u.created_at DESC LIMIT ${query.limit}`
    );
  }

  async listCustomers(query: ListCustomersQuery): Promise<CustomerRow[]> {
    const conditions: Prisma.Sql[] = [];
    if (query.q !== undefined) {
      const like = `%${query.q}%`;
      conditions.push(Prisma.sql`(u.first_name ILIKE ${like} OR u.last_name ILIKE ${like} OR u.email ILIKE ${like} OR u.phone_e164 LIKE ${like})`);
    }
    const where = conditions.length === 0 ? Prisma.empty : Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
    return this.prisma.$queryRaw<CustomerRow[]>(
      Prisma.sql`SELECT u.id as "userId", u.email, u.phone_e164 as "phoneE164", u.first_name as "firstName", u.last_name as "lastName",
          u.status::text as "status", c.created_at as "createdAt"
        FROM customers c JOIN users u ON u.id = c.user_id ${where} ORDER BY c.created_at DESC LIMIT ${query.limit}`
    );
  }

  /** FR-AD-03/04: admin-triggered reset. The admin never sees or sets a password. */
  async sendPasswordReset(actorId: string, userId: string): Promise<{ sent: true }> {
    const rows = await this.prisma.$queryRaw<{ phone_e164: string | null; email: string | null }[]>(Prisma.sql`SELECT phone_e164, email FROM users WHERE id = ${userId}::uuid`);
    const user = rows[0];
    if (user === undefined) throw notFound('User');
    const identifier = user.phone_e164 ?? user.email;
    if (identifier !== null) await this.auth.requestPasswordReset(identifier);
    await this.audit.append({ actorUserId: actorId, actorRole: 'ADMIN', action: 'admin.user.send_reset', entityType: 'user', entityId: userId });
    return { sent: true };
  }

  async blockUser(actorId: string, userId: string): Promise<{ id: string; status: string }> {
    return this.setUserStatus(actorId, userId, 'LOCKED', 'admin.user.block');
  }

  async unblockUser(actorId: string, userId: string): Promise<{ id: string; status: string }> {
    return this.setUserStatus(actorId, userId, 'ACTIVE', 'admin.user.unblock');
  }

  /** FR-AD-05/09: soft deactivation — the row and the financial history stay. */
  async deactivateUser(actorId: string, userId: string): Promise<{ id: string; status: string }> {
    return this.setUserStatus(actorId, userId, 'DEACTIVATED', 'admin.user.deactivate');
  }

  private async setUserStatus(actorId: string, userId: string, status: 'ACTIVE' | 'LOCKED' | 'DEACTIVATED', action: string): Promise<{ id: string; status: string }> {
    return this.prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<{ status: string }[]>(Prisma.sql`SELECT status::text as status FROM users WHERE id = ${userId}::uuid FOR UPDATE`);
      const current = rows[0];
      if (current === undefined) throw notFound('User');
      if (current.status === status) throw conflict(`This user is already ${status}`);
      await tx.$executeRaw(Prisma.sql`UPDATE users SET status = ${status}::user_status, deactivated_at = ${status === 'DEACTIVATED' ? Prisma.sql`now()` : Prisma.sql`deactivated_at`} WHERE id = ${userId}::uuid`);
      if (status !== 'ACTIVE') await tx.$executeRaw(Prisma.sql`UPDATE sessions SET revoked_at = now() WHERE user_id = ${userId}::uuid AND revoked_at IS NULL`);
      await this.audit.append({ actorUserId: actorId, actorRole: 'ADMIN', action, entityType: 'user', entityId: userId, before: { status: current.status }, after: { status } }, tx);
      return { id: userId, status };
    });
  }

  // ------------------------------------------------------------------- roles

  async listRoles(): Promise<RoleRow[]> {
    return this.prisma.$queryRaw<RoleRow[]>(
      Prisma.sql`SELECT r.code, r.name,
          COALESCE(array_agg(rp.permission_code ORDER BY rp.permission_code) FILTER (WHERE rp.permission_code IS NOT NULL), '{}') as permissions
        FROM roles r LEFT JOIN role_permissions rp ON rp.role_code = r.code
        GROUP BY r.code, r.name ORDER BY r.code`
    );
  }

  async grantRole(actorId: string, userId: string, roleCode: string): Promise<{ userId: string; roleCode: string }> {
    const roles = await this.prisma.$queryRaw<{ code: string }[]>(Prisma.sql`SELECT code FROM roles WHERE code = ${roleCode}`);
    if (roles[0] === undefined) throw notFound('Role');
    const exists = await this.prisma.$queryRaw<{ present: boolean }[]>(Prisma.sql`SELECT EXISTS (SELECT 1 FROM users WHERE id = ${userId}::uuid) as present`);
    if (exists[0]?.present !== true) throw notFound('User');
    await this.prisma.$transaction(async tx => {
      await tx.$executeRaw(Prisma.sql`INSERT INTO user_roles(user_id, role_code, granted_by) VALUES (${userId}::uuid, ${roleCode}, ${actorId}::uuid) ON CONFLICT DO NOTHING`);
      // Provider/customer side-tables back the role, so hold them in step with it.
      if (roleCode === 'CUSTOMER') await tx.$executeRaw(Prisma.sql`INSERT INTO customers(user_id) VALUES (${userId}::uuid) ON CONFLICT DO NOTHING`);
      if (roleCode === 'PROVIDER') await tx.$executeRaw(Prisma.sql`INSERT INTO providers(user_id, status) VALUES (${userId}::uuid, 'PENDING_APPROVAL') ON CONFLICT DO NOTHING`);
      await this.audit.append({ actorUserId: actorId, actorRole: 'ADMIN', action: 'admin.role.grant', entityType: 'user', entityId: userId, after: { role: roleCode } }, tx);
    });
    return { userId, roleCode };
  }

  async revokeRole(actorId: string, userId: string, roleCode: string): Promise<{ userId: string; roleCode: string; revoked: true }> {
    await this.prisma.$transaction(async tx => {
      const count = await tx.$executeRaw(Prisma.sql`DELETE FROM user_roles WHERE user_id = ${userId}::uuid AND role_code = ${roleCode}`);
      if (count === 0) throw conflict('This user does not hold that role');
      await this.audit.append({ actorUserId: actorId, actorRole: 'ADMIN', action: 'admin.role.revoke', entityType: 'user', entityId: userId, before: { role: roleCode } }, tx);
    });
    return { userId, roleCode, revoked: true };
  }

  // --------------------------------------------------------- staff conflicts

  async listStaffConflicts(): Promise<StaffConflictRow[]> {
    return this.prisma.$queryRaw<StaffConflictRow[]>(
      Prisma.sql`SELECT id, staff_user_id as "staffUserId", other_user_id as "otherUserId", reason, created_by as "createdBy", created_at as "createdAt"
        FROM staff_conflicts ORDER BY created_at DESC`
    );
  }

  async declareStaffConflict(actorId: string, input: StaffConflictCreateInput): Promise<StaffConflictRow> {
    const present = await this.prisma.$queryRaw<{ present: boolean }[]>(
      Prisma.sql`SELECT (SELECT count(*) FROM users WHERE id IN (${input.staffUserId}::uuid, ${input.otherUserId}::uuid)) = 2 as present`
    );
    if (present[0]?.present !== true) throw notFound('User');
    const rows = await this.prisma.$queryRaw<StaffConflictRow[]>(
      Prisma.sql`INSERT INTO staff_conflicts(staff_user_id, other_user_id, reason, created_by)
        VALUES (${input.staffUserId}::uuid, ${input.otherUserId}::uuid, ${input.reason}, ${actorId}::uuid)
        ON CONFLICT (staff_user_id, other_user_id) DO UPDATE SET reason = EXCLUDED.reason
        RETURNING id, staff_user_id as "staffUserId", other_user_id as "otherUserId", reason, created_by as "createdBy", created_at as "createdAt"`
    );
    const row = rows[0];
    if (row === undefined) throw notFound('Staff conflict');
    await this.audit.append({ actorUserId: actorId, actorRole: 'ADMIN', action: 'admin.staff_conflict.declare', entityType: 'staff_conflict', entityId: row.id, after: { staffUserId: row.staffUserId, otherUserId: row.otherUserId } });
    return row;
  }

  async removeStaffConflict(actorId: string, id: string): Promise<void> {
    const removed = await this.prisma.$executeRaw(Prisma.sql`DELETE FROM staff_conflicts WHERE id = ${id}::uuid`);
    if (removed === 0) throw notFound('Staff conflict');
    await this.audit.append({ actorUserId: actorId, actorRole: 'ADMIN', action: 'admin.staff_conflict.remove', entityType: 'staff_conflict', entityId: id });
  }

  // ------------------------------------------------------------------- audit

  async queryAudit(query: AuditQuery): Promise<AuditRow[]> {
    const conditions: Prisma.Sql[] = [];
    if (query.action !== undefined) conditions.push(Prisma.sql`action = ${query.action}`);
    if (query.actorUserId !== undefined) conditions.push(Prisma.sql`actor_user_id = ${query.actorUserId}::uuid`);
    if (query.entityType !== undefined) conditions.push(Prisma.sql`entity_type = ${query.entityType}`);
    if (query.entityId !== undefined) conditions.push(Prisma.sql`entity_id = ${query.entityId}`);
    if (query.from !== undefined) conditions.push(Prisma.sql`created_at >= ${query.from}`);
    if (query.to !== undefined) conditions.push(Prisma.sql`created_at <= ${query.to}`);
    const where = conditions.length === 0 ? Prisma.empty : Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
    return this.prisma.$queryRaw<AuditRow[]>(
      Prisma.sql`SELECT id::text as "id", actor_user_id as "actorUserId", actor_role::text as "actorRole", action, entity_type as "entityType", entity_id as "entityId",
          before, after, created_at as "createdAt"
        FROM audit_log ${where} ORDER BY id DESC LIMIT ${query.limit}`
    );
  }
}
