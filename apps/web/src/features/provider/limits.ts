/* The numeric bounds the API actually enforces.

   These are not UX decisions. They are copied from the zod schemas in
   `apps/api/src`, because every one of them is a `.strict()` body where a value
   outside the range is a 422 with no partial acceptance:

   · `provider.schemas.ts` → `profileUpdateSchema`
       experienceYears: 0–60, radiusM: 500–50 000 (metres)
   · `catalogue.schemas.ts` → `providerServiceUpsertSchema`
       pricePaisa must fall inside the service's own band, which lives on the
       catalogue row rather than here — so the screen joins against the catalogue
       to check it, and the server still refuses it.

   Keep this file and the schemas in step. A form that accepts 100 km when the API
   stops at 50 looks fine and fails on submit, which is the worst of both. */

export const MAX_EXPERIENCE_YEARS = 60;

export const MIN_RADIUS_M = 500;
export const MAX_RADIUS_M = 50_000;

/** `availabilityReplaceSchema` — at most 21 blocks. */
export const MAX_AVAILABILITY_BLOCKS = 21;

export const WEEKDAYS = [
  { value: 0, key: 'sunday' },
  { value: 1, key: 'monday' },
  { value: 2, key: 'tuesday' },
  { value: 3, key: 'wednesday' },
  { value: 4, key: 'thursday' },
  { value: 5, key: 'friday' },
  { value: 6, key: 'saturday' }
] as const;

/** `time` regex in `provider.schemas.ts`: `HH:MM`, 24-hour. */
export const isValidTimeOfDay = (value: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
