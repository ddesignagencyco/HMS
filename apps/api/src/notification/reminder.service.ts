// apps/api/src/notification/reminder.service.ts
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { AppClock } from '../platform/app-clock.js';
import { QueueRegistry } from '../queues/queue.registry.js';

/** FR-NT-02: a reminder to both parties a day, and two hours, before a scheduled job. Each booking gets each reminder once — the event is only written if it does not exist yet. */
@Injectable()
export class ReminderService implements OnModuleInit {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AppClock) private readonly clock: AppClock,
    @Inject(QueueRegistry) private readonly queues: QueueRegistry
  ) {}

  onModuleInit(): void {
    this.queues.registerScheduled('booking.reminders', async () => void (await this.scan()));
  }

  /** A reminder is due once the slot is within its lead time — but not if the slot has already passed. Returns how many reminder events were written. */
  async scan(): Promise<number> {
    const now = this.clock.now().toISOString();
    let written = 0;
    for (const [type, hours] of [['booking.reminder_24h', 24], ['booking.reminder_2h', 2]] as const) {
      written += await this.prisma.$executeRaw(
        Prisma.sql`INSERT INTO outbox_events(aggregate, aggregate_id, type, payload)
          SELECT 'booking', b.id::text, ${type}, jsonb_build_object('bookingId', b.id)
          FROM bookings b WHERE b.status = 'SCHEDULED' AND b.scheduled_start > ${now}::timestamptz AND b.scheduled_start <= ${now}::timestamptz + make_interval(hours => ${hours}::int)
            AND NOT EXISTS (SELECT 1 FROM outbox_events o WHERE o.aggregate = 'booking' AND o.aggregate_id = b.id::text AND o.type = ${type})`
      );
    }
    return written;
  }
}
