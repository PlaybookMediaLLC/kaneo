import type { PageMeta } from "../../core/types";
export const meta = {
  id: "team-boards",
  feature: "boards",
  route: "/feedback/$workspaceId/boards",
  audience: "teammate",
  mailLinked: false,
  token: "none",
  operations: ["listQuillsBoards", "listQuillsSegments", "updateQuillsBoard"],
  states: ["loading", "failed", "ready", "done"],
} satisfies PageMeta;
