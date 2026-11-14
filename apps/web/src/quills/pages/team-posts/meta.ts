import type { PageMeta } from "../../core/types";
export const meta = {
  id: "team-posts",
  feature: "team-posts",
  route: "/feedback/$workspaceId/posts",
  audience: "teammate",
  mailLinked: false,
  token: "none",
  // The order of the requests: listQuillsPosts waits for the statuses. The New request
  // modal (`new=true`) loads the tags, and the customers for a typed author search.
  operations: [
    "listQuillsStatuses",
    "listQuillsBoards",
    "listQuillsPosts",
    "listQuillsTags",
    "listQuillsUsers",
    "createQuillsPost",
  ],
  states: ["loading", "failed", "empty", "ready", "done"],
} satisfies PageMeta;
