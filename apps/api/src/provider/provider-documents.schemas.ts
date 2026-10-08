// apps/api/src/provider/provider-documents.schemas.ts
import { DocumentType, ReviewStatus } from '@smart-home/contracts';
import { z } from 'zod';

/**
 * NFR-PR-03 / TRD §18: identity documents only. A generic `application/octet-stream`
 * upload would let anything be parked in the documents bucket and later be served
 * back from a signed link as if it were a CNIC scan.
 */
export const documentContentTypes = ['image/jpeg', 'image/png', 'application/pdf'] as const;

const contentType = z.enum(documentContentTypes, { errorMap: () => ({ message: `A document must be one of ${documentContentTypes.join(', ')}` }) });

const clientUuid = z.string().uuid();

/**
 * A provider either uploads the bytes inline (the mock-storage path, and what the
 * integration suite drives) or confirms a key it was already handed by
 * `POST /uploads/presign`. Exactly one of the two, so a request can never claim a
 * document exists while carrying no proof of it either way.
 */
export const documentSubmitSchema = z
  .object({
    docType: DocumentType.schema,
    clientUuid: clientUuid.optional(),
    contentBase64: z.string().min(1).optional(),
    contentType: contentType.optional(),
    storageKey: z.string().trim().min(1).max(400).optional(),
    /** Only meaningful alongside a CNIC document; encrypted at rest, never echoed back. */
    cnicNumber: z
      .string()
      .trim()
      .regex(/^[\d\s-]{13,20}$/, 'A CNIC is 13 digits, written 35202-1234567-1')
      .optional()
  })
  .strict()
  .refine(input => (input.contentBase64 === undefined) !== (input.storageKey === undefined), {
    message: 'Provide either contentBase64 or storageKey, not both and not neither',
    path: ['contentBase64']
  })
  .refine(input => input.cnicNumber === undefined || input.docType === 'CNIC_FRONT' || input.docType === 'CNIC_BACK', {
    message: 'A CNIC number may only be recorded against a CNIC_FRONT or CNIC_BACK document',
    path: ['cnicNumber']
  });

/** A review is a decision, so `PENDING` is not one a reviewer can set. */
const reviewDecision = ReviewStatus.schema.exclude(['PENDING']);

export const documentReviewSchema = z
  .object({
    status: reviewDecision,
    note: z.string().trim().min(1).max(500).optional()
  })
  .strict()
  .refine(input => input.status !== 'REJECTED' || input.note !== undefined, {
    message: 'A rejection must say why, so the provider can be told',
    path: ['note']
  });

export const documentPresignSchema = z
  .object({
    docType: DocumentType.schema,
    contentType: contentType
  })
  .strict();

export type DocumentSubmitInput = z.infer<typeof documentSubmitSchema>;
export type DocumentReviewInput = z.infer<typeof documentReviewSchema>;
export type DocumentPresignInput = z.infer<typeof documentPresignSchema>;
