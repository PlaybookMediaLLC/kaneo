import { describe, expect, it } from "vite-plus/test";
import { isStrongMatch } from "./strong-match";

describe("isStrongMatch", () => {
  it("matches a title that has most of the typed words", () => {
    expect(isStrongMatch("Add dark mode to the dashboard", "Dark mode")).toBe(
      true,
    );
    expect(isStrongMatch("CSV exports", "Export to CSV")).toBe(true);
  });

  it("does not match a title that shares one word of several", () => {
    expect(isStrongMatch("Dark mode for reports", "Weekly reports")).toBe(
      false,
    );
  });

  it("does not match when the typed text has no meaningful word", () => {
    expect(isStrongMatch("Add the", "Add the thing")).toBe(false);
  });
});
