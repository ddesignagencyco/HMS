import { notFound } from "next/navigation";
import { BookingDetailView } from "@/features/portal/customer-views";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

export default async function BookingDetailPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  if (!isLocale(locale)) notFound();
  return <BookingDetailView locale={locale} dict={getDictionary(locale)} id={id} />;
}
