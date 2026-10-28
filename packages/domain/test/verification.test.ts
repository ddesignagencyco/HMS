import { describe, expect, it } from 'vitest';
import { allowedOutcomes, bandOf, nextAttemptAt, ratingScoreHundredths, remarkDisplayName, selfVerifyDecision, selfVerifyProblems, submissionProblems, type Questionnaire } from '../src/verification.js';

// Asia/Karachi is UTC+5 all year: 10:00 local is 05:00Z.
const local = (hour: number, minute = 0, day = 5): Date => new Date(Date.UTC(2026, 9, day, hour - 5, minute));
const hhmm = (date: Date): string => new Date(date.getTime() + 5 * 3_600_000).toISOString().slice(5, 16);

describe('bandOf: SRS Â§5.5 time bands, in Pakistan time', () => {
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

describe('outcome guards (SRS Â§5.4)', () => {
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

  it('refuses a release-permitting outcome without the customerâ€™s consent to release', () => {
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

describe('FR-VC-16: the customer confirms the job themselves', () => {
  const clean = { workCompleted: 'FULL', extraChargeDemanded: false, consentToRelease: true } as const;

  it('"everything was fine" releases and publishes a rating', () => {
    expect(selfVerifyDecision(clean, 'SATISFIED')).toEqual({ kind: 'release', outcome: 'LINK_CONFIRMED', withIssue: false, publishesRating: true });
  });

  it('"done, but there was a problem" still releases â€” the customerâ€™s money is theirs â€” and flags the quality', () => {
    expect(selfVerifyDecision(clean, 'WITH_ISSUE')).toEqual({ kind: 'release', outcome: 'LINK_CONFIRMED', withIssue: true, publishesRating: true });
  });

  it('"not acceptable" releases nothing and escalates to a person', () => {
    expect(selfVerifyDecision(clean, 'NOT_ACCEPTABLE')).toEqual({ kind: 'escalate', reason: 'CUSTOMER_CHOICE' });
  });

  it('no work done escalates on integrity grounds whatever else was chosen', () => {
    for (const choice of ['SATISFIED', 'WITH_ISSUE', 'NOT_ACCEPTABLE'] as const) {
      expect(selfVerifyDecision({ ...clean, workCompleted: 'NONE' }, choice)).toEqual({ kind: 'escalate', reason: 'INTEGRITY' });
    }
  });

  it('an extra charge demanded escalates on integrity grounds whatever else was chosen', () => {
    for (const choice of ['SATISFIED', 'WITH_ISSUE', 'NOT_ACCEPTABLE'] as const) {
      expect(selfVerifyDecision({ ...clean, extraChargeDemanded: true }, choice)).toEqual({ kind: 'escalate', reason: 'INTEGRITY' });
    }
  });

  it('a partial job can still be confirmed â€” that is the customerâ€™s call to make, not ours', () => {
    expect(selfVerifyDecision({ ...clean, workCompleted: 'PARTIAL' }, 'SATISFIED').kind).toBe('release');
  });

  it('a release is refused without an explicit agreement to release', () => {
    expect(selfVerifyProblems({ ...clean, consentToRelease: false }, 'SATISFIED').map(problem => problem.field)).toEqual(['consentToRelease']);
    expect(selfVerifyProblems({ ...clean, consentToRelease: false }, 'WITH_ISSUE').map(problem => problem.field)).toEqual(['consentToRelease']);
    // Nothing is released, so nothing needs consent â€” the same rule the agent submission follows.
    expect(selfVerifyProblems({ ...clean, consentToRelease: false }, 'NOT_ACCEPTABLE')).toEqual([]);
  });

  it('says all fine alongside "no work was done" is a contradiction, not a release', () => {
    expect(selfVerifyProblems({ ...clean, workCompleted: 'NONE' }, 'SATISFIED').map(problem => problem.field)).toEqual(['workCompleted']);
    expect(selfVerifyProblems({ ...clean, extraChargeDemanded: true }, 'WITH_ISSUE').map(problem => problem.field)).toEqual(['extraChargeDemanded']);
    // Answering "not acceptable" alongside either of those is not a contradiction â€” it is the honest form.
    expect(selfVerifyProblems({ ...clean, workCompleted: 'NONE' }, 'NOT_ACCEPTABLE')).toEqual([]);
  });

  it('reports nothing wrong with a clean, consenting submission', () => {
    expect(selfVerifyProblems(clean, 'SATISFIED')).toEqual([]);
    expect(selfVerifyProblems(clean, 'WITH_ISSUE')).toEqual([]);
  });
});
