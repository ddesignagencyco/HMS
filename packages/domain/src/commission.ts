export type CommissionScope = 'GLOBAL' | 'CATEGORY' | 'PROVIDER';

/** One commission rule, already filtered to the ones in force at the moment asked. Dates are accepted as either form so callers can pass a row straight from a query. */
export type CommissionRuleView = {
  scope: CommissionScope;
  categoryId: number | null;
  providerId: string | null;
  rateBp: number;
  effectiveFrom: Date | string;
};

export type CommissionTarget = { providerId: string | null; categoryId: number | null };

/** Most specific first: a provider's own deal beats a category rate, which beats the platform default. */
const SCOPE_RANK: Record<CommissionScope, number> = { PROVIDER: 0, CATEGORY: 1, GLOBAL: 2 };

const appliesTo = (rule: CommissionRuleView, target: CommissionTarget): boolean => {
  if (rule.scope === 'PROVIDER') return target.providerId !== null && rule.providerId === target.providerId;
  if (rule.scope === 'CATEGORY') return target.categoryId !== null && rule.categoryId === target.categoryId;
  return true;
};

const asTime = (value: Date | string): number => (value instanceof Date ? value.getTime() : Date.parse(value));

/**
 * SRS §5 / FR-CAT-08. Picks the single commission rule that applies to a booking, from
 * every rule in force at that moment. Precedence is provider > category > global; within
 * one scope the most recently effective rule wins, so re-cutting a rate replaces the old
 * one without the caller having to close it first. Returns the winning rule (not just its
 * rate) so a caller can explain which rule set the number; null when nothing applies.
 *
 * Pure — the caller supplies the rules already filtered to their effective window, so this
 * has no clock and no database of its own and is testable in isolation.
 */
export const selectCommissionRule = <T extends CommissionRuleView>(rules: readonly T[], target: CommissionTarget): T | null => {
  let winner: T | null = null;
  for (const rule of rules) {
    if (!appliesTo(rule, target)) continue;
    if (winner === null) {
      winner = rule;
      continue;
    }
    const byScope = SCOPE_RANK[rule.scope] - SCOPE_RANK[winner.scope];
    if (byScope < 0) {
      winner = rule;
      continue;
    }
    if (byScope === 0 && asTime(rule.effectiveFrom) > asTime(winner.effectiveFrom)) winner = rule;
  }
  return winner;
};

export const resolveCommissionRateBp = (rules: readonly CommissionRuleView[], target: CommissionTarget): number | null =>
  selectCommissionRule(rules, target)?.rateBp ?? null;
