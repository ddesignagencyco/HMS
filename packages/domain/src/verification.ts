import { instantFromWallTime, wallTimeIn } from './slaCalendar.js';

export type TimeBand = 'MORNING' | 'AFTERNOON' | 'EVENING';
export type WorkCompletion = 'FULL' | 'PARTIAL' | 'NONE';
export type AgentOutcome = 'VERIFIED_SATISFIED' | 'VERIFIED_WITH_ISSUE' | 'REWORK_REQUIRED' | 'DISPUTED';

/** SRS Â§5.5: the three calling bands, in Pakistan time â€” 08â€“12, 12â€“17, 17â€“22. */
export const TIME_BANDS: readonly { band: TimeBand; startHour: number; endHour: number }[] = [
  { band: 'MORNING', startHour: 8, endHour: 12 },
  { band: 'AFTERNOON', startHour: 12, endHour: 17 },
  { band: 'EVENING', startHour: 17, endHour: 22 }
];

/** The band an instant falls in, or null outside calling hours (before 08:00 or from 22:00). */
export const bandOf = (instant: Date): TimeBand | null => {
  const wall = wallTimeIn(instant);
  const minutes = wall.hour * 60 + wall.minute;
  return TIME_BANDS.find(entry => minutes >= entry.startHour * 60 && minutes < entry.endHour * 60)?.band ?? null;
};

/**
 * When the next call attempt may be made: the start of the earliest band this verification has not been tried in yet, that
 * is still ahead of `after`. Once every band has been tried, a fresh day starts over at the morning band. This is what makes
 * attempts 2 and 3 land in a different band from attempt 1 â€” the queue simply does not offer the call again sooner.
 */
export const nextAttemptAt = (after: Date, triedBands: readonly TimeBand[]): Date => {
  const wall = wallTimeIn(after);
  for (let dayOffset = 0; dayOffset < 3; dayOffset += 1) {
    const day = new Date(Date.UTC(wall.year, wall.month - 1, wall.day + dayOffset));
    const candidates = TIME_BANDS.filter(entry => dayOffset > 0 || !triedBands.includes(entry.band));
    for (const entry of candidates) {
      const start = instantFromWallTime({ year: day.getUTCFullYear(), month: day.getUTCMonth() + 1, day: day.getUTCDate(), hour: entry.startHour, minute: 0 });
      if (start.getTime() > after.getTime()) return start;
    }
  }
  return new Date(after.getTime() + 24 * 3_600_000);
};

export type Questionnaire = {
  workCompleted: WorkCompletion;
  extraChargeDemanded: boolean;
  consentLineRead: boolean;
  consentToRelease: boolean;
};

/**
 * SRS Â§5.4: if the customer says an amount was demanded beyond the approved price, or that the work was not done at all,
 * the only outcome an agent may record is DISPUTED. Money cannot be released on an answer that says the provider overcharged
 * or did nothing, whatever the rest of the call sounded like.
 */
export const allowedOutcomes = (answers: Pick<Questionnaire, 'workCompleted' | 'extraChargeDemanded'>): readonly AgentOutcome[] =>
  answers.extraChargeDemanded || answers.workCompleted === 'NONE' ? ['DISPUTED'] : ['VERIFIED_SATISFIED', 'VERIFIED_WITH_ISSUE', 'REWORK_REQUIRED', 'DISPUTED'];

export type SubmissionProblem = { field: string; message: string };

/**
 * Everything wrong with a submission that does not need the database to know. The consent line must have been read before
 * anything is recorded (recording law, NFR-PR-02); a release-permitting outcome needs the customer's spoken consent to release;
 * and the outcome must be one the answers allow.
 */
export const submissionProblems = (answers: Questionnaire, outcome: AgentOutcome): SubmissionProblem[] => {
  const problems: SubmissionProblem[] = [];
  if (!answers.consentLineRead) problems.push({ field: 'consentLineRead', message: 'The recording consent line must be read to the customer before the call is recorded' });
  if (!allowedOutcomes(answers).includes(outcome)) {
    problems.push({ field: 'outcome', message: `With these answers the only allowed outcome is ${allowedOutcomes(answers).join(' or ')}` });
  }
  if ((outcome === 'VERIFIED_SATISFIED' || outcome === 'VERIFIED_WITH_ISSUE') && !answers.consentToRelease) {
    problems.push({ field: 'consentToRelease', message: 'Payment cannot be released without the customerâ€™s verbal consent' });
  }
  return problems;
};

