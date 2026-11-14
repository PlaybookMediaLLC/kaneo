import type { SubmitPortalSurveyResponseResponse } from "./submit-portal-survey-response";
export const submitPortalSurveyResponseFixture = {
  ok: (overrides: Partial<SubmitPortalSurveyResponseResponse> = {}) =>
    ({
      ...{ surveyId: "survey_id_test_1" },
      ...overrides,
    }) satisfies SubmitPortalSurveyResponseResponse,
  problem: (status: 400 | 401 | 403 | 404 | 409 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
