// apps/api/test/integration/auto-breach-proposals.test.ts
//
// SHM-080: Automatic breach proposals — each trigger must produce a PROPOSED penalty row.
// Covers: NO_SHOW, LATE_CANCEL, REWORK_VERIFIED, POOR_STREAK, OVERCHARGE, FALSIFIED_EVIDENCE
import { Prisma } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { callApi, adminSession, createTestApp, postJson, registerAndVerify, type TestUser } from './harness.js';
import { bearer, freezeInsideCallingHours, newProvider, prisma, unfreeze, completedJob, agentSession, dropLocks, claim, answeredCall, startVisit, doWorkAndComplete } from './flow.js';

let app: NestExpressApplication;
let close: () => Promise<void>;
let admin: { accessToken: string; userId: string };

beforeAll(async () => {
  const started = await createTestApp();
  app = started.app;
  close = started.close;
  freezeInsideCallingHours(app);
  admin = await adminSession(app);
});

afterAll(async () => {
  unfreeze(app);
  await close();
  await prisma.$disconnect();
});

/** The `evidence` JSONB an auto-proposed penalty carries: the trigger's own keys, plus `automatic` and the ids it fired from. */
type PenaltyEvidence = { automatic?: boolean; disputeId?: string; bookingId?: string; breachCode?: string } & Record<string, unknown>;

const findAutoProposedPenalty = async (providerId: string, breachCode: string, bookingId?: string): Promise<string | null> => {
  const rows = await prisma.$queryRaw<{ id: string }[]>(
    Prisma.sql`SELECT id FROM penalties WHERE provider_id = ${providerId}::uuid AND breach_code = ${breachCode} AND ${bookingId ? Prisma.sql`booking_id = ${bookingId}::uuid` : Prisma.sql`booking_id IS NULL`} AND evidence->>'automatic' = 'true' AND status IN ('PROPOSED','APPLIED','APPEALED','UPHELD') ORDER BY created_at DESC LIMIT 1`
  );
  return rows[0]?.id ?? null;
};

const submitVerification = async (verificationId: string, body: Record<string, unknown>) => {
  const agent = await agentSession(app);
  await dropLocks(agent.userId);
  await claim(app, agent.accessToken, verificationId);
  await answeredCall(app, agent.accessToken, verificationId);
  return callApi(app, `/api/v1/agent/verifications/${verificationId}/submit`, bearer(agent.accessToken, postJson(body)));
};

// Helper to create a booking that stops at SCHEDULED (provider accepted but not departed)
const createScheduledBooking = async (app: NestExpressApplication, provider: { id: string; accessToken: string; serviceId: number; areaId: number; user: TestUser }, hoursFromNow = 48) => {
  const customer = await registerAndVerify(app, 'CUSTOMER');
  
  const address = await callApi<{ id: string }>(app, '/customer/addresses', bearer(customer.accessToken, postJson({ label: 'Home', line1: 'House 1', areaId: provider.areaId, lat: 31.52, lng: 74.35, isDefault: true })));
  
  const start = new Date(Date.now() + hoursFromNow * 3_600_000);
  const created = await callApi<{ id: string; code: string; payment?: { paymentId: string } }>(
    app,
    '/bookings',
    bearer(customer.accessToken, postJson({ providerId: provider.id, serviceId: provider.serviceId, addressId: address.body.id, scheduledStart: start.toISOString(), scheduledEnd: new Date(start.getTime() + 3_600_000).toISOString(), paymentMode: 'ONLINE' }))
  );
  
  if (created.status !== 201) throw new Error(`booking failed: ${created.status} ${JSON.stringify(created.body)}`);
  
  const bookingId = created.body.id;
  
  // Complete payment
  if (created.body.payment) {
    await callApi(app, `/dev/payments/${created.body.payment.paymentId}/complete?outcome=captured`, { method: 'POST' });
  }
  
  // Provider accepts
  await callApi(app, `/bookings/${bookingId}/accept`, bearer(provider.accessToken, { method: 'POST' }));
  
  return { bookingId, customer };
};

