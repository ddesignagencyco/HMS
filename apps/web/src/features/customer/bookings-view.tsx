'use client';

import { useMemo, useState } from 'react';
import { Card, PageHeader } from '@/components/ui';
import { useMyBookings } from '@/features/booking/queries';
import type { BookingStatus } from '@/features/booking/api';
import { useAllServices } from '@/features/catalogue/queries';
import { BookingTable } from '@/features/customer/dashboard-view';
import type { Dictionary } from '@/lib/dictionaries';
import { cn, type Locale } from '@/lib/utils';

/* Every booking the customer has made.
 *
 * Four readable tabs over one response, grouped client-side:
 *
 *   live      — waiting on someone: REQUESTED, SCHEDULED, EN_ROUTE, IN_PROGRESS
 *   finishing — QUOTE_REVISION and AWAITING_VERIFICATION
 *   closed    — everything else that has ended
 *
 * This screen used to be built around the API accepting only ten statuses, with a
 * note on the page telling the customer so. The backend now derives the filter
 * from the database enum, so every status is filterable and the note was both
 * wrong and unnecessary.
 */

/* Grouped locally rather than by a server filter.
   `GET /bookings?status=` now accepts any value of the enum, so it *could* back
   each tab — but "All" sends no status at all, and it is the only read that
   returns history in one request. Filtering the same full list client-side keeps
   all four tabs on one response and one cache entry, and switching tabs cannot
   disagree with what "All" shows. */
const GROUPS = {
  live: ['REQUESTED', 'SCHEDULED', 'EN_ROUTE', 'IN_PROGRESS'] as const,
  finishing: ['QUOTE_REVISION', 'AWAITING_VERIFICATION'] as const
} as const;

type Tab = 'all' | 'live' | 'finishing' | 'closed';

export function CustomerBookingsScreen({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  /* No status is sent: `all` must include history, and the server's filter list
     does not cover the statuses a finished job actually ends in. */
  const bookings = useMyBookings(undefined, locale);
  const services = useAllServices(locale);
  const [tab, setTab] = useState<Tab>('live');

  const names = useMemo(() => {
    const map = new Map<number, string>();
    for (const entry of services.data?.items ?? []) map.set(entry.id, locale === 'ur' ? entry.nameUr : entry.nameEn);
    return map;
  }, [services.data, locale]);

  const rows = bookings.data?.items ?? [];

  const filtered = useMemo(() => {
    const sorted = [...rows].sort((a, b) => b.scheduledStart.localeCompare(a.scheduledStart));
    if (tab === 'all') return sorted;
    const group = GROUPS[tab === 'live' ? 'live' : 'finishing'] as readonly BookingStatus[];
    if (tab === 'closed') {
      return sorted.filter((row) => !group.includes(row.status) && !GROUPS.live.includes(row.status as never));
    }
    return sorted.filter((row) => group.includes(row.status));
  }, [rows, tab]);

  const tabs: { key: Tab; label: string }[] = [
    { key: 'live', label: dict.portal.bookingsInPlay },
    { key: 'finishing', label: dict.portal.bookingsFinishing },
    { key: 'closed', label: dict.portal.bookingsClosed },
    { key: 'all', label: dict.portal.bookingsAll }
  ];

  return (
    <div>
      <PageHeader eyebrow={dict.portal.customer} title={dict.portal.bookings} description={dict.portal.bookingsDescription} />

      <div role="tablist" aria-label={dict.portal.bookings} className="mt-6 flex flex-wrap gap-2">
        {tabs.map((entry) => (
          <button
            key={entry.key}
            type="button"
            role="tab"
            aria-selected={tab === entry.key}
            onClick={() => setTab(entry.key)}
            className={cn(
              'min-h-11 rounded-[9px] border px-4 text-sm font-medium transition-colors',
              tab === entry.key ? 'border-primary bg-primary text-white' : 'border-line bg-white text-secondary hover:border-primary'
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <Card className="mt-4 overflow-hidden">
        <BookingTable locale={locale} dict={dict} items={filtered} names={names} total={rows.length} />
      </Card>

      {bookings.isError ? (
        <p role="alert" className="mt-4 rounded-[10px] bg-rose-50 p-4 text-sm text-rose-800">
          {dict.portal.bookingsLoadError}
        </p>
      ) : null}

      </div>
  );
}
