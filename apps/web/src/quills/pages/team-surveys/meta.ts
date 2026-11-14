import type { PageMeta } from "../../core/types";
export const meta = {
  id: "team-surveys",
  feature: "surveys",
  route: "/feedback/$workspaceId/surveys",
  audience: "teammate",
  mailLinked: false,
  token: "none",
  operations: ["listQuillsSurveys", "createQuillsSurvey"],
  states: ["loading", "failed", "ready", "done"],
} satisfies PageMeta;
