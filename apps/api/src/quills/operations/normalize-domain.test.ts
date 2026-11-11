import { describe, expect, it } from "vite-plus/test";
import { normalizeDomain } from "./normalize-domain";

describe("normalizeDomain", () => {
  it("keeps one form of a public host name and refuses everything else", () => {
    expect(normalizeDomain(" Help.Example.COM. ")).toBe("help.example.com");
    expect(normalizeDomain("bücher.example.com")).toBe(
      "xn--bcher-kva.example.com",
    );
    const label = "a".repeat(63);
    // 200 characters is the limit; 201 is refused.
    const longest = `${label}.${label}.${label}.bbbb.com`;
    expect(longest).toHaveLength(200);
    expect(normalizeDomain(longest)).toBe(longest);
    for (const bad of [
      "",
      "localhost",
      "1.2.3.4",
      "1.2.3",
      "[::1]",
      "help.test",
      "x.localhost",
      "help.example.com:8080",
      "https://help.example.com",
      "user@help.example.com",
      "help.example.com/path",
      "-bad.example.com",
      "a..b.example.com",
      "under_score.example.com",
      "%68elp.example.com",
      `${"a".repeat(64)}.example.com`,
      `c${longest}`,
    ])
      expect(normalizeDomain(bad), bad).toBeNull();
  });
});
