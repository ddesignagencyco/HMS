// packages/db/scripts/backup.mjs
//
// SHM-093 / NFR-AV: the backup.
//
// The design is shaped by one fact: **a backup that has never been restored is not a backup, it is a
// file.** So this script does not merely produce a dump and exit — it verifies what it wrote, on
// every run, automatically. A dump that cannot be listed by `pg_restore` is a corrupt dump, and
// finding that out during a restore is the worst possible time.
//
// What is and is not backed up, stated plainly because the gap matters more than the feature:
//
//   Backed up:  the Postgres database. That is the system of record for bookings, money, users and
//               every audit row. It is the only thing here whose loss is unrecoverable.
//   NOT backed up: uploaded evidence photos and documents. They live behind `ObjectStoragePort`,
//                 which is currently the **mock** adapter, so the bytes are in the database and a
//                 dump captures them — but as soon as a real S3 adapter ships (SHM-095/096) this
//                 script must also snapshot that bucket, and until then "we have a backup" is true
//                 of the database and *not* of the files.
//   NOT backed up: Redis. Deliberate. Redis holds the settings cache, rate-limit windows, BullMQ
//                 queues and session revocation state. Every one of those is either rebuilt from
//                 the database on demand (settings cache) or safe to lose (a queue re-enqueues
//                 unfinished work from the outbox; sessions can be re-issued by logging in again).
//                 Backing it up would add a restore-order dependency — Redis must not be restored
//                 to a *newer* state than the database — in exchange for saving nothing.
//
// `--help` prints usage. Exits non-zero on any failure, because this is meant to run from cron or CI
// where a quiet success that wrote nothing is the worst possible outcome.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const backupDirectory = resolve(process.env.BACKUP_DIR ?? resolve(here, '../../../backups'));
const retention = Number(process.env.BACKUP_RETENTION ?? 7);
const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

if (process.argv.includes('--help')) {
  process.stdout.write(`Usage: npm run db:backup

  BACKUP_DIR        where dumps are written (default: <repo>/backups)
  BACKUP_RETENTION  how many to keep, oldest pruned (default: 7)
  DATABASE_URL      connection string (falls back to DIRECT_URL)

Writes a custom-format dump, verifies it, records a manifest, and prunes.
`);
  process.exit(0);
}

if (databaseUrl === undefined) {
  fail('DATABASE_URL or DIRECT_URL must be set — there is no default to fall back to, and guessing one would write an empty file and call it a backup.');
}

