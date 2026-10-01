import { describe, expect, it } from 'vitest';
import { canTransition, transitionFor } from '../src/bookingTransitions.js';

describe('booking transitions', () => {
  it('lets a provider accept a REQUESTED booking, landing on SCHEDULED', () => {
    const transition = canTransition('REQUESTED', 'accept', 'PROVIDER');
    expect(transition).toEqual({ to: 'SCHEDULED', allowedRoles: ['PROVIDER'] });
  });

  it('refuses a customer accepting their own booking', () => {
    expect(canTransition('REQUESTED', 'accept', 'CUSTOMER')).toBeNull();
  });

  it('refuses accept from a status that has no such transition', () => {
    expect(canTransition('SCHEDULED', 'accept', 'PROVIDER')).toBeNull();
  });

  it('lets either party cancel a SCHEDULED booking', () => {
    expect(canTransition('SCHEDULED', 'cancel', 'CUSTOMER')).not.toBeNull();
    expect(canTransition('SCHEDULED', 'cancel', 'PROVIDER')).not.toBeNull();
  });

  it('transitionFor is role-blind: it returns the transition even for a role that cannot fire it', () => {
    expect(transitionFor('REQUESTED', 'accept')).toEqual({ to: 'SCHEDULED', allowedRoles: ['PROVIDER'] });
  });

  it('walks the full happy path from REQUESTED to WORK_COMPLETED', () => {
    expect(canTransition('REQUESTED', 'accept', 'PROVIDER')?.to).toBe('SCHEDULED');
    expect(canTransition('SCHEDULED', 'depart', 'PROVIDER')?.to).toBe('EN_ROUTE');
    expect(canTransition('EN_ROUTE', 'start', 'PROVIDER')?.to).toBe('IN_PROGRESS');
    expect(canTransition('IN_PROGRESS', 'complete', 'PROVIDER')?.to).toBe('WORK_COMPLETED');
  });

  it('routes a quote revision out of and back into IN_PROGRESS', () => {
    expect(canTransition('IN_PROGRESS', 'raiseQuoteRevision', 'PROVIDER')?.to).toBe('QUOTE_REVISION');
    expect(canTransition('QUOTE_REVISION', 'approveQuoteRevision', 'CUSTOMER')?.to).toBe('IN_PROGRESS');
    expect(canTransition('QUOTE_REVISION', 'rejectQuoteRevision', 'CUSTOMER')?.to).toBe('IN_PROGRESS');
  });

  it('has no outgoing transitions from a terminal status', () => {
    expect(transitionFor('CLOSED', 'close')).toBeUndefined();
    expect(transitionFor('AWAITING_VERIFICATION', 'complete')).toBeUndefined();
    expect(transitionFor('UNFULFILLED', 'accept')).toBeUndefined();
  });

  it('captures payment into REQUESTED, or abandons the checkout, only as the system', () => {
    expect(canTransition('PENDING_PAYMENT', 'paymentCaptured', 'SYSTEM')?.to).toBe('REQUESTED');
    expect(canTransition('PENDING_PAYMENT', 'paymentAbandoned', 'SYSTEM')?.to).toBe('ABANDONED');
    expect(canTransition('PENDING_PAYMENT', 'paymentCaptured', 'CUSTOMER')).toBeNull();
    expect(canTransition('PENDING_PAYMENT', 'accept', 'PROVIDER')).toBeNull();
  });

  it('lets the customer cancel before a provider accepts, but not the provider', () => {
    expect(canTransition('REQUESTED', 'cancel', 'CUSTOMER')?.to).toBe('CANCELLED_CUSTOMER');
    expect(canTransition('REQUESTED', 'cancel', 'PROVIDER')).toBeNull();
    expect(canTransition('PENDING_PAYMENT', 'cancel', 'CUSTOMER')?.to).toBe('CANCELLED_CUSTOMER');
  });

  it('exhausting offers is a system-only route to UNFULFILLED', () => {
    expect(canTransition('REQUESTED', 'exhaustOffers', 'SYSTEM')?.to).toBe('UNFULFILLED');
    expect(canTransition('REQUESTED', 'exhaustOffers', 'PROVIDER')).toBeNull();
  });

  it('chains WORK_COMPLETED into AWAITING_VERIFICATION as the system', () => {
    expect(canTransition('WORK_COMPLETED', 'handToVerification', 'SYSTEM')?.to).toBe('AWAITING_VERIFICATION');
    expect(canTransition('WORK_COMPLETED', 'handToVerification', 'PROVIDER')).toBeNull();
  });

  it('records each verification outcome as a system move out of AWAITING_VERIFICATION (T18–T21)', () => {
    expect(canTransition('AWAITING_VERIFICATION', 'verified', 'SYSTEM')?.to).toBe('VERIFIED');
    expect(canTransition('AWAITING_VERIFICATION', 'linkConfirmed', 'SYSTEM')?.to).toBe('VERIFIED');
    expect(canTransition('AWAITING_VERIFICATION', 'outcomeRework', 'SYSTEM')?.to).toBe('REWORK_REQUIRED');
    expect(canTransition('AWAITING_VERIFICATION', 'outcomeDisputed', 'SYSTEM')?.to).toBe('DISPUTED');
    expect(canTransition('AWAITING_VERIFICATION', 'autoRelease', 'SYSTEM')?.to).toBe('AUTO_RELEASED');
    expect(canTransition('AWAITING_VERIFICATION', 'verified', 'PROVIDER')).toBeNull();
    expect(canTransition('AWAITING_VERIFICATION', 'verified', 'CUSTOMER')).toBeNull();
  });

  it('lets a rework visit start again from REWORK_REQUIRED, and lets an expired window dispute it (T12, T22)', () => {
    expect(canTransition('REWORK_REQUIRED', 'start', 'PROVIDER')?.to).toBe('IN_PROGRESS');
    expect(canTransition('REWORK_REQUIRED', 'start', 'CUSTOMER')).toBeNull();
    expect(canTransition('REWORK_REQUIRED', 'reworkWindowExpired', 'SYSTEM')?.to).toBe('DISPUTED');
  });

  it('releases money only from VERIFIED or AUTO_RELEASED: by the system online, by the provider for cash (T23)', () => {
    for (const status of ['VERIFIED', 'AUTO_RELEASED'] as const) {
      expect(canTransition(status, 'release', 'SYSTEM')?.to).toBe('PAYMENT_RELEASED');
      expect(canTransition(status, 'confirmCashReceived', 'PROVIDER')?.to).toBe('PAYMENT_RELEASED');
      expect(canTransition(status, 'release', 'PROVIDER')).toBeNull();
    }
    for (const status of ['AWAITING_VERIFICATION', 'DISPUTED', 'REWORK_REQUIRED', 'IN_PROGRESS'] as const) {
      expect(canTransition(status, 'release', 'SYSTEM')).toBeNull();
      expect(canTransition(status, 'confirmCashReceived', 'PROVIDER')).toBeNull();
    }
  });

  it('reopens a released job as rework on a warranty claim, and closes finished jobs (T25, T26)', () => {
    expect(canTransition('PAYMENT_RELEASED', 'warrantyClaim', 'CUSTOMER')?.to).toBe('REWORK_REQUIRED');
    expect(canTransition('PAYMENT_RELEASED', 'warrantyClaim', 'PROVIDER')).toBeNull();
    for (const status of ['PAYMENT_RELEASED', 'PARTIALLY_REFUNDED', 'REFUNDED'] as const) expect(canTransition(status, 'close', 'SYSTEM')?.to).toBe('CLOSED');
  });

  it('resolves a dispute three ways, only as the system (T24)', () => {
    expect(canTransition('DISPUTED', 'resolveRelease', 'SYSTEM')?.to).toBe('PAYMENT_RELEASED');
    expect(canTransition('DISPUTED', 'resolvePartial', 'SYSTEM')?.to).toBe('PARTIALLY_REFUNDED');
    expect(canTransition('DISPUTED', 'resolveRefund', 'SYSTEM')?.to).toBe('REFUNDED');
    expect(canTransition('DISPUTED', 'resolveRelease', 'PROVIDER')).toBeNull();
    expect(canTransition('AWAITING_VERIFICATION', 'resolveRelease', 'SYSTEM')).toBeNull();
  });
});
