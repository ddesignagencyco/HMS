// apps/api/src/booking/message-masking.ts

const EMAIL = /[A-Za-z0-9._%+-]+\s*@\s*[A-Za-z0-9-]+(?:\s*\.\s*[A-Za-z0-9-]+)+/g;

/**
 * A run of digits that could be a phone number: at least 9 digits, allowing the usual separators
 * between them (spaces, dashes, dots, brackets) and a leading +. Nine is the shortest Pakistani
 * number written without its leading 0 (e.g. 3001234567 is 10, +923001234567 is 12); prices and
 * house numbers, which are shorter, are left alone.
 */
const PHONE = /(?:\+\s*)?\(?\d(?:[\s().-]*\d){8,}/g;

/** Digits spelled out in words ("zero three zero zero ...") are the obvious way around a digit filter. */
const NUMBER_WORDS = /\b(?:(?:zero|oh|one|two|three|four|five|six|seven|eight|nine)[\s,.-]+){7,}(?:zero|oh|one|two|three|four|five|six|seven|eight|nine)\b/gi;

export const MASK_EMAIL = '[email hidden]';
export const MASK_PHONE = '[number hidden]';

/**
 * FR-BK-07: customer and provider talk through the platform, never around it. Phone numbers and
 * email addresses are replaced before the message is stored, so the original never reaches the
 * other party or the database.
 */
export const maskContactDetails = (body: string): { body: string; masked: boolean } => {
  const masked = body.replace(EMAIL, MASK_EMAIL).replace(NUMBER_WORDS, MASK_PHONE).replace(PHONE, MASK_PHONE);
  return { body: masked, masked: masked !== body };
};
