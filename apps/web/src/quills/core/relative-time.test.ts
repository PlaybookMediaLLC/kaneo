import { describe, expect, it } from "vite-plus/test";
import { relativeTime } from "./relative-time";

describe("relativeTime", () => {
  const now = Date.parse("2026-11-13T12:00:00.000Z");
  it("uses the largest whole unit", () => {
    expect(relativeTime("2026-11-05T12:00:00.000Z", "en", now)).toBe("8d ago");
    expect(relativeTime("2024-10-01T12:00:00.000Z", "en", now)).toBe("2y ago");
    expect(relativeTime("2026-11-13T11:55:00.000Z", "en", now)).toBe("5m ago");
  });
  it("shows now for recent and future times", () => {
    expect(relativeTime("2026-11-13T11:59:30.000Z", "en", now)).toBe("now");
    expect(relativeTime("2026-11-13T12:05:00.000Z", "en", now)).toBe("now");
  });
});
