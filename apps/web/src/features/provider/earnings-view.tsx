'use client';

import { AlertTriangle, Banknote, Clock3, TrendingUp } from 'lucide-react';
import { Button, Card, PageHeader, StatCard } from '@/components/ui';
import { useEarnings, useWallet } from '@/features/provider/queries';
import type { Dictionary } from '@/lib/dictionaries';
import { formatMoney, type Locale } from '@/lib/utils';

/* What a professional has earned and what they can ask for.

   `GET /provider/earnings` separates **held** (their share of jobs whose money is
   still in escrow), **releasable** (the wallet, less payouts already requested),
   and **paid to date**. That distinction is the whole point of the screen and the
   one most often got wrong: the previous version computed a 12% commission in the
   browser from a hardcoded `paid = 1842000`. Both are now read from the API —
   `commissionPaisa` is snapshotted per booking from the commission rules, so a
   client-side percentage would be a second source of truth for money.

   Debt is separate and comes from `GET /provider/wallet`: a provider over the
   commission ceiling stops receiving offers, which the screen says plainly rather
   than showing a balance that looks positive while offers are blocked. */

export function ProviderEarningsScreen({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const earnings = useEarnings(locale);
  const wallet = useWallet(locale);

  if (earnings.isPending || wallet.isPending) {
    return (
      <div aria-busy="true" aria-live="polite" className="grid gap-3">
        <span className="skeleton h-8 w-56 rounded-[9px]" />
        <span className="skeleton h-32 w-full rounded-[12px]" />
      </div>
    );
  }

  if (earnings.isError) {
    return (
      <div>
        <PageHeader eyebrow={dict.portal.provider} title={dict.portal.earnings} />
        <div role="alert" className="mt-6 rounded-[14px] border border-rose-200 bg-rose-50 p-5">
          <p className="text-sm font-medium leading-6 text-rose-800">{dict.portal.earningsLoadError}</p>
          <Button type="button" variant="secondary" size="sm" className="mt-4" onClick={() => void earnings.refetch()}>
            {dict.catalogue.retry}
          </Button>
        </div>
      </div>
    );
  }

  const money = earnings.data;
  const balance = wallet.data;
  /* The two are independent reads. If the wallet fails, the debt banner cannot be
     rendered — and silently omitting it would hide the one thing that stops new
     offers arriving, so the wallet section says it could not be read instead. */

  return (
    <div>
      <PageHeader eyebrow={dict.portal.provider} title={dict.portal.earnings} description={dict.portal.earningsDescription} />

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Clock3} label={dict.portal.held} value={formatMoney(money.heldPaisa, locale)} />
        <StatCard icon={Banknote} label={dict.portal.releasable} value={formatMoney(money.releasablePaisa, locale)} />
        <StatCard icon={TrendingUp} label={dict.portal.paidToDate} value={formatMoney(money.paidPaisa, locale)} />
        <StatCard icon={TrendingUp} label={dict.portal.commissionDeducted} value={formatMoney(money.commissionPaisa, locale)} />
      </div>

      {balance !== undefined && balance.offersBlocked ? (
        <div role="alert" className="mt-6 rounded-[14px] border border-amber-200 bg-amber-50 p-5">
          <p className="flex items-start gap-2 text-sm font-medium leading-6 text-amber-900">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {balance.offerBlockedReason ?? dict.portal.offersBlockedDefault}
          </p>
          <p className="mt-2 text-sm leading-6 text-amber-900">{dict.portal.debtOwed.replace('{amount}', formatMoney(balance.debtPaisa, locale))}</p>
        </div>
      ) : null}

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <Card className="p-6">
          <h2 className="font-semibold text-navy">{dict.portal.releasedWeekly}</h2>
          <ReleaseTable locale={locale} dict={dict} rows={money.weekly} />
        </Card>
        <Card className="p-6">
          <h2 className="font-semibold text-navy">{dict.portal.releasedMonthly}</h2>
          <ReleaseTable locale={locale} dict={dict} rows={money.monthly} />
        </Card>
      </div>

      <Card className="mt-5 p-6">
        <h2 className="font-semibold text-navy">{dict.portal.walletTitle}</h2>
        {balance === undefined ? (
          /* The wallet is a second, independent read. Omitting it silently would
             hide the one thing that stops new offers arriving, so say so. */
          <div role="alert" className="mt-3">
            <p className="text-sm font-medium leading-6 text-rose-800">{dict.portal.walletLoadError}</p>
            <Button type="button" variant="secondary" size="sm" className="mt-3" onClick={() => void wallet.refetch()}>
              {dict.catalogue.retry}
            </Button>
          </div>
        ) : (
          <>
            <dl className="mt-4 grid gap-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted">{dict.portal.walletBalance}</dt>
                <dd className="font-medium text-navy">{formatMoney(balance.balancePaisa, locale)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted">{dict.portal.walletDebt}</dt>
                <dd className="font-medium text-navy">{formatMoney(balance.debtPaisa, locale)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted">{dict.portal.walletCeiling}</dt>
                <dd className="font-medium text-navy">{formatMoney(balance.debtCeilingPaisa, locale)}</dd>
              </div>
            </dl>
            <p className="mt-4 text-xs leading-5 text-muted">{dict.portal.walletNote}</p>
          </>
        )}
      </Card>
    </div>
  );
}

/** `earnings()` returns the periods newest-first with a released total each. An
    empty list is a real state — nobody has been paid yet — so it says so rather
    than rendering an empty table. */
function ReleaseTable({ locale, dict, rows }: { locale: Locale; dict: Dictionary; rows: { period: string; releasedPaisa: number }[] }) {
  if (rows.length === 0) {
    return <p className="mt-3 text-sm leading-6 text-secondary">{dict.portal.nothingReleasedYet}</p>;
  }
  return (
    <ul className="mt-3 grid gap-2">
      {rows.map((row) => (
        <li key={row.period} className="flex items-center justify-between gap-4 border-b border-line pb-2 text-sm last:border-0">
          <span className="text-secondary">{row.period}</span>
          <span className="font-medium text-navy">{formatMoney(row.releasedPaisa, locale)}</span>
        </li>
      ))}
    </ul>
  );
}
