import { notFound } from 'next/navigation';
import { ProviderJobScreen } from '@/features/provider/job-view';
import { getDictionary } from '@/lib/dictionaries';
import { isLocale } from '@/lib/utils';

export default async function ProviderJobPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  if (!isLocale(locale)) notFound();
  /* A malformed id is a 400 from the API ("uuid is expected"), which the screen
     already renders as "we could not find that job". Pre-filtering here would only
     hide the same message behind a different one. */
  return <ProviderJobScreen locale={locale} bookingId={id} dict={getDictionary(locale)} />;
}
