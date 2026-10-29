// apps/api/src/provider/provider-documents.service.ts
import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DomainError, conflict, notFound } from '../common/domain-error.js';
import { EnvironmentService } from '../config/environment.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { OBJECT_STORAGE } from '../integrations/integrations.module.js';
import type { ObjectStoragePort } from '../integrations/ports.js';
import { AuditService } from '../platform/audit.service.js';
import { cnicBlindIndex, decryptCnic, encryptCnic, normalizeCnic } from './cnic-vault.js';
import { documentContentTypes, type DocumentPresignInput, type DocumentReviewInput, type DocumentSubmitInput } from './provider-documents.schemas.js';

const BUCKET = 'documents';
/** SHM-022: "viewing via 5-min signed URLs". The storage mock rejects a TTL outside 1..900. */
const SIGNED_URL_SECONDS = 300;
const MAX_DOCUMENT_BYTES = 5_242_880;
const MAX_VIDEO_BYTES = 52_428_800;
const PRISMA_UNIQUE_VIOLATION = 'P2002';

const maxBytesFor = (contentType: string): number => (contentType.startsWith('video/') ? MAX_VIDEO_BYTES : MAX_DOCUMENT_BYTES);

/** Why an uploaded object cannot be a provider document, or null when it can. Exported for the unit test. */
export const uploadProblem = (stored: { size: number; contentType: string }): string | null => {
  // A parameterised type (`image/jpeg; charset=...`) is still that type.
  const type = stored.contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (!(documentContentTypes as readonly string[]).includes(type)) return `A document must be one of ${documentContentTypes.join(', ')}; the uploaded file is ${type === '' ? 'of an unknown type' : type}`;
  if (stored.size <= 0) return 'The uploaded document is empty';
  const maxBytes = maxBytesFor(type);
  if (stored.size > maxBytes) return `The uploaded document is larger than the ${maxBytes} byte limit`;
  return null;
};

export type ProviderDocumentRow = {
  id: string;
  providerId: string;
  docType: string;
  status: string;
  storageKey: string;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  reviewNote: string | null;
  createdAt: Date;
};

const DOCUMENT_COLUMNS = Prisma.sql`id, provider_id as "providerId", doc_type as "docType", status, storage_key as "storageKey",
  reviewed_by as "reviewedBy", reviewed_at as "reviewedAt", review_note as "reviewNote", created_at as "createdAt"`;

/**
 * FR-SP-06 / FR-AD-10 / NFR-PR-03: a provider proves who they are by uploading their
 * CNIC (front and back), a trade certificate and, optionally, a character certificate.
 *
 * Three properties matter more than the happy path:
 *
 * - **The CNIC is never at rest in the clear.** It is AES-256-GCM encrypted, and a
 *   keyed blind index alongside it makes "one person, one account" enforceable as a
 *   plain unique constraint. A database dump alone cannot tell you whose CNIC is on
 *   file, only which rows collide.
 * - **Viewing is privileged and logged.** Documents are CNIC scans, so only an admin
 *   who has cleared TOTP can obtain a link, the link lives five minutes, and every
 *   single view is written to the audit log. Agents and finance get a 403: a verifier
 *   has no reason to read a provider's identity document.
 * - **Nothing about the CNIC is echoed back.** Responses carry review state and a
 *   boolean saying whether a CNIC is on file, never the digits.
 */
