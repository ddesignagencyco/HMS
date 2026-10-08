'use client';

import { Suspense, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { MessageSquare, ExternalLink, Calendar, Clock, Wrench } from 'lucide-react';
import { Card, PageHeader } from '@/components/ui';
import { useMyBookings } from '@/features/booking/queries';
import { useAllServices } from '@/features/catalogue/queries';
import { BookingChat } from '@/features/booking/booking-chat';
import type { BookingStatus } from '@/features/booking/api';
import type { Dictionary } from '@/lib/dictionaries';
import { cn, formatDateTime, localizedPath, type Locale } from '@/lib/utils';

interface InboxViewProps {
  locale: Locale;
  dict: Dictionary;
  role: 'customer' | 'provider';
}

const STATUS_TONES: Partial<Record<BookingStatus, string>> = {
  VERIFIED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  PAYMENT_RELEASED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  WORK_COMPLETED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  AWAITING_VERIFICATION: 'bg-teal-50 text-teal-800 border-teal-200',
  IN_PROGRESS: 'bg-amber-50 text-amber-800 border-amber-200',
  EN_ROUTE: 'bg-amber-50 text-amber-800 border-amber-200',
  SCHEDULED: 'bg-sky-50 text-sky-800 border-sky-200',
  QUOTE_REVISION: 'bg-violet-50 text-violet-800 border-violet-200',
  DISPUTED: 'bg-rose-50 text-rose-700 border-rose-200',
  CANCELLED_CUSTOMER: 'bg-rose-50 text-rose-700 border-rose-200',
  CANCELLED_PROVIDER: 'bg-rose-50 text-rose-700 border-rose-200',
  NO_SHOW: 'bg-rose-50 text-rose-700 border-rose-200',
  REFUNDED: 'bg-rose-50 text-rose-700 border-rose-200'
};

function StatusPill({ status, label }: { status: BookingStatus; label: string }) {
  const tone = STATUS_TONES[status] ?? 'bg-slate-100 text-slate-700 border-slate-200';
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold', tone)}>
      {label}
    </span>
  );
}

