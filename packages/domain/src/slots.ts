import { instantFromWallTime } from './slaCalendar.js';

export type Interval = { start: Date; end: Date };

export type SlotInput = {
  /** Local (Asia/Karachi) calendar day the customer is browsing. */
  date: { year: number; month: number; day: number };
  /** The provider's declared working windows that day as local wall-clock times, e.g. 09:00–18:00. */
  windows: readonly { start: string; end: string }[];
  /** Leave and existing bookings: nothing may overlap these. */
  blocked: readonly Interval[];
  /** How long the job takes. */
  durationMin: number;
  /** How often a slot may start (30 = on the hour and half hour). */
  stepMin: number;
  /** BR-08: travel time kept clear either side of an existing booking — not around leave, which has no travel. */
  bufferMin: number;
  /** Bookings already on the calendar; only these are widened by the buffer. */
  bookings: readonly Interval[];
  /** Slots must start no earlier than this (now plus the minimum notice). */
  earliest: Date;
};

const MINUTE = 60_000;

const parseClock = (value: string): { hour: number; minute: number } => {
  const [hour = '0', minute = '0'] = value.split(':');
  return { hour: Number.parseInt(hour, 10), minute: Number.parseInt(minute, 10) };
};

const overlaps = (a: Interval, b: Interval): boolean => a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime();

/**
 * FR-SR / BR-08: the start times a customer can pick. Every candidate slot is `durationMin` long and starts on a
 * `stepMin` boundary inside one of the provider's windows; it is dropped when it would overlap leave, or an existing
 * booking widened by the travel buffer, or when it starts before `earliest`. Pure: no clock, no database, so the same
 * inputs always give the same slots and the whole thing is table-testable.
 */
export const generateSlots = (input: SlotInput): Interval[] => {
  if (input.durationMin <= 0 || input.stepMin <= 0) return [];
  const widened = input.bookings.map(booking => ({ start: new Date(booking.start.getTime() - input.bufferMin * MINUTE), end: new Date(booking.end.getTime() + input.bufferMin * MINUTE) }));
  const obstacles = [...input.blocked, ...widened];

  const slots: Interval[] = [];
  for (const window of input.windows) {
    const from = parseClock(window.start);
    const to = parseClock(window.end);
    const windowStart = instantFromWallTime({ ...input.date, hour: from.hour, minute: from.minute });
    const windowEnd = instantFromWallTime({ ...input.date, hour: to.hour, minute: to.minute });
    for (let cursor = windowStart.getTime(); cursor + input.durationMin * MINUTE <= windowEnd.getTime(); cursor += input.stepMin * MINUTE) {
      const slot = { start: new Date(cursor), end: new Date(cursor + input.durationMin * MINUTE) };
      if (slot.start.getTime() < input.earliest.getTime()) continue;
      if (obstacles.some(obstacle => overlaps(slot, obstacle))) continue;
      slots.push(slot);
    }
  }
  return slots.sort((left, right) => left.start.getTime() - right.start.getTime());
};
