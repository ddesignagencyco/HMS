import { describe, expect, it } from 'vitest';
import { badgeFor, weightedScoreHundredths } from '../src/reputation/reputation.service.js';

describe('CL-17: the published score', () => {
  const prior = 3.5;
  const priorWeight = 5;
  const recentWeight = 2;

  it('a provider with no ratings sits exactly on the neutral prior', () => {
    expect(weightedScoreHundredths([], prior, priorWeight, recentWeight)).toBe(350);
  });

  it('two five-star ratings do not make someone a 5.0: the prior holds them back', () => {
    const score = weightedScoreHundredths([500, 500], prior, priorWeight, recentWeight);
    expect(score).toBeLessThan(500);
    expect(score).toBeGreaterThan(350);
    expect(score).toBe(Math.round((350 * 5 + 500 * 2 + 500 * 2) / (5 + 2 + 2)));
  });

  it('many high ratings outweigh the prior, so a proven 4.8 beats an unproven 5.0', () => {
    const proven = weightedScoreHundredths(Array.from({ length: 200 }, () => 480), prior, priorWeight, recentWeight);
    const unproven = weightedScoreHundredths([500, 500], prior, priorWeight, recentWeight);
    expect(proven).toBeGreaterThan(unproven);
    expect(proven).toBeGreaterThan(470);
  });

  it('the most recent 20 ratings count more than older ones', () => {
    const improving = weightedScoreHundredths([...Array.from({ length: 20 }, () => 500), ...Array.from({ length: 20 }, () => 100)], prior, priorWeight, recentWeight);
    const declining = weightedScoreHundredths([...Array.from({ length: 20 }, () => 100), ...Array.from({ length: 20 }, () => 500)], prior, priorWeight, recentWeight);
    expect(improving).toBeGreaterThan(declining);
  });

  it('with no recency boost it is the plain prior-weighted mean', () => {
    expect(weightedScoreHundredths([400, 300], prior, priorWeight, 1)).toBe(Math.round((350 * 5 + 400 + 300) / 7));
  });
});

describe('badges come from verified jobs only', () => {
  it.each([
    [0, null],
    [9, null],
    [10, 'TRUSTED'],
    [49, 'TRUSTED'],
    [50, 'PRO'],
    [199, 'PRO'],
    [200, 'ELITE']
  ] as const)('%i verified jobs → %s', (jobs, badge) => {
    expect(badgeFor(jobs)).toBe(badge);
  });
});
