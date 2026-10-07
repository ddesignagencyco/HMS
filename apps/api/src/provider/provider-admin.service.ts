import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { conflict, notFound } from '../common/domain-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { AuditService } from '../platform/audit.service.js';

const BLOCKABLE = new Set(['APPROVED', 'SUSPENDED']);

/**
 * SHM-024: the admin-facing block/unblock/deactivate buttons for a provider.
 *
 * These are deliberately separate from the conduct engine's `provider.block` /
 * `provider.suspend` penalty effects: those are consequences of a breach, this is
 * an admin acting on their own judgement. Every change is a status write (FR-AD-09
 * forbids deletes) and is audited.
 */
@Injectable()
export class ProviderAdminService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService
  ) {}

  async block(actorId: string, providerId: string): Promise<{ id: string; status: string }> {
    return this.transition(actorId, providerId, 'BLOCKED', 'admin.provider.block', current => (BLOCKABLE.has(current) ? null : `A provider that is ${current} cannot be blocked`));
  }

  async unblock(actorId: string, providerId: string): Promise<{ id: string; status: string }> {
    return this.transition(actorId, providerId, 'APPROVED', 'admin.provider.unblock', current => (current === 'BLOCKED' ? null : `A provider that is ${current} is not blocked`));
  }

  async deactivate(actorId: string, providerId: string): Promise<{ id: string; status: string }> {
    return this.transition(actorId, providerId, 'DEACTIVATED', 'admin.provider.deactivate', current => (current === 'DEACTIVATED' ? 'This provider is already deactivated' : null));
  }

  private async transition(actorId: string, providerId: string, next: string, action: string, reject: (current: string) => string | null): Promise<{ id: string; status: string }> {
    return this.prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<{ status: string }[]>(Prisma.sql`SELECT status::text as status FROM providers WHERE user_id = ${providerId}::uuid FOR UPDATE`);
      const current = rows[0];
      if (current === undefined) throw notFound('Provider');
      const reason = reject(current.status);
      if (reason !== null) throw conflict(reason);
      await tx.$executeRaw(Prisma.sql`UPDATE providers SET status = ${next}::provider_status WHERE user_id = ${providerId}::uuid`);
      await this.audit.append({ actorUserId: actorId, actorRole: 'ADMIN', action, entityType: 'provider', entityId: providerId, before: { status: current.status }, after: { status: next } }, tx);
      return { id: providerId, status: next };
    });
  }
}
