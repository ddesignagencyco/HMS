'use client';

import { AlertTriangle } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { usePayDebt, useWallet } from '@/features/provider/queries';
import type { Dictionary } from '@/lib/dictionaries';
import { cn, formatMoney, type Locale } from '@/lib/utils';

/* The offer block and the debt behind it, made visible.

   While `providers.offer_blocked_reason` is set, `GET /provider/offers` simply
   returns nothing (`offer.service.ts`) — an empty inbox that looks exactly like a
   quiet day. The wallet is the only place the reason is published, so the offers
   screen and the dashboard both read it and say so.

   "Pay what you owe" starts an online payment (`POST /provider/debt/pay`) for the
   whole debt — `payDebtSchema` makes the amount optional, and the whole debt is
   what lifts a ceiling block. Nothing changes until the gateway confirms, so the
   browser has to follow `redirectUrl`. */

export function DebtNotice({ locale, dict, className }: { locale: Locale; dict: Dictionary; className?: string }) {
  const wallet = useWallet(locale);
  const payDebt = usePayDebt(locale);
  const [error, setError] = useState('');

  const data = wallet.data;
  if (data === undefined || (!data.offersBlocked && data.debtPaisa <= 0)) return null;

  const pay = async (): Promise<void> => {
    setError('');
    try {
      /* A fresh key per click: each click is a new payment attempt, and the
         server mints a new payment for each. The key only guards against the
         same request being delivered twice. */
      const started = await payDebt.mutateAsync({ idempotencyKey: `debt-${crypto.randomUUID()}` });
      window.location.assign(started.redirectUrl);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : dict.portal.payDebtFailed);
    }
  };

  return (
    <div role={data.offersBlocked ? 'alert' : 'status'} className={cn('rounded-[14px] border border-amber-200 bg-amber-50 p-5', className)}>
      {data.offersBlocked ? (
        <p className="flex items-start gap-2 text-sm font-medium leading-6 text-amber-900">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {data.offerBlockedReason ?? dict.portal.offersBlockedDefault}
        </p>
      ) : null}
      {data.debtPaisa > 0 ? (
        <>
          <p className={cn('text-sm leading-6 text-amber-900', data.offersBlocked && 'mt-2')}>{dict.portal.debtOwed.replace('{amount}', formatMoney(data.debtPaisa, locale))}</p>
          <Button type="button" size="sm" className="mt-3" onClick={() => void pay()} disabled={payDebt.isPending}>
            {payDebt.isPending ? dict.portal.payingDebt : dict.portal.payDebt}
          </Button>
        </>
      ) : null}
      {error !== '' ? (
        <p role="alert" className="mt-3 text-sm text-rose-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
