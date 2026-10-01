// apps/api/src/complaints/complaints.service.ts
import { randomUUID } from 'node:crypto';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CUSTOMER_COMPLAINT_CATEGORIES, PROVIDER_COMPLAINT_CATEGORIES, canMoveComplaint, paisaToNumber, severityFor, type ComplaintCategory, type ComplaintStatus } from '@smart-home/domain';
import { DomainError, badRequest, notFound } from '../common/domain-error.js';
import { readReceiptToken } from '../common/receipt-link.js';
import { EnvironmentService } from '../config/environment.service.js';
import { ConductService } from '../conduct/conduct.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { OBJECT_STORAGE } from '../integrations/integrations.module.js';
import type { ObjectStoragePort } from '../integrations/ports.js';
import { PaymentsService } from '../payment/payments.service.js';
import { AppClock } from '../platform/app-clock.js';
import { AuditService, appendOutboxEvent } from '../platform/audit.service.js';
import { SettingsService } from '../platform/settings.service.js';
import { QueueRegistry } from '../queues/queue.registry.js';
import { BookingStateService } from '../booking/booking-state.service.js';
import { VerificationOutcomeService } from '../verification/verification-outcome.service.js';
import type { ComplaintCreateInput, ComplaintTransitionInput, PhotoInput } from './complaints.schemas.js';

const MAX_PHOTOS = 5;
const FINAL = new Set(['RESOLVED', 'REJECTED']);

type Party = { userId: string; role: 'CUSTOMER' | 'PROVIDER' };

/**
 * M10 / FR-CP-01..04, 07, 08: complaints. A customer can complain about a provider and a provider about a customer, always attached to a booking, with up to
 * five photos. Severity follows the category and sets the SLA; a safety complaint goes to the top of the admin queue and alerts the admins at once. Every
 * step is a row in an append-only timeline. Deciding one is an admin's job, and the decision can carry consequences (a warning, a refund, a proposed
 * penalty, a suspension or block) — carried out in the same transaction as the decision, so a complaint is never "resolved" with nothing having happened.
 */
