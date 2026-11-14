import type { PageMeta } from "../../core/types";
export const meta = {
  id: "team-home",
  feature: "team",
  route: "/feedback/$workspaceId",
  audience: "teammate",
  mailLinked: false,
  token: "none",
  operations: [
    "fetchQuillsAdminOverview",
    "listQuillsBoards",
    "getQuillsTeamCounts",
  ],
  states: ["loading", "failed", "ready"],
} satisfies PageMeta;
