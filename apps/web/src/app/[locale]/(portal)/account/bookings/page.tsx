import { BookingList } from "@/features/booking/booking-list";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";
import { notFound } from "next/navigation";

/** `GET /bookings` — the signed-in account's own bookings, read per request. */
export const dynamic = "force-dynamic";

export default async function AccountBookingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <BookingList locale={locale} dict={getDictionary(locale)} />;
}