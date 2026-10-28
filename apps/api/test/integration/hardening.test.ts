// apps/api/test/integration/hardening.test.ts
//
// SHM-092: the security headers and the metrics endpoint.
//
// These are properties of the *response surface*, not of any business flow, which is why they can be
// asserted without setting up a booking. What is being checked is that a browser is told what it may
// do, and that a scrape cannot see anything it should not.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { inject } from 'light-my-request';
import { normalisePath } from '../../src/http-app.js';
import { MetricsService } from '../../src/platform/metrics.service.js';
import { callApi, createTestApp, staffSession } from './harness.js';
import { bearer, prisma } from './flow.js';

/**
 * `callApi` rewrites every path to sit under the `/api/v1` global prefix, because that is where
 * business routes live. The routes asserted here — the health check, the scrape endpoint and the
 * Swagger UI — are all deliberately *excluded* from that prefix, so they have to be requested at
 * their real paths instead.
 */
const callRoot = async (app: NestExpressApplication, path: string): Promise<{ status: number; headers: Record<string, string>; body: string }> => {
  const response = await inject(app.getHttpAdapter().getInstance(), { method: 'GET', url: path });
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(response.headers)) {
    if (typeof value === 'string') headers[name] = value;
  }
  const payload = response.payload;
  return { status: response.statusCode, headers, body: typeof payload === 'string' ? payload : String(payload ?? '') };
};

let app: NestExpressApplication;
let close: () => Promise<void>;
let finance: { accessToken: string; userId: string };

beforeAll(async () => {
  const started = await createTestApp();
  app = started.app;
  close = started.close;
  finance = await staffSession(app, 'finance@smart-home.local');
});

afterAll(async () => {
  await close();
  await prisma.$disconnect();
});

