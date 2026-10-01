// apps/api/src/reputation/reputation.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DomainError, notFound } from '../common/domain-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { ConductService } from '../conduct/conduct.service.js';
import { AuditService, appendOutboxEvent } from '../platform/audit.service.js';
import { SettingsService } from '../platform/settings.service.js';

export type Reputation = {
  /** The published score on a 1–5 scale, rounded to two places (CL-17). Null until there is at least one rating and no prior. */
  score: number;
  ratingCount: number;
  /** How many ratings fall in each whole-star bucket, 1 to 5. */
  distribution: Record<'1' | '2' | '3' | '4' | '5', number>;
  verifiedJobs: number;
  badge: string | null;
};

/** How many verified jobs earn each badge, highest first (FR-AD-11, from verified jobs only). */
const BADGES: readonly { badge: string; minJobs: number }[] = [
  { badge: 'ELITE', minJobs: 200 },
  { badge: 'PRO', minJobs: 50 },
  { badge: 'TRUSTED', minJobs: 10 }
];

/** The most recent ratings that count double-ish (SRS FR-RT-04: weighted toward the last 20 jobs). */
const RECENT_WINDOW = 20;

export const badgeFor = (verifiedJobs: number): string | null => BADGES.find(entry => verifiedJobs >= entry.minJobs)?.badge ?? null;

/**
 * CL-17: a provider with two five-star ratings should not outrank one with two hundred at 4.8. The published score is a weighted mean
 * pulled toward a neutral prior (`rating.bayesian_prior`) by an imaginary number of ratings (`rating.bayesian_weight`), and the most
 * recent 20 ratings count `rating.recent_weight` times as much as older ones. Pure arithmetic over integer scores: hundredths in, hundredths out.
 */
export const weightedScoreHundredths = (ratingsNewestFirst: readonly number[], prior: number, priorWeight: number, recentWeight: number): number => {
  let numerator = Math.round(prior * 100) * priorWeight;
  let denominator = priorWeight;
  ratingsNewestFirst.forEach((scoreHundredths, index) => {
    const weight = index < RECENT_WINDOW ? recentWeight : 1;
    numerator += scoreHundredths * weight;
    denominator += weight;
  });
  return Math.round(numerator / denominator);
};

