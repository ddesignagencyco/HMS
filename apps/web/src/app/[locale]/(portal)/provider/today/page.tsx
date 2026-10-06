import { notFound } from 'next/navigation';
import { ProviderTodayScreen } from '@/features/provider/today-view';
import { getDictionary } from '@/lib/dictionaries';
import { isLocale } from '@/lib/utils';

export default async function ProviderTodayPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <ProviderTodayScreen locale={locale} dict={getDictionary(locale)} />;
}
