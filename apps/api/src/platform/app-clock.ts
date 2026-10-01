// apps/api/src/platform/app-clock.ts
import { Injectable } from '@nestjs/common';
import type { Clock } from '@smart-home/domain';

/**
 * The time source for rules that depend on the wall clock in a way a test must be able to control: calling hours, time bands,
 * SLA and expiry sweeps. It is the system clock plus an offset, and the offset is zero unless `travelTo` / `advanceMinutes` is
 * called, which only tests do — nothing in the running application ever moves it. An offset (rather than a frozen instant)
 * keeps ages consistent: a row created a moment ago stays a moment old, and "48 hours later" really is 48 hours after it.
 * (Timestamps the database writes itself, such as `created_at`, stay on the database's clock.)
 */
@Injectable()
export class AppClock implements Clock {
  private offsetMs = 0;

  now(): Date {
    return new Date(Date.now() + this.offsetMs);
  }

  /** Tests only: make `now()` read as `target` (and keep running from there). */
  travelTo(target: Date | string): void {
    this.offsetMs = new Date(target).getTime() - Date.now();
  }

  advanceMinutes(minutes: number): void {
    this.offsetMs += minutes * 60_000;
  }

  reset(): void {
    this.offsetMs = 0;
  }
}
