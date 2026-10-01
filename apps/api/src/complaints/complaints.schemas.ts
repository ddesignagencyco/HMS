// apps/api/src/complaints/complaints.schemas.ts
import { z } from 'zod';

export const CATEGORIES = ['MISBEHAVIOUR', 'QUALITY', 'OVERCHARGE', 'NO_SHOW', 'SAFETY', 'NON_PAYMENT', 'UNSAFE_PREMISES', 'ABUSE', 'CASH_DISCREPANCY', 'OTHER'] as const;
export const RESOLUTIONS = ['NO_ACTION', 'WARNING', 'PARTIAL_REFUND', 'FULL_REFUND', 'PROVIDER_PENALTY', 'TEMPORARY_SUSPENSION', 'PERMANENT_BLOCK'] as const;

const photo = z.object({ contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']), contentBase64: z.string().min(1) }).strict();

export const complaintCreateSchema = z
  .object({
    bookingId: z.string().uuid(),
    category: z.enum(CATEGORIES),
    description: z.string().trim().min(10).max(3000),
    photos: z.array(photo).max(5).optional()
  })
  .strict();

export const receiptComplaintSchema = z
  .object({
    token: z.string().min(20).max(300),
    category: z.enum(CATEGORIES),
    description: z.string().trim().min(10).max(3000),
    photos: z.array(photo).max(5).optional()
  })
  .strict();

export const complaintEvidenceSchema = photo;

export const complaintReplySchema = z.object({ body: z.string().trim().min(1).max(3000) }).strict();

export const complaintAssignSchema = z.object({ assigneeId: z.string().uuid().optional() }).strict();

export const complaintTransitionSchema = z
  .object({
    to: z.enum(['UNDER_REVIEW', 'AWAITING_RESPONSE', 'RESOLVED', 'REJECTED']),
    note: z.string().trim().min(3).max(2000).optional(),
    resolution: z.enum(RESOLUTIONS).optional(),
    /** For PARTIAL_REFUND: how much goes back to the customer. FULL_REFUND refunds the whole job. */
    refundPaisa: z.number().int().positive().optional(),
    /** For PROVIDER_PENALTY: the breach on the schedule, and the amount an excess-based fine is a multiple of. */
    breachCode: z.string().trim().min(2).max(60).optional(),
    excessPaisa: z.number().int().positive().optional(),
    /** For TEMPORARY_SUSPENSION. */
    suspensionDays: z.number().int().min(1).max(90).optional()
  })
  .strict();

export const complaintListQuery = z
  .object({
    status: z.enum(['OPEN', 'UNDER_REVIEW', 'AWAITING_RESPONSE', 'RESOLVED', 'REJECTED']).optional(),
    severity: z.enum(['SAFETY', 'HIGH', 'NORMAL']).optional(),
    assignedTo: z.string().uuid().optional(),
    open: z.enum(['true', 'false']).optional()
  })
  .strict();

export type ComplaintCreateInput = z.infer<typeof complaintCreateSchema>;
export type ComplaintTransitionInput = z.infer<typeof complaintTransitionSchema>;
export type PhotoInput = z.infer<typeof photo>;
