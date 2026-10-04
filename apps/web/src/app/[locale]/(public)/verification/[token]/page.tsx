import { notFound } from "next/navigation";
import { VerificationFlow } from "@/features/verification/verification-flow";
import { getDictionary } from "@/lib/dictionaries";
import { bookings } from "@/lib/data";
import { isLocale } from "@/lib/utils";

export default async function VerificationPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; token: string }>;
  searchParams: Promise<{ state?: string; code?: string }>;
}) {
  const { locale, token } = await params;
  if (!isLocale(locale)) notFound();
  const { state, code } = await searchParams;

  /* The token in the URL is opaque to the page; the booking it belongs to is
     carried alongside it. When it is not supplied we fall back to the booking
     the link was issued for, so the header shows a real reference. */
  const booking = code ? bookings.find((item) => item.code === code) : undefined;

  return (
    <VerificationFlow
      locale={locale}
      dict={getDictionary(locale)}
      token={token}
      expired={state === "expired"}
      bookingCode={booking?.code ?? code}
    />
  );
}
