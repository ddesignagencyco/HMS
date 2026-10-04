import { notFound } from "next/navigation";
import { CustomerFavourites } from "@/features/portal/customer-plan-views";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

export default async function AccountFavouritesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <CustomerFavourites locale={locale} dict={getDictionary(locale)} />;
}
