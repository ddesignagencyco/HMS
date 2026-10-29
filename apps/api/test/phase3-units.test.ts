// apps/api/test/phase3-units.test.ts
//
// Unit coverage for the phase-3 hardening items that are pure functions or a single middleware:
// BE-011/029 locale + rupee sentences, BE-017 rate-limit client key / trust proxy / pool settings,
// BE-006/034 upload checks and the Supabase expiry, BE-026 dispute name masking.
import express from 'express';
import { inject } from 'light-my-request';
import { describe, expect, it } from 'vitest';
import { clientKey, createRateLimitMiddleware, DOCUMENT_BODY_LIMIT } from '../src/http-app.js';
import { localeOf, pick, rupees } from '../src/common/locale.js';
import { withPoolSettings } from '../src/database/prisma.service.js';
import { uploadProblem } from '../src/provider/provider-documents.service.js';
import { signedUploadExpiry } from '../src/integrations/supabase-storage.service.js';
import { maskedCustomerName } from '../src/complaints/disputes.service.js';
import { environmentSchema } from '../src/config/environment.schema.js';

describe('BE-011 / BE-029: locale and rupee sentences', () => {
  it('only Accept-Language values that start with ur are Urdu', () => {
    expect(localeOf('ur')).toBe('ur');
    expect(localeOf('ur-PK,ur;q=0.9,en;q=0.8')).toBe('ur');
    expect(localeOf(' UR')).toBe('ur');
    expect(localeOf('en-GB,en;q=0.9')).toBe('en');
    expect(localeOf(undefined)).toBe('en');
    expect(localeOf('')).toBe('en');
  });

  it('pick chooses the matching language', () => {
    expect(pick('ur', { en: 'a', ur: 'b' })).toBe('b');
    expect(pick('en', { en: 'a', ur: 'b' })).toBe('a');
  });

  it('renders paisa as rupees, grouped, dropping .00', () => {
    expect(rupees(50_000n)).toBe('Rs 500');
    expect(rupees(125_050)).toBe('Rs 1,250.50');
    expect(rupees(100_000_000n)).toBe('Rs 1,000,000');
    expect(rupees(5)).toBe('Rs 0.05');
    expect(rupees(50_000n, 'ur')).toBe('500 روپے');
  });
});

