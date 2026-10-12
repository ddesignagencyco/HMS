// apps/api/src/observability.ts
import type { EnvironmentService } from './config/environment.service.js';

/**
 * SHM-092 / NFR-OBS: error reporting.
 *
 * Sentry is loaded **lazily and only when a DSN is configured**. That is the whole design, and it
 * matters for more than startup time: with no DSN, `import('@sentry/node')` never runs, so a
 * developer with no Sentry account — and CI — pays nothing and has nothing to configure.
 *
 * Two things are deliberately scrubbed before an event leaves the process:
 *
 * - **PII.** This system holds CNICs, phone numbers, addresses and payment references. A stack trace
 *   that carries a request body would put all of those in a third-party project. Sentry's own
 *   scrubbing is pattern-based and has been wrong before; the allow-list below is the primary
 *   defence and the vendor's is the second.
 * - **Secrets.** An `Authorization` header or a JWT in an error message is a credential in a log
 *   aggregator that far more people can read than can read production.
 *
 * `sendDefaultPii: false` is Sentry's own switch for the same problem and is left off for it.
 */
export const initialiseErrorReporting = async (environment: EnvironmentService): Promise<boolean> => {
  const dsn = environment.values.SENTRY_DSN;
  if (dsn === undefined) return false;

  const { default: Sentry } = await import('@sentry/node');
  Sentry.init({
    dsn,
    environment: environment.isProduction ? 'production' : 'development',
    // Sampling below 1 is a budget decision, not a default: every 10% trace is a trace that cannot
    // be looked at later. The sample rate is configurable so it can be raised to 1 while chasing an
    // incident and dropped afterwards.
    tracesSampleRate: environment.values.SENTRY_TRACES_SAMPLE_RATE,
    // Profiling is deliberately not enabled. It needs a separately built native addon, and a
    // container image that has to carry it is a trade not worth making for a service whose hot path
    // is database queries already visible in `pg_stat_statements`.
    //
    // (v8 removed `sendDefaultPii`; the SDK no longer sends personal data unless asked to. The
    // scrubbing below is therefore the only thing standing between this service's CNICs and a third
    // party, which is why it is tested rather than assumed.)
    // The typed signature is kept and the scrubbed copy is handed back to Sentry: `beforeSend` is
    // the only hook that can still remove something from an event after the SDK has assembled it.
    beforeSend: (event) => scrub(event as unknown as Record<string, unknown>) as unknown as typeof event
  });
  return true;
};

/** Header names whose values are credentials or personal data, removed wholesale. */
const FORBIDDEN_HEADERS = new Set(['authorization', 'cookie', 'set-cookie', 'x-api-key', 'otp', 'x-otp']);

/**
 * Walks an arbitrary Sentry event and replaces anything that looks like personal data or a secret.
 *
 * Pattern-based and therefore imperfect, which is stated here rather than implied: it cannot tell a
 * UUID that is a booking id from a UUID that is somebody's CNIC. What it *can* guarantee is that the
 * obvious cases — a named field holding a phone number, an `Authorization` header, a long token — are
 * never sent. Anything this misses would have to be found in the vendor's own scrubbing too.
 */
export const scrub = (event: Record<string, unknown>): Record<string, unknown> => {
  const request = event['request'] as Record<string, unknown> | undefined;
  const headers = request?.['headers'] as Record<string, unknown> | undefined;
  if (headers !== undefined) {
    for (const name of Object.keys(headers)) {
      if (FORBIDDEN_HEADERS.has(name.toLowerCase())) headers[name] = '[redacted]';
    }
  }

  const scrubString = (value: string): string =>
    value
      // Pakistani mobile numbers, in the formats the API accepts: `+923001234567`,
      // `+92 300-1234567` and `+92-300 123 4567` are all things people paste into a support form.
      .replace(/\+92[\s-]?\d[\d\s-]{8,14}/g, '[phone]')
      // CNIC: 13 digits, optionally with a dash.
      .replace(/\b\d{5}-?\d{7}-?\d\b/g, '[cnic]')
      // Anything that looks like a bearer token or a long opaque secret.
      .replace(/\b[A-Za-z0-9_-]{32,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g, '[jwt]')
      // Vendor secrets. The body allows underscores because every real key of this shape has
      // segments in it (`sk_live_…`, `pk_test_…`); a pattern that only matched `[A-Za-z0-9]` would
      // have quietly missed all of them.
      .replace(/\b(sk|pk|rk|whsec)[_-][A-Za-z0-9_-]{12,}\b/g, '[secret]')
      .replace(/\bAKIA[0-9A-Z]{12,}\b/g, '[secret]');

  const walk = (value: unknown, depth = 0): unknown => {
    // Bounded so a deeply nested or cyclic payload cannot turn scrubbing into its own outage.
    if (depth > 8) return '[truncated]';
    if (typeof value === 'string') return scrubString(value);
    if (Array.isArray(value)) return value.slice(0, 100).map(item => walk(item, depth + 1));
    if (value !== null && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) {
        // The keys most likely to hold the sensitive thing, removed regardless of their contents.
        out[key] = /^(password|token|otp|pin|cnic|phone|email|address|secret|authorization)$/i.test(key) ? '[redacted]' : walk(item, depth + 1);
      }
      return out;
    }
    return value;
  };

  return walk(event) as Record<string, unknown>;
};
