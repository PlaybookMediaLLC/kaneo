import type { PageMeta } from "../../core/types";
export const meta = {
  id: "team-survey",
  feature: "surveys",
  route: "/feedback/$workspaceId/surveys/$surveyId",
  audience: "teammate",
  mailLinked: false,
  token: "none",
  operations: [
    "getQuillsSurveyResults",
    "listQuillsSurveys",
    "setQuillsSurveyStatus",
    "deleteQuillsSurvey",
  ],
  states: ["loading", "failed", "ready", "done"],
} satisfies PageMeta;
