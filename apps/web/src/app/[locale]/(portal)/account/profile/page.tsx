import { notFound } from 'next/navigation';
import { ProfileDetails } from '@/features/account/profile-view';
import { getDictionary } from '@/lib/dictionaries';
import { isLocale } from '@/lib/utils';

export default async function ProfilePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  /* The locale is used, not merely validated: `PATCH /me` writes it, so the
     language control has to be initialised from the route the person is on. */
  return <ProfileDetails dict={getDictionary(locale)} locale={locale} />;
}
