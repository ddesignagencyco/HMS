import { describe, expect, it } from 'vitest';
import { daySpan, earliestStart, localDateOf, localDayIndex, localMidnightOf, nextLocalMidnight, splitAtLocalMidnight, windowRefusal } from '../src/sameDay.js';

// Asia/Karachi is UTC+5 all year: local 00:00 on day D is 19:00Z on day D-1.
const at = (day: number, hourLocal: number, minute = 0): Date => new Date(Date.UTC(2026, 9, day, hourLocal - 5, minute));

describe('local day arithmetic', () => {
  it('gives the same day index to two instants on one local day', () => {
    expect(localDayIndex(at(5, 1))).toBe(localDayIndex(at(5, 23, 59)));
  });

  it('gives a later day index after local midnight', () => {
    expect(localDayIndex(at(6, 0))).toBe(localDayIndex(at(5, 23, 59)) + 1);
  });

  it('orders day indices across a month boundary', () => {
    // October has 31 days: the 1st and the 31st are 30 local days apart.
    expect(localDayIndex(at(1, 12))).toBe(localDayIndex(at(31, 12)) - 30);
  });

  it('reads local midnight as the start of the local day, not UTC midnight', () => {
    expect(localMidnightOf(at(5, 17)).toISOString()).toBe('2026-10-04T19:00:00.000Z');
  });

  it('steps to the next local midnight', () => {
    expect(nextLocalMidnight(at(5, 23, 30)).toISOString()).toBe('2026-10-05T19:00:00.000Z');
    expect(nextLocalMidnight(at(5, 0)).toISOString()).toBe('2026-10-05T19:00:00.000Z');
  });

  it('reports the local calendar date, which is the previous UTC date before 05:00 local', () => {
    expect(localDateOf(at(5, 3))).toEqual({ year: 2026, month: 10, day: 5 });
    expect(localDateOf(new Date(Date.UTC(2026, 9, 4, 19, 0)))).toEqual({ year: 2026, month: 10, day: 5 });
  });
});

describe('daySpan', () => {
  it('is zero for a window inside one local day', () => {
    expect(daySpan(at(5, 9), at(5, 11))).toBe(0);
  });

  it('is one for a window that ends just after local midnight', () => {
    expect(daySpan(at(5, 23, 30), at(6, 0, 30))).toBe(1);
  });

  it('is two for a window that ends the following evening', () => {
    expect(daySpan(at(5, 9), at(6, 17))).toBe(1);
    expect(daySpan(at(5, 9), at(7, 17))).toBe(2);
  });

  it('is never negative, even for a reversed window', () => {
    expect(daySpan(at(5, 11), at(5, 9))).toBe(0);
  });
});

describe('splitAtLocalMidnight', () => {
  it('leaves a same-day window as one piece', () => {
    const pieces = splitAtLocalMidnight(at(5, 9), at(5, 11));
    expect(pieces).toHaveLength(1);
    expect(pieces[0]).toEqual({ start: at(5, 9), end: at(5, 11) });
  });

  it('splits a window crossing local midnight into contiguous pieces', () => {
    const pieces = splitAtLocalMidnight(at(5, 22, 30), at(6, 0, 30));
    expect(pieces).toHaveLength(2);
    expect(pieces[0]).toEqual({ start: at(5, 22, 30), end: at(6, 0) });
    expect(pieces[1]).toEqual({ start: at(6, 0), end: at(6, 0, 30) });
  });

  it('hands back pieces with no gap and no overlap', () => {
    const pieces = splitAtLocalMidnight(at(5, 20), at(7, 3));
    expect(pieces[0]?.start.getTime()).toBe(at(5, 20).getTime());
    expect(pieces[pieces.length - 1]?.end.getTime()).toBe(at(7, 3).getTime());
    for (const [index, piece] of pieces.entries()) {
      expect(piece.end.getTime()).toBeGreaterThan(piece.start.getTime());
      const next = pieces[index + 1];
      if (next !== undefined) expect(piece.end.getTime()).toBe(next.start.getTime());
    }
  });

  it('returns nothing for an empty or reversed window', () => {
    expect(splitAtLocalMidnight(at(5, 9), at(5, 9))).toEqual([]);
    expect(splitAtLocalMidnight(at(5, 11), at(5, 9))).toEqual([]);
  });
});

describe('windowRefusal', () => {
  const rule = { minNoticeMin: 30, maxDaySpan: 1 };
  const now = at(5, 10);

  it('accepts a booking an hour from now', () => {
    expect(windowRefusal(now, at(5, 11), at(5, 12), rule)).toBeNull();
  });

  it('accepts the soonest bookable start exactly on the boundary', () => {
    expect(windowRefusal(now, at(5, 10, 30), at(5, 12), rule)).toBeNull();
  });

  it('refuses a start inside the minimum notice and says how much notice is needed', () => {
    expect(windowRefusal(now, at(5, 10, 29), at(5, 12), rule)).toBe("This service needs at least 30 minutes' notice");
  });

  it('refuses a start in the past', () => {
    expect(windowRefusal(now, at(5, 9), at(5, 12), rule)).toBe("This service needs at least 30 minutes' notice");
  });

  it('falls back to the future-only wording when there is no notice period', () => {
    expect(windowRefusal(now, at(5, 9), at(5, 12), { ...rule, minNoticeMin: 0 })).toBe('The booking must start in the future');
  });

  it('accepts starting exactly now when there is no notice period', () => {
    expect(windowRefusal(now, now, at(5, 12), { ...rule, minNoticeMin: 0 })).toBeNull();
  });

  it('accepts a late-evening job finishing after local midnight', () => {
    expect(windowRefusal(at(5, 20), at(5, 23, 30), at(6, 0, 30), rule)).toBeNull();
  });

  it('still refuses a window sprawling over more than one night', () => {
    expect(windowRefusal(at(5, 20), at(5, 23, 30), at(7, 1), rule)).toBe('A booking cannot run across more than one night');
  });

  it('refuses a window that ends before it starts', () => {
    expect(windowRefusal(now, at(5, 12), at(5, 11), rule)).toBe('The booking must end after it starts');
  });
});

describe('earliestStart', () => {
  it('adds the minimum notice', () => {
    expect(earliestStart(at(5, 10), 30).toISOString()).toBe(at(5, 10, 30).toISOString());
  });

  it('is now itself when no notice is required', () => {
    expect(earliestStart(at(5, 10), 0).toISOString()).toBe(at(5, 10).toISOString());
  });
});