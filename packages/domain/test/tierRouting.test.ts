import { describe, expect, it } from 'vitest';
import { routeTier, type TierRoutingInput, type TierRoutingSettings } from '../src/tierRouting.js';

const settings: TierRoutingSettings = { firstJobs: 5, valueThresholdPaisa: 1_500_000n, minTimeRatio: 0.4, sampleRate: 0.1, forceTierA: false };

/** A job that trips no rule at all. */
const routine: TierRoutingInput = {
  paymentMode: 'ONLINE',
  providerVerifiedJobs: 20,
  finalAmountPaisa: 300_000n,
  serviceIsHighRisk: false,
  evidence: { minutesOnSite: 80, expectedDurationMin: 90, missingRequiredPhoto: false, checkinOutsideGeofence: false },
  providerActiveDemeritPoints: 0,
  priorComplaintOrDispute: false,
  hasApprovedExtras: false
};
const never = (): number => 0.99;
const always = (): number => 0;

describe('routeTier (SRS §5.2, R1–R10)', () => {
  it('sends a routine job to Tier B with no reasons', () => {
    expect(routeTier(routine, settings, never)).toEqual({ tier: 'B', reasons: [] });
  });

  it('R1: a provider with fewer than the threshold of verified jobs', () => {
    expect(routeTier({ ...routine, providerVerifiedJobs: 4 }, settings, never).reasons).toEqual(['R1_NEW_PROVIDER']);
    expect(routeTier({ ...routine, providerVerifiedJobs: 5 }, settings, never).tier).toBe('B');
  });

  it('R2: a final amount above the value threshold (exactly at it is not above)', () => {
    expect(routeTier({ ...routine, finalAmountPaisa: 1_500_001n }, settings, never).reasons).toEqual(['R2_HIGH_VALUE']);
    expect(routeTier({ ...routine, finalAmountPaisa: 1_500_000n }, settings, never).tier).toBe('B');
  });

  it('R3: a high-risk service', () => {
    expect(routeTier({ ...routine, serviceIsHighRisk: true }, settings, never).reasons).toEqual(['R3_HIGH_RISK_SERVICE']);
  });

  it('R4: time on site under the ratio of the expected duration', () => {
    const quick = { ...routine.evidence, minutesOnSite: 35 };
    expect(routeTier({ ...routine, evidence: quick }, settings, never).reasons).toEqual(['R4_EVIDENCE_ANOMALY']);
    expect(routeTier({ ...routine, evidence: { ...routine.evidence, minutesOnSite: 36 } }, settings, never).tier).toBe('B');
  });

  it('R4: a missing required photo, or a check-in outside the geofence', () => {
    expect(routeTier({ ...routine, evidence: { ...routine.evidence, missingRequiredPhoto: true } }, settings, never).reasons).toEqual(['R4_EVIDENCE_ANOMALY']);
    expect(routeTier({ ...routine, evidence: { ...routine.evidence, checkinOutsideGeofence: true } }, settings, never).reasons).toEqual(['R4_EVIDENCE_ANOMALY']);
  });

  it('R4 is listed once however many anomalies there are', () => {
    const result = routeTier({ ...routine, evidence: { minutesOnSite: 1, expectedDurationMin: 90, missingRequiredPhoto: true, checkinOutsideGeofence: true } }, settings, never);
    expect(result.reasons).toEqual(['R4_EVIDENCE_ANOMALY']);
  });

  it('R5: any active demerit points', () => {
    expect(routeTier({ ...routine, providerActiveDemeritPoints: 1 }, settings, never).reasons).toEqual(['R5_ACTIVE_DEMERITS']);
  });

  it('R6: a prior complaint or dispute between this customer and provider', () => {
    expect(routeTier({ ...routine, priorComplaintOrDispute: true }, settings, never).reasons).toEqual(['R6_PRIOR_COMPLAINT']);
  });

  it('R7: extras approved on site', () => {
    expect(routeTier({ ...routine, hasApprovedExtras: true }, settings, never).reasons).toEqual(['R7_EXTRAS_ON_SITE']);
  });

  it('R8: a cash job is always Tier A, because the call gates the cash handover', () => {
    expect(routeTier({ ...routine, paymentMode: 'CASH' }, settings, never).reasons).toEqual(['R8_CASH']);
  });

  it('R9: a random sample at the configured rate, decided by the injected draw', () => {
    expect(routeTier(routine, settings, always)).toEqual({ tier: 'A', reasons: ['R9_RANDOM_SAMPLE'] });
    expect(routeTier(routine, { ...settings, sampleRate: 0.1 }, () => 0.1).tier).toBe('B');
    expect(routeTier(routine, { ...settings, sampleRate: 0.1 }, () => 0.0999).tier).toBe('A');
  });

  it('R9 does not draw when another rule already sent the job to Tier A', () => {
    let draws = 0;
    routeTier({ ...routine, serviceIsHighRisk: true }, settings, () => {
      draws += 1;
      return 0;
    });
    expect(draws).toBe(0);
  });

  it('R10: the force flag sends everything to Tier A, alongside any other reasons', () => {
    expect(routeTier(routine, { ...settings, forceTierA: true }, never).reasons).toEqual(['R10_FORCED']);
    expect(routeTier({ ...routine, paymentMode: 'CASH' }, { ...settings, forceTierA: true }, never).reasons).toEqual(['R8_CASH', 'R10_FORCED']);
  });

  it('records every matching rule, in rule order', () => {
    const result = routeTier(
      { ...routine, providerVerifiedJobs: 0, finalAmountPaisa: 9_000_000n, serviceIsHighRisk: true, providerActiveDemeritPoints: 3, priorComplaintOrDispute: true, hasApprovedExtras: true, paymentMode: 'CASH' },
      { ...settings, forceTierA: true },
      never
    );
    expect(result.reasons).toEqual(['R1_NEW_PROVIDER', 'R2_HIGH_VALUE', 'R3_HIGH_RISK_SERVICE', 'R5_ACTIVE_DEMERITS', 'R6_PRIOR_COMPLAINT', 'R7_EXTRAS_ON_SITE', 'R8_CASH', 'R10_FORCED']);
    expect(result.tier).toBe('A');
  });
});
