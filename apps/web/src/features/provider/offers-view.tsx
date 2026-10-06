'use client';

import { AlertCircle, Clock3, MapPin } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, Card, PageHeader } from '@/components/ui';
import { useAcceptOffer, useDeclineOffer, useProviderOffers } from '@/features/provider/queries';
import type { ProviderOffer } from '@/features/provider/api';
import type { Dictionary } from '@/lib/dictionaries';
import { formatDateTime, formatMoney, type Locale } from '@/lib/utils';

/* Offers offered to **the signed-in professional**, each with a server's
   `expiresAt`. The acceptance countdown is real: it ticks on a one-second
   interval and, the moment it reaches zero, the offer stops being actionable —
   an expired offer is shown, greyed, with the reason it is. Nothing about an
   offer moves until a mutation actually succeeds; before that, "accept" is a
   request, not a fact. */

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

const formatCountdown = (expiresAt: string, now: number): string | null => {
  const remaining = new Date(expiresAt).getTime() - now;
  if (remaining <= 0) return null;
  const totalSeconds = Math.floor(remaining / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 1) return `${totalSeconds}s`;
  return `${minutes}m ${totalSeconds % 60}s`;
};

/** Looks like the last sixty seconds — the only window where one second matters. */
const isUrgent = (expiresAt: string, now: number): boolean => {
  const remaining = new Date(expiresAt).getTime() - now;
  return remaining > 0 && remaining < 60_000;
};

type Outcome = 'accepted' | 'declined' | null;

export function ProviderOffersView({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const offers = useProviderOffers(locale);
  const accept = useAcceptOffer(locale);
  const decline = useDeclineOffer(locale);
  const now = useNow(1000);

  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const [localError, setLocalError] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null);

  const act = async (offer: ProviderOffer, kind: 'accept' | 'decline'): Promise<void> => {
    setLocalError('');
    setPendingId(offer.id);
    try {
      if (kind === 'accept') await accept.mutateAsync(offer.id);
      else await decline.mutateAsync({ offerId: offer.id });
      setOutcomes((current) => ({ ...current, [offer.id]: kind === 'accept' ? 'accepted' : 'declined' }));
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : kind === 'accept' ? dict.portal.acceptFailed : dict.portal.declineFailed);
    } finally {
      setPendingId(null);
    }
  };

  if (offers.isPending) {
    return (
      <div aria-busy="true" aria-live="polite" className="grid gap-4">
        <span className="skeleton h-8 w-48 rounded-[9px]" />
        <span className="skeleton h-32 w-full rounded-[12px]" />
      </div>
    );
  }

  if (offers.isError) {
    return (
      <div>
        <PageHeader eyebrow={dict.portal.provider} title={dict.portal.offers} />
        <div role="alert" className="mt-6 rounded-[14px] border border-rose-200 bg-rose-50 p-5">
          <p className="text-sm font-medium leading-6 text-rose-800">{dict.portal.offersError}</p>
          <Button type="button" variant="secondary" size="sm" className="mt-4" onClick={() => void offers.refetch()}>
            {dict.catalogue.retry}
          </Button>
        </div>
      </div>
    );
  }

  const rows = offers.data.items;

  return (
    <div>
      <PageHeader eyebrow={dict.portal.provider} title={dict.portal.offers} description={dict.portal.offersDescription} />

      {rows.length === 0 ? (
        <Card className="mt-6 p-8 text-center text-sm text-secondary">{dict.portal.noOffers}</Card>
      ) : (
        <ul className="mt-6 grid gap-4">
          {rows.map((offer) => {
            const outcome = outcomes[offer.id] ?? null;
            const remaining = formatCountdown(offer.expiresAt, now);
            const expired = remaining === null;
            const urgent = isUrgent(offer.expiresAt, now);
            return (
              <li key={offer.id}>
                <Card className={`p-5 ${expired ? 'opacity-70' : ''}`}>
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-muted">
                        {offer.bookingCode} · {dict.portal.newRequest}
                        {offer.isEmergency ? (
                          <span className="ms-2 inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
                            <AlertCircle className="size-3" aria-hidden="true" />
                            {dict.portal.emergencyTag}
                          </span>
                        ) : null}
                      </p>
                      <h2 className="mt-1 text-lg font-semibold text-navy">{offer.serviceName}</h2>
                      {offer.problemText ? <p className="mt-2 max-w-2xl text-sm leading-6 text-secondary">{offer.problemText}</p> : null}
                      <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted">
                        {offer.areaName !== null ? (
                          <span className="inline-flex items-center gap-1.5">
                            <MapPin className="size-3.5" aria-hidden="true" />
                            {offer.areaName}
                          </span>
                        ) : null}
                        <span className="inline-flex items-center gap-1.5">
                          <Clock3 className="size-3.5" aria-hidden="true" />
                          {formatDateTime(offer.scheduledStart, locale)}
                        </span>
                        <span>{formatMoney(offer.quotedAmountPaisa, locale)}</span>
                      </div>
                    </div>

                    {outcome === 'accepted' ? (
                      <p role="status" className="text-sm font-semibold text-emerald-700">
                        {dict.portal.offerAccepted}
                      </p>
                    ) : outcome === 'declined' ? (
                      <p role="status" className="text-sm font-semibold text-rose-700">
                        {dict.portal.offerDeclined}
                      </p>
                    ) : expired ? (
                      <p role="status" className="text-sm font-semibold text-muted">
                        {dict.portal.offerExpired}
                      </p>
                    ) : (
                      <div className="flex shrink-0 flex-col items-start gap-3 lg:items-end">
                        <p aria-live="polite" className={`text-sm font-semibold ${urgent ? 'text-rose-700' : 'text-amber-700'}`}>
                          {urgent && remaining !== null && remaining.endsWith('s') && !remaining.includes('m') ? dict.portal.expiresSoon : dict.portal.expiresIn.replace('{time}', remaining ?? '')}
                        </p>
                        <div className="flex gap-2">
                          <Button type="button" variant="secondary" size="sm" disabled={pendingId === offer.id} onClick={() => void act(offer, 'decline')}>
                            {dict.portal.decline}
                          </Button>
                          <Button type="button" size="sm" disabled={pendingId === offer.id} onClick={() => void act(offer, 'accept')}>
                            {dict.portal.accept}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {localError !== '' ? (
        <p role="alert" className="mt-4 rounded-[9px] bg-rose-50 p-3 text-sm text-rose-700">
          {localError}
        </p>
      ) : null}
    </div>
  );
}
