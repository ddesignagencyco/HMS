import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatMoney, formatDuration } from "@/lib/utils";

describe("utils formatting functions", () => {
  it("formatDate handles valid ISO dates", () => {
    const formatted = formatDate("2026-10-08T12:00:00Z", "en");
    expect(formatted).toBeTruthy();
    expect(formatted).not.toBe("—");
  });

  it("formatDate gracefully handles invalid date values without throwing RangeError", () => {
    expect(formatDate("Active", "en")).toBe("Active");
    expect(formatDate("invalid-time-val", "en")).toBe("invalid-time-val");
    expect(formatDate("", "en")).toBe("—");
    expect(formatDate(null, "en")).toBe("—");
    expect(formatDate(undefined, "en")).toBe("—");
  });

  it("formatDateTime handles valid ISO dates", () => {
    const formatted = formatDateTime("2026-10-08T12:00:00Z", "en");
    expect(formatted).toBeTruthy();
    expect(formatted).not.toBe("—");
  });

  it("formatDateTime gracefully handles invalid date values without throwing RangeError", () => {
    expect(formatDateTime("Active", "en")).toBe("Active");
    expect(formatDateTime("bad-date", "en")).toBe("bad-date");
    expect(formatDateTime("", "en")).toBe("—");
    expect(formatDateTime(null, "en")).toBe("—");
    expect(formatDateTime(undefined, "en")).toBe("—");
  });

  it("formatMoney formats paisa to rupees correctly", () => {
    expect(formatMoney(100000, "en")).toBe("Rs 1,000");
    expect(formatMoney(0, "en")).toBe("Rs 0");
  });

  it("formatDuration formats minutes accurately", () => {
    expect(formatDuration(45, "en")).toBe("45 min");
    expect(formatDuration(60, "en")).toBe("1 h");
    expect(formatDuration(90, "en")).toBe("1 h 30 min");
  });
});
