'use client';

import { useState } from 'react';
import { ScrollText, Search } from 'lucide-react';
import { Button, Card, PageHeader } from '@/components/ui';
import { useAuditLog } from '@/features/admin/queries';
import { ApiError } from '@/lib/api/problem';
import type { Dictionary } from '@/lib/dictionaries';
import { cn, formatDateTime, type Locale } from '@/lib/utils';

/* The audit log — `GET /admin/audit` (FR-AD-14).
 *
 * Append-only, newest first, filterable by action, actor, entity and time range.
 *
 * **`before` and `after` are `Prisma.JsonValue`**, which means each one can be
 * null, a scalar, or an object of whatever the caller recorded. This screen
 * therefore renders them as JSON text and does not reach into them for a field
 * name. The previous version of this screen rendered a fixed set of columns —
 * "change", "by", "target" — with values that came from `src/lib/data.ts`, so it
 * was showing a plausible audit trail for actions nobody had taken.
 *
 * The one thing worth doing properly is not printing `[object Object]`: a null is
 * shown as such, and an object is serialised so an admin can read what actually
 * changed. A diff would be nicer, but the shape is not stable across the ~30
 * action names in the codebase, so a diff would have to guess which keys matter.
 *
 * **`actorUserId` is null for system actions.** `audit_log.actor_user_id` is
 * nullable, so "no actor" is a real value and is rendered as one rather than as an
 * empty cell that reads like a missing join. */

const json = (value: unknown): string => {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    /* A circular or BigInt-carrying value would throw here. The API serialises
       JSON columns, so this cannot happen from a real response — but printing
       something is better than taking the whole log down. */
    return String(value);
  }
};

export function AdminAuditLog({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [committed, setCommitted] = useState<{ action?: string; entityType?: string }>({});

  const audit = useAuditLog({ ...committed, limit: 200 }, locale);
  const forbidden = audit.error instanceof ApiError && audit.error.status === 403;
  const rows = audit.data?.items ?? [];

  return (
    <div>
      <PageHeader eyebrow={dict.portal.admin} title={dict.admin.audit} description={dict.admin.auditText} />

      <form
        className="mt-6 flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          /* Trimmed before sending: `q`/`action` are `.min(1)` after `.trim()`, so
             a stray space is a 422 rather than a filter matching nothing. */
          const next: { action?: string; entityType?: string } = {};
          if (action.trim() !== '') next.action = action.trim();
          if (entityType.trim() !== '') next.entityType = entityType.trim();
          setCommitted(next);
        }}
      >
        <div className="min-w-[220px] flex-1">
          <label htmlFor="audit-action" className="text-[11.5px] font-semibold text-slate-800">
            {dict.admin.auditAction}
          </label>
          <input
            id="audit-action"
            value={action}
            onChange={(event) => setAction(event.target.value)}
            placeholder="admin.user.block"
            className="mt-1 min-h-11 w-full rounded-[9px] border border-line bg-white px-3 font-mono text-sm text-navy outline-none focus:border-primary"
          />
        </div>
        <div className="min-w-[200px] flex-1">
          <label htmlFor="audit-entity" className="text-[11.5px] font-semibold text-slate-800">
            {dict.admin.auditEntityType}
          </label>
          <input
            id="audit-entity"
            value={entityType}
            onChange={(event) => setEntityType(event.target.value)}
            placeholder="user"
            className="mt-1 min-h-11 w-full rounded-[9px] border border-line bg-white px-3 font-mono text-sm text-navy outline-none focus:border-primary"
          />
        </div>
        <Button type="submit" variant="secondary">
          <Search className="size-4" aria-hidden="true" />
          {dict.admin.search}
        </Button>
      </form>

      {audit.isPending ? (
        <Card className="mt-6 p-8 text-center text-sm text-muted" aria-busy="true">
          {dict.admin.loadingAudit}
        </Card>
      ) : audit.isError ? (
        <div role="alert" className="mt-6 rounded-[14px] border border-rose-200 bg-rose-50 p-5">
          <p className="text-sm font-medium leading-6 text-rose-800">{dict.admin.auditLoadError}</p>
          {forbidden ? <p className="mt-2 text-sm leading-6 text-rose-800">{dict.admin.adminTotpRequired}</p> : null}
          <Button type="button" variant="secondary" size="sm" className="mt-4" onClick={() => void audit.refetch()}>
            {dict.catalogue.retry}
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <Card className="mt-6 border-dashed px-6 py-14 text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-full bg-surface-2 text-muted" aria-hidden="true">
            <ScrollText className="size-6" />
          </span>
          <h2 className="mt-4 font-semibold text-navy">{dict.admin.noAuditRows}</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-secondary">{dict.admin.noAuditRowsText}</p>
        </Card>
      ) : (
        <Card className="mt-6 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-slate-50 text-xs text-muted">
                <tr>
                  <th className="p-4 text-start">{dict.admin.auditWhen}</th>
                  <th className="p-4 text-start">{dict.admin.auditAction}</th>
                  <th className="p-4 text-start">{dict.admin.auditActor}</th>
                  <th className="p-4 text-start">{dict.admin.auditTarget}</th>
                  <th className="p-4 text-start">{dict.admin.auditBeforeAfter}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((row) => (
                  <tr key={row.id} className="align-top hover:bg-slate-50">
                    <td className="p-4 text-xs whitespace-nowrap text-secondary">{formatDateTime(row.createdAt, locale)}</td>
                    <td className="p-4">
                      <span className="font-mono text-[13px] font-semibold text-navy">{row.action}</span>
                      <p className="mt-1 text-[11px] text-muted">{row.actorRole}</p>
                    </td>
                    <td className="p-4 font-mono text-xs text-secondary">
                      {/* Null is a real value here — system actions have no actor. */}
                      {row.actorUserId === null ? dict.admin.systemAction : row.actorUserId}
                    </td>
                    <td className="p-4 font-mono text-xs text-secondary">
                      {row.entityType}
                      <p className="mt-1 text-[11px] text-muted">{row.entityId}</p>
                    </td>
                    <td className="p-4">
                      <ChangeCell label={dict.admin.auditBefore} value={row.before} dict={dict} />
                      <ChangeCell label={dict.admin.auditAfter} value={row.after} dict={dict} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={cn('border-t border-line p-4 text-xs leading-5 text-muted')}>{dict.admin.auditAppendOnly}</p>
        </Card>
      )}
    </div>
  );
}

/** One side of the diff. Rendered as text because the shape is not fixed. */
function ChangeCell({ label, value, dict }: { label: string; value: unknown; dict: Dictionary }) {
  const text = json(value);
  if (text === '—') {
    return (
      <p className="text-[11px] text-muted">
        <span className="font-semibold">{label}: </span>
        {dict.admin.noChangeRecorded}
      </p>
    );
  }
  return (
    <p className="mb-1 max-w-md font-mono text-[11px] leading-5 break-words text-secondary">
      <span className="font-semibold text-navy">{label}: </span>
      {text}
    </p>
  );
}
