// apps/api/src/verification/verification-link.service.ts
import { randomBytes } from 'node:crypto';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { allowedOutcomes, paisaToNumber } from '@smart-home/domain';
import { DomainError, notFound } from '../common/domain-error.js';
import { EnvironmentService } from '../config/environment.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { constantTimeEquals, generateOtpCode, hmacSha256 } from '../identity/otp.js';
import { SMS_SENDER, WHATSAPP_SENDER } from '../integrations/integrations.module.js';
import type { SmsSenderPort, WhatsAppSenderPort } from '../integrations/ports.js';
import { AppClock } from '../platform/app-clock.js';
import { QueueRegistry } from '../queues/queue.registry.js';
import { SettingsService } from '../platform/settings.service.js';
import { BookingStateService } from '../booking/booking-state.service.js';
import { VerificationOutcomeService } from './verification-outcome.service.js';

const OTP_MAX_ATTEMPTS = 5;

export type LinkAnswers = {
  otp: string;
  workCompleted: 'FULL' | 'PARTIAL' | 'NONE';
  quality: number;
  punctuality: number;
  conduct: number;
  cleanliness: number;
  extraChargeDemanded: boolean;
  consentToRelease: boolean;
};

type LinkRow = { id: string; verificationId: string; bookingId: string; otpHash: string; otpAttempts: number; expiresAt: Date; respondedAt: Date | null; tokenHash: string };

/**
 * FR-VC-06 / FR-VC-07 / FR-VC-12 / CL-09: the customer's own way to confirm a job — a one-tap link with a one-time
 * code. It serves two cases: Tier B jobs (nobody calls; the customer is asked straight away) and the unreachable customer
 * (three unanswered calls). A confident, positive answer becomes LINK_CONFIRMED; anything that sounds like a problem does
 * not release money and does not end the case — it goes back to the agents' queue as Tier A.
 */
