import { wallTimeIn } from './slaCalendar.js';

const MINUTE = 60_000;

/**
 * The local (Asia/Karachi) calendar day an instant falls on, as days since the
 * Unix epoch. Comparable across instants, unlike a formatted date string, so
 * day arithmetic here is plain integer maths.
 */
export const localDayIndex = (instant: Date): number => {
  const wall = wallTimeIn(instant);
  return Math.floor(Date.UTC(wall.year, wall.month - 1, wall.day) / 86_400_000);
};

/** The instant of local midnight *after* `instant` — the next local 00:00. */
export const nextLocalMidnight = (instant: Date): Date => {
  const wall = wallTimeIn(instant);
  return new Date(Date.UTC(wall.year, wall.month - 1, wall.day + 1) - localMidnightOffsetMs(instant));
};

/** The instant of local midnight at or before `instant` — the local 00:00 that starts its day. */
export const localMidnightOf = (instant: Date): Date => {
  const wall = wallTimeIn(instant);
  return new Date(Date.UTC(wall.year, wall.month - 1, wall.day) - localMidnightOffsetMs(instant));
};

/** The local calendar date (year/month/day) `instant` falls on. */
export const localDateOf = (instant: Date): { year: number; month: number; day: number } => {
  const wall = wallTimeIn(instant);
  return { year: wall.year, month: wall.month, day: wall.day };
};

const localMidnightOffsetMs = (instant: Date): number => {
  const wall = wallTimeIn(instant);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  return asUtc - instant.getTime();
};

/**
 * How many local midnights a window crosses. A window entirely inside one local
 * day spans 0; 22:30–00:30 spans 1; 22:30 tomorrow spans 2.
 */
export const daySpan = (start: Date, end: Date): number => {
  if (end.getTime() <= start.getTime()) return 0;
  return localDayIndex(end) - localDayIndex(start);
};

/**
 * Splits a booking window at every local midnight it crosses.
 *
 * Provider availability is stored as `(weekday, start_time, end_time)` — a
 * wall-clock range *within one local day*. A job that runs past local midnight
 * therefore cannot be matched by a single availability row no matter how late the
 * provider works, so it has to be asked about one local day at a time. Pure:
 * the caller supplies the pieces and looks them up.
 *
 * `[22:30, 00:30)` on consecutive local days becomes
 * `[{22:30, 24:00}, {00:00, 00:30}]` — expressed here as instants, with each
 * piece ending exactly where the next begins.
 */
export const splitAtLocalMidnight = (start: Date, end: Date): { start: Date; end: Date }[] => {
  if (end.getTime() <= start.getTime()) return [];
  const pieces: { start: Date; end: Date }[] = [];
  let cursor = new Date(start);
  while (cursor.getTime() < end.getTime()) {
    const midnight = nextLocalMidnight(cursor);
    const pieceEnd = midnight.getTime() < end.getTime() ? midnight : new Date(end);
    pieces.push({ start: new Date(cursor), end: pieceEnd });
    cursor = pieceEnd;
  }
  return pieces;
};

export type WindowRule = {
  /** `booking.min_notice_min`: the shortest notice a customer may give. */
  minNoticeMin: number;
  /**
   * How many local midnights a window may cross. The old rule was 0 ("start and
   * end on the same calendar day"), which refused a 23:30 booking outright even
   * though finishing at 00:30 is ordinary late-evening work. 1 allows that and
   * still refuses a window that sprawls across more than two local days.
   */
  maxDaySpan: number;
};

/**
 * FR-BK / same-day booking: the lead-time and day-span gate, as a pure
 * predicate returning a refusal message or `null` when the window is fine.
 *
 * Checkout and the slot listing must agree, so both call this: the listing is
 * what a customer picks from and the gate is what would reject it at checkout,
 * and a customer who is offered a start time that checkout refuses has been told
 * a lie.
 */
export const windowRefusal = (now: Date, start: Date, end: Date, rule: WindowRule): string | null => {
  if (end.getTime() <= start.getTime()) return 'The booking must end after it starts';
  const earliest = now.getTime() + rule.minNoticeMin * MINUTE;
  if (start.getTime() < earliest) {
    const notice = rule.minNoticeMin;
    return notice === 0 ? 'The booking must start in the future' : `This service needs at least ${notice} minutes' notice`;
  }
  if (daySpan(start, end) > rule.maxDaySpan) return 'A booking cannot run across more than one night';
  return null;
};

/** The first instant a booking may start: now plus the configured minimum notice. */
export const earliestStart = (now: Date, minNoticeMin: number): Date => new Date(now.getTime() + minNoticeMin * MINUTE);

export const SameDayBooking = { daySpan, earliestStart, localDateOf, localDayIndex, localMidnightOf, nextLocalMidnight, splitAtLocalMidnight, windowRefusal } as const;