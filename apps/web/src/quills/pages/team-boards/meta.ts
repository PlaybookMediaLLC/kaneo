import type { PageMeta } from "../../core/types";
export const meta = {
  id: "team-boards",
  feature: "boards",
  route: "/dashboard/workspace/$workspaceId/quills/boards",
  audience: "teammate",
  mailLinked: false,
  token: "none",
  operations: ["listQuillsBoards", "listQuillsSegments", "updateQuillsBoard"],
  states: ["loading", "failed", "ready", "done"],
} satisfies PageMeta;
