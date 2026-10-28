import { notFound } from 'next/navigation';
import { AdminPlans } from '@/features/plans/admin-plans-view';
import { getDictionary } from '@/lib/dictionaries';
import { isLocale } from '@/lib/utils';

export default async function AdminPlansPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <AdminPlans locale={locale} dict={getDictionary(locale)} />;
}