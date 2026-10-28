'use client';

import { CheckCircle2, CreditCard, Loader2, ShieldCheck, XCircle } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ButtonLink, Card } from '@/components/ui';
import { apiRequest } from '@/lib/api/client';
import type { Dictionary } from '@/lib/dictionaries';
import { localizedPath, type Locale } from '@/lib/utils';

/* The development payment simulator, in the app's own design.

   In development the API's mock gateway sends the browser to
   `/api/v1/dev/payments/:id?returnUrl=…` (`integrations/mocks.ts`). The API
   renders that page itself, but its own CSP (`default-src 'none'`) blocks the
   Tailwind script the page depends on, so it shows as raw HTML.
   `next.config.ts` redirects browser navigations to that URL here instead.

   Nothing is simulated by this page. It reads the endpoint's real JSON
   (`{ paymentId, returnUrl, actions: { pay, fail } }`) and sends the browser to
   the backend's own `actions` links, which deliver the payment event through
   the same path as a signed webhook and then redirect to `returnUrl`. In
   production the controller refuses (`DEV_INBOX_ENABLED` is false) and this
   page says the simulator is unavailable. */

type DevPayment = {
  paymentId: string;
  returnUrl: string | null;
  actions: { pay: { method: 'GET'; url: string }; fail: { method: 'GET'; url: string } };
};

const bookingIdFrom = (returnUrl: string | null): string | null => {
  if (!returnUrl) return null;
  try {
    return new URL(returnUrl, 'http://localhost').searchParams.get('bookingId');
  } catch {
    return null;
  }
};

export function DevPaymentPage({ locale, dict, paymentId, returnUrl }: { locale: Locale; dict: Dictionary; paymentId: string; returnUrl: string | null }) {
  const t = dict.devPay;
  const [sending, setSending] = useState<'pay' | 'fail' | null>(null);

  const payment = useQuery({
    queryKey: ['dev-payment', paymentId, returnUrl],
    queryFn: ({ signal }) =>
      apiRequest<DevPayment>(`/dev/payments/${encodeURIComponent(paymentId)}`, {
        query: returnUrl ? { returnUrl } : undefined,
        signal,
        locale,
        /* Public dev route; a 401/403 here means "disabled", not "sign in again". */
        auth: false,
        refreshOnExpiry: false
      }),
    retry: false
  });

  /* The backend's link completes the payment and redirects to `returnUrl`. A
     full navigation, not fetch: that redirect is meant for the browser. */
  const go = (which: 'pay' | 'fail') => {
    if (!payment.data) return;
    setSending(which);
    window.location.assign(payment.data.actions[which].url);
  };

  const bookingId = bookingIdFrom(payment.data?.returnUrl ?? returnUrl);

  return (
    <main className="grid min-h-screen place-items-center bg-navy-950 px-4 py-10">
      <Card className="w-full max-w-md overflow-hidden p-0 shadow-lifted">
        <div className="flex items-center gap-3 border-b border-line bg-surface-2 px-6 py-5">
          <span className="grid size-10 place-items-center rounded-xl bg-primary text-white shadow-sm" aria-hidden="true">
            <CreditCard className="size-5" />
          </span>
          <div className="min-w-0">
            <h1 className="text-base font-bold text-navy">{t.title}</h1>
            <p className="text-xs font-medium text-primary-strong">{t.subtitle}</p>
          </div>
          <span className="ms-auto inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
            <ShieldCheck className="size-3.5" aria-hidden="true" />
            Sandbox
          </span>
        </div>

        <div className="grid gap-5 p-6">
          {payment.isPending ? (
            <p aria-busy="true" className="flex items-center gap-2 text-sm text-secondary">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              {t.loading}
            </p>
          ) : payment.isError ? (
            <div role="alert" className="grid gap-3">
              <p className="font-semibold text-navy">{t.unavailableTitle}</p>
              <p className="text-sm leading-6 text-secondary">{t.unavailableText}</p>
              <ButtonLink href={localizedPath(locale, '/account/bookings')} variant="secondary" size="sm" className="justify-self-start">
                {t.backToBookings}
              </ButtonLink>
            </div>
          ) : (
            <>
              <p className="text-sm leading-6 text-secondary">{t.intro}</p>
              <dl className="grid gap-2 rounded-[10px] border border-line bg-white p-4 text-sm">
                <div className="flex flex-wrap justify-between gap-2">
                  <dt className="text-muted">{t.paymentRef}</dt>
                  <dd className="font-mono text-xs text-navy">{payment.data.paymentId.slice(0, 8)}…</dd>
                </div>
                {bookingId !== null ? (
                  <div className="flex flex-wrap justify-between gap-2">
                    <dt className="text-muted">{t.bookingRef}</dt>
                    <dd className="font-mono text-xs text-navy">{bookingId.slice(0, 8)}…</dd>
                  </div>
                ) : null}
              </dl>

              <div className="grid gap-2">
                <button
                  type="button"
                  onClick={() => go('pay')}
                  disabled={sending !== null}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[10px] bg-primary px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-strong focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100 disabled:opacity-60"
                >
                  {sending === 'pay' ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="size-4" aria-hidden="true" />}
                  {sending === 'pay' ? t.working : t.pay}
                </button>
                <button
                  type="button"
                  onClick={() => go('fail')}
                  disabled={sending !== null}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[10px] border border-line bg-white px-5 text-sm font-semibold text-rose-700 transition hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-rose-100 disabled:opacity-60"
                >
                  {sending === 'fail' ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <XCircle className="size-4" aria-hidden="true" />}
                  {sending === 'fail' ? t.working : t.fail}
                </button>
              </div>
              <p className="text-xs leading-5 text-muted">{t.afterNote}</p>
            </>
          )}
        </div>
      </Card>
    </main>
  );
}
