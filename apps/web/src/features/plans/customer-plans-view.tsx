'use client';

/* Your maintenance plan — `GET /plans`, `GET /me/subscriptions`,
 * `POST /plans/:id/subscribe`, `POST /subscriptions/:id/cancel`.
 *
 * This screen used to say "maintenance plans are not available yet" and
 * link to the services catalogue, because four tables existed in the
 * database (`plans`, `plan_services`, `subscriptions`, `plan_visits`)
 * that nothing read or wrote. SHM-089 gave them a controller, so the
 * absence is gone and everything below is the server's answer.
 *
 * **A price on this screen is a commitment.** `pricePaisa` is what the
 * customer will be charged, and it is rendered from the stored figure —
 * never recomputed from a per-visit rate, because the server already
 * split it with `splitEvenly` at purchase time and a browser doing the
 * same division would be the one place in this app where money is
 * rounded by hand.
 *
 * **The four visit counts are shown, not collapsed into one.**
 * `GET /me/subscriptions` returns `totalVisits`, `pendingVisits`,
 * `bookedVisits`, `consumedVisits` and `refundedVisits` as five
 * separate `COUNT(...) FILTER (...)` columns. The screen reports all
 * five. The tempting shortcut — one "3 of 4 remaining" — is wrong in a
 * way that matters: a plan with one visit already refunded has three
 * of four *spent or gone*, and a customer reading "3 remaining" would
 * be misled about what they have paid for.
 *
 * **Subscribing does not activate a plan.** `POST /plans/:id/subscribe`
 * writes the subscription, schedules the visits and opens a payment,
 * then returns `checkout.returnUrl`. The plan only becomes `ACTIVE`
 * when the gateway callback fires `capturePlan`. So the screen routes
 * to the checkout and says the plan is not active yet — it does not
 * show a success state on the strength of a request that created a
 * row.
 *
 * **Cancelling quotes no number up front, and that is deliberate.**
 * `calculatePlanCancellationRefund` refunds the `PENDING` visits only;
 * a `BOOKED` visit is spoken for and a `CONSUMED` one is done. There is
 * no preview endpoint to call before cancelling, so the confirmation
 * states the rule and the result states the server's figure. Inventing
 * a "you will be refunded Rs X" preview would be a money claim with
 * nothing behind it. */

import { useState } from 'react';
import Link from 'next/link';
import { CalendarRange, CheckCircle2, CreditCard, Info, Loader2, MapPin, Repeat2 } from 'lucide-react';
import { Badge, Button, Card, PageHeader, StatCard } from '@/components/ui';
import { useAddresses } from '@/features/booking/queries';
import type { Address } from '@/features/account/api';
import { planName, planServiceName, planTotalVisits, subscriptionRemainingVisits, type MySubscription, type Plan } from '@/features/plans/api';
import { useCancelSubscription, useMySubscriptions, usePlans, useSubscribe, useSubscription } from '@/features/plans/queries';
import { detailOf, toastError, toastSuccess } from '@/features/auth/auth-feedback';
import type { Dictionary } from '@/lib/dictionaries';
import { cn, formatMoney, formatNumber, localizedPath, type Locale } from '@/lib/utils';

type Props = { locale: Locale; dict: Dictionary };

const isLive = (subscription: MySubscription) => subscription.status === 'ACTIVE';

const formatMonth = (value: string, locale: Locale): string => new Intl.DateTimeFormat(locale === 'ur' ? 'ur-PK' : 'en-PK', { month: 'short', year: 'numeric' }).format(new Date(value));

const formatDay = (value: string, locale: Locale): string => new Intl.DateTimeFormat(locale === 'ur' ? 'ur-PK' : 'en-PK', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value));

