// apps/api/src/booking/message.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DomainError, notFound } from '../common/domain-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { appendOutboxEvent } from '../platform/audit.service.js';
import { maskContactDetails } from './message-masking.js';

export type MessageRow = { id: string; senderUserId: string; body: string; mine: boolean; readAt: Date | null; createdAt: Date };

/** The chat lives from the moment a provider is assigned until the job leaves the hands of the two parties. */
const OPEN_STATUSES = new Set(['SCHEDULED', 'EN_ROUTE', 'IN_PROGRESS', 'QUOTE_REVISION', 'WORK_COMPLETED', 'AWAITING_VERIFICATION']);

@Injectable()
export class MessageService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private async party(bookingId: string, userId: string): Promise<{ status: string; providerId: string | null; customerId: string }> {
    const rows = await this.prisma.$queryRaw<{ status: string; providerId: string | null; customerId: string }[]>(
      Prisma.sql`SELECT status, provider_id as "providerId", customer_id as "customerId" FROM bookings WHERE id = ${bookingId}::uuid AND (customer_id = ${userId}::uuid OR provider_id = ${userId}::uuid)`
    );
    const booking = rows[0];
    if (booking === undefined) throw notFound('Booking');
    return booking;
  }

  /** The conversation so far, oldest first. Reading marks the other side's messages as read. Still readable after the chat closes. */
  async list(bookingId: string, userId: string): Promise<{ items: MessageRow[]; open: boolean }> {
    const booking = await this.party(bookingId, userId);
    await this.prisma.$executeRaw(Prisma.sql`UPDATE messages SET read_at = now() WHERE booking_id = ${bookingId}::uuid AND sender_user_id <> ${userId}::uuid AND read_at IS NULL`);
    const rows = await this.prisma.$queryRaw<{ id: string; senderUserId: string; body: string; readAt: Date | null; createdAt: Date }[]>(
      Prisma.sql`SELECT id, sender_user_id as "senderUserId", body, read_at as "readAt", created_at as "createdAt" FROM messages WHERE booking_id = ${bookingId}::uuid ORDER BY created_at, id`
    );
    return { items: rows.map(row => ({ ...row, mine: row.senderUserId === userId })), open: OPEN_STATUSES.has(booking.status) };
  }

  async send(bookingId: string, userId: string, text: string): Promise<MessageRow & { masked: boolean }> {
    const booking = await this.party(bookingId, userId);
    if (booking.providerId === null || !OPEN_STATUSES.has(booking.status)) {
      throw new DomainError('ILLEGAL_TRANSITION', `The chat for this booking is closed (${booking.status})`);
    }
    const { body, masked } = maskContactDetails(text);
    return this.prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<{ id: string; senderUserId: string; body: string; readAt: Date | null; createdAt: Date }[]>(
        Prisma.sql`INSERT INTO messages(booking_id, sender_user_id, body) VALUES (${bookingId}::uuid, ${userId}::uuid, ${body})
          RETURNING id, sender_user_id as "senderUserId", body, read_at as "readAt", created_at as "createdAt"`
      );
      const row = rows[0];
      if (row === undefined) throw new Error('Message insert did not return a row');
      const recipient = userId === booking.customerId ? booking.providerId : booking.customerId;
      await appendOutboxEvent(tx, { aggregate: 'booking', aggregateId: bookingId, type: 'booking.message', payload: { bookingId, messageId: row.id, senderUserId: userId, recipientUserId: recipient } });
      return { ...row, mine: true, masked };
    });
  }
}
