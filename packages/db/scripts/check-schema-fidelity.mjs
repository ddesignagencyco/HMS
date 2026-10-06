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
// up-section in order, once by applying the doc -- and compares the two resulting
// catalogues.
//
// The comparison is deliberately *not* a `pg_dump` text diff. Doing that reports two
// kinds of non-drift as failures: Postgres 16 writes a random `\unrestrict <token>`
// line into every dump, and a column added by `ALTER TABLE ... ADD COLUMN` always
// lands at the end of the table while the doc declares it wherever it reads best.
// Column order is not part of the logical schema. Instead one query emits one line
// per schema object -- column, constraint, index, enum, view, trigger, sequence,
// extension -- and the two sets of lines are compared as sets.
//
// That still catches what a text diff would, and more: a constraint Postgres
// auto-named differently on the two paths, a column type that round-trips
// differently, an index present in one and absent in the other, a default expression
// that differs.
//
// Needs `psql` on PATH whose major version matches the server, and a superuser
// connection (DIRECT_URL), because it creates and drops two throwaway databases.
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

const sourceUrl = env.DIRECT_URL ?? env.DATABASE_URL;
if (sourceUrl === undefined) fail('DIRECT_URL or DATABASE_URL must be set in .env');

/**
 * A libpq connection URL for `database`, derived from the configured one.
 *
 * Every `psql` call below is given a URL rather than a bare database name
 * on purpose. `-d somename` with no host tells libpq to use the Unix socket, which
 * does not exist on a CI runner where the database is a service container reachable
 * only over TCP on localhost -- and which hides the mistake locally, where the usual
 * way to reach the database is `docker exec`. Passing the URL keeps host, port and
 * credentials travelling with the command everywhere.
 *
 * Prisma-only query parameters are dropped because libpq rejects parameters it does
 * not recognise.
 */
const urlFor = database => {
  const url = new URL(sourceUrl);
  url.pathname = `/${database}`;
  for (const parameter of ['schema', 'connection_limit', 'pool_timeout', 'pgbouncer']) url.searchParams.delete(parameter);
  if (url.searchParams.get('sslmode') === null) url.searchParams.set('sslmode', 'disable');
  return url.toString();
};

/**
 * The database to connect to in order to create or drop another one. Cannot be one of
 * the throwaway databases being compared, and Postgres refuses `DROP DATABASE` against
 * the database it is currently connected to, so this is a separate, stable name.
 */
