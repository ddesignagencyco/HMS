import { z } from 'zod';

export const USER_STATUSES = ['ACTIVE', 'LOCKED', 'DEACTIVATED'] as const;
export const ASSIGNABLE_ROLES = ['CUSTOMER', 'PROVIDER', 'AGENT', 'FINANCE', 'ADMIN'] as const;

const userId = z.string().uuid();

const limit = z.coerce.number().int().min(1).max(200).default(50);

export const listUsersQuerySchema = z
  .object({
    role: z.enum(ASSIGNABLE_ROLES).optional(),
    status: z.enum(USER_STATUSES).optional(),
    q: z.string().trim().min(1).max(100).optional(),
    limit
  })
  .strict();

export const listCustomersQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(100).optional(),
    limit
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
    limit
  })
  .strict();

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
export type ListCustomersQuery = z.infer<typeof listCustomersQuerySchema>;
export type StaffConflictCreateInput = z.infer<typeof staffConflictCreateSchema>;
export type AuditQuery = z.infer<typeof auditQuerySchema>;
