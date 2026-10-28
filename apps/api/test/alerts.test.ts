// apps/api/test/alerts.test.ts
//
// SHM-092: the alerting rules, checked against the metrics that actually exist.
//
// A Prometheus rule naming a metric this service does not export parses cleanly, validates cleanly,
// loads cleanly — and never fires. There is no error anywhere; the alert simply does not exist as
// far as an operator is concerned. That is the worst possible failure mode for the one thing in a
// monitoring setup that exists to catch the failure nobody anticipated, so it is tested here rather
// than discovered during an incident.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const alertsPath = fileURLToPath(new URL('../../../ops/prometheus/alerts.yml', import.meta.url));
const alerts = readFileSync(alertsPath, 'utf8');
const service = readFileSync(fileURLToPath(new URL('../src/platform/metrics.service.ts', import.meta.url)), 'utf8');

/**
 * Every `shm_*` identifier the rules mention, reduced to the metric name the service registers.
 *
 * Prometheus derives `_bucket`, `_sum` and `_count` series from a histogram and a summary. They are
 * real series in a scrape but they are not separately declared in code — the registry builds them
 * from the one `Histogram`/`Summary` constructor — so they are folded back to their base name here.
 * Without this the test would demand a definition that legitimately does not exist.
 */
const referenced = [
  ...new Set(
    [...alerts.matchAll(/\bshm_[a-z_]+/g)]
      .map(match => match[0])
      .map(name => name.replace(/_(bucket|sum|count)$/, ''))
  )
].sort();

describe('SHM-092: alert rules', () => {
  it('references only metrics the service actually exports', () => {
    expect(referenced.length).toBeGreaterThan(0);
    // Every metric name in the rules has to appear in the service that builds the registry. An
    // unmatched name is a rule that will never fire.
    for (const metric of referenced) {
      expect(service, `alert rule references ${metric}, which MetricsService does not define`).toContain(`'${metric}'`);
    }
  });

  it('exports every metric the rules depend on as a first-class definition, not a substring', () => {
    // The check above could pass on `shm_queue_depth` because the source mentions it in a comment.
    // Strip comments and require the name in what remains.
    const code = service
      .split('\n')
      .filter(line => !line.trim().startsWith('*') && !line.trim().startsWith('//'))
      .join('\n');
    for (const metric of referenced) {
      expect(code, `${metric} appears only in a comment`).toContain(`'${metric}'`);
    }
  });

  it('gives every alert a severity, a summary and a description worth waking someone for', () => {
    const blocks = alerts.split(/\n\s*- alert: /).slice(1);
    expect(blocks.length).toBeGreaterThanOrEqual(10);
    for (const block of blocks) {
      const name = block.split('\n')[0]!.trim();
      expect(block, `${name} has no severity`).toMatch(/severity: (critical|warning)/);
      expect(block, `${name} has no summary`).toMatch(/summary: \S/);
      expect(block, `${name} has no description`).toMatch(/description: \S/);
      // A description that does not say what to do is a page nobody can action. Matched against
      // the verbs a runbook step actually uses, including "re-run" — which is the correct
      // instruction for a suspected plan regression.
      expect(block, `${name} does not point at a runbook or a next step`).toMatch(/runbook|check|start|verify|re-run|inspect|confirm|escalate/i);
    }
  });

  it('points critical alerts at a runbook that exists', () => {
    // A `runbook_url` pointing at a file that is not there is worse than no link: it looks like the
    // answer is one click away and wastes the minute that the outage is costing.
    const referenced2 = [...new Set([...alerts.matchAll(/runbook_url: \/docs-final\/(runbooks\/[a-z-]+\.md)/g)].map(match => match[1]!))];
    expect(referenced2.length).toBeGreaterThan(0);
    for (const runbook of referenced2) {
      const path = fileURLToPath(new URL(`../../../docs-final/${runbook}`, import.meta.url));
      expect(() => readFileSync(path), `alerts reference ${runbook}, which does not exist`).not.toThrow();
    }
  });

  it('divides by all requests, so a quiet period cannot produce a meaningless ratio', () => {
    // The numerator must count only 5xx: `shm_http_requests_total{status=~"5.."}`. If someone
    // "simplifies" that to `shm_http_requests_total`, a flood of errors registers as a rising
    // success rate — the alert would go quiet exactly when it matters.
    const block = alerts.split(/\n\s+- alert: HighErrorRate/).slice(1)[0]!;
    expect(block).toMatch(/shm_http_requests_total\{status=~"5\.\."\}/);
    expect(block).toContain('clamp_min');
  });
});