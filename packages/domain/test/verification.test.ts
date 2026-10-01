import { describe, expect, it } from 'vitest';
import { allowedOutcomes, bandOf, nextAttemptAt, ratingScoreHundredths, remarkDisplayName, submissionProblems, type Questionnaire } from '../src/verification.js';

// Asia/Karachi is UTC+5 all year: 10:00 local is 05:00Z.
const local = (hour: number, minute = 0, day = 5): Date => new Date(Date.UTC(2026, 9, day, hour - 5, minute));
const hhmm = (date: Date): string => new Date(date.getTime() + 5 * 3_600_000).toISOString().slice(5, 16);

describe('bandOf: SRS §5.5 time bands, in Pakistan time', () => {
  it.each([
    [7, 59, null],
    [8, 0, 'MORNING'],
    [11, 59, 'MORNING'],
    [12, 0, 'AFTERNOON'],
    [16, 59, 'AFTERNOON'],
    [17, 0, 'EVENING'],
    [21, 59, 'EVENING'],
    [22, 0, null]
  ] as const)('%i:%i is %s', (hour, minute, expected) => {
    expect(bandOf(local(hour, minute))).toBe(expected);
  });
});

describe('nextAttemptAt: the next call goes to a band not yet tried', () => {
  it('after a morning attempt, offers the afternoon', () => {
    expect(hhmm(nextAttemptAt(local(9), ['MORNING']))).toBe('10-05T12:00');
  });

  it('after morning and afternoon, offers the evening', () => {
    expect(hhmm(nextAttemptAt(local(13), ['MORNING', 'AFTERNOON']))).toBe('10-05T17:00');
  });

  it('skips a band that is already behind us today', () => {
    expect(hhmm(nextAttemptAt(local(18), ['MORNING']))).toBe('10-06T08:00');
  });

  it('once every band was tried, starts a fresh day at the morning band', () => {
    expect(hhmm(nextAttemptAt(local(20), ['MORNING', 'AFTERNOON', 'EVENING']))).toBe('10-06T08:00');
  });

  it('never returns a time that has already passed', () => {
    const after = local(9, 30);
    expect(nextAttemptAt(after, []).getTime()).toBeGreaterThan(after.getTime());
  });
});

const good: Questionnaire = { workCompleted: 'FULL', extraChargeDemanded: false, consentLineRead: true, consentToRelease: true };

describe('outcome guards (SRS §5.4)', () => {
  it('allows every outcome when the answers are clean', () => {
    expect(allowedOutcomes(good)).toEqual(['VERIFIED_SATISFIED', 'VERIFIED_WITH_ISSUE', 'REWORK_REQUIRED', 'DISPUTED']);
  });

  it('allows only DISPUTED when an extra charge was demanded, or the work was not done', () => {
    expect(allowedOutcomes({ ...good, extraChargeDemanded: true })).toEqual(['DISPUTED']);
    expect(allowedOutcomes({ ...good, workCompleted: 'NONE' })).toEqual(['DISPUTED']);
    expect(allowedOutcomes({ ...good, workCompleted: 'PARTIAL' })).toContain('REWORK_REQUIRED');
  });

  it('reports no problems for a clean satisfied submission', () => {
    expect(submissionProblems(good, 'VERIFIED_SATISFIED')).toEqual([]);
  });

  it('refuses to record anything unless the consent line was read', () => {
    expect(submissionProblems({ ...good, consentLineRead: false }, 'VERIFIED_SATISFIED').map(problem => problem.field)).toEqual(['consentLineRead']);
    expect(submissionProblems({ ...good, consentLineRead: false }, 'DISPUTED').map(problem => problem.field)).toEqual(['consentLineRead']);
  });

  it('refuses a release-permitting outcome without the customer’s consent to release', () => {
    expect(submissionProblems({ ...good, consentToRelease: false }, 'VERIFIED_WITH_ISSUE').map(problem => problem.field)).toEqual(['consentToRelease']);
    expect(submissionProblems({ ...good, consentToRelease: false }, 'DISPUTED')).toEqual([]);
    expect(submissionProblems({ ...good, consentToRelease: false }, 'REWORK_REQUIRED')).toEqual([]);
  });

  it('refuses VERIFIED when an extra charge was demanded', () => {
    expect(submissionProblems({ ...good, extraChargeDemanded: true }, 'VERIFIED_SATISFIED').map(problem => problem.field)).toContain('outcome');
    expect(submissionProblems({ ...good, extraChargeDemanded: true, consentToRelease: false }, 'DISPUTED')).toEqual([]);
  });
});

describe('rating and remark helpers', () => {
  it('the published score is the mean of the four criteria, in hundredths', () => {
    expect(ratingScoreHundredths(5, 5, 5, 5)).toBe(500);
    expect(ratingScoreHundredths(5, 4, 4, 4)).toBe(425);
    expect(ratingScoreHundredths(1, 2, 3, 4)).toBe(250);
    expect(ratingScoreHundredths(5, 5, 5, 4)).toBe(475);
  });

  it('shows only the first name and last initial next to a remark', () => {
    expect(remarkDisplayName('Ayesha', 'Khan')).toBe('Ayesha K.');
    expect(remarkDisplayName('  Bilal ', ' ahmed')).toBe('Bilal A.');
    expect(remarkDisplayName('Sana', '')).toBe('Sana');
  });
});
