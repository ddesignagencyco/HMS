import { notFound } from 'next/navigation';
import { InboxView } from '@/features/booking/inbox-view';
import { getDictionary } from '@/lib/dictionaries';
import { isLocale } from '@/lib/utils';

export default async function ProviderMessagesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <InboxView locale={locale} dict={getDictionary(locale)} role="provider" />;
}
