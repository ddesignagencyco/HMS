'use client';

import { useState } from 'react';
import { KeyRound, Loader2, Search, ShieldAlert, UserX, UsersRound } from 'lucide-react';
import { Button, Card, PageHeader, StatCard } from '@/components/ui';
import { personName } from '@/features/admin/api';
import { useAdminCustomers, useDeactivateCustomer, useSendPasswordReset } from '@/features/admin/queries';
import { detailOf, toastError, toastSuccess } from '@/features/auth/auth-feedback';
import { maskEmail, maskPhone } from '@/features/auth/target';
import { ApiError } from '@/lib/api/problem';
import type { Dictionary } from '@/lib/dictionaries';
import { cn, formatDate, formatNumber, type Locale } from '@/lib/utils';

/* Customers — `GET /admin/customers`, and `POST /admin/customers/:id/deactivate`.
 *
 * **What this screen used to show, and why it is gone.** The previous version
 * listed twenty invented customers with, for each, a booking count, a lifetime-spend
 * figure and an area. Those came from `src/lib/data.ts`. None of them is in the
 * response:
 *
 *   CustomerRow = { userId, email, phoneE164, firstName, lastName, status, createdAt }
 *
 * There is no admin bookings list (`GET /bookings` is customer-scoped and
 * `GET /admin/bookings` does not exist) and no per-customer total of any kind. So a
 * "Rs 68,400 lifetime value" column and a "12 bookings" column would have been
 * invented numbers in a table an operator uses to make decisions about real
 * accounts. They are removed rather than estimated, and the count of accounts is
 * the one figure the screen can actually compute.
 *
 * **Contact details are masked here too.** An admin has powers over an account but
 * the screen is not the place to need the full number, and NFR-PR-01 does not
 * carve out an exception for staff. `send-reset` delivers the code to the owner, so
 * the operator never needs to read it.
 *
 * **`status` is `user_status`** — ACTIVE, LOCKED or DEACTIVATED. It is not a
 * customer state; the previous screen's two-way ACTIVE/DEACTIVATED could not
 * represent a LOCKED account, which is the state a blocked account is actually in.
 *
 * **A 403 is not an empty list.** Every admin route is `totpRequired`, so a session
 * that has not cleared the second factor gets 403 for the whole screen. Rendering
 * that as "no customers" would be the single most misleading thing this page could
 * do, so the failure is reported as a failure. */

