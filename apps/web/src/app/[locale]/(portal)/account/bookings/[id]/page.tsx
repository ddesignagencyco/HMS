import { notFound } from "next/navigation";
import { BookingDetail } from "@/features/booking/booking-detail";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

/** `GET /bookings/:id`. Live state, so never baked into a build. */
export const dynamic = "force-dynamic";

export default async function AccountBookingDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  if (!isLocale(locale)) notFound();
  /* A malformed id never reaches the API. `ParseUUIDPipe` would answer 400,
     which is the server disagreeing with the URL rather than the booking being
     absent, and the two deserve different words on screen. */
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();
  return <BookingDetail locale={locale} dict={getDictionary(locale)} bookingId={id} />;
}