@Injectable()
export class ComplaintsService implements OnModuleInit {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EnvironmentService) private readonly environment: EnvironmentService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(AppClock) private readonly clock: AppClock,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ConductService) private readonly conduct: ConductService,
    @Inject(PaymentsService) private readonly payments: PaymentsService,
    @Inject(QueueRegistry) private readonly queues: QueueRegistry,
    @Inject(VerificationOutcomeService) private readonly outcomes: VerificationOutcomeService,
    @Inject(BookingStateService) private readonly bookingState: BookingStateService
  ) {}

  onModuleInit(): void {
    this.queues.registerScheduled('complaint.sla-monitor', async () => void (await this.flagSlaBreaches()));
  }

  // ------------------------------------------------------------------ raising

  private async slaHours(severity: string): Promise<number> {
    const table = (await this.settings.get<Record<string, number>>('complaint.sla_hours')) ?? {};
    return table[severity] ?? 72;
  }

  private async raise(tx: Prisma.TransactionClient, input: { raiser: Party; bookingId: string; category: ComplaintCategory; description: string; source: string; photos: readonly PhotoInput[] | undefined }) {
    const bookings = await tx.$queryRaw<{ customerId: string; providerId: string | null; status: string; releasedAt: Date | null }[]>(
      Prisma.sql`SELECT customer_id as "customerId", provider_id as "providerId", status::text, released_at as "releasedAt" FROM bookings WHERE id = ${input.bookingId}::uuid`
    );
    const booking = bookings[0];
    if (booking === undefined || (booking.customerId !== input.raiser.userId && booking.providerId !== input.raiser.userId) || booking.providerId === null) throw notFound('Booking');
    const asProvider = booking.providerId === input.raiser.userId;
    const allowed = asProvider ? PROVIDER_COMPLAINT_CATEGORIES : CUSTOMER_COMPLAINT_CATEGORIES;
    if (!allowed.includes(input.category)) {
      throw new DomainError('VALIDATION_FAILED', `${input.category} is not a complaint a ${asProvider ? 'provider' : 'customer'} can make`, [{ path: 'category', code: 'invalid', message: `Choose one of: ${allowed.join(', ')}` }]);
    }
    if (booking.releasedAt !== null) {
      const days = await this.settings.getNumber('verification.post_release_complaint_days');
      if (this.clock.now().getTime() > booking.releasedAt.getTime() + days * 86_400_000) throw new DomainError('CONFLICT', `The ${days}-day window to complain about a completed job has closed`);
    }
    const severity = severityFor(input.category);
    const dueAt = new Date(this.clock.now().getTime() + (await this.slaHours(severity)) * 3_600_000);
    const againstId = asProvider ? booking.customerId : booking.providerId;
    // A complaint about a job whose money has already been released is a POST_RELEASE complaint (the seven-day window), unless it came in through the receipt link.
    const source = asProvider ? 'PROVIDER' : input.source === 'CUSTOMER' && booking.releasedAt !== null ? 'POST_RELEASE' : input.source;
    const rows = await tx.$queryRaw<{ id: string }[]>(
      Prisma.sql`INSERT INTO complaints(booking_id, raised_by_user_id, against_user_id, source, category, severity, description, sla_due_at)
        VALUES (${input.bookingId}::uuid, ${input.raiser.userId}::uuid, ${againstId}::uuid, ${source}::complaint_source, ${input.category}::complaint_category, ${severity}::complaint_severity, ${input.description}, ${dueAt.toISOString()}::timestamptz) RETURNING id`
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new Error('Complaint insert did not return a row');
    await this.event(tx, id, input.raiser.userId, 'CREATED', { to: 'OPEN', body: input.description });
    for (const photo of input.photos ?? []) await this.storePhoto(tx, id, input.raiser.userId, photo);
    await appendOutboxEvent(tx, { aggregate: 'complaint', aggregateId: id, type: 'complaint.created', payload: { complaintId: id, bookingId: input.bookingId, severity, category: input.category, raisedBy: input.raiser.userId, againstUserId: againstId } });
    // FR-CP-08 / FR-NT-04: a safety complaint alerts the admins straight away — its own event, delivered by the same one-second outbox poll.
    if (severity === 'SAFETY') await appendOutboxEvent(tx, { aggregate: 'complaint', aggregateId: id, type: 'complaint.safety_raised', payload: { complaintId: id, bookingId: input.bookingId } });
    return { id, severity, slaDueAt: dueAt };
  }

  async create(raiser: Party, input: ComplaintCreateInput) {
    const created = await this.prisma.$transaction(tx => this.raise(tx, { raiser, bookingId: input.bookingId, category: input.category, description: input.description, source: 'CUSTOMER', photos: input.photos }));
    return this.viewFor(raiser.userId, created.id);
  }

  /** The link on a cash receipt: the customer reports a problem without signing in. The token proves which booking (and so which customer) it is. */
  async createFromReceipt(token: string, input: { category: ComplaintCategory; description: string; photos: readonly PhotoInput[] | undefined }) {
    const bookingId = readReceiptToken(this.environment.values.OTP_PEPPER, token);
    if (bookingId === null) throw notFound('Receipt link');
    const customers = await this.prisma.$queryRaw<{ customerId: string }[]>(Prisma.sql`SELECT customer_id as "customerId" FROM bookings WHERE id = ${bookingId}::uuid`);
    const customerId = customers[0]?.customerId;
    if (customerId === undefined) throw notFound('Receipt link');
    const created = await this.prisma.$transaction(tx => this.raise(tx, { raiser: { userId: customerId, role: 'CUSTOMER' }, bookingId, category: input.category, description: input.description, source: 'RECEIPT_LINK', photos: input.photos }));
    return { id: created.id, severity: created.severity };
  }

  private async event(tx: Prisma.TransactionClient, complaintId: string, actorUserId: string | null, type: 'CREATED' | 'STATUS_CHANGED' | 'COMMENT' | 'EVIDENCE_ADDED' | 'PARTY_REPLY', extra: { from?: string; to?: string; body?: string; evidenceKey?: string }): Promise<void> {
    await tx.$executeRaw(
      Prisma.sql`INSERT INTO complaint_events(complaint_id, actor_user_id, type, from_status, to_status, body, evidence_key, created_at)
        VALUES (${complaintId}::uuid, ${actorUserId}::uuid, ${type}::complaint_event_type, ${extra.from ?? null}::complaint_status, ${extra.to ?? null}::complaint_status, ${extra.body ?? null}, ${extra.evidenceKey ?? null}, ${this.clock.now().toISOString()}::timestamptz)`
    );
  }

  private async storePhoto(tx: Prisma.TransactionClient, complaintId: string, actorUserId: string, photo: PhotoInput): Promise<string> {
    const existing = await tx.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*)::bigint as n FROM complaint_events WHERE complaint_id = ${complaintId}::uuid AND type = 'EVIDENCE_ADDED'`);
    if ((existing[0]?.n ?? 0n) >= BigInt(MAX_PHOTOS)) throw new DomainError('UPLOAD_REJECTED', `A complaint can carry at most ${MAX_PHOTOS} photos`);
    const content = Buffer.from(photo.contentBase64, 'base64');
    const maxBytes = await this.settings.getNumber('evidence.photo_max_bytes');
    if (content.byteLength === 0 || content.byteLength > maxBytes) throw new DomainError('UPLOAD_REJECTED', content.byteLength === 0 ? 'The photo is empty' : `The photo is larger than the ${maxBytes} byte limit`);
    const key = `complaints/${complaintId}/${randomUUID()}`;
    await this.storage.put({ key, bucket: 'evidence', content, contentType: photo.contentType });
    await this.event(tx, complaintId, actorUserId, 'EVIDENCE_ADDED', { evidenceKey: key });
    return key;
  }

  async addEvidence(userId: string, complaintId: string, photo: PhotoInput) {
    return this.prisma.$transaction(async tx => {
      const complaint = await this.lockParty(tx, userId, complaintId);
      if (FINAL.has(complaint.status)) throw new DomainError('CONFLICT', 'This complaint is closed');
      await this.storePhoto(tx, complaintId, userId, photo);
      return { ok: true };
    });
  }

  private async lockParty(tx: Prisma.TransactionClient, userId: string, complaintId: string): Promise<{ status: string; raisedBy: string | null; against: string }> {
    const rows = await tx.$queryRaw<{ status: string; raisedBy: string | null; against: string }[]>(
      Prisma.sql`SELECT status::text, raised_by_user_id as "raisedBy", against_user_id as against FROM complaints WHERE id = ${complaintId}::uuid FOR UPDATE`
    );
    const row = rows[0];
    if (row === undefined || (row.raisedBy !== userId && row.against !== userId)) throw notFound('Complaint');
    return row;
  }

  // ------------------------------------------------------------------ reading

  private async timeline(complaintId: string) {
    const events = await this.prisma.$queryRaw<{ id: string; actorUserId: string | null; type: string; fromStatus: string | null; toStatus: string | null; body: string | null; evidenceKey: string | null; createdAt: Date }[]>(
      Prisma.sql`SELECT id, actor_user_id as "actorUserId", type::text, from_status::text as "fromStatus", to_status::text as "toStatus", body, evidence_key as "evidenceKey", created_at as "createdAt" FROM complaint_events WHERE complaint_id = ${complaintId}::uuid ORDER BY created_at, id`
    );
    return events.map(({ evidenceKey, ...event }) => ({ ...event, evidenceUrl: evidenceKey === null ? null : `/api/v1/dev/storage/evidence/${encodeURIComponent(evidenceKey)}` }));
  }

  private async head(complaintId: string) {
    const rows = await this.prisma.$queryRaw<
      { id: string; bookingId: string | null; bookingCode: string | null; raisedBy: string | null; against: string; source: string; category: string; severity: string; status: string; description: string; slaDueAt: Date; assignedTo: string | null; resolution: string | null; resolutionNote: string | null; createdAt: Date; resolvedAt: Date | null; raisedByName: string | null; againstName: string }[]
    >(
      Prisma.sql`SELECT c.id, c.booking_id as "bookingId", b.code as "bookingCode", c.raised_by_user_id as "raisedBy", c.against_user_id as against, c.source::text, c.category::text, c.severity::text, c.status::text, c.description, c.sla_due_at as "slaDueAt",
          c.assigned_to as "assignedTo", c.resolution::text, c.resolution_note as "resolutionNote", c.created_at as "createdAt", c.resolved_at as "resolvedAt",
          trim(ru.first_name || ' ' || ru.last_name) as "raisedByName", trim(au.first_name || ' ' || au.last_name) as "againstName"
        FROM complaints c LEFT JOIN bookings b ON b.id = c.booking_id LEFT JOIN users ru ON ru.id = c.raised_by_user_id JOIN users au ON au.id = c.against_user_id WHERE c.id = ${complaintId}::uuid`
    );
    if (rows[0] === undefined) throw notFound('Complaint');
    return rows[0];
  }

  private withSla<T extends { slaDueAt: Date; status: string }>(row: T) {
    const remaining = Math.round((row.slaDueAt.getTime() - this.clock.now().getTime()) / 60_000);
    return { ...row, slaRemainingMinutes: remaining, slaBreached: !FINAL.has(row.status) && remaining < 0 };
  }

  /** What a party to the complaint sees: the complaint and its whole timeline. The other side sees it too — that is the right of reply. */
  async viewFor(userId: string, complaintId: string) {
    const head = await this.head(complaintId);
    if (head.raisedBy !== userId && head.against !== userId) throw notFound('Complaint');
    return { ...this.withSla(head), youAre: head.raisedBy === userId ? 'COMPLAINANT' : 'RESPONDENT', timeline: await this.timeline(complaintId) };
  }

  async listMine(userId: string) {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM complaints WHERE raised_by_user_id = ${userId}::uuid OR against_user_id = ${userId}::uuid ORDER BY created_at DESC LIMIT 100`);
    const items = [];
    for (const { id } of rows) items.push(this.withSla(await this.head(id)));
    return items;
  }

  async reply(userId: string, complaintId: string, body: string) {
    return this.prisma.$transaction(async tx => {
      const complaint = await this.lockParty(tx, userId, complaintId);
      if (FINAL.has(complaint.status)) throw new DomainError('CONFLICT', 'This complaint is closed');
      const respondent = complaint.against === userId;
      await this.event(tx, complaintId, userId, respondent ? 'PARTY_REPLY' : 'COMMENT', { body });
      // Someone was waiting for the respondent; their reply puts it back in front of the admin.
      if (respondent && complaint.status === 'AWAITING_RESPONSE') {
        await tx.$executeRaw(Prisma.sql`UPDATE complaints SET status = 'UNDER_REVIEW'::complaint_status WHERE id = ${complaintId}::uuid`);
        await this.event(tx, complaintId, userId, 'STATUS_CHANGED', { from: 'AWAITING_RESPONSE', to: 'UNDER_REVIEW' });
      }
      await appendOutboxEvent(tx, { aggregate: 'complaint', aggregateId: complaintId, type: 'complaint.replied', payload: { complaintId, byUserId: userId } });
      return { ok: true };
    });
  }

  // ------------------------------------------------------------------ admin

  async queue(filter: { status?: string | undefined; severity?: string | undefined; assignedTo?: string | undefined; open?: string | undefined }) {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT id FROM complaints WHERE (${filter.status ?? null}::text IS NULL OR status::text = ${filter.status ?? null}) AND (${filter.severity ?? null}::text IS NULL OR severity::text = ${filter.severity ?? null})
          AND (${filter.assignedTo ?? null}::uuid IS NULL OR assigned_to = ${filter.assignedTo ?? null}::uuid) AND (${filter.open ?? null}::text IS NULL OR (${filter.open ?? null}::text = 'true') = (status NOT IN ('RESOLVED','REJECTED')))
        ORDER BY (status IN ('RESOLVED','REJECTED')), CASE severity WHEN 'SAFETY' THEN 0 WHEN 'HIGH' THEN 1 ELSE 2 END, sla_due_at LIMIT 200`
    );
    const items = [];
    for (const { id } of rows) items.push(this.withSla(await this.head(id)));
    return items;
  }

  async adminView(complaintId: string) {
    const head = await this.head(complaintId);
    const disputes = await this.prisma.$queryRaw<{ id: string; status: string; origin: string }[]>(Prisma.sql`SELECT id, status::text, origin::text FROM disputes WHERE complaint_id = ${complaintId}::uuid OR booking_id = ${head.bookingId}::uuid ORDER BY created_at`);
    const penalties = await this.prisma.$queryRaw<{ id: string; breachCode: string; status: string }[]>(Prisma.sql`SELECT id, breach_code as "breachCode", status::text FROM penalties WHERE complaint_id = ${complaintId}::uuid ORDER BY created_at`);
    const booking =
      head.bookingId === null
        ? null
        : (
            await this.prisma.$queryRaw<{ status: string; paymentMode: string; finalPaisa: bigint | null }[]>(Prisma.sql`SELECT status::text, payment_mode::text as "paymentMode", coalesce(final_amount_paisa, approved_total_paisa) as "finalPaisa" FROM bookings WHERE id = ${head.bookingId}::uuid`)
          ).map(row => ({ status: row.status, paymentMode: row.paymentMode, finalAmountPaisa: row.finalPaisa === null ? null : paisaToNumber(row.finalPaisa) }))[0] ?? null;
    return { ...this.withSla(head), booking, disputes, penalties, timeline: await this.timeline(complaintId) };
  }

  async assign(adminId: string, complaintId: string, assigneeId: string | undefined) {
    const target = assigneeId ?? adminId;
    return this.prisma.$transaction(async tx => {
      const staff = await tx.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*)::bigint as n FROM user_roles WHERE user_id = ${target}::uuid AND role_code IN ('ADMIN','AGENT')`);
      if ((staff[0]?.n ?? 0n) === 0n) throw badRequest('A complaint can only be assigned to an admin or an agent');
      const rows = await tx.$queryRaw<{ status: string }[]>(Prisma.sql`SELECT status::text FROM complaints WHERE id = ${complaintId}::uuid FOR UPDATE`);
      if (rows[0] === undefined) throw notFound('Complaint');
      if (FINAL.has(rows[0].status)) throw new DomainError('CONFLICT', 'This complaint is closed');
      await tx.$executeRaw(Prisma.sql`UPDATE complaints SET assigned_to = ${target}::uuid WHERE id = ${complaintId}::uuid`);
      await this.event(tx, complaintId, adminId, 'COMMENT', { body: target === adminId ? 'Took the complaint' : `Assigned to ${target}` });
      await this.audit.append({ actorUserId: adminId, actorRole: 'ADMIN', action: 'complaint.assign', entityType: 'complaint', entityId: complaintId, after: { assignedTo: target } }, tx);
      return { id: complaintId, assignedTo: target };
    });
  }

  /**
   * FR-CP-03 / FR-CP-06: move a complaint along, and if the decision carries a consequence, carry it out in the same transaction. An illegal move is refused;
   * closing needs a note; a resolution names what was done. Refunds after release are borne by the platform (there is no escrow left), a penalty is only ever
   * *proposed* (the provider gets their right of reply), and a suspension or block is applied at once and audited.
   */
  async transition(adminId: string, complaintId: string, input: ComplaintTransitionInput) {
    const result = await this.prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<{ status: string; bookingId: string | null; against: string; category: string; raisedBy: string | null }[]>(
        Prisma.sql`SELECT status::text, booking_id as "bookingId", against_user_id as against, category::text, raised_by_user_id as "raisedBy" FROM complaints WHERE id = ${complaintId}::uuid FOR UPDATE`
      );
      const complaint = rows[0];
      if (complaint === undefined) throw notFound('Complaint');
      const from = complaint.status as ComplaintStatus;
      if (!canMoveComplaint(from, input.to)) throw new DomainError('ILLEGAL_TRANSITION', `A complaint that is ${from.toLowerCase().replace('_', ' ')} cannot move to ${input.to.toLowerCase().replace('_', ' ')}`);
      const closing = input.to === 'RESOLVED' || input.to === 'REJECTED';
      if (closing && input.note === undefined) throw new DomainError('VALIDATION_FAILED', 'Closing a complaint needs a note', [{ path: 'note', code: 'required', message: 'Say why the complaint is being closed' }]);
      if (input.to === 'RESOLVED' && input.resolution === undefined) throw new DomainError('VALIDATION_FAILED', 'A resolved complaint needs its outcome', [{ path: 'resolution', code: 'required', message: 'resolution is required to resolve a complaint' }]);
      if (input.to !== 'RESOLVED' && input.resolution !== undefined) throw new DomainError('VALIDATION_FAILED', 'Only a resolved complaint has a resolution', [{ path: 'resolution', code: 'invalid', message: 'resolution is only for RESOLVED' }]);

      const refundIds: string[] = [];
      if (input.to === 'RESOLVED' && input.resolution !== undefined) refundIds.push(...(await this.carryOut(tx, adminId, complaintId, complaint, input)));

      const resolution = input.to === 'RESOLVED' ? input.resolution : null;
      await tx.$executeRaw(
        Prisma.sql`UPDATE complaints SET status = ${input.to}::complaint_status, resolution = ${resolution}::complaint_resolution, resolution_note = ${closing ? (input.note ?? null) : null}, resolved_at = ${closing ? this.clock.now().toISOString() : null}::timestamptz WHERE id = ${complaintId}::uuid`
      );
      await this.event(tx, complaintId, adminId, 'STATUS_CHANGED', { from, to: input.to, ...(input.note === undefined ? {} : { body: input.note }) });
      await this.audit.append({ actorUserId: adminId, actorRole: 'ADMIN', action: 'complaint.transition', entityType: 'complaint', entityId: complaintId, before: { status: from }, after: { status: input.to, resolution } }, tx);
      await appendOutboxEvent(tx, { aggregate: 'complaint', aggregateId: complaintId, type: input.to === 'AWAITING_RESPONSE' ? 'complaint.response_requested' : 'complaint.status_changed', payload: { complaintId, from, to: input.to, resolution, againstUserId: complaint.against, raisedBy: complaint.raisedBy } });
      return { refundIds };
    });
    await this.bookingState.settleRefunds(result.refundIds);
    return this.adminView(complaintId);
  }

  private async carryOut(tx: Prisma.TransactionClient, adminId: string, complaintId: string, complaint: { bookingId: string | null; against: string; category: string }, input: ComplaintTransitionInput): Promise<string[]> {
    const resolution = input.resolution;
    if (resolution === undefined || resolution === 'NO_ACTION') return [];
    const targets = await tx.$queryRaw<{ isProvider: boolean }[]>(Prisma.sql`SELECT EXISTS (SELECT 1 FROM providers WHERE user_id = ${complaint.against}::uuid) as "isProvider"`);
    const againstProvider = targets[0]?.isProvider === true;
    if (!againstProvider && resolution !== 'WARNING') {
      throw new DomainError('VALIDATION_FAILED', 'This complaint is about a customer, so only NO_ACTION or WARNING apply', [{ path: 'resolution', code: 'invalid', message: 'Sanctions and refunds apply to complaints about a provider' }]);
    }
    if (resolution === 'WARNING') {
      await appendOutboxEvent(tx, { aggregate: 'complaint', aggregateId: complaintId, type: 'complaint.warning', payload: { complaintId, userId: complaint.against } });
      return [];
    }
    if (resolution === 'PARTIAL_REFUND' || resolution === 'FULL_REFUND') {
      if (complaint.bookingId === null) throw badRequest('A refund needs a booking');
      const bookings = await tx.$queryRaw<{ paymentMode: string; final: bigint }[]>(Prisma.sql`SELECT payment_mode::text as "paymentMode", coalesce(final_amount_paisa, approved_total_paisa) as final FROM bookings WHERE id = ${complaint.bookingId}::uuid`);
      const booking = bookings[0];
      if (booking === undefined) throw notFound('Booking');
      if (booking.paymentMode !== 'ONLINE') throw new DomainError('CONFLICT', 'A cash job was paid to the provider directly; there is no online payment to refund. Use a penalty or a dispute instead');
      const amount = resolution === 'FULL_REFUND' ? booking.final : BigInt(input.refundPaisa ?? 0);
      if (amount <= 0n) throw new DomainError('VALIDATION_FAILED', 'A partial refund needs an amount', [{ path: 'refundPaisa', code: 'required', message: 'refundPaisa is required for PARTIAL_REFUND' }]);
      return this.payments.compensate(tx, { bookingId: complaint.bookingId, amountPaisa: amount, reasonCode: `COMPLAINT_${resolution}`, reasonText: input.note, idempotencyKey: `complaint:${complaintId}`, requestedBy: adminId });
    }
    if (resolution === 'PROVIDER_PENALTY') {
      if (input.breachCode === undefined) throw new DomainError('VALIDATION_FAILED', 'A penalty needs the breach it is for', [{ path: 'breachCode', code: 'required', message: 'breachCode is required for PROVIDER_PENALTY' }]);
      await this.conduct.propose(tx, { providerId: complaint.against, breachCode: input.breachCode, proposedBy: adminId, ...(complaint.bookingId === null ? {} : { bookingId: complaint.bookingId }), complaintId, excessPaisa: BigInt(input.excessPaisa ?? 0), evidence: { complaintId, note: input.note ?? null } });
      return [];
    }
    if (resolution === 'TEMPORARY_SUSPENSION') await this.conduct.restrict(tx, adminId, complaint.against, 'SUSPENSION', input.suspensionDays ?? 7, input.note ?? `Complaint ${complaintId}`);
    if (resolution === 'PERMANENT_BLOCK') await this.conduct.restrict(tx, adminId, complaint.against, 'BLOCK', null, input.note ?? `Complaint ${complaintId}`);
    return [];
  }

  /**
   * A complaint that is really about money still held (the job has not been verified yet) freezes the job as a dispute, so the money cannot release while an
   * admin decides. Only for a job awaiting verification — after release the money is gone and the complaint's own outcomes apply.
   */
  async openDispute(adminId: string, complaintId: string) {
    return this.prisma.$transaction(async tx => {
      const complaints = await tx.$queryRaw<{ bookingId: string | null; status: string }[]>(Prisma.sql`SELECT booking_id as "bookingId", status::text FROM complaints WHERE id = ${complaintId}::uuid FOR UPDATE`);
      const complaint = complaints[0];
      if (complaint === undefined) throw notFound('Complaint');
      if (complaint.bookingId === null || FINAL.has(complaint.status)) throw new DomainError('CONFLICT', 'This complaint has no live booking to dispute');
      const booking = await VerificationOutcomeService.loadBooking(tx, complaint.bookingId);
      await this.outcomes.openDispute(tx, { booking, origin: 'COMPLAINT', event: 'outcomeDisputed', actor: { userId: adminId, role: 'AGENT' }, complaintId });
      await this.event(tx, complaintId, adminId, 'COMMENT', { body: 'Opened a dispute; the job’s money is frozen' });
      await this.audit.append({ actorUserId: adminId, actorRole: 'ADMIN', action: 'complaint.open_dispute', entityType: 'complaint', entityId: complaintId }, tx);
      const disputes = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM disputes WHERE booking_id = ${complaint.bookingId}::uuid AND status <> 'RESOLVED' ORDER BY created_at DESC LIMIT 1`);
      return { disputeId: disputes[0]?.id ?? null };
    });
  }

  /** FR-CP-03: an SLA that has run out is flagged once — a timeline entry and an alert to the admins. Returns how many were newly flagged. */
  async flagSlaBreaches(): Promise<number> {
    const due = await this.prisma.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT c.id FROM complaints c WHERE c.status NOT IN ('RESOLVED','REJECTED') AND c.sla_due_at < ${this.clock.now().toISOString()}::timestamptz
        AND NOT EXISTS (SELECT 1 FROM complaint_events e WHERE e.complaint_id = c.id AND e.type = 'COMMENT' AND e.actor_user_id IS NULL AND e.body = 'SLA breached')`
    );
    for (const { id } of due) {
      await this.prisma.$transaction(async tx => {
        await this.event(tx, id, null, 'COMMENT', { body: 'SLA breached' });
        await appendOutboxEvent(tx, { aggregate: 'complaint', aggregateId: id, type: 'complaint.sla_breached', payload: { complaintId: id } });
      });
    }
    return due.length;
  }
}
