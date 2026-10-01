// apps/api/src/verification/recording.service.ts
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { notFound } from '../common/domain-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { OBJECT_STORAGE } from '../integrations/integrations.module.js';
import type { ObjectStoragePort } from '../integrations/ports.js';
import { AppClock } from '../platform/app-clock.js';
import { AuditService } from '../platform/audit.service.js';
import { SettingsService } from '../platform/settings.service.js';
import { QueueRegistry } from '../queues/queue.registry.js';

const BUCKET = 'recordings';
const SIGNED_URL_SECONDS = 300;

/**
 * FR-VC-09 / NFR-PR-02 / BR-55: verification calls are recorded, and a recording is sensitive. Only finance and admin can play one, through a
 * short-lived signed link, and every access is written to the audit log with who asked. Recordings are kept for `recording.retention_days`
 * and then deleted for good; the purge is logged too. The attempt rows themselves are insert-only, so the recording reference stays as the record
 * that a recording existed — playback after the purge is simply "gone".
 */
@Injectable()
export class RecordingService implements OnModuleInit {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(AppClock) private readonly clock: AppClock,
    @Inject(QueueRegistry) private readonly queues: QueueRegistry
  ) {}

  onModuleInit(): void {
    this.queues.registerScheduled('recording.purge', async () => void (await this.purge()));
  }

  /** A signed, expiring link to the recording of one call attempt. 404 if the attempt had no recording or it has been purged. */
  async access(attemptId: string, actor: { userId: string; role: 'FINANCE' | 'ADMIN' }) {
    const rows = await this.prisma.$queryRaw<{ recordingRef: string | null; verificationId: string }[]>(
      Prisma.sql`SELECT recording_ref as "recordingRef", verification_call_id as "verificationId" FROM verification_call_attempts WHERE id = ${attemptId}::uuid`
    );
    const attempt = rows[0];
    if (attempt?.recordingRef === null || attempt === undefined) throw notFound('Recording');
    if ((await this.storage.head({ key: attempt.recordingRef, bucket: BUCKET })) === null) throw notFound('Recording');
    const link = await this.storage.presignGet({ key: attempt.recordingRef, bucket: BUCKET, ttlSeconds: SIGNED_URL_SECONDS });
    await this.audit.append({ actorUserId: actor.userId, actorRole: actor.role, action: 'recording.access', entityType: 'verification_call_attempt', entityId: attemptId, after: { verificationId: attempt.verificationId } });
    return { url: link.url, expiresAt: link.expiresAt };
  }

  /** Deletes recordings older than the retention period, logging each one, and returns how many objects were removed. Safe to run again: a purged object is skipped. */
  async purge(): Promise<number> {
    const days = await this.settings.getNumber('recording.retention_days');
    const cutoff = new Date(this.clock.now().getTime() - days * 86_400_000);
    const due = await this.prisma.$queryRaw<{ id: string; recordingRef: string }[]>(
      Prisma.sql`SELECT id, recording_ref as "recordingRef" FROM verification_call_attempts WHERE recording_ref IS NOT NULL AND started_at <= ${cutoff.toISOString()}::timestamptz ORDER BY started_at LIMIT 500`
    );
    let removed = 0;
    for (const attempt of due) {
      if ((await this.storage.head({ key: attempt.recordingRef, bucket: BUCKET })) === null) continue;
      await this.storage.remove({ key: attempt.recordingRef, bucket: BUCKET });
      await this.audit.append({ actorUserId: null, actorRole: 'SYSTEM', action: 'recording.purge', entityType: 'verification_call_attempt', entityId: attempt.id, after: { key: attempt.recordingRef, retentionDays: days } });
      removed += 1;
    }
    return removed;
  }
}