export function AdminCustomers({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const [term, setTerm] = useState('');
  /* Only the committed term reaches the query. Typing does not issue a request per
     keystroke — `q` is a `ILIKE '%…%'` substring match, so a request per character
     would be a full table scan per character. */
  const [committed, setCommitted] = useState('');

  const customers = useAdminCustomers({ q: committed === '' ? undefined : committed, limit: 200 }, locale);
  const deactivate = useDeactivateCustomer(locale);
  const sendReset = useSendPasswordReset(locale);
  const [pendingDeactivate, setPendingDeactivate] = useState<string | null>(null);

  const rows = customers.data?.items ?? [];
  const active = rows.filter((row) => row.status === 'ACTIVE').length;

  const confirmDeactivate = async (userId: string): Promise<void> => {
    try {
      await deactivate.mutateAsync(userId);
      setPendingDeactivate(null);
      toastSuccess(dict.admin.customerDeactivated);
    } catch (error) {
      toastError(detailOf(error, dict));
      setPendingDeactivate(null);
    }
  };

  const reset = async (userId: string): Promise<void> => {
    try {
      /* Always `{ sent: true }` — the API will not confirm whether a code went
         anywhere, so this screen must not imply that it did. */
      await sendReset.mutateAsync(userId);
      toastSuccess(dict.admin.resetSent);
    } catch (error) {
      toastError(detailOf(error, dict));
    }
  };

  const forbidden = customers.error instanceof ApiError && customers.error.status === 403;

  return (
    <div>
      <PageHeader eyebrow={dict.portal.admin} title={dict.admin.customers} description={dict.admin.customersText} />

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <StatCard icon={UsersRound} label={dict.admin.totalCustomers} value={formatNumber(rows.length, locale)} />
        <StatCard icon={ShieldAlert} label={dict.admin.activeCustomers} value={formatNumber(active, locale)} />
        <StatCard icon={ShieldAlert} label={dict.admin.deactivated} value={formatNumber(rows.length - active, locale)} />
      </div>

      {/* No "lifetime value" tile. There is no per-customer total in the API, and a
          sum over invented figures is the most authoritative-looking number on the
          screen — which is exactly why it must not be there. */}
      <form
        className="mt-6 flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          setCommitted(term.trim());
        }}
      >
        <div className="min-w-[260px] flex-1">
          <label htmlFor="admin-customer-search" className="text-[11.5px] font-semibold text-slate-800">
            {dict.admin.searchAccounts}
          </label>
          <div className="relative mt-1">
            <Search className="pointer-events-none absolute inset-y-0 start-0 my-auto ms-3 size-4 text-muted" aria-hidden="true" />
            <input
              id="admin-customer-search"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder={dict.admin.searchPlaceholder}
              className="min-h-11 w-full rounded-[9px] border border-line bg-white ps-9 pe-3 text-sm text-navy outline-none focus:border-primary"
            />
          </div>
        </div>
        <Button type="submit" variant="secondary">
          {dict.admin.search}
        </Button>
      </form>

      {customers.isPending ? (
        <Card className="mt-6 p-8 text-center text-sm text-muted" aria-busy="true">
          {dict.admin.loadingCustomers}
        </Card>
      ) : customers.isError ? (
        <div role="alert" className="mt-6 rounded-[14px] border border-rose-200 bg-rose-50 p-5">
          <p className="text-sm font-medium leading-6 text-rose-800">{dict.admin.customersLoadError}</p>
          {/* A second factor that has not been cleared produces exactly this 403,
              and the honest instruction is to go and clear it. */}
          {forbidden ? <p className="mt-2 text-sm leading-6 text-rose-800">{dict.admin.adminTotpRequired}</p> : null}
          <Button type="button" variant="secondary" size="sm" className="mt-4" onClick={() => void customers.refetch()}>
            {dict.catalogue.retry}
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <Card className="mt-6 border-dashed px-6 py-14 text-center">
          <h2 className="font-semibold text-navy">{committed === '' ? dict.admin.noCustomers : dict.admin.noMatchingCustomers}</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-secondary">{committed === '' ? dict.admin.noCustomersText : dict.admin.noMatchingCustomersText}</p>
        </Card>
      ) : (
        <Card className="mt-6 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-5">
            <h2 className="font-semibold text-navy">{dict.admin.customerRegister}</h2>
            <p className="text-xs text-muted">{dict.admin.noHardDelete}</p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-slate-50 text-xs text-muted">
                <tr>
                  <th className="p-4 text-start">{dict.admin.name}</th>
                  <th className="p-4 text-start">{dict.admin.contact}</th>
                  <th className="p-4 text-start">{dict.admin.joined}</th>
                  <th className="p-4 text-start">{dict.common.status}</th>
                  <th className="p-4 text-end">{dict.admin.actions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((row) => {
                  const name = personName(row);
                  const off = row.status !== 'ACTIVE';
                  return (
                    <tr key={row.userId} className={off ? 'bg-slate-50/60' : 'hover:bg-slate-50'}>
                      <td className="p-4 font-medium text-navy">{name}</td>
                      <td className="p-4">
                        {/* Masked, for the same reason every other screen masks. */}
                        <p className="font-mono text-xs text-secondary">{row.phoneE164 === null ? dict.portal.notPublished : maskPhone(row.phoneE164)}</p>
                        <p className="mt-1 font-mono text-xs text-muted">{row.email === null ? dict.portal.notPublished : maskEmail(row.email)}</p>
                      </td>
                      <td className="p-4 text-secondary">{formatDate(row.createdAt, locale)}</td>
                      <td className="p-4">
                        <StatusPill status={row.status} dict={dict} />
                      </td>
                      <td className="p-4">
                        <div className="flex flex-wrap justify-end gap-2">
                          <Button type="button" variant="ghost" size="sm" disabled={sendReset.isPending} onClick={() => void reset(row.userId)} aria-label={`${dict.admin.sendReset}: ${name}`}>
                            <KeyRound className="size-4" aria-hidden="true" />
                            {dict.admin.sendReset}
                          </Button>
                          {!off ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="text-rose-700"
                              aria-expanded={pendingDeactivate === row.userId}
                              onClick={() => setPendingDeactivate(pendingDeactivate === row.userId ? null : row.userId)}
                              aria-label={`${dict.admin.deactivateCustomer}: ${name}`}
                            >
                              <UserX className="size-4" aria-hidden="true" />
                              {dict.admin.deactivateCustomer}
                            </Button>
                          ) : null}
                        </div>

                        {/* FR-AD-09: soft. The account and its financial history stay;
                            only the sessions are revoked. The confirmation says so,
                            because "deactivate" reads like "delete" to most people. */}
                        {pendingDeactivate === row.userId ? (
                          <div role="group" aria-label={dict.admin.deactivateCustomer} className="mt-3 rounded-[9px] border border-rose-200 bg-rose-50 p-3 text-start">
                            <p className="text-sm leading-6 text-rose-800">{dict.admin.deactivateCustomerConfirm}</p>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <Button type="button" size="sm" disabled={deactivate.isPending} onClick={() => void confirmDeactivate(row.userId)}>
                                {deactivate.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                                {dict.admin.deactivateCustomer}
                              </Button>
                              <Button type="button" variant="secondary" size="sm" onClick={() => setPendingDeactivate(null)}>
                                {dict.common.cancel}
                              </Button>
                            </div>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="border-t border-line p-4 text-xs leading-5 text-muted">{dict.admin.maskedForAdmin}</p>
        </Card>
      )}
    </div>
  );
}

/** `user_status` — three values, all of which have to be nameable. */
function StatusPill({ status, dict }: { status: string; dict: Dictionary }) {
  const tone = status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700' : status === 'LOCKED' ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-muted';
  const label = status === 'ACTIVE' ? dict.portal.active : status === 'LOCKED' ? dict.admin.locked : dict.admin.deactivated;
  return <span className={cn('rounded-full px-2.5 py-1 text-[11px] font-semibold', tone)}>{label}</span>;
}
