import { z } from 'zod';

export const providerSearchQuerySchema = z
  .object({
    serviceSlug: z.string().trim().min(1).max(100),
    lat: z.coerce.number().min(-90).max(90),
    lng: z.coerce.number().min(-180).max(180)
  })
  .strict();

export type ProviderSearchQuery = z.infer<typeof providerSearchQuerySchema>;

export const slotsQuerySchema = z
  .object({
    serviceId: z.coerce.number().int().positive(),
    /** The local (Asia/Karachi) day to list start times for. */
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
  })
  .strict();

export type SlotsQuery = z.infer<typeof slotsQuerySchema>;