// Helper to create a booking that stops at EN_ROUTE (provider departed)
const createEnRouteBooking = async (app: NestExpressApplication, provider: { id: string; accessToken: string; serviceId: number; areaId: number; user: TestUser }) => {
  const { bookingId, customer } = await createScheduledBooking(app, provider, 48); // Create far in future first
  
  // Set scheduled_start to 10:00 AM Pakistan time (30 min before frozen clock at 10:30 AM)
  // Frozen clock is at 10:30 AM Pakistan = 5:30 AM UTC. 10:00 AM Pakistan = 5:00 AM UTC.
  const scheduledStart = new Date();
  scheduledStart.setUTCHours(5, 0, 0, 0); // 5:00 AM UTC = 10:00 AM Pakistan
  // If this time is in the future (real time), use yesterday
  if (scheduledStart.getTime() > Date.now()) {
    scheduledStart.setUTCDate(scheduledStart.getUTCDate() - 1);
  }
  await prisma.$executeRaw(Prisma.sql`UPDATE bookings SET scheduled_start = ${scheduledStart.toISOString()}::timestamptz WHERE id = ${bookingId}::uuid`);
  
  // Provider departs
  await callApi(app, `/bookings/${bookingId}/depart`, bearer(provider.accessToken, { method: 'POST' }));
  
  return { bookingId, customer };
};

