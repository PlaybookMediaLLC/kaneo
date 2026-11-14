import { describe, expect, it } from "vite-plus/test";
import { avatarTone } from "./avatar-tone";

describe("avatarTone", () => {
  it("gives a name the same tone each time and spreads names over the tones", () => {
    expect(avatarTone("Ada Lovelace")).toBe(avatarTone("Ada Lovelace"));
    const names = ["Ada", "Grace", "Linus", "Margaret", "Alan", "Barbara"];
    expect(new Set(names.map(avatarTone)).size).toBeGreaterThan(1);
    expect(avatarTone(null)).toMatch(/^bg-/);
  });
});