function InboxViewContent({ locale, dict, role }: InboxViewProps) {
  const searchParams = useSearchParams();
  const urlBookingId = searchParams.get('bookingId');

  const bookings = useMyBookings(undefined, locale);
  const services = useAllServices(locale);

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const names = useMemo(() => {
    const map = new Map<number, string>();
    for (const entry of services.data?.items ?? []) {
      map.set(entry.id, locale === 'ur' ? entry.nameUr : entry.nameEn);
    }
    return map;
  }, [services.data, locale]);

  const rows = useMemo(() => {
    const items = bookings.data?.items ?? [];
    return [...items].sort((a, b) => b.scheduledStart.localeCompare(a.scheduledStart));
  }, [bookings.data?.items]);

  const activeId =
    (urlBookingId && rows.some((b) => b.id === urlBookingId) ? urlBookingId : null) ??
    (selectedId && rows.some((b) => b.id === selectedId) ? selectedId : null) ??
    rows[0]?.id ??
    null;

  const selectedBooking = useMemo(() => {
    return rows.find((b) => b.id === activeId) ?? null;
  }, [rows, activeId]);

  const pageTitle = locale === 'ur' ? 'پیغامات اور ان باکس' : 'Messages & Chat';
  const pageEyebrow = role === 'customer' ? dict.portal.customer : dict.portal.provider;
  const pageDescription =
    locale === 'ur'
      ? 'اپنی بکنگز اور جابز سے متعلق لائیو پیغامات دیکھیں اور بات چیت کریں۔'
      : 'Direct real-time communication for your scheduled bookings and active jobs.';

  if (bookings.isPending) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow={pageEyebrow} title={pageTitle} description={pageDescription} />
        <div className="grid gap-4 lg:grid-cols-12">
          <div className="skeleton h-96 rounded-2xl lg:col-span-5" />
          <div className="skeleton h-96 rounded-2xl lg:col-span-7" />
        </div>
      </div>
    );
  }

  if (bookings.isError) {
    return (
      <div>
        <PageHeader eyebrow={pageEyebrow} title={pageTitle} />
        <div role="alert" className="mt-6 rounded-[14px] border border-rose-200 bg-rose-50 p-5">
          <p className="text-sm font-medium leading-6 text-rose-800">{dict.portal.bookingsLoadError}</p>
        </div>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div>
        <PageHeader eyebrow={pageEyebrow} title={pageTitle} description={pageDescription} />
        <Card className="mt-6 flex flex-col items-center justify-center p-12 text-center">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
            <MessageSquare className="size-7" />
          </div>
          <h2 className="mt-4 text-base font-semibold text-navy">
            {locale === 'ur' ? 'کوئی گفتگو موجود نہیں' : 'No Booking Conversations'}
          </h2>
          <p className="mt-2 max-w-sm text-sm text-secondary">
            {locale === 'ur'
              ? 'جب آپ کے پاس کوئی بکنگ یا جاب شیڈول ہوگی تو اس کا لائیو چیٹ تھریڈ یہاں ظاہر ہوگا۔'
              : 'When you have a scheduled booking or active job, its live chat thread will appear here.'}
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={pageEyebrow} title={pageTitle} description={pageDescription} />

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Left column: List of conversations */}
        <div className="lg:col-span-5 xl:col-span-4">
          <Card className="overflow-hidden p-0">
            <div className="border-b border-line bg-surface-2 px-4 py-3">
              <h2 className="text-xs font-bold uppercase tracking-wider text-muted">
                {locale === 'ur' ? `گفتگو (${rows.length})` : `Conversations (${rows.length})`}
              </h2>
            </div>
            <div className="max-h-[680px] divide-y divide-line overflow-y-auto">
              {rows.map((b) => {
                const isSelected = selectedBooking?.id === b.id;
                const serviceName = names.get(b.serviceId) ?? b.code;
                const statusLabel = dict.bookingStatus[b.status] ?? b.status;

                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setSelectedId(b.id)}
                    className={cn(
                      'w-full text-start p-4 transition-all hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                      isSelected && 'bg-primary/5 border-s-4 border-s-primary'
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className={cn('text-sm font-semibold truncate', isSelected ? 'text-primary' : 'text-navy')}>
                        {serviceName}
                      </p>
                      <StatusPill status={b.status} label={statusLabel} />
                    </div>

                    <p className="mt-1 font-mono text-xs text-muted truncate">
                      {b.code}
                    </p>

                    <div className="mt-2 flex items-center gap-1.5 text-xs text-secondary">
                      <Clock className="size-3.5 text-muted shrink-0" />
                      <span>{formatDateTime(b.scheduledStart, locale)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </Card>
        </div>

        {/* Right column: Active Chat and Booking Context */}
        <div className="lg:col-span-7 xl:col-span-8">
          {selectedBooking ? (
            <div className="space-y-4">
              <Card className="p-4 bg-white border border-line">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-navy flex items-center gap-2">
                      <Wrench className="size-4 text-primary" />
                      {names.get(selectedBooking.serviceId) ?? selectedBooking.code}
                    </h2>
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-secondary">
                      <span className="font-mono text-muted">{selectedBooking.code}</span>
                      <span>•</span>
                      <span className="flex items-center gap-1">
                        <Calendar className="size-3 text-muted" />
                        {formatDateTime(selectedBooking.scheduledStart, locale)}
                      </span>
                    </div>
                  </div>

                  <Link
                    href={localizedPath(
                      locale,
                      role === 'customer'
                        ? `/account/bookings/${selectedBooking.id}`
                        : `/provider/jobs/${selectedBooking.id}`
                    )}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-secondary hover:bg-slate-50 hover:text-navy transition-colors"
                  >
                    <span>{role === 'customer' ? dict.portal.booking : dict.job.detailsTitle}</span>
                    <ExternalLink className="size-3.5" />
                  </Link>
                </div>
              </Card>

              <BookingChat locale={locale} dict={dict} booking={selectedBooking} />
            </div>
          ) : (
            <Card className="flex h-96 items-center justify-center p-6 text-center text-secondary">
              <p className="text-sm">
                {locale === 'ur' ? 'براہ کرم کوئی گفتگو منتخب کریں۔' : 'Select a booking to view chat history.'}
              </p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

export function InboxView(props: InboxViewProps) {
  return (
    <Suspense
      fallback={
        <div className="space-y-6">
          <div className="skeleton h-12 w-64 rounded-xl" />
          <div className="grid gap-4 lg:grid-cols-12">
            <div className="skeleton h-96 rounded-2xl lg:col-span-5" />
            <div className="skeleton h-96 rounded-2xl lg:col-span-7" />
          </div>
        </div>
      }
    >
      <InboxViewContent {...props} />
    </Suspense>
  );
}
