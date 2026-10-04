import { notFound } from "next/navigation";
import { VerificationConsole } from "@/features/portal/verification-console";
import { getDictionary } from "@/lib/dictionaries";
import { bookings } from "@/lib/data";
import { isLocale } from "@/lib/utils";

export default async function AgentVerificationPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  if (!isLocale(locale)) notFound();
  /* An unknown id used to fall through to the first booking, so a mistyped or
     stale link silently opened somebody else's record. */
  const booking = bookings.find((item) => item.id === id);
  if (!booking) notFound();
  return <VerificationConsole locale={locale} dict={getDictionary(locale)} booking={booking} />;
}