const maintenanceDatabase = new URL(sourceUrl).pathname.replace(/^\//, '');
if (maintenanceDatabase === '') fail('The connection URL names no database to connect to');
if (maintenanceDatabase === FROM_MIGRATIONS_DB || maintenanceDatabase === FROM_DOC_DB) {
  fail(`The connection URL names ${maintenanceDatabase}, which is a scratch database this check creates`);
}

const run = (command, args, options = {}) =>
  spawnSync(command, args, { encoding: 'utf8', windowsHide: true, ...options });

const psql = (args, input) => {
  const result = run('psql', args, input === undefined ? undefined : { input });
  if (result.status !== 0) fail(`psql ${args.join(' ')} failed:\n${result.stderr}`);
  return result.stdout;
};

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

/**
 * `psql` must be at least the server's major version: a 15 client refuses to read a 16
 * server ("aborting because of server version mismatch"). Saying so up front names the
 * cause instead of leaving it buried in a failed query.
 */
const requireUsablePsql = () => {
  const version = run('psql', ['--version']);
  if (version.error !== undefined || version.status !== 0) {
    fail('psql is required to check schema fidelity but was not found on PATH (the workflow installs it explicitly)');
  }
  const client = Number.parseInt(/(\d+)\.\d+/.exec(version.stdout)?.[1] ?? '', 10);
  // `SHOW server_version_num` is a single integer like 160004, so the major version is
  // the first two digits -- divide by 10000 rather than splitting on a dot.
  const reported = Number.parseInt(psql(['-t', '-A', urlFor(maintenanceDatabase), '-c', 'SHOW server_version_num']).trim(), 10);
  const server = Number.isFinite(reported) ? Math.floor(reported / 10_000) : Number.NaN;
  if (Number.isFinite(client) && Number.isFinite(server) && client < server) {
    fail(`psql ${client} cannot read this ${server} server; install a matching postgresql-client`);
  }
};

const recreate = database => {
  psql(['-v', 'ON_ERROR_STOP=1', '-q', urlFor(maintenanceDatabase), '-c', `DROP DATABASE IF EXISTS ${database}`]);
  psql(['-v', 'ON_ERROR_STOP=1', '-q', urlFor(maintenanceDatabase), '-c', `CREATE DATABASE ${database}`]);
};

const cleanup = () => {
  for (const database of [FROM_MIGRATIONS_DB, FROM_DOC_DB]) {
    run('psql', ['-v', 'ON_ERROR_STOP=1', '-q', urlFor(maintenanceDatabase), '-c', `DROP DATABASE IF EXISTS ${database}`]);
  }
};

/**
 * One line per schema object, so the two schemas can be compared as sets of facts
 * rather than as formatted text.
 *
 * `ordinal_position` is deliberately absent: a column added by `ALTER TABLE ... ADD
 * COLUMN` lands at the end of the table, while the doc declares it wherever it reads
 * best, and that difference is not drift. Everything that *is* the schema is here --
 * the type, nullability and default of every column; the normalised definition of
 * every constraint (so an auto-generated name such as `bookings_check5` instead of
 * the intended one is caught); every index; every enum and its value order; every
 * view; every trigger and sequence; every extension.
 */
const CATALOGUE_QUERY = `
  SELECT 'COLUMN|' || table_name || '|' || column_name || '|' || data_type || '|' || is_nullable
         || '|' || coalesce(column_default, '-')
    FROM information_schema.columns WHERE table_schema = 'public'
  UNION ALL
  SELECT 'CONSTRAINT|' || c.relname || '|' || con.conname || '|' || pg_get_constraintdef(con.oid)
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  UNION ALL
  SELECT 'INDEX|' || tablename || '|' || indexname || '|' || indexdef
    FROM pg_indexes WHERE schemaname = 'public'
  UNION ALL
  SELECT 'ENUM|' || t.typname || '|' || string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder)
    FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    JOIN pg_namespace n ON n.oid = t.typnamespace
   WHERE n.nspname = 'public' GROUP BY t.typname
  UNION ALL
  SELECT 'VIEW|' || table_name || '|' || replace(view_definition, chr(10), ' ')
    FROM information_schema.views WHERE table_schema = 'public'
  UNION ALL
  SELECT 'TRIGGER|' || c.relname || '|' || tg.tgname
    FROM pg_trigger tg
    JOIN pg_class c ON c.oid = tg.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND NOT tg.tgisinternal
  UNION ALL
  SELECT 'SEQUENCE|' || sequence_name FROM information_schema.sequences WHERE sequence_schema = 'public'
  UNION ALL
  SELECT 'EXTENSION|' || extname FROM pg_extension
  ORDER BY 1
`;

/**
 * Reads the catalogue of one built schema as a sorted list of lines.
 *
 * The field separator is a tab rather than `|` because the definitions being read
 * (constraint and index expressions) contain pipes, and a NUL separator is not
 * expressible as a process argument at all.
 */
const FIELD_SEPARATOR = '\t';

const catalogueOf = database =>
  psql(['-t', '-A', '-F', FIELD_SEPARATOR, urlFor(database), '-c', CATALOGUE_QUERY])
    .split(/\r?\n/)
    .filter(line => line.length > 0)
    .map(line => line.split(FIELD_SEPARATOR).map(part => part.trim()).join(' | '))
    .sort();

const workspace = mkdtempSync(join(tmpdir(), 'schema-fidelity-'));
let fromMigrations = [];
let fromDoc = [];

try {
  const fromMigrationsSql = join(workspace, 'from_migrations.sql');
  writeFileSync(fromMigrationsSql, migrationUpSections());

  requireUsablePsql();
  recreate(FROM_MIGRATIONS_DB);
  recreate(FROM_DOC_DB);
  psql(['-v', 'ON_ERROR_STOP=1', '-q', urlFor(FROM_MIGRATIONS_DB), '-f', fromMigrationsSql]);
  psql(['-v', 'ON_ERROR_STOP=1', '-q', urlFor(FROM_DOC_DB), '-f', CANONICAL_SCHEMA]);

  fromMigrations = catalogueOf(FROM_MIGRATIONS_DB);
  fromDoc = catalogueOf(FROM_DOC_DB);
} finally {
  cleanup();
  rmSync(workspace, { recursive: true, force: true });
}

const onlyInMigrations = fromMigrations.filter(line => !fromDoc.includes(line));
const onlyInDoc = fromDoc.filter(line => !fromMigrations.includes(line));

if (onlyInMigrations.length === 0 && onlyInDoc.length === 0) {
  process.stdout.write(`the migrations build exactly the schema in docs-final/schema.sql (${fromMigrations.length} schema objects compared)\n`);
  process.exit(0);
}

/**
 * Name the objects that differ rather than printing a thousand-line diff: whoever
 * reads the CI log wants "which constraint, and which way".
 */
process.stderr.write('the migrations no longer build the schema in docs-final/schema.sql\n');
const describe = line => {
  const [kind, ...rest] = line.split(' | ');
  return `${kind.toLowerCase()} ${rest.slice(0, 2).join('.')}`;
};
for (const line of onlyInMigrations.slice(0, 40)) {
  process.stderr.write(`  only in the migrations: ${describe(line)}\n      ${line}\n`);
}
for (const line of onlyInDoc.slice(0, 40)) {
  process.stderr.write(`  only in the doc: ${describe(line)}\n      ${line}\n`);
}
const hidden = onlyInMigrations.length + onlyInDoc.length - 40;
if (hidden > 0) process.stderr.write(`  ...and ${hidden} more\n`);
process.stderr.write('  Update docs-final/schema.sql to match, or add a migration that closes the gap.\n');
process.exit(1);