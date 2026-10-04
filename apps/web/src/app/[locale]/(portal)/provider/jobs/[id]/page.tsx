import { notFound } from "next/navigation";
import { ProviderJob } from "@/features/portal/provider-job";
import { getDictionary } from "@/lib/dictionaries";
import { getBooking } from "@/lib/data";
import { isLocale } from "@/lib/utils";

export default async function ProviderJobPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  if (!isLocale(locale)) notFound();
  const booking = getBooking(id);
  if (!booking) notFound();
  return <ProviderJob locale={locale} dict={getDictionary(locale)} booking={booking} />;
}
