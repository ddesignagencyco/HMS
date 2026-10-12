// k6/load-search.js
//
// SHM-092's search load test, and the evidence for SHM-110/FR-SR-07's "p95 < 800 ms at 10 000
// providers".
//
// Two things worth knowing before reading a number out of this:
//
// 1. **It needs the load dataset.** `npm run seed:load` first. Against the ordinary seed there are
//    a handful of providers and the test would pass while proving nothing — which is exactly how a
//    performance criterion ends up ticked on evidence that does not support it.
// 2. **It measures HTTP, end to end**, not the database query. The query itself was measured
//    separately at 10 000 providers (see PROGRESS_TRACKER §8, 11 Oct 2026) at p50 13.8 ms / max
//    17.4 ms — comfortably inside budget — but that number excludes serialisation, ranking in the
//    application, and the network, so it is not the number this ticket is judged on.
//
// Run:  k6 run -e BASE_URL=http://localhost:3000 k6/load-search.js
//      k6 run -e BASE_URL=... -e THRESHOLD_MS=800 --summary-export=search-summary.json k6/load-search.js
//
// The FR-SR-07 target is *search p95 < 800 ms at 50 rps*. That is deliberately far slower than what
// this build achieves: the point of the threshold is to catch a regression that makes search slow,
// not to certify today's number.

import http from 'k6/http';
import { check } from 'k6';

const BASE_URL = __ENV.BASE_URL ?? 'http://localhost:3000';
const THRESHOLD_MS = Number(__ENV.THRESHOLD_MS ?? 800);

// Read from a seeded area so the point is somewhere providers actually are. A point in the wrong
// part of the city returns zero results instantly, which is the fastest possible response and a
// completely useless measurement — the first draft of this file had exactly that bug.
const SERVICE_SLUG = __ENV.SERVICE_SLUG ?? 'door-window-repair';
const LAT = __ENV.LAT ?? '31.32502';
const LNG = __ENV.LNG ?? '74.24062';

export const options = {
  scenarios: {
    search: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.RPS ?? 50),
      timeUnit: '1s',
      duration: __ENV.DURATION ?? '1m',
      preAllocatedVUs: 20,
      maxVUs: 100
    }
  },
  thresholds: {
    // The criterion under test.
    http_req_duration: [`p(95)<${THRESHOLD_MS}`],
    // A search that 500s is not "fast", and a threshold on latency alone would happily pass a
    // service returning errors as fast as it can produce them.
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99']
  }
};

export default function searchProviders() {
  const url = `${BASE_URL}/api/v1/search/providers?serviceSlug=${SERVICE_SLUG}&lat=${LAT}&lng=${LNG}`;
  const response = http.get(url, { tags: { endpoint: 'search-providers' } });

  check(response, {
    'status is 200': r => r.status === 200,
    // Zero results would satisfy every latency threshold while testing nothing at all.
    'returns providers': r => {
      if (r.status !== 200) return false;
      try {
        return JSON.parse(r.body).items.length > 0;
      } catch {
        return false;
      }
    }
  });
}

export function handleSummary(data) {
  const duration = data.metrics.http_req_duration?.values?.p95;
  console.log(`\nsearch p95 = ${duration} ms (threshold ${THRESHOLD_MS} ms)`);
  console.log(`requests   = ${data.metrics.http_reqs?.values?.count}, failed = ${data.metrics.http_req_failed?.values?.rate}`);
  if (__ENV.SUMMARY_PATH !== undefined) return { stdout: JSON.stringify(data, null, 2), [__ENV.SUMMARY_PATH]: JSON.stringify(data) };
  return { stdout: JSON.stringify({ metrics: data.metrics }, null, 2) };
}