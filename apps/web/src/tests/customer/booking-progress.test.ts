import { describe, expect, it } from 'vitest';
import { progressSteps } from '@/features/customer/booking-detail-view';

/* Regression (booking journey audit): a CASH job that went straight from
   IN_PROGRESS to completion showed "Waiting on your decision" (QUOTE_REVISION)
   as a step it had passed — a revision that never happened. */
describe('progressSteps', () => {
  it('does not print the quote-revision detour as a passed step', () => {
    expect(progressSteps('CASH', 'VERIFIED')).toEqual(['REQUESTED', 'SCHEDULED', 'EN_ROUTE', 'IN_PROGRESS', 'WORK_COMPLETED', 'AWAITING_VERIFICATION', 'VERIFIED']);
    expect(progressSteps('ONLINE', 'AWAITING_VERIFICATION')).not.toContain('QUOTE_REVISION');
  });

  it('shows the revision while it is the current status', () => {
    expect(progressSteps('ONLINE', 'QUOTE_REVISION').at(-1)).toBe('QUOTE_REVISION');
  });

  it('has no track for a status off the happy path', () => {
    expect(progressSteps('CASH', 'CANCELLED_PROVIDER')).toEqual([]);
  });
});
