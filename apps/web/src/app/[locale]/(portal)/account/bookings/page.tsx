import { notFound } from 'next/navigation';
import { CustomerBookingsScreen } from '@/features/customer/bookings-view';
import { getDictionary } from '@/lib/dictionaries';
import { isLocale } from '@/lib/utils';

export default async function AccountBookingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <CustomerBookingsScreen locale={locale} dict={getDictionary(locale)} />;
}
