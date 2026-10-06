// apps/api/src/booking/booking.schemas.ts
import { z } from 'zod';

export const bookingCreateSchema = z
  .object({
    /** Leave out to let the platform offer the job to ranked providers in turn (auto-assign, FR-SR-07). */
    providerId: z.string().uuid().optional(),
    serviceId: z.number().int().positive(),
    addressId: z.string().uuid(),
    scheduledStart: z.string().datetime(),
    scheduledEnd: z.string().datetime(),
    problemText: z.string().trim().min(1).max(2000).optional(),
    /** One of the service's common faults, from the list the booking screen offers. */
    issueOptionId: z.number().int().positive().optional(),
    paymentMode: z.enum(['CASH', 'ONLINE']).default('CASH'),
    isEmergency: z.boolean().default(false),
    couponCode: z.string().trim().min(1).max(40).optional(),
    /** Booking for someone who is not the customer. Requires the contact below. */
    onBehalfOf: z
      .object({
        name: z.string().trim().min(1).max(120),
        /** E.164, e.g. +923001234567. */
        phoneE164: z.string().trim().regex(/^\+[1-9][0-9]{7,14}$/, 'phoneE164 must be an E.164 number, e.g. +923001234567')
      })
      .strict()
      .optional()
  })
  .strict()
  .refine(input => new Date(input.scheduledEnd).getTime() > new Date(input.scheduledStart).getTime(), { message: 'scheduledEnd must be after scheduledStart', path: ['scheduledEnd'] });

export type BookingCreateInput = z.infer<typeof bookingCreateSchema>;

export const bookingQuoteSchema = z
  .object({
    providerId: z.string().uuid().optional(),
    serviceId: z.number().int().positive(),
    isEmergency: z.boolean().default(false),
    couponCode: z.string().trim().min(1).max(40).optional()
  })
  .strict();

export type BookingQuoteInput = z.infer<typeof bookingQuoteSchema>;

export const bookingCancelSchema = z
  .object({
    reason: z.string().trim().min(1).max(500).optional()
  })
  .strict();

export type BookingCancelInput = z.infer<typeof bookingCancelSchema>;

const geoPoint = { lat: z.number().min(-90).max(90).optional(), lng: z.number().min(-180).max(180).optional(), accuracyM: z.number().min(0).max(100_000).optional() };

export const bookingStartSchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^\d{6}$/, 'code must be 6 digits'),
    /** Where the provider says they are; recorded as the check-in and compared to the customer's address (BR-09). Optional: a shortfall is flagged, never blocking. */
    ...geoPoint
  })
  .strict()
  .refine(input => (input.lat === undefined) === (input.lng === undefined), { message: 'lat and lng go together', path: ['lng'] });

export type BookingStartInput = z.infer<typeof bookingStartSchema>;

export const bookingRescheduleSchema = z
  .object({
    scheduledStart: z.string().datetime(),
    scheduledEnd: z.string().datetime()
  })
  .strict()
  .refine(input => new Date(input.scheduledEnd).getTime() > new Date(input.scheduledStart).getTime(), { message: 'scheduledEnd must be after scheduledStart', path: ['scheduledEnd'] });

export type BookingRescheduleInput = z.infer<typeof bookingRescheduleSchema>;

export const bookingRaiseRevisionSchema = z
  .object({
    deltaPaisa: z.number().int().positive(),
    reason: z.string().trim().min(1).max(500)
  })
  .strict();

export type BookingRaiseRevisionInput = z.infer<typeof bookingRaiseRevisionSchema>;

export const bookingNoShowSchema = z
  .object({
    party: z.enum(['CUSTOMER', 'PROVIDER'])
  })
  .strict();

export type BookingNoShowInput = z.infer<typeof bookingNoShowSchema>;

export const bookingListQuerySchema = z
  .object({
    status: z.enum(['REQUESTED', 'SCHEDULED', 'EN_ROUTE', 'IN_PROGRESS', 'QUOTE_REVISION', 'WORK_COMPLETED', 'UNFULFILLED', 'CANCELLED_CUSTOMER', 'CANCELLED_PROVIDER', 'NO_SHOW']).optional()
  })
  .strict();

export type BookingListQuery = z.infer<typeof bookingListQuerySchema>;

export const bookingChecklistSchema = z.object({ done: z.literal(true), evidenceId: z.string().uuid().optional() }).strict();

export type BookingChecklistInput = z.infer<typeof bookingChecklistSchema>;

export const bookingEvidenceSchema = z
  .object({
    /** Generated on the device; a retry of the same upload (offline queue, flaky network) carries the same value and is stored once. */
    clientUuid: z.string().uuid(),
    kind: z.enum(['CUSTOMER_PROBLEM', 'BEFORE', 'AFTER', 'CHECKLIST']),
    contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    contentBase64: z.string().min(1),
    checklistItemId: z.number().int().positive().optional(),
    capturedAt: z.string().datetime().optional(),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional()
  })
  .strict()
  .refine(input => (input.lat === undefined) === (input.lng === undefined), { message: 'lat and lng go together', path: ['lng'] });

export type BookingEvidenceInput = z.infer<typeof bookingEvidenceSchema>;

export const bookingCompleteSchema = z
  .object({
    /** The final amount, if the provider is charging less than the approved total (never more). Leave out to charge the approved total. */
    finalAmountPaisa: z.number().int().min(0).optional(),
    ...geoPoint
  })
  .strict()
  .refine(input => (input.lat === undefined) === (input.lng === undefined), { message: 'lat and lng go together', path: ['lng'] });

export type BookingCompleteInput = z.infer<typeof bookingCompleteSchema>;

export const bookingWarrantyClaimSchema = z.object({ reason: z.string().trim().min(1).max(1000) }).strict();

export type BookingWarrantyClaimInput = z.infer<typeof bookingWarrantyClaimSchema>;
