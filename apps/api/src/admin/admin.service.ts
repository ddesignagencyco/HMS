import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BOOKING_READ_COLUMNS, BOOKING_READ_JOIN, toBookingReadRow, type BookingReadRow, type BookingReadRaw } from '../booking/booking.row.js';
import { maskPhoneE164 } from '../booking/on-behalf.js';
import { conflict, notFound } from '../common/domain-error.js';
import { DEFAULT_PAGE_LIMIT, countOf, cursorPage, decodeIdCursor, limitClause, paged, pageWindow, type Paged } from '../common/paging.js';
import { PrismaService } from '../database/prisma.service.js';
import { AuthService } from '../identity/auth.service.js';
import { AuditService } from '../platform/audit.service.js';
import type { AuditQuery, ListAdminBookingsQuery, ListCustomersQuery, ListProvidersQuery, ListUsersQuery, StaffConflictCreateInput } from './admin.schemas.js';

export type AdminUserRow = { id: string; email: string | null; phoneE164: string | null; firstName: string; lastName: string; status: string; roles: string[]; providerStatus: string | null; createdAt: Date };
export type AdminProviderRow = { providerId: string; name: string; phoneMasked: string | null; city: string | null; cityId: number | null; providerStatus: string; submittedAt: Date | null; pendingDocumentsCount: number };
export type AdminBookingRow = BookingReadRow & { customerName: string | null; providerName: string | null; cityId: number | null };
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

  async listUsers(query: ListUsersQuery): Promise<Paged<AdminUserRow>> {
    const conditions: Prisma.Sql[] = [];
    if (query.role !== undefined) conditions.push(Prisma.sql`EXISTS (SELECT 1 FROM user_roles ur2 WHERE ur2.user_id = u.id AND ur2.role_code = ${query.role})`);
    if (query.status !== undefined) conditions.push(Prisma.sql`u.status = ${query.status}::user_status`);
    if (query.q !== undefined) {
      const like = `%${query.q}%`;
      conditions.push(Prisma.sql`(u.first_name ILIKE ${like} OR u.last_name ILIKE ${like} OR u.email ILIKE ${like} OR u.phone_e164 LIKE ${like})`);
    }
    const where = conditions.length === 0 ? Prisma.empty : Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
    const window = pageWindow(query, 50);
    const items = await this.prisma.$queryRaw<AdminUserRow[]>(
      Prisma.sql`SELECT u.id, u.email, u.phone_e164 as "phoneE164", u.first_name as "firstName", u.last_name as "lastName",
          u.status::text as "status", ${ROLE_ARRAY} as roles, (SELECT p.status::text FROM providers p WHERE p.user_id = u.id) as "providerStatus", u.created_at as "createdAt"
        FROM users u ${where} ORDER BY u.created_at DESC, u.id ${limitClause(window)}`
    );
    return paged(items, await countOf(this.prisma, Prisma.sql`SELECT count(*)::bigint as n FROM users u ${where}`), window);
  }

  async listCustomers(query: ListCustomersQuery): Promise<Paged<CustomerRow>> {
    const conditions: Prisma.Sql[] = [];
    if (query.q !== undefined) {
      const like = `%${query.q}%`;
      conditions.push(Prisma.sql`(u.first_name ILIKE ${like} OR u.last_name ILIKE ${like} OR u.email ILIKE ${like} OR u.phone_e164 LIKE ${like})`);
    }
    const where = conditions.length === 0 ? Prisma.empty : Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
    const window = pageWindow(query, 50);
    const items = await this.prisma.$queryRaw<CustomerRow[]>(
      Prisma.sql`SELECT u.id as "userId", u.email, u.phone_e164 as "phoneE164", u.first_name as "firstName", u.last_name as "lastName",
          u.status::text as "status", c.created_at as "createdAt"
        FROM customers c JOIN users u ON u.id = c.user_id ${where} ORDER BY c.created_at DESC, u.id ${limitClause(window)}`
    );
    return paged(items, await countOf(this.prisma, Prisma.sql`SELECT count(*)::bigint as n FROM customers c JOIN users u ON u.id = c.user_id ${where}`), window);
  }

  /**
   * BE-008 (§3.3): who is waiting for approval. Oldest submission first so the queue is worked in order;
   * `pendingDocumentsCount` is documents no admin has reviewed yet. The phone is masked: this is a list, and
   * the full number lives on the user row an admin opens deliberately.
   */
  async listProviders(query: ListProvidersQuery): Promise<Paged<AdminProviderRow>> {
    const conditions: Prisma.Sql[] = [];
    if (query.status !== undefined) conditions.push(Prisma.sql`p.status = ${query.status}::provider_status`);
    if (query.q !== undefined) {
      const like = `%${query.q}%`;
      conditions.push(Prisma.sql`(u.first_name ILIKE ${like} OR u.last_name ILIKE ${like} OR u.phone_e164 LIKE ${like})`);
    }
    const where = conditions.length === 0 ? Prisma.empty : Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
    const window = pageWindow(query, DEFAULT_PAGE_LIMIT);
    const rows = await this.prisma.$queryRaw<(Omit<AdminProviderRow, 'phoneMasked'> & { phoneE164: string | null })[]>(
      Prisma.sql`SELECT p.user_id as "providerId", trim(u.first_name || ' ' || u.last_name) as name, u.phone_e164 as "phoneE164", c.name as city, p.city_id as "cityId",
          p.status::text as "providerStatus", p.submitted_at as "submittedAt",
          (SELECT count(*) FROM provider_documents d WHERE d.provider_id = p.user_id AND d.status = 'PENDING')::int as "pendingDocumentsCount"
        FROM providers p JOIN users u ON u.id = p.user_id LEFT JOIN cities c ON c.id = p.city_id ${where}
        ORDER BY p.submitted_at ASC NULLS LAST, p.created_at DESC, p.user_id ${limitClause(window)}`
    );
    const items = rows.map(({ phoneE164, ...row }) => ({ ...row, phoneMasked: phoneE164 === null ? null : maskPhoneE164(phoneE164) }));
    return paged(items, await countOf(this.prisma, Prisma.sql`SELECT count(*)::bigint as n FROM providers p JOIN users u ON u.id = p.user_id ${where}`), window);
  }

  /** BE-009 (§3.4): every booking on the platform, newest first, with the same readable names as `GET /bookings` plus who the two parties are. */
  async listBookings(query: ListAdminBookingsQuery): Promise<Paged<AdminBookingRow>> {
    const conditions: Prisma.Sql[] = [];
    if (query.status !== undefined) conditions.push(Prisma.sql`b.status = ${query.status}::booking_status`);
    if (query.from !== undefined) conditions.push(Prisma.sql`b.created_at >= ${query.from}`);
    if (query.to !== undefined) conditions.push(Prisma.sql`b.created_at <= ${query.to}`);
    if (query.cityId !== undefined) conditions.push(Prisma.sql`ar.city_id = ${query.cityId}`);
    if (query.providerId !== undefined) conditions.push(Prisma.sql`b.provider_id = ${query.providerId}::uuid`);
    if (query.customerId !== undefined) conditions.push(Prisma.sql`b.customer_id = ${query.customerId}::uuid`);
    if (query.isEmergency !== undefined) conditions.push(Prisma.sql`b.is_emergency = ${query.isEmergency}`);
    if (query.q !== undefined) conditions.push(Prisma.sql`b.code ILIKE ${`%${query.q.replace(/[\\%_]/g, char => `\\${char}`)}%`}`);
    const where = conditions.length === 0 ? Prisma.empty : Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
    const window = pageWindow(query, DEFAULT_PAGE_LIMIT);
    const rows = await this.prisma.$queryRaw<(BookingReadRaw & { customerName: string | null; providerName: string | null; cityId: number | null })[]>(
      Prisma.sql`SELECT ${BOOKING_READ_COLUMNS},
          (SELECT trim(cu.first_name || ' ' || cu.last_name) FROM users cu WHERE cu.id = b.customer_id) as "customerName",
          (SELECT trim(pu.first_name || ' ' || pu.last_name) FROM users pu WHERE pu.id = b.provider_id) as "providerName",
          ar.city_id as "cityId"
        ${BOOKING_READ_JOIN} ${where} ORDER BY b.created_at DESC, b.id ${limitClause(window)}`
    );
    const items = rows.map(({ customerName, providerName, cityId, ...raw }) => ({ ...toBookingReadRow(raw as BookingReadRaw), customerName, providerName, cityId }));
    return paged(items, await countOf(this.prisma, Prisma.sql`SELECT count(*)::bigint as n ${BOOKING_READ_JOIN} ${where}`), window);
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

  async queryAudit(query: AuditQuery): Promise<{ items: AuditRow[]; nextCursor: string | null }> {
    const conditions: Prisma.Sql[] = [];
    if (query.action !== undefined) conditions.push(Prisma.sql`action = ${query.action}`);
    if (query.actorUserId !== undefined) conditions.push(Prisma.sql`actor_user_id = ${query.actorUserId}::uuid`);
    if (query.entityType !== undefined) conditions.push(Prisma.sql`entity_type = ${query.entityType}`);
    if (query.entityId !== undefined) conditions.push(Prisma.sql`entity_id = ${query.entityId}`);
    if (query.from !== undefined) conditions.push(Prisma.sql`created_at >= ${query.from}`);
    if (query.to !== undefined) conditions.push(Prisma.sql`created_at <= ${query.to}`);
    // BE-023: the cursor is the id of the last row seen. Ids only grow, so "id below it" stays stable while new rows arrive.
    if (query.before !== undefined) conditions.push(Prisma.sql`id < ${decodeIdCursor(query.before)}::bigint`);
    const where = conditions.length === 0 ? Prisma.empty : Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
    const limit = query.limit ?? 50;
    const rows = await this.prisma.$queryRaw<AuditRow[]>(
      Prisma.sql`SELECT id::text as "id", actor_user_id as "actorUserId", actor_role::text as "actorRole", action, entity_type as "entityType", entity_id as "entityId",
          before, after, created_at as "createdAt"
        FROM audit_log ${where} ORDER BY id DESC LIMIT ${limit + 1}`
    );
    return cursorPage(rows, limit, row => row.id);
  }
}
