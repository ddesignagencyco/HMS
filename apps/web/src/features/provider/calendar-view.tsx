'use client';

import { CalendarDays, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button, Card, Input, Label, PageHeader, Textarea } from '@/components/ui';
import { WEEKDAYS, isValidTimeOfDay } from '@/features/provider/limits';
import { useAddTimeOff, useAvailability, useRemoveTimeOff, useSetAvailability, useTimeOff } from '@/features/provider/queries';
import type { Dictionary } from '@/lib/dictionaries';
import { formatDate, type Locale } from '@/lib/utils';

/* Weekly availability and recorded leave.

   Two independent things on one screen, because they answer one question — "when
   can I be booked?" — and the API keeps them apart:

   · **Availability** is *recurring weekly blocks* (`{weekday, startTime, endTime}`),
     replace-all. The previous screen drew a month grid with per-day booked/free
     cells, which is a view of bookings rather than of availability, and nothing in
     the catalogue had a source for "booked".
   · **Leave** is a concrete date range. `provider_time_off.period` is a
     `tstzrange` with `[)` bounds, so `end` is the first moment work is possible
     again — a single day picked on the 10th is 10th 00:00 → 11th 00:00.

   Both saves are destructive full replaces, so the screen keeps a draft and only
   commits on Save, and Save stays disabled until something actually differs. */

type Draft = { weekday: number; startTime: string; endTime: string };

const blockKey = (block: Draft): string => `${block.weekday}-${block.startTime}-${block.endTime}`;

