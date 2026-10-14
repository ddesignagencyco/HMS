'use client';

import { Check, Info, Loader2, X } from 'lucide-react';
import { useState } from 'react';
import { Button, Card } from '@/components/ui';
import type { Booking } from '@/features/booking/api';
import { useApproveRevision, useRejectRevision } from '@/features/booking/queries';
import { hasPendingRevision } from '@/features/booking/status';
import type { Dictionary } from '@/lib/dictionaries';
import { cn, type Locale } from '@/lib/utils';

export type RevisionCardProps = {
  locale: Locale;
  dict: Dictionary;
  booking: Booking;
  className?: string;
};

/**
 * FR-EX-05: The provider found extra work and submitted a quote revision.
 * The booking moves to QUOTE_REVISION and awaits customer decision.
 *
 * This card allows the customer to:
 * 1. Approve the extra work (transitions to IN_PROGRESS on CASH, or starts topup checkout on ONLINE).
 * 2. Reject it (transitions back to IN_PROGRESS at original quote, or completes at visit fee if inspection-first).
 */
export function RevisionCard({ locale, dict, booking, className }: RevisionCardProps) {
  const approve = useApproveRevision(locale);
  const reject = useRejectRevision(locale);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!hasPendingRevision(booking)) {
    return null;
  }

  const isPending = approve.isPending || reject.isPending;

  const handleApprove = async () => {
    setErrorMessage(null);
    try {
      const result = await approve.mutateAsync(booking.id);
      if (result.payment !== undefined && typeof window !== 'undefined') {
        window.location.assign(result.payment.redirectUrl);
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : dict.booking.actionFailed);
    }
  };

  const handleReject = async () => {
    setErrorMessage(null);
    try {
      await reject.mutateAsync(booking.id);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : dict.booking.actionFailed);
    }
  };

  return (
    <Card
      className={cn(
        'border-2 border-amber-300 bg-amber-50/90 p-5 shadow-sm transition-all',
        className
      )}
    >
      <div className="flex items-start gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-amber-200/80 text-amber-800">
          <Info className="size-5" aria-hidden="true" />
        </div>
        <div className="flex-1">
          <h2 className="text-base font-semibold text-navy">{dict.booking.revisionTitle}</h2>
          <p className="mt-1.5 text-sm leading-6 text-amber-900">{dict.booking.revisionText}</p>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button
              type="button"
              onClick={() => void handleApprove()}
              disabled={isPending}
              className="gap-2 bg-primary hover:bg-primary-strong"
            >
              {approve.isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Check className="size-4" aria-hidden="true" />
              )}
              {dict.booking.revisionApprove}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void handleReject()}
              disabled={isPending}
              className="gap-2 border-amber-300 bg-white hover:bg-amber-100/50 text-navy"
            >
              {reject.isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <X className="size-4" aria-hidden="true" />
              )}
              {dict.booking.revisionReject}
            </Button>
          </div>

          {errorMessage ? (
            <p role="alert" className="mt-3 text-xs font-medium text-rose-700">
              {errorMessage}
            </p>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