describe('SHM-092: security headers', () => {
  it('serves JSON with a default-src of none, so a response that is somehow HTML executes nothing', async () => {
    const response = await callRoot(app, '/health/ready');
    expect(response.status).toBe(200);
    const csp = String(response.headers['content-security-policy']);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('issues a different nonce per request on the one route that serves HTML', async () => {
    // JSON routes get `default-src 'none'` and carry no nonce, which is correct: there is no inline
    // script on them to authorise. The Swagger UI at /api/docs is the only page that runs script,
    // so that is where a nonce has to exist — and it has to differ every time.
    const first = await callRoot(app, '/api/docs');
    const second = await callRoot(app, '/api/docs');
    const nonceOf = (header: string): string => /'nonce-([^']+)'/.exec(header)?.[1] ?? '';
    // A fixed nonce is in the HTML of every response, so anyone who reads one knows the nonce for all
    // of them and the policy stops constraining anything. This is the check that keeps it honest.
    expect(nonceOf(String(first.headers['content-security-policy']))).not.toBe('');
    expect(nonceOf(String(first.headers['content-security-policy']))).not.toBe(nonceOf(String(second.headers['content-security-policy'])));
  });

  it('serves a Swagger page whose own assets the policy it returns actually permits', async () => {
    // /api/docs rendered blank. The page loads three scripts as static <script src> tags with no
    // nonce, and @nestjs/swagger offers no hook to add one. Under 'strict-dynamic' a browser ignores
    // every host and 'self' allowlist and trusts only nonced scripts, so all three were blocked --
    // and adding 'self' does not fix it, because under 'strict-dynamic' 'self' is ignored too.
    //
    // Rather than assert a policy string, this reads the HTML the service actually serves and checks
    // that the policy it sends would let those assets run. If Nest ever starts serving Swagger from
    // a CDN, or adds an inline script, the requirement here moves and this fails rather than the page
    // quietly going blank in a developer's browser.
    const response = await callRoot(app, '/api/docs');
    expect(response.status).toBe(200);
    const csp = String(response.headers['content-security-policy']);
    const scriptSrc = /script-src ([^;]*)/.exec(csp)?.[1] ?? '';

    // Every script and stylesheet the page references is same-origin, so 'self' is what has to
    // permit them. Asserted about the page's real content, not a hardcoded list.
    const assets = [...response.body.matchAll(/<(?:script[^>]*src|link[^>]*href)="([^"]+)"/g)].map(match => match[1] ?? '');
    const scripts = [...response.body.matchAll(/<script[^>]*src="([^"]+)"/g)].map(match => match[1] ?? '');
    expect(scripts.length).toBeGreaterThan(0);
    for (const asset of [...assets, ...scripts]) expect(asset, `Swagger loads ${asset}, which is not same-origin`).toMatch(/^\.\/docs\//);

    // So: 'self' present, and 'strict-dynamic' absent — the combination that blocks every static tag.
    expect(scriptSrc).toContain("'self'");
    expect(csp).not.toContain('strict-dynamic');
    // And the nonce is still issued for any inline script added later.
    expect(/'nonce-[^']+'/.test(scriptSrc)).toBe(true);

    // `https:` allowed any host on the internet to introduce a script into this page and bought
    // nothing, because the page loads nothing from a CDN. Dropping it is a tightening, not a
    // concession -- so assert it cannot quietly come back.
    expect(scriptSrc).not.toContain('https:');
  });

  it('locks down everything a browser can be asked to do that this API never needs', async () => {
    const response = await callRoot(app, '/health/ready');
    expect(String(response.headers['permissions-policy'])).toContain('camera=()');
    expect(String(response.headers['permissions-policy'])).toContain('microphone=()');
    expect(String(response.headers['x-content-type-options'])).toBe('nosniff');
  });

  it('does not promise HSTS over plain http in development', async () => {
    // Asserting it in development would pin a developer's browser to https://localhost for an hour
    // every time they ran the app. The production case is covered by the environment schema's own
    // refusal to boot with development secrets.
    const response = await callRoot(app, '/health/ready');
    expect(response.headers['strict-transport-security']).toBeUndefined();
  });
});

describe('SHM-092: metrics', () => {
  it('exposes queue depths and an outbox backlog, recomputed on scrape', async () => {
    const response = await callRoot(app, '/metrics');
    expect(response.status).toBe(200);
    const body = response.body;
    // Asserted on a **series**, not on the name appearing somewhere in the text. Prometheus emits a
    // `# HELP` line for a metric that has never been set, so a check like `toContain('shm_queue_depth')`
    // passes for a gauge that is permanently empty -- and a metric that is permanently empty is
    // exactly the failure this endpoint exists to prevent.
    for (const queue of ['outbox', 'notifications', 'payments', 'verification', 'projections']) {
      expect(body, `shm_queue_depth has no series for the "${queue}" queue`).toMatch(new RegExp(`^shm_queue_depth\\{queue="${queue}"\\} \\d+$`, 'm'));
    }
    expect(body).toMatch(/^shm_outbox_undispatched \d+$/m);
    expect(body).toMatch(/^shm_outbox_oldest_seconds \d+(\.\d+)?$/m);
    expect(body).toMatch(/^shm_escrow_held_paisa \d+$/m);
    // The default process/event-loop metrics come for free and are worth having.
    expect(body).toContain('process_cpu_user_seconds_total');
  });

  it('is reachable without a token, because a scrape has none, and leaks nothing when it is', async () => {
    // Drive the API first: the response that records the in-flight scrape is only written *after*
    // the handler has already built its body, so a scrape can never observe itself.
    await callApi(app, '/bookings/12345678', bearer(finance.accessToken));
    const response = await callRoot(app, '/metrics');
    expect(response.status).toBe(200);
    const body = (await callRoot(app, '/metrics')).body;
    // The whole argument for an unauthenticated metrics endpoint is that it carries no business
    // data. Asserted here rather than assumed: no email, no phone, no name, no id-shaped label.
    expect(body).not.toMatch(/@smart-home\.local/);
    expect(body).not.toMatch(/\+92\d{10}/);

    // This service's own series may only carry the fixed label set it declares. A label carrying a
    // booking id or a user id would make the metric store grow with the business instead of with the
    // code, which is the failure mode that takes the store down rather than the API.
    // `le` and `quantile` come from prom-client's histogram and summary machinery; they are bounded
    // by the bucket list this file declares, so they cannot grow with the business.
    const ownLabels = new Set(['method', 'route', 'status', 'name', 'outcome', 'check', 'queue', 'le', 'quantile']);
    for (const line of body.split('\n').filter(line => line.startsWith('shm_'))) {
      const [, labelBlock] = /^[a-z_]+(\{[^}]*})/.exec(line) ?? [];
      for (const name of [...(labelBlock ?? '').matchAll(/([a-z_]+)="/g)].map(match => match[1]!)) {
        expect(ownLabels.has(name), `${line} carries an unexpected label "${name}"`).toBe(true);
      }
    }

    // The vendor metrics that come for free are a fixed, known list. Pinning it means a dependency
    // bump that quietly starts emitting something new — with new labels — shows up as a test
    // failure rather than as a metric store nobody is watching any more.
    const vendor = new Set([
      'process_cpu_user_seconds_total',
      'process_cpu_system_seconds_total',
      'process_cpu_seconds_total',
      'process_start_time_seconds',
      'process_resident_memory_bytes',
      'process_virtual_memory_bytes',
      'process_heap_bytes',
      'process_open_fds',
      'process_max_fds',
      'nodejs_eventloop_lag_seconds',
      'nodejs_eventloop_lag_min_seconds',
      'nodejs_eventloop_lag_max_seconds',
      'nodejs_eventloop_lag_mean_seconds',
      'nodejs_eventloop_lag_stddev_seconds',
      // The event-loop lag summary exports its percentiles as their own series. They are registered
      // whether or not they have been observed, so they have to be here even on a machine where
      // nothing has been measured long enough to compute a quantile.
      'nodejs_eventloop_lag_p50_seconds',
      'nodejs_eventloop_lag_p90_seconds',
      'nodejs_eventloop_lag_p99_seconds',
      'nodejs_active_resources',
      'nodejs_active_resources_total',
      'nodejs_active_handles',
      'nodejs_active_handles_total',
      'nodejs_active_requests',
      'nodejs_active_requests_total',
      'nodejs_heap_size_total_bytes',
      'nodejs_heap_size_used_bytes',
      'nodejs_external_memory_bytes',
      'nodejs_heap_space_size_total_bytes',
      'nodejs_heap_space_size_used_bytes',
      'nodejs_heap_space_size_available_bytes',
      'nodejs_version_info',
      'nodejs_gc_duration_seconds'
    ]);
    // A histogram or summary does not export one line, it exports a family: `foo` on the wire is
    // `foo_bucket`, `foo_sum` and `foo_count`. Those suffixes are mechanical, so the list below
    // holds the family name and this strips the components rather than carrying three more entries
    // per histogram. Stripping does not weaken the guard: a metric nobody allowlisted still has to
    // match a name in the set once its components are removed.
    //
    // The suffix is only removed when what remains is in the set, so a genuinely new family
    // (`nodejs_something_new_count`) is still rejected. The residual risk is a real metric whose
    // own name ends in one of these three, which prom-client does not produce.
    const components = new Set(['_bucket', '_sum', '_count']);
    const familyOf = (name: string): string => {
      for (const suffix of components) {
        if (name.endsWith(suffix) && vendor.has(name.slice(0, -suffix.length))) return name.slice(0, -suffix.length);
      }
      return name;
    };
    for (const line of body.split('\n')) {
      const name = /^([a-z_]+)[{ ]/.exec(line)?.[1];
      if (name === undefined || name.startsWith('shm_')) continue;
      expect(vendor.has(familyOf(name)), `unexpected metric "${name}"`).toBe(true);
    }

    // The loop above only proves anything about a histogram's family when the scrape happens to
    // contain one. `nodejs_gc_duration_seconds` emits nothing at all until V8 has actually run a
    // garbage collection, so on a quiet machine that family is untested and the check silently
    // covers less than it appears to. Assert the registered families instead, which are present
    // whether or not they have been observed: the GC histogram must be among them, and nothing
    // outside the allowlist may be registered at all.
    //
    // This is the check that would have caught the original defect without depending on the
    // machine's memory pressure.
    const registry = app.get(MetricsService).registry;
    const families = new Set(registry.getMetricsAsArray().map(metric => metric.name));
    expect(families.has('nodejs_gc_duration_seconds'), 'the GC histogram is no longer collected, so the scrape check above is vacuous').toBe(true);
    for (const name of families) {
      expect(name.startsWith('shm_') || vendor.has(name), `unexpected metric family "${name}"`).toBe(true);
    }
  });

  it('counts requests under the matched route, not the concrete URL', async () => {
    // A request that does not resolve to a handler still has to be counted, and still has to be
    // counted under a shape — otherwise a 404 storm becomes an unbounded number of metric series,
    // which is the failure mode that takes down the metric store rather than the API.
    await callApi(app, '/bookings/12345678', bearer(finance.accessToken));
    await callRoot(app, '/health/ready');
    const body = (await callRoot(app, '/metrics')).body;
    // A metric series per booking id would be unbounded cardinality — one series per booking, for
    // ever. The route label has to collapse ids.
    expect(body).toMatch(/shm_http_requests_total\{[^}]*route="[^"]*bookings\/\{n\}[^"]*"/);
    expect(normalisePath('/bookings/9f3a1c22-0000-4000-8000-000000000001/evidence')).toBe('/bookings/{id}/evidence');
  });
});