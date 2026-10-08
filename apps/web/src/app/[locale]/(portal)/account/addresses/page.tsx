import { notFound } from "next/navigation";
import { AddressBookView } from "@/features/account/addresses-view";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

export default async function AddressesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <AddressBookView locale={locale} dict={getDictionary(locale)} />;
}
