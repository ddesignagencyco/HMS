import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DomainError, conflict, notFound } from '../common/domain-error.js';
import type { AuthenticatedPrincipal } from '../common/policy.js';
import { PrismaService } from '../database/prisma.service.js';
import { AuthService, type AuthenticatedUser } from '../identity/auth.service.js';
import { hashPassword, verifyPassword } from '../identity/password.js';
import { SessionService } from '../identity/session.service.js';
import { AuditService } from '../platform/audit.service.js';
import type { PasswordChangeInput, ProfileUpdateInput } from './customer.schemas.js';

type UserState = { id: string; status: string; anonymised_at: Date | null };

/**
 * SHM-020: the account-owner's own surface. `GET /me` is the profile the client
 * reads right after sign in (the same shape `GET /auth/me` returns, exposed under
 * the contract's `/me` path); `PATCH /me` changes the fields the user owns;
 * `PATCH /me/password` changes the password and signs out every other session;
 * `POST /me/deactivate` anonymises the personal data while leaving bookings and
 * ledger rows untouched, because those are financial records the platform must
 * keep (FR-CU-08/09).
 */
@Injectable()
export class MeService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(AuditService) private readonly audit: AuditService
  ) {}

  get(principal: AuthenticatedPrincipal): Promise<AuthenticatedUser> {
    return this.auth.describe(principal.userId);
  }

  async update(principal: AuthenticatedPrincipal, input: ProfileUpdateInput): Promise<AuthenticatedUser> {
    await this.prisma.$executeRaw(
      Prisma.sql`UPDATE users SET
          first_name = COALESCE(${input.firstName ?? null}, first_name),
          last_name = COALESCE(${input.lastName ?? null}, last_name),
          locale = COALESCE(${input.locale ?? null}, locale)
        WHERE id = ${principal.userId}::uuid`
    );
    await this.audit.append({ actorUserId: principal.userId, actorRole: principal.roles[0] ?? 'CUSTOMER', action: 'customer.profile.update', entityType: 'user', entityId: principal.userId, after: { ...input } });
    return this.auth.describe(principal.userId);
  }

  /** FR-CU-04: the current password is required, and every other session dies. */
  async changePassword(principal: AuthenticatedPrincipal, input: PasswordChangeInput): Promise<{ changed: true; otherSessionsRevoked: number }> {
    const rows = await this.prisma.$queryRaw<{ password_hash: string }[]>(Prisma.sql`SELECT password_hash FROM users WHERE id = ${principal.userId}::uuid`);
    const current = rows[0];
    if (current === undefined) throw notFound('User');
    if (!(await verifyPassword(current.password_hash, input.currentPassword))) throw new DomainError('INVALID_CREDENTIALS', 'Your current password is not correct');

    const passwordHash = await hashPassword(input.newPassword);
    await this.prisma.$executeRaw(Prisma.sql`UPDATE users SET password_hash = ${passwordHash} WHERE id = ${principal.userId}::uuid`);
    const otherSessionsRevoked = await this.sessions.revokeOthersForUser(principal.userId, principal.sessionId);
    await this.audit.append({ actorUserId: principal.userId, actorRole: principal.roles[0] ?? 'CUSTOMER', action: 'customer.password.change', entityType: 'user', entityId: principal.userId });
    return { changed: true, otherSessionsRevoked };
  }

  /**
   * FR-CU-08/09. The account is not deleted (`users_no_delete` forbids that and the
   * bookings/ledger foreign keys would not survive it): the name, phone and email
   * are overwritten, the password is made unusable, TOTP is dropped and every
   * session is revoked, while the `customers` row and the financial history stay.
   * The email has to keep at least a placeholder because the table's CHECK requires
   * a phone *or* an email, and it has to stay unique because the column is UNIQUE.
   */
  async deactivate(principal: AuthenticatedPrincipal): Promise<{ status: 'DEACTIVATED' }> {
    const rows = await this.prisma.$queryRaw<UserState[]>(Prisma.sql`SELECT id, status, anonymised_at FROM users WHERE id = ${principal.userId}::uuid`);
    const user = rows[0];
    if (user === undefined) throw notFound('User');
    if (user.anonymised_at !== null || user.status === 'DEACTIVATED') throw conflict('This account is already deactivated');

    const placeholderEmail = `deleted+${randomUUID()}@anonymised.invalid`;
    await this.prisma.$transaction(async tx => {
      await tx.$executeRaw(
        Prisma.sql`UPDATE users SET
            first_name = 'Deleted', last_name = '', email = ${placeholderEmail}, phone_e164 = NULL,
            password_hash = ${randomUUID()}, totp_secret_enc = NULL, totp_enabled_at = NULL,
            status = 'DEACTIVATED', deactivated_at = now(), anonymised_at = now()
          WHERE id = ${principal.userId}::uuid`
      );
      await tx.$executeRaw(Prisma.sql`UPDATE providers SET status = 'DEACTIVATED' WHERE user_id = ${principal.userId}::uuid AND status <> 'DEACTIVATED'`);
      await tx.$executeRaw(Prisma.sql`UPDATE sessions SET revoked_at = now() WHERE user_id = ${principal.userId}::uuid AND revoked_at IS NULL`);
      await this.audit.append({ actorUserId: principal.userId, actorRole: principal.roles[0] ?? 'CUSTOMER', action: 'customer.deactivate', entityType: 'user', entityId: principal.userId, before: { status: user.status }, after: { status: 'DEACTIVATED', piiAnonymised: true } }, tx);
    });
    return { status: 'DEACTIVATED' };
  }
}
