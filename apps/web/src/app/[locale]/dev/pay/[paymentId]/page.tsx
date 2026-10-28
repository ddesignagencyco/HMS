import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DevPaymentPage } from '@/features/booking/dev-payment-page';
import { getDictionary } from '@/lib/dictionaries';
import { isLocale } from '@/lib/utils';

/* The development payment simulator. Reached only through the `next.config.ts`
   redirect of a browser navigation to `/api/v1/dev/payments/:id` — see
   `features/booking/dev-payment-page.tsx`. */

export const metadata: Metadata = { title: 'SmartHome Pay — sandbox', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function DevPayRoute({
  params,
  searchParams
}: {
  params: Promise<{ locale: string; paymentId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, paymentId } = await params;
  if (!isLocale(locale) || !UUID.test(paymentId)) notFound();
  const query = await searchParams;
  const returnUrl = Array.isArray(query.returnUrl) ? query.returnUrl[0] : query.returnUrl;
  return <DevPaymentPage locale={locale} dict={getDictionary(locale)} paymentId={paymentId} returnUrl={returnUrl ?? null} />;
}
