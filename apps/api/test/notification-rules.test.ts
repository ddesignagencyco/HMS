import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BOOKING_TRANSITIONS } from '@smart-home/domain';
import { NO_RULE_EVENTS, RULES, TEMPLATE_VARIABLES } from '../src/notification/notification.service.js';

/**
 * Every event type the API emits, **derived from the source**, not maintained by hand.
 *
 * This used to be a hand-written `LITERAL_EVENTS` array, and SHM-089 (maintenance plans, merged
 * 9 Oct 2026) proved the cost of that: it emitted `subscription.created`, `subscription.activated`,
 * `subscription.cancelled` and `plan_visit.booked`, none of them was in the list, none had a
 * planner row, and the suite stayed green — while a customer subscribing, paying, getting a
 * visit booked and cancelling all told nobody. A guard that a merged ticket can walk past is
 * not a guard, so the list is now read out of `apps/api/src` instead.
 *
 * Two shapes are matched:
 *  - `appendOutboxEvent(..., { type: 'x.y' })` and `type: 'x.y'` on an outbox insert;
 *  - the booking transitions, which `applySystemEvent` derives from the domain table and
 *    emits as `booking.<event>`. Those cannot be read from this workspace's source — the table
 *    lives in `@smart-home/domain` — so they come from the table itself, which is the
 *    authoritative list anyway.
 */
const SRC = new URL('../src/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const sourceFiles = (dir: string): string[] => {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...sourceFiles(full));
    else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) found.push(full);
  }
  return found;
};

/** Every `'dotted.name'` literal that appears as the `type` of an outbox event, plus the ones an emitter builds with a template. */
const EMITTED_LITERAL = /type:\s*'([a-z][a-z0-9_]*\.[a-zA-Z0-9_.]+)'/g;

/** Emitters that assemble the type at runtime. Each must be explained here, and each explanation must survive review. */
const COMPUTED_EMITTERS = /type:\s*`([^`]+)`/g;

const ALLOWED_COMPUTED: Readonly<Record<string, string>> = {
  'booking.${event}': 'applySystemEvent emits the domain transition table as booking.<event>; those come from BOOKING_TRANSITIONS above, which is the authoritative list'
};

const bookingTransitions = Object.values(BOOKING_TRANSITIONS).flatMap(status => Object.keys(status ?? {})).map(event => `booking.${event}`);

const scan = (): { emitted: Set<string>; computed: string[] } => {
  const emitted = new Set<string>(bookingTransitions);
  const computed: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(EMITTED_LITERAL)) emitted.add(match[1]!);
    for (const match of source.matchAll(COMPUTED_EMITTERS)) computed.push(match[1]!);
  }
  return { emitted, computed };
};

describe('notification planner completeness (FR-NT-01)', () => {
  it('every emitted event is routed by RULES or classified as intentionally silent in NO_RULE_EVENTS', () => {
    const { emitted } = scan();
    const unclassified = [...emitted].filter(type => RULES[type] === undefined && !(type in NO_RULE_EVENTS)).sort();
    expect(unclassified).toEqual([]);
  });

  it('the scan actually reads the source (a silently-empty scan would pass the test above)', () => {
    // If the glob ever stops matching, "no unclassified events" becomes true for the wrong reason.
    const { emitted } = scan();
    expect(emitted.size).toBeGreaterThan(20);
    expect(emitted.has('complaint.safety_raised')).toBe(true);
    expect(emitted.has('plan_visit.booked')).toBe(true);
    expect(emitted.has('booking.handToVerification')).toBe(true);
  });

  it('every runtime-built event type is one this test already accounts for', () => {
    const { computed } = scan();
    const unexplained = [...new Set(computed)].filter(type => !(type in ALLOWED_COMPUTED)).sort();
    expect(unexplained, `add the event to RULES/NO_RULE_EVENTS, or explain it in ALLOWED_COMPUTED`).toEqual([]);
  });

  it('NO_RULE_EVENTS names only events that exist (no typos, no phantom keys)', () => {
    const { emitted } = scan();
    for (const type of Object.keys(NO_RULE_EVENTS)) {
      expect(emitted.has(type), `${type} is not an emitted event`).toBe(true);
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

  /**
   * A rule that names a payload field the emitter does not send resolves to nobody: `resolve()`
   * reads `payload[recipient.payload]`, gets `undefined`, and returns `[]` — a silently dropped
   * notification. This is the trap the `subscription.activated` row fell into until review.
   */
  it('every payload-addressed recipient names a field the code actually sends for that event', () => {
    const sources = sourceFiles(SRC).map(file => ({ file, source: readFileSync(file, 'utf8') }));
    const unroutable: string[] = [];
    for (const [event, rules] of Object.entries(RULES)) {
      for (const rule of rules) {
        if (typeof rule.recipient !== 'object') continue;
        const field = rule.recipient.payload;
        const emitters = sources.filter(({ source }) => source.includes(`'${event}'`));
        const sendsField = emitters.some(({ source }) => {
          const at = source.indexOf(`'${event}'`);
          // The payload object of the emit that carries this event type, roughly the enclosing braces.
          const window = source.slice(Math.max(0, at - 1200), at + 1200);
          // `field: value` or the shorthand `field,` — `payment.debt_paid` sends `providerId` the second way.
          return new RegExp(`(^|[{,\\s])${field}\\s*[,:}]`, 'm').test(window);
        });
        if (!sendsField) unroutable.push(`${event} -> ${field}`);
      }
    }
    expect(unroutable).toEqual([]);
  });

  /**
   * BE-012 (backend_requirement 3.7): the "confirm your job" nudge. A booking enters AWAITING_VERIFICATION through `booking.handToVerification`; the
   * customer must be told by SMS as well as in-app (an in-app row is invisible to someone who never opens the app), and the text must carry
   * `{{confirmLink}}` - the deep link to /account/bookings/:id#confirm-work - in both languages and on both channels.
   */
  it('BE-012: handToVerification tells the customer on both channels and the templates carry the confirm-work link', () => {
    expect(RULES['booking.handToVerification']).toEqual([{ recipient: 'customer', eventKey: 'booking.awaiting_verification', channels: ['IN_APP', 'SMS'] }]);
    expect(TEMPLATE_VARIABLES as readonly string[]).toContain('confirmLink');
    const seed = readFileSync(new URL('../../../packages/db/seed/notificationTemplates.ts', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), 'utf8');
    const awaiting = seed.split(/\r?\n/).filter(line => line.includes("t('booking.awaiting_verification'"));
    expect(awaiting.map(line => /'(IN_APP|SMS)'/.exec(line)?.[1]).sort()).toEqual(['IN_APP', 'SMS']);
    for (const line of awaiting) expect(line.match(/\{\{confirmLink\}\}/g)?.length).toBe(2); // English and Urdu body
  });
});
