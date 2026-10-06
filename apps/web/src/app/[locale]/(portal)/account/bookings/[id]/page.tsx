import { notFound } from 'next/navigation';
import { CustomerBookingDetailScreen } from '@/features/customer/booking-detail-view';
import { getDictionary } from '@/lib/dictionaries';
import { isLocale } from '@/lib/utils';

export default async function AccountBookingPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  if (!isLocale(locale)) notFound();
  /* A malformed id is a 400 from the API, which the screen already renders as
     "we could not find that booking". Pre-filtering here would only hide the same
     message behind a different one. */
  return <CustomerBookingDetailScreen locale={locale} bookingId={id} dict={getDictionary(locale)} />;
}
