import { describe, expect, it } from 'vitest';
import { MIN_NOTICE_MINUTES, requestedWindows } from '@/features/booking/provider-choice';

/* The auto-assign schedule step builds its own list of requested start times,
   because with "let the platform select" there is no professional whose
   `/slots` could be read.

   That made it the one place in the product that could offer a time the server
   had already refused. Checkout rejects a start inside `booking.min_notice_min`
   with 400 "This service needs at least 30 minutes' notice", and the slot
   listing and checkout both read that setting so a listed time is always
   bookable (SRS CL-26). This list read neither, so at 15:30 on the current day
   it still offered 09:00 — and the customer could walk all the way to the
   payment step and only then be told the time was in the past.

   These pin the notice window to what the API enforces. */

const localHour = (iso: string): number =>
  Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Asia/Karachi' }).format(new Date(iso)));

describe('the requested start times offered to "let the platform select"', () => {
  it('drops the hours of today that have already gone', () => {
    // 15:30 in Asia/Karachi on the 7th — mid-afternoon, so 09:00 is behind us.
    const now = new Date('2026-10-07T10:00:00.000Z');
    const hours = requestedWindows('2026-10-07', 90, now).map((w) => localHour(w.start));

    expect(hours).not.toContain(9);
    expect(hours).not.toContain(14);
    expect(hours.every((h) => h >= 16)).toBe(true);
  });

  it('drops a start inside the notice period even when it has not passed yet', () => {
    // 09:15 local: 09:00 is past, but 10:00 is only 45 minutes out.
    const now = new Date('2026-10-07T04:15:00.000Z');
    const hours = requestedWindows('2026-10-07', 90, now).map((w) => localHour(w.start));

    expect(hours).not.toContain(9);
    // 10:00 local is 04:00Z, 45 minutes before now — inside the 30-minute notice
    // from 10:45 local, so it is still bookable. Nothing here may be nearer than
    // the notice allows.
    const earliest = requestedWindows('2026-10-07', 90, now)[0];
    expect(new Date(earliest.start).getTime()).toBeGreaterThanOrEqual(now.getTime() + MIN_NOTICE_MINUTES * 60_000);
  });

  it('offers every hour of a future day, because the notice cannot bite', () => {
    const now = new Date('2026-10-07T10:00:00.000Z');
    const hours = requestedWindows('2026-10-20', 90, now).map((w) => localHour(w.start));

    expect(hours[0]).toBe(9);
    expect(hours).toHaveLength(20 - 9 - Math.ceil(90 / 60) + 1);
  });

  it('has nothing left to offer once the working day is over', () => {
    // 22:00 local — past the last 20:00 start.
    const now = new Date('2026-10-07T17:00:00.000Z');
    expect(requestedWindows('2026-10-07', 90, now)).toEqual([]);
  });

  it('never offers a start the server would refuse, for any hour of any day', () => {
    const now = new Date('2026-10-07T10:00:00.000Z');
    for (const date of ['2026-10-07', '2026-10-08', '2026-10-20']) {
      for (const window of requestedWindows(date, 90, now)) {
        expect(new Date(window.start).getTime()).toBeGreaterThanOrEqual(
          now.getTime() + MIN_NOTICE_MINUTES * 60_000,
        );
      }
    }
  });
});