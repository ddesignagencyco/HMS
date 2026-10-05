import { notFound } from "next/navigation";
import { BookService } from "@/features/booking/book-service";
import { RequireSession } from "@/components/require-session";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

/* Booking needs a customer session for both `POST /bookings/quote` and
   `POST /bookings`, so `RequireSession` gates the page: a signed-out visitor
   goes to sign-in with a return destination back to this URL, and the query
   string carrying the chosen slot survives the round trip because
   `RequireSession` sends the full path *and* search.

   The service is read client-side from `GET /catalogue/services/:slug` rather
   than baked in at build time. `serviceId` is a number the API assigns and
   `POST /bookings` insists on it, so it has to come from the API — and the
   previous version of this page read it from `src/lib/data.ts`, which is mock
   data whose ids do not exist in the database. */

/** A booking always prices against live catalogue and provider data. */
export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;

const one = (value: string | string[] | undefined): string | null => (Array.isArray(value) ? (value[0] ?? null) : (value ?? null));

export default async function BookingPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<Search>;
}) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  const query = await searchParams;

  return (
    <RequireSession locale={locale}>
      <BookService
        locale={locale}
        dict={getDictionary(locale)}
        slug={slug}
        /* Carried in from a provider profile's availability panel, so a chosen
           professional and time survive the hop into the flow. */
        providerId={one(query.provider)}
        date={one(query.date)}
        start={one(query.start)}
      />
    </RequireSession>
  );
}