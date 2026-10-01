// apps/api/src/common/receipt-link.ts
import { timingSafeEqual } from 'node:crypto';
import { hmacSha256 } from '../identity/otp.js';

/**
 * The link on a customer's cash receipt that lets them report a problem without signing in (FR-CP, source RECEIPT_LINK). It carries the
 * booking id and an HMAC of it under the server's secret, so it can be neither guessed nor pointed at another booking.
 */
export const signReceiptToken = (pepper: string, bookingId: string): string => `${Buffer.from(bookingId).toString('base64url')}.${hmacSha256(pepper, `RECEIPT_LINK:${bookingId}`).slice(0, 24)}`;

/** Returns the booking id a valid token was issued for, or null. */
export const readReceiptToken = (pepper: string, token: string): string | null => {
  const [encoded, signature] = token.split('.');
  if (encoded === undefined || signature === undefined) return null;
  let bookingId: string;
  try {
    bookingId = Buffer.from(encoded, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  if (!/^[0-9a-f-]{36}$/.test(bookingId)) return null;
  const expected = Buffer.from(hmacSha256(pepper, `RECEIPT_LINK:${bookingId}`).slice(0, 24));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given) ? bookingId : null;
};