/** One picked date becomes a half-open range: 00:00 on it → 00:00 the next day. */
const singleDayRange = (date: string): { start: string; end: string } => {
  const start = new Date(`${date}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 24 * 3_600_000);
  return { start: start.toISOString(), end: end.toISOString() };
};

export function ProviderCalendarScreen({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const availability = useAvailability(locale);
  const timeOff = useTimeOff(locale);
  const saveAvailability = useSetAvailability(locale);
  const addTimeOff = useAddTimeOff(locale);
  const removeTimeOff = useRemoveTimeOff(locale);

  const [draft, setDraft] = useState<Draft[] | null>(null);
  const [leaveDate, setLeaveDate] = useState('');
  const [leaveReason, setLeaveReason] = useState('');
  const [localError, setLocalError] = useState('');

  const savedBlocks = useMemo<Draft[]>(
    () =>
      (availability.data?.items ?? []).map(({ weekday, startTime, endTime }) => ({
        weekday,
        startTime,
        endTime
      })),
    [availability.data]
  );

  const blocks = draft ?? savedBlocks;
  const isDirty = draft !== null && blockKeySet(draft) !== blockKeySet(savedBlocks);

  const addBlock = (): void => {
    setLocalError('');
    const weekday = blocks.find((block) => block.weekday === 0)?.weekday ?? 0;
    /* Seed on the first day with no block at all, so a second block on the same
       day starts after the last one rather than on top of it. */
    const sameDay = blocks.filter((block) => block.weekday === weekday).sort((a, b) => a.startTime.localeCompare(b.startTime));
    const last = sameDay.at(-1);
    const startTime = last === undefined ? '09:00' : last.endTime;
    const end = new Date(`1970-01-01T${startTime}:00Z`).getTime() + 4 * 3_600_000;
    const endTime = new Date(end).toISOString().slice(11, 16);
    if (startTime >= '24:00' || endTime <= startTime) {
      setLocalError(dict.portal.availabilityDayFull);
      return;
    }
    setDraft([...blocks, { weekday, startTime, endTime }]);
  };

  const commitAvailability = async (): Promise<void> => {
    setLocalError('');
    for (const block of blocks) {
      if (!isValidTimeOfDay(block.startTime) || !isValidTimeOfDay(block.endTime)) {
        setLocalError(dict.portal.availabilityTimeInvalid);
        return;
      }
      /* `availabilityReplaceSchema` refuses startTime >= endTime. */
      if (block.startTime >= block.endTime) {
        setLocalError(dict.portal.availabilityOrderInvalid);
        return;
      }
    }
    try {
      await saveAvailability.mutateAsync(blocks);
      setDraft(null);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : dict.portal.availabilitySaveFailed);
    }
  };

  const recordLeave = async (): Promise<void> => {
    setLocalError('');
    if (leaveDate === '') {
      setLocalError(dict.portal.leaveDateRequired);
      return;
    }
    const { start, end } = singleDayRange(leaveDate);
    try {
      await addTimeOff.mutateAsync({ start, end, ...(leaveReason.trim() === '' ? {} : { reason: leaveReason.trim() }) });
      setLeaveDate('');
      setLeaveReason('');
    } catch (error) {
      /* An overlap is a 409 from the exclusion constraint; the server's own
         sentence is clearer than anything invented here. */
      setLocalError(error instanceof Error ? error.message : dict.portal.leaveSaveFailed);
    }
  };

  if (availability.isPending || timeOff.isPending) {
    return (
      <div aria-busy="true" aria-live="polite" className="grid gap-3">
        <span className="skeleton h-8 w-56 rounded-[9px]" />
        <span className="skeleton h-48 w-full rounded-[12px]" />
      </div>
    );
  }

  if (availability.isError) {
    return (
      <div>
        <PageHeader eyebrow={dict.portal.provider} title={dict.portal.calendar} />
        <div role="alert" className="mt-6 rounded-[14px] border border-rose-200 bg-rose-50 p-5">
          <p className="text-sm font-medium leading-6 text-rose-800">{dict.portal.availabilityLoadError}</p>
          <Button type="button" variant="secondary" size="sm" className="mt-4" onClick={() => void availability.refetch()}>
            {dict.catalogue.retry}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow={dict.portal.provider}
        title={dict.portal.calendar}
        description={dict.portal.calendarText}
        action={
          <Button type="button" size="sm" onClick={addBlock} disabled={isDirty === false && blocks.length >= 21}>
            <Plus className="size-4" aria-hidden="true" />
            {dict.portal.addWindow}
          </Button>
        }
      />

      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card className="p-6">
          <h2 className="flex items-center gap-2 font-semibold text-navy">
            <CalendarDays className="size-4 text-muted" aria-hidden="true" />
            {dict.portal.weeklyAvailability}
          </h2>

          {blocks.length === 0 ? (
            <p className="mt-4 rounded-[9px] border border-line bg-surface-2 p-4 text-sm leading-6 text-secondary">{dict.portal.noAvailability}</p>
          ) : (
            <ul className="mt-4 grid gap-2">
              {blocks.map((block, index) => (
                <li key={`${blockKey(block)}-${index}`} className="flex flex-wrap items-end gap-3 rounded-[10px] border border-line p-3">
                  <div className="grid gap-1">
                    <Label htmlFor={`day-${index}`}>{dict.portal.dayLabel}</Label>
                    <select
                      id={`day-${index}`}
                      className="min-h-11 rounded-[9px] border border-line bg-white px-3 text-sm"
                      value={block.weekday}
                      onChange={(event) => {
                        const next = [...blocks];
                        next[index] = { ...block, weekday: Number(event.target.value) };
                        setDraft(next);
                      }}
                    >
                      {WEEKDAYS.map((day) => (
                        <option key={day.value} value={day.value}>
                          {dict.portal.weekdays[day.key]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor={`start-${index}`}>{dict.portal.fromLabel}</Label>
                    <Input
                      id={`start-${index}`}
                      type="time"
                      value={block.startTime}
                      onChange={(event) => {
                        const next = [...blocks];
                        next[index] = { ...block, startTime: event.target.value };
                        setDraft(next);
                      }}
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor={`end-${index}`}>{dict.portal.toLabel}</Label>
                    <Input
                      id={`end-${index}`}
                      type="time"
                      value={block.endTime}
                      onChange={(event) => {
                        const next = [...blocks];
                        next[index] = { ...block, endTime: event.target.value };
                        setDraft(next);
                      }}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="ms-auto text-rose-700"
                    onClick={() => setDraft(blocks.filter((_, i) => i !== index))}
                    aria-label={`${dict.portal.removeWindow}: ${dict.portal.weekdays[WEEKDAYS[block.weekday].key]} ${block.startTime}`}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {localError !== '' && blocks.length > 0 ? (
            <p role="alert" className="mt-4 rounded-[9px] bg-rose-50 p-3 text-sm text-rose-700">
              {localError}
            </p>
          ) : null}

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button type="button" onClick={() => void commitAvailability()} disabled={!isDirty || saveAvailability.isPending}>
              {saveAvailability.isPending ? dict.portal.saving : dict.portal.saveAvailability}
            </Button>
            {isDirty ? (
              <Button type="button" variant="secondary" onClick={() => setDraft(null)} disabled={saveAvailability.isPending}>
                {dict.common.cancel}
              </Button>
            ) : null}
          </div>
          <p className="mt-4 text-xs leading-5 text-muted">{dict.portal.availabilityReplaceNote}</p>
        </Card>

        <Card className="p-6">
          <h2 className="font-semibold text-navy">{dict.portal.leave}</h2>
          <p className="mt-2 text-sm leading-6 text-secondary">{dict.portal.leaveText}</p>

          <div className="mt-4 grid gap-3">
            <div className="grid gap-2">
              <Label htmlFor="leave-date">{dict.portal.leaveDateLabel}</Label>
              <Input id="leave-date" type="date" value={leaveDate} onChange={(event) => setLeaveDate(event.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="leave-reason">{dict.portal.leaveReasonLabel}</Label>
              <Textarea id="leave-reason" value={leaveReason} onChange={(event) => setLeaveReason(event.target.value)} placeholder={dict.portal.leaveReasonPlaceholder} />
            </div>
            <Button type="button" onClick={() => void recordLeave()} disabled={addTimeOff.isPending}>
              {addTimeOff.isPending ? dict.portal.saving : dict.portal.recordLeave}
            </Button>
          </div>

          {timeOff.isError ? (
            <p role="alert" className="mt-4 text-sm text-rose-700">
              {dict.portal.leaveLoadError}
            </p>
          ) : timeOff.data.items.length === 0 ? (
            <p className="mt-4 text-sm text-secondary">{dict.portal.noLeave}</p>
          ) : (
            <ul className="mt-5 grid gap-2">
              {timeOff.data.items.map((period) => (
                <li key={period.id} className="flex items-center justify-between gap-3 border-b border-line pb-2 last:border-0">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-navy">{formatDate(period.start, locale)}</p>
                    {period.reason !== null && period.reason !== '' ? <p className="mt-0.5 text-xs text-muted">{period.reason}</p> : null}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => void removeTimeOff.mutateAsync(period.id)}
                    aria-label={`${dict.portal.cancelLeave}: ${formatDate(period.start, locale)}`}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

/** Order-insensitive comparison, so a re-order alone is not treated as a change. */
function blockKeySet(blocks: Draft[]): string {
  return blocks.map(blockKey).sort().join('|');
}
