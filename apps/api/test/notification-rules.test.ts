import { describe, expect, it } from 'vitest';
import { BOOKING_TRANSITIONS } from '@smart-home/domain';
import { NO_RULE_EVENTS, RULES } from '../src/notification/notification.service.js';

/**
 * Every non-transition event type the API emits via `appendOutboxEvent` (or by writing an outbox row directly, like the
 * reminder sweep). The `booking.*` transitions are derived from the domain transition table below, so only events that
 * are not transitions need to be listed here. If an emitter adds a brand-new event, the runtime warn in
 * `NotificationService.handle` flags it; adding it here (and to RULES or NO_RULE_EVENTS) closes the gap.
 */
const LITERAL_EVENTS = [
  'booking.offer_created',
  'booking.message',
  'booking.reminder_24h',
  'booking.reminder_2h',
  'payment.receipt_due',
  'payment.debt_paid',
  'payment.captured',
  'payment.webhook.received',
  'refund.queued',
  'payout.requested',
  'payout.paid',
  'penalty.proposed',
  'penalty.replied',
  'penalty.applied',
  'penalty.appealed',
  'appeal.decided',
  'provider.warned',
  'provider.suspended',
  'provider.blocked',
  'provider.review_required',
  'complaint.created',
  'complaint.safety_raised',
  'complaint.replied',
  'complaint.response_requested',
  'complaint.status_changed',
  'complaint.warning',
  'complaint.sla_breached',
  'dispute.opened',
  'dispute.replied',
  'dispute.resolved',
  'verification.sla_breached',
  'verification.link_requested',
  'ledger.drift_detected'
] as const;

const bookingTransitions = Object.values(BOOKING_TRANSITIONS).flatMap(status => Object.keys(status ?? {}));
const KNOWN_EVENTS = new Set<string>([...LITERAL_EVENTS, ...bookingTransitions.map(event => `booking.${event}`)]);

describe('notification planner completeness (FR-NT-01)', () => {
  it('every emitted event is routed by RULES or classified as intentionally silent in NO_RULE_EVENTS', () => {
    const unclassified = [...KNOWN_EVENTS].filter(type => RULES[type] === undefined && !(type in NO_RULE_EVENTS));
    expect(unclassified).toEqual([]);
  });

  it('NO_RULE_EVENTS names only events that exist (no typos, no phantom keys)', () => {
    for (const type of Object.keys(NO_RULE_EVENTS)) {
      expect(KNOWN_EVENTS.has(type), `${type} is not an emitted event`).toBe(true);
    }
  });

  it('an event that just got a rule is not also allow-listed', () => {
    for (const type of Object.keys(NO_RULE_EVENTS)) {
      expect(RULES[type], `${type} has a rule; drop its NO_RULE_EVENTS entry`).toBeUndefined();
    }
  });

  it('every rule names a recipient, a template, and at least one channel', () => {
    for (const [event, rules] of Object.entries(RULES)) {
      expect(rules.length, `${event} has a rule with no rows`).toBeGreaterThan(0);
      for (const rule of rules) {
        expect(rule.eventKey.length).toBeGreaterThan(0);
        expect(rule.channels.length, `${event} -> ${rule.eventKey} has no channel`).toBeGreaterThan(0);
      }
    }
  });
});