/** Published rating = the mean of the four criteria (SRS Â§5.3), kept as hundredths so it never passes through a float. */
export const ratingScoreHundredths = (quality: number, punctuality: number, conduct: number, cleanliness: number): number =>
  Math.round(((quality + punctuality + conduct + cleanliness) * 100) / 4);

/** "Ayesha Khan" â†’ "Ayesha K."; a single name stays as it is. Only this, never the full name, is shown next to a remark (FR-RT-06). */
export const remarkDisplayName = (firstName: string, lastName: string): string => {
  const first = firstName.trim();
  const initial = lastName.trim().charAt(0).toUpperCase();
  return initial === '' ? first : `${first} ${initial}.`;
};

/**
 * What the customer chose on the in-app form (FR-VC-16). Deliberately not `AgentOutcome`: the customer is
 * not an agent, and the four agent outcomes do not describe what a customer is being asked. There is no
 * "dispute" button because raising a dispute is a separate, deliberate act with its own route â€” the
 * `NOT_ACCEPTABLE` button already stops the money, and stops it faster.
 */
export type SelfVerifyChoice = 'SATISFIED' | 'WITH_ISSUE' | 'NOT_ACCEPTABLE';

export type SelfVerifyAnswers = Pick<Questionnaire, 'workCompleted' | 'extraChargeDemanded' | 'consentToRelease'>;

export type SelfVerifyDecision =
  | { kind: 'release'; outcome: 'LINK_CONFIRMED'; withIssue: boolean; publishesRating: true }
  | { kind: 'escalate'; reason: 'INTEGRITY' | 'CUSTOMER_CHOICE' };

/**
 * FR-VC-16: what the customer's own form decides, as one pure function.
 *
 * The customer is the party paying, so letting them say "the work was fine, here's my rating" is not
 * the same risk as letting a provider say it â€” this cannot release money the customer did not already
 * have held for it. That is what makes a self-serve path safe to leave open from the moment the job
 * completes: the thing it removes from the critical path is a phone call, not a control.
 *
 * What it does not become is a way around the integrity guard. If the customer says no work was done,
 * or that money was demanded beyond the agreed price, the only outcome is a dispute, whatever else
 * they picked â€” the same rule `allowedOutcomes` applies to an agent's answers, and the same one
 * `verification_calls`' own CHECK enforces underneath.
 *
 * Release-permitting answers still need `consentToRelease`: the customer's explicit "yes, release my
 * money" is the consent, and it is recorded on the verification row exactly as a spoken one is.
 */
export const selfVerifyDecision = (answers: SelfVerifyAnswers, choice: SelfVerifyChoice): SelfVerifyDecision => {
  if (answers.extraChargeDemanded || answers.workCompleted === 'NONE') return { kind: 'escalate', reason: 'INTEGRITY' };
  if (choice === 'NOT_ACCEPTABLE') return { kind: 'escalate', reason: 'CUSTOMER_CHOICE' };
  return { kind: 'release', outcome: 'LINK_CONFIRMED', withIssue: choice === 'WITH_ISSUE', publishesRating: true };
};

/**
 * Everything wrong with a self-verification that does not need the database to know â€” the same shape as
 * `submissionProblems`, and the same reason it exists: a release must never be the result of a form
 * that quietly omitted the question which authorised it.
 */
export const selfVerifyProblems = (answers: SelfVerifyAnswers, choice: SelfVerifyChoice): SubmissionProblem[] => {
  const problems: SubmissionProblem[] = [];
  const decision = selfVerifyDecision(answers, choice);
  if (decision.kind === 'release' && !answers.consentToRelease) {
    problems.push({ field: 'consentToRelease', message: 'Payment cannot be released without your agreement to release it' });
  }
  if (answers.workCompleted === 'NONE' && choice !== 'NOT_ACCEPTABLE') {
    problems.push({ field: 'workCompleted', message: 'If no work was done, this must be raised as a problem rather than confirmed' });
  }
  if (answers.extraChargeDemanded && choice !== 'NOT_ACCEPTABLE') {
    problems.push({ field: 'extraChargeDemanded', message: 'If money was demanded beyond the agreed price, this must be raised as a problem' });
  }
  return problems;
};
