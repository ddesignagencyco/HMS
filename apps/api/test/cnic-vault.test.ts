import { describe, expect, it } from 'vitest';
import { DomainError } from '../src/common/domain-error.js';
import { hmacSha256 } from '../src/identity/otp.js';
import { cnicBlindIndex, decryptCnic, encryptCnic, normalizeCnic } from '../src/provider/cnic-vault.js';

const KEY = Buffer.alloc(32, 11);
const OTHER_KEY = Buffer.alloc(32, 3);
const PEPPER = 'p'.repeat(32);

/**
 * `DomainError` extends `HttpException`, so `.message` is the generic "Domain
 * Error" and the human-readable text lives in the problem body. This reads it back
 * so a test can assert *which* refusal happened, not merely that something did.
 */
const detailOf = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    if (error instanceof DomainError) return (error.getResponse() as { detail: string }).detail;
    throw error;
  }
  throw new Error('expected the call to throw, but it returned');
};

describe('FR-SP-06 / NFR-PR-03: CNIC protection', () => {
  describe('normalisation', () => {
    it('strips the dashes and spaces a provider naturally types', () => {
      expect(normalizeCnic('35202-1234567-1')).toBe('3520212345671');
      expect(normalizeCnic('35202 1234567 1')).toBe('3520212345671');
      expect(normalizeCnic(' 3520212345671 ')).toBe('3520212345671');
    });

    it('makes the three written forms share one blind index, so they cannot become three accounts', () => {
      const dashed = cnicBlindIndex(PEPPER, normalizeCnic('35202-1234567-1'));
      const spaced = cnicBlindIndex(PEPPER, normalizeCnic('35202 1234567 1'));
      const bare = cnicBlindIndex(PEPPER, normalizeCnic('3520212345671'));
      expect(dashed).toBe(spaced);
      expect(spaced).toBe(bare);
    });

    it('rejects anything that is not exactly 13 digits', () => {
      for (const bad of ['', '35202-1234567', '35202-1234567-12', 'abcdefghijklm', '352021234567a', '35202123456712']) {
        expect(() => normalizeCnic(bad)).toThrow(DomainError);
        expect(detailOf(() => normalizeCnic(bad))).toContain('13 digits');
      }
    });
  });

  describe('encryption at rest', () => {
    it('round-trips the CNIC through AES-256-GCM', () => {
      const normalized = normalizeCnic('35202-1234567-1');
      expect(decryptCnic(KEY, encryptCnic(KEY, normalized))).toBe(normalized);
    });

    it('never leaves the plaintext in the stored bytes', () => {
      const stored = encryptCnic(KEY, normalizeCnic('35202-1234567-1'));
      expect(stored.includes(Buffer.from('3520212345671', 'utf8'))).toBe(false);
      expect(stored.toString('utf8')).not.toContain('35202');
    });

    it('uses a fresh nonce per encryption, so the same CNIC never encrypts to the same bytes twice', () => {
      const normalized = normalizeCnic('35202-1234567-1');
      expect(encryptCnic(KEY, normalized).equals(encryptCnic(KEY, normalized))).toBe(false);
    });

    it('refuses to decrypt under the wrong key rather than returning garbage', () => {
      const stored = encryptCnic(KEY, normalizeCnic('35202-1234567-1'));
      expect(() => decryptCnic(OTHER_KEY, stored)).toThrow(DomainError);
      expect(detailOf(() => decryptCnic(OTHER_KEY, stored))).toContain('could not be decrypted');
    });

    it('rejects a tampered ciphertext (the GCM tag is what detects it)', () => {
      const stored = encryptCnic(KEY, normalizeCnic('35202-1234567-1'));
      const tampered = Buffer.from(stored);
      tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 0xff;
      expect(detailOf(() => decryptCnic(KEY, tampered))).toContain('could not be decrypted');
    });

    it('rejects a truncated payload', () => {
      expect(detailOf(() => decryptCnic(KEY, Buffer.alloc(8)))).toContain('malformed');
    });
  });

  describe('blind index', () => {
    it('is stable for the same CNIC under the same pepper', () => {
      expect(cnicBlindIndex(PEPPER, '3520212345671')).toBe(cnicBlindIndex(PEPPER, '3520212345671'));
    });

    it('differs for different CNICs, so two people do not collide', () => {
      expect(cnicBlindIndex(PEPPER, '3520212345671')).not.toBe(cnicBlindIndex(PEPPER, '3520299999999'));
    });

    it('differs under a different pepper, so a rotated pepper does not invalidate every stored index silently', () => {
      expect(cnicBlindIndex(PEPPER, '3520212345671')).not.toBe(cnicBlindIndex('q'.repeat(32), '3520212345671'));
    });

    it('does not reveal the CNIC it indexes', () => {
      expect(cnicBlindIndex(PEPPER, '3520212345671')).not.toContain('35202');
    });

    it('is domain-separated from a bare HMAC of the same value, so a CNIC index can never collide with another pepper use', () => {
      // `hmacSha256(pepper, value)` is what other pepper-backed helpers produce;
      // the `cnic:` prefix must keep the CNIC index in its own domain.
      expect(cnicBlindIndex(PEPPER, '3520212345671')).not.toBe(hmacSha256(PEPPER, '3520212345671'));
      expect(cnicBlindIndex(PEPPER, '3520212345671')).toBe(hmacSha256(PEPPER, 'cnic:3520212345671'));
    });
  });
});
