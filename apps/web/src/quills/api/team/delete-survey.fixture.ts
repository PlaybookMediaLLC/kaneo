import type { DeleteSurveyResponse } from "./delete-survey";
export const deleteSurveyFixture = {
  ok: (overrides: Partial<DeleteSurveyResponse> = {}) =>
    ({ ...{ id: "id_test_1" }, ...overrides }) satisfies DeleteSurveyResponse,
  problem: (status: 401 | 403 | 404 | 409 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
