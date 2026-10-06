// apps/api/src/notification/notification.service.ts
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { formatPaisa } from '@smart-home/domain';
import { signReceiptToken } from '../common/receipt-link.js';
import { EnvironmentService } from '../config/environment.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { SMS_SENDER } from '../integrations/integrations.module.js';
import type { SmsSenderPort } from '../integrations/ports.js';
import { AppClock } from '../platform/app-clock.js';
import { QueueRegistry } from '../queues/queue.registry.js';

export type OutboxJob = { outboxId?: string; eventType: string; payload: Record<string, unknown> };

export type Channel = 'SMS' | 'IN_APP';

/** Who a rule tells. `{ payload }` names a field of the event that holds the user id; `admins` is every active admin; `other` is the far side of whoever acted. */
export type Recipient = 'customer' | 'provider' | 'actor' | 'other' | 'admins' | { payload: string };
export type Rule = { recipient: Recipient; eventKey: string; channels: readonly Channel[] };

const IN_APP: readonly Channel[] = ['IN_APP'];
const BOTH: readonly Channel[] = ['IN_APP', 'SMS'];

/**
 * The planner matrix (FR-NT-01..04): every outbox event × who hears about it × on which channels, each naming a seeded template that exists in
 * English and Urdu. Adding an event means adding a row here and a template; nothing else changes. Templates themselves are editable at runtime
 * (`/admin/templates`), so wording is never a deploy.
 */