/** One plan card. Everything on it is a field the API returned. */
function PlanCard({ plan, locale, dict, canSubscribe, onSubscribe, busy }: { plan: Plan; locale: Locale; dict: Dictionary; canSubscribe: boolean; onSubscribe: (plan: Plan) => void; busy: boolean }) {
  const visits = planTotalVisits(plan.services);

  return (
    <Card className="flex h-full flex-col p-6">
      <h2 className="text-[19px] font-semibold tracking-[-0.03em] text-navy">{planName(plan, locale)}</h2>
      <p className="mt-3 flex items-baseline gap-2">
        <strong className="text-[30px] font-semibold tracking-[-0.04em] text-navy tabular-nums">{formatMoney(plan.pricePaisa, locale)}</strong>
        <span className="text-sm text-muted">
          {dict.portal.planFor} {formatNumber(plan.durationMonths, locale)} {dict.portal.planMonths}
        </span>
      </p>
      <p className="mt-2 text-sm text-secondary">
        {formatNumber(visits, locale)} {dict.portal.plansVisitsIncluded}
      </p>

      <h3 className="mt-5 text-xs font-semibold uppercase tracking-[0.08em] text-muted">{dict.portal.plansIncluded}</h3>
      <ul className="mt-2.5 grid gap-2">
        {plan.services.map((service) => (
          <li key={service.serviceId} className="flex items-start gap-2.5 text-sm leading-6 text-secondary">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden="true" />
            <span>
              {planServiceName(service, locale)} — {formatNumber(service.visitsIncluded, locale)} {dict.portal.plansVisitsIncluded}, {dict.portal.planEvery}{' '}
              {formatNumber(service.intervalDays, locale)} {dict.portal.planDays}
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-4 text-sm leading-6 text-secondary">{plan.description}</p>

      <div className="mt-6 flex-1" />
      <Button className="w-full" disabled={!canSubscribe || busy} onClick={() => onSubscribe(plan)}>
        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <CreditCard className="size-4" aria-hidden="true" />}
        {dict.portal.planSubscribe}
      </Button>
    </Card>
  );
}

/** One subscription: the five counts, the dates, the address, and the cancel control. */
function SubscriptionCard({ subscription, locale, dict }: { subscription: MySubscription; locale: Locale; dict: Dictionary }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [showSchedule, setShowSchedule] = useState(false);
  const cancel = useCancelSubscription();
  /* `GET /subscriptions/:id` — the per-visit schedule, fetched only when
     the customer asks for it. It is a separate read because the list's
     five counts already answer "how much is left"; the schedule answers
     "when, and for what", which is a question worth a request. */
  const detail = useSubscription(showSchedule ? subscription.id : '', locale);

  const active = isLive(subscription);

  const confirm = () => {
    cancel.mutate(
      { id: subscription.id, reason: reason.trim() === '' ? undefined : reason.trim() },
      {
        onSuccess: (result) => {
          setOpen(false);
          /* The refund figure is the server's, so it is what the toast
             says. Nothing here recomputes it. */
          toastSuccess(
            locale === 'ur'
              ? `${dict.portal.planCancelRefund}: ${formatMoney(result.refundPaisa, locale)}`
              : `${dict.portal.planCancelRefund} ${formatMoney(result.refundPaisa, locale)} — ${formatNumber(result.refundedVisitsCount, locale)} ${dict.portal.planCancelVisits}`
          );
          /* No `router.refresh()`: the mutation already invalidates
             `accountKeys.subscriptions`, which is the data on screen. */
        },
        onError: (error) => toastError(detailOf(error, dict))
      }
    );
  };

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-navy">{locale === 'ur' ? subscription.planNameUr || subscription.planNameEn : subscription.planNameEn}</h3>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-secondary">
            <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
            {subscription.addressLabel} — {subscription.addressLine1}
          </p>
        </div>
        {/* `StatusBadge` is the component that knows how a status reads.
            `CANCELLED` is already one of its rose states; `ACTIVE` and
            `EXPIRED` are not in its list, so those two are given an
            explicit tone rather than falling through to blue. */}
        {subscription.status === 'ACTIVE' ? (
          <Badge className="bg-emerald-50 text-emerald-700">{subscription.status}</Badge>
        ) : subscription.status === 'CANCELLED' ? (
          <Badge className="bg-rose-50 text-rose-700">{subscription.status}</Badge>
        ) : (
          <Badge className="bg-amber-50 text-amber-800">{subscription.status}</Badge>
        )}
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={CalendarRange} label={dict.portal.planPendingVisits} value={formatNumber(subscription.pendingVisits, locale)} />
        <StatCard icon={Repeat2} label={dict.portal.planBookedVisits} value={formatNumber(subscription.bookedVisits, locale)} />
        <StatCard icon={CheckCircle2} label={dict.portal.planConsumedVisits} value={formatNumber(subscription.consumedVisits, locale)} />
        <StatCard icon={CreditCard} label={dict.portal.planRefundedVisits} value={formatNumber(subscription.refundedVisits, locale)} />
      </div>

      <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-1.5 text-sm text-secondary">
        <div className="flex gap-1.5">
          <dt className="text-muted">{dict.portal.planTotalVisits}</dt>
          <dd className="font-medium text-navy tabular-nums">{formatNumber(subscription.totalVisits, locale)}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-muted">{dict.portal.planRunsUntil}</dt>
          <dd className="font-medium text-navy">{formatMonth(subscription.endsAt, locale)}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-muted">{dict.portal.planStarted}</dt>
          <dd className="font-medium text-navy">{formatMonth(subscription.startsAt, locale)}</dd>
        </div>
      </dl>

      {/* Stated as arithmetic the server's own counts support, and only
          for a live plan: a cancelled one has nothing left to spend. */}
      {active ? (
        <p className="mt-4 rounded-[9px] border border-line bg-surface-2 p-3 text-sm leading-6 text-secondary">
          {formatNumber(subscriptionRemainingVisits(subscription), locale)} {dict.portal.planPendingVisits.toLowerCase()} · {dict.common.total} {formatNumber(subscription.totalVisits, locale)}
        </p>
      ) : null}

      {active ? (
        <div className="mt-4">
          <Button variant="secondary" size="sm" onClick={() => setShowSchedule((value) => !value)}>
            {dict.portal.planViewSchedule}
          </Button>{' '}
          {!open ? (
            <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
              {dict.portal.planCancel}
            </Button>
          ) : (
            <div className="rounded-[12px] border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-semibold text-amber-900">{dict.portal.planCancelConfirm}</p>
              <p className="mt-1.5 text-sm leading-6 text-amber-900">{dict.portal.planCancelExplain}</p>
              <label className="mt-3 block text-xs font-medium text-amber-900" htmlFor={`plan-cancel-reason-${subscription.id}`}>
                {dict.portal.planCancelReason}
              </label>
              <input
                id={`plan-cancel-reason-${subscription.id}`}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                className="mt-1.5 w-full rounded-[9px] border border-amber-300 bg-white px-3 py-2 text-sm text-navy"
                placeholder={dict.portal.planCancelReason}
              />
              <div className="mt-4 flex gap-2">
                <Button size="sm" disabled={cancel.isPending} onClick={confirm}>
                  {cancel.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                  {cancel.isPending ? dict.portal.planCancelling : dict.portal.planCancel}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setOpen(false)}>
                  {dict.common.cancel}
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {showSchedule ? (
        <div className="mt-4">
          {detail.isPending ? (
            <Card className="p-6 text-center text-sm text-muted" aria-busy="true">
              {dict.portal.plansLoading}
            </Card>
          ) : detail.isError ? (
            <div role="alert" className="rounded-[12px] border border-rose-200 bg-rose-50 p-4">
              <p className="text-sm font-medium leading-6 text-rose-800">{dict.portal.plansLoadError}</p>
            </div>
          ) : (
            <Card className="overflow-hidden">
              <div className="border-b border-line p-4">
                <h4 className="text-sm font-semibold text-navy">{dict.portal.planVisitSchedule}</h4>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead className="bg-slate-50 text-xs text-muted">
                    <tr>
                      <th className="p-3 text-start">{dict.portal.planVisitDue}</th>
                      <th className="p-3 text-start">{dict.portal.planService}</th>
                      <th className="p-3 text-start">{dict.portal.planSubscriptionStatus}</th>
                      <th className="p-3 text-end">{dict.portal.planVisitValue}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {/* Every `valuePaisa` is the server's own split — set by
                        `distributePlanVisits` at purchase, to the exact paisa.
                        They are displayed, never re-derived, and the column
                        does not claim they sum to the plan price: a booked or
                        refunded visit keeps its original value. */}
                    {(detail.data?.visits ?? []).map((visit) => (
                      <tr key={visit.id}>
                        <td className="p-3 text-secondary">{formatDay(visit.dueDate, locale)}</td>
                        <td className="p-3 text-navy">{visit.serviceNameEn}</td>
                        <td className="p-3">
                          <Badge>{visit.status}</Badge>
                        </td>
                        <td className="p-3 text-end text-navy tabular-nums">{formatMoney(visit.valuePaisa, locale)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      ) : null}
    </Card>
  );
}

export function CustomerPlansScreen({ locale, dict }: Props) {
  const plans = usePlans(locale);
  const mine = useMySubscriptions(locale);
  const addresses = useAddresses(locale);
  const subscribe = useSubscribe();

  const [addressId, setAddressId] = useState('');
  const [pendingPlan, setPendingPlan] = useState<string | null>(null);

  const saved: Address[] = addresses.data?.items ?? [];
  const live = (mine.data?.items ?? []).filter(isLive);
  const past = (mine.data?.items ?? []).filter((subscription) => !isLive(subscription));

  const start = (plan: Plan) => {
    if (addressId === '') {
      toastError(locale === 'ur' ? dict.portal.planAddressRequired : dict.portal.planAddressRequired);
      return;
    }
    setPendingPlan(plan.id);
    subscribe.mutate(
      { planId: plan.id, input: { addressId, preferredProviderId: null } },
      {
        onSuccess: (result) => {
          setPendingPlan(null);
          /* The checkout URL is the only thing that takes the money — the
             subscription only becomes ACTIVE when the gateway callback
             fires `capturePlan`. So the browser is sent there, and the
             screen never reports "you are subscribed" on the strength
             of a POST that merely opened a payment. */
          if (typeof result.checkout?.returnUrl === 'string' && result.checkout.returnUrl !== '') {
            window.location.assign(result.checkout.returnUrl);
            return;
          }
          /* No returnUrl: the subscription exists but is unpaid, so the
             message says the payment is outstanding rather than
             announcing a plan the customer does not yet hold. */
          toastSuccess(dict.portal.plansSubscribedText);
        },
        onError: (error) => {
          setPendingPlan(null);
          toastError(detailOf(error, dict));
        }
      }
    );
  };

  const loading = plans.isPending || mine.isPending;
  const errored = plans.isError || mine.isError;

  return (
    <div>
      <PageHeader eyebrow={dict.portal.customer} title={dict.portal.plans} description={dict.portal.plansDescription} />

      {loading ? (
        <Card className="mt-6 p-8 text-center text-sm text-muted" aria-busy="true">
          {dict.portal.plansLoading}
        </Card>
      ) : errored ? (
        <div role="alert" className="mt-6 rounded-[14px] border border-rose-200 bg-rose-50 p-5">
          <p className="text-sm font-medium leading-6 text-rose-800">{plans.isError ? dict.portal.plansCatalogueError : dict.portal.plansLoadError}</p>
        </div>
      ) : (
        <>
          <section className="mt-6">
            <h2 className="text-lg font-semibold text-navy">{dict.portal.plansActiveTitle}</h2>
            {live.length === 0 ? (
              <Card className="mt-3 border-dashed p-6 text-center">
                <p className="text-sm font-medium text-navy">{dict.portal.plansNoneTitle}</p>
                <p className="mt-1.5 text-sm leading-6 text-secondary">{dict.portal.plansNoneText}</p>
              </Card>
            ) : (
              <div className="mt-3 grid gap-4">
                {live.map((subscription) => (
                  <SubscriptionCard key={subscription.id} subscription={subscription} locale={locale} dict={dict} />
                ))}
              </div>
            )}
          </section>

          {past.length > 0 ? (
            <section className="mt-8">
              <h2 className="text-lg font-semibold text-navy">{dict.portal.plansHistoryTitle}</h2>
              <div className="mt-3 grid gap-4">
                {past.map((subscription) => (
                  <SubscriptionCard key={subscription.id} subscription={subscription} locale={locale} dict={dict} />
                ))}
              </div>
            </section>
          ) : null}

          <section className="mt-8">
            <h2 className="text-lg font-semibold text-navy">{dict.portal.plansChooseTitle}</h2>

            {/* `planSubscribeSchema` requires an `addressId` that belongs to
                the caller and is not archived, so this is a picker over the
                real list and never a free-text field. */}
            {saved.length === 0 ? (
              <Card className="mt-3 border-dashed p-6 text-center">
                <p className="text-sm leading-6 text-secondary">{dict.portal.planNoAddress}</p>
                <Link href={localizedPath(locale, '/account/addresses')} className="mt-3 inline-block text-sm font-semibold text-primary-strong hover:underline">
                  {dict.portal.planAddAddress}
                </Link>
              </Card>
            ) : (
              <div className="mt-3">
                <label className="text-sm font-medium text-navy" htmlFor="plan-address">
                  {dict.portal.planSelectAddress}
                </label>
                <select
                  id="plan-address"
                  value={addressId}
                  onChange={(event) => setAddressId(event.target.value)}
                  className="mt-1.5 w-full rounded-[9px] border border-line bg-white px-3 py-2.5 text-sm text-navy sm:max-w-md"
                >
                  <option value="">{dict.portal.planSelectAddress}</option>
                  {saved.map((address) => (
                    <option key={address.id} value={address.id}>
                      {address.label} — {address.line1}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {(plans.data?.items ?? []).length === 0 ? (
              /* An empty `GET /plans` is a real answer, not an error: no
                 plan is published right now. It says so and points at the
                 services a customer can buy today, rather than rendering
                 an invented tier. */
              <Card className="mt-4 border-dashed p-6 text-center">
                <p className="text-sm font-medium text-navy">{dict.portal.plansUnavailableTitle}</p>
                <p className="mx-auto mt-1.5 max-w-md text-sm leading-6 text-secondary">{dict.portal.plansUnavailableText}</p>
                <Link href={localizedPath(locale, '/services')} className="mt-3 inline-block text-sm font-semibold text-primary-strong hover:underline">
                  {dict.portal.browseServices}
                </Link>
              </Card>
            ) : (
              <div className={cn('mt-4 grid gap-4', 'lg:grid-cols-2 xl:grid-cols-3')}>
                {(plans.data?.items ?? []).map((plan) => (
                  <PlanCard key={plan.id} plan={plan} locale={locale} dict={dict} canSubscribe={saved.length > 0} onSubscribe={start} busy={pendingPlan === plan.id} />
                ))}
              </div>
            )}

            <p className="mt-4 flex items-start gap-2 text-xs leading-5 text-muted">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              {dict.portal.plansNote}
            </p>
          </section>
        </>
      )}
    </div>
  );
}
