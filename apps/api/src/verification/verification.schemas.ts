// apps/api/src/verification/verification.schemas.ts
import { z } from 'zod';

export const claimSchema = z.object({ verificationId: z.string().uuid().optional() }).strict();

export const callSchema = z
  .object({
    /** Where to ring the agent (a desk phone or softphone number). Leave out for manual dialling: the customer's number is returned instead. */
    agentEndpoint: z.string().trim().min(3).max(64).optional()
  })
  .strict();

export const attemptSchema = z
  .object({
    result: z.enum(['ANSWERED', 'NO_ANSWER', 'BUSY', 'SWITCHED_OFF', 'WRONG_PERSON', 'CALL_DROPPED']),
    /** When the call started; defaults to now. Its time band is worked out from this, in Pakistan time. */
    startedAt: z.string().datetime().optional(),
    durationSeconds: z.number().int().min(0).max(14_400).optional(),
    callRef: z.string().trim().max(200).optional(),
    recordingRef: z.string().trim().max(500).optional(),
    notes: z.string().trim().max(1000).optional()
  })
  .strict();

const score = z.number().int().min(1).max(5);

/** SRS §5.3: the fixed questionnaire. There is deliberately no free-form "feedback" field other than the customer's own remark, transcribed. */
export const submitSchema = z
  .object({
    workCompleted: z.enum(['FULL', 'PARTIAL', 'NONE']),
    quality: score,
    punctuality: score,
    conduct: score,
    cleanliness: score,
    extraChargeDemanded: z.boolean(),
    extraChargeAmountPaisa: z.number().int().positive().optional(),
    uniformWorn: z.boolean(),
    ownTools: z.boolean(),
    /** The recording consent line was read to the customer before the call was recorded. */
    consentLineRead: z.boolean(),
    /** The customer said, in words, that payment may be released. */
    consentToRelease: z.boolean(),
    outcome: z.enum(['VERIFIED_SATISFIED', 'VERIFIED_WITH_ISSUE', 'REWORK_REQUIRED', 'DISPUTED']),
    /** The customer's remark, transcribed by the agent. Published under their first name and initial if the outcome permits a rating. */
    remark: z.string().trim().max(1000).optional(),
    recordingRef: z.string().trim().max(500).optional(),
    callDurationSeconds: z.number().int().min(0).max(14_400).optional()
  })
  .strict();

export type SubmitInput = z.infer<typeof submitSchema>;
export type AttemptInput = z.infer<typeof attemptSchema>;