@Injectable()
export class ReputationService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ConductService) private readonly conduct: ConductService
  ) {}

  async reputation(client: Prisma.TransactionClient | PrismaService, providerId: string): Promise<Reputation> {
    const ratings = await client.$queryRaw<{ score: string }[]>(Prisma.sql`SELECT score::text FROM ratings WHERE provider_id = ${providerId}::uuid ORDER BY created_at DESC, id DESC`);
    const hundredths = ratings.map(row => Math.round(Number(row.score) * 100));
    const prior = await this.settings.getNumber('rating.bayesian_prior');
    const priorWeight = await this.settings.getNumber('rating.bayesian_weight');
    const recentWeight = await this.settings.getNumber('rating.recent_weight');
    const jobs = await client.$queryRaw<{ n: bigint }[]>(
      Prisma.sql`SELECT count(DISTINCT v.booking_id)::bigint as n FROM verification_calls v JOIN bookings b ON b.id = v.booking_id WHERE b.provider_id = ${providerId}::uuid AND v.outcome IN ('VERIFIED_SATISFIED','VERIFIED_WITH_ISSUE','LINK_CONFIRMED')`
    );
    const verifiedJobs = Number(jobs[0]?.n ?? 0n);
    const distribution: Reputation['distribution'] = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
    for (const value of hundredths) distribution[String(Math.min(5, Math.max(1, Math.round(value / 100)))) as keyof Reputation['distribution']] += 1;
    return {
      score: weightedScoreHundredths(hundredths, prior, priorWeight, recentWeight) / 100,
      ratingCount: hundredths.length,
      distribution,
      verifiedJobs,
      badge: badgeFor(verifiedJobs)
    };
  }

  async publicReputation(providerId: string): Promise<Reputation> {
    const found = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT user_id as id FROM providers WHERE user_id = ${providerId}::uuid AND status = 'APPROVED'`);
    if (found[0] === undefined) throw notFound('Provider');
    return this.reputation(this.prisma, providerId);
  }

  /**
   * The projector, run inside the transaction that published a rating: recompute the badge from verified jobs and, if the plain average has
   * fallen to the poor threshold (with enough ratings for it to mean something), flag the provider for review once. It is derived data —
   * calling it twice changes nothing.
   */
  async refresh(tx: Prisma.TransactionClient, providerId: string): Promise<void> {
    const reputation = await this.reputation(tx, providerId);
    await tx.$executeRaw(Prisma.sql`UPDATE providers SET tier_badge = ${reputation.badge} WHERE user_id = ${providerId}::uuid AND tier_badge IS DISTINCT FROM ${reputation.badge}`);
    await this.refreshLowRatingFlag(tx, providerId, reputation.ratingCount);
    await this.proposePoorStreak(tx, providerId);
  }

  /** SRS §8.2 POOR_STREAK: three consecutive rated jobs each under 3.0. Proposed once per streak — the same three ratings never propose it twice. */
  private async proposePoorStreak(tx: Prisma.TransactionClient, providerId: string): Promise<void> {
    const last = await tx.$queryRaw<{ score: string; createdAt: Date }[]>(Prisma.sql`SELECT score::text, created_at as "createdAt" FROM ratings WHERE provider_id = ${providerId}::uuid ORDER BY created_at DESC, id DESC LIMIT 3`);
    if (last.length < 3 || last.some(row => Number(row.score) >= 3)) return;
    const oldest = last[2]!.createdAt;
    const existing = await tx.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*)::bigint as n FROM penalties WHERE provider_id = ${providerId}::uuid AND breach_code = 'POOR_STREAK' AND status <> 'WITHDRAWN' AND created_at >= ${oldest.toISOString()}::timestamptz`);
    if ((existing[0]?.n ?? 0n) > 0n) return;
    await this.conduct.autoPropose(tx, { providerId, breachCode: 'POOR_STREAK', evidence: { scores: last.map(row => Number(row.score)) } });
  }

  /**
   * CL-18 / FR-AD-11: a provider is flagged for review when the rolling average of their last 10 rated jobs falls to `rating.poor_threshold`
   * (with at least 5 ratings, so one bad job is not a pattern), and the flag clears itself when the average recovers. Blocking stays a human decision.
   */
  async refreshLowRatingFlag(tx: Prisma.TransactionClient, providerId: string, ratingCount?: number): Promise<void> {
    const poor = await this.settings.getNumber('rating.poor_threshold');
    const recent = await tx.$queryRaw<{ avg: string | null; n: bigint }[]>(
      Prisma.sql`SELECT round(avg(score), 2)::text as avg, count(*)::bigint as n FROM (SELECT score FROM ratings WHERE provider_id = ${providerId}::uuid ORDER BY created_at DESC, id DESC LIMIT 10) last`
    );
    const mean = recent[0]?.avg == null ? null : Number(recent[0].avg);
    const count = ratingCount ?? Number(recent[0]?.n ?? 0n);
    const open = await tx.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*)::bigint as n FROM provider_flags WHERE provider_id = ${providerId}::uuid AND kind = 'LOW_RATING' AND cleared_at IS NULL`);
    const flagged = (open[0]?.n ?? 0n) > 0n;
    if (mean !== null && count >= 5 && mean <= poor) {
      if (!flagged) {
        await tx.$executeRaw(Prisma.sql`INSERT INTO provider_flags(provider_id, kind, detail) VALUES (${providerId}::uuid, 'LOW_RATING'::flag_kind, ${JSON.stringify({ rollingAverage: mean, window: 10 })}::jsonb)`);
        await appendOutboxEvent(tx, { aggregate: 'provider', aggregateId: providerId, type: 'provider.review_required', payload: { providerId, reason: 'LOW_RATING', average: mean } });
      }
    } else if (flagged && mean !== null && mean > poor) {
      await tx.$executeRaw(Prisma.sql`UPDATE provider_flags SET cleared_at = now() WHERE provider_id = ${providerId}::uuid AND kind = 'LOW_RATING' AND cleared_at IS NULL`);
    }
  }

  /** What anyone may read about a provider: published remarks, newest first, under "First L." only — never the customer's full identity (FR-RT-06). */
  async publicRemarks(providerId: string, limit: number) {
    const rows = await this.prisma.$queryRaw<{ id: string; displayName: string; body: string; score: string; createdAt: Date; replyBody: string | null; repliedAt: Date | null }[]>(
      Prisma.sql`SELECT m.id, m.display_name as "displayName", m.body, r.score::text as score, m.created_at as "createdAt", rr.body as "replyBody", rr.created_at as "repliedAt"
        FROM remarks m JOIN ratings r ON r.id = m.rating_id LEFT JOIN remark_replies rr ON rr.remark_id = m.id
        WHERE m.provider_id = ${providerId}::uuid AND m.is_published ORDER BY m.created_at DESC LIMIT ${limit}`
    );
    return rows.map(row => ({ id: row.id, displayName: row.displayName, body: row.body, score: Number(row.score), createdAt: row.createdAt, reply: row.replyBody === null ? null : { body: row.replyBody, createdAt: row.repliedAt } }));
  }

  /** FR-SP-04 / FR-SP-05: a provider sees every rating they have received, and every remark including ones an admin has since unpublished. */
  async ownRatings(providerId: string) {
    const rows = await this.prisma.$queryRaw<{ ratingId: string; score: string; quality: number; punctuality: number; conduct: number; cleanliness: number; createdAt: Date; remarkId: string | null; body: string | null; displayName: string | null; published: boolean | null; replyBody: string | null }[]>(
      Prisma.sql`SELECT r.id as "ratingId", r.score::text as score, r.quality, r.punctuality, r.conduct, r.cleanliness, r.created_at as "createdAt", m.id as "remarkId", m.body, m.display_name as "displayName", m.is_published as published, rr.body as "replyBody"
        FROM ratings r LEFT JOIN remarks m ON m.rating_id = r.id LEFT JOIN remark_replies rr ON rr.remark_id = m.id WHERE r.provider_id = ${providerId}::uuid ORDER BY r.created_at DESC LIMIT 200`
    );
    return {
      reputation: await this.reputation(this.prisma, providerId),
      items: rows.map(row => ({ ratingId: row.ratingId, score: Number(row.score), quality: row.quality, punctuality: row.punctuality, conduct: row.conduct, cleanliness: row.cleanliness, createdAt: row.createdAt, remark: row.remarkId === null ? null : { id: row.remarkId, body: row.body, displayName: row.displayName, published: row.published, reply: row.replyBody } }))
    };
  }

  /** FR-SP-12: one reply per published remark, never editable. The database allows only one and refuses any change. */
  async reply(providerId: string, remarkId: string, body: string) {
    return this.prisma.$transaction(async tx => {
      const remarks = await tx.$queryRaw<{ providerId: string; published: boolean }[]>(Prisma.sql`SELECT provider_id as "providerId", is_published as published FROM remarks WHERE id = ${remarkId}::uuid FOR UPDATE`);
      const remark = remarks[0];
      if (remark === undefined || remark.providerId !== providerId) throw notFound('Remark');
      if (!remark.published) throw new DomainError('CONFLICT', 'That remark is no longer published, so it cannot be replied to');
      const existing = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM remark_replies WHERE remark_id = ${remarkId}::uuid`);
      if (existing[0] !== undefined) throw new DomainError('CONFLICT', 'You have already replied to this remark; a reply cannot be edited');
      const rows = await tx.$queryRaw<{ id: string; createdAt: Date }[]>(Prisma.sql`INSERT INTO remark_replies(remark_id, provider_id, body) VALUES (${remarkId}::uuid, ${providerId}::uuid, ${body}) RETURNING id, created_at as "createdAt"`);
      return { id: rows[0]?.id, remarkId, body, createdAt: rows[0]?.createdAt };
    });
  }

  /** FR-RT-07 / FR-AD-06 / FR-AD-07: what admin sees of a provider's reputation, including unpublished remarks and who unpublished them. */
  async adminView(providerId: string) {
    const providers = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT user_id as id FROM providers WHERE user_id = ${providerId}::uuid`);
    if (providers[0] === undefined) throw notFound('Provider');
    const rows = await this.prisma.$queryRaw<{ ratingId: string; bookingCode: string; score: string; createdAt: Date; remarkId: string | null; body: string | null; displayName: string | null; published: boolean | null; unpublishedReason: string | null }[]>(
      Prisma.sql`SELECT r.id as "ratingId", b.code as "bookingCode", r.score::text as score, r.created_at as "createdAt", m.id as "remarkId", m.body, m.display_name as "displayName", m.is_published as published, m.unpublished_reason as "unpublishedReason"
        FROM ratings r JOIN bookings b ON b.id = r.booking_id LEFT JOIN remarks m ON m.rating_id = r.id WHERE r.provider_id = ${providerId}::uuid ORDER BY r.created_at DESC LIMIT 200`
    );
    return { reputation: await this.reputation(this.prisma, providerId), items: rows.map(row => ({ ...row, score: Number(row.score) })) };
  }

  /** An abusive remark is hidden from the public, but the rating stays in the score — removing the words must not move the number — and the removal is audited. */
  async unpublish(adminUserId: string, remarkId: string, reason: string) {
    return this.prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<{ providerId: string; published: boolean }[]>(Prisma.sql`SELECT provider_id as "providerId", is_published as published FROM remarks WHERE id = ${remarkId}::uuid FOR UPDATE`);
      const remark = rows[0];
      if (remark === undefined) throw notFound('Remark');
      if (!remark.published) throw new DomainError('CONFLICT', 'That remark is already unpublished');
      await tx.$executeRaw(Prisma.sql`UPDATE remarks SET is_published = false, unpublished_by = ${adminUserId}::uuid, unpublished_reason = ${reason}, unpublished_at = now() WHERE id = ${remarkId}::uuid`);
      await this.audit.append({ actorUserId: adminUserId, actorRole: 'ADMIN', action: 'remark.unpublish', entityType: 'remark', entityId: remarkId, after: { reason } }, tx);
      return { id: remarkId, published: false };
    });
  }
}