@Injectable()
export class ProviderDocumentsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(EnvironmentService) private readonly environment: EnvironmentService
  ) {}

  /**
   * Hands back a short-lived direct-to-storage upload target and the key to confirm
   * it under. Minting the key here — rather than letting the client name it — is what
   * keeps one provider from confirming a document belonging to another.
   */
  async presign(providerId: string, input: DocumentPresignInput): Promise<{ storageKey: string; url: string; method: 'PUT'; expiresAt: string; maxBytes: number }> {
    const storageKey = this.storageKeyFor(providerId, input.docType, randomUUID());
    const maxBytes = maxBytesFor(input.contentType);
    const upload = await this.storage.presignPut({ key: storageKey, bucket: BUCKET, contentType: input.contentType, maxBytes });
    return { storageKey, url: upload.url, method: upload.method, expiresAt: upload.expiresAt, maxBytes };
  }

  /**
   * Records a document against the signed-in provider. A provider may replace a
   * rejected document by uploading again — there is deliberately no unique constraint
   * on (provider, doc_type), because re-shooting a blurry CNIC has to be possible.
   * The review state therefore lives per row, and only a VERIFIED row counts.
   */
  async submit(providerId: string, actorUserId: string, input: DocumentSubmitInput): Promise<ProviderDocumentRow> {
    const storageKey = await this.resolveStorage(providerId, input);
    const { encrypted, blindIndex } = this.encryptCnicIfGiven(input.cnicNumber);

    try {
      const inserted = await this.prisma.$transaction(async tx => {
        if (encrypted !== null && blindIndex !== null)
          await tx.$executeRaw(Prisma.sql`UPDATE providers SET cnic_enc = ${encrypted}, cnic_hash = ${blindIndex}, updated_at = now() WHERE user_id = ${providerId}::uuid`);
        return tx.$queryRaw<ProviderDocumentRow[]>(
          Prisma.sql`INSERT INTO provider_documents(provider_id, doc_type, storage_key)
            VALUES (${providerId}::uuid, ${input.docType}::document_type, ${storageKey})
            RETURNING ${DOCUMENT_COLUMNS}`
        );
      });
      const row = inserted[0];
      if (row === undefined) throw new Error('Document insert returned no row');
      // Deliberately outside the transaction above: an audit row that rolled back
      // with its subject would be worse than one that outlives a failed write.
      await this.audit.append({
        actorUserId,
        actorRole: 'PROVIDER',
        action: 'provider_document.upload',
        entityType: 'provider_document',
        entityId: row.id,
        after: { providerId, docType: input.docType, cnicRecorded: encrypted !== null }
      });
      return row;
    } catch (error) {
      throw this.describeWriteFailure(error);
    }
  }

  /** The provider's own documents, newest first. Their own CNIC, so no restriction is needed beyond ownership. */
  async listMine(providerId: string): Promise<ProviderDocumentRow[]> {
    return this.documentsQuery(Prisma.sql`provider_id = ${providerId}::uuid`);
  }

  /** One provider's documents as seen by an approving admin. */
  async listForProvider(providerId: string): Promise<ProviderDocumentRow[]> {
    const exists = await this.prisma.$queryRaw<{ userId: string }[]>(Prisma.sql`SELECT user_id as "userId" FROM providers WHERE user_id = ${providerId}::uuid`);
    if (exists.length === 0) throw notFound('Provider');
    return this.documentsQuery(Prisma.sql`provider_id = ${providerId}::uuid`);
  }

  /**
   * A five-minute signed link to one document, for the admin queue to render. Every
   * call is audited: who looked at whose CNIC, and when, is exactly the record an
   * identity-document viewer must leave behind.
   */
  async signedUrl(documentId: string, actor: { userId: string; role: 'ADMIN' }): Promise<{ url: string; expiresAt: string }> {
    const rows = await this.prisma.$queryRaw<{ id: string; providerId: string; storageKey: string }[]>(
      Prisma.sql`SELECT id, provider_id as "providerId", storage_key as "storageKey" FROM provider_documents WHERE id = ${documentId}::uuid`
    );
    const document = rows[0];
    if (document === undefined) throw notFound('Document');
    if ((await this.storage.head({ key: document.storageKey, bucket: BUCKET })) === null) throw notFound('Document');
    const link = await this.storage.presignGet({ key: document.storageKey, bucket: BUCKET, ttlSeconds: SIGNED_URL_SECONDS });
    await this.audit.append({
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'provider_document.view',
      entityType: 'provider_document',
      entityId: document.id,
      after: { providerId: document.providerId }
    });
    return { url: link.url, expiresAt: link.expiresAt };
  }

  /**
   * BE-019: a provider checks that their own certificate scan is legible. Own documents only - someone else's is a 404, not a 403, so
   * document ids cannot be probed - and never the CNIC: an identity document stays admin-only (SHM-022), so a CNIC_FRONT/BACK row is a 403.
   * Same five-minute link and the same audit row as the admin route, with the provider as the actor.
   */
  async signedUrlForOwner(documentId: string, providerId: string): Promise<{ url: string; expiresAt: string }> {
    const rows = await this.prisma.$queryRaw<{ id: string; docType: string; storageKey: string }[]>(
      Prisma.sql`SELECT id, doc_type::text as "docType", storage_key as "storageKey" FROM provider_documents WHERE id = ${documentId}::uuid AND provider_id = ${providerId}::uuid`
    );
    const document = rows[0];
    if (document === undefined) throw notFound('Document');
    if (document.docType === 'CNIC_FRONT' || document.docType === 'CNIC_BACK') throw new DomainError('FORBIDDEN', 'An identity document cannot be viewed again once it is uploaded; upload a new one if it was unclear');
    if ((await this.storage.head({ key: document.storageKey, bucket: BUCKET })) === null) throw notFound('Document');
    const link = await this.storage.presignGet({ key: document.storageKey, bucket: BUCKET, ttlSeconds: SIGNED_URL_SECONDS });
    await this.audit.append({ actorUserId: providerId, actorRole: 'PROVIDER', action: 'provider_document.view_own', entityType: 'provider_document', entityId: document.id, after: { docType: document.docType } });
    return { url: link.url, expiresAt: link.expiresAt };
  }

  /**
   * Verifies or rejects one document. Recorded with the reviewing admin and a note;
   * a rejection requires one, because it is the only thing the provider is told.
   */
  async review(documentId: string, adminId: string, input: DocumentReviewInput): Promise<ProviderDocumentRow> {
    const rows = await this.prisma.$transaction(async tx => {
      const before = await tx.$queryRaw<{ status: string }[]>(Prisma.sql`SELECT status FROM provider_documents WHERE id = ${documentId}::uuid FOR UPDATE`);
      if (before.length === 0) throw notFound('Document');
      const updated = await tx.$queryRaw<ProviderDocumentRow[]>(
        Prisma.sql`UPDATE provider_documents SET status = ${input.status}::review_status, review_note = ${input.note ?? null}, reviewed_by = ${adminId}::uuid, reviewed_at = now()
          WHERE id = ${documentId}::uuid RETURNING ${DOCUMENT_COLUMNS}`
      );
      if (updated[0] === undefined) throw new Error('Document review returned no row');
      await this.audit.append(
        { actorUserId: adminId, actorRole: 'ADMIN', action: 'provider_document.review', entityType: 'provider_document', entityId: documentId, before: { status: before[0]?.status }, after: { status: input.status } },
        tx
      );
      return updated;
    });
    const row = rows[0];
    if (row === undefined) throw new Error('Document review returned no row');
    return row;
  }

  /**
   * Whether this provider's CNIC has been verified by an admin. Exposed as a boolean
   * so the approval flow can gate on it without any endpoint handing out the digits.
   */
  async cnicReviewState(providerId: string): Promise<{ hasCnic: boolean; cnicVerified: boolean }> {
    const rows = await this.prisma.$queryRaw<{ hasCnic: boolean; verified: boolean }[]>(
      Prisma.sql`SELECT cnic_enc IS NOT NULL as "hasCnic",
          EXISTS (SELECT 1 FROM provider_documents d WHERE d.provider_id = ${providerId}::uuid AND d.doc_type IN ('CNIC_FRONT','CNIC_BACK') AND d.status = 'VERIFIED') as verified
        FROM providers WHERE user_id = ${providerId}::uuid`
    );
    const row = rows[0];
    if (row === undefined) throw notFound('Provider');
    return { hasCnic: row.hasCnic, cnicVerified: row.verified };
  }

  /**
   * Proof for a test or an admin support case that the stored ciphertext really does
   * decrypt back to the CNIC that was submitted. Not exposed over HTTP — it would undo
   * the point of encrypting the value at all.
   */
  async readCnicForVerification(providerId: string): Promise<string | null> {
    const rows = await this.prisma.$queryRaw<{ cnicEnc: Buffer | null }[]>(Prisma.sql`SELECT cnic_enc as "cnicEnc" FROM providers WHERE user_id = ${providerId}::uuid`);
    const stored = rows[0]?.cnicEnc ?? null;
    return stored === null ? null : decryptCnic(this.cnicKey(), stored);
  }

  private documentsQuery(where: Prisma.Sql): Promise<ProviderDocumentRow[]> {
    return this.prisma.$queryRaw<ProviderDocumentRow[]>(Prisma.sql`SELECT ${DOCUMENT_COLUMNS} FROM provider_documents WHERE ${where} ORDER BY created_at DESC, id DESC`);
  }

  private storageKeyFor(providerId: string, docType: string, clientUuid: string): string {
    return `${providerId}/${docType}/${clientUuid}`;
  }

  /** Either stores the bytes inline, or checks the presigned upload actually landed. */
  private async resolveStorage(providerId: string, input: DocumentSubmitInput): Promise<string> {
    if (input.storageKey !== undefined) {
      if (!input.storageKey.startsWith(`${providerId}/`)) throw new DomainError('FORBIDDEN', 'That upload key belongs to another provider');
      const stored = await this.storage.head({ key: input.storageKey, bucket: BUCKET });
      if (stored === null) throw notFound('Uploaded file');
      // BE-006 (3.1 / 4.9): a signed upload URL carries no size or type limit of its own (Supabase's createSignedUploadUrl takes none), so
      // the bytes that actually landed are checked here, before a row vouches for them. A rejected object is removed so it cannot be
      // confirmed later or sit in the bucket unreferenced.
      const problem = uploadProblem(stored);
      if (problem !== null) {
        await this.storage.remove({ key: input.storageKey, bucket: BUCKET }).catch(() => undefined);
        throw new DomainError('UPLOAD_REJECTED', problem);
      }
      return input.storageKey;
    }
    const contentType = input.contentType;
    const contentBase64 = input.contentBase64;
    if (contentType === undefined || contentBase64 === undefined) throw new DomainError('VALIDATION_FAILED', 'An inline upload needs contentType and contentBase64');
    const content = Buffer.from(contentBase64, 'base64');
    if (content.byteLength === 0) throw new DomainError('UPLOAD_REJECTED', 'The document is empty');
    const maxBytes = maxBytesFor(contentType);
    if (content.byteLength > maxBytes) throw new DomainError('UPLOAD_REJECTED', `The document is larger than the ${maxBytes} byte limit`);
    const storageKey = this.storageKeyFor(providerId, input.docType, input.clientUuid ?? randomUUID());
    await this.storage.put({ key: storageKey, bucket: BUCKET, content, contentType });
    return storageKey;
  }

  private encryptCnicIfGiven(cnicNumber: string | undefined): { encrypted: Buffer | null; blindIndex: string | null } {
    if (cnicNumber === undefined) return { encrypted: null, blindIndex: null };
    const normalized = normalizeCnic(cnicNumber);
    return { encrypted: encryptCnic(this.cnicKey(), normalized), blindIndex: cnicBlindIndex(this.environment.values.OTP_PEPPER, normalized) };
  }

  private cnicKey(): Buffer {
    const key = Buffer.from(this.environment.values.CNIC_ENCRYPTION_KEY, 'base64');
    if (key.length !== 32) throw new Error('CNIC_ENCRYPTION_KEY must decode to exactly 32 bytes');
    return key;
  }

  /**
   * `cnic_hash` carries a UNIQUE constraint, so the database is the authority on
   * "this CNIC is taken" — including against two providers submitting at once, which
   * a pre-flight SELECT would race on.
   */
  private describeWriteFailure(error: unknown): Error {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      const meta = error.meta as { code?: unknown; target?: unknown } | undefined;
      if (meta?.code === PRISMA_UNIQUE_VIOLATION) {
        const target = meta.target;
        const columns = Array.isArray(target) ? target.filter((part): part is string => typeof part === 'string') : typeof target === 'string' ? [target] : [];
        if (columns.includes('cnic_hash')) return conflict('That CNIC is already registered to another provider');
        return conflict('That document has already been recorded');
      }
    }
    if (error instanceof DomainError) return error;
    return error instanceof Error ? error : new Error('The document could not be recorded');
  }
}
