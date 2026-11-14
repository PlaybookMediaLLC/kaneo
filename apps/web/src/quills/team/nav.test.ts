import { describe, expect, it } from "vite-plus/test";
import { ensureQuillsI18n } from "../i18n/load";
import { i18n } from "../ui/upstream";
import { teamNavigation } from "./nav";

describe("teamNavigation", () => {
  it("gives each entry a unique path and a translated label", async () => {
    await ensureQuillsI18n();
    const paths = teamNavigation.map((entry) => entry.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const entry of teamNavigation) {
      expect(entry.path).toMatch(/^(?:\/[a-z0-9-]+)*$/);
      expect(i18n.exists(entry.labelKey, { ns: "quills" })).toBe(true);
    }
  });
});
