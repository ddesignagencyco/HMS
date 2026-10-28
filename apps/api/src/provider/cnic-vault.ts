// apps/api/src/provider/cnic-vault.ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { DomainError } from '../common/domain-error.js';
import { hmacSha256 } from '../identity/otp.js';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** A Pakistani CNIC is 13 digits, conventionally written 35202-1234567-1. */
const CNIC_DIGITS = /^\d{13}$/;

/**
 * Reduces what a provider typed to the digits that actually identify them, so
 * that `35202-1234567-1`, `35202 1234567 1` and `3520212345671` are one person
 * and therefore collide on the blind index rather than slipping past the
 * duplicate check as three different accounts.
 */
export const normalizeCnic = (raw: string): string => {
  const digits = raw.replace(/[\s-]/g, '');
  if (!CNIC_DIGITS.test(digits))
    throw new DomainError('VALIDATION_FAILED', 'A CNIC is 13 digits, written 35202-1234567-1', [
      { path: 'cnicNumber', code: 'invalid', message: 'A CNIC is 13 digits, written 35202-1234567-1' }
    ]);
  return digits;
};

/**
 * NFR-PR-03 / TRD §10: the CNIC is never stored in the clear. A fresh random
 * nonce per encryption is prefixed to the ciphertext, because reusing a GCM
 * nonce under one key leaks the authentication subkey. Layout is
 * `iv | authTag | ciphertext`, matching the TOTP vault.
 */
export const encryptCnic = (key: Buffer, normalized: string): Buffer => {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(normalized, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
};

export const decryptCnic = (key: Buffer, payload: Buffer): string => {
  if (payload.length <= IV_BYTES + TAG_BYTES) throw new DomainError('INTERNAL_ERROR', 'The stored CNIC is malformed');
  const iv = payload.subarray(0, IV_BYTES);
  const authTag = payload.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = payload.subarray(IV_BYTES + TAG_BYTES);
  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new DomainError('INTERNAL_ERROR', 'The stored CNIC could not be decrypted');
  }
};

/**
 * The blind index is what makes "one person, one account" enforceable. Storing
 * a keyed hash alongside the ciphertext means the duplicate check is a plain
 * equality test the database can index, while the CNIC itself stays
 * unrecoverable without the key — a leaked database dump cannot be walked to
 * find which CNICs are registered, only to see which rows collide. The
 * `cnic:` prefix domain-separates this HMAC from every other use of the pepper.
 */
export const cnicBlindIndex = (pepper: string, normalized: string): string => hmacSha256(pepper, `cnic:${normalized}`);
