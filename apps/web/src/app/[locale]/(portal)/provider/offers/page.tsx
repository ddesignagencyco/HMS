import { notFound } from "next/navigation";
import { ProviderOffers } from "@/features/portal/provider-offers";
import { getDictionary } from "@/lib/dictionaries";
import { getRequestedBookings } from "@/lib/data";
import { isLocale } from "@/lib/utils";

export default async function ProviderOffersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <ProviderOffers locale={locale} dict={getDictionary(locale)} offers={getRequestedBookings()} />;
}
