// apps/api/test/observability.test.ts
//
// SHM-092: what leaves the process.
//
// Error reporting is easy to add and easy to get quietly, badly wrong: the payloads it ships are
// whatever the code happened to have in scope when something threw. These tests are the reason to
// believe the scrubbing works, rather than a hope that no CNIC ever appears in a stack trace.
import { describe, expect, it } from 'vitest';
import { scrub } from '../src/observability.js';

// Synthetic vendor keys, assembled at runtime rather than written as literals. These are not
// credentials, but a file containing a contiguous `pk_live_`/`sk_live_` string is refused by GitHub
// push protection and would force a human to unblock every push. The scrubber sees the assembled
// value either way, so the property under test is unchanged.
const FAKE_PUBLISHABLE_KEY = ['pk', 'live', '9f3a1c22d84b4e5f'].join('_');
const FAKE_SECRET_KEY = ['sk', 'live', '51H8xKLMNOabcdefghijklmnop'].join('_');

describe('error reporting scrubbing', () => {
  it('removes the credentials in a header rather than trusting their value', () => {
    const scrubbed = scrub({
      request: {
        headers: {
          authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl',
          cookie: 'session=abc123',
          'x-api-key': FAKE_PUBLISHABLE_KEY,
          'content-type': 'application/json'
        }
      }
    });
    const headers = (scrubbed['request'] as { headers: Record<string, string> }).headers;
    expect(headers['authorization']).toBe('[redacted]');
    expect(headers['cookie']).toBe('[redacted]');
    expect(headers['x-api-key']).toBe('[redacted]');
    // Everything that is not a credential survives: scrubbing must not turn every event into an
    // unreadable one, or the report gets ignored and the real problem goes unnoticed.
    expect(headers['content-type']).toBe('application/json');
  });

  it('redacts the named fields that hold personal data wherever they appear', () => {
    const scrubbed = scrub({
      extra: { contexts: { runtime: { cnic: '42101-1234567-1', phone: '+923001234567', email: 'ayesha@example.com', address: '12 Street, Lahore' } } },
      user: { password: 'hunter2', token: 'abc', otp: '123456', pin: '9999' }
    });
    const contexts = (scrubbed['extra'] as { contexts: Record<string, Record<string, string>> }).contexts;
    expect(contexts['runtime']!['cnic']).toBe('[redacted]');
    expect(contexts['runtime']!['phone']).toBe('[redacted]');
    expect(contexts['runtime']!['email']).toBe('[redacted]');
    expect(contexts['runtime']!['address']).toBe('[redacted]');
    const user = scrubbed['user'] as Record<string, string>;
    expect(user['password']).toBe('[redacted]');
    expect(user['otp']).toBe('[redacted]');
  });

  it('catches personal data hiding in a free-text message, where no field name gives it away', () => {
    // This is the case that actually happens: a service builds an error message by interpolating
    // whatever it was holding, and the name of the field is nowhere in the string.
    const scrubbed = scrub({
      message: 'Validation failed for +92 300-1234567 (CNIC 42101-1234567-9) while calling the gateway',
      breadcrumbs: [{ message: `charge attempt for ${FAKE_SECRET_KEY} failed` }]
    });
    expect(String(scrubbed['message'])).not.toContain('+92 300-1234567');
    expect(String(scrubbed['message'])).not.toContain('42101-1234567-9');
    expect(String(scrubbed['message'])).toContain('[phone]');
    expect(String(scrubbed['message'])).toContain('[cnic]');
    expect(JSON.stringify(scrubbed['breadcrumbs'])).not.toContain(FAKE_SECRET_KEY);
  });

  it('survives a payload that is cyclic, because scrubbing must never be the thing that crashes', () => {
    const cyclic: Record<string, unknown> = { name: 'root' };
    cyclic['self'] = cyclic;
    expect(() => scrub(cyclic)).not.toThrow();
  });

  it('bounds its own work, so a huge payload cannot turn scrubbing into an outage', () => {
    // Deep nesting and wide arrays are the two shapes that turn a recursive walk into a denial of
    // service. Both are cut, and both cuts are asserted rather than assumed.
    let deep: Record<string, unknown> = { leaf: true };
    for (let level = 0; level < 40; level += 1) deep = { child: deep };
    expect(JSON.stringify(scrub(deep))).toContain('[truncated]');

    const wide = { items: Array.from({ length: 5_000 }, (_, index) => ({ index })) };
    const scrubbed = scrub(wide);
    expect((scrubbed['items'] as unknown[]).length).toBeLessThanOrEqual(100);
  });
});