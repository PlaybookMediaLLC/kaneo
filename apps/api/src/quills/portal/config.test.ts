import { describe, expect, it } from "vite-plus/test";
import { publicBranding } from "./config";

describe("public portal branding", () => {
  it("returns colors and drops values that can load an external resource", () => {
    expect(
      publicBranding(
        JSON.stringify({
          themeMode: "dark",
          light: {
            primary: "oklch(0.6 0.2 250)",
            background: "url(https://tracker.example.test/pixel)",
            fontSans: "url(https://tracker.example.test/font)",
          },
        }),
      ),
    ).toEqual({
      themeMode: "dark",
      light: { primary: "oklch(0.6 0.2 250)" },
      dark: {},
    });
  });

  it("uses empty user-theme colors for malformed stored JSON", () => {
    expect(publicBranding("not-json")).toEqual({
      themeMode: "user",
      light: {},
      dark: {},
    });
  });
});