describe('SHM-080: Automatic breach proposals (each trigger produces a PROPOSED penalty)', () => {
  describe('NO_SHOW — provider no-show reported by customer', () => {
    it('proposes NO_SHOW penalty (8 points, 100000 paisa fine) when customer reports provider no-show', async () => {
      const provider = await newProvider(app);
      const { bookingId, customer } = await createEnRouteBooking(app, provider);
      
      // Frozen clock is at 10:30 AM Pakistan, scheduled_start is 10:00 AM Pakistan
      // Grace period is 15 min, so 10:15 AM is earliest report time. 10:30 AM is past that.
      // Customer reports no-show
      const noShowResult = await callApi(app, `/api/v1/bookings/${bookingId}/no-show`, bearer(customer.accessToken, postJson({ party: 'PROVIDER' })));
      expect(noShowResult.status).toBe(200);
      
      const penaltyId = await findAutoProposedPenalty(provider.id, 'NO_SHOW', bookingId);
      expect(penaltyId).not.toBeNull();
      
      const penalty = await prisma.$queryRaw<{ points: number; fine_paisa: bigint; status: string; evidence: PenaltyEvidence }[]>(
        Prisma.sql`SELECT bt.points, p.fine_paisa, p.status::text, p.evidence FROM penalties p JOIN breach_types bt ON bt.code = p.breach_code WHERE p.id = ${penaltyId}::uuid`
      );
      expect(penalty[0]!.points).toBe(8);
      expect(penalty[0]!.fine_paisa).toBe(100_000n);
      expect(penalty[0]!.status).toBe('PROPOSED');
      expect(penalty[0]!.evidence.automatic).toBe(true);
      expect(penalty[0]!.evidence.reportedBy).toBe('CUSTOMER');
    });
  });

describe('LATE_CANCEL — provider cancels inside free-cancel window', () => {
    it('proposes LATE_CANCEL penalty (3 points, 50000 paisa fine) when provider cancels late', async () => {
      const provider = await newProvider(app);
      const { bookingId } = await createScheduledBooking(app, provider, 48); // Create far in future first
      
      // Set scheduled_start to 11:30 AM Pakistan time (1 hour after frozen clock at 10:30 AM)
      // Free cancel window is 4 hours, so 1 hour ahead is inside the window
      const scheduledStart = new Date();
      scheduledStart.setUTCHours(6, 30, 0, 0); // 6:30 AM UTC = 11:30 AM Pakistan
      if (scheduledStart.getTime() > Date.now()) {
        scheduledStart.setUTCDate(scheduledStart.getUTCDate() - 1);
      }
      await prisma.$executeRaw(Prisma.sql`UPDATE bookings SET scheduled_start = ${scheduledStart.toISOString()}::timestamptz WHERE id = ${bookingId}::uuid`);
      
      // Provider cancels
      await callApi(app, `/api/v1/bookings/${bookingId}/cancel`, bearer(provider.accessToken, postJson({ reason: 'Emergency' })));
      
      const penaltyId = await findAutoProposedPenalty(provider.id, 'LATE_CANCEL', bookingId);
      expect(penaltyId).not.toBeNull();
      
      const penalty = await prisma.$queryRaw<{ points: number; fine_paisa: bigint; status: string; evidence: PenaltyEvidence }[]>(
        Prisma.sql`SELECT bt.points, p.fine_paisa, p.status::text, p.evidence FROM penalties p JOIN breach_types bt ON bt.code = p.breach_code WHERE p.id = ${penaltyId}::uuid`
      );
      expect(penalty[0]!.points).toBe(3);
      expect(penalty[0]!.fine_paisa).toBe(50_000n);
      expect(penalty[0]!.status).toBe('PROPOSED');
      expect(penalty[0]!.evidence.automatic).toBe(true);
      expect(typeof penalty[0]!.evidence.hoursBeforeSlot).toBe('number');
    });

    it('does NOT propose LATE_CANCEL when provider cancels outside free-cancel window', async () => {
      const provider = await newProvider(app);
      const { bookingId } = await createScheduledBooking(app, provider, 48); // 48 hours from now (outside free cancel window)
      
      // Provider cancels
      await callApi(app, `/api/v1/bookings/${bookingId}/cancel`, bearer(provider.accessToken, postJson({ reason: 'Schedule conflict' })));
      
      const penaltyId = await findAutoProposedPenalty(provider.id, 'LATE_CANCEL', bookingId);
      expect(penaltyId).toBeNull();
    });
  });

  describe('REWORK_VERIFIED — verification outcome requires rework', () => {
    it('proposes REWORK_VERIFIED penalty (4 points, excess-based fine) when verification outcome is REWORK_REQUIRED', async () => {
      const provider = await newProvider(app);
      const { id: bookingId, verificationId } = await completedJob(app, provider, { mode: 'ONLINE' });
      
      // Submit verification with REWORK_REQUIRED outcome
      const submitResult = await submitVerification(verificationId, {
        outcome: 'REWORK_REQUIRED',
        consentLineRead: true,
        consentToRelease: false,
        workCompleted: 'PARTIAL',
        extraChargeDemanded: false,
        quality: 3,
        punctuality: 3,
        conduct: 3,
        cleanliness: 3,
        uniformWorn: true,
        ownTools: true,
        remark: 'Incomplete work, needs rework'
      });
      expect(submitResult.status).toBe(200);
      
      const penaltyId = await findAutoProposedPenalty(provider.id, 'REWORK_VERIFIED', bookingId);
      expect(penaltyId).not.toBeNull();
      
      const penalty = await prisma.$queryRaw<{ points: number; fine_paisa: bigint; status: string; evidence: PenaltyEvidence }[]>(
        Prisma.sql`SELECT bt.points, p.fine_paisa, p.status::text, p.evidence FROM penalties p JOIN breach_types bt ON bt.code = p.breach_code WHERE p.id = ${penaltyId}::uuid`
      );
      expect(penalty[0]!.points).toBe(4);
      expect(penalty[0]!.status).toBe('PROPOSED');
      expect(penalty[0]!.evidence.automatic).toBe(true);
      expect(penalty[0]!.evidence.verificationId).toBe(verificationId);
    });
  });

  describe('POOR_STREAK — three consecutive ratings under 3.0', () => {
    it('proposes POOR_STREAK penalty (5 points, REVIEW consequence) after third consecutive poor rating', async () => {
      const provider = await newProvider(app);

      // Complete 3 bookings with poor ratings
      for (let i = 0; i < 3; i++) {
        const { verificationId } = await completedJob(app, provider, { mode: 'ONLINE' });

        // Submit verification with poor rating
        const submitResult = await submitVerification(verificationId, {
          outcome: 'VERIFIED_SATISFIED',
          consentLineRead: true,
          consentToRelease: true,
          workCompleted: 'FULL',
          extraChargeDemanded: false,
          quality: 2,
          punctuality: 2,
          conduct: 2,
          cleanliness: 2,
          uniformWorn: true,
          ownTools: true,
          remark: 'Poor work'
        });
        expect(submitResult.status).toBe(200);
      }
      
      // The POOR_STREAK should be proposed after the third rating (via reputation refresh)
      const penaltyId = await findAutoProposedPenalty(provider.id, 'POOR_STREAK');
      expect(penaltyId).not.toBeNull();
      
      const penalty = await prisma.$queryRaw<{ points: number; fine_paisa: bigint; status: string; evidence: PenaltyEvidence }[]>(
        Prisma.sql`SELECT bt.points, p.fine_paisa, p.status::text, p.evidence FROM penalties p JOIN breach_types bt ON bt.code = p.breach_code WHERE p.id = ${penaltyId}::uuid`
      );
      expect(penalty[0]!.points).toBe(5);
      expect(penalty[0]!.fine_paisa).toBe(0n);
      expect(penalty[0]!.status).toBe('PROPOSED');
      expect(penalty[0]!.evidence.automatic).toBe(true);
      expect(Array.isArray(penalty[0]!.evidence.scores)).toBe(true);
      expect((penalty[0]!.evidence.scores as unknown[]).length).toBe(3);
    });

    it('does NOT propose duplicate POOR_STREAK for the same three ratings', async () => {
      const provider = await newProvider(app);
      
      // Complete 3 bookings with poor ratings
      for (let i = 0; i < 3; i++) {
        const { verificationId } = await completedJob(app, provider, { mode: 'ONLINE' });
        
        const submitResult = await submitVerification(verificationId, {
          outcome: 'VERIFIED_SATISFIED',
          consentLineRead: true,
          consentToRelease: true,
          workCompleted: 'FULL',
          extraChargeDemanded: false,
          quality: 2,
          punctuality: 2,
          conduct: 2,
          cleanliness: 2,
          uniformWorn: true,
          ownTools: true,
          remark: 'Poor work'
        });
        expect(submitResult.status).toBe(200);
      }
      
      // First proposal
      const penaltyId1 = await findAutoProposedPenalty(provider.id, 'POOR_STREAK');
      expect(penaltyId1).not.toBeNull();
      
      // Run reputation refresh again - should not create duplicate
      const { ReputationService } = await import('../../src/reputation/reputation.service.js');
      const reputationService = app.get(ReputationService);
      await reputationService.refresh(prisma, provider.id);
      
      const penalties = await prisma.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT id FROM penalties WHERE provider_id = ${provider.id}::uuid AND breach_code = 'POOR_STREAK' AND status IN ('PROPOSED','APPLIED','APPEALED','UPHELD')`
      );
      expect(penalties.length).toBe(1);
    });
  });

  describe('OVERCHARGE — customer reports extra charge demanded during verification', () => {
    it('proposes OVERCHARGE penalty (10 points, excess-based fine) when verification records extra charge demanded', async () => {
      const provider = await newProvider(app);
      const { id: bookingId, verificationId } = await completedJob(app, provider, { mode: 'ONLINE' });
      
      // Submit verification with extra charge demanded (DISPUTED outcome)
      const submitResult = await submitVerification(verificationId, {
        outcome: 'DISPUTED',
        consentLineRead: true,
        consentToRelease: false,
        workCompleted: 'FULL',
        extraChargeDemanded: true,
        extraChargeAmountPaisa: 50_000,
        quality: 5,
        punctuality: 5,
        conduct: 5,
        cleanliness: 5,
        uniformWorn: true,
        ownTools: true
      });
      expect(submitResult.status).toBe(200);
      
      const penaltyId = await findAutoProposedPenalty(provider.id, 'OVERCHARGE', bookingId);
      expect(penaltyId).not.toBeNull();
      
      const penalty = await prisma.$queryRaw<{ points: number; fine_paisa: bigint; status: string; evidence: PenaltyEvidence }[]>(
        Prisma.sql`SELECT bt.points, p.fine_paisa, p.status::text, p.evidence FROM penalties p JOIN breach_types bt ON bt.code = p.breach_code WHERE p.id = ${penaltyId}::uuid`
      );
      expect(penalty[0]!.points).toBe(10);
      expect(penalty[0]!.fine_paisa).toBeGreaterThan(0n);
      expect(penalty[0]!.status).toBe('PROPOSED');
      expect(penalty[0]!.evidence.automatic).toBe(true);
      expect(penalty[0]!.evidence.verificationId).toBe(verificationId);
      expect(penalty[0]!.evidence.demandedPaisa).toBe(50_000);
    });
  });

  describe('FALSIFIED_EVIDENCE — dispute resolution detects evidence inconsistency', () => {
    it('proposes FALSIFIED_EVIDENCE penalty (25 points, PERMANENT_BLOCK) when dispute reveals falsified evidence (missing required photos)', async () => {
      const provider = await newProvider(app);
      
      // Create a booking manually so we can add the checklist item before completion
      const customer = await registerAndVerify(app, 'CUSTOMER');
      const address = await callApi<{ id: string }>(app, '/customer/addresses', bearer(customer.accessToken, postJson({ label: 'Home', line1: 'House 1', areaId: provider.areaId, lat: 31.52, lng: 74.35, isDefault: true })));
      const start = new Date(Date.now() + 48 * 3_600_000);
      const created = await callApi<{ id: string; code: string; payment?: { paymentId: string } }>(
        app,
        '/bookings',
        bearer(customer.accessToken, postJson({ providerId: provider.id, serviceId: provider.serviceId, addressId: address.body.id, scheduledStart: start.toISOString(), scheduledEnd: new Date(start.getTime() + 3_600_000).toISOString(), paymentMode: 'ONLINE' }))
      );
      const bookingId = created.body.id;
      if (created.body.payment) await callApi(app, `/dev/payments/${created.body.payment.paymentId}/complete?outcome=captured`, { method: 'POST' });
      await callApi(app, `/bookings/${bookingId}/accept`, bearer(provider.accessToken, { method: 'POST' }));
      await callApi(app, `/bookings/${bookingId}/depart`, bearer(provider.accessToken, { method: 'POST' }));
      await startVisit(app, provider, customer, bookingId);
      
      // Complete the job normally first
      await doWorkAndComplete(app, provider, customer, bookingId);
      
      // Now manipulate an existing checklist result to simulate missing required photo
      // Find a checklist item that requires photo and remove its evidence
      await prisma.$executeRaw(Prisma.sql`
        UPDATE job_checklist_results jcr
        SET evidence_id = NULL
        FROM service_checklist_items sci
        WHERE jcr.checklist_item_id = sci.id
          AND jcr.booking_id = ${bookingId}::uuid
          AND sci.requires_photo = true
          AND jcr.done = true
      `);
      
      const verification = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM verification_calls WHERE booking_id = ${bookingId}::uuid ORDER BY visit_no DESC LIMIT 1`);
      const verificationId = verification[0]!.id;
      
      // Submit verification with DISPUTED outcome to create a dispute
      const submitResult = await submitVerification(verificationId, {
        outcome: 'DISPUTED',
        consentLineRead: true,
        consentToRelease: false,
        workCompleted: 'FULL',
        extraChargeDemanded: false,
        quality: 1,
        punctuality: 1,
        conduct: 1,
        cleanliness: 1,
        uniformWorn: true,
        ownTools: true,
        remark: 'Work not done'
      });
      expect(submitResult.status).toBe(200);
      
      // Get the dispute ID
      const dispute = await prisma.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT id FROM disputes WHERE booking_id = ${bookingId}::uuid ORDER BY created_at DESC LIMIT 1`
      );
      const disputeId = dispute[0]!.id;
      
      // Check evidence floor
      const { DisputesService } = await import('../../src/complaints/disputes.service.js');
      const disputesService = app.get(DisputesService);
      const evidenceFloor = await disputesService.evidenceFloor(disputeId, true);
      console.log('Evidence floor checklist:', JSON.stringify(evidenceFloor.evidenceFloor.checklist));
      
      // Resolve dispute - should auto-detect falsified evidence
      const resolveResult = await callApi(app, `/api/v1/admin/disputes/${disputeId}/resolve`, bearer(admin.accessToken, postJson({
        resolution: 'FULL_REFUND',
        note: 'Evidence shows checklist item marked done without required photo',
        breachCode: 'FALSIFIED_EVIDENCE',
        overrideReason: 'Auto-detected falsified evidence during testing'
      })));
      console.log('Resolve result:', resolveResult.status, JSON.stringify(resolveResult.body));
      
      const penaltyId = await findAutoProposedPenalty(provider.id, 'FALSIFIED_EVIDENCE', bookingId);
      expect(penaltyId).not.toBeNull();
      
      const penalty = await prisma.$queryRaw<{ points: number; fine_paisa: bigint; status: string; evidence: PenaltyEvidence }[]>(
        Prisma.sql`SELECT bt.points, p.fine_paisa, p.status::text, p.evidence FROM penalties p JOIN breach_types bt ON bt.code = p.breach_code WHERE p.id = ${penaltyId}::uuid`
      );
      expect(penalty[0]!.points).toBe(25);
      expect(penalty[0]!.status).toBe('PROPOSED');
      expect(penalty[0]!.evidence.automatic).toBe(true);
      expect(penalty[0]!.evidence.disputeId).toBe(disputeId);
      expect(penalty[0]!.evidence.missingRequiredPhotos).toBeDefined();
    });

    it('proposes FALSIFIED_EVIDENCE when before/after photos are suspiciously similar', async () => {
      const provider = await newProvider(app);
      const { id: bookingId, verificationId } = await completedJob(app, provider, { mode: 'ONLINE' });
      
      // Submit verification with DISPUTED outcome to create a dispute
      const submitResult = await submitVerification(verificationId, {
        outcome: 'DISPUTED',
        consentLineRead: true,
        consentToRelease: false,
        workCompleted: 'FULL',
        extraChargeDemanded: false,
        quality: 1,
        punctuality: 1,
        conduct: 1,
        cleanliness: 1,
        uniformWorn: true,
        ownTools: true
      });
      expect(submitResult.status).toBe(200);
      
      const dispute = await prisma.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT id FROM disputes WHERE booking_id = ${bookingId}::uuid ORDER BY created_at DESC LIMIT 1`
      );
      const disputeId = dispute[0]!.id;
      
      // One file submitted as both the "before" and the "after" shot. The key is the real
      // `${bookingId}/${clientUuid}` form `ExecutionService` produces, not a stand-in filename. `client_uuid` is
      // unique per booking, so the two rows differ there and collide only on the storage key.
      const beforeUuid = '11111111-1111-1111-1111-111111111111';
      const afterUuid = '22222222-2222-2222-2222-222222222222';
      const sharedKey = `${bookingId}/${beforeUuid}`;
      await prisma.$executeRaw(Prisma.sql`
        INSERT INTO job_evidence(booking_id, kind, visit_no, storage_key, content_type, size_bytes, client_uuid, client_captured_at, received_at, uploaded_by)
        VALUES
          (${bookingId}::uuid, 'BEFORE'::evidence_kind, 1, ${sharedKey}, 'image/jpeg', 1000, ${beforeUuid}::uuid, now(), now(), ${provider.id}::uuid),
          (${bookingId}::uuid, 'AFTER'::evidence_kind, 1, ${sharedKey}, 'image/jpeg', 1000, ${afterUuid}::uuid, now(), now(), ${provider.id}::uuid)
      `);
      
      // Resolve dispute
      const resolveResult = await callApi(app, `/api/v1/admin/disputes/${disputeId}/resolve`, bearer(admin.accessToken, postJson({
        resolution: 'FULL_REFUND',
        note: 'Before and after photos are identical',
        breachCode: 'FALSIFIED_EVIDENCE',
        overrideReason: 'Auto-detected falsified evidence during testing'
      })));
      expect(resolveResult.status).toBe(200);
      
      const penaltyId = await findAutoProposedPenalty(provider.id, 'FALSIFIED_EVIDENCE', bookingId);
      expect(penaltyId).not.toBeNull();
      
      const penalty = await prisma.$queryRaw<{ points: number; evidence: PenaltyEvidence }[]>(
        Prisma.sql`SELECT bt.points, p.evidence FROM penalties p JOIN breach_types bt ON bt.code = p.breach_code WHERE p.id = ${penaltyId}::uuid`
      );
      expect(penalty[0]!.points).toBe(25);
      expect(penalty[0]!.evidence.suspiciousPhotoPairs).toBeDefined();
    });

    it('proposes FALSIFIED_EVIDENCE when evidence uploaded after verification submitted', async () => {
      const provider = await newProvider(app);
      const { id: bookingId, verificationId } = await completedJob(app, provider, { mode: 'ONLINE' });
      
      // Submit verification first
      const submitResult = await submitVerification(verificationId, {
        outcome: 'DISPUTED',
        consentLineRead: true,
        consentToRelease: false,
        workCompleted: 'FULL',
        extraChargeDemanded: false,
        quality: 1,
        punctuality: 1,
        conduct: 1,
        cleanliness: 1,
        uniformWorn: true,
        ownTools: true
      });
      expect(submitResult.status).toBe(200);
      
      const dispute = await prisma.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT id FROM disputes WHERE booking_id = ${bookingId}::uuid ORDER BY created_at DESC LIMIT 1`
      );
      const disputeId = dispute[0]!.id;
      
      // Upload evidence AFTER verification (late evidence)
      const lateClientUuid = '33333333-3333-3333-3333-333333333333';
      await prisma.$executeRaw(Prisma.sql`
        INSERT INTO job_evidence(booking_id, kind, visit_no, storage_key, content_type, size_bytes, client_uuid, client_captured_at, received_at, uploaded_by)
        VALUES (${bookingId}::uuid, 'BEFORE'::evidence_kind, 1, 'late_evidence.jpg', 'image/jpeg', 1000, ${lateClientUuid}::uuid, now(), now() + interval '1 hour', ${provider.id}::uuid)
      `);
      
      // Resolve dispute
      const resolveResult = await callApi(app, `/api/v1/admin/disputes/${disputeId}/resolve`, bearer(admin.accessToken, postJson({
        resolution: 'FULL_REFUND',
        note: 'Evidence uploaded after verification call',
        breachCode: 'FALSIFIED_EVIDENCE',
        overrideReason: 'Auto-detected falsified evidence during testing'
      })));
      expect(resolveResult.status).toBe(200);
      
      const penaltyId = await findAutoProposedPenalty(provider.id, 'FALSIFIED_EVIDENCE', bookingId);
      expect(penaltyId).not.toBeNull();
      
      const penalty = await prisma.$queryRaw<{ points: number; evidence: PenaltyEvidence }[]>(
        Prisma.sql`SELECT bt.points, p.evidence FROM penalties p JOIN breach_types bt ON bt.code = p.breach_code WHERE p.id = ${penaltyId}::uuid`
      );
      expect(penalty[0]!.evidence.evidenceAfterVerification).toBeDefined();
    });

    // A PERMANENT_BLOCK is the harshest thing this system does to a provider, so the detector has to be proven
    // silent on an honest job. Both of these used to propose one: the photo heuristic matched any two keys that
    // shared an underscore-delimited prefix, and real keys (`${bookingId}/${clientUuid}`) share a prefix vacuously.
    it('does NOT propose FALSIFIED_EVIDENCE for an ordinary job with a before and an after photo', async () => {
      const provider = await newProvider(app);
      const { id: bookingId, verificationId } = await completedJob(app, provider, { mode: 'ONLINE' });

      const submitResult = await submitVerification(verificationId, {
        outcome: 'DISPUTED',
        consentLineRead: true,
        consentToRelease: false,
        workCompleted: 'FULL',
        extraChargeDemanded: false,
        quality: 1,
        punctuality: 1,
        conduct: 1,
        cleanliness: 1,
        uniformWorn: true,
        ownTools: true
      });
      expect(submitResult.status).toBe(200);
      const dispute = await prisma.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT id FROM disputes WHERE booking_id = ${bookingId}::uuid ORDER BY created_at DESC LIMIT 1`
      );
      const disputeId = dispute[0]!.id;

      // The job was driven through `doWorkAndComplete`, so it already carries a genuine BEFORE and AFTER photo
      // keyed the way the real upload path keys them.
      const photos = await prisma.$queryRaw<{ kind: string; storageKey: string }[]>(
        Prisma.sql`SELECT kind::text as kind, storage_key as "storageKey" FROM job_evidence WHERE booking_id = ${bookingId}::uuid AND kind IN ('BEFORE','AFTER')`
      );
      expect(photos.filter(p => p.kind === 'BEFORE').length).toBeGreaterThan(0);
      expect(photos.filter(p => p.kind === 'AFTER').length).toBeGreaterThan(0);

      const resolved = await callApi(app, `/admin/disputes/${disputeId}/resolve`, bearer(admin.accessToken, postJson({
        resolution: 'FULL_REFUND',
        note: 'Ruling on the evidence floor.',
        overrideReason: 'Evidence reviewed; ruling before the reply deadline.'
      })));
      expect(resolved.status).toBe(200);

      const penalties = await prisma.$queryRaw<{ breachCode: string }[]>(
        Prisma.sql`SELECT breach_code as "breachCode" FROM penalties WHERE provider_id = ${provider.id}::uuid AND breach_code = 'FALSIFIED_EVIDENCE'`
      );
      expect(penalties).toEqual([]);
    });

    it('does NOT propose FALSIFIED_EVIDENCE because a rework visit photographs after the first verification', async () => {
      const provider = await newProvider(app);

      // The rework visit photographs normally, so its evidence necessarily arrives after visit 1 was verified.
      // Driving the real rework flow (fresh visit, fresh start code, fresh verification call) rather than
      // fabricating the rows, so the visit numbering under test is the numbering the system actually produces.
      const { id: reworkBookingId, customer: reworkCustomer } = await completedJob(app, provider, { mode: 'ONLINE' });
      const firstCall = await prisma.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT id FROM verification_calls WHERE booking_id = ${reworkBookingId}::uuid ORDER BY visit_no DESC LIMIT 1`
      );
      const returned = await submitVerification(firstCall[0]!.id, {
        outcome: 'REWORK_REQUIRED',
        consentLineRead: true,
        consentToRelease: false,
        workCompleted: 'PARTIAL',
        extraChargeDemanded: false,
        quality: 2,
        punctuality: 2,
        conduct: 3,
        cleanliness: 3,
        uniformWorn: true,
        ownTools: true
      });
      expect(returned.status).toBe(200);
      expect(returned.body).toMatchObject({ reworkStarted: true });

      await startVisit(app, provider, reworkCustomer, reworkBookingId, 30);
      await doWorkAndComplete(app, provider, reworkCustomer, reworkBookingId);

      // Visit 2's photos and checklist were just written, and visit 1 was verified before all of them.
      const calls = await prisma.$queryRaw<{ id: string; visitNo: number }[]>(
        Prisma.sql`SELECT id, visit_no as "visitNo" FROM verification_calls WHERE booking_id = ${reworkBookingId}::uuid ORDER BY visit_no DESC`
      );
      expect(calls.length).toBeGreaterThanOrEqual(2);
      const visitTwoPhotos = await prisma.$queryRaw<{ n: bigint }[]>(
        Prisma.sql`SELECT count(*)::bigint as n FROM job_evidence WHERE booking_id = ${reworkBookingId}::uuid AND visit_no = 2`
      );
      expect(Number(visitTwoPhotos[0]!.n)).toBeGreaterThan(0);

      const second = await submitVerification(calls[0]!.id, {
        outcome: 'DISPUTED',
        consentLineRead: true,
        consentToRelease: false,
        workCompleted: 'FULL',
        extraChargeDemanded: false,
        quality: 1,
        punctuality: 1,
        conduct: 1,
        cleanliness: 1,
        uniformWorn: true,
        ownTools: true
      });
      expect(second.status).toBe(200);

      const dispute = await prisma.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT id FROM disputes WHERE booking_id = ${reworkBookingId}::uuid ORDER BY created_at DESC LIMIT 1`
      );
      const disputeId = dispute[0]!.id;

      const resolved = await callApi(app, `/admin/disputes/${disputeId}/resolve`, bearer(admin.accessToken, postJson({
        resolution: 'FULL_REFUND',
        note: 'Ruling on the evidence floor.',
        overrideReason: 'Evidence reviewed; ruling before the reply deadline.'
      })));
      expect(resolved.status).toBe(200);

      const penalties = await prisma.$queryRaw<{ breachCode: string }[]>(
        Prisma.sql`SELECT breach_code as "breachCode" FROM penalties WHERE provider_id = ${provider.id}::uuid AND breach_code = 'FALSIFIED_EVIDENCE'`
      );
      expect(penalties).toEqual([]);
    });
  });
});