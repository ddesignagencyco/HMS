// packages/db/scripts/flush-settings-cache.mjs
//
// A database reset that leaves a stale cache behind is not a reset.
//
// Found the hard way during the 11 Oct 2026 reviewer passes: a seed change to
// `ranking.weights` was not taking effect, and a mutation check that should have failed
// was passing instead. The cause was here, not in the test — `settings` is cached in Redis
// for `SETTINGS_TTL_SECONDS` (300), `db:reset` dropped and re-seeded Postgres, and the
// cache went on serving the pre-reset value. The guard was right and the environment was
// lying to it, which is the most expensive kind of confusion in a test suite.
//
// Deletes **only** `settings:*` — the keys this application owns — rather than FLUSHALL, so
// pointing this at a shared Redis cannot take out somebody else's data. Everything else
// (catalogue namespace versions, queues, sessions) is either rebuilt on demand or belongs
// to the database that was just dropped.
//
// Speaks RESP over a socket rather than pulling in a client library: this is one command,
// and packages/db has no Redis dependency to justify adding one. Exits quietly when Redis is
// not reachable, because a dev or CI box without Redis is a valid state and failing the
// reset over it would be its own kind of confusion.

import { existsSync, readFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const envFile = resolve(repositoryRoot, '.env');

const parseEnvFile = path => {
  const values = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[key] = value;
  }
  return values;
};

const env = { ...(existsSync(envFile) ? parseEnvFile(envFile) : {}), ...process.env };
const url = env.REDIS_URL;
if (url === undefined) {
  process.stdout.write('cache: no REDIS_URL set, nothing to flush\n');
  process.exit(0);
}

/**
 * A minimal RESP reader: `+` simple, `-` error, `:` integer, `$` bulk, `*` array. Redis
 * replies are not one line each, so the buffer is kept until a whole reply has arrived —
 * parsing "whatever has arrived so far" is what broke the first version of this file.
 */
class ReplyReader {
  constructor() {
    this.buffer = '';
  }

  /** The parsed reply, or null while the buffer does not yet hold a complete one. */
  take() {
    const parsed = this.#value(0);
    if (parsed === null) return null;
    this.buffer = this.buffer.slice(parsed.length);
    return parsed.value;
  }

  #value(start) {
    if (this.buffer.length === start) return null;
    const type = this.buffer[start];
    const lineEnd = this.buffer.indexOf('\r\n', start);
    if (lineEnd === -1) return null;
    const line = this.buffer.slice(start + 1, lineEnd);
    const consumed = lineEnd + 2 - start;

    if (type === '+') return { length: consumed, value: line };
    if (type === '-') throw new Error(line);
    if (type === ':') return { length: consumed, value: Number(line) };
    if (type === '$') {
      const size = Number(line);
      if (size === -1) return { length: consumed, value: null };
      const from = lineEnd + 2;
      if (this.buffer.length < from + size + 2) return null;
      return { length: from + size + 2 - start, value: this.buffer.slice(from, from + size) };
    }
    if (type === '*') {
      const count = Number(line);
      if (count === -1) return { length: consumed, value: null };
      const items = [];
      let cursor = lineEnd + 2;
      for (let index = 0; index < count; index += 1) {
        const item = this.#value(cursor);
        if (item === null) return null;
        items.push(item.value);
        cursor += item.length;
      }
      return { length: cursor - start, value: items };
    }
    throw new Error(`unexpected RESP type ${type}`);
  }
}

const connect = target =>
  new Promise((open, fail) => {
    const socket = net.connect({ host: target.hostname, port: Number(target.port || 6379) }, () => open(socket));
    socket.once('error', fail);
    socket.setTimeout(5_000, () => {
      socket.destroy();
      fail(new Error('timed out'));
    });
  });

const command = (socket, reader, ...args) =>
  new Promise((ok, no) => {
    socket.write(`*${args.length}\r\n${args.map(argument => `$${argument.length}\r\n${argument}\r\n`).join('')}`);
    const onData = data => {
      reader.buffer += data.toString();
      try {
        const reply = reader.take();
        if (reply === null) return;
        socket.off('data', onData);
        ok(reply);
      } catch (error) {
        socket.off('data', onData);
        no(error);
      }
    };
    socket.on('data', onData);
    socket.once('error', no);
  });

try {
  const socket = await connect(new URL(url));
  const reader = new ReplyReader();
  const keys = await command(socket, reader, 'KEYS', 'settings:*');
  if (!Array.isArray(keys) || keys.length === 0) {
    process.stdout.write('cache: no settings keys to flush\n');
  } else {
    for (const key of keys) await command(socket, reader, 'DEL', key);
    process.stdout.write(`cache: flushed ${keys.length} settings key(s)\n`);
  }
  socket.end();
} catch (error) {
  process.stdout.write(`cache: skipped, Redis not reachable (${error.message})\n`);
}