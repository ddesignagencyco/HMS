import { describe, expect, it } from 'vitest';
import { checkoutOutcome } from '@/features/booking/checkout-return';

/* The gateway's return leg re-reads the booking and must not call anything a
   success that is not one. ABANDONED and UNFULFILLED are both "past
   PENDING_PAYMENT", and both used to be announced as "Payment confirmed!". */

describe('checkoutOutcome', () => {
  it('is still pending while the booking waits on the gateway', () => {
    expect(checkoutOutcome({ status: 'PENDING_PAYMENT', paymentStatus: 'PENDING' })).toBe('pending');
  });

  it('confirms only a live booking whose money is held', () => {
    expect(checkoutOutcome({ status: 'REQUESTED', paymentStatus: 'HELD' })).toBe('confirmed');
    expect(checkoutOutcome({ status: 'SCHEDULED', paymentStatus: 'HELD' })).toBe('confirmed');
    expect(checkoutOutcome({ status: 'EN_ROUTE', paymentStatus: 'HELD' })).toBe('confirmed');
  });

  it('does not confirm a REQUESTED booking whose payment has not landed', () => {
    expect(checkoutOutcome({ status: 'REQUESTED', paymentStatus: 'PENDING' })).toBe('pending');
  });

  it('reports an abandoned payment as a failure, not a confirmation', () => {
    expect(checkoutOutcome({ status: 'ABANDONED', paymentStatus: 'NONE' })).toBe('abandoned');
  });

  it('reports an unfulfilled booking as a failure even though it was paid', () => {
    expect(checkoutOutcome({ status: 'UNFULFILLED', paymentStatus: 'HELD' })).toBe('unfulfilled');
  });

  it('reports either cancellation as cancelled', () => {
    expect(checkoutOutcome({ status: 'CANCELLED_CUSTOMER', paymentStatus: 'NONE' })).toBe('cancelled');
    expect(checkoutOutcome({ status: 'CANCELLED_PROVIDER', paymentStatus: 'HELD' })).toBe('cancelled');
  });

  it('treats a return during a quote revision as a top-up, not a new dispatch', () => {
    expect(checkoutOutcome({ status: 'QUOTE_REVISION', paymentStatus: 'HELD' })).toBe('topupPending');
    expect(checkoutOutcome({ status: 'IN_PROGRESS', paymentStatus: 'HELD' })).toBe('topupSettled');
  });

  it('says nothing new about a job that has finished', () => {
    expect(checkoutOutcome({ status: 'PAYMENT_RELEASED', paymentStatus: 'RELEASED' })).toBe('movedOn');
    expect(checkoutOutcome({ status: 'NO_SHOW', paymentStatus: 'REFUNDED' })).toBe('movedOn');
  });
});
