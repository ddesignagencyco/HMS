import { BOOKING_STATUS_VALUES } from '@smart-home/domain';
import { z } from 'zod';
import { cursorFields, pageFields } from '../common/paging.js';

export const USER_STATUSES = ['ACTIVE', 'LOCKED', 'DEACTIVATED'] as const;
export const ASSIGNABLE_ROLES = ['CUSTOMER', 'PROVIDER', 'AGENT', 'FINANCE', 'ADMIN'] as const;
export const PROVIDER_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'SUSPENDED', 'BLOCKED', 'DEACTIVATED'] as const;

const userId = z.string().uuid();

/**
 * `limit` was already part of the users and customers lists (default 50, max 200), so that ceiling is kept
 * and `page` is added. Sending neither keeps the old 50-row window; the response now says how many exist (BE-007).
 */
const legacyPaging = pageFields(200);
const booleanFlag = z.enum(['true', 'false']).transform(value => value === 'true');

export const listUsersQuerySchema = z
  .object({
    role: z.enum(ASSIGNABLE_ROLES).optional(),
    status: z.enum(USER_STATUSES).optional(),
    q: z.string().trim().min(1).max(100).optional(),
    ...legacyPaging
  })
  .strict();

export const listCustomersQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(100).optional(),
    ...legacyPaging
  })
  .strict();

/** BE-008 (§3.3): the provider approval queue. */
export const listProvidersQuerySchema = z
  .object({
    status: z.enum(PROVIDER_STATUSES).optional(),
    q: z.string().trim().min(1).max(100).optional(),
    ...pageFields()
  })
  .strict();

/** BE-009 (§3.4): platform-wide bookings for the admin. */
export const listAdminBookingsQuerySchema = z
  .object({
    status: z.enum(BOOKING_STATUS_VALUES).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    cityId: z.coerce.number().int().positive().optional(),
    providerId: userId.optional(),
    customerId: userId.optional(),
    isEmergency: booleanFlag.optional(),
    /** Booking code search (substring, case-insensitive). */
    q: z.string().trim().min(1).max(40).optional(),
    ...pageFields()
  })
  .strict();

export const roleCodeSchema = z.enum(ASSIGNABLE_ROLES);

/** FR-AD-16 / CL-19: a declaration that two users must not be assigned to each other's work. */
export const staffConflictCreateSchema = z
  .object({
    staffUserId: userId,
    otherUserId: userId,
    reason: z.string().trim().min(5).max(500)
  })
  .strict()
  .refine(input => input.staffUserId !== input.otherUserId, { message: 'A person cannot be in conflict with themselves', path: ['otherUserId'] });

/** FR-AD-14: the audit log is append-only and filterable. */
export const auditQuerySchema = z
  .object({
    action: z.string().trim().min(1).max(100).optional(),
    actorUserId: userId.optional(),
    entityType: z.string().trim().min(1).max(60).optional(),
    entityId: z.string().trim().min(1).max(120).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    /** BE-023: the previous response's nextCursor; returns older rows. */
    ...cursorFields(200)
  })
  .strict();

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
export type ListProvidersQuery = z.infer<typeof listProvidersQuerySchema>;
export type ListAdminBookingsQuery = z.infer<typeof listAdminBookingsQuerySchema>;
export type ListCustomersQuery = z.infer<typeof listCustomersQuerySchema>;
export type StaffConflictCreateInput = z.infer<typeof staffConflictCreateSchema>;
export type AuditQuery = z.infer<typeof auditQuerySchema>;
