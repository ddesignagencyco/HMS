"use client";

/* The invoice download button.
 *
 * **It replaces a link that could not work.** `GET /bookings/{id}/invoice.pdf` is
 * `PolicyDecorator`-guarded and returns the PDF to the booking's customer and
 * provider only. A plain `<a href="/api/v1/bookings/…/invoice.pdf">` sends no
 * `Authorization` header, because the access token lives in a module-scoped
 * variable and is attached per request by `client.ts` — and the refresh cookie
 * cannot stand in either, since the API sets it with `Path=/api/v1/auth` and so
 * never replays it to a booking route. Following that link always produced a 401
 * problem document, which the browser rendered as raw JSON where the PDF should
 * have been: a silently broken download on the provider's own job screen.
 *
 * `downloadFile` fetches the file with the bearer token, refreshes once if the
 * token is stale, and saves it through an object URL.
 *
 * The button is only rendered when the job has actually produced an invoice:
 * `CompletionService.bill` writes it on completion, so before that there is
 * nothing to fetch and offering the link would be offering a 404.
 */

import { Loader2, Receipt } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui";
import { downloadFile } from "@/lib/api/download";
import type { Dictionary } from "@/lib/dictionaries";
import type { Locale } from "@/lib/utils";

/** The statuses in which an invoice exists. `completion.service.ts` writes it. */
export const INVOICE_READY_STATUSES = ['AWAITING_VERIFICATION', 'VERIFIED', 'PAYMENT_RELEASED', 'CLOSED'] as const;

export const isInvoiceReady = (status: string): boolean =>
  (INVOICE_READY_STATUSES as readonly string[]).includes(status);

/** The route, relative to the API root — the same path `client.ts` would use. */
export const invoicePdfPath = (bookingId: string): string => `/bookings/${encodeURIComponent(bookingId)}/invoice.pdf`;

export function InvoiceDownload({
  bookingId,
  locale,
  dict
}: {
  bookingId: string;
  locale: Locale;
  dict: Dictionary;
}) {
  const [busy, setBusy] = useState(false);

  const grab = async () => {
    setBusy(true);
    const result = await downloadFile(invoicePdfPath(bookingId), locale, `invoice-${bookingId.slice(0, 8)}.pdf`);
    setBusy(false);
    if (result.ok) toast.success(dict.job.invoiceDownloaded.replace("{file}", result.filename));
    /* A 404 here means the job is not far enough along to have an invoice, which
       is a different message from "the download failed". */
    else toast.error(result.error);
  };

  return (
    <Button type="button" variant="secondary" size="sm" className="mt-4" disabled={busy} onClick={() => void grab()}>
      {busy ? (
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      ) : (
        <Receipt className="size-4" aria-hidden="true" />
      )}
      {busy ? dict.job.invoicePreparing : dict.job.invoiceLink}
    </Button>
  );
}