import { describe, expect, it } from "vite-plus/test";
import {
  contrastRatio,
  ensurePortalThemeContrast,
  parseHexColor,
} from "./contrast";

describe("ensurePortalThemeContrast (#317)", () => {
  it("auto-adjusts low-contrast workspace brand pairs to >= 4.5:1", () => {
    const adjusted = ensurePortalThemeContrast({
      primary: "#fde047", // bright yellow
      primaryForeground: "#ffffff", // fails AA (~1.3:1)
      background: "#ffffff",
      foreground: "#d1d5db", // fails AA (~1.4:1)
      muted: "#f3f4f6",
      mutedForeground: "#d1d5db",
    });

    expect(
      contrastRatio(
        parseHexColor(adjusted.primaryForeground)!,
        parseHexColor(adjusted.primary)!,
      ),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrastRatio(
        parseHexColor(adjusted.foreground)!,
        parseHexColor(adjusted.background)!,
      ),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrastRatio(
        parseHexColor(adjusted.mutedForeground)!,
        parseHexColor(adjusted.muted)!,
      ),
    ).toBeGreaterThanOrEqual(4.5);
  });
});
