import { describe, expect, it } from 'vitest';
import { MAX_COMPLETED_JOBS, MAX_EXPERIENCE_YEARS, parseWholeMinimum, rupeesToPaisa } from '@/features/discovery/search-refinements';
import { resolveProviderName } from '@/features/providers/names';

/* `providerSearchQuerySchema` is `.strict()`: price is `.int().positive()`,
   experience `.int().min(0).max(60)`, jobs `.int().min(0).max(10_000)`. Each
   box must only ever produce a value the schema accepts, or nothing. */
describe('search refinement parsing', () => {
  it('treats an empty or zero price as no filter and converts rupees to whole paisa', () => {
    expect(rupeesToPaisa('')).toBeNull();
    expect(rupeesToPaisa('0')).toBeNull();
    expect(rupeesToPaisa('0.001')).toBeNull();
    expect(rupeesToPaisa('-5')).toBeNull();
    expect(rupeesToPaisa('abc')).toBeNull();
    expect(rupeesToPaisa('500')).toBe(50_000);
    expect(rupeesToPaisa('12.345')).toBe(1_235);
  });

  it('sends whole numbers only, clamped to the schema maximum', () => {
    expect(parseWholeMinimum('', MAX_EXPERIENCE_YEARS)).toBeNull();
    expect(parseWholeMinimum('0', MAX_EXPERIENCE_YEARS)).toBeNull();
    expect(parseWholeMinimum('-3', MAX_EXPERIENCE_YEARS)).toBeNull();
    expect(parseWholeMinimum('2.7', MAX_EXPERIENCE_YEARS)).toBe(2);
    expect(parseWholeMinimum('0.5', MAX_EXPERIENCE_YEARS)).toBeNull();
    expect(parseWholeMinimum('99', MAX_EXPERIENCE_YEARS)).toBe(60);
    expect(parseWholeMinimum('250000', MAX_COMPLETED_JOBS)).toBe(10_000);
    expect(parseWholeMinimum('40', MAX_COMPLETED_JOBS)).toBe(40);
  });
});

/* The search API publishes no provider name on purpose. The label is the
   qualification or the generic fallback — never a name made up from the id. */
describe('resolveProviderName', () => {
  it('returns the qualification, not a fabricated person', () => {
    const label = resolveProviderName('00000000-0000-4000-8000-000000000098', 'Licensed plumber');
    expect(label.fullName).toBe('Licensed plumber');
    expect(label.initial).toBe('L');
    expect(label.fullName).not.toMatch(/Tariq|Malik/);
  });

  it('falls back to the generic label when there is no qualification', () => {
    expect(resolveProviderName('any-id', 'Professional').fullName).toBe('Professional');
    expect(resolveProviderName('any-id', '').fullName).toBe('Professional');
    expect(resolveProviderName(null, undefined).initial).toBe('P');
  });
});
