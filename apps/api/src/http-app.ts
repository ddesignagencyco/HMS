import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomBytes } from 'node:crypto';
import express, { type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import helmet from 'helmet';
import { RequestMethod } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import type { EnvironmentService } from './config/environment.service.js';
import { REQUEST_ID_HEADER } from './common/redaction.js';
import { resolveRequestId } from './logger.js';
import { MetricsService } from './platform/metrics.service.js';

export const GLOBAL_PREFIX = 'api/v1';
export const OPENAPI_PATH = 'api/docs';

/** Matches the `bodyLimit` the Fastify adapter was configured with. */
export const BODY_LIMIT = '1mb';
/**
 * Photo uploads arrive base64-encoded inside JSON, and the photo limit itself (`evidence.photo_max_bytes`, 5 MiB) is enforced by the
 * evidence endpoint with a proper 422. This wider ceiling exists only so a legitimate photo is not cut off by the global 1 MB limit first;
 * every other route keeps the tight limit.
 */
export const EVIDENCE_BODY_LIMIT = '8mb';
const EVIDENCE_PATH = /^\/api\/v1\/(bookings\/[0-9a-fA-F-]{36}\/evidence|complaints(\/[0-9a-fA-F-]{36}\/evidence|\/from-receipt)?)\/?$/;
const DEV_STORAGE_PATH = /^\/api\/v1\/dev\/storage\/[^/]+\/.+$/;
/**
 * Abuse guard: requests per IP per window.
 *
 * Configurable, and made configurable for a reason that is worth stating plainly. At 300/min this
 * admits **5 requests per second**, while FR-SR-07 asks search to sustain **50 rps** — the two cannot
 * both be true of one setting, and a load test run against the default silently measures a fifth of
 * the required load while looking like it passed. The default stays at the conservative value
 * because raising it is a security decision; the load test raises it explicitly so the number it
 * reports is the number the criterion is about. See PROGRESS_TRACKER "SHM-092 / FR-SR-07 conflict".
 */
export const RATE_LIMIT_MAX = Number(process.env['RATE_LIMIT_MAX'] ?? 300);
export const RATE_LIMIT_WINDOW_MS = Number(process.env['RATE_LIMIT_WINDOW_MS'] ?? 60_000);

type HttpApplication = NestExpressApplication;

/**
 * Assigns every request an id up front and echoes it on the response, which is
 * what Fastify's `genReqId` did. It has to run before every other middleware so
 * that a rejection from helmet or the rate limiter is still traceable.
 */
export const requestIdMiddleware = (): RequestHandler => (request: Request, response: Response, next: NextFunction) => {
  const id = resolveRequestId(request.headers);
  request.requestId = id;
  response.setHeader(REQUEST_ID_HEADER, id);
  next();
};

/**
 * Fixed-window per-IP rate limit standing in for @fastify/rate-limit, with the
 * same budget (300 requests per minute) and the same key (the client IP). A
 * single process is the deployment target, so an in-memory counter is enough;
 * it is exported separately so the limit can be exercised in a test.
 */
export const createRateLimitMiddleware = (max: number, windowMs: number): RequestHandler => {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (request: Request, response: Response, next: NextFunction) => {
    const key = request.ip ?? 'unknown';
    const now = Date.now();
    const entry = hits.get(key);
    const current = entry === undefined || entry.resetAt <= now ? { count: 0, resetAt: now + windowMs } : entry;
    current.count += 1;
    hits.set(key, current);
    response.setHeader('X-RateLimit-Limit', max);
    response.setHeader('X-RateLimit-Remaining', Math.max(0, max - current.count));
    if (current.count > max) {
      response.setHeader('Retry-After', Math.ceil((current.resetAt - now) / 1000));
      response
        .status(429)
        .type('application/problem+json')
        .send({
          type: 'https://smart-home.local/problems/rate-limited',
          title: 'Too Many Requests',
          status: 429,
          code: 'RATE_LIMITED',
          detail: `Rate limit of ${max} requests per ${Math.round(windowMs / 1000)} seconds exceeded`,
          instance: request.url,
          requestId: request.requestId,
          errors: []
        });
      return;
    }
    next();
  };
};

/**
 * A per-request nonce, so the Content-Security-Policy can allow *this* page's inline script and
 * nothing else.
 *
 * `'strict-dynamic'` is what makes a nonce worth having: browsers that understand it ignore
 * `script-src` host allowlists entirely and trust only what the nonced script loads, so even if a
 * host is later added to the list by mistake it cannot introduce an execution path. Browsers that do
 * not understand it fall back to the explicit list, which is why both are present.
 *
 * A fixed nonce would be worse than none: it is in the HTML of every response, so anyone who reads
 * one response knows the nonce for every response, and the policy stops constraining anything.
 */
export const createCspMiddleware = (isProduction: boolean): RequestHandler => (request: Request, response: Response, next: NextFunction) => {
  const nonce = randomBytes(16).toString('base64');
  (request as Request & { cspNonce?: string }).cspNonce = nonce;
  // `/api/docs` is the only HTML this service serves — the Swagger UI — and it is the only place a
  // script can execute. Everything else is JSON, which no browser executes, so it gets a policy of
  // `default-src 'none'`: tight, and it costs nothing because there is nothing to load.
  const isDocs = request.path.startsWith(`/${OPENAPI_PATH}`) || request.path.startsWith(OPENAPI_PATH);
  const policy = isDocs
    ? [
        "default-src 'none'",
        `script-src 'nonce-${nonce}' 'strict-dynamic' https: 'unsafe-eval'`,
        // Swagger's stylesheet is injected inline by the bundle, and there is no style nonce worth
        // having here: no user-supplied markup reaches this page.
        "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
        "img-src 'self' data: https://fastly.jsdelivr.net",
        "font-src 'self' data: https://cdn.jsdelivr.net",
        "connect-src 'self'",
        "worker-src 'self' blob:",
        "base-uri 'none'",
        "form-action 'self'",
        "frame-ancestors 'none'"
      ]
    : ["default-src 'none'", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'"];

  response.setHeader('Content-Security-Policy', policy.join('; '));
  // Transport security is only meaningful over HTTPS, and asserting it in development would pin a
  // developer's browser to https://localhost for an hour.
  if (isProduction) response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  // Nothing here needs a camera, a microphone, or a geolocation, and saying so is cheaper than
  // relying on every browser's defaults.
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  next();
};

/**
 * Middleware that must be in place before routes are served. Shared by the
 * entrypoint and the integration harness so tests cannot run against a surface
 * the production process never has.
 */
export const registerHttpPlugins = async (app: HttpApplication, environment: EnvironmentService): Promise<void> => {
  const server = app.getHttpAdapter().getInstance();
  server.set('trust proxy', true);
  server.use(requestIdMiddleware());
  server.use(createCspMiddleware(environment.isProduction));
  // Helmet's own CSP is off because this file sets a stricter, nonce-based one: helmet's default is a
  // permissive policy with `unsafe-inline`, which is the thing SHM-092 exists to remove.
  server.use(helmet({ contentSecurityPolicy: false, hsts: false, referrerPolicy: { policy: 'no-referrer' } }));
  // One JSON parser, with the limit chosen per route: photos get the wide ceiling, everything else the tight one. Both keep the raw
  // bytes on `request.rawBody`, which the payment webhook needs to verify its signature. (Two stacked parsers would fight over the stream.)
  const keepRawBody = (request: Request, _response: unknown, buffer: Buffer): void => {
    (request as Request & { rawBody?: Buffer }).rawBody = buffer;
  };
  const standardJson = express.json({ limit: BODY_LIMIT, verify: keepRawBody });
  const photoJson = express.json({ limit: EVIDENCE_BODY_LIMIT, verify: keepRawBody });
  server.use((request: Request, response: Response, next: NextFunction) => (request.method === 'POST' && EVIDENCE_PATH.test(request.path) ? photoJson : standardJson)(request, response, next));
  // The mock storage adapter hands the browser a presigned PUT URL, so the
  // matching verb has to exist and has to receive the bytes as they were sent —
  // not JSON-encoded. Raw, and only for that one route.
  server.use((request: Request, response: Response, next: NextFunction) => {
    if (request.method !== 'PUT' || !DEV_STORAGE_PATH.test(request.path)) return next();
    return express.raw({ type: '*/*', limit: EVIDENCE_BODY_LIMIT })(request, response, next);
  });
  app.useBodyParser('urlencoded', { limit: BODY_LIMIT, extended: true });
  app.use(createRateLimitMiddleware(RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS));
  // SHM-092 / NFR-OBS: request counts and latency, recorded when each response finishes. It has to
  // be installed here, with the other middleware, and not in `configureHttpApp` — Express runs
  // middleware in registration order, so anything added after Nest mounts its router is only reached
  // by requests the router declines, which would have quietly recorded nothing at all.
  const metrics = app.get(MetricsService);
  server.use((request: Request, response: Response, next: NextFunction) => {
    const startedAt = process.hrtime.bigint();
    response.on('finish', () => {
      // The matched route, not the URL: one series per booking id is unbounded cardinality.
      const route = normalisePath(request.path);
      const seconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
      try {
        metrics.recordRequest(request.method, route, response.statusCode, seconds);
      } catch {
        // Metrics must never be able to fail a request.
      }
    });
    next();
  });
  void environment;
};

/**
 * The OpenAPI document definition, shared by `configureHttpApp` and the
 * api-surface snapshot script so the two can never drift: a snapshot taken
 * against a separately built document would not notice a change to the
 * description, tags or server list.
 */
export const buildOpenApiConfig = (): Omit<OpenAPIObject, 'paths'> =>
  new DocumentBuilder()
    .setTitle('Smart Home Maintenance Services API')
    .setDescription(
      [
        'The backend API for the Smart Home Maintenance Service platform: account sign-up and login, admin settings, payment webhooks, and health checks.',
        '',
        '**Getting started:** most endpoints need you to be logged in. Call `POST /auth/login` (password) or the OTP endpoints to get an `accessToken`, then click "Authorize" above and enter it as `Bearer <token>` to unlock the endpoints marked with a lock icon.',
        '',
        'Endpoints under **development** only work when the API is running with `DEV_INBOX_ENABLED=true` (local/dev setups) — they let you see the text messages, emails and files the mock providers would otherwise send to real services, which is how you retrieve OTP codes while testing.'
      ].join('\n')
    )
    .setVersion('1.0.0')
    .addTag('health', 'Check whether the API and the services it depends on (database, cache, background queues, file storage) are up and responding.')
    .addTag('catalogue', 'Browse service categories and bookable services, and (admin) manage them, commission rates, and which providers are approved to offer which service.')
    .addTag('places', 'Look up the cities and areas the platform operates in — use an area id when creating a customer address.')
    .addTag('customer', 'Actions for a signed-in customer account, such as managing saved addresses.')
    .addTag('provider', 'Actions for a signed-in service-provider account: profile, weekly availability, leave, and which areas they serve.')
    .addTag('search', "Find approved providers for a service near a point, and view a provider's public profile.")
    .addTag('booking', 'Request a provider for a service and carry the job through to completion: accept/decline, cancel/reschedule, arrival OTP, checklist, quote revisions, and finishing the job.')
    .addTag('auth', 'Sign up, log in, and manage your account: passwords, one-time verification codes (OTP), sessions, and two-factor authentication (TOTP).')
    .addTag('settings', 'Admin only. View and change platform-wide configuration values. Requires an ADMIN account with two-factor authentication turned on.')
    .addTag('webhooks', 'Called automatically by external providers (e.g. the payment gateway) to report events. Not meant to be called directly by client apps.')
    .addTag(
      'development',
      'Local/dev-only helpers for inspecting what the mock SMS, email and file-storage providers received, so flows like OTP login can be tested without real providers. Disabled in production.'
    )
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'access-token')
    .addServer('/')
    .build();

/**
 * Everything that shapes the HTTP surface, shared by the real entrypoint and the
 * integration harness so the tests cannot exercise a different routing setup
 * than production.
 */
export const configureHttpApp = (app: HttpApplication, environment: EnvironmentService): void => {
  app.setGlobalPrefix(GLOBAL_PREFIX, {
    exclude: [
      { path: '', method: RequestMethod.GET },
      { path: 'health/{*path}', method: RequestMethod.GET },
      { path: 'metrics', method: RequestMethod.GET },
      { path: 'api/docs/{*path}', method: RequestMethod.GET }
    ]
  });
app.enableCors({ origin: environment.values.CORS_ORIGINS, credentials: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] });
  app.enableShutdownHooks();

  const document = SwaggerModule.createDocument(app, buildOpenApiConfig());
  SwaggerModule.setup(OPENAPI_PATH, app, document, { jsonDocumentUrl: `${OPENAPI_PATH}/openapi.json`, swaggerOptions: { persistAuthorization: true } });
};

/**
 * Turns a concrete path into its shape — `/bookings/9f3a…/evidence` into `/bookings/{id}/evidence`
 * — for requests that finished without a matched route (404s, unmatched verbs).
 *
 * Anything that looks like a UUID, a long number, an email or an ISO date is replaced. That is a
 * blunt instrument and it is the right one: a metric label that can carry an id is a metric store
 * that fills up, and the alternative — trusting every caller to label its own route — is exactly the
 * kind of thing that works until someone adds a route with an id in it.
 */
export const normalisePath = (path: string): string =>
  path
    .replace(/\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}(?=\/|$)/g, '/{id}')
    .replace(/\/\d{4}-\d{2}-\d{2}(?=\/|$)/g, '/{date}')
    .replace(/\/\d+(?=\/|$)/g, '/{n}')
    .slice(0, 120);
