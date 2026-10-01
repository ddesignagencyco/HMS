import { describe, expect, it } from 'vitest';
import { canMoveComplaint, compareComplaintPriority, isComplaintFinal, severityFor } from '../src/complaints.js';
import { consequenceOf, crossedThresholds, fineFor, harsher, scheduleConsequence, suspensionDays } from '../src/conduct.js';

describe('FR-CP-03: complaint states', () => {
  it('allows only the documented moves', () => {
    expect(canMoveComplaint('OPEN', 'UNDER_REVIEW')).toBe(true);
    expect(canMoveComplaint('OPEN', 'RESOLVED')).toBe(false);
    expect(canMoveComplaint('UNDER_REVIEW', 'AWAITING_RESPONSE')).toBe(true);
    expect(canMoveComplaint('AWAITING_RESPONSE', 'UNDER_REVIEW')).toBe(true);
    expect(canMoveComplaint('AWAITING_RESPONSE', 'OPEN')).toBe(false);
  });
  it('RESOLVED and REJECTED are final', () => {
    for (const status of ['RESOLVED', 'REJECTED'] as const) {
      expect(isComplaintFinal(status)).toBe(true);
      for (const to of ['OPEN', 'UNDER_REVIEW', 'AWAITING_RESPONSE', 'RESOLVED', 'REJECTED'] as const) expect(canMoveComplaint(status, to)).toBe(false);
    }
  });
});

describe('FR-CP-08: severity and queue order', () => {
  it.each([
    ['SAFETY', 'SAFETY'],
    ['UNSAFE_PREMISES', 'SAFETY'],
    ['ABUSE', 'HIGH'],
    ['OVERCHARGE', 'HIGH'],
    ['QUALITY', 'NORMAL'],
    ['OTHER', 'NORMAL']
  ] as const)('%s is %s', (category, severity) => expect(severityFor(category)).toBe(severity));

  it('safety complaints sort first however old the others are', () => {
    const soon = new Date('2026-01-01');
    const later = new Date('2026-02-01');
    const queue = [
      { id: 'normal-old', severity: 'NORMAL' as const, slaDueAt: soon },
      { id: 'safety-new', severity: 'SAFETY' as const, slaDueAt: later },
      { id: 'high', severity: 'HIGH' as const, slaDueAt: soon }
    ].sort(compareComplaintPriority);
    expect(queue.map(item => item.id)).toEqual(['safety-new', 'high', 'normal-old']);
  });
});

describe('CL-14 / CL-16: thresholds and the harsher consequence', () => {
  it('fires a threshold only on an upward crossing', () => {
    expect(crossedThresholds(0, 9)).toEqual([]);
    expect(crossedThresholds(9, 10).map(t => t.points)).toEqual([10]);
    expect(crossedThresholds(10, 14)).toEqual([]);
    expect(crossedThresholds(8, 32).map(t => t.points)).toEqual([10, 20, 30]);
    expect(crossedThresholds(60, 70)).toEqual([]);
  });

  it('falling below and climbing back fires again', () => {
    expect(crossedThresholds(8, 12).map(t => t.points)).toEqual([10]);
    expect(crossedThresholds(12, 9)).toEqual([]);
    expect(crossedThresholds(9, 11).map(t => t.points)).toEqual([10]);
  });

  it('the harsher of two consequences wins, in either order', () => {
    expect(harsher('SUSPENSION_7D', 'WARNING')).toBe('SUSPENSION_7D');
    expect(harsher('WARNING', 'SUSPENSION_7D')).toBe('SUSPENSION_7D');
    expect(harsher('SUSPENSION_30D', 'SUSPENSION_30D_REVERIFY')).toBe('SUSPENSION_30D_REVERIFY');
    expect(harsher('PERMANENT_BLOCK', 'SUSPENSION_30D_REVERIFY')).toBe('PERMANENT_BLOCK');
    expect(harsher('NONE', 'NONE')).toBe('NONE');
  });

  it('a breach’s own consequence and a crossed threshold merge to the harsher', () => {
    const crossed = crossedThresholds(5, 12);
    expect(consequenceOf({ category: 'RELIABILITY', points: 8, schedule: 'SUSPENSION_30D', crossed })).toBe('SUSPENSION_30D');
    expect(consequenceOf({ category: 'RELIABILITY', points: 8, schedule: null, crossed })).toBe('WARNING');
    expect(consequenceOf({ category: 'RELIABILITY', points: 1, schedule: null, crossed: [] })).toBe('NONE');
  });

  it('a single INTEGRITY breach of 25 points or more is a permanent block, whatever the total', () => {
    expect(consequenceOf({ category: 'INTEGRITY', points: 25, schedule: null, crossed: crossedThresholds(0, 25) })).toBe('PERMANENT_BLOCK');
    expect(consequenceOf({ category: 'INTEGRITY', points: 24, schedule: 'SUSPENSION_30D', crossed: [] })).toBe('SUSPENSION_30D');
    expect(consequenceOf({ category: 'SAFETY', points: 25, schedule: 'SUSPENSION_14D', crossed: [] })).toBe('SUSPENSION_14D');
  });

  it('knows suspension lengths, and ignores unknown schedule words', () => {
    expect(suspensionDays('SUSPENSION_7D')).toBe(7);
    expect(suspensionDays('SUSPENSION_30D_REVERIFY')).toBe(30);
    expect(suspensionDays('WARNING')).toBeNull();
    expect(scheduleConsequence('SUSPENSION_14D')).toBe('SUSPENSION_14D');
    expect(scheduleConsequence('SOMETHING_ELSE')).toBe('NONE');
    expect(scheduleConsequence(null)).toBe('NONE');
  });
});

describe('FR-PN-05: fines and the per-job liability cap', () => {
  const context = { excessPaisa: 300_000n, maxFinePaisa: 1_000_000n, jobValuePaisa: 400_000n };
  it('computes each rule', () => {
    expect(fineFor({ type: 'none' }, context)).toBe(0n);
    expect(fineFor({ type: 'fixed', amountPaisa: 50_000 }, context)).toBe(50_000n);
    expect(fineFor({ type: 'multiple_of_excess', factor: 2 }, context)).toBe(600_000n);
    expect(fineFor({ type: 'multiple_of_excess', factor: 1.5 }, context)).toBe(450_000n);
    expect(fineFor({ type: 'max_fine' }, context)).toBe(1_000_000n);
  });
  it('an excess-based fine with nothing to base it on is zero, not a guess', () => {
    expect(fineFor({ type: 'multiple_of_excess', factor: 2 }, { ...context, excessPaisa: 0n })).toBe(0n);
  });
  it('truncates to the job value plus the maximum fine', () => {
    expect(fineFor({ type: 'multiple_of_excess', factor: 10 }, { excessPaisa: 5_000_000n, maxFinePaisa: 1_000_000n, jobValuePaisa: 400_000n })).toBe(1_400_000n);
    expect(fineFor({ type: 'fixed', amountPaisa: 9_999_999 }, { excessPaisa: 0n, maxFinePaisa: 100n, jobValuePaisa: 50n })).toBe(150n);
  });
});
