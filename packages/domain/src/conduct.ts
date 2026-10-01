/**
 * SRS §8: the conduct framework as pure functions. Penalties carry demerit points; the active total crosses thresholds that carry
 * consequences; a breach type can carry its own consequence too; and where more than one applies, the harsher wins (CL-14).
 */
export type Consequence = 'NONE' | 'REVIEW' | 'WARNING' | 'DEMOTION_30D' | 'SUSPENSION_7D' | 'SUSPENSION_14D' | 'SUSPENSION_30D' | 'SUSPENSION_30D_REVERIFY' | 'PERMANENT_BLOCK';

/** Mildest to harshest. */
const SEVERITY: readonly Consequence[] = ['NONE', 'REVIEW', 'WARNING', 'DEMOTION_30D', 'SUSPENSION_7D', 'SUSPENSION_14D', 'SUSPENSION_30D', 'SUSPENSION_30D_REVERIFY', 'PERMANENT_BLOCK'];

export const severityOf = (consequence: Consequence): number => SEVERITY.indexOf(consequence);

/** CL-14 / FR-PN-10: the harsher of two consequences. */
export const harsher = (left: Consequence, right: Consequence): Consequence => (severityOf(right) > severityOf(left) ? right : left);

/** §8.3: active points → consequence. 10 warning · 20 demotion · 30 seven-day suspension · 45 thirty-day suspension with re-verification · 60 permanent block. */
export const THRESHOLDS: readonly { points: number; consequence: Consequence }[] = [
  { points: 10, consequence: 'WARNING' },
  { points: 20, consequence: 'DEMOTION_30D' },
  { points: 30, consequence: 'SUSPENSION_7D' },
  { points: 45, consequence: 'SUSPENSION_30D_REVERIFY' },
  { points: 60, consequence: 'PERMANENT_BLOCK' }
];

/**
 * CL-16: a consequence fires once per *upward* crossing. These are the thresholds that `after` has reached and `before` had not — so
 * two penalties that both leave a provider above 10 points fire the warning once, and falling below and climbing back fires it again.
 */
export const crossedThresholds = (before: number, after: number): readonly { points: number; consequence: Consequence }[] => THRESHOLDS.filter(threshold => before < threshold.points && after >= threshold.points);

/** The breach type's own consequence, as written in the schedule ('SUSPENSION_30D', 'PERMANENT_BLOCK', 'REVIEW', or nothing). */
export const scheduleConsequence = (value: string | null): Consequence => (value !== null && SEVERITY.includes(value as Consequence) ? (value as Consequence) : 'NONE');

/** CL-14: a single INTEGRITY breach of 25 points or more is a permanent block, whatever the running total says. */
export const INTEGRITY_BLOCK_POINTS = 25;

export const consequenceOf = (input: { category: string; points: number; schedule: string | null; crossed: readonly { consequence: Consequence }[] }): Consequence => {
  let result: Consequence = scheduleConsequence(input.schedule);
  for (const threshold of input.crossed) result = harsher(result, threshold.consequence);
  if (input.category === 'INTEGRITY' && input.points >= INTEGRITY_BLOCK_POINTS) result = harsher(result, 'PERMANENT_BLOCK');
  return result;
};

/** How long a suspension lasts, in days; null for a consequence that is not a suspension. */
export const suspensionDays = (consequence: Consequence): number | null => {
  switch (consequence) {
    case 'SUSPENSION_7D':
      return 7;
    case 'SUSPENSION_14D':
      return 14;
    case 'SUSPENSION_30D':
    case 'SUSPENSION_30D_REVERIFY':
      return 30;
    default:
      return null;
  }
};

export type Fine = { type: 'none' } | { type: 'fixed'; amountPaisa: number } | { type: 'multiple_of_excess'; factor: number } | { type: 'max_fine' };

/**
 * FR-PN-05: the fine for a breach, then capped so total liability for the job never exceeds the job's value plus the configured maximum
 * fine. `excessPaisa` is the amount involved for excess-based fines (the overcharge, the rework cost); without it such a fine is zero rather than a guess.
 */
export const fineFor = (rule: Fine, context: { excessPaisa: bigint; maxFinePaisa: bigint; jobValuePaisa: bigint }): bigint => {
  let fine: bigint;
  switch (rule.type) {
    case 'fixed':
      fine = BigInt(rule.amountPaisa);
      break;
    case 'multiple_of_excess':
      fine = context.excessPaisa * BigInt(Math.round(rule.factor * 100)) / 100n;
      break;
    case 'max_fine':
      fine = context.maxFinePaisa;
      break;
    default:
      fine = 0n;
  }
  const cap = context.jobValuePaisa + context.maxFinePaisa;
  return fine > cap ? cap : fine;
};
