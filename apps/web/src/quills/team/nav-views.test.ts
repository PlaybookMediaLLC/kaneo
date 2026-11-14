import { describe, expect, it } from "vite-plus/test";
import { getTeamCountsFixture } from "../api/team/get-team-counts.fixture";
import { conversationViews, workspaceViews } from "./nav-views";

const views = [...conversationViews, ...workspaceViews];

describe("sidebar views", () => {
  it("gives each view a unique ID and path", () => {
    expect(new Set(views.map((view) => view.id)).size).toBe(views.length);
    const paths = views.map((view) => view.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const path of paths) expect(path).toMatch(/^(?:\/[a-z0-9-]+)*$/);
  });

  it("names only numbers of the team counts route", () => {
    const counts: Record<string, unknown> = getTeamCountsFixture.ok();
    for (const view of views)
      if (view.countKey) expect(typeof counts[view.countKey]).toBe("number");
  });
});
