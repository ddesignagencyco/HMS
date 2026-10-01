// apps/api/src/notification/template.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DomainError, notFound } from '../common/domain-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { AuditService } from '../platform/audit.service.js';
import { renderTemplate, TEMPLATE_VARIABLES } from './notification.service.js';

export type TemplateInput = { subject?: string | null | undefined; body: string; isActive?: boolean | undefined };

const SAMPLE: Record<string, string> = {
  bookingRef: 'SHM-0001234', serviceName: 'Leak Repair', providerName: 'Bilal A.', slotLabel: '05 Oct 10:30', total: 'PKR 2,500.00', amount: 'PKR 2,500.00', problemLink: 'https://example.test/problem/abc', code: '123456', otp: '123456',
  link: 'https://example.test/v/abc', complaintRef: 'A1B2C3D4', category: 'QUALITY', to: 'RESOLVED', resolution: 'PARTIAL_REFUND', consequence: 'WARNING', until: '2026-10-12', points: '12', decision: 'REVERSED', breachCode: 'OVERCHARGE', releasePaisa: '60000', refundPaisa: '40000', replyDueAt: '2026-10-07T10:00:00Z'
};

/** FR-NT-06: templates are data, editable per event × channel × language, and checked when they are saved. */
@Injectable()
export class TemplateService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService
  ) {}

  /** The placeholders in a text that are not ones the system fills in. */
  unknownPlaceholders(...texts: (string | null | undefined)[]): string[] {
    const found = new Set<string>();
    for (const text of texts) for (const match of (text ?? '').matchAll(/\{\{(\w+)\}\}/g)) if (match[1] !== undefined) found.add(match[1]);
    return [...found].filter(name => !(TEMPLATE_VARIABLES as readonly string[]).includes(name));
  }

  private assertValid(input: TemplateInput): void {
    const unknown = this.unknownPlaceholders(input.body, input.subject);
    if (unknown.length > 0) {
      throw new DomainError('VALIDATION_FAILED', 'The template uses placeholders the system does not fill in', unknown.map(name => ({ path: 'body', code: 'unknown_placeholder', message: `{{${name}}} is not a known placeholder` })));
    }
  }

  async list(filter: { eventKey?: string | undefined; channel?: string | undefined; locale?: string | undefined }) {
    const items = await this.prisma.$queryRaw<{ id: string; eventKey: string; channel: string; locale: string; subject: string | null; body: string; isActive: boolean; updatedAt: Date }[]>(
      Prisma.sql`SELECT id, event_key as "eventKey", channel::text, locale, subject, body, is_active as "isActive", updated_at as "updatedAt" FROM notification_templates
        WHERE (${filter.eventKey ?? null}::text IS NULL OR event_key = ${filter.eventKey ?? null}) AND (${filter.channel ?? null}::text IS NULL OR channel::text = ${filter.channel ?? null}) AND (${filter.locale ?? null}::text IS NULL OR locale = ${filter.locale ?? null})
        ORDER BY event_key, channel, locale LIMIT 500`
    );
    return { items, variables: TEMPLATE_VARIABLES };
  }

  async get(id: string) {
    const rows = await this.prisma.$queryRaw<{ id: string; eventKey: string; channel: string; locale: string; subject: string | null; body: string; isActive: boolean; updatedAt: Date }[]>(
      Prisma.sql`SELECT id, event_key as "eventKey", channel::text, locale, subject, body, is_active as "isActive", updated_at as "updatedAt" FROM notification_templates WHERE id = ${id}::uuid`
    );
    if (rows[0] === undefined) throw notFound('Template');
    return rows[0];
  }

  async create(adminId: string, input: TemplateInput & { eventKey: string; channel: 'SMS' | 'EMAIL' | 'IN_APP' | 'WHATSAPP'; locale: 'en' | 'ur' }) {
    this.assertValid(input);
    const existing = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM notification_templates WHERE event_key = ${input.eventKey} AND channel = ${input.channel}::notification_channel AND locale = ${input.locale}`);
    if (existing[0] !== undefined) throw new DomainError('CONFLICT', 'A template for that event, channel and language already exists; edit it instead');
    const rows = await this.prisma.$queryRaw<{ id: string }[]>(
      Prisma.sql`INSERT INTO notification_templates(event_key, channel, locale, subject, body, is_active, updated_by) VALUES (${input.eventKey}, ${input.channel}::notification_channel, ${input.locale}, ${input.subject ?? null}, ${input.body}, ${input.isActive ?? true}, ${adminId}::uuid) RETURNING id`
    );
    const id = rows[0]?.id ?? '';
    await this.audit.append({ actorUserId: adminId, actorRole: 'ADMIN', action: 'template.create', entityType: 'notification_template', entityId: id, after: { eventKey: input.eventKey, channel: input.channel, locale: input.locale } });
    return this.get(id);
  }

  async update(adminId: string, id: string, input: TemplateInput) {
    this.assertValid(input);
    const before = await this.get(id);
    await this.prisma.$executeRaw(
      Prisma.sql`UPDATE notification_templates SET subject = ${input.subject === undefined ? before.subject : input.subject}, body = ${input.body}, is_active = ${input.isActive ?? before.isActive}, updated_by = ${adminId}::uuid, updated_at = now() WHERE id = ${id}::uuid`
    );
    await this.audit.append({ actorUserId: adminId, actorRole: 'ADMIN', action: 'template.update', entityType: 'notification_template', entityId: id, before: { body: before.body, isActive: before.isActive }, after: { body: input.body, isActive: input.isActive ?? before.isActive } });
    return this.get(id);
  }

  /** How a text would read, with sample values (or the caller's own) — so an admin can see the result before saving. */
  preview(input: { body: string; subject?: string | null | undefined; variables?: Record<string, string> | undefined }) {
    const unknown = this.unknownPlaceholders(input.body, input.subject);
    const values = { ...SAMPLE, ...(input.variables ?? {}) };
    return { subject: input.subject === undefined || input.subject === null ? null : renderTemplate(input.subject, values), body: renderTemplate(input.body, values), unknownPlaceholders: unknown, valid: unknown.length === 0 };
  }
}
