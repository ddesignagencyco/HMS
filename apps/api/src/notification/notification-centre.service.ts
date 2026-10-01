// apps/api/src/notification/notification-centre.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { notFound } from '../common/domain-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { AppClock } from '../platform/app-clock.js';

/** FR-NT-05: what a person sees in their notification centre, and what an admin sees in the delivery log. */
@Injectable()
export class NotificationCentreService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AppClock) private readonly clock: AppClock
  ) {}

  /** The person's in-app notifications, newest first, with how many are unread. */
  async listOwn(userId: string, options: { unreadOnly: boolean; limit: number }) {
    const rows = await this.prisma.$queryRaw<{ id: string; eventKey: string; subject: string | null; body: string; readAt: Date | null; createdAt: Date; payload: Record<string, unknown> }[]>(
      Prisma.sql`SELECT n.id, n.event_key as "eventKey", t.subject, n.rendered_body as body, n.read_at as "readAt", n.created_at as "createdAt", n.payload
        FROM notifications n LEFT JOIN notification_templates t ON t.id = n.template_id
        WHERE n.user_id = ${userId}::uuid AND n.channel = 'IN_APP' AND (${options.unreadOnly} = false OR n.read_at IS NULL) ORDER BY n.created_at DESC, n.id DESC LIMIT ${options.limit}`
    );
    const unread = await this.prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*)::bigint as n FROM notifications WHERE user_id = ${userId}::uuid AND channel = 'IN_APP' AND read_at IS NULL`);
    return {
      unreadCount: Number(unread[0]?.n ?? 0n),
      items: rows.map(({ payload, ...row }) => ({ ...row, bookingId: typeof payload.bookingId === 'string' ? payload.bookingId : null, complaintId: typeof payload.complaintId === 'string' ? payload.complaintId : null }))
    };
  }

  async markRead(userId: string, id: string) {
    const updated = await this.prisma.$executeRaw(
      Prisma.sql`UPDATE notifications SET status = 'READ'::notification_status, read_at = coalesce(read_at, ${this.clock.now().toISOString()}::timestamptz) WHERE id = ${id}::uuid AND user_id = ${userId}::uuid AND channel = 'IN_APP'`
    );
    if (updated === 0) throw notFound('Notification');
    return { id, read: true };
  }

  async markAllRead(userId: string) {
    const updated = await this.prisma.$executeRaw(
      Prisma.sql`UPDATE notifications SET status = 'READ'::notification_status, read_at = ${this.clock.now().toISOString()}::timestamptz WHERE user_id = ${userId}::uuid AND channel = 'IN_APP' AND read_at IS NULL`
    );
    return { marked: updated };
  }

  /** The delivery log: channel, recipient, template and status of every notification, filterable. */
  async log(filter: { userId?: string | undefined; eventKey?: string | undefined; channel?: string | undefined; status?: string | undefined; limit: number }) {
    const rows = await this.prisma.$queryRaw<{ id: string; userId: string; recipient: string | null; eventKey: string; channel: string; status: string; error: string | null; attempts: number | null; templateId: string | null; sentAt: Date | null; deliveredAt: Date | null; createdAt: Date }[]>(
      Prisma.sql`SELECT n.id, n.user_id as "userId", coalesce(u.phone_e164, u.email::text) as recipient, n.event_key as "eventKey", n.channel::text, n.status::text, n.error, (n.payload->>'_attempts')::int as attempts,
          n.template_id as "templateId", n.sent_at as "sentAt", n.delivered_at as "deliveredAt", n.created_at as "createdAt"
        FROM notifications n JOIN users u ON u.id = n.user_id
        WHERE (${filter.userId ?? null}::uuid IS NULL OR n.user_id = ${filter.userId ?? null}::uuid) AND (${filter.eventKey ?? null}::text IS NULL OR n.event_key = ${filter.eventKey ?? null})
          AND (${filter.channel ?? null}::text IS NULL OR n.channel::text = ${filter.channel ?? null}) AND (${filter.status ?? null}::text IS NULL OR n.status::text = ${filter.status ?? null})
        ORDER BY n.created_at DESC, n.id DESC LIMIT ${filter.limit}`
    );
    return { items: rows };
  }
}
