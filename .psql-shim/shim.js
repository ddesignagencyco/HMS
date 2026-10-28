// Windows .cmd shim: forwards `psql` invocations to the smart-home-postgis container.
// Node spawns psql via cmd.exe, so this script receives the whole raw command
// line as one argument and re-tokenizes it quote-aware.
const { spawnSync } = require('node:child_process');

const CONTAINER = 'smart-home-postgis';

function tokenize(raw) {
  const args = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '"') {
      if (quoted && raw[i + 1] === '"') { current += '"'; i++; continue; }
      quoted = !quoted;
      continue;
    }
    if (!quoted && /\s/.test(ch)) {
      if (current !== '') { args.push(current); current = ''; }
      continue;
    }
    current += ch;
  }
  if (current !== '') args.push(current);
  return args;
}

const raw = process.argv[2] ?? '';
const args = tokenize(raw);

// Translate any -f <host path> into a container-side copy.
const fIndex = args.indexOf('-f');
if (fIndex !== -1 && fIndex + 1 < args.length) {
  const hostPath = args[fIndex + 1];
  const containerPath = '/tmp/psql-shim-input.sql';
  const cp = spawnSync('docker', ['cp', hostPath, `${CONTAINER}:${containerPath}`], { stdio: 'inherit' });
  if (cp.status !== 0) process.exit(cp.status ?? 1);
  args[fIndex + 1] = containerPath;
}

const result = spawnSync('docker', ['exec', CONTAINER, 'psql', ...args], { stdio: 'inherit' });
process.exit(result.status ?? 0);
