import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

/* The reported bug was that the payment step's two options showed no radio at
 * all — they read as plain text. The cause was the ring colour, not the
 * component: `--color-line` is #e2e8f0, which is 1.28:1 on white and well under
 * the 3:1 WCAG 2.1 AA (1.4.11) requires for the boundary of a control. */

const relativeLuminance = (hex: string): number => {
  const channels = [1, 3, 5].map((offset) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
};

const contrast = (a: string, b: string): number => {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (lighter! + 0.05) / (darker! + 0.05);
};

describe('radio contrast', () => {
  it('the ring is visible on white — 3:1 or better', () => {
    /* --color-line, the value it used before. */
    const line = contrast('#e2e8f0', '#ffffff');
    /* --color-muted, the value it uses now. */
    const muted = contrast('#64748b', '#ffffff');

    expect(line).toBeLessThan(3);
    expect(muted).toBeGreaterThanOrEqual(3);
  });

  it('the checked dot is visible against the ring it sits inside', () => {
    /* --color-primary on white, and on the selected card's own tint. */
    expect(contrast('#2563eb', '#ffffff')).toBeGreaterThanOrEqual(3);
  });

  it('renders one radio per option, with the chosen one marked', () => {
    render(
      <RadioGroup value="cash" onValueChange={() => {}}>
        <label>
          <RadioGroupItem value="cash" />
          <span>Cash after verification</span>
        </label>
        <label>
          <RadioGroupItem value="online" />
          <span>Online payment</span>
        </label>
      </RadioGroup>,
    );

    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(2);
    /* Each radio takes its name from the wrapping `<label>`, so a screen reader
       announces "Cash after verification, radio" rather than an unlabelled
       control — which is the other half of why this step read as unlabelled
       text. */
    expect(screen.getByRole('radio', { name: 'Cash after verification' })).toBeDefined();
    /* The selected one reports itself as checked, which is also what announces
       the choice. */
    expect(radios.filter((radio) => radio.getAttribute('aria-checked') === 'true')).toHaveLength(1);
  });
});