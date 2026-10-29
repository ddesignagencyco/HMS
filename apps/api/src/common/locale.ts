// apps/api/src/common/locale.ts
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { formatPaisa } from '@smart-home/domain';
import type { Request } from 'express';

/**
 * BE-011 / BE-029: the one place a request's language is decided. The product ships English and Urdu;
 * anything that is not Urdu is English. Sentences that reach a person verbatim take a `Locale` and
 * pick from a pair, so the Urdu text sits next to the English it replaces and one cannot drift unseen.
 */
export type Locale = 'en' | 'ur';

export const localeOf = (acceptLanguage: string | undefined | null): Locale => (acceptLanguage?.trim().toLowerCase().startsWith('ur') === true ? 'ur' : 'en');

export const pick = (locale: Locale, text: { en: string; ur: string }): string => text[locale];

/** `@AcceptedLocale()` on a controller parameter: the locale of the request's `Accept-Language` header. */
export const AcceptedLocale = createParamDecorator((_data: unknown, context: ExecutionContext): Locale => {
  const request = context.switchToHttp().getRequest<Request>();
  const header = request.headers['accept-language'];
  return localeOf(Array.isArray(header) ? header[0] : header);
});

/** Paisa as a rupee amount for a sentence: `Rs 500`, `Rs 1,250.50`. Whole rupees drop the `.00`. */
export const rupees = (paisa: bigint | number, locale: Locale = 'en'): string => {
  const [major = '0', minor = '00'] = formatPaisa(BigInt(paisa)).split('.');
  const grouped = major.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const amount = minor === '00' ? grouped : `${grouped}.${minor}`;
  return locale === 'ur' ? `${amount} روپے` : `Rs ${amount}`;
};
