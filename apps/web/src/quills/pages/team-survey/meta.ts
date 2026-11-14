import type { PageMeta } from "../../core/types";
export const meta = {
  id: "team-survey",
  feature: "surveys",
  route: "/dashboard/workspace/$workspaceId/quills/surveys/$surveyId",
  audience: "teammate",
  mailLinked: false,
  token: "none",
  operations: [
    "getQuillsSurveyResults",
    "setQuillsSurveyStatus",
    "deleteQuillsSurvey",
  ],
  states: ["loading", "failed", "ready", "done"],
} satisfies PageMeta;
