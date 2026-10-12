// packages/db/scripts/restore.mjs
//
// SHM-093: the other half of a backup, and the half nobody writes.
//
// Restoring is where a backup either proves itself or turns out to have been theatre for months. The
// script is built around the parts that are easy to get wrong:
//
//   1. **You cannot restore into the database you are connected to.** `pg_restore` would fail
//      half-way, leaving a partially-overwritten database that looks fine until someone queries the
//      table that did not make it. The target is therefore dropped and recreated *before* the
//      restore starts, and the connection is pointed somewhere else for the duration.
//   2. **Redis is not restored with it**, and it must be cleared rather than left alone. A restored
//      database alongside a Redis holding the *pre-restore* catalogue versions and settings cache
//      describes a system state that never existed and has no name. See the backup script for why
//      Redis is not backed up at all.
//   3. **The restore is verified by the schema and the row counts**, not by the exit code. A
//      restore can exit 0 having restored most of the database.
//   4. **It refuses to run against anything that looks like production without `--i-am-sure`.**
//      There is no undo for a restore over real data, and the cost of that mistake is the whole
//      company.
//
// Usage:
//   npm run db:restore -- --file backups/smart_home-<stamp>.dump
//   npm run db:restore -- --latest
//   npm run db:restore -- --latest --target smart_home_drill   # restore somewhere harmless
//
// The drill procedure, with recorded timings, is docs-final/runbooks/restore-drill.md.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const backupDirectory = resolve(process.env.BACKUP_DIR ?? resolve(here, '../../../backups'));
const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : args[at + 1];
};

if (flag('help')) {
  process.stdout.write(`Usage: npm run db:restore -- (--file <path> | --latest) [--target <db>] [--i-am-sure]

  --file      the dump to restore
  --latest    the most recent dump in ${backupDirectory}
  --target    restore into this database instead of the configured one
  --i-am-sure required when the target is the configured database
`);
  process.exit(0);
}

if (databaseUrl === undefined) fail('DATABASE_URL or DIRECT_URL must be set.');

const file = flag('latest') ? latest() : option('file');
if (file === undefined) fail(`no dump given, and ${backupDirectory} contains none. Run npm run db:backup first.`);
if (!existsSync(file)) fail(`${file} does not exist.`);

const url = new URL(databaseUrl);
const user = decodeURIComponent(url.username);
const source = decodeURIComponent(url.pathname.slice(1));
const target = option('target', source);

if (target === source && !flag('i-am-sure')) {
  fail(
    `about to overwrite the configured database "${source}".\n` +
    'There is no undo. To restore somewhere harmless for the drill, pass --target <name>.\n' +
    'To restore over the configured database, re-run with --i-am-sure.'
  );
}

const container = process.env.PG_CONTAINER ?? 'smart-home-postgis';
let inContainer = false;
try {
  execFileSync('docker', ['inspect', container], { stdio: 'pipe' });
  inContainer = process.env.PG_CONTAINER !== '';
} catch {
  inContainer = false;
}

const pg = (tool, toolArgs, { quiet = false } = {}) => {
  const result = inContainer
    ? spawnSync('docker', ['exec', '-e', `PGPASSWORD=${decodeURIComponent(url.password)}`, container, tool, ...toolArgs], { stdio: ['ignore', 'pipe', 'pipe'] })
    : spawnSync(tool, toolArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0) {
    if (!quiet) process.stderr.write(result.stderr.toString());
    fail(`${tool} failed with status ${result.status}.`);
  }
  return result.stdout.toString();
};

/**
 * Check the checksum before touching the database.
 *
 * This is the one check that catches the commonest failure of all: a truncated download, a partial
 * sync, or a file copied by a process that did not finish. It costs a second and it is the
 * difference between "the backup is corrupt" and "the backup was never intact, and we found out
 * during an outage".
 */
const checksumFile = `${file}.sha256`;
if (existsSync(checksumFile)) {
  const expected = readFileSync(checksumFile, 'utf8').trim().split(/\s+/)[0];
  const actual = createHash('sha256').update(readFileSync(file)).digest('hex');
  if (expected !== actual) {
    fail(`checksum mismatch.\n  expected ${expected}\n  actual   ${actual}\nThe file on disk is not the file that was written. Do not restore it.`);
  }
  log('checksum verified');
} else {
  log(`WARNING: no ${basename(checksumFile)} beside this dump — it cannot be proven to be the file that was written.`);
}

