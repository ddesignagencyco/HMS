// apps/api/src/booking/booking-state.ts
import { Prisma } from '@prisma/client';
import { canTransition, type BookingEvent, type BookingStatus } from '@smart-home/domain';
import { DomainError, notFound } from '../common/domain-error.js';
import { appendOutboxEvent } from '../platform/audit.service.js';
import { BOOKING_COLUMNS, type BookingRowRaw } from './booking.row.js';

export type SystemEventOptions = {
  reason?: string;
  metadata?: Record<string, unknown>;
  paymentStatus?: 'NONE' | 'PENDING' | 'HELD' | 'RELEASED' | 'PARTIALLY_REFUNDED' | 'REFUNDED' | 'CASH_DUE' | 'CASH_SETTLED';
  /** Extra columns to set alongside the status flip, e.g. `provider_id` when an offer is accepted. */
  providerId?: string;
  /** Who decided, when the platform is applying somebody else's decision (an agent's verification outcome, an admin's ruling). The transition is still SYSTEM's; this only fills the history row. */
  actorUserId?: string;
  actorRole?: 'AGENT' | 'FINANCE' | 'ADMIN' | 'SYSTEM';
  /** Overrides the transition table's target, for events whose target depends on context (none today beyond cancel). */
  to?: BookingStatus;
};

/**
 * The system-actor half of `BookingService.apply()`: the platform itself
 * (payment capture, timeouts, the offer cascade, chained hand-offs) moving a
 * booking, inside a transaction the caller already owns so the status write is
 * atomic with whatever caused it (a ledger posting, an offer row, ...).
 *
 * Returns null when the booking is no longer in a status this event can leave —
 * every caller here is idempotent by design (a replayed webhook, a sweeper that
 * raced another), so "already moved on" is a normal outcome, not an error.
 * Throws only when the booking does not exist.
 */
export const applySystemEvent = async (tx: Prisma.TransactionClient, bookingId: string, event: BookingEvent, options: SystemEventOptions = {}): Promise<BookingRowRaw | null> => {
  const rows = await tx.$queryRaw<BookingRowRaw[]>(Prisma.sql`SELECT ${BOOKING_COLUMNS} FROM bookings WHERE id = ${bookingId}::uuid FOR UPDATE`);
  const row = rows[0];
  if (row === undefined) throw notFound('Booking');
  const transition = canTransition(row.status as BookingStatus, event, 'SYSTEM');
  if (transition === null) return null;
  const to = options.to ?? transition.to;

  await tx.$executeRaw(Prisma.sql`SET LOCAL app.transition_ctx = 'on'`);
  const updated = await tx.$queryRaw<BookingRowRaw[]>(
    Prisma.sql`UPDATE bookings SET status = ${to}::booking_status,
      payment_status = COALESCE(${options.paymentStatus ?? null}::booking_payment_status, payment_status),
      provider_id = COALESCE(${options.providerId ?? null}::uuid, provider_id)
      WHERE id = ${bookingId}::uuid RETURNING ${BOOKING_COLUMNS}`
  );
  const next = updated[0];
  if (next === undefined) throw new DomainError('INTERNAL_ERROR', 'Booking update did not return a row');
  await tx.$executeRaw(
    Prisma.sql`INSERT INTO booking_status_history(booking_id, from_status, to_status, event, actor_user_id, actor_role, reason, metadata)
      VALUES (${bookingId}::uuid, ${row.status}::booking_status, ${to}::booking_status, ${event}, ${options.actorUserId ?? null}::uuid, ${options.actorRole ?? 'SYSTEM'}::actor_role, ${options.reason ?? null}, ${JSON.stringify(options.metadata ?? {})}::jsonb)`
  );
  await appendOutboxEvent(tx, { aggregate: 'booking', aggregateId: bookingId, type: `booking.${event}`, payload: { bookingId, from: row.status, to, event, ...(options.actorUserId === undefined ? {} : { actorUserId: options.actorUserId }) } });
  return next;
};
