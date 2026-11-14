import { describe, expect, it } from "vite-plus/test";
import { clockTime, dayOf, shortDate } from "./short-date";

const at = (day: number, hour = 12, month = 10, year = 2026) =>
  new Date(year, month, day, hour).getTime();
const iso = (time: number) => new Date(time).toISOString();

describe("shortDate", () => {
  const now = at(14);
  it("shows now, the time today, the day this year and the year before", () => {
    expect(shortDate(iso(now - 30_000), "en-US", now)).toBe("now");
    expect(shortDate(iso(at(14, 9)), "en-US", now)).toBe(
      clockTime(iso(at(14, 9)), "en-US"),
    );
    expect(shortDate(iso(at(31, 12, 9)), "en-US", now)).toBe("Oct 31");
    expect(shortDate(iso(at(31, 12, 9, 2025)), "en-US", now)).toBe(
      "Oct 31, 2025",
    );
  });
});

describe("dayOf", () => {
  it("counts the days back and names the day", () => {
    const now = at(14, 8);
    expect(dayOf(iso(at(14, 1)), "en-US", now).daysAgo).toBe(0);
    expect(dayOf(iso(at(13, 23)), "en-US", now).daysAgo).toBe(1);
    expect(dayOf(iso(at(31, 12, 9)), "en-US", now)).toEqual({
      daysAgo: 14,
      label: "Sat, Oct 31",
    });
  });
});
