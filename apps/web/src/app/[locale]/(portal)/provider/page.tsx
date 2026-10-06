import { notFound } from 'next/navigation';
import { ProviderDashboardScreen } from '@/features/provider/dashboard-view';
import { getDictionary } from '@/lib/dictionaries';
import { isLocale } from '@/lib/utils';

export default async function ProviderPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <ProviderDashboardScreen locale={locale} dict={getDictionary(locale)} />;
}
