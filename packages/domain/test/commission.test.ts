import { describe, expect, it } from 'vitest';
import { resolveCommissionRateBp, selectCommissionRule, type CommissionRuleView, type CommissionScope } from '../src/commission.js';

const rule = (scope: CommissionScope, rateBp: number, extra: Partial<CommissionRuleView> = {}): CommissionRuleView => ({
  scope,
  categoryId: null,
  providerId: null,
  rateBp,
  effectiveFrom: new Date('2026-01-01T00:00:00Z'),
  ...extra
});

const PROVIDER = '11111111-1111-1111-1111-111111111111';
const OTHER_PROVIDER = '22222222-2222-2222-2222-222222222222';

describe('FR-CAT-08: commission rule resolution order', () => {
  it('prefers a provider rate over a category rate over the global default', () => {
    const rules = [rule('GLOBAL', 1_000), rule('CATEGORY', 1_500, { categoryId: 7 }), rule('PROVIDER', 2_000, { providerId: PROVIDER, categoryId: 7 })];
    expect(resolveCommissionRateBp(rules, { providerId: PROVIDER, categoryId: 7 })).toBe(2_000);
  });

  it('falls back to the category rate when the provider has no rate of its own', () => {
    const rules = [rule('GLOBAL', 1_000), rule('CATEGORY', 1_500, { categoryId: 7 }), rule('PROVIDER', 2_000, { providerId: OTHER_PROVIDER })];
    expect(resolveCommissionRateBp(rules, { providerId: PROVIDER, categoryId: 7 })).toBe(1_500);
  });

  it('falls back to the global default when neither the provider nor the category has a rate', () => {
    const rules = [rule('GLOBAL', 1_000), rule('CATEGORY', 1_500, { categoryId: 7 }), rule('PROVIDER', 2_000, { providerId: OTHER_PROVIDER })];
    expect(resolveCommissionRateBp(rules, { providerId: PROVIDER, categoryId: 99 })).toBe(1_000);
  });

  it('ignores provider rules when there is no provider on the booking', () => {
    const rules = [rule('GLOBAL', 1_000), rule('PROVIDER', 2_000, { providerId: PROVIDER })];
    expect(resolveCommissionRateBp(rules, { providerId: null, categoryId: 7 })).toBe(1_000);
  });

  it('ignores a category rule that names a different category', () => {
    const rules = [rule('GLOBAL', 1_000), rule('CATEGORY', 1_500, { categoryId: 8 })];
    expect(resolveCommissionRateBp(rules, { providerId: null, categoryId: 7 })).toBe(1_000);
  });

  it('within one scope the most recently effective rule wins, regardless of input order', () => {
    const older = rule('CATEGORY', 1_200, { categoryId: 7, effectiveFrom: new Date('2026-01-01T00:00:00Z') });
    const newer = rule('CATEGORY', 1_800, { categoryId: 7, effectiveFrom: new Date('2026-06-01T00:00:00Z') });
    expect(resolveCommissionRateBp([older, newer], { providerId: null, categoryId: 7 })).toBe(1_800);
    expect(resolveCommissionRateBp([newer, older], { providerId: null, categoryId: 7 })).toBe(1_800);
  });

  it('returns the winning rule itself, not just its rate, so the choice can be explained', () => {
    const winner = rule('PROVIDER', 2_000, { providerId: PROVIDER });
    expect(selectCommissionRule([rule('GLOBAL', 1_000), winner], { providerId: PROVIDER, categoryId: 7 })).toBe(winner);
  });

  it('returns null when no rule applies at all', () => {
    expect(selectCommissionRule([rule('CATEGORY', 1_500, { categoryId: 8 })], { providerId: null, categoryId: 7 })).toBeNull();
    expect(resolveCommissionRateBp([], { providerId: PROVIDER, categoryId: 7 })).toBeNull();
  });

  it('accepts effectiveFrom as an ISO string as well as a Date', () => {
    const rules = [rule('GLOBAL', 1_000), { ...rule('CATEGORY', 1_900, { categoryId: 7 }), effectiveFrom: '2026-06-01T00:00:00Z' }];
    expect(resolveCommissionRateBp(rules, { providerId: null, categoryId: 7 })).toBe(1_900);
  });
});
