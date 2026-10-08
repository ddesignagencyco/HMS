'use client';

import { useState } from 'react';
import { BellRing, Loader2, Mail, MessageSquare, Save } from 'lucide-react';
import { Button, Card, PageHeader } from '@/components/ui';
import type { Channel, NotificationStatus } from '@/features/admin/cases-api';
import { useNotificationLog, usePreviewTemplate, useSaveTemplate, useTemplates } from '@/features/admin/cases-queries';
import { detailOf, toastSuccess } from '@/features/auth/auth-feedback';
import { ApiError } from '@/lib/api/problem';
import type { Dictionary } from '@/lib/dictionaries';
import { cn, formatDateTime, type Locale } from '@/lib/utils';

/* Two surfaces in one place because they answer the same question — "did the
 * customer get told, and what were they told?" — and an operator moves between
 * them constantly:
 *
 *   · **Templates** — `GET /admin/templates`, `POST`, `PUT`, and `POST
 *     /admin/templates/preview`. The preview route is the reason this screen is
 *     safe to use: it renders a draft with sample values and reports any
 *     placeholder the system would *not* fill in, without saving anything. So the
 *     save control is behind a preview that shows the missing placeholders, and a
 *     template cannot reach a customer with an unfilled `{{placeholder}}` in it.
 *
 *   · **The delivery log** — `GET /admin/notifications`. Every notification with
 *     its channel, status, the reason it failed and how many attempts were made.
 *
 * **A `FAILED` row shows the server's own `error` string.** Inventing a friendly
 * paraphrase of a gateway error is how an operator ends up chasing the wrong thing,
 * so the raw reason is what appears. */

