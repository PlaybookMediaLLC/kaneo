import type { PageMeta } from "../../core/types";
export const meta = {
  id: "team-duplicates",
  feature: "duplicates",
  route: "/feedback/$workspaceId/duplicates",
  audience: "teammate",
  mailLinked: false,
  token: "none",
  operations: [
    "listQuillsMergeSuggestions",
    "acceptQuillsSuggestion",
    "dismissQuillsSuggestion",
    "restoreQuillsSuggestion",
  ],
  states: ["loading", "failed", "ready", "done"],
} satisfies PageMeta;
