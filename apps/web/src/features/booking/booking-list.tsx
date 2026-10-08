"use client";

import { CalendarDays, ReceiptText } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { Dictionary } from "@/lib/dictionaries";
import { formatDateTime, localizedPath, type Locale } from "@/lib/utils";
import { Card, PageHeader, buttonStyles } from "@/components/ui";
import { SelectField } from "@/components/select-field";
import { money } from "@/features/catalogue/pricing";
import { bookingTotalPaisa, isLiveBooking } from "@/features/booking/status";
import { useMyBookings } from "@/features/booking/queries";
import type { Booking, BookingListStatus } from "@/features/booking/api";
import { EmptyState, InlineError } from "@/features/discovery/states";
import { isNotFoundError } from "@/lib/api/keys";
import { useServiceNames } from "@/features/booking/service-names";

/* `GET /bookings` — every booking the signed-in account is the customer or the
   provider on, newest first.

   Two honest limits shape this page:

   · **The endpoint has no paging and no cursor.** It takes a single optional
     `status` and answers with everything. So there is no pager here, and none is
     invented — a fake "load more" over an already-complete response would be a
     control that does nothing.

   · **A booking row carries a `serviceId` and nothing readable.** No service
     name, no provider name, no address. `serviceNames` joins the id to the
     catalogue, and where even that fails the row says so rather than showing a
     number as if it were a name. */

const FILTERS: { value: BookingListStatus | undefined; key: "all" | "active" | "closed" }[] = [
  { value: undefined, key: "all" },
  { value: "SCHEDULED", key: "active" },
  { value: "REQUESTED", key: "active" },
  { value: "IN_PROGRESS", key: "active" },
  { value: "CANCELLED_CUSTOMER", key: "closed" },
  { value: "NO_SHOW", key: "closed" },
];

export function BookingList({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const [filter, setFilter] = useState<BookingListStatus | undefined>(undefined);
  const bookings = useMyBookings(filter, locale);
  const names = useServiceNames(locale);

  const items = bookings.data?.items ?? [];
  const active = items.filter((booking) => isLiveBooking(booking.status));
  const closed = items.filter((booking) => !isLiveBooking(booking.status));
  const visible = filter === undefined ? items : items;

  return (
    <div>
      <PageHeader eyebrow={dict.portal.customer} title={dict.portal.bookings} description={dict.portal.bookingsDescription} />

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div className="w-full max-w-xs">
          <label htmlFor="booking-filter" className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-muted">
            {dict.portal.bookingsFilter}
          </label>
          <SelectField
            id="booking-filter"
            size="sm"
            value={filter ?? ""}
            onChange={(value) => setFilter(value === "" ? undefined : (value as BookingListStatus))}
            options={FILTERS.map((option) => ({ value: option.value ?? "", label: dict.portal.bookingFilterLabels[option.key] }))}
            placeholder={dict.portal.bookingFilterLabels.all}
          />
        </div>
        <p className="text-xs text-muted">{dict.portal.bookingsNoPaging}</p>
      </div>

      {bookings.isPending ? (
        <div className="mt-6 grid gap-3" aria-busy="true" aria-live="polite">
          {Array.from({ length: 3 }, (_, index) => (
            <span key={index} className="skeleton block h-20 w-full rounded-[14px]" />
          ))}
        </div>
      ) : bookings.isError ? (
        <InlineError
          className="mt-6"
          title={isNotFoundError(bookings.error) ? dict.portal.bookingNotFound : dict.portal.bookingsError}
          actionLabel={dict.catalogue.retry}
          onRetry={() => void bookings.refetch()}
        />
      ) : visible.length === 0 ? (
        <EmptyState
          className="mt-6"
          title={dict.portal.noBookingsTitle}
          body={dict.portal.noBookingsBody}
          icon={<CalendarDays className="size-8" aria-hidden="true" />}
          action={
            <Link href={localizedPath(locale, "/services")} className={buttonStyles()}>
              {dict.portal.browseServices}
            </Link>
          }
        />
      ) : (
        <div className="mt-6 grid gap-6">
          {filter === undefined && active.length > 0 ? (
            <BookingGroup locale={locale} dict={dict} title={dict.portal.activeBookings} items={active} names={names} />
          ) : null}
          {filter === undefined && closed.length > 0 ? (
            <BookingGroup locale={locale} dict={dict} title={dict.portal.pastBookings} items={closed} names={names} />
          ) : null}
          {filter !== undefined ? <BookingGroup locale={locale} dict={dict} title={dict.portal.filteredBookings} items={visible} names={names} /> : null}
        </div>
      )}
    </div>
  );
}

function BookingGroup({
  locale,
  dict,
  title,
  items,
  names,
}: {
  locale: Locale;
  dict: Dictionary;
  title: string;
  items: Booking[];
  names: Record<number, string>;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-line p-5">
        <h2 className="font-semibold text-navy">{title}</h2>
      </div>
      <ul className="divide-y divide-line">
        {items.map((booking) => (
          <li key={booking.id} className="p-4 hover:bg-slate-50 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <Link
                  href={localizedPath(locale, `/account/bookings/${booking.id}`)}
                  className="font-medium text-navy hover:text-primary-strong"
                >
                  {names[booking.serviceId] ?? dict.portal.unknownService}
                </Link>
                <p className="mt-1 font-mono text-xs text-muted">{booking.code}</p>
                <p className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarDays className="size-3.5" aria-hidden="true" />
                    {formatDateTime(booking.scheduledStart, locale)}
                  </span>
                  <span className="inline-flex items-center gap-1.5 font-semibold text-navy tabular-nums">
                    <ReceiptText className="size-3.5" aria-hidden="true" />
                    {money(bookingTotalPaisa(booking), locale)}
                  </span>
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className={statusTone(booking.status)}>{dict.bookingStatus[booking.status] ?? booking.status}</span>
                {booking.providerId !== null ? (
                  <Link
                    href={localizedPath(locale, `/provider/jobs/${booking.id}`)}
                    className="text-xs font-semibold text-primary-strong hover:underline"
                  >
                    {dict.portal.openJob}
                  </Link>
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

const statusTone = (status: Booking["status"]): string => {
  if (status === "VERIFIED" || status === "AUTO_RELEASED" || status === "PAYMENT_RELEASED" || status === "CLOSED")
    return "rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700";
  if (status === "DISPUTED" || status === "CANCELLED_CUSTOMER" || status === "CANCELLED_PROVIDER" || status === "NO_SHOW")
    return "rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700";
  if (status === "AWAITING_VERIFICATION" || status === "REWORK_REQUIRED")
    return "rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800";
  return "rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700";
};