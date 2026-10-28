import { z } from 'zod';
import { password } from '../identity/auth.schemas.js';

const label = z.string().trim().min(1).max(100);
const line = z.string().trim().min(1).max(300);
const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);

export const addressCreateSchema = z
  .object({
    label,
    line1: line,
    line2: line.optional(),
    areaId: z.number().int().positive(),
    lat,
    lng,
    notes: z.string().trim().max(500).optional(),
    isDefault: z.boolean().default(false)
  })
  .strict();

export const addressUpdateSchema = z
  .object({
    label: label.optional(),
    line1: line.optional(),
    line2: line.optional(),
    areaId: z.number().int().positive().optional(),
    lat: lat.optional(),
    lng: lng.optional(),
    notes: z.string().trim().max(500).optional(),
    isDefault: z.boolean().optional()
  })
  .strict()
  .refine(input => (input.lat === undefined) === (input.lng === undefined), { message: 'lat and lng must be provided together', path: ['lat'] });

export type AddressCreateInput = z.infer<typeof addressCreateSchema>;
export type AddressUpdateInput = z.infer<typeof addressUpdateSchema>;

/**
 * SHM-020 profile update. Only the fields a customer owns change here: the phone
 * number and email are login identifiers, so changing either has to go through an
 * OTP (`PHONE_CHANGE` flow) rather than a silent write. `locale` is the one
 * preference the profile carries today.
 */
export const profileUpdateSchema = z
  .object({
    firstName: z.string().trim().min(1).max(80).optional(),
    lastName: z.string().trim().max(80).optional(),
    locale: z.enum(['en', 'ur']).optional()
  })
  .strict()
  .refine(input => Object.keys(input).length > 0, { message: 'Provide at least one field to update' });

export const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(1).max(200),
    newPassword: password
  })
  .strict();

export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;
export type PasswordChangeInput = z.infer<typeof passwordChangeSchema>;
