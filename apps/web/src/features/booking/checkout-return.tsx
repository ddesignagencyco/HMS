"use client";

import { useEffect, useState } from "react";
import type { Dictionary } from "@/lib/dictionaries";
import { localizedPath, type Locale } from "@/lib/utils";
import { Container, PageBanner, Section } from "@/components/ui";

/* The landing point after an online payment, and the one page in this module
   that deliberately does almost nothing.

   It cannot know whether the payment succeeded. The booking is `PENDING_PAYMENT`
   until the gateway's signed webhook reaches the API, and this page has no way
   to observe that webhook — only `GET /bookings/:id` can, and it answers with
   whatever is true *right now*, which on a fast return may still be
   `PENDING_PAYMENT`.

   So: say what is actually known, wait a moment for the webhook to land, then
   hand over to the booking, which renders the real status. Announcing success
   here would be a guess, and announcing failure would send a customer away whose
   payment had in fact gone through. */

const SETTLE_MS = 2_500;

export function CheckoutReturn({ locale, dict, bookingId }: { locale: Locale; dict: Dictionary; bookingId: string }) {
  const [waited, setWaited] = useState(false);

  /* A short, bounded wait rather than a poll. The webhook is delivered while the
     gateway is still talking to the customer, so by the time the browser gets
     here it has usually landed; anything longer belongs on the booking page,
     which reads live. */
  useEffect(() => {
    const timer = setTimeout(() => setWaited(true), SETTLE_MS);
    return () => clearTimeout(timer);
  }, []);

  const target = `${localizedPath(locale, `/account/bookings/${bookingId}`)}`;

  return (
    <>
      <PageBanner eyebrow={dict.booking.reference} title={dict.booking.checkoutReturnTitle} />
      <Section tone="surface" size="default">
        <Container>
          <div className="mx-auto max-w-xl text-center" aria-live="polite">
            <p className="text-sm leading-6 text-secondary">{dict.booking.checkoutReturnText}</p>
            {/* The link is present immediately rather than after the wait, so a
                customer who prefers not to sit here can leave at any point. */}
            <p className="mt-5">
              <a href={target} className="text-sm font-semibold text-primary-strong hover:underline">
                {dict.booking.checkoutReturnAction}
              </a>
            </p>
            {!waited ? <p className="mt-4 text-xs text-muted">{dict.booking.checkoutReturnWaiting}</p> : null}
          </div>
        </Container>
      </Section>
    </>
  );
}