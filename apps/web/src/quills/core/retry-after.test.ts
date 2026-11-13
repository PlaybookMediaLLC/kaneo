import { describe, expect, it } from "vite-plus/test";
import { retryAfterAt } from "./retry-after";

describe("retryAfterAt", () => {
  const now = Date.UTC(2026, 0, 1);
  it("accepts delta seconds and HTTP dates", () => {
    expect(retryAfterAt("3", now)).toBe(now + 3000);
    expect(retryAfterAt(new Date(now + 5000).toUTCString(), now)).toBe(
      now + 5000,
    );
    expect(retryAfterAt(new Date(now - 5000).toUTCString(), now)).toBe(now);
  });
  it.each([null, "invalid", "-1", "1.5", "Infinity", "999999999999999999"])(
    "uses a bounded fallback for %s",
    (value) => {
      expect(retryAfterAt(value, now)).toBe(now + 30_000);
    },
  );
});
