'use client';

import { Check, ShieldCheck } from 'lucide-react';
import { Card, PageHeader } from '@/components/ui';
import { useAdminRoles } from '@/features/admin/queries';
import { ApiError } from '@/lib/api/problem';
import type { Dictionary } from '@/lib/dictionaries';
import { formatNumber, type Locale } from '@/lib/utils';

/* The RBAC matrix — `GET /admin/roles`.
 *
 * Every row is `{ code, name, permissions }` read from the `roles` and
 * `role_permissions` tables, so this screen is a straight rendering of the
 * database rather than a description of it.
 *
 * **Grants and revokes live on the users screen, not here.** `POST`/`DELETE
 * /admin/users/:userId/roles/:roleCode` act on a *person*, and this screen has no
 * person selected — it lists roles. Putting a grant control in each role row would
 * mean inventing a user picker, so the matrix stays read-only and the actions sit
 * where the account is. That is also the honest split: `revokeRole` answers 409
 * "This user does not hold that role", which is a statement about one account.
 *
 * **A 403 is not an empty matrix.** Every admin route is `totpRequired`. */

export function AdminRoles({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const roles = useAdminRoles(locale);
  const forbidden = roles.error instanceof ApiError && roles.error.status === 403;

  if (roles.isPending) {
    return (
      <div aria-busy="true" aria-live="polite" className="grid gap-4">
        <span className="skeleton h-8 w-48 rounded-[9px]" />
        <span className="skeleton h-56 w-full rounded-[12px]" />
      </div>
    );
  }

  const items = roles.data?.items ?? [];

  return (
    <div>
      <PageHeader eyebrow={dict.portal.admin} title={dict.admin.roles} description={dict.admin.rolesText} />

      {roles.isError ? (
        <div role="alert" className="mt-6 rounded-[14px] border border-rose-200 bg-rose-50 p-5">
          <p className="text-sm font-medium leading-6 text-rose-800">{dict.admin.rolesLoadError}</p>
          {forbidden ? <p className="mt-2 text-sm leading-6 text-rose-800">{dict.admin.adminTotpRequired}</p> : null}
          <button type="button" onClick={() => void roles.refetch()} className="mt-4 text-sm font-semibold text-primary-strong hover:underline">
            {dict.catalogue.retry}
          </button>
        </div>
      ) : (
        <>
          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {items.map((role) => (
              <Card key={role.code} className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="flex items-center gap-2 font-semibold text-navy">
                      <ShieldCheck className="size-4 shrink-0 text-muted" aria-hidden="true" />
                      {role.name}
                    </h2>
                    <p className="mt-1 font-mono text-xs text-muted">{role.code}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700">{formatNumber(role.permissions.length, locale)}</span>
                </div>

                {role.permissions.length === 0 ? (
                  /* An empty array is a real state — the `LEFT JOIN` with
                     `FILTER (WHERE … IS NOT NULL)` yields `{}` — and is shown as
                     such rather than as an empty box that looks broken. */
                  <p className="mt-4 text-sm leading-6 text-muted">{dict.admin.noPermissions}</p>
                ) : (
                  <ul className="mt-4 grid gap-1.5">
                    {role.permissions.map((permission) => (
                      <li key={permission} className="flex items-start gap-2 text-[13px] leading-5 text-secondary">
                        <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
                        <span className="font-mono">{permission}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            ))}
          </div>

          <p className="mt-4 text-xs leading-5 text-muted">{dict.admin.rolesActionsNote}</p>
        </>
      )}
    </div>
  );
}
