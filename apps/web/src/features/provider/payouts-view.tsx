'use client';

import { Building2, Plus, Wallet } from 'lucide-react';
import { useState } from 'react';
import { Button, Card, Input, Label, PageHeader } from '@/components/ui';
import { SelectField } from '@/components/select-field';
import { useEarnings, usePayoutAccounts, usePayouts, useRequestPayout, useAddPayoutAccount } from '@/features/provider/queries';
import type { PayoutStatus } from '@/features/provider/api';
import type { Dictionary } from '@/lib/dictionaries';
import { cn, formatDate, formatMoney, type Locale } from '@/lib/utils';

/* Payouts: where money goes, and what has already gone.

   The rules this screen has to respect, all enforced server-side:

   · **At least `payout.min_amount_paisa`.** That setting is admin-owned and is
     only readable through `GET /admin/settings/{key}`, which a provider cannot
     call — so the screen does not pretend to know the minimum. It sends what the
     professional typed and shows the server's own refusal, which names the figure.

   · **No more than the releasable balance.** `earnings.releasablePaisa` is the
     wallet less payouts already `REQUESTED`, so it is the honest ceiling, and the
     input defaults to it rather than to an invented round number.

   · **An account number is stored encrypted** and is never returned — only
     `accountLast4`. So there is nothing to re-display, and the form is the only
     place it exists. */

const STATUS_TONE: Record<PayoutStatus, string> = {
  REQUESTED: 'bg-amber-50 text-amber-700',
  APPROVED: 'bg-blue-50 text-primary-strong',
  PROCESSING: 'bg-blue-50 text-primary-strong',
  PAID: 'bg-emerald-50 text-emerald-700',
  REJECTED: 'bg-rose-50 text-rose-700'
};