@Injectable()
export class VerificationLinkService implements OnModuleInit {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EnvironmentService) private readonly environment: EnvironmentService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(AppClock) private readonly clock: AppClock,
    @Inject(SMS_SENDER) private readonly sms: SmsSenderPort,
    @Inject(WHATSAPP_SENDER) private readonly whatsapp: WhatsAppSenderPort,
    @Inject(QueueRegistry) private readonly queues: QueueRegistry,
    @Inject(VerificationOutcomeService) private readonly outcomes: VerificationOutcomeService,
    @Inject(BookingStateService) private readonly bookingState: BookingStateService
  ) {}

  onModuleInit(): void {
    // A Tier B job asks for its link through the outbox (the completion transaction cannot send an SMS), so the worker delivers it.
    this.queues.registerHandler('outbox.dispatch', async data => {
      if (data.eventType !== 'verification.link_requested') return;
      const payload = data.payload as { bookingId?: string; verificationId?: string } | undefined;
      if (payload?.bookingId !== undefined && payload.verificationId !== undefined) await this.issue(payload.bookingId, payload.verificationId, 'TIER_B');
    });
  }

  private tokenHash(token: string): string {
    return hmacSha256(this.environment.values.OTP_PEPPER, `VERIFY_LINK:${token}`);
  }

  private otpHash(tokenHash: string, otp: string): string {
    return hmacSha256(this.environment.values.OTP_PEPPER, `VERIFY_LINK_OTP:${tokenHash}:${otp}`);
  }

  /** Creates the link and texts it (SMS and WhatsApp). One live link per call: asking again while one is open sends nothing new. Returns the token only to callers that need it (tests). */
  async issue(bookingId: string, verificationId: string, reason: 'UNREACHABLE' | 'TIER_B'): Promise<{ issued: boolean; token?: string; otp?: string }> {
    const open = await this.prisma.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT id FROM verification_links WHERE verification_call_id = ${verificationId}::uuid AND responded_at IS NULL AND expires_at > ${this.clock.now().toISOString()}::timestamptz`
    );
    if (open[0] !== undefined) return { issued: false };

    const facts = await this.prisma.$queryRaw<{ code: string; phone: string | null; locale: string; completedAt: Date | null }[]>(
      Prisma.sql`SELECT b.code, cu.phone_e164 as phone, cu.locale, b.completed_at as "completedAt" FROM bookings b JOIN users cu ON cu.id = b.customer_id WHERE b.id = ${bookingId}::uuid`
    );
    const fact = facts[0];
    if (fact === undefined) throw notFound('Booking');

    const token = randomBytes(24).toString('base64url');
    const hash = this.tokenHash(token);
    const otp = generateOtpCode();
    const autoReleaseHours = await this.settings.getNumber('verification.auto_release_hours');
    const base = fact.completedAt ?? this.clock.now();
    const expiresAt = new Date(Math.max(base.getTime() + autoReleaseHours * 3_600_000, this.clock.now().getTime() + 3_600_000));
    await this.prisma.$executeRaw(
      Prisma.sql`INSERT INTO verification_links(verification_call_id, token_hash, otp_hash, channels, sent_at, expires_at)
        VALUES (${verificationId}::uuid, ${hash}, ${this.otpHash(hash, otp)}, ARRAY['SMS','WHATSAPP']::notification_channel[], ${this.clock.now().toISOString()}::timestamptz, ${expiresAt.toISOString()}::timestamptz)`
    );

    if (fact.phone !== null) {
      const templates = await this.prisma.$queryRaw<{ body: string }[]>(
        Prisma.sql`SELECT body FROM notification_templates WHERE event_key = 'verification.link' AND channel = 'SMS' AND locale = ${fact.locale} AND is_active`
      );
      const link = `${this.environment.values.PUBLIC_BASE_URL}/v/${token}`;
      const body = (templates[0]?.body ?? 'Confirm your booking {{bookingRef}} at {{link}} using code {{otp}}.').replace('{{bookingRef}}', fact.code).replace('{{link}}', link).replace('{{otp}}', otp);
      const meta = { event: 'verification.link', reason };
      await this.sms.send(fact.phone, body, meta);
      await this.whatsapp.send(fact.phone, body, meta);
    }
    return { issued: true, token, otp };
  }

  private async load(token: string): Promise<LinkRow> {
    const rows = await this.prisma.$queryRaw<LinkRow[]>(
      Prisma.sql`SELECT l.id, l.verification_call_id as "verificationId", v.booking_id as "bookingId", l.otp_hash as "otpHash", l.otp_attempts as "otpAttempts", l.expires_at as "expiresAt", l.responded_at as "respondedAt", l.token_hash as "tokenHash"
        FROM verification_links l JOIN verification_calls v ON v.id = l.verification_call_id WHERE l.token_hash = ${this.tokenHash(token)}`
    );
    const link = rows[0];
    if (link === undefined) throw notFound('Verification link');
    if (link.respondedAt !== null) throw new DomainError('GONE', 'This link has already been used');
    if (link.expiresAt.getTime() <= this.clock.now().getTime()) throw new DomainError('GONE', 'This link has expired');
    return link;
  }

  /** What the customer sees when they open the link: enough to recognise the job, nothing sensitive. The code is asked for when they answer. */
  async describe(token: string) {
    const link = await this.load(token);
    const rows = await this.prisma.$queryRaw<{ code: string; serviceName: string; providerFirstName: string; amountPaisa: bigint | null }[]>(
      Prisma.sql`SELECT b.code, s.name_en as "serviceName", pu.first_name as "providerFirstName", b.final_amount_paisa as "amountPaisa"
        FROM bookings b JOIN services s ON s.id = b.service_id JOIN users pu ON pu.id = b.provider_id WHERE b.id = ${link.bookingId}::uuid`
    );
    const row = rows[0];
    if (row === undefined) throw notFound('Booking');
    return {
      bookingCode: row.code,
      serviceName: row.serviceName,
      providerFirstName: row.providerFirstName,
      amountPaisa: row.amountPaisa === null ? null : paisaToNumber(row.amountPaisa),
      expiresAt: link.expiresAt,
      questions: [
        { key: 'workCompleted', label: 'Was the work completed?', answers: ['FULL', 'PARTIAL', 'NONE'] },
        { key: 'ratings', label: 'Rate quality, punctuality, conduct and cleanliness, 1 to 5 each' },
        { key: 'extraChargeDemanded', label: 'Did the provider ask for any money beyond the approved price?', answers: [true, false] },
        { key: 'consentToRelease', label: 'Do you agree to release payment to the provider?', answers: [true, false] }
      ]
    };
  }

  /**
   * Answers from the link. Right code + a clean, consenting answer → LINK_CONFIRMED and the money is released. Right code + any
   * sign of a problem → no release; the case returns to the agents' queue as Tier A with the reason recorded. A wrong code counts
   * against `OTP_MAX_ATTEMPTS`; the fifth locks the link (423).
   */
  async respond(token: string, answers: LinkAnswers): Promise<{ status: 'CONFIRMED' | 'ESCALATED' }> {
    const outcome = await this.prisma.$transaction(async tx => {
      const link = await this.load(token);
      const locked = await tx.$queryRaw<{ otpAttempts: number; respondedAt: Date | null }[]>(
        Prisma.sql`SELECT otp_attempts as "otpAttempts", responded_at as "respondedAt" FROM verification_links WHERE id = ${link.id}::uuid FOR UPDATE`
      );
      if (locked[0]?.respondedAt !== null) throw new DomainError('GONE', 'This link has already been used');
      if ((locked[0]?.otpAttempts ?? 0) >= OTP_MAX_ATTEMPTS) return { failure: new DomainError('OTP_LOCKED', 'Too many incorrect codes. Please wait for a call from our team.') };
      if (!constantTimeEquals(link.otpHash, this.otpHash(link.tokenHash, answers.otp))) {
        const attempts = (locked[0]?.otpAttempts ?? 0) + 1;
        await tx.$executeRaw(Prisma.sql`UPDATE verification_links SET otp_attempts = ${attempts} WHERE id = ${link.id}::uuid`);
        return { failure: attempts >= OTP_MAX_ATTEMPTS ? new DomainError('OTP_LOCKED', 'Too many incorrect codes. Please wait for a call from our team.') : new DomainError('OTP_INVALID', `The code is not correct. ${OTP_MAX_ATTEMPTS - attempts} attempt(s) remaining`) };
      }

      const clean = allowedOutcomes({ workCompleted: answers.workCompleted, extraChargeDemanded: answers.extraChargeDemanded }).includes('VERIFIED_SATISFIED') && answers.consentToRelease;
      const stored = JSON.stringify({ workCompleted: answers.workCompleted, quality: answers.quality, punctuality: answers.punctuality, conduct: answers.conduct, cleanliness: answers.cleanliness, extraChargeDemanded: answers.extraChargeDemanded, consentToRelease: answers.consentToRelease });
      await tx.$executeRaw(Prisma.sql`UPDATE verification_links SET responded_at = ${this.clock.now().toISOString()}::timestamptz, answers = ${stored}::jsonb WHERE id = ${link.id}::uuid`);

      if (!clean) {
        // Not something a form should decide: a human takes it from here, ahead of routine work.
        await tx.$executeRaw(
          Prisma.sql`UPDATE verification_calls SET tier = 'A'::verification_tier, routing_reasons = array_append(routing_reasons, 'LINK_NEGATIVE'), status = 'QUEUED'::verification_status,
              locked_by = NULL, locked_at = NULL, next_attempt_at = ${this.clock.now().toISOString()}::timestamptz, priority = 0 WHERE id = ${link.verificationId}::uuid AND submitted_at IS NULL`
        );
        await tx.$executeRaw(Prisma.sql`UPDATE bookings SET verification_tier = 'A'::verification_tier WHERE id = ${link.bookingId}::uuid`);
        return { status: 'ESCALATED' as const };
      }

      const booking = await VerificationOutcomeService.loadBooking(tx, link.bookingId);
      await tx.$executeRaw(
        Prisma.sql`UPDATE verification_calls SET status = 'SUBMITTED'::verification_status, outcome = 'LINK_CONFIRMED'::verification_outcome, submitted_at = now(), work_completed = ${answers.workCompleted}::work_completion,
            quality = ${answers.quality}, punctuality = ${answers.punctuality}, conduct = ${answers.conduct}, cleanliness = ${answers.cleanliness}, extra_charge_demanded = false, consent_to_release = true,
            locked_by = NULL, locked_at = NULL WHERE id = ${link.verificationId}::uuid AND submitted_at IS NULL`
      );
      const result = await this.outcomes.permitRelease(tx, {
        booking, verificationId: link.verificationId, event: 'linkConfirmed', actor: { userId: null, role: 'SYSTEM' },
        rating: { quality: answers.quality, punctuality: answers.punctuality, conduct: answers.conduct, cleanliness: answers.cleanliness }
      });
      return { status: 'CONFIRMED' as const, refundIds: result.refundIds };
    });
    if ('failure' in outcome) throw outcome.failure as Error;
    if ('refundIds' in outcome && outcome.refundIds !== undefined) await this.bookingState.settleRefunds(outcome.refundIds);
    return { status: outcome.status };
  }
}
