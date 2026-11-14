import type { GetSurveyResultsResponse } from "./get-survey-results";
export const getSurveyResultsFixture = {
  ok: (overrides: Partial<GetSurveyResultsResponse> = {}) =>
    ({
      ...{
        survey: {
          id: "id_test_1",
          type: "nps",
          question: "value",
          options: [],
          targetSegmentIds: null,
          status: "draft",
          responseCount: 0,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        total: 0,
        score: null,
        scores: [],
        choices: [],
        comments: [],
      },
      ...overrides,
    }) satisfies GetSurveyResultsResponse,
  problem: (status: 401 | 403 | 404 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
