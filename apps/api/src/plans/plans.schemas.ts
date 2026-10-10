import { z } from 'zod';

const name = z.string().trim().min(1).max(200);
const description = z.string().trim().min(1).max(2000);
const paisa = z.number().int().positive('Price must be greater than zero');
const positiveInt = z.number().int().positive();

export const planServiceItemSchema = z
  .object({
    serviceId: positiveInt,
    visitsIncluded: positiveInt,
    intervalDays: positiveInt
  })
  .strict();

export const planCreateSchema = z
  .object({
    nameEn: name,
    nameUr: name,
    description,
    pricePaisa: paisa,
    durationMonths: positiveInt,
    services: z.array(planServiceItemSchema).min(1, 'At least one service must be included in the plan')
  })
  .strict();

export const planUpdateSchema = z
  .object({
    nameEn: name.optional(),
    nameUr: name.optional(),
    description: description.optional(),
    pricePaisa: paisa.optional(),
    durationMonths: positiveInt.optional(),
    isActive: z.boolean().optional()
  })
  .strict();

export const planSubscribeSchema = z
  .object({
    addressId: z.string().uuid(),
    preferredProviderId: z.string().uuid().nullish(),
    returnUrl: z.string().url().optional()
  })
  .strict();

export const subscriptionCancelSchema = z
  .object({
    reason: z.string().trim().max(1000).optional()
  })
  .strict();

export type PlanCreateInput = z.infer<typeof planCreateSchema>;
export type PlanUpdateInput = z.infer<typeof planUpdateSchema>;
export type PlanSubscribeInput = z.infer<typeof planSubscribeSchema>;
export type SubscriptionCancelInput = z.infer<typeof subscriptionCancelSchema>;
