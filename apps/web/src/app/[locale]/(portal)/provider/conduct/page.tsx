import { notFound } from 'next/navigation';
import { ProviderConductScreen } from '@/features/provider/conduct-view';
import { getDictionary } from '@/lib/dictionaries';
import { isLocale } from '@/lib/utils';

export default async function ProviderConductPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <ProviderConductScreen locale={locale} dict={getDictionary(locale)} />;
}
