import { notFound } from "next/navigation";
import { CheckoutReturn } from "@/features/booking/checkout-return";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

/* Where the payment gateway sends the customer back to.
   `POST /bookings` with `paymentMode: "ONLINE"` answers a `payment.redirectUrl`
   whose `returnUrl` is fixed server-side as
   `/checkout/return?bookingId=<id>` (booking.service.ts:134), so this route
   exists because of a string the API chose, not because the flow needed it.

   Two things about the shape of that URL:

   · **It carries no locale.** `src/proxy.ts` prefixes `/en` to anything that is
     not already localised, so a customer who paid in Urdu lands back in English.
     The locale is not recoverable from the URL as the API builds it — see
     BACKEND_REQUIREMENTS.md §3.9.
   · **It is not a booking confirmation.** An online booking stays
     `PENDING_PAYMENT` until the gateway's signed webhook confirms capture, which
     this page cannot know. So it forwards to the booking, which re-reads the
     real status, rather than claiming the payment succeeded here. */

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CheckoutReturnPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const query = await searchParams;
  const raw = Array.isArray(query.bookingId) ? query.bookingId[0] : query.bookingId;

  /* The id is checked here rather than sent on: `/bookings/:id` is behind a
     `ParseUUIDPipe`, so a malformed value would be a 400 the customer cannot do
     anything about. A missing or malformed one is simply not a return. */
  if (raw === undefined || !UUID.test(raw)) notFound();

  return <CheckoutReturn locale={locale} dict={getDictionary(locale)} bookingId={raw} />;
}