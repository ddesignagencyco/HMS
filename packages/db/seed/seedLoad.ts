import { loadProviders, disconnect } from './loadProviders.js';

/**
 * SHM-110: `npm run seed:load -- --count 10000`.
 *
 * Defaults to 10 000 because that is the size FR-SR-07's p95 target names. `--count` exists so the
 * k6 run can be done at more than one size — a number that only holds at exactly one size is not
 * evidence of anything.
 */
const readCount = (argv: readonly string[]): number => {
  const flag = argv.indexOf('--count');
  const raw = flag === -1 ? undefined : argv[flag + 1];
  const value = raw === undefined ? 10000 : Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 1) throw new Error(`--count must be a positive integer (got ${String(raw)})`);
  return value;
};

const main = async (): Promise<void> => {
  const count = readCount(process.argv.slice(2));
  try {
    process.stdout.write(`Generating ${count} bookable providers for load testing\n`);
    const started = Date.now();
    const result = await loadProviders(count);
    const seconds = (Date.now() - started) / 1000;
    process.stdout.write(`\nseed:load done — ${result.bookable} providers bookable in ${seconds.toFixed(1)}s\n`);
    if (result.bookable < count) {
      // A provider the search cannot reach would still be counted by the loop, so a short count
      // means rows were written that are invisible to the endpoint this dataset exists to load-test.
      process.stderr.write(`Expected ${count} bookable providers, found ${result.bookable}. Rows that search cannot reach do not count.\n`);
      process.exitCode = 1;
    }
  } finally {
    await disconnect();
  }
};

void main();