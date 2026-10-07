import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { badRequest, conflict, notFound } from '../common/domain-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { AuditService } from '../platform/audit.service.js';

export type ProviderOnboardingRow = { userId: string; status: string; submittedAt: Date | null; penaltyScheduleAcceptedAt: Date | null };

const ONBOARDING_COLUMNS = Prisma.sql`user_id as "userId", status, submitted_at as "submittedAt", penalty_schedule_accepted_at as "penaltyScheduleAcceptedAt"`;

type CompletenessRow = {
  status: string;
  submittedAt: Date | null;
  hasCity: boolean;
  hasBase: boolean;
  hasCnic: boolean;
  hasService: boolean;
  hasArea: boolean;
  hasAvailability: boolean;
};

/** Statuses from which a profile can (re)enter the approval queue. A provider registers straight into PENDING_APPROVAL (FR-SP-01), so the not-yet-started state is "PENDING_APPROVAL with no submitted_at", not DRAFT. */
const SUBMITTABLE = new Set(['DRAFT', 'PENDING_APPROVAL', 'REJECTED']);

/** The steps a provider must finish before `POST /provider/submit` is accepted, in the order the wizard presents them. */
const REQUIRED_STEPS: ReadonlyArray<{ path: string; missing: (row: CompletenessRow) => boolean; message: string }> = [
  { path: 'profile', missing: row => !row.hasCity || !row.hasBase, message: 'Set your city and base location' },
  { path: 'services', missing: row => !row.hasService, message: 'Offer at least one service with a price' },
  { path: 'areas', missing: row => !row.hasArea, message: 'Choose at least one area you work in' },
  { path: 'availability', missing: row => !row.hasAvailability, message: 'Add at least one weekly availability block' },
  { path: 'documents', missing: row => !row.hasCnic, message: 'Upload your CNIC front and back' }
];

/**
 * SHM-021: the "submit for approval" step. A provider registration already carries
 * `PENDING_APPROVAL` (FR-SP-01), but that is a statement about the *account*, not
 * about onboarding being finished — `submitted_at` is the marker that the steps are
 * done and there is something for an admin to review. This is what was missing: an
 * admin used to have no way to tell a half-filled profile from a finished one.
 *
 * The completeness gate runs first and the row is re-checked under `FOR UPDATE`
 * inside the transaction, so two concurrent submits cannot both pass. Accepting the
 * penalty schedule (FR-PN-08) stamps `penalty_schedule_accepted_at` here.
 */
@Injectable()
export class ProviderOnboardingService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService
  ) {}

  async submit(providerId: string): Promise<ProviderOnboardingRow> {
    const state = await this.state(providerId);
    if (!SUBMITTABLE.has(state.status)) throw conflict(`A profile in ${state.status} cannot be submitted for approval`);
    if (state.submittedAt !== null) throw conflict('Your profile is already submitted for approval');

    const missing = REQUIRED_STEPS.filter(step => step.missing(state));
    if (missing.length > 0) {
      throw badRequest('Complete every onboarding step before submitting', missing.map(step => ({ path: step.path, code: 'incomplete', message: step.message })));
    }

    return this.prisma.$transaction(async tx => {
      const locked = await tx.$queryRaw<{ status: string; submittedAt: Date | null }[]>(
        Prisma.sql`SELECT status, submitted_at as "submittedAt" FROM providers WHERE user_id = ${providerId}::uuid FOR UPDATE`
      );
      const before = locked[0];
      if (before === undefined) throw notFound('Provider');
      if (!SUBMITTABLE.has(before.status) || before.submittedAt !== null) throw conflict('Your profile is already submitted for approval');

      const rows = await tx.$queryRaw<ProviderOnboardingRow[]>(
        Prisma.sql`UPDATE providers SET
            status = 'PENDING_APPROVAL',
            submitted_at = now(),
            penalty_schedule_accepted_at = COALESCE(penalty_schedule_accepted_at, now()),
            rejection_reason = NULL
          WHERE user_id = ${providerId}::uuid
          RETURNING ${ONBOARDING_COLUMNS}`
      );
      const row = rows[0];
      if (row === undefined) throw notFound('Provider');

      await this.audit.append(
        { actorUserId: providerId, actorRole: 'PROVIDER', action: 'provider.submit', entityType: 'provider', entityId: providerId, before: { status: before.status, submittedAt: null }, after: { status: 'PENDING_APPROVAL' } },
        tx
      );
      // No outbox event: registration already announced this provider to the admins
      // (`provider.awaiting_approval`, auth.service.ts), and re-emitting the same event
      // here would notify them twice for one provider. The submit signal is `submitted_at`,
      // which the approval queue reads; a dedicated "onboarding finished" notification
      // would need its own event + template, which is not part of this ticket.
      return row;
    });
  }

  private async state(providerId: string): Promise<CompletenessRow> {
    const rows = await this.prisma.$queryRaw<CompletenessRow[]>(
      Prisma.sql`SELECT status,
          submitted_at as "submittedAt",
          city_id IS NOT NULL as "hasCity",
          base_location IS NOT NULL as "hasBase",
          cnic_enc IS NOT NULL as "hasCnic",
          EXISTS (SELECT 1 FROM provider_services s WHERE s.provider_id = providers.user_id) as "hasService",
          EXISTS (SELECT 1 FROM provider_service_areas a WHERE a.provider_id = providers.user_id) as "hasArea",
          EXISTS (SELECT 1 FROM provider_availability v WHERE v.provider_id = providers.user_id) as "hasAvailability"
        FROM providers WHERE user_id = ${providerId}::uuid`
    );
    const row = rows[0];
    if (row === undefined) throw notFound('Provider');
    return row;
  }
}
