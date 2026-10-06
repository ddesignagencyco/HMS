import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { conflict, notFound } from '../common/domain-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { AuditService } from '../platform/audit.service.js';
import { SettingsService } from '../platform/settings.service.js';
import { ProviderDocumentsService } from './provider-documents.service.js';

export type ProviderApprovalRow = { userId: string; status: string; approvedAt: Date | null; approvedBy: string | null; rejectionReason: string | null };

const APPROVAL_COLUMNS = Prisma.sql`user_id as "userId", status, approved_at as "approvedAt", approved_by as "approvedBy", rejection_reason as "rejectionReason"`;

@Injectable()
export class ProviderApprovalService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(ProviderDocumentsService) private readonly documents: ProviderDocumentsService,
    @Inject(AuditService) private readonly audit: AuditService
  ) {}

  /**
   * SHM-023: approval is gated on identity. When `verification.require_verified_cnic`
   * is on, a provider cannot enter the marketplace until an admin has verified their
   * CNIC — the evidence being a VERIFIED CNIC_FRONT/CNIC_BACK document. Approval is
   * one transaction: it moves the provider to APPROVED, mints their PROVIDER_WALLET
   * ledger account (idempotent for a second approval) and leaves an audit trail. The
   * wallet existing from day one means the first escrow release finds an account to
   * credit without a lookup-time upsert.
   */
  async approve(providerId: string, adminId: string): Promise<ProviderApprovalRow> {
    let cnicVerified = false;
    if (await this.settings.getBoolean('verification.require_verified_cnic')) {
      const state = await this.documents.cnicReviewState(providerId);
      cnicVerified = state.cnicVerified;
      if (!cnicVerified) throw conflict('A provider can only be approved once an admin has verified their CNIC');
    }

    const rows = await this.prisma.$transaction(async tx => {
      const before = await tx.$queryRaw<{ status: string }[]>(Prisma.sql`SELECT status FROM providers WHERE user_id = ${providerId}::uuid FOR UPDATE`);
      if (before.length === 0) throw notFound('Provider');
      const updated = await tx.$queryRaw<ProviderApprovalRow[]>(
        Prisma.sql`UPDATE providers SET status = 'APPROVED', approved_at = now(), approved_by = ${adminId}::uuid, rejection_reason = NULL
          WHERE user_id = ${providerId}::uuid RETURNING ${APPROVAL_COLUMNS}`
      );
      if (updated[0] === undefined) throw new Error('Provider approval returned no row');
      await tx.$executeRaw(
        Prisma.sql`INSERT INTO ledger_accounts(type, owner_user_id) VALUES ('PROVIDER_WALLET'::account_type, ${providerId}::uuid)
          ON CONFLICT ON CONSTRAINT ledger_accounts_uniq DO NOTHING`
      );
      await this.audit.append(
        { actorUserId: adminId, actorRole: 'ADMIN', action: 'provider.approval', entityType: 'provider', entityId: providerId, before: { status: before[0]?.status }, after: { status: 'APPROVED', cnicVerified } },
        tx
      );
      return updated;
    });
    const row = rows[0];
    if (row === undefined) throw notFound('Provider');
    return row;
  }

  async reject(providerId: string, reason: string): Promise<ProviderApprovalRow> {
    const rows = await this.prisma.$queryRaw<ProviderApprovalRow[]>(
      Prisma.sql`UPDATE providers SET status = 'REJECTED', rejection_reason = ${reason}, approved_at = NULL, approved_by = NULL
        WHERE user_id = ${providerId}::uuid RETURNING ${APPROVAL_COLUMNS}`
    );
    const row = rows[0];
    if (row === undefined) throw notFound('Provider');
    return row;
  }
}