describe('BE-017: the rate limiter keys on the real client address', () => {
  it('collapses IPv4-mapped IPv6 and an IPv6 host to one bucket each', () => {
    expect(clientKey('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(clientKey('203.0.113.7')).toBe('203.0.113.7');
    expect(clientKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe('2001:db8:1:2::/64');
    expect(clientKey('2001:db8:1:2:1111:2222:3333:4444')).toBe('2001:db8:1:2::/64');
    expect(clientKey('2001:db8::5')).toBe('2001:db8:0:0::/64');
    expect(clientKey(undefined)).toBe('unknown');
  });

  const limited = (hops: number | boolean) => {
    const app = express();
    app.set('trust proxy', hops);
    app.use(createRateLimitMiddleware(2, 60_000));
    app.get('/', (_request, response) => void response.json({ ok: true }));
    return app;
  };
  const hit = (app: express.Express, forwarded: string) => inject(app, { method: 'GET', url: '/', remoteAddress: '10.0.0.9', headers: { 'x-forwarded-for': forwarded } });

  it('with TRUST_PROXY_HOPS=1 a caller cannot dodge the limit by inventing X-Forwarded-For entries', async () => {
    const app = limited(1);
    // The proxy appends the real peer address; whatever the caller put before it is theirs to forge.
    expect((await hit(app, 'spoof-1, 198.51.100.7')).statusCode).toBe(200);
    expect((await hit(app, 'spoof-2, 198.51.100.7')).statusCode).toBe(200);
    expect((await hit(app, 'spoof-3, 198.51.100.7')).statusCode).toBe(429);
  });

  it('different real clients behind the same proxy get their own budget', async () => {
    const app = limited(1);
    for (const ip of ['198.51.100.1', '198.51.100.2', '198.51.100.3']) {
      expect((await hit(app, ip)).statusCode).toBe(200);
      expect((await hit(app, ip)).statusCode).toBe(200);
    }
    expect((await hit(app, '198.51.100.1')).statusCode).toBe(429);
  });

  it('the environment accepts TRUST_PROXY_HOPS and leaves it unset by default', () => {
    const base = {
      DATABASE_URL: 'x', DIRECT_URL: 'x', REDIS_URL: 'x', MOCK_PAYMENT_WEBHOOK_SECRET: 'x'.repeat(16),
      JWT_ACCESS_SECRET: 'a'.repeat(32), JWT_REFRESH_SECRET: 'b'.repeat(32), CSRF_SECRET: 'c'.repeat(32), OTP_PEPPER: 'd'.repeat(32),
      TOTP_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'), CNIC_ENCRYPTION_KEY: Buffer.alloc(32, 2).toString('base64')
    };
    const parsed = environmentSchema.safeParse(base);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.TRUST_PROXY_HOPS).toBeUndefined();
      expect(parsed.data.DB_POOL_MAX).toBe(20);
      expect(parsed.data.DB_POOL_TIMEOUT_S).toBe(30);
      expect(parsed.data.REFRESH_REUSE_GRACE_SECONDS).toBe(10);
    }
    const hops = environmentSchema.safeParse({ ...base, TRUST_PROXY_HOPS: '2' });
    expect(hops.success && hops.data.TRUST_PROXY_HOPS).toBe(2);
  });
});

describe('BE-017: the Prisma pool is configured on the URL the API really uses', () => {
  it('adds connection_limit and pool_timeout when the URL has none', () => {
    const url = withPoolSettings('postgresql://u:p@localhost:5432/db?schema=public', 20, 30);
    expect(url).toContain('connection_limit=20');
    expect(url).toContain('pool_timeout=30');
    expect(url).toContain('schema=public');
  });

  it('never overrides what the URL says', () => {
    const url = withPoolSettings('postgresql://u:p@localhost:5432/db?connection_limit=5&pool_timeout=3', 20, 30);
    expect(url).toContain('connection_limit=5');
    expect(url).toContain('pool_timeout=3');
    expect(url).not.toContain('connection_limit=20');
  });

  it('leaves a value it cannot parse alone', () => {
    expect(withPoolSettings('not a url', 20, 30)).toBe('not a url');
  });
});

describe('BE-006: what a confirmed presigned document must be', () => {
  it('accepts an allowed type within its size limit', () => {
    expect(uploadProblem({ size: 1_000, contentType: 'image/jpeg' })).toBeNull();
    expect(uploadProblem({ size: 5_242_880, contentType: 'application/pdf' })).toBeNull();
    expect(uploadProblem({ size: 52_428_800, contentType: 'video/mp4' })).toBeNull();
    expect(uploadProblem({ size: 10, contentType: 'IMAGE/PNG; charset=binary' })).toBeNull();
  });

  it('refuses an oversize image, an oversize video, an empty file and a type outside the list', () => {
    expect(uploadProblem({ size: 5_242_881, contentType: 'image/jpeg' })).toMatch(/larger than the 5242880 byte limit/);
    expect(uploadProblem({ size: 52_428_801, contentType: 'video/webm' })).toMatch(/larger than the 52428800 byte limit/);
    expect(uploadProblem({ size: 0, contentType: 'image/png' })).toMatch(/empty/);
    expect(uploadProblem({ size: 10, contentType: 'application/x-msdownload' })).toMatch(/must be one of/);
    expect(uploadProblem({ size: 10, contentType: 'application/octet-stream' })).toMatch(/must be one of/);
  });

  it('the inline route ceiling covers a 5 MiB document once base64-encoded', () => {
    expect(DOCUMENT_BODY_LIMIT).toBe('8mb');
    expect(Math.ceil((5_242_880 * 4) / 3)).toBeLessThan(8 * 1024 * 1024);
  });
});

describe('BE-034: the signed upload expiry comes from the token', () => {
  const jwt = (claims: object): string => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;

  it('reads exp from the token in the signed URL', () => {
    const now = Date.parse('2026-10-29T10:00:00Z');
    const exp = Math.floor(now / 1000) + 7_200;
    expect(signedUploadExpiry(`https://x.supabase.co/storage/v1/object/upload/sign/b/k?token=${jwt({ exp })}`, now)).toBe(new Date(exp * 1000).toISOString());
  });

  it('falls back to five minutes when the token is missing, malformed or already expired', () => {
    const now = Date.parse('2026-10-29T10:00:00Z');
    const fallback = new Date(now + 300_000).toISOString();
    expect(signedUploadExpiry('https://x.supabase.co/u?token=abc', now)).toBe(fallback);
    expect(signedUploadExpiry('https://x.supabase.co/u', now)).toBe(fallback);
    expect(signedUploadExpiry('not a url', now)).toBe(fallback);
    expect(signedUploadExpiry(`https://x.supabase.co/u?token=${jwt({ exp: Math.floor(now / 1000) - 10 })}`, now)).toBe(fallback);
  });
});

describe('BE-026: the provider sees a masked customer name in a dispute', () => {
  it('keeps the first name and the last initial only', () => {
    expect(maskedCustomerName('Ayesha Khan')).toBe('Ayesha K.');
    expect(maskedCustomerName('  Muhammad  Ali  Raza ')).toBe('Muhammad R.');
    expect(maskedCustomerName('Bilal')).toBe('Bilal');
    expect(maskedCustomerName('')).toBe('');
  });
});

describe('BE-034: head() uses the exact info() lookup when it is available', () => {
  const storageWith = async (files: Record<string, unknown>) => {
    const { vi } = await import('vitest');
    const { SupabaseObjectStorage } = await import('../src/integrations/supabase-storage.service.js');
    const environment = { values: { STORAGE_PROVIDER: 'supabase', SUPABASE_URL: 'https://test.supabase.co', SUPABASE_SECRET_KEY: 'k', SUPABASE_STORAGE_BUCKET: 'verification-documents' } };
    const storage = new SupabaseObjectStorage(environment as never);
    const client = (storage as unknown as { getClient: () => { storage: { from: (bucket: string) => unknown } } }).getClient();
    vi.spyOn(client.storage, 'from').mockReturnValue(files);
    return storage;
  };

  it('answers from info() without listing a prefix', async () => {
    const { vi } = await import('vitest');
    const list = vi.fn();
    const info = vi.fn().mockResolvedValue({ data: { size: 4_096, contentType: 'image/png' }, error: null });
    const storage = await storageWith({ info, list });
    expect(await storage.head({ key: 'p/CNIC_FRONT/abc', bucket: 'documents' })).toEqual({ size: 4_096, contentType: 'image/png' });
    expect(info).toHaveBeenCalledWith('p/CNIC_FRONT/abc');
    expect(list).not.toHaveBeenCalled();
  });

  it('falls back to the prefix listing when info() fails', async () => {
    const { vi } = await import('vitest');
    const info = vi.fn().mockResolvedValue({ data: null, error: new Error('nope') });
    const list = vi.fn().mockResolvedValue({ data: [{ name: 'abc', metadata: { size: 7, mimetype: 'application/pdf' } }], error: null });
    const storage = await storageWith({ info, list });
    expect(await storage.head({ key: 'p/CNIC_FRONT/abc', bucket: 'documents' })).toEqual({ size: 7, contentType: 'application/pdf' });
  });
});

describe('BE-017: a busy connection pool is an overload answer, not a 500', () => {
  const run = async (code: string) => {
    const { Prisma } = await import('@prisma/client');
    const { ProblemDetailsFilter } = await import('../src/common/problem-details.filter.js');
    const sent: { status?: number; body?: unknown; headers: Record<string, string> } = { headers: {} };
    const response = {
      headersSent: false,
      setHeader: (name: string, value: string) => void (sent.headers[name] = value),
      status: (value: number) => {
        sent.status = value;
        return response;
      },
      type: () => response,
      json: (value: unknown) => void (sent.body = value)
    };
    const host = { switchToHttp: () => ({ getRequest: () => ({ originalUrl: '/api/v1/x', headers: {} }), getResponse: () => response }) };
    new ProblemDetailsFilter().catch(new Prisma.PrismaClientKnownRequestError('pool', { code, clientVersion: 'test' }), host as never);
    return sent;
  };

  it('P2024 / P2028 answer 429 with Retry-After', async () => {
    for (const code of ['P2024', 'P2028']) {
      const sent = await run(code);
      expect(sent.status).toBe(429);
      expect(sent.body).toMatchObject({ code: 'RATE_LIMITED' });
      expect(sent.headers['Retry-After']).toBe('2');
    }
  });

  it('any other unknown database error is still a 500', async () => {
    expect((await run('P1001')).status).toBe(500);
  });
});
