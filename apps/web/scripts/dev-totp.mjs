/* Dev-only helper: enrol TOTP for a seeded staff account and print a code.
 *
 * Not part of the app. Run once by hand when an admin route has to be
 * exercised live:
 *
 *   node scripts/dev-totp.mjs
 *
 * It drives the real `POST /auth/login` -> `POST /auth/totp/setup` ->
 * `POST /auth/totp/verify` handshake and computes the next code locally
 * from the returned secret, so no file outside this app changes and the
 * database is only touched through the API.
 */

import { createHmac } from 'node:crypto';

const BASE = process.env.API_ORIGIN ?? 'http://localhost:3000/api/v1';
const IDENTIFIER = process.env.SEED_ADMIN ?? 'admin@smart-home.local';
const PASSWORD = process.env.SEED_PASSWORD;
if (!PASSWORD) {
  process.stderr.write('Set SEED_PASSWORD (the seeded dev accounts password) — it is not stored in the repo\n');
  process.exit(1);
}

/** RFC 6238, 30-second step, 6 digits — the same shape `totp.service.ts` verifies. */
const codeFor = (base32Secret, atMs) => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of base32Secret.replace(/=+$/, '').toUpperCase()) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error(`not base32: ${char}`);
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));

  const counter = Math.floor(atMs / 1000 / 30);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', Buffer.from(bytes)).update(buffer).digest();

  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
  return String(binary % 1_000_000).padStart(6, '0');
};

const json = async (path, init) => {
  const response = await fetch(`${BASE}${path}`, init);
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${path} -> ${response.status} ${JSON.stringify(body)}`);
  return body;
};

const bearer = (token) => ({ Authorization: `Bearer ${token}`, 'content-type': 'application/json' });

const main = async () => {
  /* Once TOTP is enrolled the password step itself demands a code, so the
     first login can no longer be made without one. Two states:
       · TOTP_SECRET set   — already enrolled; sign straight in.
       · TOTP_SECRET unset — not enrolled; the password-only login works
         and is the only way to reach /auth/totp/setup. */
  const known = process.env.TOTP_SECRET;

  if (known) {
    const code = codeFor(known, Date.now());
    const session = await json('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identifier: IDENTIFIER, password: PASSWORD, totpCode: code })
    });
    process.stdout.write(`staff session ready: totpRequired=${session.totpRequired}\n`);
    process.stdout.write(`${JSON.stringify({ accessToken: session.accessToken, secret: known })}\n`);
    return;
  }

  const login = await json('/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: IDENTIFIER, password: PASSWORD })
  });
  const headers = bearer(login.accessToken);
  process.stdout.write(`signed in as ${login.user.email} (totpRequired=${login.totpRequired})\n`);

  const setup = await json('/auth/totp/setup', { method: 'POST', headers });
  const secret = setup.secret ?? setup.secretKey ?? setup.otpauthUri?.match(/secret=([^&]+)/)?.[1];
  if (typeof secret !== 'string' || secret === '') throw new Error(`no secret in the setup response: ${JSON.stringify(setup)}`);

  /* The service checks the window either side of now, so the code is
     computed for the current step and sent immediately. */
  const code = codeFor(secret, Date.now());
  const verified = await json('/auth/totp/verify', { method: 'POST', headers, body: JSON.stringify({ code }) });
  process.stdout.write(`verified: ${JSON.stringify(verified)}\n`);

  /* The setup session still carries totpVerified=false, so sign in again —
     this time the code is required at the password step. */
  const session = await json('/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: IDENTIFIER, password: PASSWORD, totpCode: code })
  });
  process.stdout.write(`staff session ready: totpRequired=${session.totpRequired} totpEnabled=${session.totpEnabled}\n`);
  process.stdout.write(`${JSON.stringify({ accessToken: session.accessToken, refreshToken: session.refreshToken ?? null, secret })}\n`);
};

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
