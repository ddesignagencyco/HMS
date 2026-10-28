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

import { CheckCircle2, Download, Loader2, Receipt, ShieldCheck } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";
import { Button, Card } from "@/components/ui";
import { downloadFile } from "@/lib/api/download";
import type { BookingDetail } from "@/features/booking/api";
import type { Dictionary } from "@/lib/dictionaries";
import { cn, formatDate, formatMoney, type Locale } from "@/lib/utils";

/**
 * The statuses in which an invoice exists.
 *
 * `CompletionService.bill` writes it in the same transaction as `complete` (or
 * `completeAtVisitFee`), and `invoicePdf` serves it from then on with no status
 * check — so it is downloadable from WORK_COMPLETED onward, through verification,
 * rework and dispute, and after any refund. Only statuses that are reachable
 * *without* completing (cancellation, no-show, unfulfilled) are left out.
 */
export const INVOICE_READY_STATUSES = [
  'WORK_COMPLETED',
  'AWAITING_VERIFICATION',
  'REWORK_REQUIRED',
  'VERIFIED',
  'AUTO_RELEASED',
  'DISPUTED',
  'PAYMENT_RELEASED',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
  'CLOSED'
] as const;

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
    else toast.error(result.error);
  };

  return (
    <Button type="button" variant="secondary" size="sm" className="gap-2" disabled={busy} onClick={() => void grab()}>
      {busy ? (
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      ) : (
        <Download className="size-4" aria-hidden="true" />
      )}
      {busy ? dict.job.invoicePreparing : dict.job.invoiceLink}
    </Button>
  );
}

export interface InvoiceBookingLike {
  id: string;
  code: string;
  status: string;
  createdAt?: string;
  completedAt?: string | null;
  serviceName?: string | null;
  paymentMode?: string;
  finalAmountPaisa?: number | null;
  approvedTotalPaisa?: number;
  discountPaisa?: number;
  customerName?: string | null;
  providerName?: string | null;
  addressLine1?: string | null;
  areaName?: string | null;
  items?: Array<{
    id: string;
    kind: string;
    description: string;
    quantity: number;
    unitPricePaisa: number;
    amountPaisa: number;
  }>;
}

/**
 * Modern itemized invoice card featuring the styled royal-blue header and PAID badge.
 * Provides a clean on-screen receipt for both customer and provider portals.
 */
