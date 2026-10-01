// apps/api/src/conduct/conduct.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { consequenceOf, crossedThresholds, fineFor, paisaToNumber, suspensionDays, type Consequence, type Fine } from '@smart-home/domain';
import { DomainError, badRequest, notFound } from '../common/domain-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { DebtService } from '../payment/debt.service.js';
import { LedgerService } from '../payment/ledger.service.js';
import { AppClock } from '../platform/app-clock.js';
import { AuditService, appendOutboxEvent } from '../platform/audit.service.js';
import { SettingsService } from '../platform/settings.service.js';

export type ProposeInput = {
  providerId: string;
  breachCode: string;
  proposedBy: string;
  bookingId?: string | undefined;
  complaintId?: string | undefined;
  disputeId?: string | undefined;
  evidence?: Record<string, unknown> | undefined;
  /** The amount an excess-based fine is a multiple of: the overcharge, the rework cost. */
  excessPaisa?: bigint | undefined;
};

export type ApplyOutcome = { penaltyId: string; status: 'APPLIED'; pointsBefore: number; pointsAfter: number; consequence: Consequence; finePaisa: number };

const SYSTEM_EMAIL = 'system@smart-home.local';

/**
 * SRS §8 / M15: how a breach becomes a consequence. A penalty is only ever *proposed* by a person or the system; the provider is shown the
 * evidence and has 48 hours to reply (FR-PN-06 — the database itself refuses an application before the reply or the deadline); an admin then applies
 * it, in one transaction: the fine leaves the provider's wallet (a shortfall becomes commission debt), the demerit points are awarded, any
 * threshold the total has just crossed upward fires once (CL-16), and the harsher of the breach's own consequence and the threshold's applies (CL-14).
 */
