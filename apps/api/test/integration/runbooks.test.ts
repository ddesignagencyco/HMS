// apps/api/test/runbooks.test.ts
//
// SHM-093: runbooks are executable documentation, and they rot silently.
//
// A runbook that names a table which no longer exists is worse than no runbook: it looks like an
// answer, it is found first during an incident, and it costs the responder the minute it costs them
// the outage. Writing these documents against the live schema is exactly how that happens — the
// first draft of `reconciliation-drift.md` invented a `reconciliation_findings` table, and
// `gateway-down.md` invented `payment_webhook_log`. Neither exists. Both were only caught because
// somebody checked, which is not a process that survives contact with a deadline.
//
// So the references are tested against the database. A table named in a runbook either exists or this
// file fails.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from './flow.js';

const runbookDirectory = fileURLToPath(new URL('../../../../docs-final/runbooks/', import.meta.url));

const runbooks = readdirSync(runbookDirectory)
  .filter(name => name.endsWith('.md'))
  .map(name => ({ name, text: readFileSync(runbookDirectory + name, 'utf8') }));

/**
 * Table names in the runbooks' SQL blocks only.
 *
 * Scoped to fenced ```sql blocks on purpose. Scanning the whole document also matches English —
 * "recovered from it" parses as `FROM it` — which is a false positive that would train everyone to
 * ignore this check, and a check that cries wolf is worse than no check at all.
 */
const tablesIn = (text: string): string[] =>
  [...text.matchAll(/```sql\n([\s\S]*?)```/g)]
    .flatMap(match => [...match[1]!.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+([a-z_][a-z0-9_]*)/gi)].map(found => found[1]!.toLowerCase()))
    // `pg_catalog` views and CTE/subquery names are not tables this repository owns.
    .filter(name => !name.startsWith('pg_') && !['select', 'where', 'values', 'set', 'only', 'lateral'].includes(name));

let live: Set<string>;

beforeAll(async () => {
  const rows = await prisma.$queryRaw<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`;
  live = new Set(rows.map(row => row.table_name.toLowerCase()));
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('SHM-093: runbooks reference the real schema', () => {
  it('found the runbooks to check', () => {
    // A glob that matches nothing would pass every assertion below vacuously, which is the failure
    // mode this whole file exists to prevent.
    expect(runbooks.length).toBeGreaterThanOrEqual(4);
  });

  for (const { name, text } of runbooks) {
    it(`${name} only names tables that exist`, () => {
      const referenced = [...new Set(tablesIn(text))];
      // Not every runbook needs SQL — the API one is entirely shell commands against health and
      // metrics endpoints. Asserting a table reference there would be asserting an irrelevant thing,
      // and a check that must be satisfied by padding is a check that stops being believed.
      if (referenced.length === 0) {
        expect(text, `${name} has neither SQL nor shell commands to run`).toMatch(/```bash/);
        return;
      }
      for (const table of referenced) {
        expect(live, `${name} references table "${table}", which does not exist`).toContain(table);
      }
    });
  }

  for (const { name, text } of runbooks) {
    it(`${name} sends a responder to a next step`, () => {
      // The point of a runbook is to change what someone does. Prose that describes a situation
      // without saying what to do about it is an article.
      expect(text.length).toBeGreaterThan(800);
      expect(text, `${name} never says how to check anything`).toMatch(/```(bash|sql)/);
      expect(text, `${name} gives no condition for escalating`).toMatch(/escalat/i);
    });
  }
});
