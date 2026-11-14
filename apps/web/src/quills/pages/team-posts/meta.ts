import type { PageMeta } from "../../core/types";
export const meta = {
  id: "team-posts",
  feature: "team-posts",
  route: "/feedback/$workspaceId/posts",
  audience: "teammate",
  mailLinked: false,
  token: "none",
  // The order of the requests: listQuillsPosts waits for the statuses.
  operations: [
    "listQuillsStatuses",
    "listQuillsBoards",
    "getQuillsPostFilterCounts",
    "listQuillsPosts",
  ],
  states: ["loading", "failed", "empty", "ready"],
} satisfies PageMeta;
