import { notFound } from 'next/navigation';
import { CustomerPlansScreen } from '@/features/customer/plans-view';
import { getDictionary } from '@/lib/dictionaries';
import { isLocale } from '@/lib/utils';

export default async function AccountPlansPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <CustomerPlansScreen locale={locale} dict={getDictionary(locale)} />;
}