mkdirSync(backupDirectory, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const file = resolve(backupDirectory, `smart_home-${stamp}.dump`);
const startedAt = Date.now();

/**
 * `pg_dump` runs in the database container rather than on the host.
 *
 * This is not a stylistic choice. The `migration-fidelity` CI job has to `apt-get install
 * postgresql-client-16` explicitly, because a host `psql`/`pg_dump` older than the server refuses to
 * read it — and the host image ships whichever version Ubuntu happens to carry. Running the client
 * inside the `postgis/postgis:16-3.4` container removes that entire class of mismatch: the client and
 * the server are always the same version. Override with `PG_CONTAINER=` to use a local binary.
 */
const container = process.env.PG_CONTAINER ?? 'smart-home-postgis';
const inContainer = process.env.PG_CONTAINER !== '' && execFileSync('docker', ['inspect', container], { stdio: 'pipe' });

const url = new URL(databaseUrl);
const user = decodeURIComponent(url.username);
const database = decodeURIComponent(url.pathname.slice(1));

/** Runs one of the postgres tools, inside the container if there is one. */
const pgTool = (tool, args) => {
  const full = inContainer
    ? ['exec', '-e', 'PGPASSWORD=' + decodeURIComponent(url.password), container, tool, ...args]
    : [tool, ...args];
  const result = spawnSync(inContainer ? 'docker' : tool, full, { stdio: ['ignore', 'pipe', 'pipe'] });
  return result;
};

log('dumping...');
const dump = pgTool('pg_dump', ['-U', user, '-d', database, '--format=custom', '--compress=9', '--no-owner', '--no-privileges', '-f', '/tmp/backup.dump']);
if (dump.status !== 0) {
  process.stderr.write(dump.stderr.toString());
  fail(`pg_dump failed with status ${dump.status}. Nothing was written to ${file}.`);
}

// Pull the dump back out of the container into the backup directory.
if (inContainer) {
  const copy = spawnSync('docker', ['cp', `${container}:/tmp/backup.dump`, file], { stdio: ['ignore', 'pipe', 'pipe'] });
  if (copy.status !== 0) {
    process.stderr.write(copy.stderr.toString());
    fail('the dump completed inside the container but could not be copied out. The database is fine; the backup did not happen.');
  }
  spawnSync('docker', ['exec', container, 'rm', '-f', '/tmp/backup.dump'], { stdio: 'ignore' });
}

const sizeBytes = statSync(file).size;
if (sizeBytes === 0) fail('the dump is empty. An empty dump is the failure mode this script exists to prevent, and it is not being reported as a success.');

/**
 * Verify, on every run, that the file just written can actually be read back.
 *
 * `pg_restore --list` parses the archive's table of contents without applying anything, so it is
 * cheap and safe to run against a live server. **Stated limit:** it proves the archive is
 * structurally intact and readable, not that every row can be restored — only an actual restore
 * proves that, which is what the restore drill in `docs-final/runbooks/restore-drill.md` is for.
 * This is the cheap check that catches truncation and corruption; the drill is the real one.
 */
log('verifying...');
let toc;
if (inContainer) {
  // The verifier reads the same bytes an operator would later restore, so the file is copied in
  // rather than the check being run against the dump's original location inside the container.
  const staged = spawnSync('docker', ['cp', file, `${container}:/tmp/verify.dump`], { stdio: ['ignore', 'pipe', 'pipe'] });
  if (staged.status !== 0) {
    process.stderr.write(staged.stderr.toString());
    fail('the dump was written but could not be staged for verification. It has not been counted as a good backup.');
  }
  const real = pgTool('pg_restore', ['--list', '/tmp/verify.dump']);
  if (real.status !== 0) {
    process.stderr.write(real.stderr.toString());
    fail('the dump was written but pg_restore cannot read it. This backup is unusable and has been left in place only so it can be inspected — do not ship it offsite.');
  }
  toc = real.stdout.toString();
  spawnSync('docker', ['exec', container, 'rm', '-f', '/tmp/verify.dump'], { stdio: 'ignore' });
} else {
  const real = pgTool('pg_restore', ['--list', file]);
  if (real.status !== 0) {
    process.stderr.write(real.stderr.toString());
    fail('the dump was written but pg_restore cannot read it. This backup is unusable.');
  }
  toc = real.stdout.toString();
}

const entries = toc.split('\n').filter(line => line.trim() !== '' && !line.startsWith(';')).length;
if (entries === 0) fail('the archive lists no entries. That is not an empty database, it is a dump that restored nothing — treating it as a failure.');
writeManifest({ file, sizeBytes, entries, elapsedMs: Date.now() - startedAt, tocSample: toc.split('\n').slice(0, 8) });

log('done');
prune();

function writeManifest({ file: path, sizeBytes: bytes, entries, elapsedMs, tocSample }) {
  // The checksum is the thing that makes an offsite copy trustworthy: it is what proves the bytes
  // that arrived somewhere else are the bytes that left here. Written next to the dump rather than
  // inside the manifest file, so it can be verified with a single `sha256sum -c`.
  const checksum = createHash('sha256').update(readFileSync(path)).digest('hex');
  writeFileSync(`${path}.sha256`, `${checksum}  ${path.split(/[\\/]/).pop()}\n`);

  const manifest = {
    file: path.split(/[\\/]/).pop(),
    createdAt: new Date().toISOString(),
    sizeBytes: bytes,
    sha256: checksum,
    tocEntries: entries,
    durationMs: elapsedMs,
    format: 'pg_dump custom, gzip -9, no owner/privileges',
    contents: tocSample,
    // What this dump does *not* contain. Carried in the artefact itself so that anyone who finds a
    // backup file months later learns its limits from the file, not from having to ask.
    excludes: ['Redis (rebuildable: settings cache, rate limits, queues, sessions)', 'Object storage — currently the mock adapter; a real S3 adapter must add a bucket snapshot here']
  };
  writeFileSync(`${path}.manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  log(`${path.split(/[\\/]/).pop()}  ${(bytes / 1048576).toFixed(1)} MB  ${entries} TOC entries  ${(elapsedMs / 1000).toFixed(1)}s`);
  log(`sha256 ${checksum.slice(0, 16)}…`);
}

/**
 * Prune to the retention count, newest first.
 *
 * Deletes whole triples — dump, checksum and manifest — and only ever removes the *oldest*, so a
 * failure part-way through pruning cannot leave the most recent backup deleted. A leftover `.dump`
 * with no `.manifest.json` would otherwise accumulate silently and eventually fill the disk.
 */
function prune() {
  const dumps = readdirSync(backupDirectory)
    .filter(name => name.endsWith('.dump'))
    .map(name => ({ name, at: statSync(resolve(backupDirectory, name)).mtimeMs }))
    .sort((a, b) => b.at - a.at);

  for (const old of dumps.slice(retention)) {
    for (const suffix of ['', '.sha256', '.manifest.json']) {
      const path = resolve(backupDirectory, old.name + suffix);
      if (existsSync(path)) rmSync(path);
    }
    log(`pruned ${old.name}`);
  }
}

function log(message) {
  process.stdout.write(`[backup] ${message}\n`);
}

function fail(message) {
  process.stderr.write(`[backup] FAILED: ${message}\n`);
  process.exit(1);
}
