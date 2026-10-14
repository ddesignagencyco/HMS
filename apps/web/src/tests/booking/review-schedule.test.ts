import { describe, expect, it } from "vitest";
import { describeSchedule, karachiHour } from "@/features/booking/booking-flow";

/* Regression: the review step printed only the day of a named professional's
   slot ("Fri, 16 Oct"), so the customer confirmed a booking without ever
   seeing the start time they had picked. */
describe("describeSchedule", () => {
  it("shows the day and the start time of a real slot, in Asia/Karachi", () => {
    const line = describeSchedule({ start: "2026-10-16T05:00:00.000Z", end: "2026-10-16T06:30:00.000Z" }, "en", "Not chosen");
    expect(line).toMatch(/Fri, 16 Oct/);
    expect(line).toMatch(/10:00/);
  });

  it("says nothing was chosen when nothing was", () => {
    expect(describeSchedule(null, "en", "Not chosen")).toBe("Not chosen");
  });
});

describe("karachiHour", () => {
  it("reads the hour on the Karachi clock regardless of the browser's zone", () => {
    /* 04:00Z is 09:00 in Karachi — a morning slot even for a browser in UTC-8. */
    expect(karachiHour("2026-10-16T04:00:00.000Z")).toBe(9);
    expect(karachiHour("2026-10-16T12:30:00.000Z")).toBe(17);
    expect(karachiHour("2026-10-15T19:00:00.000Z")).toBe(0);
  });
});
