// Validates the CI integration job's env block against the real environment schema,
// using the same parseEnvironment() the API calls at startup. A typo in a base64 key
// or a missing required variable fails here rather than in a CI run.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnvironment, EnvironmentValidationError } from '../src/config/environment.schema.js';

const workflowPath = fileURLToPath(new URL('../../../.github/workflows/backend.yml', import.meta.url));
const lines = readFileSync(workflowPath, 'utf8').split(/\r?\n/);

// Walk to the `integration:` job, then take the indented block under its `env:` key.
// Line-based rather than a regex, so CRLF checkouts and indentation changes cannot
// silently turn this check into a no-op.
const jobStart = lines.findIndex(line => /^ {2}integration:\s*$/.test(line));
if (jobStart === -1) throw new Error('could not find the integration job in the workflow');
const envStart = lines.findIndex((line, index) => index > jobStart && /^ {4}env:\s*$/.test(line));
if (envStart === -1) throw new Error('could not find an env: block in the integration job');

const source: NodeJS.ProcessEnv = {};
for (const line of lines.slice(envStart + 1)) {
  const match = /^ {6}([A-Z_]+):\s*(.*)$/.exec(line);
  if (match === null) break; // dedented: end of the env block
  // strip a trailing yaml comment, then unwrap quotes
  const raw = (match[2] ?? '')
    .replace(/\s+#.*$/, '')
    .replace(/^'(.*)'$/, '$1')
    .replace(/^"(.*)"$/, '$1')
    .trim();
  source[match[1] as string] = raw;
}

console.log('env block found, %d keys:', Object.keys(source).length);
for (const [key, value] of Object.entries(source)) {
  const shown = key.includes('SECRET') || key.includes('PEPPER') ? `${value.slice(0, 6)}…` : value;
  console.log(`  ${key} = ${shown}`);
}

try {
  const parsed = parseEnvironment(source);
  console.log('\nOK - the CI env block satisfies the environment schema.');
  console.log('   CNIC key decodes to %d bytes', Buffer.from(parsed.CNIC_ENCRYPTION_KEY, 'base64').length);
  console.log('   TOTP key decodes to %d bytes', Buffer.from(parsed.TOTP_ENCRYPTION_KEY, 'base64').length);
  console.log('   CNIC !== TOTP:', parsed.CNIC_ENCRYPTION_KEY !== parsed.TOTP_ENCRYPTION_KEY);
  console.log('   NODE_ENV:', parsed.NODE_ENV, '| DEV_INBOX_ENABLED:', parsed.DEV_INBOX_ENABLED);
  console.log('   storage buckets:', parsed.STORAGE_BUCKETS.join(','));
} catch (error) {
  if (error instanceof EnvironmentValidationError) {
    console.error('\nFAIL - the CI env block is rejected by the schema:');
    for (const issue of error.issues) console.error(`  - ${issue.path}: ${issue.message}`);
    process.exit(1);
  }
  throw error;
}
