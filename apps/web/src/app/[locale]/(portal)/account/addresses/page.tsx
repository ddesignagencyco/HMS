import { notFound } from "next/navigation";
import { AddressesView } from "@/features/portal/customer-views";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

export default async function AddressesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <AddressesView locale={locale} dict={getDictionary(locale)} />;
}
