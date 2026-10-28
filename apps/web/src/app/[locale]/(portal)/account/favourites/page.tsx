import { notFound } from 'next/navigation';
import { CustomerFavouritesScreen } from '@/features/customer/favourites-view';
import { getDictionary } from '@/lib/dictionaries';
import { isLocale } from '@/lib/utils';

export default async function AccountFavouritesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <CustomerFavouritesScreen locale={locale} dict={getDictionary(locale)} />;
}
