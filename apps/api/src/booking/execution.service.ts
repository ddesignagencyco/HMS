// apps/api/src/booking/execution.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DomainError, notFound } from '../common/domain-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { OBJECT_STORAGE } from '../integrations/integrations.module.js';
import type { ObjectStoragePort } from '../integrations/ports.js';
import { SettingsService } from '../platform/settings.service.js';
import type { BookingEvidenceInput } from './booking.schemas.js';

export type EvidenceRow = {
  id: string;
  kind: string;
  clientUuid: string;
  checklistItemId: number | null;
  contentType: string;
  sizeBytes: number;
  receivedAt: Date;
  clientCapturedAt: Date | null;
  url: string;
};

export type EvidenceResult = { evidence: EvidenceRow; duplicate: boolean };

const PROVIDER_KINDS = new Set(['BEFORE', 'AFTER', 'CHECKLIST']);
/** FR-BK-03: a customer may attach up to five photos of the problem, and only while the job can still change hands or be prepared for. */
const MAX_PROBLEM_PHOTOS = 5;
const CUSTOMER_PHOTO_STATUSES = new Set(['PENDING_PAYMENT', 'REQUESTED', 'SCHEDULED']);
const PROVIDER_EVIDENCE_STATUSES = new Set(['IN_PROGRESS', 'QUOTE_REVISION']);

/**
 * FR-EX-03 / FR-EX-08 / FR-EX-09 / FR-EX-12: what happens on site — evidence photos with
 * server timestamps, checklist steps (photo-required ones need their photo), and the
 * geofenced check-in recorded when the job starts.
 */
