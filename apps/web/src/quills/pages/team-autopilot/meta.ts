import type { PageMeta } from "../../core/types";
export const meta = {
  id: "team-autopilot",
  feature: "autopilot",
  route: "/feedback/$workspaceId/autopilot",
  audience: "teammate",
  mailLinked: false,
  token: "none",
  operations: [
    "listQuillsFeedbackSignals",
    "listQuillsBoards",
    "acceptQuillsFeedbackSignalAsPost",
    "acceptQuillsFeedbackSignalAsVote",
    "dismissQuillsFeedbackSignal",
    "restoreQuillsFeedbackSignal",
  ],
  states: ["loading", "failed", "ready", "done"],
} satisfies PageMeta;