export const RULES: Readonly<Record<string, readonly Rule[]>> = {
  // -- booking lifecycle (M5/M6)
  'booking.paymentCaptured': [{ recipient: 'customer', eventKey: 'booking.requested', channels: IN_APP }],
  'booking.offer_created': [{ recipient: { payload: 'providerId' }, eventKey: 'booking.offer', channels: ['SMS'] }],
  'booking.accept': [
    { recipient: 'customer', eventKey: 'booking.accepted', channels: IN_APP },
    { recipient: 'customer', eventKey: 'booking.confirmed', channels: ['SMS'] }
  ],
  'booking.depart': [{ recipient: 'customer', eventKey: 'booking.on_the_way', channels: BOTH }],
  'booking.raiseQuoteRevision': [{ recipient: 'customer', eventKey: 'booking.quote_revision', channels: IN_APP }],
  'booking.cancel': [{ recipient: 'other', eventKey: 'booking.cancelled', channels: IN_APP }],
  'booking.noShow': [{ recipient: 'other', eventKey: 'booking.no_show_reported', channels: IN_APP }],
  'booking.exhaustOffers': [{ recipient: 'customer', eventKey: 'booking.unfulfilled', channels: IN_APP }],
  'booking.decline': [{ recipient: 'customer', eventKey: 'booking.unfulfilled', channels: IN_APP }],
  'booking.message': [{ recipient: { payload: 'recipientUserId' }, eventKey: 'booking.message', channels: IN_APP }],
  'booking.reminder_24h': [
    { recipient: 'customer', eventKey: 'booking.reminder_24h', channels: ['SMS'] },
    { recipient: 'provider', eventKey: 'booking.reminder_24h', channels: ['SMS'] }
  ],
  'booking.reminder_2h': [
    { recipient: 'customer', eventKey: 'booking.reminder_2h', channels: ['SMS'] },
    { recipient: 'provider', eventKey: 'booking.reminder_2h', channels: ['SMS'] }
  ],
  // -- verification and money (M7/M8)
  /**
 * The provider has finished. This is the one notification in the product a customer
 * has to act on before their money moves, so it goes by SMS as well as in-app: an
 * in-app-only row is invisible to anyone who does not open the app, and a Tier B
 * job whose money is released on the customer's answer would simply release itself
 * after 72 hours with the customer never told there was anything to confirm.
 */
'booking.handToVerification': [{ recipient: 'customer', eventKey: 'booking.awaiting_verification', channels: BOTH }],
  'booking.release': [
    { recipient: 'customer', eventKey: 'payment.released', channels: IN_APP },
    { recipient: 'provider', eventKey: 'payment.released_provider', channels: IN_APP }
  ],
  'booking.autoRelease': [{ recipient: 'provider', eventKey: 'booking.cash_authorised', channels: IN_APP }],
  'booking.cash_authorised': [{ recipient: 'provider', eventKey: 'booking.cash_authorised', channels: IN_APP }],
  'payment.receipt_due': [{ recipient: 'customer', eventKey: 'payment.receipt', channels: ['SMS'] }],
  'refund.queued': [{ recipient: 'customer', eventKey: 'payment.refunded', channels: IN_APP }],
  'payout.paid': [{ recipient: { payload: 'providerId' }, eventKey: 'payout.paid', channels: IN_APP }],
  'payment.debt_paid': [{ recipient: { payload: 'providerId' }, eventKey: 'payment.debt_paid', channels: IN_APP }],
  'verification.sla_breached': [{ recipient: 'admins', eventKey: 'admin.verification_sla_breach', channels: IN_APP }],
  // -- complaints and disputes (M10)
  'complaint.created': [{ recipient: { payload: 'raisedBy' }, eventKey: 'complaint.received', channels: IN_APP }],
  'complaint.safety_raised': [{ recipient: 'admins', eventKey: 'admin.safety_complaint', channels: BOTH }],
  'complaint.sla_breached': [{ recipient: 'admins', eventKey: 'admin.complaint_sla_breach', channels: IN_APP }],
  'complaint.response_requested': [{ recipient: { payload: 'againstUserId' }, eventKey: 'complaint.response_requested', channels: BOTH }],
  'complaint.status_changed': [
    { recipient: { payload: 'againstUserId' }, eventKey: 'complaint.status_changed', channels: IN_APP },
    { recipient: { payload: 'raisedBy' }, eventKey: 'complaint.status_changed', channels: IN_APP }
  ],
  'complaint.warning': [{ recipient: { payload: 'userId' }, eventKey: 'complaint.warning', channels: IN_APP }],
  'dispute.opened': [
    { recipient: 'admins', eventKey: 'admin.dispute_opened', channels: IN_APP },
    { recipient: 'provider', eventKey: 'dispute.opened', channels: BOTH }
  ],
  'dispute.resolved': [
    { recipient: { payload: 'customerId' }, eventKey: 'dispute.resolved', channels: BOTH },
    { recipient: { payload: 'providerId' }, eventKey: 'dispute.resolved', channels: BOTH }
  ],
  // -- conduct (M15)
  'penalty.proposed': [{ recipient: { payload: 'providerId' }, eventKey: 'penalty.proposed', channels: BOTH }],
  'penalty.applied': [{ recipient: { payload: 'providerId' }, eventKey: 'penalty.applied', channels: BOTH }],
  'penalty.appealed': [{ recipient: 'admins', eventKey: 'admin.appeal_filed', channels: IN_APP }],
  'appeal.decided': [{ recipient: { payload: 'providerId' }, eventKey: 'appeal.decided', channels: BOTH }],
  'provider.warned': [{ recipient: { payload: 'providerId' }, eventKey: 'provider.warned', channels: IN_APP }],
  'provider.suspended': [{ recipient: { payload: 'providerId' }, eventKey: 'provider.suspended', channels: BOTH }],
  'provider.blocked': [{ recipient: { payload: 'providerId' }, eventKey: 'provider.blocked', channels: BOTH }],
  // -- admin work queue
  'provider.awaiting_approval': [{ recipient: 'admins', eventKey: 'admin.provider_pending', channels: IN_APP }]
};

/** Every placeholder a template may use. A template that names anything else is refused when it is saved, so a typo cannot ship as a blank. */
export const TEMPLATE_VARIABLES = [
  'bookingRef', 'serviceName', 'providerName', 'slotLabel', 'total', 'amount', 'problemLink', 'code', 'otp', 'link',
  'complaintRef', 'category', 'to', 'resolution', 'consequence', 'until', 'points', 'decision', 'breachCode', 'releasePaisa', 'refundPaisa', 'replyDueAt', 'pointsAfter', 'penaltyId', 'amountPaisa'
] as const;

export const renderTemplate = (template: string, values: Record<string, string>): string => template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => values[name] ?? '');

