import { notFound } from 'next/navigation';
import { CustomerDashboardScreen } from '@/features/customer/dashboard-view';
import { getDictionary } from '@/lib/dictionaries';
import { isLocale } from '@/lib/utils';

export default async function AccountPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <CustomerDashboardScreen locale={locale} dict={getDictionary(locale)} />;
}
