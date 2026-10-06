// packages/db/scripts/check-schema-fidelity.mjs
// Proves that docs-final/schema.sql still describes the database the migrations
// actually build.
//
// The earlier check compared the *text* of docs-final/schema.sql with the body of
// 0001_init.sql. That only works while there is exactly one migration: the first
// real schema change makes them diverge forever, because a later migration has to
// use ALTER TABLE to change an existing table while the doc restates the table in
// full. Rewriting an applied migration to keep them equal is not an option.
//
// So this builds the schema twice for real -- once by replaying every migration's
// up-section in order, once by applying the doc -- and compares `pg_dump
// --schema-only` of the two results. Same inputs, same database, so any difference
// is real drift, and it catches things a text diff cannot: a constraint Postgres
// auto-named differently on the two paths, a column type that round-trips
// differently, an index that exists in one and not the other.
//
// Needs `psql` and `pg_dump` on PATH, and a superuser connection (DIRECT_URL),
// because it creates and drops two throwaway databases. CI supplies all three.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(packageRoot, '..', '..');
const MIGRATIONS_DIR = join(packageRoot, 'migrations');
const CANONICAL_SCHEMA = join(repositoryRoot, 'docs-final', 'schema.sql');
const FROM_MIGRATIONS_DB = 'schema_fidelity_migrations';
const FROM_DOC_DB = 'schema_fidelity_doc';

const fail = message => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};

const parseEnvFile = path => {
  const values = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 1) continue;
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[trimmed.slice(0, separator).trim()] = value;
  }
  return values;
};

const envFile = resolve(repositoryRoot, '.env');
const env = { ...(existsSync(envFile) ? parseEnvFile(envFile) : {}), ...process.env };

const maintenanceUrl = env.DIRECT_URL ?? env.DATABASE_URL;
if (maintenanceUrl === undefined) fail('DIRECT_URL or DATABASE_URL must be set in .env');
const databaseOf = url => {
  const name = new URL(url).pathname.replace(/^\//, '');
  return name === '' ? undefined : name;
};
const maintenanceDatabase = databaseOf(maintenanceUrl);
if (maintenanceDatabase === undefined) fail('The connection URL names no database to connect to');

/** `psql`/`pg_dump` take a URL; these flags keep the output identical between the two dumps. */
const DUMP_FLAGS = ['--schema-only', '--no-owner', '--no-privileges'];

const run = (command, args, options = {}) =>
  spawnSync(command, args, { encoding: 'utf8', windowsHide: true, ...options });

const have = command => {
  const result = run(command, ['--version']);
  return result.error === undefined && result.status === 0;
};

for (const binary of ['psql', 'pg_dump']) {
  if (!have(binary)) fail(`${binary} is required to check schema fidelity but was not found on PATH`);
}

/** Concatenates every migration's up-section, in dbmate's own filename order. */
const migrationUpSections = () => {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter(name => name.endsWith('.sql'))
    .sort();
  if (files.length === 0) fail('No migrations found');
  const sections = [];
  for (const file of files) {
    const lines = readFileSync(join(MIGRATIONS_DIR, file), 'utf8').split(/\r?\n/);
    const start = lines.indexOf('-- migrate:up');
    const end = lines.indexOf('-- migrate:down');
    if (start === -1 || end === -1 || end < start) fail(`${file} has no usable -- migrate:up / -- migrate:down pair`);
    sections.push(lines.slice(start + 1, end).join('\n'));
  }
  return sections.join('\n');
};

const psql = (args, input) => {
  const result = run('psql', args, input === undefined ? undefined : { input });
  if (result.status !== 0) fail(`psql ${args.join(' ')} failed:\n${result.stderr}`);
  return result.stdout;
};

const recreate = database => {
  psql(['-v', 'ON_ERROR_STOP=1', '-q', '-d', maintenanceDatabase, '-c', `DROP DATABASE IF EXISTS ${database}`]);
  psql(['-v', 'ON_ERROR_STOP=1', '-q', '-d', maintenanceDatabase, '-c', `CREATE DATABASE ${database}`]);
};

const cleanup = () => {
  for (const database of [FROM_MIGRATIONS_DB, FROM_DOC_DB]) {
    run('psql', ['-v', 'ON_ERROR_STOP=1', '-q', '-d', maintenanceDatabase, '-c', `DROP DATABASE IF EXISTS ${database}`]);
  }
};

const workspace = mkdtempSync(join(tmpdir(), 'schema-fidelity-'));
let fromMigrationsDump = '';
let fromDocDump = '';

try {
  const fromMigrationsSql = join(workspace, 'from_migrations.sql');
  writeFileSync(fromMigrationsSql, migrationUpSections());

  recreate(FROM_MIGRATIONS_DB);
  recreate(FROM_DOC_DB);
  psql(['-v', 'ON_ERROR_STOP=1', '-q', '-d', FROM_MIGRATIONS_DB, '-f', fromMigrationsSql]);
  psql(['-v', 'ON_ERROR_STOP=1', '-q', '-d', FROM_DOC_DB, '-f', CANONICAL_SCHEMA]);

  fromMigrationsDump = run('pg_dump', ['-d', FROM_MIGRATIONS_DB, ...DUMP_FLAGS]).stdout;
  fromDocDump = run('pg_dump', ['-d', FROM_DOC_DB, ...DUMP_FLAGS]).stdout;
} finally {
  cleanup();
  rmSync(workspace, { recursive: true, force: true });
}

if (fromMigrationsDump === fromDocDump) {
  process.stdout.write('the migrations build exactly the schema in docs-final/schema.sql\n');
  process.exit(0);
}

/**
 * Report the first differing lines rather than a raw two-file diff: the reader of a
 * CI log wants "which object drifted", and the two dumps are thousands of lines
 * long with the interesting difference somewhere in the middle.
 */
const left = fromMigrationsDump.split(/\r?\n/);
const right = fromDocDump.split(/\r?\n/);
const differences = [];
for (let index = 0; index < Math.max(left.length, right.length) && differences.length < 40; index += 1) {
  if (left[index] !== right[index]) differences.push({ line: index + 1, migrations: left[index], doc: right[index] });
}
process.stderr.write('the migrations no longer build the schema in docs-final/schema.sql\n');
for (const difference of differences) {
  process.stderr.write(`  line ${difference.line}\n    migrations: ${difference.migrations ?? '(absent)'}\n    doc:        ${difference.doc ?? '(absent)'}\n`);
}
if (differences.length === 0) process.stderr.write('  (the two differ only in ordering)\n');
process.exit(1);