@Injectable()
export class ConductService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(AppClock) private readonly clock: AppClock,
    @Inject(LedgerService) private readonly ledger: LedgerService,
    @Inject(DebtService) private readonly debt: DebtService,
    @Inject(AuditService) private readonly audit: AuditService
  ) {}

  /** The user the platform itself acts as when it proposes a penalty. Created on first use so a fresh database needs no seed for it. */
  async systemUserId(tx: Prisma.TransactionClient | PrismaService): Promise<string> {
    const found = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM users WHERE email = ${SYSTEM_EMAIL}::citext`);
    if (found[0] !== undefined) return found[0].id;
    const created = await tx.$queryRaw<{ id: string }[]>(
      Prisma.sql`INSERT INTO users(email, password_hash, first_name, last_name, status) VALUES (${SYSTEM_EMAIL}::citext, '!', 'System', 'Automation', 'LOCKED'::user_status)
        ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id`
    );
    return created[0]?.id ?? '';
  }

  async activePoints(client: Prisma.TransactionClient | PrismaService, providerId: string): Promise<number> {
    const rows = await client.$queryRaw<{ points: bigint }[]>(
      Prisma.sql`SELECT coalesce(sum(points_remaining), 0)::bigint as points FROM demerit_awards WHERE provider_id = ${providerId}::uuid AND voided_at IS NULL AND points_remaining > 0 AND expires_at > ${this.clock.now().toISOString()}::timestamptz`
    );
    return Number(rows[0]?.points ?? 0n);
  }

  // ------------------------------------------------------------------ propose

  /** Creates a PROPOSED penalty, or returns the one already proposed for the same breach on the same booking (an automatic trigger may fire twice). */
  async propose(tx: Prisma.TransactionClient, input: ProposeInput): Promise<{ id: string; created: boolean }> {
    const breaches = await tx.$queryRaw<{ code: string; fineRule: Fine }[]>(Prisma.sql`SELECT code, fine_rule as "fineRule" FROM breach_types WHERE code = ${input.breachCode} AND is_active`);
    const breach = breaches[0];
    if (breach === undefined) throw notFound('Breach type');
    const providers = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT user_id as id FROM providers WHERE user_id = ${input.providerId}::uuid`);
    if (providers[0] === undefined) throw notFound('Provider');

    if (input.bookingId !== undefined) {
      const existing = await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT id FROM penalties WHERE provider_id = ${input.providerId}::uuid AND breach_code = ${input.breachCode} AND booking_id = ${input.bookingId}::uuid AND status IN ('PROPOSED','APPLIED','APPEALED','UPHELD') LIMIT 1`
      );
      if (existing[0] !== undefined) return { id: existing[0].id, created: false };
    }

    let jobValue = 0n;
    if (input.bookingId !== undefined) {
      const bookings = await tx.$queryRaw<{ value: bigint }[]>(Prisma.sql`SELECT coalesce(final_amount_paisa, approved_total_paisa)::bigint as value FROM bookings WHERE id = ${input.bookingId}::uuid`);
      jobValue = bookings[0]?.value ?? 0n;
    }
    const fine = fineFor(breach.fineRule, { excessPaisa: input.excessPaisa ?? 0n, maxFinePaisa: BigInt(await this.settings.getNumber('penalty.max_fine_paisa')), jobValuePaisa: jobValue });
    const replyHours = await this.settings.getNumber('penalty.reply_hours');
    const dueAt = new Date(this.clock.now().getTime() + replyHours * 3_600_000);
    const rows = await tx.$queryRaw<{ id: string }[]>(
      Prisma.sql`INSERT INTO penalties(provider_id, breach_code, booking_id, complaint_id, dispute_id, evidence, fine_paisa, reply_due_at, proposed_by, created_at)
        VALUES (${input.providerId}::uuid, ${input.breachCode}, ${input.bookingId ?? null}::uuid, ${input.complaintId ?? null}::uuid, ${input.disputeId ?? null}::uuid,
          ${JSON.stringify(input.evidence ?? {})}::jsonb, ${fine}, ${dueAt.toISOString()}::timestamptz, ${input.proposedBy}::uuid, ${this.clock.now().toISOString()}::timestamptz) RETURNING id`
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new Error('Penalty insert did not return a row');
    await appendOutboxEvent(tx, { aggregate: 'penalty', aggregateId: id, type: 'penalty.proposed', payload: { penaltyId: id, providerId: input.providerId, breachCode: input.breachCode, replyDueAt: dueAt.toISOString() } });
    return { id, created: true };
  }

  /**
   * SRS §8.2 / SHM-080: the platform noticing a breach on its own — a provider no-show, a late cancellation, a verified rework, a poor-rating streak,
   * an overcharge confirmed on the verification call. It only ever *proposes*: the provider gets the same evidence and 48 hours to reply, and a person
   * decides. Safe to call from the moment the breach is recorded, more than once — the same breach on the same booking proposes a single penalty.
   */
  async autoPropose(tx: Prisma.TransactionClient, input: Omit<ProposeInput, 'proposedBy'>): Promise<{ id: string; created: boolean }> {
    return this.propose(tx, { ...input, proposedBy: await this.systemUserId(tx), evidence: { automatic: true, ...(input.evidence ?? {}) } });
  }

  async proposeByAdmin(adminId: string, input: Omit<ProposeInput, 'proposedBy'>) {
    return this.prisma.$transaction(async tx => {
      const result = await this.propose(tx, { ...input, proposedBy: adminId });
      await this.audit.append({ actorUserId: adminId, actorRole: 'ADMIN', action: 'penalty.propose', entityType: 'penalty', entityId: result.id, after: { breachCode: input.breachCode, providerId: input.providerId } }, tx);
      return this.present(tx, result.id);
    });
  }

  // ------------------------------------------------------------------ reply / withdraw

  /** FR-PN-06: the provider's right of reply. Allowed any time before the penalty is applied. */
  async reply(providerId: string, penaltyId: string, text: string) {
    return this.prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<{ providerId: string; status: string; repliedAt: Date | null }[]>(Prisma.sql`SELECT provider_id as "providerId", status::text, replied_at as "repliedAt" FROM penalties WHERE id = ${penaltyId}::uuid FOR UPDATE`);
      const penalty = rows[0];
      if (penalty === undefined || penalty.providerId !== providerId) throw notFound('Penalty');
      if (penalty.status !== 'PROPOSED') throw new DomainError('CONFLICT', `This penalty is already ${penalty.status.toLowerCase()}, so a reply can no longer change it — appeal it instead`);
      if (penalty.repliedAt !== null) throw new DomainError('CONFLICT', 'You have already replied to this penalty');
      await tx.$executeRaw(Prisma.sql`UPDATE penalties SET provider_reply = ${text}, replied_at = ${this.clock.now().toISOString()}::timestamptz WHERE id = ${penaltyId}::uuid`);
      await appendOutboxEvent(tx, { aggregate: 'penalty', aggregateId: penaltyId, type: 'penalty.replied', payload: { penaltyId, providerId } });
      return this.present(tx, penaltyId);
    });
  }

  async withdraw(adminId: string, penaltyId: string, reason: string) {
    return this.prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<{ status: string }[]>(Prisma.sql`SELECT status::text FROM penalties WHERE id = ${penaltyId}::uuid FOR UPDATE`);
      if (rows[0] === undefined) throw notFound('Penalty');
      if (rows[0].status !== 'PROPOSED') throw new DomainError('CONFLICT', `Only a proposed penalty can be withdrawn (this one is ${rows[0].status.toLowerCase()})`);
      await tx.$executeRaw(Prisma.sql`UPDATE penalties SET status = 'WITHDRAWN'::penalty_status WHERE id = ${penaltyId}::uuid`);
      await this.audit.append({ actorUserId: adminId, actorRole: 'ADMIN', action: 'penalty.withdraw', entityType: 'penalty', entityId: penaltyId, after: { reason } }, tx);
      return this.present(tx, penaltyId);
    });
  }

  // ------------------------------------------------------------------ apply

  async apply(adminId: string, penaltyId: string): Promise<ApplyOutcome> {
    return this.prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<{ providerId: string; status: string; repliedAt: Date | null; replyDueAt: Date; breachCode: string; fine: bigint }[]>(
        Prisma.sql`SELECT provider_id as "providerId", status::text, replied_at as "repliedAt", reply_due_at as "replyDueAt", breach_code as "breachCode", fine_paisa as fine FROM penalties WHERE id = ${penaltyId}::uuid FOR UPDATE`
      );
      const penalty = rows[0];
      if (penalty === undefined) throw notFound('Penalty');
      if (penalty.status !== 'PROPOSED') throw new DomainError('CONFLICT', `This penalty is already ${penalty.status.toLowerCase()}`);
      const now = this.clock.now();
      // FR-PN-06, twice over: refused here with an explanation, and by a CHECK constraint in the database if anything ever bypassed this.
      if (penalty.repliedAt === null && now.getTime() < penalty.replyDueAt.getTime()) {
        throw new DomainError('CONFLICT', `The provider has until ${penalty.replyDueAt.toISOString()} to reply; a penalty cannot be applied before they reply or that time passes`);
      }

      // Serialised per provider so the "before" and "after" totals are the totals, however many penalties are applied at once.
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`conduct:${penalty.providerId}`}))`);
      const breaches = await tx.$queryRaw<{ category: string; points: number; schedule: string | null }[]>(Prisma.sql`SELECT category::text, points, schedule_consequence as schedule FROM breach_types WHERE code = ${penalty.breachCode}`);
      const breach = breaches[0];
      if (breach === undefined) throw notFound('Breach type');

      const before = await this.activePoints(tx, penalty.providerId);
      const expiryDays = await this.settings.getNumber('demerit.expiry_days');
      await tx.$executeRaw(
        Prisma.sql`INSERT INTO demerit_awards(provider_id, penalty_id, points_awarded, points_remaining, awarded_at, expires_at)
          VALUES (${penalty.providerId}::uuid, ${penaltyId}::uuid, ${breach.points}, ${breach.points}, ${now.toISOString()}::timestamptz, ${new Date(now.getTime() + expiryDays * 86_400_000).toISOString()}::timestamptz)`
      );
      const after = before + breach.points;

      let ledgerTransactionId: string | null = null;
      if (penalty.fine > 0n) {
        ledgerTransactionId = await this.ledger.post(tx, {
          type: 'PENALTY', idempotencyKey: `penalty:${penaltyId}`, memo: `Penalty ${penalty.breachCode}`, createdBy: adminId,
          lines: [
            { account: 'PROVIDER_WALLET', direction: 'DEBIT', amountPaisa: penalty.fine, ownerUserId: penalty.providerId },
            { account: 'PENALTY_INCOME', direction: 'CREDIT', amountPaisa: penalty.fine }
          ]
        });
      }
      await this.debt.refreshBlock(tx, penalty.providerId);

      const crossed = crossedThresholds(before, after);
      for (const threshold of crossed) {
        await tx.$executeRaw(
          Prisma.sql`INSERT INTO threshold_events(provider_id, threshold, consequence, active_points, triggered_by_penalty_id, created_at)
            VALUES (${penalty.providerId}::uuid, ${threshold.points}, ${threshold.consequence}, ${after}, ${penaltyId}::uuid, ${now.toISOString()}::timestamptz)`
        );
      }
      const consequence = consequenceOf({ category: breach.category, points: breach.points, schedule: breach.schedule, crossed });
      await this.enforce(tx, penalty.providerId, consequence, penaltyId, after);

      await tx.$executeRaw(
        Prisma.sql`UPDATE penalties SET status = 'APPLIED'::penalty_status, applied_by = ${adminId}::uuid, applied_at = ${now.toISOString()}::timestamptz, ledger_transaction_id = ${ledgerTransactionId}::uuid WHERE id = ${penaltyId}::uuid`
      );
      await this.audit.append({ actorUserId: adminId, actorRole: 'ADMIN', action: 'penalty.apply', entityType: 'penalty', entityId: penaltyId, after: { pointsBefore: before, pointsAfter: after, consequence, finePaisa: penalty.fine.toString() } }, tx);
      await appendOutboxEvent(tx, { aggregate: 'penalty', aggregateId: penaltyId, type: 'penalty.applied', payload: { penaltyId, providerId: penalty.providerId, consequence, pointsAfter: after } });
      return { penaltyId, status: 'APPLIED' as const, pointsBefore: before, pointsAfter: after, consequence, finePaisa: paisaToNumber(penalty.fine) };
    });
  }

  /**
   * Puts a consequence into effect. Suspensions and blocks change the provider's status (so they vanish from search and offers) and are recorded with
   * an end date; a longer suspension already running is never shortened, and a block is never downgraded — the harsher of old and new stands.
   */
  private async enforce(tx: Prisma.TransactionClient, providerId: string, consequence: Consequence, penaltyId: string, points: number): Promise<void> {
    if (consequence === 'NONE') return;
    const now = this.clock.now();
    if (consequence === 'REVIEW' || consequence === 'WARNING') {
      await appendOutboxEvent(tx, { aggregate: 'provider', aggregateId: providerId, type: consequence === 'WARNING' ? 'provider.warned' : 'provider.review_required', payload: { providerId, penaltyId, reason: 'CONDUCT', points } });
      return;
    }
    if (consequence === 'DEMOTION_30D') {
      await this.recordEffect(tx, providerId, penaltyId, consequence, points, new Date(now.getTime() + 30 * 86_400_000));
      return;
    }
    const current = await tx.$queryRaw<{ status: string }[]>(Prisma.sql`SELECT status::text FROM providers WHERE user_id = ${providerId}::uuid FOR UPDATE`);
    if (current[0]?.status === 'BLOCKED') return;
    if (consequence === 'PERMANENT_BLOCK') {
      await tx.$executeRaw(Prisma.sql`UPDATE providers SET status = 'BLOCKED'::provider_status, offer_blocked_reason = 'SUSPENDED' WHERE user_id = ${providerId}::uuid`);
      await this.recordEffect(tx, providerId, penaltyId, consequence, points, null);
      await appendOutboxEvent(tx, { aggregate: 'provider', aggregateId: providerId, type: 'provider.blocked', payload: { providerId, penaltyId } });
      return;
    }
    const days = suspensionDays(consequence) ?? 7;
    let until = new Date(now.getTime() + days * 86_400_000);
    const running = await tx.$queryRaw<{ until: Date | null }[]>(
      Prisma.sql`SELECT max(effective_until) as until FROM threshold_events WHERE provider_id = ${providerId}::uuid AND consequence LIKE 'SUSPENSION%' AND effective_until > ${now.toISOString()}::timestamptz`
    );
    if (running[0]?.until != null && running[0].until.getTime() > until.getTime()) until = running[0].until;
    await tx.$executeRaw(Prisma.sql`UPDATE providers SET status = 'SUSPENDED'::provider_status, offer_blocked_reason = 'SUSPENDED' WHERE user_id = ${providerId}::uuid`);
    await this.recordEffect(tx, providerId, penaltyId, consequence, points, until);
    await appendOutboxEvent(tx, { aggregate: 'provider', aggregateId: providerId, type: 'provider.suspended', payload: { providerId, penaltyId, until: until.toISOString(), consequence } });
  }

  private async recordEffect(tx: Prisma.TransactionClient, providerId: string, penaltyId: string, consequence: Consequence, points: number, until: Date | null): Promise<void> {
    // threshold 0 marks a consequence that came from the breach's own schedule (or the merge), not from a points threshold.
    await tx.$executeRaw(
      Prisma.sql`INSERT INTO threshold_events(provider_id, threshold, consequence, active_points, triggered_by_penalty_id, effective_until, created_at)
        VALUES (${providerId}::uuid, 0, ${consequence}, ${points}, ${penaltyId}::uuid, ${until === null ? null : until.toISOString()}::timestamptz, ${this.clock.now().toISOString()}::timestamptz)`
    );
  }

  /** Applied directly by an admin decision on a complaint (FR-CP-06): a suspension or block outside the points ladder, still recorded and audited. */
  async restrict(tx: Prisma.TransactionClient, adminId: string, providerId: string, kind: 'SUSPENSION' | 'BLOCK', days: number | null, reason: string): Promise<void> {
    const providers = await tx.$queryRaw<{ status: string }[]>(Prisma.sql`SELECT status::text FROM providers WHERE user_id = ${providerId}::uuid FOR UPDATE`);
    if (providers[0] === undefined) throw notFound('Provider');
    const consequence: Consequence = kind === 'BLOCK' ? 'PERMANENT_BLOCK' : (days ?? 7) >= 30 ? 'SUSPENSION_30D' : (days ?? 7) >= 14 ? 'SUSPENSION_14D' : 'SUSPENSION_7D';
    const points = await this.activePoints(tx, providerId);
    const now = this.clock.now();
    if (kind === 'BLOCK') {
      await tx.$executeRaw(Prisma.sql`UPDATE providers SET status = 'BLOCKED'::provider_status, offer_blocked_reason = 'SUSPENDED' WHERE user_id = ${providerId}::uuid`);
      await tx.$executeRaw(Prisma.sql`INSERT INTO threshold_events(provider_id, threshold, consequence, active_points, created_at) VALUES (${providerId}::uuid, 0, ${consequence}, ${points}, ${now.toISOString()}::timestamptz)`);
    } else {
      if (providers[0].status === 'BLOCKED') return;
      const until = new Date(now.getTime() + (days ?? 7) * 86_400_000);
      await tx.$executeRaw(Prisma.sql`UPDATE providers SET status = 'SUSPENDED'::provider_status, offer_blocked_reason = 'SUSPENDED' WHERE user_id = ${providerId}::uuid`);
      await tx.$executeRaw(Prisma.sql`INSERT INTO threshold_events(provider_id, threshold, consequence, active_points, effective_until, created_at) VALUES (${providerId}::uuid, 0, ${consequence}, ${points}, ${until.toISOString()}::timestamptz, ${now.toISOString()}::timestamptz)`);
    }
    await this.audit.append({ actorUserId: adminId, actorRole: 'ADMIN', action: kind === 'BLOCK' ? 'provider.block' : 'provider.suspend', entityType: 'provider', entityId: providerId, after: { reason, days } }, tx);
    await appendOutboxEvent(tx, { aggregate: 'provider', aggregateId: providerId, type: kind === 'BLOCK' ? 'provider.blocked' : 'provider.suspended', payload: { providerId, reason } });
  }

  // ------------------------------------------------------------------ appeals

  async appeal(providerId: string, penaltyId: string, grounds: string) {
    return this.prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<{ providerId: string; status: string }[]>(Prisma.sql`SELECT provider_id as "providerId", status::text FROM penalties WHERE id = ${penaltyId}::uuid FOR UPDATE`);
      const penalty = rows[0];
      if (penalty === undefined || penalty.providerId !== providerId) throw notFound('Penalty');
      if (penalty.status !== 'APPLIED') throw new DomainError('CONFLICT', penalty.status === 'PROPOSED' ? 'A penalty that has not been applied yet is answered with a reply, not an appeal' : `This penalty is ${penalty.status.toLowerCase()} and cannot be appealed`);
      const created = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`INSERT INTO appeals(penalty_id, provider_id, grounds) VALUES (${penaltyId}::uuid, ${providerId}::uuid, ${grounds}) RETURNING id`);
      await tx.$executeRaw(Prisma.sql`UPDATE penalties SET status = 'APPEALED'::penalty_status WHERE id = ${penaltyId}::uuid`);
      await this.audit.append({ actorUserId: providerId, actorRole: 'PROVIDER', action: 'penalty.appeal', entityType: 'penalty', entityId: penaltyId, after: { appealId: created[0]?.id ?? null, grounds } }, tx);
      await appendOutboxEvent(tx, { aggregate: 'penalty', aggregateId: penaltyId, type: 'penalty.appealed', payload: { penaltyId, providerId } });
      return { id: created[0]?.id, penaltyId, status: 'OPEN' };
    });
  }

  /**
   * FR-PN-07: an admin's decision on an appeal, audited. UPHELD leaves everything as it was. REVERSED undoes the penalty *exactly*: the demerit award
   * is voided (the points come back off the provider's total to the point), the fine is posted back into the wallet against the original transaction, the
   * debt block is re-evaluated, and any suspension or block this penalty caused is lifted. PARTIAL gives back part of the fine and keeps the points.
   */
  async decideAppeal(adminId: string, appealId: string, input: { decision: 'UPHELD' | 'REVERSED' | 'PARTIAL'; note: string; refundFinePaisa?: number | undefined }) {
    return this.prisma.$transaction(async tx => {
      const appeals = await tx.$queryRaw<{ penaltyId: string; providerId: string; status: string }[]>(Prisma.sql`SELECT penalty_id as "penaltyId", provider_id as "providerId", status::text FROM appeals WHERE id = ${appealId}::uuid FOR UPDATE`);
      const appeal = appeals[0];
      if (appeal === undefined) throw notFound('Appeal');
      if (appeal.status !== 'OPEN') throw new DomainError('CONFLICT', `This appeal has already been decided (${appeal.status.toLowerCase()})`);
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`conduct:${appeal.providerId}`}))`);
      const penalties = await tx.$queryRaw<{ fine: bigint; ledgerTransactionId: string | null }[]>(Prisma.sql`SELECT fine_paisa as fine, ledger_transaction_id as "ledgerTransactionId" FROM penalties WHERE id = ${appeal.penaltyId}::uuid FOR UPDATE`);
      const penalty = penalties[0];
      if (penalty === undefined) throw notFound('Penalty');
      const now = this.clock.now();

      if (input.decision === 'REVERSED') {
        await tx.$executeRaw(Prisma.sql`UPDATE demerit_awards SET voided_at = ${now.toISOString()}::timestamptz WHERE penalty_id = ${appeal.penaltyId}::uuid`);
        if (penalty.fine > 0n) {
          await this.ledger.post(tx, {
            type: 'REVERSAL', idempotencyKey: `penalty-reversal:${appeal.penaltyId}`, memo: 'Penalty reversed on appeal', createdBy: adminId, reversesTransactionId: penalty.ledgerTransactionId,
            lines: [
              { account: 'PENALTY_INCOME', direction: 'DEBIT', amountPaisa: penalty.fine },
              { account: 'PROVIDER_WALLET', direction: 'CREDIT', amountPaisa: penalty.fine, ownerUserId: appeal.providerId }
            ]
          });
        }
        await this.debt.refreshBlock(tx, appeal.providerId);
        await this.liftEffectsOf(tx, appeal.providerId, appeal.penaltyId);
        await tx.$executeRaw(Prisma.sql`UPDATE penalties SET status = 'REVERSED'::penalty_status WHERE id = ${appeal.penaltyId}::uuid`);
        await tx.$executeRaw(Prisma.sql`UPDATE appeals SET status = 'REVERSED'::appeal_status, decided_by = ${adminId}::uuid, decision_note = ${input.note}, decided_at = ${now.toISOString()}::timestamptz WHERE id = ${appealId}::uuid`);
      } else if (input.decision === 'PARTIAL') {
        const refund = BigInt(input.refundFinePaisa ?? 0);
        if (refund <= 0n || refund > penalty.fine) throw badRequest('A partial reversal needs a fine refund between 1 paisa and the fine');
        await this.ledger.post(tx, {
          type: 'REVERSAL', idempotencyKey: `penalty-partial:${appealId}`, memo: 'Penalty partly reversed on appeal', createdBy: adminId,
          lines: [
            { account: 'PENALTY_INCOME', direction: 'DEBIT', amountPaisa: refund },
            { account: 'PROVIDER_WALLET', direction: 'CREDIT', amountPaisa: refund, ownerUserId: appeal.providerId }
          ]
        });
        await this.debt.refreshBlock(tx, appeal.providerId);
        await tx.$executeRaw(Prisma.sql`UPDATE penalties SET status = 'UPHELD'::penalty_status WHERE id = ${appeal.penaltyId}::uuid`);
        await tx.$executeRaw(Prisma.sql`UPDATE appeals SET status = 'PARTIAL'::appeal_status, decided_by = ${adminId}::uuid, decision_note = ${input.note}, decided_at = ${now.toISOString()}::timestamptz WHERE id = ${appealId}::uuid`);
      } else {
        await tx.$executeRaw(Prisma.sql`UPDATE penalties SET status = 'UPHELD'::penalty_status WHERE id = ${appeal.penaltyId}::uuid`);
        await tx.$executeRaw(Prisma.sql`UPDATE appeals SET status = 'UPHELD'::appeal_status, decided_by = ${adminId}::uuid, decision_note = ${input.note}, decided_at = ${now.toISOString()}::timestamptz WHERE id = ${appealId}::uuid`);
      }
      await this.audit.append({ actorUserId: adminId, actorRole: 'ADMIN', action: 'appeal.decide', entityType: 'appeal', entityId: appealId, after: { decision: input.decision, note: input.note, penaltyId: appeal.penaltyId } }, tx);
      await appendOutboxEvent(tx, { aggregate: 'penalty', aggregateId: appeal.penaltyId, type: 'appeal.decided', payload: { appealId, penaltyId: appeal.penaltyId, providerId: appeal.providerId, decision: input.decision } });
      return { id: appealId, penaltyId: appeal.penaltyId, decision: input.decision };
    });
  }

  /** Ends the suspension or block a reversed penalty caused — unless another penalty's effect still holds the provider. */
  private async liftEffectsOf(tx: Prisma.TransactionClient, providerId: string, penaltyId: string): Promise<void> {
    const now = this.clock.now();
    await tx.$executeRaw(
      Prisma.sql`UPDATE threshold_events SET effective_until = ${now.toISOString()}::timestamptz WHERE triggered_by_penalty_id = ${penaltyId}::uuid AND (effective_until IS NULL OR effective_until > ${now.toISOString()}::timestamptz) AND (consequence LIKE 'SUSPENSION%' OR consequence = 'PERMANENT_BLOCK' OR consequence = 'DEMOTION_30D')`
    );
    await this.restoreIfClear(tx, providerId);
  }

  /** Puts a suspended (or blocked-by-penalty) provider back to APPROVED once nothing keeps them out. */
  async restoreIfClear(tx: Prisma.TransactionClient, providerId: string): Promise<boolean> {
    const now = this.clock.now();
    const holds = await tx.$queryRaw<{ n: bigint }[]>(
      Prisma.sql`SELECT count(*)::bigint as n FROM threshold_events WHERE provider_id = ${providerId}::uuid AND (consequence = 'PERMANENT_BLOCK' AND effective_until IS NULL OR consequence LIKE 'SUSPENSION%' AND effective_until > ${now.toISOString()}::timestamptz)`
    );
    if ((holds[0]?.n ?? 0n) > 0n) return false;
    const changed = await tx.$executeRaw(Prisma.sql`UPDATE providers SET status = 'APPROVED'::provider_status WHERE user_id = ${providerId}::uuid AND status IN ('SUSPENDED','BLOCKED')`);
    await tx.$executeRaw(Prisma.sql`UPDATE providers SET offer_blocked_reason = NULL WHERE user_id = ${providerId}::uuid AND offer_blocked_reason = 'SUSPENDED'`);
    await this.debt.refreshBlock(tx, providerId);
    return changed > 0;
  }

  // ------------------------------------------------------------------ views

  private async present(client: Prisma.TransactionClient | PrismaService, penaltyId: string) {
    const rows = await client.$queryRaw<
      { id: string; providerId: string; breachCode: string; breachName: string; category: string; points: number; status: string; bookingCode: string | null; fine: bigint; replyDueAt: Date; providerReply: string | null; repliedAt: Date | null; evidence: unknown; appliedAt: Date | null; createdAt: Date }[]
    >(
      Prisma.sql`SELECT p.id, p.provider_id as "providerId", p.breach_code as "breachCode", bt.name_en as "breachName", bt.category::text as category, bt.points, p.status::text, b.code as "bookingCode", p.fine_paisa as fine,
          p.reply_due_at as "replyDueAt", p.provider_reply as "providerReply", p.replied_at as "repliedAt", p.evidence, p.applied_at as "appliedAt", p.created_at as "createdAt"
        FROM penalties p JOIN breach_types bt ON bt.code = p.breach_code LEFT JOIN bookings b ON b.id = p.booking_id WHERE p.id = ${penaltyId}::uuid`
    );
    const row = rows[0];
    if (row === undefined) throw notFound('Penalty');
    const { fine, ...rest } = row;
    return { ...rest, finePaisa: paisaToNumber(fine) };
  }

  async listForProvider(providerId: string) {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM penalties WHERE provider_id = ${providerId}::uuid ORDER BY created_at DESC LIMIT 100`);
    return Promise.all(rows.map(row => this.present(this.prisma, row.id)));
  }

  async getForProvider(providerId: string, penaltyId: string) {
    const penalty = await this.present(this.prisma, penaltyId);
    if (penalty.providerId !== providerId) throw notFound('Penalty');
    return penalty;
  }

  async list(status: string | undefined, providerId: string | undefined) {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT id FROM penalties WHERE (${status ?? null}::text IS NULL OR status::text = ${status ?? null}) AND (${providerId ?? null}::uuid IS NULL OR provider_id = ${providerId ?? null}::uuid) ORDER BY created_at DESC LIMIT 200`
    );
    return Promise.all(rows.map(row => this.present(this.prisma, row.id)));
  }

  async get(penaltyId: string) {
    return this.present(this.prisma, penaltyId);
  }

  async listAppeals(status: string | undefined) {
    const rows = await this.prisma.$queryRaw<{ id: string; penaltyId: string; providerId: string; grounds: string; status: string; decisionNote: string | null; createdAt: Date; decidedAt: Date | null; breachCode: string; fine: bigint }[]>(
      Prisma.sql`SELECT a.id, a.penalty_id as "penaltyId", a.provider_id as "providerId", a.grounds, a.status::text, a.decision_note as "decisionNote", a.created_at as "createdAt", a.decided_at as "decidedAt", p.breach_code as "breachCode", p.fine_paisa as fine
        FROM appeals a JOIN penalties p ON p.id = a.penalty_id WHERE (${status ?? null}::text IS NULL OR a.status::text = ${status ?? null}) ORDER BY a.created_at DESC LIMIT 200`
    );
    return rows.map(({ fine, ...row }) => ({ ...row, finePaisa: paisaToNumber(fine) }));
  }

  /** FR-SP-14 / FR-PN-08: the provider's own conduct record — active points, each award with its expiry and how close it is to its next decay, the standing consequence, and the schedule. */
  async record(providerId: string) {
    const now = this.clock.now();
    const awards = await this.prisma.$queryRaw<{ id: string; breachCode: string; awarded: number; remaining: number; awardedAt: Date; expiresAt: Date; lastDecayAt: Date | null; voidedAt: Date | null }[]>(
      Prisma.sql`SELECT d.id, p.breach_code as "breachCode", d.points_awarded as awarded, d.points_remaining as remaining, d.awarded_at as "awardedAt", d.expires_at as "expiresAt", d.last_decay_at as "lastDecayAt", d.voided_at as "voidedAt"
        FROM demerit_awards d JOIN penalties p ON p.id = d.penalty_id WHERE d.provider_id = ${providerId}::uuid ORDER BY d.awarded_at DESC`
    );
    const active = awards.filter(award => award.voidedAt === null && award.remaining > 0 && award.expiresAt.getTime() > now.getTime());
    const lastBreach = awards.filter(award => award.voidedAt === null).reduce<Date | null>((latest, award) => (latest === null || award.awardedAt > latest ? award.awardedAt : latest), null);
    const lastDecay = awards.reduce<Date | null>((latest, award) => (award.lastDecayAt !== null && (latest === null || award.lastDecayAt > latest) ? award.lastDecayAt : latest), null);
    const cleanSince = [lastBreach, lastDecay].filter((value): value is Date => value !== null).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    const daysClean = cleanSince === null ? null : Math.floor((now.getTime() - cleanSince.getTime()) / 86_400_000);
    const standing = await this.prisma.$queryRaw<{ consequence: string; until: Date | null }[]>(
      Prisma.sql`SELECT consequence, effective_until as until FROM threshold_events WHERE provider_id = ${providerId}::uuid AND (consequence LIKE 'SUSPENSION%' OR consequence = 'DEMOTION_30D' OR consequence = 'PERMANENT_BLOCK') AND (effective_until IS NULL OR effective_until > ${now.toISOString()}::timestamptz) ORDER BY created_at DESC`
    );
    const schedule = await this.prisma.$queryRaw<{ code: string; nameEn: string; nameUr: string; category: string; points: number; consequence: string | null }[]>(
      Prisma.sql`SELECT code, name_en as "nameEn", name_ur as "nameUr", category::text, points, schedule_consequence as consequence FROM breach_types WHERE is_active ORDER BY category, points`
    );
    const status = await this.prisma.$queryRaw<{ status: string }[]>(Prisma.sql`SELECT status::text FROM providers WHERE user_id = ${providerId}::uuid`);
    return {
      providerStatus: status[0]?.status ?? null,
      activePoints: active.reduce((sum, award) => sum + award.remaining, 0),
      daysSinceLastBreachOrDecay: daysClean,
      awards: awards.map(award => ({
        id: award.id, breachCode: award.breachCode, pointsAwarded: award.awarded, pointsRemaining: award.remaining, awardedAt: award.awardedAt, expiresAt: award.expiresAt, voided: award.voidedAt !== null,
        active: award.voidedAt === null && award.remaining > 0 && award.expiresAt.getTime() > now.getTime()
      })),
      standingConsequences: standing.map(row => ({ consequence: row.consequence, until: row.until })),
      thresholds: [{ points: 10, consequence: 'WARNING' }, { points: 20, consequence: 'DEMOTION_30D' }, { points: 30, consequence: 'SUSPENSION_7D' }, { points: 45, consequence: 'SUSPENSION_30D_REVERIFY' }, { points: 60, consequence: 'PERMANENT_BLOCK' }],
      schedule
    };
  }
}