@Injectable()
export class ExecutionService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort
  ) {}

  /**
   * Stores one photo and records it, insert-only (a database trigger refuses any later edit or delete).
   * `clientUuid` makes a retry from a flaky connection or an offline queue land exactly once: the second
   * upload of the same uuid returns the row already stored and writes nothing. `receivedAt` is the server
   * clock; the device's own capture time is kept alongside it but never trusted over it.
   */
  async addEvidence(bookingId: string, actorUserId: string, input: BookingEvidenceInput): Promise<EvidenceResult> {
    const rows = await this.prisma.$queryRaw<{ customerId: string; providerId: string | null; status: string; serviceId: number; visitNo: number }[]>(
      Prisma.sql`SELECT customer_id as "customerId", provider_id as "providerId", status, service_id as "serviceId", visit_no as "visitNo" FROM bookings WHERE id = ${bookingId}::uuid`
    );
    const booking = rows[0];
    if (booking === undefined || (booking.customerId !== actorUserId && booking.providerId !== actorUserId)) throw notFound('Booking');
    const asProvider = booking.providerId === actorUserId;

    if (input.kind === 'CUSTOMER_PROBLEM') {
      if (asProvider) throw new DomainError('FORBIDDEN', 'Only the customer can attach photos of the problem');
      if (!CUSTOMER_PHOTO_STATUSES.has(booking.status)) throw new DomainError('ILLEGAL_TRANSITION', `Photos of the problem can no longer be added (${booking.status})`);
    } else {
      if (!PROVIDER_KINDS.has(input.kind) || !asProvider) throw new DomainError('FORBIDDEN', 'Only the provider can record job evidence');
      if (!PROVIDER_EVIDENCE_STATUSES.has(booking.status)) throw new DomainError('ILLEGAL_TRANSITION', `Evidence can only be recorded while the job is in progress (${booking.status})`);
    }

    if (input.kind === 'CHECKLIST') {
      if (input.checklistItemId === undefined) throw new DomainError('VALIDATION_FAILED', 'A checklist photo names the step it belongs to', [{ path: 'checklistItemId', code: 'required', message: 'checklistItemId is required for CHECKLIST evidence' }]);
      await this.assertChecklistItem(booking.serviceId, input.checklistItemId);
    }

    const content = Buffer.from(input.contentBase64, 'base64');
    const maxBytes = await this.settings.getNumber('evidence.photo_max_bytes');
    if (content.byteLength === 0) throw new DomainError('UPLOAD_REJECTED', 'The photo is empty');
    if (content.byteLength > maxBytes) throw new DomainError('UPLOAD_REJECTED', `The photo is larger than the ${maxBytes} byte limit`);

    const existing = await this.findByClientUuid(bookingId, input.clientUuid);
    if (existing !== null) return { evidence: existing, duplicate: true };

    if (input.kind === 'CUSTOMER_PROBLEM') {
      const count = await this.prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*)::bigint as n FROM job_evidence WHERE booking_id = ${bookingId}::uuid AND kind = 'CUSTOMER_PROBLEM'`);
      if ((count[0]?.n ?? 0n) >= BigInt(MAX_PROBLEM_PHOTOS)) throw new DomainError('UPLOAD_REJECTED', `A booking can carry at most ${MAX_PROBLEM_PHOTOS} problem photos`);
    }

    const storageKey = `${bookingId}/${input.clientUuid}`;
    await this.storage.put({ key: storageKey, bucket: 'evidence', content, contentType: input.contentType });

    const hasLocation = input.lat !== undefined && input.lng !== undefined;
    const inserted = await this.prisma.$queryRaw<{ id: string }[]>(
      Prisma.sql`INSERT INTO job_evidence(booking_id, kind, visit_no, checklist_item_id, storage_key, content_type, size_bytes, client_uuid, client_captured_at, location, uploaded_by)
        VALUES (${bookingId}::uuid, ${input.kind}::evidence_kind, ${booking.visitNo}, ${input.checklistItemId ?? null}, ${storageKey}, ${input.contentType}, ${content.byteLength}, ${input.clientUuid}::uuid,
          ${input.capturedAt ?? null}::timestamptz, ${hasLocation ? Prisma.sql`ST_SetSRID(ST_MakePoint(${input.lng ?? 0}, ${input.lat ?? 0}), 4326)::geography` : Prisma.sql`NULL`}, ${actorUserId}::uuid)
        ON CONFLICT (booking_id, client_uuid) DO NOTHING RETURNING id`
    );
    if (inserted[0] === undefined) {
      // Lost a race with a concurrent retry of the same upload: it is stored, once — hand back that row.
      const winner = await this.findByClientUuid(bookingId, input.clientUuid);
      if (winner === null) throw new Error('Evidence insert conflicted but no row exists');
      return { evidence: winner, duplicate: true };
    }
    const stored = await this.findByClientUuid(bookingId, input.clientUuid);
    if (stored === null) throw new Error('Evidence row vanished after insert');
    return { evidence: stored, duplicate: false };
  }

  async listEvidence(bookingId: string, actorUserId: string): Promise<EvidenceRow[]> {
    const owned = await this.prisma.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT id FROM bookings WHERE id = ${bookingId}::uuid AND (customer_id = ${actorUserId}::uuid OR provider_id = ${actorUserId}::uuid)`
    );
    if (owned.length === 0) throw notFound('Booking');
    return this.evidenceQuery(Prisma.sql`booking_id = ${bookingId}::uuid`);
  }

  private async findByClientUuid(bookingId: string, clientUuid: string): Promise<EvidenceRow | null> {
    const rows = await this.evidenceQuery(Prisma.sql`booking_id = ${bookingId}::uuid AND client_uuid = ${clientUuid}::uuid`);
    return rows[0] ?? null;
  }

  private async evidenceQuery(where: Prisma.Sql): Promise<EvidenceRow[]> {
    const rows = await this.prisma.$queryRaw<(Omit<EvidenceRow, 'url'> & { storageKey: string })[]>(
      Prisma.sql`SELECT id, kind, client_uuid as "clientUuid", checklist_item_id as "checklistItemId", content_type as "contentType", size_bytes as "sizeBytes", received_at as "receivedAt",
          client_captured_at as "clientCapturedAt", storage_key as "storageKey"
        FROM job_evidence WHERE ${where} ORDER BY received_at, id`
    );
    return rows.map(({ storageKey, ...row }) => ({ ...row, url: `/api/v1/dev/storage/evidence/${encodeURIComponent(storageKey)}` }));
  }

  private async assertChecklistItem(serviceId: number, checklistItemId: number): Promise<{ requiresPhoto: boolean }> {
    const items = await this.prisma.$queryRaw<{ requiresPhoto: boolean }[]>(
      Prisma.sql`SELECT requires_photo as "requiresPhoto" FROM service_checklist_items WHERE id = ${checklistItemId} AND service_id = ${serviceId} AND is_active = true`
    );
    const item = items[0];
    if (item === undefined) throw notFound('Checklist item');
    return item;
  }

  /**
   * FR-EX-08: one step done. A step that requires a photo is only accepted with the id of a CHECKLIST photo
   * already recorded for that very step on this booking — so "photographed" is proven by a stored, timestamped
   * row, not by the provider's say-so.
   */
  async markChecklistItemDone(bookingId: string, providerId: string, checklistItemId: number, evidenceId: string | undefined): Promise<{ checklistItemId: number; done: boolean; evidenceId: string | null }> {
    const owned = await this.prisma.$queryRaw<{ serviceId: number; status: string; visitNo: number }[]>(
      Prisma.sql`SELECT service_id as "serviceId", status, visit_no as "visitNo" FROM bookings WHERE id = ${bookingId}::uuid AND provider_id = ${providerId}::uuid`
    );
    const booking = owned[0];
    if (booking === undefined) throw notFound('Booking');
    if (booking.status !== 'IN_PROGRESS') throw new DomainError('ILLEGAL_TRANSITION', `Cannot update the checklist of a booking in status ${booking.status}`);
    const item = await this.assertChecklistItem(booking.serviceId, checklistItemId);

    let linkedEvidence: string | null = null;
    if (evidenceId !== undefined) {
      const found = await this.prisma.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT id FROM job_evidence WHERE id = ${evidenceId}::uuid AND booking_id = ${bookingId}::uuid AND kind = 'CHECKLIST' AND checklist_item_id = ${checklistItemId}`
      );
      if (found[0] === undefined) throw new DomainError('VALIDATION_FAILED', 'That evidence is not a photo of this checklist step', [{ path: 'evidenceId', code: 'invalid', message: 'evidenceId must be a CHECKLIST photo recorded for this step' }]);
      linkedEvidence = found[0].id;
    }
    if (item.requiresPhoto && linkedEvidence === null) {
      throw new DomainError('VALIDATION_FAILED', 'This step needs a photo before it can be marked done', [{ path: 'evidenceId', code: 'required', message: 'evidenceId is required for a step that requires a photo' }]);
    }

    await this.prisma.$executeRaw(
      Prisma.sql`INSERT INTO job_checklist_results(booking_id, checklist_item_id, visit_no, done, evidence_id)
        VALUES (${bookingId}::uuid, ${checklistItemId}, ${booking.visitNo}, true, ${linkedEvidence}::uuid)
        ON CONFLICT (booking_id, checklist_item_id, visit_no) DO UPDATE SET done = true, completed_at = now(), evidence_id = COALESCE(EXCLUDED.evidence_id, job_checklist_results.evidence_id)`
    );
    return { checklistItemId, done: true, evidenceId: linkedEvidence };
  }

  /**
   * FR-EX-09 / BR-09: how far from the customer's door the provider says they are. A shortfall is *flagged*,
   * never blocking — phones misreport GPS indoors — so it is recorded on the booking for verification to see.
   */
  async recordCheckin(tx: Prisma.TransactionClient, bookingId: string, kind: 'checkin' | 'checkout', point: { lat: number; lng: number; accuracyM?: number | undefined }): Promise<{ distanceM: number; withinGeofence: boolean }> {
    const radius = await this.settings.getNumber('evidence.geofence_radius_m');
    const rows = await tx.$queryRaw<{ distanceM: number }[]>(
      Prisma.sql`SELECT ST_Distance(a.location, ST_SetSRID(ST_MakePoint(${point.lng}, ${point.lat}), 4326)::geography)::float8 as "distanceM"
        FROM bookings b JOIN addresses a ON a.id = b.address_id WHERE b.id = ${bookingId}::uuid`
    );
    const distanceM = Math.round(rows[0]?.distanceM ?? 0);
    if (kind === 'checkin') {
      await tx.$executeRaw(Prisma.sql`UPDATE bookings SET checkin_at = now(), checkin_distance_m = ${distanceM}, checkin_accuracy_m = ${point.accuracyM === undefined ? null : Math.round(point.accuracyM)} WHERE id = ${bookingId}::uuid`);
    } else {
      await tx.$executeRaw(Prisma.sql`UPDATE bookings SET checkout_at = now(), checkout_distance_m = ${distanceM} WHERE id = ${bookingId}::uuid`);
    }
    return { distanceM, withinGeofence: distanceM <= radius };
  }
}
