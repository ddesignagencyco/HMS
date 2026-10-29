import { z } from 'zod';

const booleanFromEnv = z.enum(['true', 'false', '1', '0']).transform((value) => value === 'true' || value === '1');

const csv = z.string().transform((value) =>
  value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
);

export const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    API_HOST: z.string().min(1).default('0.0.0.0'),
    /**
     * The worker's Prometheus scrape port. The API serves `/metrics` on `PORT`, but the background
     * jobs that `shm_jobs_total` counts run in the worker, a separate process — so the worker has to
     * expose its own registry for those counters to be scrapeable at all. 9464 is the conventional
     * port for a Prometheus exporter that is not the application's own.
     */
    WORKER_METRICS_PORT: z.coerce.number().int().min(1).max(65_535).default(9464),
    /**
     * BE-017: the Prisma pool. The API connects through DIRECT_URL, which historically carried no `connection_limit`, so the pool was Prisma's
     * default (cpus*2+1, often 5-9 on a small box) with a 10 s wait - a handful of requests that each hold a transaction open (login,
     * booking) starved the rest, which then failed with P2024 and surfaced as a 500. These are applied to the URL only when the URL itself
     * does not already say, so an explicit `?connection_limit=` still wins.
     */
    DB_POOL_MAX: z.coerce.number().int().min(1).max(200).default(20),
    DB_POOL_TIMEOUT_S: z.coerce.number().int().min(1).max(300).default(30),
    /**
     * BE-017: how many reverse proxies sit in front of the API. Unset keeps the historical `trust proxy = true` (leftmost X-Forwarded-For).
     * Set it to the real hop count (for example 1 behind a single load balancer) and Express takes the client IP from that many hops from the
     * right, which a caller cannot forge by sending their own X-Forwarded-For header - the rate limiter keys on it.
     */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).optional(),
    SHUTDOWN_GRACE_MS: z.coerce.number().int().min(0).max(120_000).default(10_000),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    DIRECT_URL: z.string().min(1, 'DIRECT_URL is required'),
    REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
    JWT_ISSUER: z.string().min(1).default('smart-home-api'),
    JWT_AUDIENCE: z.string().min(1).default('smart-home-clients'),
    /**
     * BE-027: seconds after a refresh token is rotated during which presenting it again is treated as a second tab racing the first rather than
     * as theft. 0 turns the grace off (every reuse revokes the family). The replay still has to be of a token that was rotated away, and only
     * inside the window; after it, reuse revokes the whole family as before.
     */
    REFRESH_REUSE_GRACE_SECONDS: z.coerce.number().int().min(0).max(120).default(10),
    ACCESS_TOKEN_TTL_MIN: z.coerce.number().int().min(1).max(1_440).default(15),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    CSRF_SECRET: z.string().min(32, 'CSRF_SECRET must be at least 32 characters'),
    OTP_PEPPER: z.string().min(32, 'OTP_PEPPER must be at least 32 characters'),
    TOTP_ENCRYPTION_KEY: z.string().refine((value) => {
      try {
        return Buffer.from(value, 'base64').length === 32;
      } catch {
        return false;
      }
    }, 'TOTP_ENCRYPTION_KEY must be a base64 encoded 32 byte key'),
    /**
     * A provider's CNIC is government identity data, so it gets its own key
     * rather than sharing TOTP's. Keys are separated per purpose so one being
     * rotated or leaked does not expose the other.
     */
    CNIC_ENCRYPTION_KEY: z.string().refine((value) => {
      try {
        return Buffer.from(value, 'base64').length === 32;
      } catch {
        return false;
      }
    }, 'CNIC_ENCRYPTION_KEY must be a base64 encoded 32 byte key'),

    /**
     * The origin of the **web app**, not of this API — every URL built from it is
     * one a customer opens in a browser: the verification link they are texted,
     * the problem-report link on their receipt, and the gateway's payment return
     * URL. Pointing it at the API's own port produces links that render Swagger or
     * 404, so it is a separate value from PORT on purpose, and it must be set per
     * deployment rather than assumed.
     */
    PUBLIC_BASE_URL: z.string().url().default('http://localhost:3001'),
    CORS_ORIGINS: csv.default('http://localhost:3000'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

    PAYMENT_PROVIDER: z.string().min(1).default('mock'),
    SMS_PROVIDER: z.string().min(1).default('mock'),
    EMAIL_PROVIDER: z.string().min(1).default('mock'),
    MAPS_PROVIDER: z.string().min(1).default('mock'),
    TELEPHONY_PROVIDER: z.string().min(1).default('mock'),
    WHATSAPP_PROVIDER: z.string().min(1).default('mock'),
    STORAGE_PROVIDER: z.string().min(1).default('mock'),
    SUPABASE_URL: z.string().url().optional(),
    SUPABASE_SECRET_KEY: z.string().min(1).optional(),
    SUPABASE_STORAGE_BUCKET: z.string().min(1).default('verification-documents'),
    SUPABASE_PUBLISHABLE_KEY: z.string().min(1).optional(),
    SUPABASE_JWKS_URL: z.string().url().optional(),
    MOCK_PAYMENT_WEBHOOK_SECRET: z.string().min(16),

    STORAGE_BUCKETS: csv.default('evidence,documents,recordings,reports'),

    // Opt-in, not opt-out. This flag opens `/dev/inbox`, which serves every OTP the
    // system has ever sent, and `/dev/payments/{id}/complete`, which can capture an
    // arbitrary payment. Both were reachable with no token and no configuration in any
    // deployment whose NODE_ENV was not literally `production` -- staging, a preview
    // environment, a demo box. The production guard below is not enough on its own,
    // because "not production" is exactly the case that leaks. So it has to be asked
    // for by name. CI sets it explicitly; `.env.example` does too.
    DEV_INBOX_ENABLED: booleanFromEnv.default('false'),
    OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(60_000).default(1_000),

    /**
     * Error reporting. No DSN means no Sentry client is initialised at all — the
     * observability module is not loaded, nothing is buffered, nothing is queued.
     *
     * It is off by default rather than on: a DSN is a live destination, and silently
     * shipping production errors to whatever project happens to be configured in the
     * environment is worse than shipping none.
     */
    SENTRY_DSN: z.string().url().optional(),
    SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),
    /**
     * Below this in production the payload is still thrown, just not sent. Fatal
     * crashes are the ones worth waking someone for; a warning nobody acts on is
     * noise that trains people to ignore the channel.
     */
    SENTRY_MIN_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug']).default('error')
  })
  .superRefine((value, context) => {
    const add = (key: keyof typeof value, message: string) => context.addIssue({ code: 'custom', path: [key], message });
    if (value.NODE_ENV === 'production') {
      if (value.DEV_INBOX_ENABLED) add('DEV_INBOX_ENABLED', 'The development inbox must be disabled in production');
      if (value.JWT_ACCESS_SECRET.startsWith('development-')) add('JWT_ACCESS_SECRET', 'The development JWT secret must not be used in production');
      if (value.JWT_REFRESH_SECRET === value.JWT_ACCESS_SECRET) add('JWT_REFRESH_SECRET', 'Access and refresh secrets must differ');
      if (value.OTP_PEPPER === value.JWT_ACCESS_SECRET) add('OTP_PEPPER', 'The OTP pepper must not reuse a JWT secret');
      if (value.CNIC_ENCRYPTION_KEY === value.TOTP_ENCRYPTION_KEY) add('CNIC_ENCRYPTION_KEY', 'The CNIC key must not reuse the TOTP key');
    }
    for (const key of ['PAYMENT_PROVIDER', 'SMS_PROVIDER', 'EMAIL_PROVIDER', 'MAPS_PROVIDER', 'TELEPHONY_PROVIDER', 'WHATSAPP_PROVIDER'] as const) {
      if (value[key] !== 'mock') add(key, `Only the mock adapter is wired in this increment; ${key} must be "mock"`);
    }
    if (value.STORAGE_PROVIDER !== 'mock' && value.STORAGE_PROVIDER !== 'supabase') {
      add('STORAGE_PROVIDER', 'STORAGE_PROVIDER must be "mock" or "supabase"');
    }
    if (value.STORAGE_PROVIDER === 'supabase') {
      if (!value.SUPABASE_URL) add('SUPABASE_URL', 'SUPABASE_URL is required when STORAGE_PROVIDER is "supabase"');
      if (!value.SUPABASE_SECRET_KEY) add('SUPABASE_SECRET_KEY', 'SUPABASE_SECRET_KEY is required when STORAGE_PROVIDER is "supabase"');
    }
    if (value.STORAGE_BUCKETS.length === 0) add('STORAGE_BUCKETS', 'At least one storage bucket is required');

    // The dev inbox is the single most dangerous flag in the system: `/dev/inbox`
    // serves every OTP the platform has sent, unauthenticated, and
    // `/dev/payments/{id}/complete` captures an arbitrary payment. It now defaults to
    // off, which is the actual fix -- `NODE_ENV` has only three legal values, so a
    // preview or demo box that sets `development` or `test` (as those usually do) used
    // to get the inbox live without anyone asking for it. On top of that it is refused
    // unless the environment is explicitly `development` or `test`, so enabling it
    // anywhere else fails the boot instead of quietly serving every customer's
    // one-time code to whoever asks.
    if (value.DEV_INBOX_ENABLED && value.NODE_ENV !== 'development' && value.NODE_ENV !== 'test') {
      add('DEV_INBOX_ENABLED', `The development inbox may only be enabled when NODE_ENV is "development" or "test" (this is "${value.NODE_ENV}"). It exposes every OTP the platform has sent.`);
    }
  });

export type Environment = z.infer<typeof environmentSchema>;

export const parseEnvironment = (source: NodeJS.ProcessEnv): Environment => {
  const result = environmentSchema.safeParse(source);
  if (result.success) return result.data;
  throw new EnvironmentValidationError(result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })));
};

export type EnvironmentIssue = { path: string; message: string };

export class EnvironmentValidationError extends Error {
  readonly issues: readonly EnvironmentIssue[];

  constructor(issues: readonly EnvironmentIssue[]) {
    super(`Invalid environment:\n${issues.map((issue) => `  - ${issue.path}: ${issue.message}`).join('\n')}`);
    this.name = 'EnvironmentValidationError';
    this.issues = issues;
  }
}
