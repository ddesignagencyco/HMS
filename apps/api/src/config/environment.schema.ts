import { z } from 'zod';

const booleanFromEnv = z
  .enum(['true', 'false', '1', '0'])
  .transform(value => value === 'true' || value === '1');

const csv = z.string().transform(value => value.split(',').map(part => part.trim()).filter(Boolean));

export const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    API_HOST: z.string().min(1).default('0.0.0.0'),
    SHUTDOWN_GRACE_MS: z.coerce.number().int().min(0).max(120_000).default(10_000),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    DIRECT_URL: z.string().min(1, 'DIRECT_URL is required'),
    REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
    JWT_ISSUER: z.string().min(1).default('smart-home-api'),
    JWT_AUDIENCE: z.string().min(1).default('smart-home-clients'),
    ACCESS_TOKEN_TTL_MIN: z.coerce.number().int().min(1).max(1_440).default(15),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    CSRF_SECRET: z.string().min(32, 'CSRF_SECRET must be at least 32 characters'),
    OTP_PEPPER: z.string().min(32, 'OTP_PEPPER must be at least 32 characters'),
    TOTP_ENCRYPTION_KEY: z
      .string()
      .refine(value => {
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
    CNIC_ENCRYPTION_KEY: z
      .string()
      .refine(value => {
        try {
          return Buffer.from(value, 'base64').length === 32;
        } catch {
          return false;
        }
      }, 'CNIC_ENCRYPTION_KEY must be a base64 encoded 32 byte key'),

    /** Where customers open links we text them (the verification link). */
    PUBLIC_BASE_URL: z.string().url().default('http://localhost:3000'),
    CORS_ORIGINS: csv.default('http://localhost:3000'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

    PAYMENT_PROVIDER: z.string().min(1).default('mock'),
    SMS_PROVIDER: z.string().min(1).default('mock'),
    EMAIL_PROVIDER: z.string().min(1).default('mock'),
    MAPS_PROVIDER: z.string().min(1).default('mock'),
    TELEPHONY_PROVIDER: z.string().min(1).default('mock'),
    WHATSAPP_PROVIDER: z.string().min(1).default('mock'),
    STORAGE_PROVIDER: z.string().min(1).default('mock'),
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
    OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(60_000).default(1_000)
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
    for (const key of ['PAYMENT_PROVIDER', 'SMS_PROVIDER', 'EMAIL_PROVIDER', 'MAPS_PROVIDER', 'TELEPHONY_PROVIDER', 'WHATSAPP_PROVIDER', 'STORAGE_PROVIDER'] as const) {
      if (value[key] !== 'mock') add(key, `Only the mock adapter is wired in this increment; ${key} must be "mock"`);
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
  throw new EnvironmentValidationError(result.error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })));
};

export type EnvironmentIssue = { path: string; message: string };

export class EnvironmentValidationError extends Error {
  readonly issues: readonly EnvironmentIssue[];

  constructor(issues: readonly EnvironmentIssue[]) {
    super(`Invalid environment:\n${issues.map(issue => `  - ${issue.path}: ${issue.message}`).join('\n')}`);
    this.name = 'EnvironmentValidationError';
    this.issues = issues;
  }
}
