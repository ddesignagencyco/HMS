import { notFound } from 'next/navigation';
import { PlansCatalogue } from '@/features/plans/public-plans-view';

export default async function PlansPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  /* Every other page in this app 404s on an unknown locale; this one
     cannot, because the catalogue below is a client component that needs
     a `Locale` rather than a string. */
  if (locale !== 'en' && locale !== 'ur') notFound();
  return <PlansCatalogue locale={locale} />;
}