const CHANNELS: Channel[] = ['SMS', 'EMAIL', 'IN_APP', 'WHATSAPP'];
const LOG_STATUSES: NotificationStatus[] = ['QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'READ'];

const CHANNEL_ICON = { SMS: MessageSquare, EMAIL: Mail, IN_APP: BellRing, WHATSAPP: MessageSquare } as const;

export function AdminTemplates({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const templates = useTemplates({}, locale);
  const rows = templates.data?.items ?? [];
  const variables = templates.data?.variables ?? [];
  const forbidden = templates.error instanceof ApiError && templates.error.status === 403;

  return (
    <div>
      <PageHeader eyebrow={dict.portal.admin} title={dict.admin.templates} description={dict.admin.templatesText} />

      <p className="mt-4 flex flex-wrap items-center gap-2 text-xs leading-5 text-muted">
        <span className="font-semibold">{dict.admin.placeholders}:</span>
        {variables.map((name) => (
          <code key={name} className="rounded bg-surface-2 px-1.5 py-0.5 font-mono">
            {`{{${name}}}`}
          </code>
        ))}
      </p>

      {templates.isPending ? (
        <Card className="mt-6 p-8 text-center text-sm text-muted" aria-busy="true">
          {dict.admin.loadingTemplates}
        </Card>
      ) : templates.isError ? (
        <div role="alert" className="mt-6 rounded-[14px] border border-rose-200 bg-rose-50 p-5">
          <p className="text-sm font-medium leading-6 text-rose-800">{dict.admin.templatesLoadError}</p>
          {forbidden ? <p className="mt-2 text-sm leading-6 text-rose-800">{dict.admin.adminTotpRequired}</p> : null}
          <Button type="button" variant="secondary" size="sm" className="mt-4" onClick={() => void templates.refetch()}>
            {dict.catalogue.retry}
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <Card className="mt-6 border-dashed px-6 py-14 text-center">
          <h2 className="font-semibold text-navy">{dict.admin.noTemplates}</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-secondary">{dict.admin.noTemplatesText}</p>
        </Card>
      ) : (
        <ul className="mt-6 grid gap-4">
          {rows.map((row) => (
            <li key={row.id}>
              <TemplateCard locale={locale} dict={dict} row={row} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TemplateCard({
  locale,
  dict,
  row
}: {
  locale: Locale;
  dict: Dictionary;
  row: { id: string; eventKey: string; channel: string; locale: string; subject: string | null; body: string; isActive: boolean; updatedAt: string };
}) {
  const preview = usePreviewTemplate(locale);
  const save = useSaveTemplate(locale);
  const [body, setBody] = useState(row.body);
  const [subject, setSubject] = useState(row.subject ?? '');
  const [missing, setMissing] = useState<string[] | null>(null);
  const [error, setError] = useState('');
  const Icon = CHANNEL_ICON[row.channel as Channel] ?? MessageSquare;

  const runPreview = async (): Promise<void> => {
    setError('');
    try {
      const result = await preview.mutateAsync({ body, ...(subject === '' ? {} : { subject }) });
      /* The server's list of placeholders it would not fill. This is the check
         that stands between a draft and every customer on that event. */
      setMissing(result.missing);
    } catch (caught) {
      setError(detailOf(caught, dict));
    }
  };

  const doSave = async (): Promise<void> => {
    setError('');
    if (missing === null) {
      setError(dict.admin.previewFirst);
      return;
    }
    if (missing.length > 0) {
      setError(dict.admin.fixPlaceholdersFirst);
      return;
    }
    try {
      await save.mutateAsync({ id: row.id, body, subject: subject === '' ? null : subject });
      toastSuccess(dict.admin.templateSaved);
    } catch (caught) {
      setError(detailOf(caught, dict));
    }
  };

  return (
    <Card className={cn('p-5', row.isActive ? '' : 'bg-slate-50/60')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 font-semibold text-navy">
            <Icon className="size-4 shrink-0 text-muted" aria-hidden="true" />
            {row.eventKey}
          </h2>
          <p className="mt-1 text-xs text-muted">
            {row.channel} · {row.locale.toUpperCase()} · {formatDateTime(row.updatedAt, locale)}
          </p>
        </div>
        {!row.isActive ? <span className="rounded-full bg-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-700">{dict.admin.templateInactive}</span> : null}
      </div>

      {row.channel === 'EMAIL' ? (
        <div className="mt-4">
          <label htmlFor={`subject-${row.id}`} className="text-[11.5px] font-semibold text-slate-800">
            {dict.admin.subject}
          </label>
          <input
            id={`subject-${row.id}`}
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            className="mt-1 min-h-11 w-full rounded-[9px] border border-line bg-white px-3 text-sm text-navy outline-none focus:border-primary"
          />
        </div>
      ) : null}

      <div className="mt-3">
        <label htmlFor={`body-${row.id}`} className="text-[11.5px] font-semibold text-slate-800">
          {dict.admin.templateBody}
        </label>
        <textarea
          id={`body-${row.id}`}
          rows={3}
          value={body}
          onChange={(event) => {
            setBody(event.target.value);
            /* Editing invalidates the preview: the missing-placeholder list belongs
               to the draft that was previewed, not to the next one. */
            setMissing(null);
          }}
          className="mt-1 w-full rounded-[9px] border border-line bg-white p-3 text-sm text-navy outline-none focus:border-primary"
        />
      </div>

      {missing === null ? null : (
        <p className={cn('mt-2 text-xs leading-5', missing.length === 0 ? 'text-emerald-700' : 'text-rose-700')}>
          {missing.length === 0 ? dict.admin.previewClean : dict.admin.previewMissing.replace('{placeholders}', missing.map((name) => `{{${name}}}`).join(', '))}
        </p>
      )}

      {error !== '' ? (
        <p role="alert" className="mt-2 rounded-[9px] bg-rose-50 p-3 text-sm text-rose-700">
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
        <Button type="button" variant="secondary" disabled={preview.isPending} onClick={() => void runPreview()}>
          {preview.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          {dict.admin.preview}
        </Button>
        <Button type="button" disabled={save.isPending} onClick={() => void doSave()}>
          {save.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Save className="size-4" aria-hidden="true" />}
          {dict.admin.saveTemplate}
        </Button>
      </div>
    </Card>
  );
}

/* ---- the delivery log --------------------------------------------------- */

export function AdminNotificationLog({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const [channel, setChannel] = useState<Channel | undefined>(undefined);
  const [status, setStatus] = useState<NotificationStatus | undefined>(undefined);
  const log = useNotificationLog({ ...(channel === undefined ? {} : { channel }), ...(status === undefined ? {} : { status }), limit: 200 }, locale);

  const rows = log.data?.items ?? [];
  const failed = rows.filter((row) => row.status === 'FAILED').length;
  const forbidden = log.error instanceof ApiError && log.error.status === 403;

  return (
    <div>
      <PageHeader eyebrow={dict.portal.admin} title={dict.admin.notificationLog} description={dict.admin.notificationLogText} />

      <div className="mt-6 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="log-channel" className="text-[11.5px] font-semibold text-slate-800">
            {dict.admin.channel}
          </label>
          <select
            id="log-channel"
            value={channel ?? ''}
            onChange={(event) => setChannel(event.target.value === '' ? undefined : (event.target.value as Channel))}
            className="mt-1 min-h-11 rounded-[9px] border border-line bg-white px-3 text-sm text-navy outline-none focus:border-primary"
          >
            <option value="">{dict.admin.anyChannel}</option>
            {CHANNELS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="log-status" className="text-[11.5px] font-semibold text-slate-800">
            {dict.common.status}
          </label>
          <select
            id="log-status"
            value={status ?? ''}
            onChange={(event) => setStatus(event.target.value === '' ? undefined : (event.target.value as NotificationStatus))}
            className="mt-1 min-h-11 rounded-[9px] border border-line bg-white px-3 text-sm text-navy outline-none focus:border-primary"
          >
            <option value="">{dict.admin.anyStatus}</option>
            {LOG_STATUSES.map((value) => (
              <option key={value} value={value}>
                {dict.admin.notificationStates[value]}
              </option>
            ))}
          </select>
        </div>
        {failed > 0 ? <p className="text-sm font-semibold text-rose-700">{dict.admin.failedCount.replace('{count}', String(failed))}</p> : null}
      </div>

      {log.isPending ? (
        <Card className="mt-6 p-8 text-center text-sm text-muted" aria-busy="true">
          {dict.admin.loadingNotifications}
        </Card>
      ) : log.isError ? (
        <div role="alert" className="mt-6 rounded-[14px] border border-rose-200 bg-rose-50 p-5">
          <p className="text-sm font-medium leading-6 text-rose-800">{dict.admin.notificationsLoadError}</p>
          {forbidden ? <p className="mt-2 text-sm leading-6 text-rose-800">{dict.admin.adminTotpRequired}</p> : null}
          <Button type="button" variant="secondary" size="sm" className="mt-4" onClick={() => void log.refetch()}>
            {dict.catalogue.retry}
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <Card className="mt-6 border-dashed px-6 py-14 text-center">
          <h2 className="font-semibold text-navy">{dict.admin.noNotifications}</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-secondary">{dict.admin.noNotificationsText}</p>
        </Card>
      ) : (
        <Card className="mt-6 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="bg-slate-50 text-xs text-muted">
                <tr>
                  <th className="p-4 text-start">{dict.admin.auditWhen}</th>
                  <th className="p-4 text-start">{dict.admin.event}</th>
                  <th className="p-4 text-start">{dict.admin.channel}</th>
                  <th className="p-4 text-start">{dict.common.status}</th>
                  <th className="p-4 text-start">{dict.admin.attempts}</th>
                  <th className="p-4 text-start">{dict.admin.reason}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((row) => (
                  <tr key={row.id} className={cn('align-top', row.status === 'FAILED' ? 'bg-rose-50/50' : 'hover:bg-slate-50')}>
                    <td className="p-4 text-xs whitespace-nowrap text-secondary">{formatDateTime(row.createdAt, locale)}</td>
                    <td className="p-4 font-mono text-[13px] text-navy">{row.eventKey}</td>
                    <td className="p-4 text-xs text-secondary">{row.channel}</td>
                    <td className="p-4">
                      <span
                        className={cn(
                          'rounded-full px-2.5 py-1 text-[11px] font-semibold',
                          row.status === 'FAILED' ? 'bg-rose-100 text-rose-800' : row.status === 'DELIVERED' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-700'
                        )}
                      >
                        {dict.admin.notificationStates[row.status as NotificationStatus] ?? row.status}
                      </span>
                    </td>
                    <td className="p-4 text-xs text-secondary tabular-nums">{row.attempts ?? dict.portal.notPublished}</td>
                    {/* The server's own failure reason. A friendly paraphrase of a
                        gateway error is how an operator chases the wrong thing. */}
                    <td className="p-4 font-mono text-[11px] break-words text-secondary">{row.error ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
