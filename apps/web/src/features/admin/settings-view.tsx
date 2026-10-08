'use client';

import { useState } from 'react';
import { Loader2, Save, Search, Settings2 } from 'lucide-react';
import { Button, Card, PageHeader } from '@/components/ui';
import type { SettingValue } from '@/features/admin/cases-api';
import { useSettings, useUpdateSetting } from '@/features/admin/cases-queries';
import { detailOf, toastSuccess } from '@/features/auth/auth-feedback';
import { ApiError } from '@/lib/api/problem';
import type { Dictionary } from '@/lib/dictionaries';
import type { Locale } from '@/lib/utils';

/* Platform settings — `GET /admin/settings` and `PUT /admin/settings/:key`.
 *
 * `SettingRow.value` is a genuine union — string, number, boolean, null, a string
 * array, or a record of scalars — because settings are heterogeneous (an SLA in
 * minutes, a boolean gate, a fee band). So the editor is chosen by the value's
 * *current* type rather than guessed from the key: a value that is currently a
 * boolean gets a checkbox, a number gets a numeric input, an array or object gets
 * JSON text with the round-trip checked before sending.
 *
 * **An array or object is edited as JSON and validated locally.** `JSON.parse`
 * failing in the browser is a far better place to find out than a 422 from the
 * server, and the shape is checked against the two unions the schema accepts so a
 * number cannot be posted where an array of strings is required.
 *
 * **`null` is a real value**, not "unset" — the read route distinguishes
 * `configured: false` from a stored null, so the screen distinguishes them too. */

export function AdminSettings({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const [term, setTerm] = useState('');
  const [committed, setCommitted] = useState('');
  const settings = useSettings(committed === '' ? undefined : committed, locale);
  const forbidden = settings.error instanceof ApiError && settings.error.status === 403;

  const rows = settings.data?.items ?? [];

  return (
    <div>
      <PageHeader eyebrow={dict.portal.admin} title={dict.admin.settings} description={dict.admin.settingsText} />

      <form
        className="mt-6 flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          setCommitted(term.trim());
        }}
      >
        <div className="min-w-[260px] flex-1">
          <label htmlFor="settings-search" className="text-[11.5px] font-semibold text-slate-800">
            {dict.admin.searchSettings}
          </label>
          <div className="relative mt-1">
            <Search className="pointer-events-none absolute inset-y-0 start-0 my-auto ms-3 size-4 text-muted" aria-hidden="true" />
            <input
              id="settings-search"
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

      {settings.isPending ? (
        <Card className="mt-6 p-8 text-center text-sm text-muted" aria-busy="true">
          {dict.admin.loadingSettings}
        </Card>
      ) : settings.isError ? (
        <div role="alert" className="mt-6 rounded-[14px] border border-rose-200 bg-rose-50 p-5">
          <p className="text-sm font-medium leading-6 text-rose-800">{dict.admin.settingsLoadError}</p>
          {forbidden ? <p className="mt-2 text-sm leading-6 text-rose-800">{dict.admin.adminTotpRequired}</p> : null}
          <Button type="button" variant="secondary" size="sm" className="mt-4" onClick={() => void settings.refetch()}>
            {dict.catalogue.retry}
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <Card className="mt-6 border-dashed px-6 py-14 text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-full bg-surface-2 text-muted" aria-hidden="true">
            <Settings2 className="size-6" />
          </span>
          <h2 className="mt-4 font-semibold text-navy">{dict.admin.noSettings}</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-secondary">{dict.admin.noSettingsText}</p>
        </Card>
      ) : (
        <Card className="mt-6 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-slate-50 text-xs text-muted">
                <tr>
                  <th className="p-4 text-start">{dict.admin.settingKey}</th>
                  <th className="p-4 text-start">{dict.admin.description}</th>
                  <th className="p-4 text-start">{dict.admin.settingValue}</th>
                  <th className="p-4 text-end">{dict.admin.actions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((row) => (
                  <SettingRowEditor key={row.key} locale={locale} dict={dict} row={row} />
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-line p-4 text-xs leading-5 text-muted">{dict.admin.noDeployNote}</p>
        </Card>
      )}
    </div>
  );
}

function SettingRowEditor({ locale, dict, row }: { locale: Locale; dict: Dictionary; row: { key: string; value: SettingValue; description: string; updatedAt: string } }) {
  const update = useUpdateSetting(locale);
  const [draft, setDraft] = useState<SettingValue>(row.value);
  const [text, setText] = useState(() => (typeof row.value === 'object' && row.value !== null ? JSON.stringify(row.value) : String(row.value)));
  const [error, setError] = useState('');

  const isJson = typeof row.value === 'object' && row.value !== null;

  const save = async (): Promise<void> => {
    setError('');
    let value: SettingValue = draft;
    if (isJson) {
      try {
        value = JSON.parse(text) as SettingValue;
      } catch {
        /* Caught here rather than sent as a 422: a malformed value in an admin
           settings screen is almost always a stray comma. */
        setError(dict.admin.invalidJson);
        return;
      }
      if (!Array.isArray(value) && typeof value !== 'object') {
        setError(dict.admin.wrongShape);
        return;
      }
      if (Array.isArray(value) && !value.every((entry) => typeof entry === 'string')) {
        setError(dict.admin.wrongShape);
        return;
      }
    }
    try {
      await update.mutateAsync({ key: row.key, value });
      toastSuccess(dict.admin.settingSaved);
    } catch (caught) {
      setError(detailOf(caught, dict));
    }
  };

  return (
    <tr className="align-top hover:bg-slate-50">
      <td className="p-4 font-mono text-[13px] font-semibold text-navy">{row.key}</td>
      <td className="p-4 text-secondary">{row.description}</td>
      <td className="p-4">
        {typeof row.value === 'boolean' ? (
          <label className="flex items-center gap-2 text-sm text-navy">
            <input type="checkbox" checked={draft === true} onChange={(event) => setDraft(event.target.checked)} />
            {String(draft)}
          </label>
        ) : isJson ? (
          <textarea
            rows={3}
            value={text}
            onChange={(event) => setText(event.target.value)}
            aria-label={`${row.key} ${dict.admin.settingValue}`}
            className="w-full rounded-[9px] border border-line bg-white p-3 font-mono text-[12px] text-navy outline-none focus:border-primary"
          />
        ) : (
          <input
            type={typeof row.value === 'number' ? 'number' : 'text'}
            value={String(draft)}
            onChange={(event) => setDraft(typeof row.value === 'number' ? Number(event.target.value) : event.target.value)}
            aria-label={`${row.key} ${dict.admin.settingValue}`}
            className="min-h-11 w-full rounded-[9px] border border-line bg-white px-3 text-sm text-navy outline-none focus:border-primary"
          />
        )}
        {error !== '' ? (
          <p role="alert" className="mt-1 text-xs font-medium text-rose-700">
            {error}
          </p>
        ) : null}
      </td>
      <td className="p-4 text-end">
        <Button type="button" size="sm" disabled={update.isPending} onClick={() => void save()}>
          {update.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Save className="size-4" aria-hidden="true" />}
          {dict.portal.save}
        </Button>
      </td>
    </tr>
  );
}
