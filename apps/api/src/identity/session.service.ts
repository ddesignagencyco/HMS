import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DomainError } from '../common/domain-error.js';
import { EnvironmentService } from '../config/environment.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { TOKENS, type AuthSecrets } from './auth-secrets.js';
import { hashRefreshToken, issueRefreshToken } from './tokens.js';

export type SessionMeta = { userAgent?: string | undefined; ip?: string | undefined };

export type IssuedSession = { sessionId: string; refreshToken: string; refreshExpiresAt: string };

export type RotatedSession = IssuedSession & { userId: string };

type SessionRow = { id: string; user_id: string; family_id: string; revoked_at: Date | null; replaced_by: string | null; within_grace: boolean };

@Injectable()
export class SessionService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TOKENS) private readonly secrets: AuthSecrets,
    @Inject(EnvironmentService) private readonly environment: EnvironmentService
  ) {}

  /** Opens a brand new rotation family, as at first sign in. */
  async start(userId: string, meta: SessionMeta): Promise<IssuedSession> {
    return this.insert(userId, randomUUID(), meta);
  }

  /**
   * Single-use rotation. A legitimate client only ever holds the newest token,
   * so presenting one that was already rotated means it leaked and both copies
   * may be in use: the whole family is revoked, signing out the thief and the
   * victim alike.
   *
   * A token revoked on purpose (logout, a password change) is different. That
   * is not reuse, so it is reported as a plain unauthenticated request rather
   * than tearing down every sibling session.
   *
   * BE-027 grace window: two tabs that refresh at the same moment both present the same token, and the loser of that race used to be read as a
   * thief and sign both tabs out. A token that was rotated away less than `REFRESH_REUSE_GRACE_SECONDS` ago (default 10) is therefore answered
   * with a fresh token in the same family instead of a revocation. The plaintext of the successor that already went to the first tab is not
   * stored anywhere (only its hash is), so it cannot be handed out again; the second tab gets its own sibling, and the first tab's token stays
   * valid. Both chains rotate independently from there, and a replay of either after the window revokes the family as before.
   */
  async rotate(presented: string, meta: SessionMeta): Promise<RotatedSession> {
    const hash = hashRefreshToken(presented);
    const grace = this.environment.values.REFRESH_REUSE_GRACE_SECONDS;
    // One transaction, so the row lock really is held: two tabs presenting the same token are serialised here instead of both reading it as live.
    const outcome = await this.prisma.$transaction(async tx => {
    const rows = await tx.$queryRaw<SessionRow[]>(
      Prisma.sql`SELECT id, user_id, family_id, revoked_at, replaced_by, (revoked_at IS NOT NULL AND revoked_at > now() - make_interval(secs => ${grace})) as within_grace FROM sessions WHERE refresh_token_hash = ${hash} FOR UPDATE`
    );
    const session = rows[0];
    if (session === undefined) throw new DomainError('UNAUTHENTICATED', 'The refresh token is not valid');
    if (session.revoked_at !== null && session.replaced_by !== null && grace > 0 && session.within_grace && (await this.familyIsLive(tx, session.family_id))) {
      const sibling = await this.insert(session.user_id, session.family_id, meta, tx);
      return { kind: 'rotated' as const, rotated: { userId: session.user_id, ...sibling } };
    }
    if (session.revoked_at !== null) {
      // `replaced_by` is set only when this token was rotated away, which is
      // what separates a leak from a deliberate logout or password change.
      if (session.replaced_by === null && !(await this.familyWasCompromised(session.family_id))) {
        throw new DomainError('UNAUTHENTICATED', 'The refresh token is no longer valid');
      }
      return { kind: 'reuse' as const, familyId: session.family_id };
    }
    const issued = await this.insert(session.user_id, session.family_id, meta, tx);
    // The replacement is recorded on the row that was rotated away, not on the
    // new one. `replaced_by` therefore reads as "this token was replaced by
    // that one", which is what makes the reuse check above correct for the very
    // first token of a family and not only for ones that came from a rotation.
    await tx.$queryRaw(Prisma.sql`UPDATE sessions SET revoked_at = now(), replaced_by = ${issued.sessionId}::uuid WHERE id = ${session.id}::uuid`);
    return { kind: 'rotated' as const, rotated: { userId: session.user_id, ...issued } };
    });
    if (outcome.kind === 'reuse') {
      await this.revokeFamily(outcome.familyId);
      throw new DomainError('REFRESH_REUSE_DETECTED', 'This refresh token was already used. Every session in the family has been signed out.');
    }
    return outcome.rotated;
  }

  /** A grace replay only makes sense while the family still has a live token: a family that was revoked (logout, password change, earlier reuse) stays dead. */
  private async familyIsLive(tx: Prisma.TransactionClient, familyId: string): Promise<boolean> {
    const rows = await tx.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*)::bigint as n FROM sessions WHERE family_id = ${familyId}::uuid AND revoked_at IS NULL AND expires_at > now()`);
    return (rows[0]?.n ?? 0n) > 0n;
  }

  /**
   * Reads a refresh token *without* rotating it, for the one read-only answer
   * that needs it: "is this browser signed in?". Rotating here would revoke the
   * token the caller is about to present for real, so this deliberately does not.
   *
   * Returns null for anything unusable — unknown, revoked, expired — so the
   * caller can answer "no" rather than distinguish, which is the same
   * non-disclosing posture every other auth failure takes.
   */
  async identify(presented: string): Promise<string | null> {
    const rows = await this.prisma.$queryRaw<{ user_id: string }[]>(
      Prisma.sql`SELECT s.user_id FROM sessions s
        WHERE s.refresh_token_hash = ${hashRefreshToken(presented)} AND s.revoked_at IS NULL AND s.expires_at > now()`
    );
    return rows[0]?.user_id ?? null;
  }

  async revoke(presented: string): Promise<void> {
    const hash = hashRefreshToken(presented);
    await this.prisma.$queryRaw(Prisma.sql`UPDATE sessions SET revoked_at = now() WHERE refresh_token_hash = ${hash} AND revoked_at IS NULL`);
  }

  async revokeFamily(familyId: string): Promise<number> {
    return this.prisma.$executeRaw(Prisma.sql`UPDATE sessions SET revoked_at = now() WHERE family_id = ${familyId}::uuid AND revoked_at IS NULL`);
  }

  /**
   * True when some row in the family was revoked by a rotation rather than on
   * purpose. A token caught up in the collateral revocation that follows a leak
   * should keep reporting reuse, so the client keeps telling the user to sign in
   * again instead of seeing a bare 401 and retrying.
   */
  private async familyWasCompromised(familyId: string): Promise<boolean> {
    const [row] = await this.prisma.$queryRaw<{ present: boolean }[]>(
      Prisma.sql`SELECT EXISTS (SELECT 1 FROM sessions WHERE family_id = ${familyId}::uuid AND revoked_at IS NOT NULL AND replaced_by IS NOT NULL) AS present`
    );
    return row?.present === true;
  }

  /** Used after a password change: FR-CU-04 in SHM-020 requires every other session to die. */
  async revokeAllForUser(userId: string): Promise<number> {
    return this.prisma.$executeRaw(Prisma.sql`UPDATE sessions SET revoked_at = now() WHERE user_id = ${userId}::uuid AND revoked_at IS NULL`);
  }

  /**
   * FR-CU-04 in SHM-020: after an authenticated password change every *other*
   * session is signed out, but the caller keeps the one they are using, so the
   * change does not sign the person out of the browser they just typed in.
   */
  async revokeOthersForUser(userId: string, keepSessionId: string): Promise<number> {
    return this.prisma.$executeRaw(
      Prisma.sql`UPDATE sessions SET revoked_at = now() WHERE user_id = ${userId}::uuid AND id <> ${keepSessionId}::uuid AND revoked_at IS NULL`
    );
  }

  private async insert(userId: string, familyId: string, meta: SessionMeta, client: Prisma.TransactionClient | PrismaService = this.prisma): Promise<IssuedSession> {
    const issued = issueRefreshToken(this.secrets);
    const [row] = await client.$queryRaw<{ id: string }[]>(
      Prisma.sql`INSERT INTO sessions(user_id, family_id, refresh_token_hash, user_agent, ip, expires_at)
                 VALUES (${userId}::uuid, ${familyId}::uuid, ${issued.hash}, ${meta.userAgent ?? null}, ${meta.ip ?? null}::inet, ${issued.expiresAt})
                 RETURNING id`
    );
    if (row === undefined) throw new DomainError('INTERNAL_ERROR', 'The session could not be created');
    return { sessionId: row.id, refreshToken: issued.token, refreshExpiresAt: issued.expiresAt.toISOString() };
  }
}
