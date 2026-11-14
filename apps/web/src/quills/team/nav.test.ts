import { describe, expect, it } from "vite-plus/test";
import { getTeamCountsFixture } from "../api/team/get-team-counts.fixture";
import { ensureQuillsI18n } from "../i18n/load";
import { i18n } from "../ui/upstream";
import { teamSections } from "./nav";

describe("teamSections", () => {
  it("gives each section and view a unique path or ID and a translated label", async () => {
    await ensureQuillsI18n();
    const ids = teamSections.map((section) => section.id);
    expect(new Set(ids).size).toBe(ids.length);
    const items = teamSections.flatMap((section) => [
      section,
      ...section.items,
      ...section.browse,
    ]);
    const paths = teamSections.flatMap((section) =>
      [...section.items, ...section.browse].map((item) => item.path),
    );
    expect(new Set(paths).size).toBe(paths.length);
    for (const path of paths) expect(path).toMatch(/^(?:\/[a-z0-9-]+)*$/);
    for (const item of items)
      expect(i18n.exists(item.labelKey, { ns: "quills" })).toBe(true);
  });

  it("names only counts that the team counts route returns", () => {
    const counts = Object.keys(getTeamCountsFixture.ok());
    for (const section of teamSections)
      for (const item of [...section.items, ...section.browse])
        if (item.countKey) expect(counts).toContain(item.countKey);
  });
});