type BookingContext = { code: string; customerId: string; providerId: string | null; serviceName: string; providerName: string; slotLabel: string; approvedTotalPaisa: bigint; finalAmountPaisa: bigint | null };
type UserContact = { id: string; phone: string | null; locale: string };

/** After this many failed sends a notification stops being retried and stays FAILED with the reason. */
const MAX_ATTEMPTS = 5;

/**
 * FR-NT-01..05: outbox events become messages. In-app notifications are rows the person reads in their notification centre; SMS goes out through the SMS
 * port. Everything is rendered in the recipient's own language from the seeded templates. Idempotent: `notifications` is unique on (outbox event, user, channel), so an
 * event delivered twice sends nothing twice. A failed send is retried with exponential backoff; the gateway's delivery receipt moves SENT to DELIVERED (or FAILED).
 */
@Injectable()
export class NotificationService implements OnModuleInit {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SMS_SENDER) private readonly sms: SmsSenderPort,
    @Inject(QueueRegistry) private readonly queues: QueueRegistry,
    @Inject(EnvironmentService) private readonly environment: EnvironmentService,
    @Inject(AppClock) private readonly clock: AppClock
  ) {}

  onModuleInit(): void {
    this.queues.registerHandler('outbox.dispatch', async data => void (await this.handle(data as unknown as OutboxJob)));
    this.queues.registerScheduled('notification.retry', async () => void (await this.retryFailed()));
  }

  /** Returns how many notifications were created (0 for an event with no rule, or one already handled). */
  async handle(job: OutboxJob): Promise<number> {
    const rules = RULES[job.eventType];
    if (rules === undefined) return 0;
    const bookingId = typeof job.payload.bookingId === 'string' ? job.payload.bookingId : undefined;
    const context = bookingId === undefined ? null : await this.context(bookingId);
    const actor = typeof job.payload.actorUserId === 'string' ? job.payload.actorUserId : typeof job.payload.senderUserId === 'string' ? job.payload.senderUserId : undefined;

    let created = 0;
    for (const rule of rules) {
      const userIds = await this.resolve(rule.recipient, context, job.payload, actor);
      for (const userId of userIds) {
        const user = await this.user(userId);
        if (user === null) continue;
        const values = this.values(job, context, bookingId ?? '');
        for (const channel of rule.channels) created += await this.deliver(job, user, rule.eventKey, channel, values);
      }
    }
    return created;
  }

  /** Booking facts plus every plain field of the event, so a template can say what a payload says (`{{resolution}}`, `{{until}}`, ...). */
  private values(job: OutboxJob, context: BookingContext | null, bookingId: string): Record<string, string> {
    const values: Record<string, string> = {};
    for (const [key, value] of Object.entries(job.payload)) if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') values[key] = String(value);
    const deltaPaisa = typeof job.payload.deltaPaisa === 'number' ? BigInt(job.payload.deltaPaisa) : 0n;
    const settled = typeof job.payload.amountPaisa === 'string' ? BigInt(job.payload.amountPaisa) : null;
    return {
      ...values,
      complaintRef: typeof job.payload.complaintId === 'string' ? job.payload.complaintId.slice(0, 8).toUpperCase() : '',
      bookingRef: context?.code ?? '',
      serviceName: context?.serviceName ?? '',
      providerName: context?.providerName ?? '',
      slotLabel: context?.slotLabel ?? '',
      total: context === null ? '' : `PKR ${formatPaisa(context.approvedTotalPaisa + deltaPaisa)}`,
      amount: settled !== null ? `PKR ${formatPaisa(settled)}` : context === null ? '' : `PKR ${formatPaisa(context.finalAmountPaisa ?? context.approvedTotalPaisa)}`,
      problemLink: bookingId === '' ? '' : this.problemLink(bookingId)
    };
  }

  /** A link the customer can follow from their receipt to report a problem, tied to this booking and unguessable. */
  private problemLink(bookingId: string): string {
    return `${this.environment.values.PUBLIC_BASE_URL}/problem/${signReceiptToken(this.environment.values.OTP_PEPPER, bookingId)}`;
  }

  private async resolve(recipient: Recipient, context: BookingContext | null, payload: Record<string, unknown>, actor: string | undefined): Promise<string[]> {
    if (recipient === 'admins') {
      const admins = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT u.id FROM users u JOIN user_roles r ON r.user_id = u.id WHERE r.role_code = 'ADMIN' AND u.status = 'ACTIVE' ORDER BY u.id`);
      return admins.map(admin => admin.id);
    }
    if (typeof recipient === 'object') {
      const value = payload[recipient.payload];
      return typeof value === 'string' ? [value] : [];
    }
    if (recipient === 'customer') return context === null ? [] : [context.customerId];
    if (recipient === 'provider') return context?.providerId == null ? [] : [context.providerId];
    if (recipient === 'actor') return actor === undefined ? [] : [actor];
    // "other": whoever is on the other side of the person who acted.
    if (actor === undefined || context === null) return [];
    const other = actor === context.customerId ? context.providerId : context.customerId;
    return other === null ? [] : [other];
  }

  private async template(eventKey: string, channel: Channel, locale: string): Promise<{ id: string; subject: string | null; body: string } | null> {
    // The recipient's language if the template exists in it, English otherwise — never silence for want of a translation.
    const rows = await this.prisma.$queryRaw<{ id: string; subject: string | null; body: string; locale: string }[]>(
      Prisma.sql`SELECT id, subject, body, locale FROM notification_templates WHERE event_key = ${eventKey} AND channel = ${channel}::notification_channel AND locale IN (${locale}, 'en') AND is_active`
    );
    return rows.find(row => row.locale === locale) ?? rows.find(row => row.locale === 'en') ?? null;
  }

  private async deliver(job: OutboxJob, user: UserContact, eventKey: string, channel: Channel, values: Record<string, string>): Promise<number> {
    const template = await this.template(eventKey, channel, user.locale);
    if (template === null) return 0;
    const body = renderTemplate(template.body, values);
    const outboxId = job.outboxId === undefined ? null : BigInt(job.outboxId);
    const inserted = await this.prisma.$queryRaw<{ id: string }[]>(
      Prisma.sql`INSERT INTO notifications(user_id, event_key, channel, template_id, payload, rendered_body, status, outbox_event_id)
        VALUES (${user.id}::uuid, ${eventKey}, ${channel}::notification_channel, ${template.id}::uuid, ${JSON.stringify(job.payload)}::jsonb, ${body}, 'QUEUED', ${outboxId})
        ON CONFLICT (outbox_event_id, user_id, channel) DO NOTHING RETURNING id`
    );
    const row = inserted[0];
    if (row === undefined) return 0;
    if (channel === 'SMS') await this.send(row.id, user.phone, body, eventKey, 1);
    else await this.prisma.$executeRaw(Prisma.sql`UPDATE notifications SET status = 'DELIVERED'::notification_status, sent_at = ${this.clock.now().toISOString()}::timestamptz, delivered_at = ${this.clock.now().toISOString()}::timestamptz WHERE id = ${row.id}::uuid`);
    return 1;
  }

  /** One attempt at an SMS. Failure schedules the next try after an exponential backoff (2, 4, 8, 16 minutes) until MAX_ATTEMPTS. */
  private async send(notificationId: string, phone: string | null, body: string, eventKey: string, attempt: number): Promise<void> {
    const now = this.clock.now();
    if (phone === null) {
      await this.prisma.$executeRaw(Prisma.sql`UPDATE notifications SET status = 'FAILED'::notification_status, error = 'recipient has no phone number', payload = payload || ${JSON.stringify({ _attempts: MAX_ATTEMPTS })}::jsonb WHERE id = ${notificationId}::uuid`);
      return;
    }
    try {
      const sent = await this.sms.send(phone, body, { event: eventKey });
      await this.prisma.$executeRaw(Prisma.sql`UPDATE notifications SET status = 'SENT'::notification_status, sent_at = ${now.toISOString()}::timestamptz, provider_message_id = ${sent.providerMessageId}, error = NULL, payload = payload || ${JSON.stringify({ _attempts: attempt })}::jsonb WHERE id = ${notificationId}::uuid`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'send failed';
      const retryAfter = new Date(now.getTime() + 2 ** attempt * 60_000);
      const exhausted = attempt >= MAX_ATTEMPTS;
      await this.prisma.$executeRaw(
        Prisma.sql`UPDATE notifications SET status = 'FAILED'::notification_status, error = ${exhausted ? `gave up after ${attempt} attempts: ${message}` : message}, payload = payload || ${JSON.stringify({ _attempts: attempt, _retryAfter: retryAfter.toISOString() })}::jsonb WHERE id = ${notificationId}::uuid`
      );
    }
  }

  /** Retries every failed SMS whose backoff has elapsed and that has attempts left. Returns how many were tried. */
  async retryFailed(): Promise<number> {
    const due = await this.prisma.$queryRaw<{ id: string; body: string; eventKey: string; attempts: number; phone: string | null }[]>(
      Prisma.sql`SELECT n.id, n.rendered_body as body, n.event_key as "eventKey", coalesce((n.payload->>'_attempts')::int, 1) as attempts, u.phone_e164 as phone
        FROM notifications n JOIN users u ON u.id = n.user_id
        WHERE n.status = 'FAILED' AND n.channel = 'SMS' AND coalesce((n.payload->>'_attempts')::int, 1) < ${MAX_ATTEMPTS} AND n.payload ? '_retryAfter'
          AND (n.payload->>'_retryAfter')::timestamptz <= ${this.clock.now().toISOString()}::timestamptz ORDER BY n.created_at LIMIT 200`
    );
    for (const row of due) await this.send(row.id, row.phone, row.body ?? '', row.eventKey, row.attempts + 1);
    return due.length;
  }

  /**
   * FR-NT-05: the gateway's delivery receipt for a message we sent. SENT becomes DELIVERED (or FAILED with its reason). A receipt that arrives twice, or
   * one that says FAILED after DELIVERED, changes nothing. Returns whether it matched a message of ours.
   */
  async applyDeliveryReceipt(receipt: { messageId: string; status: 'DELIVERED' | 'FAILED'; error?: string | undefined; occurredAt: Date }): Promise<{ matched: boolean; changed: boolean }> {
    const rows = await this.prisma.$queryRaw<{ id: string; status: string }[]>(Prisma.sql`SELECT id, status::text FROM notifications WHERE provider_message_id = ${receipt.messageId} FOR UPDATE`);
    const row = rows[0];
    if (row === undefined) return { matched: false, changed: false };
    if (row.status === 'DELIVERED' || row.status === 'READ') return { matched: true, changed: false };
    if (receipt.status === 'DELIVERED') {
      await this.prisma.$executeRaw(Prisma.sql`UPDATE notifications SET status = 'DELIVERED'::notification_status, delivered_at = ${receipt.occurredAt.toISOString()}::timestamptz, error = NULL WHERE id = ${row.id}::uuid`);
    } else {
      await this.prisma.$executeRaw(Prisma.sql`UPDATE notifications SET status = 'FAILED'::notification_status, error = ${receipt.error ?? 'delivery failed'} WHERE id = ${row.id}::uuid`);
    }
    return { matched: true, changed: true };
  }

  private async context(bookingId: string): Promise<BookingContext | null> {
    const rows = await this.prisma.$queryRaw<BookingContext[]>(
      Prisma.sql`SELECT b.code, b.customer_id as "customerId", b.provider_id as "providerId", s.name_en as "serviceName", coalesce(trim(pu.first_name || ' ' || pu.last_name), '') as "providerName",
          to_char(b.scheduled_start AT TIME ZONE 'Asia/Karachi', 'DD Mon HH24:MI') as "slotLabel", b.approved_total_paisa as "approvedTotalPaisa", b.final_amount_paisa as "finalAmountPaisa"
        FROM bookings b JOIN services s ON s.id = b.service_id LEFT JOIN users pu ON pu.id = b.provider_id WHERE b.id = ${bookingId}::uuid`
    );
    return rows[0] ?? null;
  }

  private async user(userId: string): Promise<UserContact | null> {
    const rows = await this.prisma.$queryRaw<UserContact[]>(Prisma.sql`SELECT id, phone_e164 as phone, locale FROM users WHERE id = ${userId}::uuid`);
    return rows[0] ?? null;
  }
}