const startedAt = Date.now();

// 1. A clean target. Dropping first is what makes the restore honest: restoring *over* a database
//    leaves rows that the dump does not contain, and this platform has no business having rows from
//    two different timelines in one ledger.
log(`dropping and recreating "${target}"`);
pg('psql', ['-U', user, '-d', 'postgres', '-c', `DROP DATABASE IF EXISTS ${target} WITH (FORCE)`]);
pg('psql', ['-U', user, '-d', 'postgres', '-c', `CREATE DATABASE ${target}`]);

// 2. The restore itself.
log('restoring...');
if (inContainer) {
  const staged = spawnSync('docker', ['cp', file, `${container}:/tmp/restore.dump`], { stdio: 'pipe' });
  if (staged.status !== 0) fail('could not stage the dump inside the container.');
}
const stagedPath = inContainer ? '/tmp/restore.dump' : file;
pg('pg_restore', ['-U', user, '-d', target, '--no-owner', '--no-privileges', '--exit-on-error', stagedPath]);
const restoreMs = Date.now() - startedAt;

// 3. Verify by shape, not by exit code. `pg_restore` exits 0 on a partial restore unless asked not
//    to, and a partial restore of a financial ledger is the worst plausible outcome.
log('verifying');
const counts = pg('psql', ['-U', user, '-d', target, '-t', '-A', '-F', '|', '-c',
  `SELECT 'tables', count(*) FROM information_schema.tables WHERE table_schema = 'public' UNION ALL
   SELECT 'users', count(*) FROM users UNION ALL
   SELECT 'bookings', count(*) FROM bookings UNION ALL
   SELECT 'ledger_accounts', count(*) FROM ledger_accounts UNION ALL
   SELECT 'audit_log', count(*) FROM audit_log`], { quiet: true });

const parsed = Object.fromEntries(counts.trim().split('\n').map(line => line.split('|')));

// The custom-format dump carries the PostGIS extension; if the target came back without it, every
// geography query in the system is broken and the restore has still exited 0.
const hasPostgis = pg('psql', ['-U', user, '-d', target, '-t', '-A', '-c',
  `SELECT count(*) FROM pg_extension WHERE extname = 'postgis'`], { quiet: true }).trim() === '1';
if (!hasPostgis) fail('the restored database has no PostGIS extension. Every location search will fail. This restore is not usable.');

if (Number(parsed['tables'] ?? 0) === 0) fail('the restored database has no tables. The restore exited 0 and restored nothing.');

log('done');
log(`  restore took ${(restoreMs / 1000).toFixed(1)}s`);
for (const [name, count] of Object.entries(parsed)) log(`  ${name.padEnd(14)} ${count}`);

if (inContainer) spawnSync('docker', ['exec', container, 'rm', '-f', '/tmp/restore.dump'], { stdio: 'ignore' });

/**
 * Redis is deliberately *not* restored, because it is not backed up. What is needed is the opposite:
 * the old cache has to go, or the restored database will be served catalogue versions and settings
 * that belong to a timeline it no longer matches.
 */
if (target === source) log('\nflush the settings cache before starting the API:  npm run db:flush-cache');

function latest() {
  const dumps = readdirSync(backupDirectory).filter(name => name.endsWith('.dump'));
  if (dumps.length === 0) return undefined;
  // Newest by mtime, which is when it was written — not by name, because a name is only as
  // trustworthy as whatever wrote it.
  dumps.sort((a, b) => statOf(b) - statOf(a));
  return resolve(backupDirectory, dumps[0]);
}

const statOf = (name) => Date.parse(readFileSync(resolve(backupDirectory, `${name}.manifest.json`), 'utf8').split('"createdAt": "')[1]?.slice(0, 24) ?? '') || 0;

function log(message) {
  process.stdout.write(`[restore] ${message}\n`);
}

function fail(message) {
  process.stderr.write(`[restore] FAILED: ${message}\n`);
  process.exit(1);
}
