"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { Dictionary } from "@/lib/dictionaries";
import { localizedPath, type Locale } from "@/lib/utils";
import { useService } from "@/features/catalogue/queries";
import { BookingFlow } from "@/features/booking/booking-flow";
import { NotFoundState } from "@/features/discovery/states";
import { useSession } from "@/features/auth/session";
import { signInPath } from "@/features/auth/routing";

/* Resolves the slug to a real catalogue service before the flow renders.

   `/book/[slug]` used to look the service up in `src/lib/data.ts` and hand the
   flow a mock object whose `serviceId` did not exist in the database, so
   `POST /bookings` could never have accepted it. The service now comes from
   `GET /catalogue/services/:slug`, and the flow is only mounted once it has
   arrived — a 404 is a real not-found state, and an outage is an error with a
   retry. Neither is papered over with the previous mock. */

export function BookService({
  locale,
  dict,
  slug,
  providerId,
  date,
  start,
}: {
  locale: Locale;
  dict: Dictionary;
  slug: string;
  providerId: string | null;
  date: string | null;
  start: string | null;
}) {
  const service = useService(slug, locale);
  const { status: sessionStatus } = useSession();

  /* A UUID, because `/search/providers/:id/slots` is keyed on one. A hand-edited
     `?provider=` that is not one must not reach the API as if it were: the
     request would 400 and the failure would look like the platform's. */
  const carriedProviderId = useMemo(() => (providerId !== null && UUID_PATTERN.test(providerId) ? providerId : null), [providerId]);

  const carriedDate = useMemo(() => (date !== null && DATE_PATTERN.test(date) ? date : null), [date]);
  const carriedStart = useMemo(() => (start !== null && !Number.isNaN(Date.parse(start)) ? start : null), [start]);

  if (service.isPending) {
    return (
      <div className="min-h-dvh bg-page" aria-busy="true" aria-live="polite">
        <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
          <span className="skeleton block h-9 w-64 rounded-[9px]" />
          <span className="skeleton mt-4 block h-4 w-full max-w-md rounded-[9px]" />
          <span className="skeleton mt-6 block h-64 w-full rounded-[14px]" />
        </div>
      </div>
    );
  }

  if (service.isError) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
        <NotFoundState
          title={dict.booking.serviceUnavailable}
          body={dict.booking.serviceUnavailableBody}
          action={
            <button type="button" onClick={() => void service.refetch()} className="text-sm font-semibold text-primary-strong hover:underline">
              {dict.catalogue.retry}
            </button>
          }
        />
      </div>
    );
  }

  /* `POST /bookings`, `POST /bookings/quote` and `GET /customer/addresses` all
     require a signed-in customer, so `/book/[slug]` is a public *route* that can
     only be completed by an account. Rather than let a visitor fill in six steps
     and fail at checkout — or, worse, watch the address step sit on a permanent
     skeleton because its read is correctly disabled — they are told now and sent
     to sign-in with this exact service as the destination.

     Waiting for `status !== "loading"` also means the flow never mounts with an
     unknown session, which is what used to make the first authenticated read
     race the session's own refresh. */
  if (sessionStatus === "loading") {
    return (
      <div className="min-h-dvh bg-page" aria-busy="true" aria-live="polite">
        <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
          <span className="skeleton block h-9 w-64 rounded-[9px]" />
          <span className="skeleton mt-4 block h-4 w-full max-w-md rounded-[9px]" />
          <span className="skeleton mt-6 block h-64 w-full rounded-[14px]" />
        </div>
      </div>
    );
  }

  if (sessionStatus === "anonymous") {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
        <NotFoundState
          title={dict.booking.signInToBookTitle}
          body={dict.booking.signInToBookText}
          action={
            <Link href={signInPath(locale, localizedPath(locale, `/book/${slug}`))} className="text-sm font-semibold text-primary-strong hover:underline">
              {dict.nav.signIn}
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <BookingFlow
      locale={locale}
      dict={dict}
      service={service.data}
      initialProviderId={carriedProviderId}
      initialDate={carriedDate}
      initialStart={carriedStart}
    />
  );
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;