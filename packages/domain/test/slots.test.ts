import { describe, expect, it } from 'vitest';
import { generateSlots } from '../src/slots.js';

// 2026-10-05 in Asia/Karachi (UTC+5, no daylight saving): 09:00 local is 04:00Z.
const date = { year: 2026, month: 10, day: 5 };
const at = (hourLocal: number, minute = 0): Date => new Date(Date.UTC(2026, 9, 5, hourLocal - 5, minute));
const base = { date, windows: [{ start: '09:00', end: '12:00' }], blocked: [], bookings: [], durationMin: 60, stepMin: 30, bufferMin: 0, earliest: new Date(0) };
const starts = (slots: { start: Date }[]): string[] => slots.map(slot => slot.start.toISOString().slice(11, 16));

describe('generateSlots', () => {
  it('steps through a window, every slot fitting inside it', () => {
    expect(starts(generateSlots(base))).toEqual(['04:00', '04:30', '05:00', '05:30', '06:00']);
  });

  it('never returns a slot that would run past the end of the window', () => {
    const slots = generateSlots({ ...base, durationMin: 90 });
    expect(slots.every(slot => slot.end.getTime() <= at(12).getTime())).toBe(true);
    expect(starts(slots)).toEqual(['04:00', '04:30', '05:00', '05:30']);
  });

  it('drops slots that overlap leave', () => {
    const slots = generateSlots({ ...base, blocked: [{ start: at(10), end: at(11) }] });
    expect(starts(slots)).toEqual(['04:00', '06:00']);
  });

  it('keeps the travel buffer clear either side of an existing booking, but not around leave', () => {
    const booking = { start: at(10), end: at(11) };
    // 30-minute jobs: the booking 10:00-11:00 widens to 09:30-11:30, so only the edges of the window survive.
    expect(starts(generateSlots({ ...base, durationMin: 30, bookings: [booking], bufferMin: 30 }))).toEqual(['04:00', '06:30']);
    // Leave gets no buffer: the half hours either side stay open.
    expect(starts(generateSlots({ ...base, durationMin: 30, blocked: [booking], bufferMin: 30 }))).toEqual(['04:00', '04:30', '06:00', '06:30']);
  });

  it('allows a slot that ends exactly when a booking begins (no overlap)', () => {
    const slots = generateSlots({ ...base, bookings: [{ start: at(10), end: at(11) }] });
    expect(starts(slots)).toContain('04:00');
    expect(starts(slots)).toContain('06:00');
  });

  it('drops slots earlier than the minimum notice', () => {
    expect(starts(generateSlots({ ...base, earliest: at(10, 15) }))).toEqual(['05:30', '06:00']);
  });

  it('handles several windows in one day, in order', () => {
    const slots = generateSlots({ ...base, windows: [{ start: '15:00', end: '16:00' }, { start: '09:00', end: '10:00' }] });
    expect(starts(slots)).toEqual(['04:00', '10:00']);
  });

  it('returns nothing for a non-positive duration or step', () => {
    expect(generateSlots({ ...base, durationMin: 0 })).toEqual([]);
    expect(generateSlots({ ...base, stepMin: 0 })).toEqual([]);
  });
});