export function ProviderPayoutsScreen({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const payouts = usePayouts(locale);
  const accounts = usePayoutAccounts(locale);
  const earnings = useEarnings(locale);
  const request = useRequestPayout(locale);
  const addAccount = useAddPayoutAccount(locale);

  const [accountId, setAccountId] = useState<string>('');
  const [amount, setAmount] = useState<string>('');
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<'BANK' | 'WALLET'>('BANK');
  const [accountTitle, setAccountTitle] = useState('');
  const [institution, setInstitution] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [localError, setLocalError] = useState('');
  const [done, setDone] = useState('');

  const releasable = earnings.data?.releasablePaisa ?? 0;

  const askForPayout = async (): Promise<void> => {
    setLocalError('');
    setDone('');
    const paisa = Math.round(Number(amount) * 100);
    if (!Number.isFinite(paisa) || paisa <= 0) {
      setLocalError(dict.portal.payoutAmountInvalid);
      return;
    }
    const chosen = accountId !== '' ? accountId : (accounts.data?.items[0]?.id ?? '');
    if (chosen === '') {
      setLocalError(dict.portal.payoutNeedsAccount);
      return;
    }
    try {
      await request.mutateAsync({ amountPaisa: paisa, payoutAccountId: chosen });
      setDone(dict.portal.payoutRequested);
      setAmount('');
    } catch (error) {
      /* The server names the real minimum and the real ceiling, so its sentence
         beats anything invented here. */
      setLocalError(error instanceof Error ? error.message : dict.portal.payoutRequestFailed);
    }
  };

  const saveAccount = async (): Promise<void> => {
    setLocalError('');
    setDone('');
    if (accountTitle.trim() === '' || institution.trim() === '' || accountNumber.trim() === '') {
      setLocalError(dict.portal.accountFieldsRequired);
      return;
    }
    try {
      await addAccount.mutateAsync({
        kind,
        accountTitle: accountTitle.trim(),
        institution: institution.trim(),
        accountNumber: accountNumber.trim()
      });
      setAdding(false);
      setAccountTitle('');
      setInstitution('');
      setAccountNumber('');
      setDone(dict.portal.accountAdded);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : dict.portal.accountAddFailed);
    }
  };

  if (payouts.isPending || accounts.isPending) {
    return (
      <div aria-busy="true" aria-live="polite" className="grid gap-3">
        <span className="skeleton h-8 w-56 rounded-[9px]" />
        <span className="skeleton h-40 w-full rounded-[12px]" />
      </div>
    );
  }

  if (payouts.isError) {
    return (
      <div>
        <PageHeader eyebrow={dict.portal.provider} title={dict.portal.payouts} />
        <div role="alert" className="mt-6 rounded-[14px] border border-rose-200 bg-rose-50 p-5">
          <p className="text-sm font-medium leading-6 text-rose-800">{dict.portal.payoutsLoadError}</p>
          <Button type="button" variant="secondary" size="sm" className="mt-4" onClick={() => void payouts.refetch()}>
            {dict.catalogue.retry}
          </Button>
        </div>
      </div>
    );
  }

  const accountList = accounts.data?.items ?? [];
  const rows = payouts.data.items;

  return (
    <div>
      <PageHeader
        eyebrow={dict.portal.provider}
        title={dict.portal.payouts}
        description={dict.portal.payoutsText}
        action={
          <Button type="button" size="sm" onClick={() => setAdding((value) => !value)}>
            <Plus className="size-4" aria-hidden="true" />
            {dict.portal.addAccount}
          </Button>
        }
      />

      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="p-6">
          <h2 className="font-semibold text-navy">{dict.portal.payoutHistory}</h2>
          {rows.length === 0 ? (
            <p className="mt-3 text-sm text-secondary">{dict.portal.noPayouts}</p>
          ) : (
            <ul className="mt-4 grid gap-2">
              {rows.map((payout) => (
                <li key={payout.id} className="rounded-[10px] border border-line p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-navy">{formatMoney(payout.amountPaisa, locale)}</span>
                    <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', STATUS_TONE[payout.status])}>{dict.portal.payoutStatus[payout.status]}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted">{dict.portal.requestedOn.replace('{date}', formatDate(payout.requestedAt, locale))}</p>
                  <p className="mt-1 text-xs text-muted">
                    {payout.institution} · ••••{payout.accountLast4}
                  </p>
                  {payout.paidAt !== null ? <p className="mt-1 text-xs text-emerald-700">{dict.portal.paidOn.replace('{date}', formatDate(payout.paidAt, locale))}</p> : null}
                  {payout.failureReason !== null && payout.failureReason !== '' ? <p className="mt-2 rounded-[8px] bg-rose-50 p-2.5 text-xs leading-5 text-rose-800">{payout.failureReason}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="grid gap-5">
          <Card className="p-6">
            <h2 className="flex items-center gap-2 font-semibold text-navy">
              <Wallet className="size-4 text-muted" aria-hidden="true" />
              {dict.portal.requestPayout}
            </h2>
            <p className="mt-2 text-sm leading-6 text-secondary">{dict.portal.releasableNow.replace('{amount}', formatMoney(releasable, locale))}</p>

            <div className="mt-4 grid gap-3">
              <div className="grid gap-2">
                <Label htmlFor="payout-amount">{dict.portal.payoutAmountLabel}</Label>
                <Input id="payout-amount" inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder={String(releasable / 100)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="payout-account">{dict.portal.payoutAccountLabel}</Label>
                {accountList.length === 0 ? (
                  <p className="text-sm text-secondary">{dict.portal.noAccounts}</p>
                ) : (
                  <SelectField
                    id="payout-account"
                    value={accountId}
                    onChange={setAccountId}
                    options={accountList.map((account) => ({
                      value: account.id,
                      label: `${account.institution} · ••••${account.accountLast4}${account.isDefault ? ` (${dict.portal.defaultAccount})` : ''}`
                    }))}
                    placeholder={dict.portal.chooseAccount}
                  />
                )}
              </div>

              {localError !== '' ? (
                <p role="alert" className="rounded-[9px] bg-rose-50 p-3 text-sm text-rose-700">
                  {localError}
                </p>
              ) : null}
              {done !== '' ? (
                <p role="status" className="rounded-[9px] bg-emerald-50 p-3 text-sm text-emerald-800">
                  {done}
                </p>
              ) : null}

              <Button type="button" onClick={() => void askForPayout()} disabled={request.isPending || accountList.length === 0}>
                {dict.portal.requestPayout}
              </Button>
              <p className="text-xs leading-5 text-muted">{dict.portal.payoutMinimumNote}</p>
            </div>
          </Card>

          {adding ? (
            <Card className="p-6">
              <h2 className="flex items-center gap-2 font-semibold text-navy">
                <Building2 className="size-4 text-muted" aria-hidden="true" />
                {dict.portal.addAccount}
              </h2>
              <div className="mt-4 grid gap-3">
                <div className="grid gap-2">
                  <Label htmlFor="account-kind">{dict.portal.accountKindLabel}</Label>
                  <SelectField
                    id="account-kind"
                    value={kind}
                    onChange={(value) => setKind(value as 'BANK' | 'WALLET')}
                    options={[
                      { value: 'BANK', label: dict.portal.bankAccount },
                      { value: 'WALLET', label: dict.portal.walletAccount }
                    ]}
                    placeholder={dict.portal.accountKindLabel}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="account-title">{dict.portal.accountTitleLabel}</Label>
                  <Input id="account-title" value={accountTitle} onChange={(event) => setAccountTitle(event.target.value)} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="account-institution">{dict.portal.institutionLabel}</Label>
                  <Input id="account-institution" value={institution} onChange={(event) => setInstitution(event.target.value)} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="account-number">{dict.portal.accountNumberLabel}</Label>
                  <Input id="account-number" value={accountNumber} onChange={(event) => setAccountNumber(event.target.value)} />
                </div>
                <p className="text-xs leading-5 text-muted">{dict.portal.accountNumberPrivacy}</p>
                <div className="flex gap-2">
                  <Button type="button" onClick={() => void saveAccount()} disabled={addAccount.isPending}>
                    {dict.portal.save}
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => setAdding(false)}>
                    {dict.common.cancel}
                  </Button>
                </div>
              </div>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
