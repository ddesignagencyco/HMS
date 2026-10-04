import { notFound } from "next/navigation";
import { CustomerBookings } from "@/features/portal/customer-views";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

export default async function AccountBookingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <CustomerBookings locale={locale} dict={getDictionary(locale)} />;
}
