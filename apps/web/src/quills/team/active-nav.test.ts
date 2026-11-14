import { Lightbulb } from "lucide-react";
import { describe, expect, it } from "vite-plus/test";
import {
  activeSection,
  showsItem,
  viewPath,
  visibleSections,
} from "./active-nav";
import type { TeamNavSection } from "./nav";

const section = (
  id: string,
  paths: string[],
  browse: string[] = [],
): TeamNavSection => ({
  id,
  labelKey: `team.sections.${id}`,
  icon: Lightbulb,
  items: paths.map((path) => ({ path, labelKey: "team.nav.home" })),
  browse: browse.map((path) => ({ path, labelKey: "team.nav.home" })),
});
const sections = [
  section("support", []),
  section("feedback", ["", "/triage"], ["/posts"]),
  section("insights", ["/insights", "/surveys"]),
];

describe("viewPath", () => {
  it("removes the app base and a trailing slash", () => {
    expect(viewPath("/feedback/workspace_1", "workspace_1")).toBe("");
    expect(viewPath("/feedback/workspace_1/", "workspace_1")).toBe("");
    expect(viewPath("/feedback/workspace_1/surveys/s_1", "workspace_1")).toBe(
      "/surveys/s_1",
    );
  });
});

describe("showsItem", () => {
  it("matches the overview exactly and other views with their sub-paths", () => {
    const overview = { path: "", labelKey: "team.nav.home" };
    const surveys = { path: "/surveys", labelKey: "surveys.title" };
    expect(showsItem("", overview)).toBe(true);
    expect(showsItem("/triage", overview)).toBe(false);
    expect(showsItem("/surveys/s_1", surveys)).toBe(true);
    expect(showsItem("/surveys-old", surveys)).toBe(false);
  });
});

describe("activeSection", () => {
  it("selects the section of a view, a sub-path or a browse item", () => {
    expect(activeSection("", sections)?.id).toBe("feedback");
    expect(activeSection("/surveys/s_1", sections)?.id).toBe("insights");
    expect(activeSection("/posts/p_1", sections)?.id).toBe("feedback");
  });

  it("skips sections without views and falls back to the first visible section", () => {
    expect(visibleSections(sections).map((s) => s.id)).toEqual([
      "feedback",
      "insights",
    ]);
    expect(activeSection("/unknown", sections)?.id).toBe("feedback");
  });
});