export function BookingInvoiceCard({
  booking,
  locale,
  dict,
  className
}: {
  booking: InvoiceBookingLike;
  locale: Locale;
  dict: Dictionary;
  className?: string;
}) {
  const isPaid = booking.status === "PAYMENT_RELEASED" || booking.status === "VERIFIED" || booking.status === "CLOSED";
  const isEscrow = booking.status === "AWAITING_VERIFICATION";
  const items = booking.items && booking.items.length > 0
    ? booking.items
    : [
        {
          id: "1",
          kind: "SERVICE",
          description: booking.serviceName || "Service Delivery",
          quantity: 1,
          unitPricePaisa: booking.finalAmountPaisa ?? booking.approvedTotalPaisa ?? 0,
          amountPaisa: booking.finalAmountPaisa ?? booking.approvedTotalPaisa ?? 0
        }
      ];

  const subtotalPaisa = items.reduce((sum, item) => sum + (item.amountPaisa || 0), 0);
  const discountPaisa = booking.discountPaisa ?? 0;
  const totalPaisa = booking.finalAmountPaisa ?? booking.approvedTotalPaisa ?? subtotalPaisa;

  return (
    <Card className={cn("overflow-hidden border border-slate-200/80 shadow-md bg-white", className)}>
      {/* Wave / Gradient Header matching reference design */}
      <div className="relative bg-gradient-to-r from-blue-950 via-blue-900 to-blue-700 p-6 text-white overflow-hidden">
        <div className="absolute -right-12 -bottom-12 w-48 h-48 rounded-full bg-blue-500/20 blur-2xl pointer-events-none" />
        <div className="relative z-10 flex flex-wrap items-start justify-between gap-4">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-blue-300">Official Tax Receipt</span>
            <h2 className="text-2xl font-black tracking-wider text-white">INVOICE</h2>
            <p className="mt-1 text-xs text-blue-200">Smart Home Maintenance Services</p>
          </div>
          <div className="text-end">
            <span className="inline-block rounded-full bg-white/10 px-3 py-1 text-xs font-mono font-semibold tracking-wider text-white border border-white/20">
              NO: INV-{booking.code || booking.id.slice(0, 8).toUpperCase()}
            </span>
            <p className="mt-1.5 text-[11px] text-blue-200">
              {booking.completedAt ? formatDate(booking.completedAt, locale) : formatDate(booking.createdAt, locale)}
            </p>
          </div>
        </div>
      </div>

      <div className="p-6">
        {/* Parties Grid & PAID Badge */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pb-6 border-b border-slate-100">
          <div>
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Bill To:</h3>
            <p className="mt-1 text-sm font-semibold text-slate-900">{booking.customerName || "Customer"}</p>
            {booking.addressLine1 ? (
              <p className="mt-0.5 text-xs text-slate-600">
                {[booking.addressLine1, booking.areaName].filter(Boolean).join(", ")}
              </p>
            ) : null}
            <p className="mt-1 text-xs text-slate-500 font-mono">Payment: {booking.paymentMode || "Online"}</p>
          </div>

          <div className="sm:text-end flex flex-col sm:items-end justify-between gap-3">
            <div>
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-400">From / Tradesman:</h3>
              <p className="mt-1 text-sm font-semibold text-slate-900">{booking.providerName || "Service Professional"}</p>
              {booking.serviceName ? <p className="mt-0.5 text-xs text-slate-600">{booking.serviceName}</p> : null}
            </div>

            {/* Prominent Badge matching Image 2 */}
            <div>
              {isPaid ? (
                <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3.5 py-1 text-xs font-black uppercase tracking-widest text-white shadow-sm shadow-emerald-500/30">
                  <CheckCircle2 className="size-3.5" />
                  PAID
                </span>
              ) : isEscrow ? (
                <span className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1 text-xs font-bold uppercase tracking-wider text-white shadow-sm shadow-blue-500/30">
                  <ShieldCheck className="size-3.5" />
                  ESCROW HELD
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-md bg-amber-500 px-3 py-1 text-xs font-bold uppercase tracking-wider text-white">
                  PENDING SETTLEMENT
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Itemized Table */}
        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-400 uppercase text-[10px] tracking-wider">
                <th className="pb-3 font-bold">Description</th>
                <th className="pb-3 text-center font-bold w-16">Qty</th>
                <th className="pb-3 text-end font-bold w-24">Price</th>
                <th className="pb-3 text-end font-bold w-24">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item, idx) => (
                <tr key={item.id || idx} className="hover:bg-slate-50/60">
                  <td className="py-3 font-medium text-slate-800">{item.description}</td>
                  <td className="py-3 text-center text-slate-600">{item.quantity || 1}</td>
                  <td className="py-3 text-end text-slate-600">{formatMoney(item.unitPricePaisa || item.amountPaisa || 0, locale)}</td>
                  <td className="py-3 text-end font-semibold text-slate-900">{formatMoney(item.amountPaisa || 0, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Totals Section */}
        <div className="mt-6 pt-4 border-t border-slate-200 flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
          <div className="text-xs text-slate-500 max-w-xs">
            <p className="font-semibold text-slate-700">Payment Information:</p>
            <p className="mt-0.5">Method: {booking.paymentMode === "CASH" ? "Cash Collection" : "Online Secure Escrow"}</p>
            <p className="mt-0.5">Booking Ref: {booking.code}</p>
            <p className="mt-2 text-sm font-bold text-blue-900">Thank You!</p>
          </div>

          <div className="w-full sm:w-64 space-y-2 text-xs">
            <div className="flex justify-between text-slate-600">
              <span>Sub Total:</span>
              <span className="font-medium text-slate-900">{formatMoney(subtotalPaisa, locale)}</span>
            </div>
            {discountPaisa > 0 ? (
              <div className="flex justify-between text-emerald-700">
                <span>Discount:</span>
                <span>-{formatMoney(discountPaisa, locale)}</span>
              </div>
            ) : null}
            <div className="flex justify-between items-center rounded-lg bg-blue-900 p-3 text-white font-bold text-sm shadow-sm">
              <span>TOTAL DUE:</span>
              <span>{formatMoney(totalPaisa, locale)}</span>
            </div>
          </div>
        </div>

        {/* Action Button */}
        <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-end">
          <InvoiceDownload bookingId={booking.id} locale={locale} dict={dict} />
        </div>
      </div>
    </Card>
  );
}