export type VerificationTier = 'A' | 'B';

export type TierRoutingInput = {
  paymentMode: 'CASH' | 'ONLINE';
  /** Verified (release-permitting) jobs this provider has completed before this one. */
  providerVerifiedJobs: number;
  finalAmountPaisa: bigint;
  serviceIsHighRisk: boolean;
  /** R4 evidence anomalies, computed by the caller from what was actually recorded. */
  evidence: {
    /** Minutes between the verified start and the completion. */
    minutesOnSite: number;
    expectedDurationMin: number;
    missingRequiredPhoto: boolean;
    checkinOutsideGeofence: boolean;
  };
  providerActiveDemeritPoints: number;
  /** A complaint or dispute has ever been recorded between this customer and this provider. */
  priorComplaintOrDispute: boolean;
  /** At least one quote revision was approved on site. */
  hasApprovedExtras: boolean;
};

export type TierRoutingSettings = {
  /** R1 (BR-20): verified-job count below which the job is Tier A. */
  firstJobs: number;
  /** R2 (BR-21): job value above which the job is Tier A. */
  valueThresholdPaisa: bigint;
  /** R4 (BR-23): anomaly when time on site is under this share of the expected duration. */
  minTimeRatio: number;
  /** R9 (BR-22): probability a routine job is sampled into Tier A. */
  sampleRate: number;
  /** R10 (BR-25): send everything to Tier A. */
  forceTierA: boolean;
};

export type TierRoutingResult = { tier: VerificationTier; reasons: string[] };

/**
 * SRS §5.2 / FR-VC-11. A job goes to Tier A (a staffed call) if *any* rule matches, and every matching rule is
 * recorded, not just the first — the reasons are what an agent, and later an auditor, reads to see why a
 * human was asked to look. Otherwise Tier B (a one-tap confirmation link).
 *
 * Pure, and the randomness is injected: `random` returns a number in [0, 1), so R9 is testable without
 * mocking a global and the same inputs with the same draw always give the same answer.
 */
export const routeTier = (input: TierRoutingInput, settings: TierRoutingSettings, random: () => number): TierRoutingResult => {
  const reasons: string[] = [];
  if (input.providerVerifiedJobs < settings.firstJobs) reasons.push('R1_NEW_PROVIDER');
  if (input.finalAmountPaisa > settings.valueThresholdPaisa) reasons.push('R2_HIGH_VALUE');
  if (input.serviceIsHighRisk) reasons.push('R3_HIGH_RISK_SERVICE');

  const { evidence } = input;
  const tooQuick = evidence.expectedDurationMin > 0 && evidence.minutesOnSite < settings.minTimeRatio * evidence.expectedDurationMin;
  if (tooQuick || evidence.missingRequiredPhoto || evidence.checkinOutsideGeofence) reasons.push('R4_EVIDENCE_ANOMALY');

  if (input.providerActiveDemeritPoints > 0) reasons.push('R5_ACTIVE_DEMERITS');
  if (input.priorComplaintOrDispute) reasons.push('R6_PRIOR_COMPLAINT');
  if (input.hasApprovedExtras) reasons.push('R7_EXTRAS_ON_SITE');
  if (input.paymentMode === 'CASH') reasons.push('R8_CASH');
  // R9 is drawn last and only when nothing else already decided: the draw is a fallback sample, and skipping it keeps the random stream
  // from being consumed (and tests from depending on call order) for jobs that are Tier A regardless.
  if (reasons.length === 0 && random() < settings.sampleRate) reasons.push('R9_RANDOM_SAMPLE');
  if (settings.forceTierA) reasons.push('R10_FORCED');

  return { tier: reasons.length > 0 ? 'A' : 'B', reasons };
};
