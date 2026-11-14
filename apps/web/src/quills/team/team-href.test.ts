import { describe, expect, it } from "vite-plus/test";
import { legacyTeamHref, teamHref } from "./team-href";

describe("teamHref", () => {
  it("builds a view address under /feedback with an encoded workspace", () => {
    expect(teamHref("workspace 1")).toBe("/feedback/workspace%201");
    expect(teamHref("workspace_1", "/triage")).toBe(
      "/feedback/workspace_1/triage",
    );
  });
});

describe("legacyTeamHref", () => {
  it("keeps the sub-path, the search and the hash", () => {
    expect(
      legacyTeamHref({
        pathname: "/dashboard/workspace/workspace_1/quills/surveys/survey_1",
        searchStr: "?tab=results",
        hash: "top",
      }),
    ).toBe("/feedback/workspace_1/surveys/survey_1?tab=results#top");
    expect(
      legacyTeamHref({
        pathname: "/dashboard/workspace/workspace%201/quills",
        searchStr: "",
        hash: "",
      }),
    ).toBe("/feedback/workspace%201");
  });

  it("does not rewrite a workspace page whose name starts with quills", () => {
    expect(
      legacyTeamHref({
        pathname: "/dashboard/workspace/workspace_1/quills-old",
        searchStr: "",
        hash: "",
      }),
    ).toBe("/dashboard/workspace/workspace_1/quills-old");
  });
});
