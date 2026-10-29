import { pageFields } from '../common/paging.js';
import { z } from 'zod';

export const providerSearchQuerySchema = z
  .object({
    /** BE-010: optional. Without it the search ranks every provider in range across all their approved services. */
    serviceSlug: z.string().trim().min(1).max(100).optional(),
    /** BE-010: `distance` | `rating` | `price_asc` | `price_desc` | `experience`. Omitted = the weighted ranking. */
    sort: z.enum(['distance', 'rating', 'price_asc', 'price_desc', 'experience']).optional(),
    /** BE-010: only providers whose published rating is at least this (unrated providers are excluded). */
    minRating: z.coerce.number().min(0).max(5).optional(),
    ...pageFields(),
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    /**
     * A saved address, resolved server-side to its coordinates. Exists so a customer who has
     * already told us where they are does not have to send lat/lng at all — the alternative was
     * the web app resolving an address it already has an id for, in client code, and getting the
     * wrong point. Either form works; giving one without the other is a validation error below.
     */
    addressId: z.string().uuid().optional(),
    /** FR-SR-02: only providers with at least this many years' experience. */
    minExperienceYears: z.coerce.number().int().min(0).max(60).optional(),
    /** FR-SR-03: only providers who have completed at least this many jobs. */
    minCompletedJobs: z.coerce.number().int().min(0).max(10_000).optional(),
    /** FR-SR-04: price range for this service, in paisa. */
    minPricePaisa: z.coerce.number().int().positive().optional(),
    maxPricePaisa: z.coerce.number().int().positive().optional(),
    /** FR-SR-05: only providers with a free slot later today (local time). */
    availableToday: z.coerce.boolean().optional(),
    /**
     * FR-SR-07: only providers whose documents have been verified. Implementable only since
     * SHM-022 landed `provider_documents` with a review status — before that the filter was
     * impossible and silently ignored.
     */
    verifiedDocsOnly: z.coerce.boolean().optional()
  })
  .strict()
  .superRefine((query, ctx) => {
    const hasPoint = query.lat !== undefined && query.lng !== undefined;
    const hasHalfPoint = query.lat !== undefined || query.lng !== undefined;
    if (!hasPoint && query.addressId === undefined) {
      ctx.addIssue({ code: 'custom', message: 'Give either lat and lng together, or addressId', path: ['lat'] });
    }
    if (hasHalfPoint && !hasPoint) {
      ctx.addIssue({ code: 'custom', message: 'lat and lng must be given together', path: [query.lat === undefined ? 'lat' : 'lng'] });
    }
    if (query.minPricePaisa !== undefined && query.maxPricePaisa !== undefined && query.minPricePaisa > query.maxPricePaisa) {
      ctx.addIssue({ code: 'custom', message: 'minPricePaisa cannot be greater than maxPricePaisa', path: ['minPricePaisa'] });
    }
  });

export type ProviderSearchQuery = z.infer<typeof providerSearchQuerySchema>;

export const slotsQuerySchema = z
  .object({
    serviceId: z.coerce.number().int().positive(),
    /** The local (Asia/Karachi) day to list start times for. */
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
  })
  .strict();

export type SlotsQuery = z.infer<typeof slotsQuerySchema>;

export const nextSlotsQuerySchema = z
  .object({
    serviceId: z.coerce.number().int().positive(),
    /** How many soonest start times to return. The first is the provider's earliest availability. */
    limit: z.coerce.number().int().min(1).max(20).default(5)
  })
  .strict();

export type NextSlotsQuery = z.infer<typeof nextSlotsQuerySchema>;